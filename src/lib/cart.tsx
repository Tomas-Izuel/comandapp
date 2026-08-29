'use client'

import * as React from 'react'
import { randomUuidV4 } from '@/lib/uuid'
import { usePreviewMode } from '@/lib/preview-mode'

/**
 * Carrito por tienda, guardado en localStorage. El cliente no tiene cuenta:
 * esto es toda su persistencia entre visitas.
 *
 * Guarda SOLO {productId, quantity, optionIds, notes} — nunca precios ni
 * nombres. Lo que cuesta cada línea se calcula siempre contra la base
 * (ver `src/views/storefront/use-priced-cart.ts`), nunca desde acá.
 */

const CART_KEY_PREFIX = 'burger-shop.cart.'
const ORDERS_KEY = 'burger-shop.orders'
const ORDERS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const IDEMPOTENCY_KEY_PREFIX = 'burger-shop.idempotency.'

/**
 * Sufijo del slug de storage cuando `usePreviewMode()` está activo (ver
 * `src/lib/preview-mode.ts`). Sin esto, el dueño jugando con su propia carta
 * desde `/admin/apariencia` escribiría en la MISMA clave de localStorage que
 * un cliente real de esa tienda usa en ese mismo navegador, y le dejaría un
 * carrito fantasma. El namespace vive en la CLAVE de storage nomás: el
 * `storeSlug` que ve el resto de la app (API, checkout) sigue siendo el real.
 */
const PREVIEW_STORAGE_SUFFIX = '.preview'

// Espeja `cartItemSchema.quantity.max(50)` de `order.schema.ts`. Sin este
// techo, sumar la cantidad de una línea que ya existe (`addLine`) o subirla a
// mano (`setQuantity`) podía superar el máximo que el servidor acepta — y como
// el carrito persiste en localStorage y nunca se re-valida hasta el checkout,
// la línea quedaba MAL PARA SIEMPRE: `cartItemSchema` rechaza el carrito
// ENTERO (los demás ítems, bien armados, se caen con él), así que el cliente
// veía "El carrito tiene datos inválidos" en cada cotización y en cada intento
// de pedido sin ninguna pista de cuál línea o por qué, hasta que alguien
// notara la cantidad y la bajara a mano. Achicar acá, en el único lugar que
// escribe cantidades, corta el problema de raíz en vez de solo mostrar el
// error mejor.
const MAX_LINE_QUANTITY = 50

// Versión del formato guardado en cada clave. Sin esto, cambiar la forma de
// lo persistido más adelante solo puede vaciar el storage (si el parser
// vuela con datos viejos) o corromperse en silencio (si no vuela). Con un
// número de versión, un formato nuevo simplemente descarta lo que no
// matchea — mismo comportamiento hoy (storage vacío se lee como `[]`), pero
// deja la puerta abierta a migrar de verdad en vez de solo vaciar.
const CART_FORMAT_VERSION = 1
const ORDERS_FORMAT_VERSION = 1

export type CartLine = {
  productId: number
  quantity: number
  optionIds: number[]
  notes: string | null
}

export type SavedOrderRef = {
  token: string
  shortCode: string
  storeSlug: string
  createdAt: string
}

/** Se exporta: `use-priced-cart.ts` la necesita para asociar un error de cotización a su línea. */
export function lineKey(line: Pick<CartLine, 'productId' | 'optionIds' | 'notes'>): string {
  return `${line.productId}|${[...line.optionIds].sort((a, b) => a - b).join(',')}|${line.notes ?? ''}`
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.productId === 'number' &&
    typeof v.quantity === 'number' &&
    Array.isArray(v.optionIds) &&
    v.optionIds.every((id) => typeof id === 'number') &&
    (v.notes === null || typeof v.notes === 'string')
  )
}

function readCart(storeSlug: string): CartLine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CART_KEY_PREFIX + storeSlug)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Envelope versionado: `{ v, lines }`. Un formato viejo (o de una
    // versión futura que este build no entiende) se descarta en vez de
    // intentar leerlo a medias.
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== CART_FORMAT_VERSION) return []
    const lines = (parsed as { lines?: unknown }).lines
    if (!Array.isArray(lines)) return []
    // Auto-cura una línea que haya quedado con `quantity` por encima del
    // límite ANTES de que `MAX_LINE_QUANTITY` se aplicara en `addLine`/
    // `setQuantity`: sin este saneo, esa línea vieja se queda inválida para
    // siempre (rechaza el carrito ENTERO en cada cotización y en cada intento
    // de pedido) y nada en la UI de carrito le explica al cliente por qué.
    return lines.filter(isCartLine).map((line) => ({ ...line, quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, line.quantity)) }))
  } catch {
    return []
  }
}

