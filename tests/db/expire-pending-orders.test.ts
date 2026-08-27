import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, uniqueSlug } from './helpers'

/**
 * P-04 — `expire_pending_orders`.
 *
 * El pedido se crea antes de pagar y la preferencia de Mercado Pago no
 * vencía, así que un `pending` abandonado quedaba vivo para siempre: ocupaba
 * `short_code`, inflaba la facturación (P-13) y aparecía como si fuera una
 * venta. Este cron cancela los viejos, pero con dos excepciones: uno que
 * tiene un pago aprobado registrado (si el webhook falló pero la plata
 * entró, eso lo resuelve la conciliación, no una cancelación) y uno
 * demasiado reciente para considerarlo abandonado.
 *
 * OJO: la función no filtra por tienda, así que corre sobre TODOS los
 * pedidos `pending` de la base — incluida la del usuario, dentro de esta
 * misma transacción que después se descarta. Por eso cada aserción es sobre
 * EL PEDIDO PROPIO por id, nunca sobre el valor de retorno global: ese
 * puede incluir pedidos `pending` reales que ya estaban ahí.
 */
describe.skipIf(!dbAvailable)('public.expire_pending_orders', () => {
  function store() {
    return [`insert into public.stores (slug, name, status) values ('${uniqueSlug('p04')}', 'Tienda P04', 'active') returning id \\gset store_`]
  }

  it('cancela un pedido online pending viejo y sin pago', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000, now() - interval '2 hours')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('cancelled')
  })

  it('no toca un pedido pending que ya tiene un pago approved registrado (lo resuelve la conciliación)', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000, now() - interval '2 hours')
       returning id \\gset order_`,
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'mercadopago', 'mp-p04-approved', 'approved', 1000);`,
      `select public.expire_pending_orders(45);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })

  it('no toca un pedido pending reciente (todavía no es abandono)', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000)
       returning id \\gset order_`,
      `select public.expire_pending_orders(45);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })

  it('no toca un pedido pending de pago en el local (el impago ahí es normal, no abandono)', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000, now() - interval '2 hours')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })
})
