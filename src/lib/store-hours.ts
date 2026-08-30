import { zonedDay, zonedDayStart } from '@/lib/dates'
import { canCollectPayment, canTakeOrders } from '@/lib/store-availability'
import type { Store, StoreHoursRange, StoreSchedule, StorefrontGate } from '@/models/types'

/**
 * El almanaque de un local: patrón semanal + excepciones por fecha.
 *
 * Puro y SIN `server-only`, a propósito — mismo precedente que
 * `src/lib/delivery.ts`: la función que pinta "cerrado" en el browser tiene
 * que ser la MISMA que valida en el servidor. Dos implementaciones del mismo
 * almanaque es cómo el cliente ve "abierto" y el servidor contesta "cerrado".
 *
 * Reutiliza `zonedDay`/`zonedDayStart` de `src/lib/dates.ts`: ya resuelven el
 * offset de la zona con dos pasadas (aguanta DST) y no hay motivo para
 * reescribir esa aritmética acá.
 */

/** Cada cuánto se ofrece un horario para programar. */
export const SCHEDULE_STEP_MINUTES = 15
/** Hasta cuántos días adelante se puede programar. Ventana corta a propósito:
 *  el precio de un ítem se congela en `order_items.unit_price_cents` recién al
 *  crear el pedido, así que un slot lejano sería un precio viejo esperando a
 *  cobrarse. */
export const SCHEDULE_HORIZON_DAYS = 3
/** Piso de anticipación PLANO, sin fórmula de prep + delivery (decisión de
 *  producto, 2026-08-29). Un carrito pesado con envío puede necesitar más de
 *  60 minutos reales; el `fire_at` resultante queda en el pasado y el pedido
 *  entra al KDS en el próximo poll — "ya vas tarde, arrancá" es la
 *  recuperación correcta, no un bug. No lo conviertas en una fórmula. */
export const SCHEDULE_LEAD_MINUTES = 60

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Cuántos días hacia atrás puede seguir "vivo" un rango que arrancó ese día.
 *
 * `opens_at_minute` llega hasta 1439 y `duration_minutes` hasta 1440 (los dos
 * CHECK de la migración), así que un rango puede extenderse casi 48 h después
 * de que arrancó su día. Mirar solo "ayer" alcanza para el caso real (vie
 * 18:00–02:00) pero no para ese extremo representable, así que se revisan hoy
 * y los DOS días anteriores.
 */
const LOOKBACK_DAYS = 2

type EffectiveRange = Pick<StoreHoursRange, 'opensAtMinute' | 'durationMinutes'>

/** 0 = domingo … 6 = sábado, la convención de `Date#getDay()` — igual que
 *  `StoreHoursRange.dayOfWeek`. Se calcula en UTC porque un día calendario
 *  (`YYYY-MM-DD`) tiene el mismo día de la semana sin importar la zona. */
function dayOfWeekOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, date ?? 1)).getUTCDay()
}

/**
 * Suma (o resta) días de CALENDARIO a un `YYYY-MM-DD`, con aritmética pura de
 * fecha — nunca de instante.
 *
 * Es la pieza que le faltaba a la traversal de días de acá abajo (hallazgo
 * m2 de `03-review.md`): sumar/restar `DAY_MS` en milisegundos y volver a
 * preguntarle la fecha a `zonedDay()` asume que un día dura exactamente 24 h
 * reales, lo cual es falso en cualquier zona CON cambio de horario — un día
 * de transición dura 23 o 25. Argentina no tiene DST desde 2009 y es el único
 * mercado del producto hoy, así que el bug es mudo en producción, pero esta
 * lib es genérica a propósito (mismo motivo que `zoneOffsetMs` en
 * `src/lib/dates.ts` "no debería depender de que Argentina no tenga DST").
 *
 * Un `YYYY-MM-DD` es un objeto de CALENDARIO, no un instante: sumarle días no
 * necesita saber nada de zonas horarias, así que esta función no hace ninguna
 * conversión — mismo truco que `dayOfWeekOf`. El instante real de cada día
 * candidato se resuelve aparte, con `zonedDayStart(day, timeZone)` (que sí
 * hace el cálculo de offset con la técnica de dos pasadas de `dates.ts`).
 */
