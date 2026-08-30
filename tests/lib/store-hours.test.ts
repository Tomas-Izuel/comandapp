import { describe, expect, it } from 'vitest'
import { zonedDay, zonedDayStart } from '@/lib/dates'
import {
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_LEAD_MINUTES,
  SCHEDULE_STEP_MINUTES,
  commercialNightOf,
  currentCommercialNight,
  isOpenAt,
  lastOrderWarning,
  nextOpening,
  rangeCloseMinute,
  scheduleSlots,
  storefrontGate,
} from '@/lib/store-hours'
import type { Store, StoreHoursOverride, StoreHoursRange, StoreSchedule } from '@/models/types'

/**
 * `src/lib/store-hours.ts` es puro y barato de probar: acá es donde más se
 * paga un off-by-one (CLAUDE.md/AGENTS.md lo marcan explícitamente), así que
 * cada guarda tiene su caso "justo antes" y "justo después" del borde, no solo
 * un caso cómodo del medio.
 *
 * Buenos Aires (`BUE`) no tiene horario de verano hoy: usarla como zona fija
 * evita que un cambio de DST real mueva las fechas de este archivo con el
 * tiempo. Los días de referencia están anclados a un jueves conocido
 * (2026-01-08) para poder razonar el día de la semana a mano.
 */
const BUE = 'America/Argentina/Buenos_Aires'

// 2026-01-08 es JUEVES (día 4, Date#getDay()). A partir de acá:
const THU = '2026-01-08' // jueves
const FRI = '2026-01-09' // viernes
const SAT = '2026-01-10' // sábado
const TUE = '2026-01-06' // martes (sin ningún rango en los fixtures de abajo)
const MON = '2026-01-05' // lunes

/** Instante UTC correspondiente a `hh:mm` LOCAL (zona `tz`) del día `day`. Se
 *  apoya en `zonedDayStart` (la misma pieza que usa la lib) para no
 *  reimplementar el offset a mano y arriesgar un segundo bug idéntico. */
function instantAt(day: string, hhmm: string, tz: string = BUE): Date {
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(zonedDayStart(day, tz).getTime() + (hh * 60 + mm) * 60_000)
}

function range(dayOfWeek: number, opensAtMinute: number, durationMinutes: number): StoreHoursRange {
  return { dayOfWeek, opensAtMinute, durationMinutes }
}

function schedule(weekly: StoreHoursRange[], overrides: StoreHoursOverride[] = []): StoreSchedule {
  return { weekly, overrides }
}

// Viernes 18:00 a 02:00 (del sábado) — el caso de referencia de CLAUDE.md: la
// norma de una hamburguesería, no un caso borde.
const FRIDAY_NIGHT = schedule([range(5, 18 * 60, 8 * 60)])

