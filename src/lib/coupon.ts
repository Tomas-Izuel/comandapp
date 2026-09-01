import { formatCents, percentOfCentsDown } from '@/lib/money'
import type { Coupon, CouponState } from '@/models/types'

/**
 * Lógica pura de cupones.
 *
 * **Sin `import 'server-only'`, y es a propósito** — mismo criterio que
 * `src/lib/delivery.ts`: la misma función que le muestra el descuento al cliente
 * en el checkout tiene que ser la que lo describe en el panel del local. Dos
 * copias de la fórmula divergen, y la que divergiría es siempre la que se ve.
 *
 * Lo que este módulo NO hace: cobrar. El descuento que se aplica de verdad lo
 * calcula `public.create_order` en SQL y rechaza al llamador si el número no
 * coincide (CPN09). Acá se calcula para MOSTRAR.
 */

/**
 * Mails de campaña por día. Decisión del dueño del producto, textual:
 * *"Limitemos campañas de mails a 15 cupones por día, si lo desean extender un
 * mail de comandapp para negociar otro plan"*.
 *
 * **Son 15 MAILS, no 15 cupones distintos creados.** El único recurso que hay
 * que racionar es la cuota de Resend; crear un cupón cuesta una fila. Los ~85
 * restantes del cupo del proyecto quedan para el mail transaccional, que es el
 * que nunca puede fallar.
 *
 * Y define además el tamaño del chunk: `min(15, 100)` = 15, o sea **un chunk =
 * un día = una llamada al batch**. La unidad de reintento, la de presupuesto y
 * la de idempotencia son la misma cosa.
 */
export const CAMPAIGN_DAILY_BUDGET = 15

/**
 * El estado que se MUESTRA, derivado. `expired` y `exhausted` no se persisten:
 * un estado guardado que un cron da vuelta miente entre ticks, y el cron
 * correría cada dos minutos para mantener una columna que se calcula en cero
 * milisegundos. Misma doctrina que `canTakeOrders()`.
 *
 * El orden de los casos es el de la realidad, no el alfabético: un cupón
 * pausado a mano no debería reportarse como "vencido" solo porque además se le
 * pasó la fecha — lo que el dueño necesita saber es que él lo apagó.
 */
export function couponState(coupon: Coupon, now: Date = new Date()): CouponState {
  if (coupon.status === 'draft') return 'draft'
  if (coupon.status === 'paused') return 'paused'

  const t = now.getTime()
  if (coupon.startsAt && t < new Date(coupon.startsAt).getTime()) return 'scheduled'
  if (coupon.endsAt && t >= new Date(coupon.endsAt).getTime()) return 'expired'
  // Sobre la SUMA de los dos contadores: una reserva ocupa cupo igual que un
  // canje, así que un cupón con 50 reservas vivas y cero canjes está agotado
  // para el próximo cliente. Es el mismo predicado que el CHECK de la tabla.
  if (coupon.reservedCount + coupon.redeemedCount >= coupon.maxRedemptions) return 'exhausted'

  return 'active'
}

/** `true` si el cupón se puede canjear ahora mismo. */
export function isCouponUsable(coupon: Coupon, now: Date = new Date()): boolean {
  return couponState(coupon, now) === 'active'
}

/**
 * El descuento en texto, para la etiqueta del cupón y para el mail.
 *
 * Se computa acá y no en el JSX porque lo usan cuatro superficies (la lista del
 * panel, la hoja de edición, el checkout y la plantilla del mail) y una frase
 * armada cuatro veces se desincroniza en la primera corrección de copy.
 */
export function describeDiscount(coupon: Coupon, currency = 'ARS'): string {
  if (coupon.discountType === 'fixed') {
    return formatCents(coupon.amountOffCents ?? 0, currency)
  }

  const base = `${coupon.percent ?? 0}%`
  return coupon.maxDiscountCents === null
    ? base
    : `${base} (hasta ${formatCents(coupon.maxDiscountCents, currency)})`
}

