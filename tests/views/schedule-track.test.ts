import { describe, expect, it } from 'vitest'
import { computeWeekAxis, formatAxisHour, hourTicks } from '@/views/admin/ajustes/schedule-track'

/**
 * `computeWeekAxis` (00-architecture-horarios.md): lógica pura, sin Supabase
 * ni JSX, así que se testea barata acá en vez de necesitar un render. Recibe
 * la lista PLANA de rangos de toda la semana (sin `dayOfWeek`) y devuelve un
 * eje compartido por las siete pistas — los bordes que importan son
 * exactamente los que el brief nombra: semana vacía, span mínimo de 8h, y el
 * cruce de medianoche que hace que el eje se estire solo más allá de las 24.
 */
describe('computeWeekAxis', () => {
  function range(opensAtMinute: number, durationMinutes: number) {
    return { opensAtMinute, durationMinutes }
  }

  it('semana vacía → null (es el borde que resuelve el aviso de "siempre abierta", no un eje 00:00–24:00 clavado)', () => {
    expect(computeWeekAxis([])).toBeNull()
  })

  it('span mínimo de 8h: un rango corto de 1h no dibuja un eje degenerado que ocupa el 100% de la pista', () => {
    const axis = computeWeekAxis([range(600, 60)]) // 10:00–11:00
    expect(axis).not.toBeNull()
    expect(axis!.end - axis!.start).toBe(8)
    // Y el rango real (10:00–11:00) queda adentro del eje, no lo desborda.
    expect(axis!.start).toBeLessThanOrEqual(10)
    expect(axis!.end).toBeGreaterThanOrEqual(11)
  })

  it('BORDE: un rango de exactamente 8h no necesita padding — el eje es exactamente esas 8h, sin estirar', () => {
    const axis = computeWeekAxis([range(0, 480)]) // 00:00–08:00, 480min = 8h exactas
    expect(axis).toEqual({ start: 0, end: 8 })
  })

  it('BORDE: un rango de 9h (justo por encima del mínimo) NO se recorta a 8h — el eje refleja el dato real', () => {
    const axis = computeWeekAxis([range(0, 540)]) // 00:00–09:00
    expect(axis).toEqual({ start: 0, end: 9 })
  })

  it('cruce de medianoche: viernes 19:00–02:00 (durationMinutes=420 > lo que queda del día) estira el eje más allá de las 24, sin caso especial', () => {
    // Se combina con un rango temprano (lunes 08:00–16:00) para que el span
    // total ya supere las 8h por sí solo — así lo que empuja el eje a 26 es
    // el cruce de medianoche, no el padding del span mínimo.
    const axis = computeWeekAxis([range(480, 480), range(1140, 420)]) // lun 08:00–16:00, vie 19:00–02:00(+1)
    expect(axis).toEqual({ start: 8, end: 26 })
    expect(axis!.end).toBeGreaterThan(24)
  })

  it('un solo día con dos turnos (mañana y noche, sin cruzar medianoche) da un eje que cubre ambos', () => {
    const axis = computeWeekAxis([range(600, 240), range(1080, 240)]) // 10:00–14:00 y 18:00–22:00
    expect(axis).toEqual({ start: 10, end: 22 })
  })

  it('varios días con varios rangos: el eje toma el mínimo de todas las aperturas y el máximo de todos los cierres', () => {
    const ranges = [
      range(480, 240), // lunes 08:00–12:00
      range(780, 240), // lunes 13:00–17:00
      range(540, 300), // miércoles 09:00–14:00
      range(1140, 240), // viernes 19:00–23:00
    ]
    const axis = computeWeekAxis(ranges)
    expect(axis).toEqual({ start: 8, end: 23 })

    // Ningún segmento individual puede quedar fuera de [0, 100]% del eje —
    // es exactamente el tipo de eje degenerado o de porcentaje fuera de rango
    // que este cálculo tiene que evitar por construcción.
    for (const r of ranges) {
      const startHour = r.opensAtMinute / 60
      const endHour = startHour + r.durationMinutes / 60
      const left = ((startHour - axis!.start) / (axis!.end - axis!.start)) * 100
      const width = ((endHour - startHour) / (axis!.end - axis!.start)) * 100
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + width).toBeLessThanOrEqual(100)
    }
  })

  it('el eje se recalcula por completo con cada llamada — dos semanas distintas no se contaminan entre sí', () => {
    const first = computeWeekAxis([range(0, 60)])
    const second = computeWeekAxis([range(1200, 60)])
    expect(first).not.toEqual(second)
  })
})