function writeCart(storeSlug: string, lines: CartLine[]) {
  try {
    window.localStorage.setItem(CART_KEY_PREFIX + storeSlug, JSON.stringify({ v: CART_FORMAT_VERSION, lines }))
  } catch {
    // localStorage puede fallar (modo privado, cuota llena): el carrito sigue
    // vivo en memoria para esta sesión, solo no persiste entre visitas.
  }
}

// ---------------------------------------------------------------------------
// Clave de idempotencia — evita que un doble tap en "Pagar" o un reintento de
// red creen dos pedidos. Se genera al confirmar (no al montar el checkout),
// se reusa en cada reintento del MISMO intento de compra, y se descarta
// después de un pedido creado con éxito o apenas cambia el carrito (otro
// carrito es otro pedido). Persiste en localStorage, no solo en memoria, para
// sobrevivir a un reload en medio de un reintento con mala señal.
// ---------------------------------------------------------------------------

function readIdempotencyKey(storeSlug: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(IDEMPOTENCY_KEY_PREFIX + storeSlug)
  } catch {
    return null
  }
}

function writeIdempotencyKey(storeSlug: string, key: string | null) {
  try {
    if (key === null) window.localStorage.removeItem(IDEMPOTENCY_KEY_PREFIX + storeSlug)
    else window.localStorage.setItem(IDEMPOTENCY_KEY_PREFIX + storeSlug, key)
  } catch {
    // Sin persistencia en este caso: la clave sigue viva en memoria para esta
    // sesión (el estado de React ya la tiene), solo no sobrevive a un reload.
  }
}

type CartContextValue = {
  storeSlug: string
  lines: CartLine[]
  itemCount: number
  hydrated: boolean
  addLine: (line: CartLine) => void
  removeLine: (index: number) => void
  setQuantity: (index: number, quantity: number) => void
  clear: () => void
  /** Clave de idempotencia del intento de compra en curso: la crea si no existe, y reusa la que ya había. */
  ensureIdempotencyKey: () => string
  /** Se llama después de un pedido creado con éxito: el próximo pedido necesita una clave nueva. */
  discardIdempotencyKey: () => void
}

const CartContext = React.createContext<CartContextValue | null>(null)

export function CartProvider({ storeSlug, children }: { storeSlug: string; children: React.ReactNode }) {
  const [lines, setLines] = React.useState<CartLine[]>([])
  const [hydrated, setHydrated] = React.useState(false)

  // Namespace de storage: ver `PREVIEW_STORAGE_SUFFIX`. `storeSlug` (el que
  // ve el resto de la app — API, `saveOrderRef`, etc.) queda intacto; solo la
  // CLAVE de localStorage cambia. En la práctica esto se fija una sola vez:
  // `CartProvider` vive en el layout de `/[store]` y no se desmonta entre
  // navegaciones internas, y la carga inicial del iframe de vista previa
  // siempre trae `?preview=brand` puesto, así que `isPreview` ya es `true`
  // desde el primer render.
  const isPreview = usePreviewMode()
  const storageSlug = isPreview ? `${storeSlug}${PREVIEW_STORAGE_SUFFIX}` : storeSlug

  // Salta el primer write del efecto de persistencia: ese primer disparo pasa
  // justo después de hidratar y escribiría exactamente lo que se acaba de
  // leer, un round-trip a storage sin ningún cambio real detrás.
  const skipNextPersistRef = React.useRef(true)

  React.useEffect(() => {
    // localStorage no existe en el server: arrancamos en blanco (igual que el
    // render de SSR) y recién leemos acá, después del primer render en el
    // cliente, para no pisar el HTML hidratado con contenido distinto.
    skipNextPersistRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(readCart(storageSlug))
    setHydrated(true)
  }, [storageSlug])

  React.useEffect(() => {
    if (!hydrated) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }
    writeCart(storageSlug, lines)
  }, [storageSlug, lines, hydrated])

  // La clave vive en un ref, no en estado: se lee/escribe desde el handler de
  // submit del checkout y no necesita disparar un re-render propio.
  const idempotencyKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    idempotencyKeyRef.current = readIdempotencyKey(storageSlug)
  }, [storageSlug])

  const discardIdempotencyKey = React.useCallback(() => {
    if (idempotencyKeyRef.current === null) return
    idempotencyKeyRef.current = null
    writeIdempotencyKey(storageSlug, null)
  }, [storageSlug])

  const ensureIdempotencyKey = React.useCallback(() => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = randomUuidV4()
      writeIdempotencyKey(storageSlug, idempotencyKeyRef.current)
    }
    return idempotencyKeyRef.current
  }, [storageSlug])

  const addLine = React.useCallback(
    (line: CartLine) => {
      // El carrito cambió: el intento de compra en curso, si había uno, es
      // otro pedido ahora. Sin esto, la idempotencia dedupe algo que el
      // cliente ya modificó.
      discardIdempotencyKey()
      setLines((prev) => {
        const key = lineKey(line)
        const idx = prev.findIndex((l) => lineKey(l) === key)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], quantity: Math.min(MAX_LINE_QUANTITY, next[idx].quantity + line.quantity) }
          return next
        }
        return [...prev, { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity) }]
      })
    },
    [discardIdempotencyKey],
  )

  const removeLine = React.useCallback(
    (index: number) => {
      discardIdempotencyKey()
      setLines((prev) => prev.filter((_, i) => i !== index))
    },
    [discardIdempotencyKey],
  )

  const setQuantity = React.useCallback(
    (index: number, quantity: number) => {
      discardIdempotencyKey()
      setLines((prev) => {
        if (quantity <= 0) return prev.filter((_, i) => i !== index)
        const next = [...prev]
        if (!next[index]) return prev
        next[index] = { ...next[index], quantity: Math.min(MAX_LINE_QUANTITY, quantity) }
        return next
      })
    },
    [discardIdempotencyKey],
  )

  const clear = React.useCallback(() => {
    discardIdempotencyKey()
    setLines([])
  }, [discardIdempotencyKey])

  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0)

  const value = React.useMemo<CartContextValue>(
    () => ({
      storeSlug,
      lines,
      itemCount,
      hydrated,
      addLine,
      removeLine,
      setQuantity,
      clear,
      ensureIdempotencyKey,
      discardIdempotencyKey,
    }),
    [storeSlug, lines, itemCount, hydrated, addLine, removeLine, setQuantity, clear, ensureIdempotencyKey, discardIdempotencyKey],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext)
  if (!ctx) throw new Error('useCart tiene que usarse dentro de <CartProvider>')
  return ctx
}