describe('isOpenAt', () => {
  describe('sin filas semanales = SIEMPRE abierta (compatibilidad hacia atrás)', () => {
    it('cualquier instante, con o sin overrides cargados, da abierto', () => {
      const empty = schedule([])
      expect(isOpenAt(empty, instantAt(TUE, '03:00'), BUE)).toBe(true)
      expect(isOpenAt(empty, instantAt(SAT, '23:59'), BUE)).toBe(true)
    })
  })

  describe('cruce de medianoche — viernes 18:00–02:00', () => {
    it('viernes 18:00 en punto: ABIERTO (borde de apertura, inclusive)', () => {
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(FRI, '18:00'), BUE)).toBe(true)
    })

    it('viernes 17:59: CERRADO (un minuto antes de abrir)', () => {
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(FRI, '17:59'), BUE)).toBe(false)
    })

    it('sábado 01:59: ABIERTO — el bug clásico: mirar solo "hoy" y no el rango de ayer que cruza', () => {
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(SAT, '01:59'), BUE)).toBe(true)
    })

    it('sábado 02:00 en punto: CERRADO (borde de cierre, exclusivo)', () => {
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(SAT, '02:00'), BUE)).toBe(false)
    })

    it('sábado a la tarde: CERRADO (el rango del viernes ya terminó y no hay uno propio del sábado)', () => {
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(SAT, '15:00'), BUE)).toBe(false)
    })
  })

  describe('varios rangos el mismo día — el corte del mediodía', () => {
    // Miércoles (día 3): 08:00-12:00 y 13:00-22:00.
    const lunchBreak = schedule([range(3, 8 * 60, 4 * 60), range(3, 13 * 60, 9 * 60)])
    const WED = '2026-01-07'

    it('12:30 (en el hueco del mediodía): cerrado', () => {
      expect(isOpenAt(lunchBreak, instantAt(WED, '12:30'), BUE)).toBe(false)
    })

    it('09:00 (dentro del primer rango): abierto', () => {
      expect(isOpenAt(lunchBreak, instantAt(WED, '09:00'), BUE)).toBe(true)
    })

    it('13:30 (dentro del segundo rango): abierto', () => {
      expect(isOpenAt(lunchBreak, instantAt(WED, '13:30'), BUE)).toBe(true)
    })
  })

  describe('overrides por fecha ganan sobre el patrón semanal, en las dos direcciones', () => {
    it('cierra un día que el patrón dice abierto', () => {
      const withOverride = schedule(FRIDAY_NIGHT.weekly, [{ date: FRI, isClosed: true, ranges: [] }])
      expect(isOpenAt(withOverride, instantAt(FRI, '20:00'), BUE)).toBe(false)
    })

    it('abre un día que el patrón dice cerrado', () => {
      // El patrón semanal solo tiene el viernes: el lunes está cerrado por defecto.
      const withOverride = schedule(FRIDAY_NIGHT.weekly, [
        { date: MON, isClosed: false, ranges: [{ opensAtMinute: 10 * 60, durationMinutes: 60 }] },
      ])
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(MON, '10:30'), BUE)).toBe(false) // sin override, cerrado
      expect(isOpenAt(withOverride, instantAt(MON, '10:30'), BUE)).toBe(true) // con override, abierto
    })

    it('el override REEMPLAZA el patrón entero de esa fecha, no lo combina: un override angosto en viernes cierra el horario habitual de las 18:00', () => {
      const narrowOverride = schedule(FRIDAY_NIGHT.weekly, [
        { date: FRI, isClosed: false, ranges: [{ opensAtMinute: 23 * 60, durationMinutes: 3 * 60 }] }, // solo 23:00-02:00
      ])
      // Sin el override, 18:30 estaría abierto (patrón semanal). Con el
      // override, el patrón de ESE día se ignora entero.
      expect(isOpenAt(FRIDAY_NIGHT, instantAt(FRI, '18:30'), BUE)).toBe(true)
      expect(isOpenAt(narrowOverride, instantAt(FRI, '18:30'), BUE)).toBe(false)
      expect(isOpenAt(narrowOverride, instantAt(FRI, '23:30'), BUE)).toBe(true)
    })

    it('un override que cruza medianoche afecta la madrugada del día siguiente, igual que el patrón semanal', () => {
      // `weekly` no puede quedar vacío para este caso: "vacío" es un atajo
      // aparte ("siempre abierta, ni con overrides") que se prueba solo,
      // más abajo. Acá el patrón es de un día que no interfiere (lunes), para
      // aislar el efecto del override sobre viernes/sábado.
      const overrideCrossing = schedule([range(1, 0, 60)], [
        { date: FRI, isClosed: false, ranges: [{ opensAtMinute: 23 * 60, durationMinutes: 3 * 60 }] }, // vie 23:00-02:00
      ])
      expect(isOpenAt(overrideCrossing, instantAt(SAT, '01:30'), BUE)).toBe(true)
      expect(isOpenAt(overrideCrossing, instantAt(SAT, '02:30'), BUE)).toBe(false)
    })

    it('weekly VACÍO ignora cualquier override: "sin patrón" no tiene nada que overridear (decisión explícita, no un olvido)', () => {
      const emptyWithOverride = schedule([], [{ date: TUE, isClosed: true, ranges: [] }])
      // Un override "cerrado" normalmente ganaría — pero sin ningún rango
      // semanal de base, `isOpenAt` corta antes de mirar los overrides.
      expect(isOpenAt(emptyWithOverride, instantAt(TUE, '12:00'), BUE)).toBe(true)
    })
  })

  it('evaluado en la zona del LOCAL, nunca en otra: el mismo instante da resultados distintos en dos zonas distintas', () => {
    // 2026-01-10T03:00Z es sábado 00:00 en Buenos Aires (UTC-3) — adentro del
    // rango "viernes 18:00-02:00" (18:00 vie a 02:00 sáb, hora BUE). El MISMO
    // instante leído con la zona del PROCESO en UTC puro cae sábado 03:00 —
    // ya pasadas las 02:00 en que ese mismo rango, anclado al reloj UTC,
    // cierra. Es justo el bug que en Vercel (proceso en UTC) aparecería solo
    // en producción si `isOpenAt` mirara la zona del proceso en vez de la que
    // se le pasa explícitamente.
    const instant = new Date('2026-01-10T03:00:00.000Z')
    expect(isOpenAt(FRIDAY_NIGHT, instant, BUE)).toBe(true)
    expect(isOpenAt(FRIDAY_NIGHT, instant, 'UTC')).toBe(false)
  })
})

