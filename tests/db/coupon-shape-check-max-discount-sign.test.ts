import { describe, expect, it } from 'vitest'
import { dbAvailable, sql, uniqueSlug } from './helpers'

/**
 * HALLAZGO — `docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md`,
 * "Hallazgo 4 — MENOR": `coupons_shape_check` no valida el SIGNO de
 * `max_discount_cents` cuando `discount_type = 'percentage'`. El CHECK exige
 * `percent between 1 and 100` y `amount_off_cents is null`, pero deja pasar
 * cualquier valor de `max_discount_cents` que no sea `null` — incluido cero o
 * negativo.
 *
 * `couponInputSchema` (Zod) ya exige `.positive()`, así que hoy no es
 * alcanzable desde la app — pero `service_role` bypasea Zod, y es
 * precisamente el tipo de invariante que este repo pone en Postgres por eso
 * mismo. Con un `max_discount_cents` negativo, `create_order` calcula
 * `least(v_discount, v_coupon.max_discount_cents)`, el resultado negativo
 * sobrevive el `least(v_discount, v_subtotal)` de abajo (un subtotal
 * no-negativo no achica un descuento ya negativo), y explota contra el CHECK
 * crudo `coupon_redemptions.discount_cents >= 0` con un `23514` sin traducir
 * — exactamente lo que el resto de esta migración se esmera en evitar con
 * los marcadores `CPN0x`.
 *
 * Este test documenta el hallazgo, no lo tapa: afirma el comportamiento
 * CORRECTO (rechazar en el CHECK de forma) y por eso queda FALLANDO a
 * propósito hasta que se corrija `coupons_shape_check` en la migración
 * (agregar `and (max_discount_cents is null or max_discount_cents > 0)` en
 * la rama `percentage`). No se toca `supabase/migrations/**` para arreglarlo:
 * el schema es del hilo principal.
 */
describe.skipIf(!dbAvailable)('HALLAZGO — coupons_shape_check no valida el signo de max_discount_cents', () => {
  function insertCoupon(storeSlug: string, maxDiscountCents: number): string {
    return [
      `insert into public.stores (slug, name, status) values ('${storeSlug}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.coupons (store_id, name, code, discount_type, percent, min_subtotal_cents, max_redemptions, max_discount_cents)
         values (:store_id, 'Test', 'HALLAZGO1', 'percentage', 10, 0, 10, ${maxDiscountCents})
       returning id;`,
    ].join('\n')
  }

  it('un max_discount_cents NEGATIVO debería rechazarse en el CHECK de forma — hoy entra (bug real, ver 03-review.md Hallazgo 4)', () => {
    let message: string | null = null
    try {
      sql(['begin;', insertCoupon(uniqueSlug('hallazgo4-neg'), -500), 'rollback;'].join('\n'))
    } catch (err) {
      message = (err as Error).message
    }

    // Comportamiento CORRECTO: debería fallar acá, con
    // coupons_shape_check. Comportamiento REAL (hoy): no falla, y el bug se
    // difiere hasta el primer create_order que use este cupón, donde explota
    // como un 23514 crudo sobre coupon_redemptions.discount_cents en vez de
    // un error legible al crear/editar el cupón.
    expect(message, 'coupons_shape_check debería rechazar max_discount_cents negativo, y hoy no lo hace').not.toBeNull()
  })

  it('un max_discount_cents en CERO debería rechazarse igual (un tope de $0 no es un tope, es "sin descuento")', () => {
    let message: string | null = null
    try {
      sql(['begin;', insertCoupon(uniqueSlug('hallazgo4-zero'), 0), 'rollback;'].join('\n'))
    } catch (err) {
      message = (err as Error).message
    }

    expect(message, 'coupons_shape_check debería rechazar max_discount_cents = 0, y hoy no lo hace').not.toBeNull()
  })
})