function addCalendarDays(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, (month ?? 1) - 1, (date ?? 1) + delta))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/**
 * Los rangos que rigen un día local puntual: el override de esa fecha si
 * existe (reemplaza el patrón ENTERO, cerrado o con rangos propios), o si no
 * el patrón semanal filtrado por día.
 */
function effectiveRangesForDay(data: StoreSchedule, day: string): EffectiveRange[] {
  const override = data.overrides.find((o) => o.date === day)
  if (override) return override.isClosed ? [] : override.ranges

  const dayOfWeek = dayOfWeekOf(day)
  return data.weekly.filter((r) => r.dayOfWeek === dayOfWeek)
}

/**
 * Los días candidatos a revisar para un instante: hoy y `LOOKBACK_DAYS` hacia
 * atrás. Una sola conversión instante→calendario (`zonedDay(instant, ...)`
 * para "hoy") y el resto es aritmética de fecha pura (`addCalendarDays`): no
 * hay ninguna resta de milisegundos entre medio que dependa de que el día
 * dure 24 h reales.
 */
function candidateDays(instant: Date, timeZone: string): string[] {
  const today = zonedDay(instant, timeZone)
  const days: string[] = [today]
  for (let i = 1; i <= LOOKBACK_DAYS; i++) days.push(addCalendarDays(today, -i))
  return days
}

/** El rango (de hoy o de un día anterior que cruza medianoche) que contiene el instante, si hay alguno. */
function findContainingRange(
  data: StoreSchedule,
  instant: Date,
  timeZone: string,
): { day: string; range: EffectiveRange } | null {
  for (const day of candidateDays(instant, timeZone)) {
    const dayStart = zonedDayStart(day, timeZone)
    for (const range of effectiveRangesForDay(data, day)) {
      const start = dayStart.getTime() + range.opensAtMinute * 60_000
      const end = start + range.durationMinutes * 60_000
      if (instant.getTime() >= start && instant.getTime() < end) return { day, range }
    }
  }
  return null
}

/**
 * ¿Está abierto en este instante? Sin filas semanales = SIEMPRE abierta: es la
 * compatibilidad hacia atrás, ninguna tienda existente tiene horarios cargados
 * y ninguna puede amanecer cerrada por este deploy.
 *
 * Revisa el día local del instante Y los anteriores (`LOOKBACK_DAYS`), porque
 * un rango se ancla al día que ABRE: "vie 18:00–02:00" es una fila del
 * viernes, y hay que poder decir que el sábado a la 01:30 sigue abierto.
 */
export function isOpenAt(data: StoreSchedule, instant: Date, timeZone: string): boolean {
  if (data.weekly.length === 0) return true
  return findContainingRange(data, instant, timeZone) !== null
}

/**
 * El día local en que ABRE el rango que contiene al instante. Siempre-abierta
 * (o cerrado en este instante, sin ningún rango que lo contenga) devuelve el
 * día calendario local — es la noche/día por defecto cuando no hay un rango
 * real del que colgar la respuesta.
 */
export function commercialNightOf(data: StoreSchedule, instant: Date, timeZone: string): string {
  if (data.weekly.length === 0) return zonedDay(instant, timeZone)
  const found = findContainingRange(data, instant, timeZone)
  return found ? found.day : zonedDay(instant, timeZone)
}

/**
 * La próxima apertura desde `from`, dentro de `SCHEDULE_HORIZON_DAYS`. `null`
 * si la tienda es siempre-abierta (no hay "apertura" que anunciar) o si no
 * hay ningún rango que arranque en la ventana.
 *
 * A diferencia de `isOpenAt`/`commercialNightOf`, acá NO hace falta mirar
 * hacia atrás: un rango que ya empezó no es una apertura "próxima".
 */