describe('commercialNightOf — la noche COMERCIAL, no el día calendario', () => {
  it('sábado 01:30, dentro de "viernes 18:00–02:00", pertenece a la noche del VIERNES', () => {
    expect(commercialNightOf(FRIDAY_NIGHT, instantAt(SAT, '01:30'), BUE)).toBe(FRI)
  })

  it('un instante DENTRO del rango del viernes a la noche, antes de cruzar medianoche, también da viernes', () => {
    expect(commercialNightOf(FRIDAY_NIGHT, instantAt(FRI, '20:00'), BUE)).toBe(FRI)
  })

  it('cerrado en ese instante (sin ningún rango que lo contenga): cae al día calendario local', () => {
    expect(commercialNightOf(FRIDAY_NIGHT, instantAt(SAT, '15:00'), BUE)).toBe(SAT)
  })

  it('siempre-abierta (weekly vacío): la noche es el día calendario local', () => {
    expect(commercialNightOf(schedule([]), instantAt(TUE, '23:00'), BUE)).toBe(TUE)
  })
})

describe('currentCommercialNight — qué noche cancela "pausar pedidos" (Q4)', () => {
  it('abierto AHORA: la noche del rango en curso', () => {
    const now = instantAt(FRI, '19:00') // adentro del rango vie 18:00-02:00
    expect(currentCommercialNight(FRIDAY_NIGHT, now, BUE)).toBe(FRI)
  })

  it('cerrado ahora, con una apertura futura dentro del horizonte: la noche del PRÓXIMO rango que abre', () => {
    const now = instantAt(THU, '10:00') // jueves a la mañana, cerrado; abre el viernes 18:00
    expect(currentCommercialNight(FRIDAY_NIGHT, now, BUE)).toBe(FRI)
  })

  it('cerrado ahora y SIN ninguna apertura dentro del horizonte: cae al día calendario local (caso borde, no debe tirar)', () => {
    // El único rango cargado es el jueves 08:00-12:00; parado el jueves a la
    // tarde, la próxima vez que abre (el jueves siguiente) está a 7 días,
    // fuera de SCHEDULE_HORIZON_DAYS (3).
    const onlyThursdayMorning = schedule([range(4, 8 * 60, 4 * 60)])
    const now = instantAt(THU, '15:00')
    expect(currentCommercialNight(onlyThursdayMorning, now, BUE)).toBe(THU)
  })
})