/**
 * Cuánto descuenta este cupón sobre un subtotal concreto, ya clampeado.
 *
 * Es la fórmula que también vive en SQL adentro de `create_order`. Escritas dos
 * veces a propósito, igual que `ALLOWED_TRANSITIONS`, y con un test de paridad:
 * ésta muestra el número antes de comprar, la de Postgres es la que cobra.
 */
export function discountForSubtotal(coupon: Coupon, subtotalCents: number): number {
  let discount =
    coupon.discountType === 'fixed'
      ? (coupon.amountOffCents ?? 0)
      : percentOfCentsDown(subtotalCents, coupon.percent ?? 0)

  if (coupon.discountType === 'percentage' && coupon.maxDiscountCents !== null) {
    discount = Math.min(discount, coupon.maxDiscountCents)
  }

  // El clamp. Sin esto, un cupón de monto fijo más grande que el carrito deja el
  // total POSITIVO cuando hay envío caro, y el local termina pagándole al
  // cliente por comer.
  return Math.min(discount, subtotalCents)
}

/**
 * Exposición máxima en plata si el código se filtra. Es el número que decide si
 * un cambio necesita segundo factor.
 *
 * `null` significa **sin cota**, y no es un detalle de tipos: con
 * `maxDiscountCents` en null el techo lo pone el carrito más caro que alguien
 * arme, o sea que no hay techo. Devolver un número grande en vez de `null`
 * haría que una comparación "el nuevo es mayor" diera `false` y el cambio más
 * peligroso del feature pasara sin código.
 */
export function worstCaseCents(coupon: Coupon): number | null {
  if (coupon.discountType === 'fixed') {
    return coupon.maxRedemptions * (coupon.amountOffCents ?? 0)
  }
  if (coupon.maxDiscountCents === null) return null
  return coupon.maxRedemptions * coupon.maxDiscountCents
}

/** Los campos de un cupón que `requiresConfirmation` compara. */
export type CouponShape = Pick<
  Coupon,
  | 'code'
  | 'discountType'
  | 'percent'
  | 'amountOffCents'
  | 'maxDiscountCents'
  | 'minSubtotalCents'
  | 'startsAt'
  | 'endsAt'
  | 'maxRedemptions'
  | 'maxRedemptionsPerPhone'
  | 'paymentMethods'
  | 'status'
>

/** `-Infinity` para `null`: en un tope, `null` es el valor MÁS AMPLIO. */
function capValue(v: number | null): number {
  return v === null ? Number.POSITIVE_INFINITY : v
}

function timeValue(v: string | null, whenNull: number): number {
  return v === null ? whenNull : new Date(v).getTime()
}

/**
 * ¿Este cambio necesita el código de 6 dígitos por mail?
 *
 * El criterio es objetivo y es uno solo: **pide código si y solo si el cambio
 * puede aumentar la exposición de plata, o ensanchar quién / cuándo / cómo se
 * canjea.**
 *
 * **APAGAR NUNCA PIDE CÓDIGO, y ésa es la mitad importante de la función.**
 * Escenario completo: un código se filtró, está sangrando plata, y el dueño no
 * puede apagarlo hasta que llegue un mail — un mail que sale por Resend, que es
 * el recurso escaso de todo este feature, y que puede tardar, caer en spam o no
 * salir. El repo ya tiene el principio escrito para la vista previa de marca:
 * un modo que solo RESTA capacidad no es una escalación. Contradice la letra de
 * lo que se pidió ("crear o modificar"), y por eso se preguntó: aprobado por el
 * dueño del producto el 2026-08-31, textual: *"No apagar se apaga sin codigo"*.
 *
 * ⚠️ **LOS `null` CAEN DEL LADO QUE ESCALA.** `null` significa "sin tope" /
 * "todos los métodos" / "sin vencimiento": es el valor **más amplio**, no el más
 * chico. Poner `maxDiscountCents` en null es el cambio más peligroso que se
 * puede hacer, y tratarlo como 0 lo dejaría pasar sin código. Es el error más
 * fácil de cometer implementando esto.
 *
 * Corre en dos lados: en la hoja, mientras el dueño tipea, para que nadie
 * descubra el segundo factor después de apretar guardar; y en la Server Action,
 * que es la autoridad. Es una regla de proceso, no una invariante de dominio, así
 * que TS + chequeo en el servidor es el lugar correcto — y no hay camino de
 * escritura desde el browser que la esquive, porque `coupons` no tiene un solo
 * grant para `authenticated`.
 */
