'use client'

import * as React from 'react'
import { type CartLine, lineKey } from '@/lib/cart'
import type { CouponAppliedQuote, DeliveryQuote } from '@/models/types'
import type { PaymentMethod } from '@/models/schemas/order.schema'

/**
 * El precio SIEMPRE sale del servidor (`priceCart` en order.model.ts, vía
 * `GET /api/orders`). Estos hooks nunca calculan un total desde acá: solo
 * piden la cotización y la muestran.
 */

export type PricedItemQuote = {
  productId: number
  name: string
  quantity: number
  unitPriceCents: number
  totalCents: number
  prepMinutes: number
  notes: string | null
  options: { optionId: number; name: string; groupName: string; priceDeltaCents: number }[]
}

type PreviewOk = {
  store: {
    slug: string
    name: string
    currency: string
    acceptingOrders: boolean
    inStorePaymentEnabled: boolean
    onlinePaymentEnabled: boolean
    minOrderCents: number
  }
  priced: {
    items: PricedItemQuote[]
    subtotalCents: number
    totalCents: number
    basePrepMinutes: number
    /** 0 sin cupón o con uno rechazado. Ya clampeado al subtotal — la vista nunca lo recalcula. */
    discountCents: number
    /** `null` si no se mandó código. El rechazo viaja como dato, nunca como excepción (§5.9.1). */
    coupon: CouponAppliedQuote | null
  }
  eta: { baseMinutes: number; multiplier: number; etaMinutes: number; activeOrders: number; isBusy: boolean }
  /**
   * Todo lo que hace falta para pintar la elección retiro/delivery, ya
   * calculado en el servidor — el browser no suma nada, ni plata ni minutos
   * de mínimo: solo elige qué mostrar según el método elegido.
   */
  delivery: DeliveryQuote
  /**
   * Noches comerciales del horizonte que ya llegaron al tope de programados
   * de la tienda (`stores.scheduled_capacity_per_night`). Ausente o vacío =
   * sin tope configurado, o ninguna noche llena todavía. Es una FOTO: puede
   * quedar vieja entre que se pintó y se confirmó — el árbitro real es la
   * transacción de `create_order`, no esta lista.
   */
  fullNights?: string[]
}

async function fetchPreview(
  storeSlug: string,
  items: unknown[],
  signal: AbortSignal,
  opts?: { paymentMethod?: PaymentMethod; couponCode?: string | null },
): Promise<PreviewOk> {
  const params = new URLSearchParams({ storeSlug, items: JSON.stringify(items) })
  if (opts?.paymentMethod) params.set('paymentMethod', opts.paymentMethod)
  if (opts?.couponCode) params.set('couponCode', opts.couponCode)
  const res = await fetch(`/api/orders?${params.toString()}`, { signal })
  const body = (await res.json()) as PreviewOk & { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'No se pudo calcular el precio')
  return body
}

function toApiItem(line: CartLine) {
  return { productId: line.productId, quantity: line.quantity, optionIds: line.optionIds, notes: line.notes ?? undefined }
}

export type PricedLine =
  | { status: 'loading'; line: CartLine; index: number }
  | { status: 'ready'; line: CartLine; index: number; quote: PricedItemQuote }
  | { status: 'error'; line: CartLine; index: number; error: string; quote?: PricedItemQuote }

