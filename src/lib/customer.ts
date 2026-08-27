'use client'

/**
 * Memoria de contacto del checkout, guardada en localStorage. Mismo patrón
 * que `src/lib/cart.tsx` (no lo modifiques: es dueño de otro slice).
 *
 * Si el cliente ya pidió una vez, no le volvemos a pedir sus datos: el
 * checkout precarga esto y el segundo pedido se completa en tres toques.
 *
 * El teléfono se guarda TAL CUAL lo escribió, no en E.164: si guardamos
 * `+5491155554444` y él tipeó "11 5555-4444", la próxima visita ve un número
 * que no reconoce como propio. La normalización a E.164 sigue pasando en el
 * servidor (`phoneSchema`), acá es solo memoria de lo que el cliente tipeó.
 */

const CUSTOMER_KEY = 'burger-shop.customer'

// Mismo motivo que `CART_FORMAT_VERSION` en `cart.tsx`: sin versión, un
// cambio de formato futuro solo puede vaciar el storage, no migrarlo.
const CUSTOMER_FORMAT_VERSION = 1

export type SavedCustomer = {
  name?: string
  phone?: string
  email?: string
  savedAt: string
}

function isSavedCustomer(value: unknown): value is SavedCustomer {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    (v.name === undefined || typeof v.name === 'string') &&
    (v.phone === undefined || typeof v.phone === 'string') &&
    (v.email === undefined || typeof v.email === 'string') &&
    typeof v.savedAt === 'string'
  )
}

/** Datos guardados de una visita anterior, o `null` si no hay o el storage no está disponible. */
export function getSavedCustomer(): SavedCustomer | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CUSTOMER_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== CUSTOMER_FORMAT_VERSION) return null
    const data = (parsed as { data?: unknown }).data
    return isSavedCustomer(data) ? data : null
  } catch {
    // Modo privado de Safari, cuota llena, storage bloqueado: sin memoria,
    // pero el checkout sigue andando igual, solo pide los datos de nuevo.
    return null
  }
}

/**
 * Guarda los datos DESPUÉS de un pedido creado con éxito, nunca mientras el
 * cliente tipea: guardar en cada keystroke deja basura a medio escribir si
 * abandona el formulario.
 */
export function saveCustomer(data: { name?: string; phone?: string; email?: string }): void {
  if (typeof window === 'undefined') return
  try {
    const toSave: SavedCustomer = {
      ...(data.name ? { name: data.name } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.email ? { email: data.email } : {}),
      savedAt: new Date().toISOString(),
    }
    window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ v: CUSTOMER_FORMAT_VERSION, data: toSave }))
  } catch {
    // Sin persistencia en este caso: no rompe el pedido que ya se creó.
  }
}

/** El cliente pidió vaciar lo guardado: sin esto, un formulario precargado con datos que no recuerda haber dado es hostil. */
export function clearSavedCustomer(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(CUSTOMER_KEY)
  } catch {
    // No hay nada más que hacer: si falla el borrado, tampoco importa —
    // el storage ya estaba fallando para todo lo demás.
  }
}
