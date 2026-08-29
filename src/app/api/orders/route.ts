import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { cartItemSchema, createOrderSchema, type CreateOrderInput } from '@/models/schemas/order.schema'
import { priceCartForStore, submitOrder } from '@/controllers/checkout.controller'
import { RateLimitError, toApiError, zodToApiError } from '@/lib/errors'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import { log } from '@/lib/log'

/**
 * GET  — cotización de un carrito. Sin efectos secundarios: la usan tanto el
 *        carrito (precio por línea) como el checkout (precio + ETA del
 *        pedido completo) para revalidar contra la base antes de cobrar.
 * POST — crea el pedido de verdad. El cliente manda IDs y cantidades, nunca
 *        precios: `createOrderSchema` (vía `submitOrder`) es la única
 *        frontera de confianza.
 *
 * Los errores nunca devuelven el detalle interno (mensaje de Postgres, ruta
 * del schema): pasan por `toApiError`/`zodToApiError` (`src/lib/errors.ts`).
 */

const previewQuerySchema = z.object({
  storeSlug: z.string().trim().min(1),
  items: z.string().trim().min(1),
})

// ---------------------------------------------------------------------------
// Rate limit del camino de compra — Postgres vía `consumeRateLimit`
// (`src/models/rate-limit.model.ts`, T2), no el `Map` en memoria que vivía
// acá: placebo en Vercel, se pierde en cada cold start y no lo comparten las
// instancias (docs/pipelines/2026-08-29-rate-limiting/00-architecture.md §2, §5.3).
//
// La cotización (`GET`, más abajo) NO lleva límite de aplicación a propósito:
// dispara con cada cambio de carrito y un round trip extra a Postgres por
// tecla es exactamente lo que no se quiere. Lo cubre el WAF.
// ---------------------------------------------------------------------------

/**
 * `order:idempotency` es el candado de "¿ya vi esta clave?", no un límite de
 * negocio: `limit: 1` sobre el propio `idempotencyKey` como sujeto. El
 * incremento en Postgres es atómico (`insert ... on conflict do update`), así
 * que de N requests concurrentes con la misma clave exactamente UNA ve
 * `count == 1` (`allowed: true`) — esa es la única que gasta cupo real de
 * `order:phone`/`order:store`. El resto ve `count > 1` (`allowed: false`) y
 * sigue derecho hacia `submitOrder`, que ya sabe resolver un reintento sin
 * crear una fila nueva (el índice único de `orders` no se toca acá). No abre
 * un bypass de `order:phone`: reusar una `idempotencyKey` nunca crea un
 * pedido nuevo, siempre devuelve el que ya ganó la carrera.
 *
 * `order:phone` es el único bucket que puede cortar la venta: 5 pedidos cada
 * 10 minutos por el mismo teléfono, ya normalizado a E.164 por `phoneSchema`
 * (`createOrderSchema` lo garantiza antes de que esta función se llame — por
 * eso el límite va DESPUÉS de validar el body, nunca antes).
 *
 * `order:store` en cambio NUNCA bloquea: es un detector de anomalía de
 * volumen por tienda, no un límite. Cortar la venta de un local que se hizo
 * viral por una alerta de este balde es exactamente el error que este plan no
 * puede cometer (00-architecture.md §5.3) — se consume, se loguea si se pasa,
 * y la decisión de actuar queda del lado humano.
 */