/**
 * Vacía el carrito y descarta la clave de idempotencia de UNA tienda, para
 * cuando su pedido se resolvió: pago online visto `approved`, o pedido de
 * pago en el local confirmado. A partir de ahí un carrito viejo con esa
 * clave sería un pedido fantasma si se reintentara.
 *
 * Deliberadamente NO es un método de `useCart()`: quien la llama es el
 * seguimiento del pedido en `/pedido/[token]`, que vive fuera del árbol de
 * `/[store]` y por lo tanto fuera de `<CartProvider>` (ver
 * `src/app/[store]/layout.tsx` — el provider se monta ahí, no en la raíz).
 * Esta función opera directo sobre localStorage para poder llamarse desde
 * cualquier lado con solo el slug de la tienda.
 *
 * Firma: `clearResolvedOrderCart(storeSlug: string): void`.
 */
export function clearResolvedOrderCart(storeSlug: string): void {
  if (typeof window === 'undefined') return
  writeCart(storeSlug, [])
  writeIdempotencyKey(storeSlug, null)
}

// ---------------------------------------------------------------------------
// "Mis pedidos" — referencias a pedidos hechos, para verlos sin cuenta.
// ---------------------------------------------------------------------------

function isSavedOrderRef(value: unknown): value is SavedOrderRef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.token === 'string' &&
    typeof v.shortCode === 'string' &&
    typeof v.storeSlug === 'string' &&
    typeof v.createdAt === 'string'
  )
}

function readOrderRefs(): SavedOrderRef[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== ORDERS_FORMAT_VERSION) return []
    const refs = (parsed as { refs?: unknown }).refs
    if (!Array.isArray(refs)) return []
    const cutoff = Date.now() - ORDERS_MAX_AGE_MS
    return refs.filter(isSavedOrderRef).filter((ref) => new Date(ref.createdAt).getTime() >= cutoff)
  } catch {
    return []
  }
}

function writeOrderRefs(refs: SavedOrderRef[]) {
  try {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify({ v: ORDERS_FORMAT_VERSION, refs }))
  } catch {
    // ídem: sin persistencia en este caso, no rompe la sesión actual.
  }
}

/** Pedidos guardados, más nuevos primero. Poda de paso los de más de 90 días. */
export function getSavedOrders(): SavedOrderRef[] {
  const refs = readOrderRefs()
  writeOrderRefs(refs)
  return [...refs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveOrderRef(ref: SavedOrderRef) {
  const refs = readOrderRefs()
  if (refs.some((r) => r.token === ref.token)) return
  writeOrderRefs([ref, ...refs])
}