describe('nextOpening', () => {
  it('siempre-abierta: null (no hay "apertura" que anunciar)', () => {
    expect(nextOpening(schedule([]), instantAt(TUE, '10:00'), BUE)).toBeNull()
  })

  it('encuentra la apertura correcta dentro del horizonte', () => {
    const opening = nextOpening(FRIDAY_NIGHT, instantAt(THU, '10:00'), BUE)
    expect(opening).not.toBeNull()
    expect(opening).toEqual(instantAt(FRI, '18:00'))
  })

  it('NO mira hacia atrás: un rango que ya empezó no es una apertura "próxima"', () => {
    // Parado adentro del rango del viernes a la noche, la próxima apertura NO
    // puede ser la de HOY (ya pasó) — tiene que buscar la del viernes que
    // viene, que cae fuera del horizonte de 3 días.
    const opening = nextOpening(FRIDAY_NIGHT, instantAt(FRI, '19:00'), BUE)
    expect(opening).toBeNull()
  })

  it('sin ninguna apertura dentro de SCHEDULE_HORIZON_DAYS: null', () => {
    const onlyThursdayMorning = schedule([range(4, 8 * 60, 4 * 60)])
    expect(nextOpening(onlyThursdayMorning, instantAt(THU, '15:00'), BUE)).toBeNull()
  })
})

describe('scheduleSlots', () => {
  it('granularidad de 15 minutos: la distancia entre slots consecutivos es siempre 15 min', () => {
    const slots = scheduleSlots(schedule([]), instantAt(TUE, '10:00'), BUE, { leadMinutes: SCHEDULE_LEAD_MINUTES })
    expect(slots.length).toBeGreaterThan(1)
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime() - slots[i - 1].getTime()).toBe(SCHEDULE_STEP_MINUTES * 60_000)
    }
  })

  it('el primer slot respeta el lead: nada antes de from + leadMinutes', () => {
    const from = instantAt(TUE, '10:03') // no alineado a un múltiplo de 15
    const slots = scheduleSlots(schedule([]), from, BUE, { leadMinutes: 60 })
    const earliestAllowed = from.getTime() + 60 * 60_000
    expect(slots[0].getTime()).toBeGreaterThanOrEqual(earliestAllowed)
    // Y no se pasa de más de un paso completo del redondeo hacia arriba.
    expect(slots[0].getTime() - earliestAllowed).toBeLessThan(SCHEDULE_STEP_MINUTES * 60_000)
  })

  it('ningún slot va más allá de SCHEDULE_HORIZON_DAYS', () => {
    const from = instantAt(TUE, '10:00')
    const slots = scheduleSlots(schedule([]), from, BUE, { leadMinutes: 60 })
    const horizonEnd = from.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 60 * 60_000
    for (const slot of slots) expect(slot.getTime()).toBeLessThanOrEqual(horizonEnd)
  })

  it('ningún slot cae fuera de un rango abierto (respeta isOpenAt, overrides incluidos)', () => {
    const slots = scheduleSlots(FRIDAY_NIGHT, instantAt(THU, '10:00'), BUE, { leadMinutes: 60 })
    for (const slot of slots) expect(isOpenAt(FRIDAY_NIGHT, slot, BUE)).toBe(true)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('un rango que cruza medianoche genera slots de los DOS lados de las 00:00', () => {
    const slots = scheduleSlots(FRIDAY_NIGHT, instantAt(THU, '10:00'), BUE, { leadMinutes: 60 })
    const beforeMidnight = slots.some((s) => zonedDay(s, BUE) === FRI && s.getTime() < instantAt(SAT, '00:00').getTime())
    const afterMidnight = slots.some((s) => zonedDay(s, BUE) === SAT && s.getTime() < instantAt(SAT, '02:00').getTime())
    expect(beforeMidnight).toBe(true)
    expect(afterMidnight).toBe(true)
  })

  it('excludeNights saca TODOS los slots de esa noche entera, no slot por slot', () => {
    const withoutExclusion = scheduleSlots(FRIDAY_NIGHT, instantAt(THU, '10:00'), BUE, { leadMinutes: 60 })
    const friNightSlots = withoutExclusion.filter((s) => commercialNightOf(FRIDAY_NIGHT, s, BUE) === FRI)
    expect(friNightSlots.length).toBeGreaterThan(0) // hay algo que excluir, si no el test no probaría nada

    const excluded = scheduleSlots(FRIDAY_NIGHT, instantAt(THU, '10:00'), BUE, {
      leadMinutes: 60,
      excludeNights: [FRI],
    })
    expect(excluded.some((s) => commercialNightOf(FRIDAY_NIGHT, s, BUE) === FRI)).toBe(false)
  })

  it('devuelve INSTANTES (objetos Date reales), no horas de pared con formato propio', () => {
    const slots = scheduleSlots(schedule([]), instantAt(TUE, '10:00'), BUE, { leadMinutes: 60 })
    expect(slots[0]).toBeInstanceOf(Date)
    expect(typeof slots[0].toISOString()).toBe('string')
  })
})

