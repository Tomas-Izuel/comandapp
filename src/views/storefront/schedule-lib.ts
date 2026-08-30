import { formatDayShort, formatTime, todayInZone, zonedDay, zonedDayStart } from '@/lib/dates'
import { commercialNightOf, scheduleSlots } from '@/lib/store-hours'
import type { StoreSchedule } from '@/models/types'

/**
 * Fechas y turnos, del lado del CLIENTE de la vitrina.
 *
 * No viven en `src/lib/dates.ts` (de otro slice, formateadores genéricos de
 * fecha/hora) porque son específicos de "hablarle al cliente de un turno
 * programado": el nombre del día para un chip, el resumen de una próxima
 * apertura, la etiqueta de un pedido programado. Tres pantallas los
 * comparten (el aviso de cerrado, el selector del checkout y el
 * seguimiento), así que quedan acá en vez de tocarse tres veces.
 */

/**
 * Corre un día local N días, sin arrastrar el offset de DST del origen: se
 * pasa por el MEDIODÍA de ese día (nunca la medianoche) como colchón, para
 * que un salto de horario de verano de ±1h no lo empuje al día de al lado.
 */
function shiftLocalDay(day: string, timeZone: string, deltaDays: number): string {
  const noon = zonedDayStart(day, timeZone).getTime() + 12 * 60 * 60 * 1000
  return zonedDay(new Date(noon + deltaDays * 24 * 60 * 60 * 1000), timeZone)
}

/** "sábado" — mediodía local como instante de referencia, mismo motivo que `shiftLocalDay`. */
export function weekdayName(day: string, timeZone: string): string {
  const noon = new Date(zonedDayStart(day, timeZone).getTime() + 12 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'long' }).format(noon)
}

/** "Hoy" / "Mañana" / "Sábado" — la etiqueta de un chip de día del selector de horario. */
export function dayChipLabel(day: string, timeZone: string): string {
  const today = todayInZone(timeZone)
  if (day === today) return 'Hoy'
  if (day === shiftLocalDay(today, timeZone, 1)) return 'Mañana'
  const name = weekdayName(day, timeZone)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** "a las 21:00" / "el sábado a las 18:00" — resumen corto de una próxima apertura. */
export function formatOpensAtShort(opensAt: string, timeZone: string): string {
  const day = zonedDay(opensAt, timeZone)
  const today = todayInZone(timeZone)
  return day === today
    ? `a las ${formatTime(opensAt, timeZone)}`
    : `el ${weekdayName(day, timeZone)} a las ${formatTime(opensAt, timeZone)}`
}

/**
 * El aviso de dos líneas del `ClosedNotice` cuando `storefrontGate() ===
 * 'closed_by_hours'`. `opensAt` en `null` (sin apertura calculable dentro del
 * horizonte) degrada sin CTA: no hay ningún slot que ofrecer todavía.
 */
export function buildClosedSchedule(
  opensAt: string | null,
  timeZone: string,
  scheduleHref: string,
): { message: string; href: string | null } {
  if (!opensAt) {
    return { message: 'está cerrada ahora. Volvé a probar más tarde.', href: null }
  }
  const day = zonedDay(opensAt, timeZone)
  const today = todayInZone(timeZone)
  if (day === today) {
    return {
      message: `cierra por hoy — abre a las ${formatTime(opensAt, timeZone)}. Podés ver la carta y programar tu pedido.`,
      href: scheduleHref,
    }
  }
  return {
    message: `está cerrada ahora — abre el ${weekdayName(day, timeZone)} a las ${formatTime(opensAt, timeZone)}. Podés ver la carta y programar tu pedido para ese horario.`,
    href: scheduleHref,
  }
}

/** "hoy a las 21:30" / "el sábado 30/08 a las 21:30" — la hora pactada en el seguimiento de un programado. */
export function formatScheduledLabel(iso: string, timeZone: string): string {
  const day = zonedDay(iso, timeZone)
  const today = todayInZone(timeZone)
  if (day === today) return `hoy a las ${formatTime(iso, timeZone)}`
  return `el ${weekdayName(day, timeZone)} ${formatDayShort(day)} a las ${formatTime(iso, timeZone)}`
}

/**
 * Los turnos de una misma NOCHE COMERCIAL (`commercialNightOf`, no día
 * calendario): un rango que cruza la medianoche —"vie 18:00–02:00"— se ve
 * como un solo chip, no como dos días partidos por las 00:00.
 */
export type ScheduleSlotGroup = {
  night: string
  label: string
  /**
   * Vacío = esa noche llegó al tope de la tienda (`fullNights`). No hay un
   * campo `isFull` aparte a propósito: un grupo solo entra a la lista si
   * tuvo al menos un slot CRUDO (`buildScheduleGroups`), así que "vacío" y
   * "noche llena" son el MISMO estado con esta construcción — un segundo
   * campo redundante es la clase de dato que invita a alguien a asumir que
   * existe un tercer caso que nunca ocurre (revisar `schedule-picker.tsx`
   * antes de reabrir esto).
   */
  slots: Date[]
}

/**
 * Agrupa los turnos del horizonte para los chips de día del selector.
 *
 * Se calculan los slots CRUDOS (sin `excludeNights`) para poder seguir
 * mostrando el chip de una noche llena con su aviso en vez de que
 * desaparezca entera — es `fullNights` quien decide acá si esa noche se
 * pinta vacía, no `scheduleSlots`.
 */
export function buildScheduleGroups(params: {
  schedule: StoreSchedule
  from: Date
  timeZone: string
  leadMinutes: number
  fullNights: string[]
}): ScheduleSlotGroup[] {
  const { schedule, from, timeZone, leadMinutes, fullNights } = params
  const rawSlots = scheduleSlots(schedule, from, timeZone, { leadMinutes })
  const fullSet = new Set(fullNights)

  const byNight = new Map<string, Date[]>()
  for (const slot of rawSlots) {
    const night = commercialNightOf(schedule, slot, timeZone)
    const bucket = byNight.get(night)
    if (bucket) bucket.push(slot)
    else byNight.set(night, [slot])
  }

  return Array.from(byNight.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([night, slots]) => ({
      night,
      label: dayChipLabel(night, timeZone),
      slots: fullSet.has(night) ? [] : slots,
    }))
}