export function requiresConfirmation(current: CouponShape, next: CouponShape): boolean {
  // Encender o reencender. Apagar (a `paused` o `draft`) no está acá.
  if (next.status === 'active' && current.status !== 'active') return true

  // El código es la llave. Cambiarlo es ponerle una nueva a la misma plata.
  if (next.code !== current.code) return true

  // Cambiar el TIPO de descuento no es comparable campo a campo: se trata como
  // escalación siempre, porque "15%" y "$3.000" no se ordenan entre sí.
  if (next.discountType !== current.discountType) return true

  if ((next.percent ?? 0) > (current.percent ?? 0)) return true
  if ((next.amountOffCents ?? 0) > (current.amountOffCents ?? 0)) return true

  // Topes: subirlos escala, y ponerlos en null escala MÁS.
  if (capValue(next.maxDiscountCents) > capValue(current.maxDiscountCents)) return true
  if (next.maxRedemptions > current.maxRedemptions) return true
  if (capValue(next.maxRedemptionsPerPhone) > capValue(current.maxRedemptionsPerPhone)) return true

  // Bajar el mínimo ensancha quién puede canjear.
  if (next.minSubtotalCents < current.minSubtotalCents) return true

  // Ventana: estirar el final o adelantar el arranque. `endsAt = null` es
  // "sin vencimiento" (+Infinity) y `startsAt = null` es "ya empezó"
  // (-Infinity): los dos son el extremo amplio.
  if (
    timeValue(next.endsAt, Number.POSITIVE_INFINITY) >
    timeValue(current.endsAt, Number.POSITIVE_INFINITY)
  ) {
    return true
  }
  if (
    timeValue(next.startsAt, Number.NEGATIVE_INFINITY) <
    timeValue(current.startsAt, Number.NEGATIVE_INFINITY)
  ) {
    return true
  }

  // Métodos de pago: `null` es "todos". Agregar uno, o pasar a null, ensancha
  // CÓMO se canjea.
  const currentMethods = current.paymentMethods
  const nextMethods = next.paymentMethods
  if (nextMethods === null && currentMethods !== null) return true
  if (nextMethods !== null && currentMethods !== null) {
    if (nextMethods.some((m) => !currentMethods.includes(m))) return true
  }

  return false
}

/**
 * Cuántos días tarda una campaña en drenar con el cupo diario.
 *
 * `Math.ceil` y no `floor`: 16 destinatarios son dos días, no uno. Con cero
 * destinatarios son cero días, no uno — una campaña vacía no se manda.
 */
export function campaignDaysNeeded(willSend: number, budget = CAMPAIGN_DAILY_BUDGET): number {
  if (willSend <= 0) return 0
  return Math.ceil(willSend / budget)
}

/**
 * La fecha del último mail de la campaña, en `YYYY-MM-DD`.
 *
 * Se formatea en la zona del LOCAL y no en UTC: el dueño la va a comparar a ojo
 * con el vencimiento del cupón, y una fecha corrida un día en esa comparación es
 * exactamente el error que el bloqueo de §5.10.3.1 existe para evitar. (El
 * PRESUPUESTO en cambio se cuenta en UTC, porque la cuota que se raciona es la
 * de Resend. Son dos relojes distintos a propósito.)
 */
export function campaignLastSendDate(
  willSend: number,
  timeZone: string,
  from: Date = new Date(),
  budget = CAMPAIGN_DAILY_BUDGET,
): string {
  const days = campaignDaysNeeded(willSend, budget)
  const last = new Date(from.getTime())
  last.setUTCDate(last.getUTCDate() + Math.max(days - 1, 0))
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(last)
}