describe('rangeCloseMinute', () => {
  it('un rango que NO cruza medianoche: cierre normal', () => {
    expect(rangeCloseMinute({ opensAtMinute: 8 * 60, durationMinutes: 4 * 60 })).toBe(12 * 60)
  })

  it('un rango que cruza medianoche: el módulo 1440 lo trae al reloj de 24hs del día siguiente', () => {
    // 22:00 + 4h = 26:00 => 02:00
    expect(rangeCloseMinute({ opensAtMinute: 22 * 60, durationMinutes: 4 * 60 })).toBe(2 * 60)
  })
})

describe('lastOrderWarning — Q1: sin "última orden" derivada, se avisa el efecto', () => {
  it('cierre 23:30 + 25 min de cocción real ⇒ el último pedido posible (justo al cierre) sale 23:55', () => {
    const closesAt2330 = schedule([range(5, 8 * 60, (23 * 60 + 30 - 8 * 60))]) // abre 08:00, cierra 23:30
    const [warning] = lastOrderWarning(closesAt2330, 25, BUE)
    expect(warning.closesAtLabel).toBe('23:30')
    expect(warning.lastOrderOutLabel).toBe('23:55')
  })

  it('el cierre + la cocción cruza la medianoche: la etiqueta envuelve a "00:xx" del día siguiente', () => {
    const closesLate = schedule([range(5, 8 * 60, (23 * 60 + 59 - 8 * 60))]) // cierra 23:59
    const [warning] = lastOrderWarning(closesLate, 30, BUE)
    expect(warning.lastOrderOutLabel).toBe('00:29')
  })

  it('una entrada POR RANGO, no un resumen único: dos rangos semanales dan dos entradas', () => {
    const twoRanges = schedule([range(5, 18 * 60, 8 * 60), range(1, 8 * 60, 4 * 60)])
    const warnings = lastOrderWarning(twoRanges, 10, BUE)
    expect(warnings).toHaveLength(2)
    expect(warnings.map((w) => w.dayOfWeek).sort()).toEqual([1, 5])
  })

  it('sin rangos semanales, no hay nada que advertir', () => {
    expect(lastOrderWarning(schedule([]), 20, BUE)).toEqual([])
  })
})

