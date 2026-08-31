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

  /**
   * Transferencia bancaria (`00-architecture.md` §5.10): la ventana propia es
   * de 120 minutos, más larga que la de online (45), porque el cliente tiene
   * que salir de la app, abrir el homebanking y volver. Se llama SIEMPRE con
   * los dos parámetros explícitos: `expire_pending_orders(45, 120)` — usar el
   * default de un solo argumento (`select expire_pending_orders(45)`) dejaría
   * el segundo en 120 igual (el default), así que estos tests fijan los dos a
   * propósito, para que quede documentado cuál es cuál.
   */
  it('cancela un pedido por TRANSFERENCIA viejo (> 120 min) y SIN comprobante', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000, now() - interval '3 hours')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45, 120);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('cancelled')
  })

  it('NO cancela un pedido por transferencia viejo que YA subió comprobante — hay plata declarada, la decide un humano', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at,
                                  transfer_receipt_path, transfer_receipt_uploaded_at, transfer_receipt_mime, transfer_receipt_size, transfer_receipt_sha256)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000, now() - interval '3 hours',
                 'x/1/comprobante', now() - interval '3 hours', 'image/jpeg', 1000, repeat('a', 64))
       returning id \\gset order_`,
      `select public.expire_pending_orders(45, 120);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })

  it('NO cancela un pedido por transferencia con un pago approved ya registrado (misma red que "online")', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000, now() - interval '3 hours')
       returning id \\gset order_`,
      `insert into public.payments (order_id, store_id, provider, provider_payment_id, status, amount_cents)
         values (:order_id, :store_id, 'transfer', 'order:expire-test', 'approved', 1000);`,
      `select public.expire_pending_orders(45, 120);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })

  it('NO cancela un pedido por transferencia sin comprobante que todavía es "reciente" (menos de 120 min) — la ventana propia, no la de online', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000, now() - interval '90 minutes')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45, 120);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('pending')
  })

  it('sigue cancelando un pedido ONLINE viejo a los 45 min, con la firma de dos parámetros — no-regresión', () => {
    const out = inTransaction(
      ...store(),
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000, now() - interval '2 hours')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45, 120);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('cancelled')
  })

  /**
   * Trampa de migración documentada en `00-architecture.md` §7.3 y en
   * `CLAUDE.md`: agregar un parámetro crea una SOBRECARGA, no reemplaza la
   * función — por eso la migración hace `drop function
   * public.expire_pending_orders(int)` explícito.
   *
   * OJO acá con un falso negativo: `select expire_pending_orders(45)` NO
   * sirve para probar esto, porque la función nueva de DOS parámetros con
   * default (`p_transfer_minutes int default 120`) acepta perfectamente una
   * llamada con un solo argumento — resolvería igual aunque la sobrecarga
   * vieja siguiera existiendo o no. La única forma real de probar que la
   * sobrecarga vieja fue dropeada es consultar el catálogo: tiene que haber
   * EXACTAMENTE UNA función con este nombre, y esa una tiene que ser la de
   * dos parámetros. Si el `drop function` de la migración se perdiera (por
   * ejemplo, reaplicando una migración vieja a mano), pg_cron seguiría
   * pudiendo resolver a una sobrecarga sin `p_transfer_minutes` y el barrido
   * de transferencias quedaría silenciosamente afuera.
   */
  it('existe UNA sola sobrecarga de expire_pending_orders, con los dos parámetros — la vieja de un solo argumento fue dropeada', () => {
    const out = inTransaction(
      `select count(*), max(pg_get_function_identity_arguments(oid))
         from pg_proc
        where proname = 'expire_pending_orders'
          and pronamespace = 'public'::regnamespace;`,
    )
    const [count, args] = out.split('|')
    expect(count).toBe('1')
    expect(args).toBe('p_minutes integer, p_transfer_minutes integer')
  })
})
