'use client'

/**
 * Memoria de contacto y dirección del checkout, guardada en localStorage.
 * Mismo patrón que `src/lib/cart.tsx` (no lo modifiques: es dueño de otro
 * slice).
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

/**
 * Versión del formato guardado. A diferencia de `CART_FORMAT_VERSION` (que
 * descarta ante CUALQUIER desajuste: ver `src/lib/cart.tsx`), acá el salto de
 * 1 a 2 es puramente ADITIVO — se suma la dirección de delivery, opcional en
 * el tipo — así que un registro de la versión 1 sigue siendo una forma VÁLIDA
 * de la 2. `getSavedCustomer` acepta cualquier versión <= la actual en vez de
 * exigir igualdad exacta: exigirla acá borraría el nombre y el teléfono de
 * CUALQUIER cliente que ya hubiera pedido antes de este cambio, por un campo
 * (la dirección) que ni siquiera necesita si pide retiro.
 */
const CUSTOMER_FORMAT_VERSION = 2

export type SavedCustomer = {
  name?: string
  phone?: string
  email?: string
  // --- Dirección de delivery, agregada en la v2 ---------------------------
  // Opcionales a propósito: un pedido de retiro no manda dirección, y estos
  // campos tienen que poder faltar sin que el registro entero se invalide.
  deliveryAddressLine?: string
  deliveryAddressUnit?: string
  deliveryAddressBetween?: string
  deliveryAddressNotes?: string
  savedAt: string
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isSavedCustomer(value: unknown): value is SavedCustomer {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    isOptionalString(v.name) &&
    isOptionalString(v.phone) &&
    isOptionalString(v.email) &&
    isOptionalString(v.deliveryAddressLine) &&
    isOptionalString(v.deliveryAddressUnit) &&
    isOptionalString(v.deliveryAddressBetween) &&
    isOptionalString(v.deliveryAddressNotes) &&
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
    if (!parsed || typeof parsed !== 'object') return null
    const version = (parsed as { v?: unknown }).v
    // Ver el comentario de `CUSTOMER_FORMAT_VERSION`: se acepta 1..actual, no
    // solo la actual. Una versión FUTURA (mayor a la que este build conoce)
    // sí se descarta, igual que antes.
    if (typeof version !== 'number' || version < 1 || version > CUSTOMER_FORMAT_VERSION) return null
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
 *
 * Nombre/teléfono/email NO se combinan con lo guardado antes: esos tres
 * campos están SIEMPRE visibles y editables en el checkout, así que lo que
 * llega acá ya es lo que el cliente tiene en pantalla — incluido vaciarlos a
 * propósito. La dirección de delivery es distinta: solo viaja cuando el
 * pedido actual fue delivery (el checkout no la manda en un pedido de
 * retiro), así que acá SÍ se combina con la que ya había guardada — si no,
 * pedir un retiro una vez borraría la dirección que el cliente había dejado
 * para su próximo delivery.
 */
export function saveCustomer(data: {
  name?: string
  phone?: string
  email?: string
  deliveryAddressLine?: string
  deliveryAddressUnit?: string
  deliveryAddressBetween?: string
  deliveryAddressNotes?: string
}): void {
  if (typeof window === 'undefined') return
  try {
    const previous = getSavedCustomer()
    const line = data.deliveryAddressLine ?? previous?.deliveryAddressLine
    const unit = data.deliveryAddressUnit ?? previous?.deliveryAddressUnit
    const between = data.deliveryAddressBetween ?? previous?.deliveryAddressBetween
    const notes = data.deliveryAddressNotes ?? previous?.deliveryAddressNotes

    const toSave: SavedCustomer = {
      ...(data.name ? { name: data.name } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.email ? { email: data.email } : {}),
      ...(line ? { deliveryAddressLine: line } : {}),
      ...(unit ? { deliveryAddressUnit: unit } : {}),
      ...(between ? { deliveryAddressBetween: between } : {}),
      ...(notes ? { deliveryAddressNotes: notes } : {}),
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
