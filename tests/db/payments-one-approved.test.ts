import { describe, expect, it } from 'vitest'
import { dbAvailable, expectSqlToFail, inTransaction, uniqueSlug } from './helpers'

/**
 * P-06 — un solo pago aprobado por pedido.
 *
 * Cada reintento del checkout creaba una preferencia nueva de Mercado Pago, y
 * nada impedía que un cliente con dos pestañas (o el navegador reintentando
 * con mala señal) pagara dos veces. `payments_one_approved_per_order_idx` es
 * un índice único parcial (`where status = 'approved'`) que hace ese doble
 * cobro imposible en la base: el segundo insert rebota con 23505 y la app lo
 * registra como `'duplicate'`.
 */
describe.skipIf(!dbAvailable)('payments_one_approved_per_order_idx', () => {
  function orderFixture() {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('p06')}', 'Tienda P06', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  it('dos pagos approved para el mismo pedido violan el índice único (23505)', () => {
    expectSqlToFail(
      [
        ...orderFixture(),
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'mercadopago', 'mp-approved-1', 'approved', 1000);`,
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'mercadopago', 'mp-approved-2', 'approved', 1000);`,
      ].join('\n'),
      /duplicate key value violates unique constraint "payments_one_approved_per_order_idx"/,
    )
  })

  it('un pago rechazado y uno aprobado del mismo pedido SÍ conviven (el índice es parcial)', () => {
    const out = inTransaction(
      ...orderFixture(),
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'mercadopago', 'mp-rejected-1', 'rejected', 1000);`,
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'mercadopago', 'mp-approved-1', 'approved', 1000);`,
      `select count(*) from public.payments where order_id = :order_id;`,
    )
    expect(out).toBe('2')
  })
})
