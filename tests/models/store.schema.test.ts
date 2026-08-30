import { describe, expect, it } from 'vitest'
import {
  storeHoursOverrideInputSchema,
  storeHoursRangeSchema,
  storeHoursWeeklyInputSchema,
  storeSettingsInputSchema,
} from '@/models/schemas/store.schema'

/**
 * S-01: reactivar/suspender una tienda y cambiar su slug es una decisión de
 * PLATAFORMA, no del local. `storeSettingsInputSchema` es la mitad de esa
 * regla del lado de Zod — la otra mitad son los GRANT revocados en Postgres.
 */
describe('storeSettingsInputSchema — el local no maneja su propio status ni su slug', () => {
  function valid() {
    return {
      name: 'La Birra',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      acceptingOrders: true,
      inStorePaymentEnabled: false,
      minOrderCents: 0,
      demandThresholdOrders: 5,
      demandMultiplier: 1.5,
    }
  }

  it('un input legítimo del panel "Mi local" pasa', () => {
    expect(storeSettingsInputSchema.safeParse(valid()).success).toBe(true)
  })

  it('S-01: si el staff manda status igual, el schema no lo deja pasar al objeto tipado', () => {
    const result = storeSettingsInputSchema.safeParse({ ...valid(), status: 'active' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('status')
    }
  })

  it('S-01: si el staff manda slug igual, el schema no lo deja pasar al objeto tipado', () => {
    const result = storeSettingsInputSchema.safeParse({ ...valid(), slug: 'secuestro-de-ruta' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('slug')
    }
  })

  it('demandMultiplier está acotado a 1..10: no hay multiplicador absurdo por error de tipeo', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandMultiplier: 0.5 }).success).toBe(false)
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandMultiplier: 11 }).success).toBe(false)
  })

  it('demandThresholdOrders tiene que ser al menos 1: umbral 0 dispararía el multiplicador siempre', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandThresholdOrders: 0 }).success).toBe(false)
  })

  it('minOrderCents no admite negativos', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), minOrderCents: -100 }).success).toBe(false)
  })

  it('un teléfono que no es E.164 falla', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), phoneE164: '011 5555-4444' }).success).toBe(false)
  })

  it('currency tiene que ser un código de 3 letras', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), currency: 'PESOS' }).success).toBe(false)
  })

  describe('scheduledDeliveryEnabled / scheduledCapacityPerNight (Q2/Q3)', () => {
    it('sin mandarlos, quedan en sus defaults: sin delivery programado y sin tope', () => {
      const result = storeSettingsInputSchema.safeParse(valid())
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.scheduledDeliveryEnabled).toBe(false)
        expect(result.data.scheduledCapacityPerNight).toBeNull()
      }
    })

    it('scheduledCapacityPerNight null es "sin tope" — un valor legítimo, no una ausencia', () => {
      const result = storeSettingsInputSchema.safeParse({ ...valid(), scheduledCapacityPerNight: null })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.scheduledCapacityPerNight).toBeNull()
    })

    it('scheduledCapacityPerNight en 0 falla: un tope de 0 no es "sin tope", es "nunca"', () => {
      expect(storeSettingsInputSchema.safeParse({ ...valid(), scheduledCapacityPerNight: 0 }).success).toBe(false)
    })

    it('scheduledCapacityPerNight negativo falla', () => {
      expect(storeSettingsInputSchema.safeParse({ ...valid(), scheduledCapacityPerNight: -1 }).success).toBe(false)
    })
  })
})

/**
 * `storeHoursWeeklyInputSchema` / `storeHoursOverrideInputSchema` validan LO
 * MISMO que las RPC `set_store_hours` / `set_store_hours_override`
 * (`20260829140000_scheduled_orders_and_hours.sql`), duplicado a propósito: la
 * base es la autoridad final, el schema solo adelanta un mensaje legible antes
 * de gastar el viaje de red. Cada caso de acá tiene su espejo en
 * `tests/db/scheduled-orders-and-hours.test.ts`, que prueba que la RPC
 * rechaza lo mismo de verdad (no solo Zod).
 */