describe('formatAxisHour', () => {
  it('una hora del eje que no cruzó las 24 se muestra como reloj de pared normal', () => {
    expect(formatAxisHour(9)).toBe('09:00')
    expect(formatAxisHour(13.5)).toBe('13:30')
  })

  it('BORDE: 24 exactas vuelven a 00:00 — es medianoche del día siguiente, no "las 24"', () => {
    expect(formatAxisHour(24)).toBe('00:00')
  })

  it('una hora del eje que SÍ superó las 24 (por el cruce de medianoche) se muestra como la hora real del día siguiente', () => {
    expect(formatAxisHour(26)).toBe('02:00') // viernes 19:00–02:00: el final del eje es "02:00", no "26:00"
  })
})

/**
 * `hourTicks` (T4, 2026-08-31): marcas de hora INTERNAS del eje, compartidas
 * por las siete pistas de `DayBar`. Los bordes que importan: el span mínimo
 * de 8h y cada escalón de `tickStepHours` (2h/3h/4h, no exportado —se prueba
 * por el efecto observable, la separación entre marcas consecutivas), que
 * las marcas nunca coincidan con `axis.start` ni `axis.end` (el marco de la
 * pista ya los señala; una marca ahí sería redundante y, peor, en el borde
 * derecho quedaría pegada al límite visual del rectángulo), y el cruce de
 * medianoche, que es el caso real donde el eje supera 24 y las marcas tienen
 * que seguir siendo válidas ahí.
 */
describe('hourTicks', () => {
  it('span mínimo (8h) usa paso de 2h y las marcas quedan estrictamente adentro', () => {
    const ticks = hourTicks({ start: 10, end: 18 })
    expect(ticks).toEqual([12, 14, 16])
  })

  it('BORDE: el start ya cae en un múltiplo exacto del paso — no se repite como marca', () => {
    // step=2h (span=8). ceil(8/2)*2 = 8 = axis.start: tiene que descartarse,
    // no aparecer dos veces "pegado" al borde izquierdo de la pista.
    const ticks = hourTicks({ start: 8, end: 16 })
    expect(ticks).not.toContain(8)
    expect(ticks).toEqual([10, 12, 14])
  })

  it('las marcas nunca son axis.end, ni siquiera cuando el span hace que caiga justo en un múltiplo del paso', () => {
    // step=2h (span=8): 8 sería el próximo múltiplo después de 6, pero es
    // exactamente axis.end — el marco de la pista ya lo señala.
    const ticks = hourTicks({ start: 0, end: 8 })
    expect(ticks).not.toContain(0)
    expect(ticks).not.toContain(8)
    expect(ticks).toEqual([2, 4, 6])
  })

  it('escalón bajo de tickStepHours: span de 10h (el límite) todavía usa 2h', () => {
    expect(hourTicks({ start: 0, end: 10 })).toEqual([2, 4, 6, 8])
  })

  it('BORDE: span de 11h (uno más que el límite anterior) pasa a 3h', () => {
    expect(hourTicks({ start: 0, end: 11 })).toEqual([3, 6, 9])
  })

  it('escalón medio de tickStepHours: span de 18h (el límite) todavía usa 3h', () => {
    expect(hourTicks({ start: 0, end: 18 })).toEqual([3, 6, 9, 12, 15])
  })

  it('BORDE: span de 19h (uno más que el límite anterior) pasa a 4h, para no amontonar marcas en una semana de jornadas largas', () => {
    expect(hourTicks({ start: 0, end: 19 })).toEqual([4, 8, 12, 16])
  })

  it('eje que cruza la medianoche (viernes 19:00–02:00, eje 8→26): las marcas siguen siendo válidas más allá de 24', () => {
    const axis = { start: 8, end: 26 } // mismo eje que produce el test de computeWeekAxis para este caso
    const ticks = hourTicks(axis)

    // Ninguna marca puede caer fuera de (start, end) — es la garantía que
    // vuelve segura la posición en % que `DayBar` calcula para cada una.
    for (const hour of ticks) {
      expect(hour).toBeGreaterThan(axis.start)
      expect(hour).toBeLessThan(axis.end)
    }
    // La medianoche (24) es una marca más entre las otras, y se muestra como
    // "00:00" (ver `formatAxisHour`), nunca como "24:00".
    expect(ticks).toContain(24)
    expect(formatAxisHour(24)).toBe('00:00')
  })
})
