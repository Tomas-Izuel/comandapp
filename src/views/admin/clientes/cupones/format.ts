import { zonedDay, zonedDayStart } from '@/lib/dates'
import type {
  CampaignSegment,
  CampaignStoppedReason,
  CouponPaymentMethod,
  CouponRedemptionRow,
  CouponState,
} from '@/models/types'

/**
 * Helpers puros de presentación de Cupones y Campañas. Locales a esta carpeta
 * a propósito, mismo criterio que `clientes/format.ts`: son frases para leer
 * en pantalla, no vocabulario de dominio — eso vive en `src/lib/coupon.ts`, que
 * no se toca acá.
 */

/** El segmento SIEMPRE en palabras (§5.6 del plan) — nunca `top_n` crudo. */
export function segmentLabel(segment: CampaignSegment): string {
  if (segment.kind === 'all') return 'Todos los clientes'
  if (segment.kind === 'top_n') return `Los mejores ${segment.topN} por plata gastada`
  return `Los que gastaron más`
}

/** Versión con el monto, para cuando hace falta ser específico (el log de campañas). */
export function segmentLabelWithAmount(segment: CampaignSegment, formatCents: (c: number) => string): string {
  if (segment.kind === 'min_spent') return `Los que gastaron más de ${formatCents(segment.minSpentCents)}`
  return segmentLabel(segment)
}

const COUPON_STATE_LABEL: Record<CouponState, string> = {
  draft: 'Borrador',
  scheduled: 'Programado',
  active: 'Activo',
  paused: 'Pausado',
  expired: 'Vencido',
  exhausted: 'Agotado',
}

export function couponStateLabel(state: CouponState): string {
  return COUPON_STATE_LABEL[state]
}

/**
 * `stopped` y `failed` NO se ven iguales (regla dura del slice): el tono de
 * `stopped` es neutral —la oferta dejó de valer, no rompimos nada nuestro—
 * mientras que `failed` es el único que se pinta como aviso real.
 */
export type CampaignStatusPresentation = { label: string; tone: 'neutral' | 'live' | 'done' | 'warning' }

export function campaignStoppedReasonLabel(reason: CampaignStoppedReason): string {
  // "se agotó porque funcionó" es la lectura que el dueño tiene que sacar de
  // acá, no "algo se rompió" (00-architecture.md §5.10.3.1).
  switch (reason) {
    case 'coupon_exhausted':
      return 'se cortó porque el cupón se agotó de uso'
    case 'coupon_expired':
      return 'se cortó porque el cupón venció antes de terminar de mandarse'
    case 'coupon_paused':
      return 'se cortó porque el cupón se pausó'
    // Éste no se "cortó": nunca arrancó. Cuando llegó el turno de mandar, todos
    // los destinatarios congelados se habían dado de baja (o el padrón perdió
    // sus filas) entre el encolado y el envío. Se dice sin culpar al dueño y
    // sin sugerir que algo se rompió: no se rompió nada.
    case 'no_recipients':
      return 'no se mandó: nadie del segmento seguía habilitado al momento de enviar'
  }
}

/**
 * El motivo de un canje `released`, en palabras (00-architecture.md §5.7.2.3):
 * la reserva se liberó porque el pedido murió sin que nunca hubiera plata.
 * Las dos causas posibles son "se venció el tiempo de espera" y "se
 * canceló a mano", y las dos son diagnóstico neutro, no un error del dueño.
 */
export function redemptionReleasedReasonLabel(reason: CouponRedemptionRow['releasedReason']): string {
  switch (reason) {
    case 'expired':
      return 'venció sin pagar'
    case 'cancelled_unpaid':
      return 'se canceló sin pagar'
    case null:
      return 'liberado'
  }
}

const PAYMENT_METHOD_HELPER: Record<CouponPaymentMethod, { unavailableLabel: string; href: string }> = {
  online: { unavailableLabel: 'Conectá Mercado Pago para usar esto', href: '/admin/pagos' },
  transfer: { unavailableLabel: 'Cargá una cuenta bancaria', href: '/admin/pagos' },
  in_store: { unavailableLabel: 'Habilitá el pago en el local', href: '/admin/pagos' },
}

export function paymentMethodUnavailableHint(method: CouponPaymentMethod): { unavailableLabel: string; href: string } {
  return PAYMENT_METHOD_HELPER[method]
}

// ---------------------------------------------------------------------------
// Vigencia: la hoja pide fecha (no hora) en la zona del LOCAL, `couponInputSchema`
// pide un `z.iso.datetime()` en UTC. Estas dos funciones son el único lugar que
// cruza esa frontera, para no repetir la aritmética de zona en cada campo.
// ---------------------------------------------------------------------------

/** `iso` → el día local en formato de `<input type="date">`. `null` si no hay fecha. */
export function isoToLocalDay(iso: string | null, timeZone: string): string {
  return iso ? zonedDay(iso, timeZone) : ''
}

/** El día elegido para "desde" → medianoche local, como ISO UTC. Vacío → `null` (sin desde, ya arrancó). */
export function localDayToStartIso(day: string, timeZone: string): string | null {
  if (!day) return null
  return zonedDayStart(day, timeZone).toISOString()
}

/**
 * El día elegido para "hasta" → medianoche del día SIGUIENTE, como ISO UTC.
 * `couponState()` compara con `>=` (`endsAt` es el límite EXCLUSIVO), así que
 * si `endsAt` fuera la medianoche del propio día elegido, ese día quedaría
 * vencido desde las 00:00 — el dueño eligió esa fecha esperando que valga
 * TODO ese día. Vacío → `null` (sin vencimiento).
 */
export function localDayToEndIso(day: string, timeZone: string): string | null {
  if (!day) return null
  const start = zonedDayStart(day, timeZone)
  const nextDay = zonedDay(new Date(start.getTime() + 36 * 60 * 60 * 1000), timeZone)
  return zonedDayStart(nextDay, timeZone).toISOString()
}

/**
 * Alfabeto, largo y cutoff IDÉNTICOS a `generateCouponCode()` de
 * `coupon.model.ts` — que tiene `import 'server-only'` y por eso es
 * inalcanzable desde acá. No hay Server Action que lo exponga (T1B no
 * necesitaba una; `marketing.actions.ts` no es archivo de este slice, así que
 * no se le puede agregar una sin salir del ownership de T4B — queda como
 * pendiente cross-lane en el dev log).
 *
 * Esta es una copia PURA para el botón "Generar", con CSPRNG del browser
 * (`crypto.getRandomValues`, nunca `Math.random()`) y el mismo rejection
 * sampling. No es una segunda fuente de verdad de seguridad: el código que
 * termina guardado pasa igual por `couponCodeSchema` y por
 * `coupons_code_check` en el servidor, así que esta copia solo puede sugerir
 * un código bueno, nunca colar uno inválido.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 8
const CODE_ALPHABET_CUTOFF = 248

export function generateCouponCodeClient(): string {
  let out = ''
  while (out.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH - out.length)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= CODE_ALPHABET_CUTOFF) continue
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (out.length === CODE_LENGTH) break
    }
  }
  return out
}