describe('storeHoursRangeSchema — un rango de apertura', () => {
  function range(overrides: Record<string, unknown> = {}) {
    return { dayOfWeek: 5, opensAtMinute: 1080, durationMinutes: 480, ...overrides } // viernes 18:00, 8h (cruza medianoche)
  }

  it('un rango válido, incluso uno que cruza medianoche, pasa (la codificación opens+duration es inambigua)', () => {
    expect(storeHoursRangeSchema.safeParse(range()).success).toBe(true)
  })

  it('dayOfWeek fuera de 0..6 falla', () => {
    expect(storeHoursRangeSchema.safeParse(range({ dayOfWeek: 7 })).success).toBe(false)
    expect(storeHoursRangeSchema.safeParse(range({ dayOfWeek: -1 })).success).toBe(false)
  })

  it('opensAtMinute en el borde superior (1439, 23:59) es válido; 1440 no', () => {
    expect(storeHoursRangeSchema.safeParse(range({ opensAtMinute: 1439 })).success).toBe(true)
    expect(storeHoursRangeSchema.safeParse(range({ opensAtMinute: 1440 })).success).toBe(false)
  })

  it('durationMinutes por debajo de 15 falla (mismo piso que el CHECK de la tabla)', () => {
    expect(storeHoursRangeSchema.safeParse(range({ durationMinutes: 14 })).success).toBe(false)
    expect(storeHoursRangeSchema.safeParse(range({ durationMinutes: 15 })).success).toBe(true)
  })

  it('durationMinutes en el techo (1440, 24hs) es válido; 1441 no', () => {
    expect(storeHoursRangeSchema.safeParse(range({ durationMinutes: 1440 })).success).toBe(true)
    expect(storeHoursRangeSchema.safeParse(range({ durationMinutes: 1441 })).success).toBe(false)
  })
})

describe('storeHoursWeeklyInputSchema — la semana entera que reemplaza set_store_hours', () => {
  function rangeAt(dayOfWeek: number, opensAtMinute: number, durationMinutes = 60) {
    return { dayOfWeek, opensAtMinute, durationMinutes }
  }

  it('un array vacío es válido: es "sin horarios cargados" (siempre abierta)', () => {
    expect(storeHoursWeeklyInputSchema.safeParse([]).success).toBe(true)
  })

  it('hasta 4 rangos en el MISMO día pasan; un quinto rechaza', () => {
    const fourSameDay = [0, 1, 2, 3].map((i) => rangeAt(1, i * 100, 50))
    expect(storeHoursWeeklyInputSchema.safeParse(fourSameDay).success).toBe(true)

    const fiveSameDay = [...fourSameDay, rangeAt(1, 900, 50)]
    expect(storeHoursWeeklyInputSchema.safeParse(fiveSameDay).success).toBe(false)
  })

  it('28 rangos en total (4 por cada uno de los 7 días) pasan; un rango 29 rechaza', () => {
    const twentyEight = Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 4 }, (_, i) => rangeAt(day, i * 100, 50)),
    ).flat()
    expect(twentyEight.length).toBe(28)
    expect(storeHoursWeeklyInputSchema.safeParse(twentyEight).success).toBe(true)

    // El 29 no puede sumarse a un día que ya tiene 4 (rebotaría por esa regla
    // antes), así que se agrega repitiendo un día 0 con un rango de más — el
    // total sube a 29 mientras el máximo POR DÍA se mantiene en el borde.
    const twentyNine = [...twentyEight, rangeAt(0, 950, 30)]
    expect(storeHoursWeeklyInputSchema.safeParse(twentyNine).success).toBe(false)
  })

  it('dos rangos que se superponen el mismo día rechazan', () => {
    const overlapping = [rangeAt(2, 600, 120), rangeAt(2, 660, 60)] // 10:00-12:00 y 11:00-12:00: se pisan
    const result = storeHoursWeeklyInputSchema.safeParse(overlapping)
    expect(result.success).toBe(false)
    expect(result.success ? '' : JSON.stringify(result.error.issues)).toMatch(/superpon/i)
  })

  it('dos rangos consecutivos, sin pisarse (uno termina exactamente cuando el otro arranca), pasan — el corte del mediodía', () => {
    const backToBack = [rangeAt(2, 480, 240), rangeAt(2, 720, 240)] // 08:00-12:00 y 12:00-16:00
    expect(storeHoursWeeklyInputSchema.safeParse(backToBack).success).toBe(true)
  })

  it('el solapamiento CIRCULAR de la semana se detecta: sábado 22:00-02:00(+1) choca con domingo 01:00', () => {
    // sábado(6) 22:00, dura 4h -> cruza a domingo 02:00 de la MISMA semana que
    // arranca (el rango pertenece al día que abre). Un rango de domingo(0) que
    // arranca a la 01:00 cae DENTRO de esa ventana — pero en la recta numérica
    // simple (día*1440+minuto) sábado(6*1440=8640) y domingo(0*1440=0) están
    // lejísimos: sin el desplazamiento +10080 que hace circular la semana
    // (tratar "este domingo" como si fuera el día 7), el solapamiento real
    // pasaría desapercibido.
    const circular = [rangeAt(6, 1320, 240), rangeAt(0, 60, 30)] // sáb 22:00+4h, dom 01:00-01:30
    const result = storeHoursWeeklyInputSchema.safeParse(circular)
    expect(result.success).toBe(false)
  })

  it('el mismo par, pero SIN que se toquen (domingo arranca después de que el sábado cerró), pasa', () => {
    const noOverlap = [rangeAt(6, 1320, 240), rangeAt(0, 150, 30)] // sáb 22:00-02:00, dom 02:30 en más
    expect(storeHoursWeeklyInputSchema.safeParse(noOverlap).success).toBe(true)
  })

  it('mensaje en castellano cuando hay solapamiento, ANTES de gastar el viaje a la RPC', () => {
    const overlapping = [rangeAt(3, 0, 100), rangeAt(3, 50, 100)]
    const result = storeHoursWeeklyInputSchema.safeParse(overlapping)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/superpon/i)
  })
})

