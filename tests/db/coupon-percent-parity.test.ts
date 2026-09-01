import { describe, expect, it } from 'vitest'
import { percentOfCentsDown } from '@/lib/money'
import { dbAvailable, sql } from './helpers'

/**
 * Paridad TS/SQL del descuento porcentual de un cupón — mismo patrón que
 * `reserved-slugs-parity.test.ts` (comparar la fuente de verdad de Postgres
 * contra su espejo en TypeScript), pero acá los dos lados son una FÓRMULA, no
 * una lista.
 *
 * `percentOfCentsDown()` (`src/lib/money.ts`) vive escrita DOS veces a
 * propósito, igual que `ALLOWED_TRANSITIONS`: una en TypeScript, para mostrar
 * el descuento antes de comprar, y otra adentro de `public.create_order`
 * (`supabase/migrations/20260901130000_cupones.sql`), como
 * `(v_subtotal * v_coupon.percent) / 100` con división entera de Postgres,
 * que es la que efectivamente cobra. Si las dos alguna vez divergieran —por
 * ejemplo, alguien "mejora" el redondeo de un lado con `Math.round` o
 * `ceil`— un cupón que la cotización le muestra al cliente como aplicable
 * pasaría la pre-validación de `validateCouponForCart` y `create_order` lo
 * rechazaría igual con `CPN09` (`coupon_amount_mismatch`) al confirmar, y el
 * cliente vería un error después de haber "aceptado" el precio.
 *
 * El caso citado en la migración: 15% de 833333 es 124999.95, que trunca a
 * 124999 con floor/división entera. Un `Math.ceil` ingenuo daría 125000, que
 * es exactamente el número que `create_order` rechazaría.
 */
describe.skipIf(!dbAvailable)('percentOfCentsDown() (TypeScript) ↔ (subtotal * percent) / 100 (Postgres)', () => {
  function pgPercentOfCentsDown(cents: number, percent: number): number {
    // bigint * int / int, división entera nativa — el mismo tipo de aritmética
    // que corre dentro de create_order sobre v_subtotal (bigint) y
    // v_coupon.percent (int).
    return Number(sql(`select (${cents}::bigint * ${percent}::int) / 100;`))
  }

  const pairs: Array<[cents: number, percent: number, label: string]> = [
    [833333, 15, 'el caso citado en la migración: 124999, no 125000 (un ceil rebotaría con CPN09)'],
    [100000, 10, 'división exacta, sin resto: 10000'],
    [99999, 10, 'con resto: 9999.9 → 9999'],
    [1, 1, 'el descuento más chico posible sobre el subtotal más chico posible: floor(0.01) = 0'],
    [100, 1, '1% de $1: floor(1) = 1, sin resto'],
    [500000, 100, '100%: el subtotal entero, 500000'],
    [500001, 99, 'percent en el extremo alto con resto: floor(495000.99) = 495000'],
    [123456789, 33, 'un monto grande (más de un millón de pesos) sin perder precisión en ninguno de los dos lados'],
    [999999999, 7, 'un monto muy grande con resto feo: floor(69999999.93) = 69999999'],
    [7, 50, 'un subtotal chico con resto: floor(3.5) = 3'],
  ]

  for (const [cents, percent, label] of pairs) {
    it(`${cents} centavos al ${percent}% — ${label}`, () => {
      const fromTs = percentOfCentsDown(cents, percent)
      const fromPg = pgPercentOfCentsDown(cents, percent)
      expect(fromTs).toBe(fromPg)
    })
  }

  it('el caso citado explícitamente: floor da 124999, y un ceil (que create_order NO usa) daría 125000', () => {
    expect(percentOfCentsDown(833333, 15)).toBe(124999)
    expect(Math.ceil((833333 * 15) / 100)).toBe(125000) // lo que create_order rechazaría con CPN09 si TS redondeara para arriba
  })
})