describe('storefrontGate — precedencia: suspended > no_payment > paused > closed_by_hours > open', () => {
  function baseStore(overrides: Partial<Store> = {}): Pick<
    Store,
    'status' | 'acceptingOrders' | 'inStorePaymentEnabled' | 'onlinePaymentEnabled'
  > {
    return {
      status: 'active',
      acceptingOrders: true,
      inStorePaymentEnabled: true,
      onlinePaymentEnabled: false,
      ...overrides,
    }
  }

  const OPEN_NOW = instantAt(FRI, '19:00') // adentro del rango vie 18:00-02:00
  // Jueves a la mañana: cerrado (el único rango es vie 18:00-02:00) pero CON
  // una apertura futura dentro del horizonte de 3 días (el viernes 18:00).
  // Un "cerrado" cuya próxima apertura cae MÁS ALLÁ del horizonte (p. ej. el
  // sábado a la tarde, cuando ya pasó el viernes de esta semana) daría
  // `opensAt: null` — caso real, pero no el que este bloque quiere aislar.
  const CLOSED_NOW = instantAt(THU, '10:00')

  it('tienda suspendida por la plataforma: "suspended", sin importar el resto', () => {
    const gate = storefrontGate(
      baseStore({ status: 'suspended', acceptingOrders: false, inStorePaymentEnabled: false, onlinePaymentEnabled: false }),
      FRIDAY_NIGHT,
      OPEN_NOW,
      BUE,
    )
    expect(gate.kind).toBe('suspended')
  })

  it('sin NINGÚN medio de pago: "no_payment", aunque esté aceptando pedidos y abierta por horario', () => {
    const gate = storefrontGate(
      baseStore({ inStorePaymentEnabled: false, onlinePaymentEnabled: false }),
      FRIDAY_NIGHT,
      OPEN_NOW,
      BUE,
    )
    expect(gate.kind).toBe('no_payment')
  })

  it('con medio de pago pero accepting_orders=false: "paused"', () => {
    const gate = storefrontGate(baseStore({ acceptingOrders: false }), FRIDAY_NIGHT, OPEN_NOW, BUE)
    expect(gate.kind).toBe('paused')
  })

  it('"paused" GANA sobre "closed_by_hours": si las dos aplican a la vez, no se ofrece programar', () => {
    const gate = storefrontGate(baseStore({ acceptingOrders: false }), FRIDAY_NIGHT, CLOSED_NOW, BUE)
    expect(gate.kind).toBe('paused')
  })

  it('todo bien salvo el horario: "closed_by_hours", con la próxima apertura adjunta', () => {
    const gate = storefrontGate(baseStore(), FRIDAY_NIGHT, CLOSED_NOW, BUE)
    expect(gate.kind).toBe('closed_by_hours')
    if (gate.kind === 'closed_by_hours') expect(gate.opensAt).toBe(instantAt(FRI, '18:00').toISOString())
  })

  it('todo en orden y dentro de horario: "open"', () => {
    const gate = storefrontGate(baseStore(), FRIDAY_NIGHT, OPEN_NOW, BUE)
    expect(gate.kind).toBe('open')
  })

  it('sin horarios cargados (weekly vacío), nunca da "closed_by_hours": siempre abierta', () => {
    const gate = storefrontGate(baseStore(), schedule([]), CLOSED_NOW, BUE)
    expect(gate.kind).toBe('open')
  })
})

describe('independencia de la zona del PROCESO — el resultado no puede depender de process.env.TZ', () => {
  it('el mismo cálculo da lo mismo con el proceso en UTC y con el proceso en la zona del local', () => {
    const originalTz = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      const withUtcProcess = isOpenAt(FRIDAY_NIGHT, instantAt(SAT, '01:30'), BUE)

      process.env.TZ = BUE
      const withLocalProcess = isOpenAt(FRIDAY_NIGHT, instantAt(SAT, '01:30'), BUE)

      // Es justo el bug que en Vercel (proceso en UTC) aparece solo en
      // producción: si `isOpenAt` mirara la zona del proceso en vez de la que
      // se le pasó, este test lo vería divergir acá mismo, sin desplegar nada.
      expect(withUtcProcess).toBe(true)
      expect(withLocalProcess).toBe(true)
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })
})