/**
 * Cotiza el carrito COMPLETO en un solo request (antes hacía un fetch por
 * línea: con 6 líneas eran 6 requests y 18 queries — A-03 de la auditoría).
 * El servidor devuelve `priced.items` en el mismo orden en que se mandaron
 * (`priceCart` arma el array con `items.map`, y tira en cuanto una línea
 * falla), así que el índice de la respuesta es el índice del carrito.
 *
 * Si UNA línea es inválida, el servidor no devuelve un array parcial: tira
 * un solo `DomainError` para todo el request. Este hook intenta igual
 * atribuirlo a la línea que lo causó, para no perder el comportamiento de
 * "error contenido por fila con botón Quitar" que ya funcionaba bien:
 * los `DomainError` de `priceCart` citan el nombre del producto o la opción
 * entre comillas (`"${product.name}"`), así que si ese nombre matchea el
 * último precio bueno que tenemos cacheado de una línea, el error se
 * cuelga de ESA fila y el resto sigue mostrando su último precio conocido.
 *
 * Cuando no se puede atribuir —el mensaje no cita un nombre, o ninguna
 * línea cacheada matchea— el error queda a nivel carrito (`cartError`) en
 * vez de inventar a cuál línea pertenece. Lo que arreglaría esto de raíz:
 * que el endpoint devuelva errores POR ÍTEM en la respuesta en vez de un
 * solo mensaje para todo el batch.
 */
export function usePricedLines(storeSlug: string, lines: CartLine[]) {
  const linesKey = JSON.stringify(lines)
  const cacheRef = React.useRef<Map<string, PricedItemQuote>>(new Map())
  const [state, setState] = React.useState<{ results: PricedLine[]; cartError: string | null }>(() => ({
    results: lines.map((line, index) => ({ status: 'loading', line, index })),
    cartError: null,
  }))

  React.useEffect(() => {
    const controller = new AbortController()
    const currentLines: CartLine[] = JSON.parse(linesKey)

    // Mientras esperamos la respuesta seguimos mostrando el último precio
    // bueno conocido de cada línea, si lo hay, en vez de un skeleton: una
    // cotización de todo el carrito tarda un poco más que una de una sola
    // línea, y perder el precio visible en cada tecleo de cantidad se siente
    // peor que mostrarlo "viejo" por un instante.
    setState({
      cartError: null,
      results: currentLines.map((line, index) => {
        const cached = cacheRef.current.get(lineKey(line))
        return cached ? { status: 'ready', line, index, quote: cached } : { status: 'loading', line, index }
      }),
    })

    if (currentLines.length === 0) return

    fetchPreview(storeSlug, currentLines.map(toApiItem), controller.signal)
      .then((body) => {
        // Una respuesta puede llegar DESPUÉS de que el efecto haya sido
        // reemplazado por uno más nuevo (otro cambio de `lines` disparó otro
        // fetch mientras este seguía en vuelo). `controller.abort()` en el
        // cleanup no garantiza que ESTA promesa rechace — si la respuesta ya
        // había llegado, `.then` igual se ejecuta con datos VIEJOS. Sin este
        // chequeo, una cotización lenta para un carrito ya superado podía
        // pisar el resultado fresco y correcto con uno desactualizado.
        if (controller.signal.aborted) return
        // Un éxito cubre TODO el carrito actual: se puede reconstruir la
        // caché desde cero en vez de ir acumulando, así una línea que ya no
        // está en el carrito no se queda pegada en memoria para siempre.
        const freshCache = new Map<string, PricedItemQuote>()
        const results: PricedLine[] = currentLines.map((line, index) => {
          const quote = body.priced.items[index]
          if (quote) {
            freshCache.set(lineKey(line), quote)
            return { status: 'ready', line, index, quote }
          }
          return { status: 'error', line, index, error: 'No se pudo calcular el precio' }
        })
        cacheRef.current = freshCache
        setState({ results, cartError: null })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'No se pudo calcular el precio'
        const quotedName = message.match(/"([^"]+)"/)?.[1]

        let attributed = false
        const results: PricedLine[] = currentLines.map((line, index) => {
          const cached = cacheRef.current.get(lineKey(line))
          const matchesThisLine =
            !attributed && quotedName && cached && (cached.name === quotedName || cached.options.some((o) => o.name === quotedName))
          if (matchesThisLine) {
            attributed = true
            return { status: 'error', line, index, error: message, quote: cached }
          }
          if (cached) return { status: 'ready', line, index, quote: cached }
          // Sin caché (recién llegado a /carrito, antes del primer éxito) Y sin
          // poder atribuirle el error a ESTA línea puntual: no hay ninguna
          // evidencia de que sea la culpable. Antes esto caía a `status:
          // 'error'` con el mensaje CRUDO del servidor — que nombra un
          // producto/opción concretos ("Elegí al menos 1 opción de 'Punto de
          // cocción' para 'Clásica'") — así que en el primer render, con el
          // caché SIEMPRE vacío, una sola línea mal armada pintaba ese mensaje
          // en TODAS las líneas, la bien armada incluida: el cliente veía "te
          // falta elegir la opción" en un ítem donde SÍ la había elegido. Sin
          // caché no hay con qué comparar el nombre citado, así que esta línea
          // queda en estado DESCONOCIDO (no fallado): se pinta como
          // "calculando" en vez de acusarla de algo que quizás no hizo. El
          // `cartError` de más abajo ya cubre el caso "no se puede atribuir" a
          // nivel carrito.
          return { status: 'loading', line, index }
        })
        setState({ results, cartError: attributed ? null : message })
      })

    return () => controller.abort()
  }, [storeSlug, linesKey])

  const { results, cartError } = state
  const readyLines = results.filter((r): r is Extract<PricedLine, { status: 'ready' }> => r.status === 'ready')
  const subtotalCents = readyLines.reduce((sum, r) => sum + r.quote.totalCents, 0)
  const isLoading = results.some((r) => r.status === 'loading')
  const hasErrors = results.some((r) => r.status === 'error') || cartError !== null

  return { results, subtotalCents, isLoading, hasErrors, cartError }
}