export function nextOpening(data: StoreSchedule, from: Date, timeZone: string): Date | null {
  if (data.weekly.length === 0) return null

  const horizonEnd = from.getTime() + SCHEDULE_HORIZON_DAYS * DAY_MS
  let day = zonedDay(from, timeZone)
  let dayStart = zonedDayStart(day, timeZone)
  let best: number | null = null

  // Cada vuelta resuelve `dayStart` DE NUEVO con `zonedDayStart(day,
  // timeZone)` en vez de acumular `+ DAY_MS` sobre el instante anterior (m2 de
  // `03-review.md`): avanzar el día con `addCalendarDays` es aritmética de
  // fecha pura, y `zonedDayStart` es quien de verdad resuelve el offset de la
  // zona (con la técnica de dos pasadas de `dates.ts`) para ESE día puntual.
  // Sumar milisegundos y volver a preguntar la fecha asumía que todo día dura
  // 24 h reales, lo cual es falso en una zona con cambio de horario.
  while (dayStart.getTime() <= horizonEnd) {
    for (const range of effectiveRangesForDay(data, day)) {
      const start = dayStart.getTime() + range.opensAtMinute * 60_000
      if (start >= from.getTime() && start <= horizonEnd && (best === null || start < best)) {
        best = start
      }
    }
    day = addCalendarDays(day, 1)
    dayStart = zonedDayStart(day, timeZone)
  }

  return best === null ? null : new Date(best)
}

/** Redondea un instante hacia ARRIBA al múltiplo de `stepMinutes` siguiente,
 *  en minutos de PARED de la zona (no en ms crudos de UTC): son la misma
 *  cuenta salvo que el offset de la zona no sea múltiplo de `stepMinutes`, y
 *  esto es correcto en cualquier caso. */
function roundUpToStepLocal(instant: Date, timeZone: string, stepMinutes: number): Date {
  const day = zonedDay(instant, timeZone)
  const dayStart = zonedDayStart(day, timeZone)
  const minuteOfDay = (instant.getTime() - dayStart.getTime()) / 60_000
  const roundedMinute = Math.ceil(minuteOfDay / stepMinutes) * stepMinutes
  return new Date(dayStart.getTime() + roundedMinute * 60_000)
}

/**
 * Los instantes programables desde `from`: cada `SCHEDULE_STEP_MINUTES`,
 * arrancando en `from + opts.leadMinutes` redondeado hacia arriba al próximo
 * :00/:15/:30/:45 LOCAL, hasta `SCHEDULE_HORIZON_DAYS`. Devuelve INSTANTES
 * (UTC), nunca horas de pared: la conversión pared↔instante ocurre acá adentro
 * una sola vez, así que nadie más tiene que reimplementarla.
 *
 * `opts.excludeNights` saca TODOS los slots de esa noche comercial entera —
 * la noche llena se cierra entera, no slot por slot.
 */
export function scheduleSlots(
  data: StoreSchedule,
  from: Date,
  timeZone: string,
  opts: { leadMinutes: number; excludeNights?: string[] },
): Date[] {
  const horizonEnd = from.getTime() + SCHEDULE_HORIZON_DAYS * DAY_MS
  const stepMs = SCHEDULE_STEP_MINUTES * 60_000
  const firstCandidate = roundUpToStepLocal(new Date(from.getTime() + opts.leadMinutes * 60_000), timeZone, SCHEDULE_STEP_MINUTES)

  const slots: Date[] = []
  for (let t = firstCandidate.getTime(); t <= horizonEnd; t += stepMs) {
    const instant = new Date(t)
    if (!isOpenAt(data, instant, timeZone)) continue
    if (opts.excludeNights?.length) {
      const night = commercialNightOf(data, instant, timeZone)
      if (opts.excludeNights.includes(night)) continue
    }
    slots.push(instant)
  }
  return slots
}

