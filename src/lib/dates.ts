/**
 * Fechas y horas EN LA ZONA DEL LOCAL.
 *
 * Había ocho formateadores ad hoc repartidos por las vistas y uno solo pasaba
 * `timeZone`. El resto imprimía en la zona del proceso —UTC en Vercel—, así que
 * un pedido de las 22:30 de Buenos Aires es 01:30Z del día siguiente: el
 * dashboard le movía el pico del viernes a la noche al sábado, el filtro "hoy"
 * del historial arrancaba a las 21:00 de ayer, y el tracking renderizado en el
 * servidor imprimía una hora distinta a la que hidrataba el cliente.
 *
 * Todo lo de acá exige `timeZone` explícito. No hay default a propósito: un
 * default es exactamente cómo volvería el bug.
 */

const LOCALE = 'es-AR'

/**
 * Cuánto se corre la zona respecto de UTC en ese instante, en milisegundos.
 *
 * Se formatea el instante en la zona destino y se lee como si fuera UTC: la
 * diferencia contra el instante original es el offset. Es la forma de hacerlo
 * sin `date-fns-tz` ni tablas de zonas propias, usando solo la base de datos
 * IANA que el runtime ya tiene.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const at = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)

  // Algunas versiones de ICU devuelven "24" para la medianoche.
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'))
  return asIfUtc - instant.getTime()
}

/**
 * Medianoche de un día local (`YYYY-MM-DD`) como instante UTC.
 *
 * Se resuelve en dos pasadas porque el offset puede cambiar justo en el borde
 * del día: la primera estimación puede caer del lado equivocado de un salto de
 * horario de verano. Argentina hoy no tiene DST, pero el código no debería
 * depender de eso.
 */
export function zonedDayStart(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const naive = Date.UTC(year, (month ?? 1) - 1, date ?? 1, 0, 0, 0, 0)

  let instant = naive - zoneOffsetMs(new Date(naive), timeZone)
  instant = naive - zoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** El día local (`YYYY-MM-DD`) al que pertenece un instante. */
export function zonedDay(iso: string | Date, timeZone: string): string {
  const instant = typeof iso === 'string' ? new Date(iso) : iso
  // `en-CA` da directamente YYYY-MM-DD, sin tener que reordenar partes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Hoy, en la zona del local. Es lo que tiene que usar el filtro "hoy". */
export function todayInZone(timeZone: string): string {
  return zonedDay(new Date(), timeZone)
}

/**
 * Los dos extremos UTC de un día local, listos para `gte`/`lt` contra
 * `created_at`. El final es EXCLUSIVO: usar `lte` con la medianoche siguiente
 * incluiría un pedido hecho exactamente a las 00:00 del día siguiente.
 */
export function zonedDayRange(day: string, timeZone: string): { fromIso: string; toIso: string } {
  const from = zonedDayStart(day, timeZone)
  const next = zonedDayStart(zonedDay(new Date(from.getTime() + 36 * 60 * 60 * 1000), timeZone), timeZone)
  return { fromIso: from.toISOString(), toIso: next.toISOString() }
}

/**
 * "26/08" — para ejes de gráficos, donde el año es ruido.
 *
 * No pasa por `Intl` a propósito, y no recibe zona: el argumento YA es un día
 * local (`YYYY-MM-DD`, tal como lo devuelve `store_dashboard`, que agrupa con
 * `at time zone`), así que convertirlo a instante y volver a formatearlo en la
 * misma zona es un viaje de ida y vuelta al mismo lugar.
 *
 * Además `Intl` con `es-AR` devuelve "26/8" —sin el cero— pese a pedirle
 * `2-digit`, así que las etiquetas del eje cambiaban de ancho entre un día de
 * un dígito y otro de dos, y la grilla saltaba.
 */
export function formatDayShort(day: string): string {
  const [, month, date] = day.split('-')
  return `${date ?? '??'}/${month ?? '??'}`
}

/** "22:35" */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** "26/08, 22:35" */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** "26 de agosto de 2026, 22:35" — para el historial y la auditoría. */
export function formatDateTimeLong(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * Minutos transcurridos desde un instante, sin negativos.
 *
 * No depende de la zona: una diferencia de instantes es la misma en cualquier
 * lado. Se separa igual para que nadie la reimplemente con `new Date()` suelto.
 */
export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
}

/** Minutos hasta un instante futuro; 0 si ya pasó. */
export function minutesUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000))
}

/** `true` si el string es un `YYYY-MM-DD` que existe en el calendario. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}