export type CheckoutQuote =
  | { status: 'loading' }
  | { status: 'ready'; data: PreviewOk }
  | { status: 'error'; error: string }

/**
 * Cotización única del pedido completo, con el ETA de la cocina y la cotización
 * de envío (`delivery`). Es la revalidación que pide el producto: "si algo
 * cambió se avisa", justo antes de mostrar el paso de pago. Un solo request
 * para todo el carrito (a diferencia de `usePricedLines`, que hasta A-03 pedía
 * línea por línea) — la elección retiro/delivery no dispara un segundo fetch,
 * `delivery` viaja en la misma respuesta.
 *
 * `opts.paymentMethod`/`opts.couponCode` viajan en la misma request y ya
 * disparan una recotización cuando cambian — no hace falta un fetch aparte
 * para el cupón. Sin debounce: el `AbortController` de acá es el mecanismo, y
 * el balde `coupon_check:ip` se cobra solo cuando el código no existe,
 * justamente para no necesitarlo (00-architecture.md §5.9.4, §5.13).
 */
export function useCheckoutQuote(
  storeSlug: string,
  lines: CartLine[],
  opts?: { paymentMethod?: PaymentMethod; couponCode?: string | null },
): CheckoutQuote {
  const linesKey = JSON.stringify(lines)
  const paymentMethod = opts?.paymentMethod
  const couponCode = opts?.couponCode ?? null
  const [quote, setQuote] = React.useState<CheckoutQuote>({ status: 'loading' })

  React.useEffect(() => {
    const currentLines: CartLine[] = JSON.parse(linesKey)
    if (currentLines.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote({ status: 'error', error: 'El carrito está vacío' })
      return
    }

    const controller = new AbortController()
    setQuote({ status: 'loading' })

    fetchPreview(storeSlug, currentLines.map(toApiItem), controller.signal, { paymentMethod, couponCode })
      .then((data) => {
        // Mismo motivo que en `usePricedLines`: abortar el controller no
        // garantiza que esta promesa ya rechazada — una respuesta vieja que
        // llega tarde puede pisar el 'ready' fresco (o un error real más
        // nuevo) con el resultado de un carrito que el cliente ya cambió.
        // Nunca se quiere que ESE dato viejo decida si el botón de confirmar
        // se habilita.
        if (controller.signal.aborted) return
        setQuote({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setQuote({ status: 'error', error: err instanceof Error ? err.message : 'No se pudo calcular el pedido' })
      })

    return () => controller.abort()
  }, [storeSlug, linesKey, paymentMethod, couponCode])

  return quote
}