describe('storeHoursOverrideInputSchema — una excepción por fecha (Q13/Q14)', () => {
  function closed(date = '2026-12-25') {
    return { date, isClosed: true, ranges: [] }
  }
  function open(date = '2026-12-24', ranges = [{ opensAtMinute: 600, durationMinutes: 120 }]) {
    return { date, isClosed: false, ranges }
  }

  it('cerrado con ranges vacío pasa (la forma que el CHECK de la tabla exige)', () => {
    expect(storeHoursOverrideInputSchema.safeParse(closed()).success).toBe(true)
  })

  it('cerrado CON rangos propios rechaza: "una fecha cerrada no lleva rangos propios"', () => {
    const result = storeHoursOverrideInputSchema.safeParse({ ...closed(), ranges: [{ opensAtMinute: 0, durationMinutes: 60 }] })
    expect(result.success).toBe(false)
  })

  it('abierto con al menos un rango pasa', () => {
    expect(storeHoursOverrideInputSchema.safeParse(open()).success).toBe(true)
  })

  it('abierto SIN ningún rango rechaza: "una fecha abierta necesita al menos un rango"', () => {
    const result = storeHoursOverrideInputSchema.safeParse(open('2026-12-24', []))
    expect(result.success).toBe(false)
  })

  it('rangos que se superponen dentro de la MISMA fecha rechazan (chequeo lineal, la fecha no se repite)', () => {
    const result = storeHoursOverrideInputSchema.safeParse(
      open('2026-12-24', [
        { opensAtMinute: 600, durationMinutes: 120 },
        { opensAtMinute: 650, durationMinutes: 60 },
      ]),
    )
    expect(result.success).toBe(false)
  })

  it('una fecha con formato inválido (no YYYY-MM-DD) rechaza', () => {
    expect(storeHoursOverrideInputSchema.safeParse({ ...closed(), date: '25-12-2026' }).success).toBe(false)
  })

  it('hasta 4 rangos en la fecha pasan; un quinto rechaza', () => {
    const four = [0, 1, 2, 3].map((i) => ({ opensAtMinute: i * 100, durationMinutes: 50 }))
    expect(storeHoursOverrideInputSchema.safeParse(open('2026-12-24', four)).success).toBe(true)
    const five = [...four, { opensAtMinute: 900, durationMinutes: 50 }]
    expect(storeHoursOverrideInputSchema.safeParse(open('2026-12-24', five)).success).toBe(false)
  })
})
