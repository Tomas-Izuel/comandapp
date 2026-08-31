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

  /**
   * Transferencia bancaria (`00-architecture.md` §5.6): `markPaidByTransfer`
   * inserta con `provider = 'transfer'`. El índice único no distingue por
   * provider — es el mismo árbitro para los dos medios de pago que dejan
   * fila en `payments` — así que dos confirmaciones concurrentes del mismo
   * pedido por transferencia (dos operarios tocando "Confirmar pago" a la
   * vez) tienen que chocar acá igual que con Mercado Pago.
   */
  it('dos pagos approved de provider=transfer para el mismo pedido TAMBIÉN violan el índice (23505)', () => {
    expectSqlToFail(
      [
        ...orderFixture(),
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'transfer', 'order:1', 'approved', 1000);`,
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'transfer', 'order:1-retry', 'approved', 1000);`,
      ].join('\n'),
      /duplicate key value violates unique constraint "payments_one_approved_per_order_idx"/,
    )
  })

  it('un pago approved de mercadopago y uno de transfer para el MISMO pedido también chocan — el índice es por pedido, no por provider', () => {
    expectSqlToFail(
      [
        ...orderFixture(),
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'mercadopago', 'mp-approved-mix', 'approved', 1000);`,
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'transfer', 'order:mix', 'approved', 1000);`,
      ].join('\n'),
      /duplicate key value violates unique constraint "payments_one_approved_per_order_idx"/,
    )
  })
})

/**
 * `payments_provider_check` (migración de transferencia bancaria): el CHECK
 * pasó de no existir a `in ('mercadopago', 'transfer')`. Un typo en el
 * provider de una confirmación rompería el arqueo sin que nada avise — este
 * test es la red.
 */
describe.skipIf(!dbAvailable)('payments_provider_check', () => {
  function orderFixture() {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('p06-check')}', 'Tienda P06', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  it('acepta "transfer" como provider', () => {
    const out = inTransaction(
      ...orderFixture(),
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'transfer', 'order:check-ok', 'approved', 1000)
       returning provider;`,
    )
    expect(out).toBe('transfer')
  })

  it('sigue aceptando "mercadopago"', () => {
    const out = inTransaction(
      ...orderFixture(),
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'mercadopago', 'mp-check-ok', 'approved', 1000)
       returning provider;`,
    )
    expect(out).toBe('mercadopago')
  })

  it('rechaza cualquier otro valor', () => {
    expectSqlToFail(
      [
        ...orderFixture(),
        `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
           values (:order_id, :store_id, 'paypal', 'pp-1', 'approved', 1000);`,
      ].join('\n'),
      /payments_provider_check/,
    )
  })
})