async function enforceOrderRateLimits(input: CreateOrderInput): Promise<void> {
  const dedupePolicy = RATE_LIMIT_POLICY['order:idempotency']
  const dedupeDecision = await consumeRateLimit({
    bucket: 'order:idempotency',
    subject: input.idempotencyKey,
    limit: dedupePolicy.limit,
    windowSeconds: dedupePolicy.windowSeconds,
    // Default 'allow': si la RPC falla, todas las requests ven "primera vez"
    // y pagan los baldes reales — degradado, pero es el lado correcto en el
    // camino de compra (un doble tap durante un hipo de Postgres no puede
    // dejar sin cupo a nadie).
  })
  if (!dedupeDecision.allowed) {
    // Reintento de la misma compra: NUNCA puede recibir 429 acá. Se saltea
    // `order:phone`/`order:store` enteros y sigue derecho a `submitOrder`.
    return
  }

  const phonePolicy = RATE_LIMIT_POLICY['order:phone']
  const phoneDecision = await consumeRateLimit({
    bucket: 'order:phone',
    subject: input.customerPhone,
    limit: phonePolicy.limit,
    windowSeconds: phonePolicy.windowSeconds,
  })
  if (!phoneDecision.allowed) {
    // Nunca el teléfono en el log: es un dato personal y el bucket ya lo dice todo.
    log.warn('POST /api/orders', 'order:phone excedido, pedido rechazado')
    throw new RateLimitError('Estás mandando pedidos muy seguido. Esperá un minuto y probá de nuevo.', phoneDecision.retryAfterSeconds)
  }

  const storePolicy = RATE_LIMIT_POLICY['order:store']
  const storeDecision = await consumeRateLimit({
    bucket: 'order:store',
    // Subject = slug, no el id numérico de la tienda: acá no vale la pena una
    // consulta extra a `stores` solo para resolverlo (createOrder ya la hace
    // de nuevo un instante después) y, una vez que `consumeRateLimit` lo pasa
    // por HMAC-SHA256, el sujeto es texto opaco en la tabla de todos modos —
    // el slug identifica la tienda igual de bien y es estable en la práctica
    // (los grants no dejan que `authenticated` lo cambie).
    subject: input.storeSlug,
    limit: storePolicy.limit,
    windowSeconds: storePolicy.windowSeconds,
  })
  if (!storeDecision.allowed) {
    // Se loguea el umbral cruzado y no un conteo: `remaining` está clampeado a
    // 0, así que `limit - remaining` satura y diría "300" tanto con 300 como
    // con 3000. En un detector de anomalías de volumen, un número que miente
    // hacia abajo es peor que no darlo.
    log.warn('POST /api/orders', 'order:store por encima del umbral: posible pico de volumen, no se bloquea', {
      storeSlug: input.storeSlug,
      threshold: storePolicy.limit,
      windowSeconds: storePolicy.windowSeconds,
    })
  }
}

export async function GET(request: NextRequest) {
  const parsedQuery = previewQuerySchema.safeParse({
    storeSlug: request.nextUrl.searchParams.get('storeSlug'),
    items: request.nextUrl.searchParams.get('items'),
  })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Faltan datos para calcular el precio' }, { status: 400 })
  }

  let rawItems: unknown
  try {
    rawItems = JSON.parse(parsedQuery.data.items)
  } catch {
    return NextResponse.json({ error: 'El carrito llegó con un formato inválido' }, { status: 400 })
  }

  const parsedItems = z.array(cartItemSchema).min(1).safeParse(rawItems)
  if (!parsedItems.success) {
    return NextResponse.json({ error: 'El carrito tiene datos inválidos' }, { status: 400 })
  }

  try {
    const { store, priced, eta, delivery } = await priceCartForStore(parsedQuery.data.storeSlug, parsedItems.data)
    return NextResponse.json({
      store: {
        slug: store.slug,
        name: store.name,
        currency: store.currency,
        acceptingOrders: store.acceptingOrders,
        inStorePaymentEnabled: store.inStorePaymentEnabled,
        onlinePaymentEnabled: store.onlinePaymentEnabled,
        minOrderCents: store.minOrderCents,
      },
      priced,
      eta,
      delivery,
    })
  } catch (err) {
    const { body, status } = toApiError(err, 'GET /api/orders')
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'El pedido llegó con un formato inválido' }, { status: 400 })
  }

  const parsed = createOrderSchema.safeParse(body)
  if (!parsed.success) {
    const { body: errorBody, status } = zodToApiError(parsed.error)
    return NextResponse.json(errorBody, { status })
  }

  try {
    // Un reintento con la misma `idempotencyKey` (el caso que la idempotencia
    // existe para proteger: un doble tap con mala señal) no gasta cupo real —
    // ver el candado `order:idempotency` dentro de `enforceOrderRateLimits`.
    await enforceOrderRateLimits(parsed.data)
    const result = await submitOrder(parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const { body: errorBody, status, headers } = toApiError(err, 'POST /api/orders')
    return NextResponse.json(errorBody, { status, headers })
  }
}
