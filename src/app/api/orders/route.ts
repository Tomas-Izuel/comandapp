import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { cartItemSchema, createOrderSchema } from '@/models/schemas/order.schema'
import { priceCartForStore, submitOrder } from '@/controllers/checkout.controller'
import { toApiError, zodToApiError } from '@/lib/errors'
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
// Rate limit (P-07) — best-effort, EN MEMORIA DEL PROCESO.
//
// Esto NO alcanza en producción: cada lambda/edge function de Vercel tiene su
// propia memoria, así que un atacante que rota entre instancias (o que pega
// contra varias regiones) lo esquiva sin esfuerzo, y el conteo se pierde en
// cada cold start. Es un piso mínimo para no dejar el endpoint completamente
// abierto mientras no hay nada mejor. Lo que hace falta de verdad es Vercel
// WAF (rate limiting a nivel de plataforma) o un store compartido (Upstash
// Redis) — pendiente, reportado en el resumen de este slice.
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number }
const rateLimitBuckets = new Map<string, Bucket>()

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()

  // Barrido oportunista para no dejar crecer el Map para siempre: un cron
  // dedicado sería otra pieza de infraestructura para un limitador que ya es
  // un parche. 1% de las requests alcanza para no acumular basura.
  if (Math.random() < 0.01) {
    for (const [k, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(k)
    }
  }

  const bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

function rateLimited() {
  return NextResponse.json({ error: 'Demasiados pedidos en poco tiempo. Esperá un momento y volvé a intentar.' }, { status: 429 })
}

export async function GET(request: NextRequest) {
  const ip = clientIp(request)
  // Cotizar es de lectura y lo dispara cada cambio de carrito: límite generoso.
  if (!checkRateLimit(`quote:ip:${ip}`, 120, 60_000)) return rateLimited()

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
  const ip = clientIp(request)
  // Por IP: nadie manda 200 pedidos por minuto desde una sola conexión.
  if (!checkRateLimit(`order:ip:${ip}`, 10, 60_000)) {
    log.warn('POST /api/orders', 'rate limit por IP', { ip })
    return rateLimited()
  }

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

  // Por teléfono: un mismo número no abre pedidos sin límite aunque rote de
  // IP. Los 8 caracteres de idempotencyKey harían esto inútil si la clave se
  // regenerara en cada intento, pero CLAUDE.md ya fija que se reusa por
  // intento de compra — así que este límite sí frena a un script que la
  // regenera a propósito para saltarse la idempotencia.
  if (!checkRateLimit(`order:phone:${parsed.data.customerPhone}`, 5, 5 * 60_000)) {
    log.warn('POST /api/orders', 'rate limit por teléfono', { ip })
    return rateLimited()
  }

  try {
    const result = await submitOrder(parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const { body: errorBody, status } = toApiError(err, 'POST /api/orders')
    return NextResponse.json(errorBody, { status })
  }
}
