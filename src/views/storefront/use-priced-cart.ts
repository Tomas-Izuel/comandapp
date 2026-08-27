'use client'

import * as React from 'react'
import { type CartLine, lineKey } from '@/lib/cart'

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
  store: { slug: string; name: string; currency: string; acceptingOrders: boolean; inStorePaymentEnabled: boolean; minOrderCents: number }
  priced: { items: PricedItemQuote[]; subtotalCents: number; totalCents: number; basePrepMinutes: number }
  eta: { baseMinutes: number; multiplier: number; etaMinutes: number; activeOrders: number; isBusy: boolean }
}

async function fetchPreview(storeSlug: string, items: unknown[], signal: AbortSignal): Promise<PreviewOk> {
  const params = new URLSearchParams({ storeSlug, items: JSON.stringify(items) })
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
          return cached ? { status: 'ready', line, index, quote: cached } : { status: 'error', line, index, error: message }
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
 * Cotización única del pedido completo, con el ETA de la cocina. Es la
 * revalidación que pide el producto: "si algo cambió se avisa", justo antes
 * de mostrar el paso de pago. Ya hacía un solo request para todo el
 * carrito (a diferencia de `usePricedLines`, que hasta A-03 pedía línea por
 * línea).
 */
export function useCheckoutQuote(storeSlug: string, lines: CartLine[]): CheckoutQuote {
  const linesKey = JSON.stringify(lines)
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

    fetchPreview(storeSlug, currentLines.map(toApiItem), controller.signal)
      .then((data) => setQuote({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setQuote({ status: 'error', error: err instanceof Error ? err.message : 'No se pudo calcular el pedido' })
      })

    return () => controller.abort()
  }, [storeSlug, linesKey])

  return quote
}
