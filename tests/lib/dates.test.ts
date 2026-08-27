import { describe, expect, it } from 'vitest'
import {
  formatDayShort,
  isCalendarDay,
  minutesSince,
  minutesUntil,
  todayInZone,
  zonedDay,
  zonedDayRange,
  zonedDayStart,
} from '@/lib/dates'

const BUE = 'America/Argentina/Buenos_Aires'
const NY = 'America/New_York'

describe('zonedDay — A-10: el día se calcula en la zona del local, no en UTC', () => {
  it('un pedido de las 22:30 en Buenos Aires pertenece al día anterior al que diría UTC', () => {
    // 2026-08-28T01:30Z es 2026-08-27 22:30 en Buenos Aires (UTC-3, sin DST).
    const iso = '2026-08-28T01:30:00.000Z'

    expect(iso.slice(0, 10)).toBe('2026-08-28') // lo que diría un `.slice` naive sobre UTC
    expect(zonedDay(iso, BUE)).toBe('2026-08-27') // lo que hay que mostrar de verdad
  })

  it('un pedido de la tarde cae el mismo día en UTC y en Buenos Aires', () => {
    const iso = '2026-08-27T15:00:00.000Z' // 12:00 local, lejos de cualquier borde
    expect(zonedDay(iso, BUE)).toBe('2026-08-27')
  })

  it('acepta también un objeto Date, no solo un string ISO', () => {
    const date = new Date('2026-08-28T01:30:00.000Z')
    expect(zonedDay(date, BUE)).toBe('2026-08-27')
  })
})

describe('todayInZone', () => {
  it('devuelve el mismo string que zonedDay(new Date(), tz)', () => {
    // No fijamos el reloj: alcanza con que las dos formas de calcular "hoy"
    // coincidan entre sí en el momento en que corre el test.
    expect(todayInZone(BUE)).toBe(zonedDay(new Date(), BUE))
  })
})

describe('zonedDayRange — el inicio es inclusivo y el final es exclusivo', () => {
  const { fromIso, toIso } = zonedDayRange('2026-08-27', BUE)

  it('el inicio del rango es la medianoche local en UTC (00:00 ART = 03:00Z)', () => {
    expect(fromIso).toBe('2026-08-27T03:00:00.000Z')
  })

  it('el final del rango es la medianoche siguiente (exclusiva)', () => {
    expect(toIso).toBe('2026-08-28T03:00:00.000Z')
  })

  it('un pedido a las 23:59:59 locales cae DENTRO del rango', () => {
    const justBeforeMidnight = new Date('2026-08-28T02:59:59.000Z') // 23:59:59 ART del 27
    const t = justBeforeMidnight.getTime()
    expect(t >= new Date(fromIso).getTime()).toBe(true)
    expect(t < new Date(toIso).getTime()).toBe(true)
  })

  it('un pedido a las 00:00:00 locales del día SIGUIENTE queda AFUERA del rango', () => {
    const nextMidnight = new Date('2026-08-28T03:00:00.000Z') // 00:00:00 ART del 28
    const t = nextMidnight.getTime()
    expect(t < new Date(toIso).getTime()).toBe(false) // no es estrictamente menor: no entra
    expect(t).toBe(new Date(toIso).getTime()) // es exactamente el borde exclusivo
  })
})

describe('zonedDayStart — zona con horario de verano (America/New_York)', () => {
  it('en enero (EST, UTC-5) la medianoche local es las 05:00 UTC', () => {
    expect(zonedDayStart('2026-01-15', NY).toISOString()).toBe('2026-01-15T05:00:00.000Z')
  })

  it('en julio (EDT, UTC-4) la medianoche local es las 04:00 UTC — el offset cambió', () => {
    expect(zonedDayStart('2026-07-15', NY).toISOString()).toBe('2026-07-15T04:00:00.000Z')
  })

  it('el offset de enero y de julio no es el mismo (por eso hacen falta las dos pasadas)', () => {
    const jan = zonedDayStart('2026-01-15', NY).getTime()
    const jul = zonedDayStart('2026-07-15', NY).getTime()
    // Misma hora local (medianoche) en dos fechas de offset distinto: la
    // diferencia en el instante UTC tiene que reflejar exactamente 1 hora de
    // corrimiento de DST además de los ~181 días de calendario.
    const days = (jul - jan) / (24 * 60 * 60 * 1000)
    expect(Number.isInteger(days)).toBe(false) // el salto de DST corre el instante 1h respecto de un día "parejo"
  })

  it('en Buenos Aires (sin DST) enero y julio comparten el mismo offset', () => {
    expect(zonedDayStart('2026-01-15', BUE).toISOString()).toBe('2026-01-15T03:00:00.000Z')
    expect(zonedDayStart('2026-07-15', BUE).toISOString()).toBe('2026-07-15T03:00:00.000Z')
  })
})

describe('formatDayShort', () => {
  it('formatea sin año, para ejes de gráfico ("26/08")', () => {
    // Sin zona a propósito: el argumento ya es un día local, y `Intl` con
    // `es-AR` devuelve "26/8" pese a pedirle `2-digit`, así que las etiquetas
    // del eje cambiaban de ancho.
    expect(formatDayShort('2026-08-26')).toBe('26/08')
    expect(formatDayShort('2026-01-05')).toBe('05/01')
  })
})

describe('isCalendarDay', () => {
  it('rechaza un 30 de febrero, que no existe', () => {
    expect(isCalendarDay('2026-02-30')).toBe(false)
  })

  it('rechaza el mes 13', () => {
    expect(isCalendarDay('2026-13-01')).toBe(false)
  })

  it('rechaza basura que ni siquiera tiene forma de fecha', () => {
    expect(isCalendarDay('basura')).toBe(false)
  })

  it('rechaza un string vacío', () => {
    expect(isCalendarDay('')).toBe(false)
  })

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(isCalendarDay('2024-02-29')).toBe(true)
  })

  it('rechaza el 29 de febrero de un año NO bisiesto', () => {
    expect(isCalendarDay('2026-02-29')).toBe(false)
  })

  it('acepta una fecha normal bien formada', () => {
    expect(isCalendarDay('2026-08-26')).toBe(true)
  })
})

describe('minutesSince — nunca negativo', () => {
  it('calcula los minutos transcurridos redondeando hacia abajo', () => {
    const now = Date.parse('2026-08-27T12:10:30.000Z')
    const iso = '2026-08-27T12:00:00.000Z' // 10:30 antes
    expect(minutesSince(iso, now)).toBe(10)
  })

  it('un instante en el FUTURO respecto de `now` da 0, no un número negativo', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z')
    const iso = '2026-08-27T12:05:00.000Z' // 5 minutos después de `now`
    expect(minutesSince(iso, now)).toBe(0)
  })

  it('el instante exacto da 0', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z')
    expect(minutesSince('2026-08-27T12:00:00.000Z', now)).toBe(0)
  })
})

describe('minutesUntil — nunca negativo', () => {
  it('calcula los minutos hasta un instante futuro redondeando hacia arriba', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z')
    const iso = '2026-08-27T12:04:01.000Z' // 4 minutos y 1 segundo después
    expect(minutesUntil(iso, now)).toBe(5)
  })

  it('un instante en el PASADO respecto de `now` da 0, no un número negativo', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z')
    const iso = '2026-08-27T11:55:00.000Z'
    expect(minutesUntil(iso, now)).toBe(0)
  })
})