/**
 * La noche comercial "actual": si está abierto ahora, la del rango en curso;
 * si está cerrado, la del próximo que abre. Es lo que "pausar pedidos"
 * necesita para saber qué noche barrer (§7.8.1) — sin apertura futura en la
 * ventana (o siempre-abierta, ya cubierto por `isOpenAt`), cae al día
 * calendario local.
 */
export function currentCommercialNight(data: StoreSchedule, now: Date, timeZone: string): string {
  if (isOpenAt(data, now, timeZone)) return commercialNightOf(data, now, timeZone)
  const opening = nextOpening(data, now, timeZone)
  if (!opening) return zonedDay(now, timeZone)
  return commercialNightOf(data, opening, timeZone)
}

/** Minuto de cierre de un rango (`opens + duration`), en el reloj de 24 h del
 *  día siguiente si cruza medianoche. `(opens + duration) % 1440`. */
export function rangeCloseMinute(range: Pick<StoreHoursRange, 'opensAtMinute' | 'durationMinutes'>): number {
  return (range.opensAtMinute + range.durationMinutes) % 1440
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function minuteToLabel(minute: number): string {
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`
}

/**
 * La advertencia del editor de horarios (Q1): sin "última orden" derivada —se
 * aceptan pedidos hasta el minuto EXACTO de cierre—, así que un pedido que
 * entra justo antes de cerrar sale después de la hora de cierre si la cocina
 * tarda. Una entrada por rango, para que la UI la muestre al lado de cada uno
 * mientras el dueño edita.
 */
export type LastOrderWarning = {
  dayOfWeek: number
  /** "23:30". Puede ser "00:15" si el rango cruza medianoche. */
  closesAtLabel: string
  /** "23:54": la hora de cierre + el `prep_minutes` más lento real de la carta. */
  lastOrderOutLabel: string
}

export function lastOrderWarning(data: StoreSchedule, maxPrepMinutes: number, timeZone: string): LastOrderWarning[] {
  // La aritmética es sobre MINUTOS LOCALES (`opensAtMinute`/`durationMinutes`
  // ya lo son por definición), así que no hace falta resolver ningún instante
  // real. `timeZone` queda en la firma para no divergir del contrato fijado
  // en `01-tasks.md` (que T4 llama con los tres argumentos), aunque no
  // participe del cálculo.
  void timeZone

  return data.weekly.map((range) => {
    const closeMinute = rangeCloseMinute(range)
    return {
      dayOfWeek: range.dayOfWeek,
      closesAtLabel: minuteToLabel(closeMinute),
      lastOrderOutLabel: minuteToLabel((closeMinute + maxPrepMinutes) % 1440),
    }
  })
}

/**
 * El gate real de la vitrina, con horarios sumados a `canTakeOrders()`
 * (`src/lib/store-availability.ts`, que NO cambia de firma ni de significado).
 *
 * La precedencia es la del propio tipo `StorefrontGate` en `types.ts`: la
 * primera que aplica define la pantalla. `paused` gana sobre `closed_by_hours`
 * a propósito — el dueño que apaga el local espera que se apague TODO, y un
 * pedido que igual entra para el viernes rompe esa confianza.
 */
export function storefrontGate(
  store: Pick<Store, 'status' | 'acceptingOrders' | 'inStorePaymentEnabled' | 'onlinePaymentEnabled'>,
  data: StoreSchedule,
  now: Date,
  timeZone: string,
): StorefrontGate {
  if (store.status !== 'active') return { kind: 'suspended' }

  if (!canTakeOrders(store)) {
    if (!canCollectPayment(store)) return { kind: 'no_payment' }
    return { kind: 'paused' }
  }

  if (!isOpenAt(data, now, timeZone)) {
    const opening = nextOpening(data, now, timeZone)
    return { kind: 'closed_by_hours', opensAt: opening ? opening.toISOString() : null }
  }

  return { kind: 'open' }
}
