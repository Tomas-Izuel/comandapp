import { describe, expect, it } from 'vitest'
import { dbAvailable, expectSqlToFail, inTransaction, uniqueSlug } from './helpers'

/**
 * La máquina de estados del pedido, ahora en Postgres (`private.enforce_order_rules`,
 * trigger `orders_enforce_rules` en `orders`), para TODOS los roles —
 * `service_role` incluido. Se corre como `postgres` (superusuario, mismos
 * privilegios que `service_role`) para probar que la invariante es del
 * DOMINIO, no un permiso: nadie puede saltearla, ni el propio servidor con un
 * bug. Antes el CHECK de la tabla solo validaba que el estado EXISTIERA, no
 * que se pudiera LLEGAR ahí (`delivered -> pending` era legal), y el webhook
 * de Mercado Pago hacía un update sin predicado de estado, así que un pago
 * tardío podía resucitar un pedido cancelado (P-03).
 */
describe.skipIf(!dbAvailable)('máquina de estados del pedido — private.enforce_order_rules', () => {
  function makeOrder(opts: { status: string; paymentMethod?: string; paymentStatus?: string }) {
    const { status, paymentMethod = 'online', paymentStatus = 'approved' } = opts
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('sm')}', 'Tienda SM', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, '${status}', 'Cliente', '+5491100000000', gen_random_uuid()::text, '${paymentMethod}', '${paymentStatus}', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  describe('los estados terminales lo son incluso para service_role (P-03)', () => {
    it('delivered -> cualquier otro estado falla', () => {
      expectSqlToFail(
        [...makeOrder({ status: 'delivered' }), `update public.orders set status = 'confirmed' where id = :order_id;`].join('\n'),
        /transicion de estado ilegal.*delivered -> confirmed/,
      )
    })

    it('cancelled -> cualquier otro estado falla', () => {
      expectSqlToFail(
        [...makeOrder({ status: 'cancelled' }), `update public.orders set status = 'preparing' where id = :order_id;`].join('\n'),
        /transicion de estado ilegal.*cancelled -> preparing/,
      )
    })
  })

  it('un salto que se saltea etapas (pending -> delivered) falla', () => {
    expectSqlToFail(
      [...makeOrder({ status: 'pending' }), `update public.orders set status = 'delivered' where id = :order_id;`].join('\n'),
      /transicion de estado ilegal.*pending -> delivered/,
    )
  })

  it('un paso atrás dentro de la cocina (ready -> preparing) está permitido', () => {
    const out = inTransaction(
      ...makeOrder({ status: 'ready' }),
      `update public.orders set status = 'preparing' where id = :order_id;`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out).toBe('preparing')
  })

  it('un pedido online con el pago todavía pending no puede pasar a confirmed', () => {
    expectSqlToFail(
      [
        ...makeOrder({ status: 'pending', paymentMethod: 'online', paymentStatus: 'pending' }),
        `update public.orders set status = 'confirmed' where id = :order_id;`,
      ].join('\n'),
      // El mensaje nombra el método desde 20260831120000_transferencia_bancaria:
      // el predicado del trigger pasó de `= 'online'` a `<> 'in_store'`, así que
      // el error tiene que decir CUÁL de los métodos impagos rebotó.
      /es de pago online y todavia no esta pago/,
    )
  })

  it('el mismo pedido, una vez aprobado el pago, SÍ puede pasar a confirmed', () => {
    const out = inTransaction(
      ...makeOrder({ status: 'pending', paymentMethod: 'online', paymentStatus: 'pending' }),
      `update public.orders set payment_status = 'approved' where id = :order_id;`,
      `update public.orders set status = 'confirmed' where id = :order_id;`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out).toBe('confirmed')
  })

  /**
   * Transferencia bancaria: el predicado pasó de `= 'online'` a
   * `<> 'in_store'` (20260831120000_transferencia_bancaria.sql), y ESTE es
   * el caso que la migración vino a cubrir — antes de este cambio, un
   * `payment_method = 'transfer'` no estaba enumerado en ningún lado del
   * trigger viejo y una transferencia impaga podría haber colado por un
   * costado que nadie pensó. Corre con el mismo `postgres` (= service_role):
   * el punto es que la versión de TypeScript (`updateOrderStatus`) se puede
   * saltear pegándole a PostgREST con la sesión del staff, y esta no.
   */
  it('un pedido por TRANSFERENCIA con el pago todavía pending no puede pasar a confirmed', () => {
    expectSqlToFail(
      [
        ...makeOrder({ status: 'pending', paymentMethod: 'transfer', paymentStatus: 'pending' }),
        `update public.orders set status = 'confirmed' where id = :order_id;`,
      ].join('\n'),
      /es de pago transfer y todavia no esta pago/,
    )
  })

  it('el mismo pedido por transferencia, una vez que payment_status pasa a approved (confirmTransferPayment), SÍ puede confirmarse', () => {
    const out = inTransaction(
      ...makeOrder({ status: 'pending', paymentMethod: 'transfer', paymentStatus: 'pending' }),
      `update public.orders set payment_status = 'approved' where id = :order_id;`,
      `update public.orders set status = 'confirmed' where id = :order_id;`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out).toBe('confirmed')
  })

  it('un pedido de pago en el local SÍ puede confirmarse impago (el cobro es presencial)', () => {
    const out = inTransaction(
      ...makeOrder({ status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
      `update public.orders set status = 'confirmed' where id = :order_id;`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out).toBe('confirmed')
  })

  describe('columnas inmutables del pedido', () => {
    const cases: Array<{ name: string; setClause: string }> = [
      { name: 'total_cents', setClause: 'total_cents = 1' },
      { name: 'subtotal_cents', setClause: 'subtotal_cents = 1' },
      { name: 'currency', setClause: "currency = 'USD'" },
      { name: 'public_token', setClause: "public_token = 'x'" },
      { name: 'idempotency_key', setClause: "idempotency_key = gen_random_uuid()::text" },
      { name: 'payment_method', setClause: "payment_method = 'in_store'" },
      { name: 'created_at', setClause: 'created_at = now() - interval \'1 day\'' },
    ]

    for (const { name, setClause } of cases) {
      it(`${name} rebota en un UPDATE`, () => {
        expectSqlToFail(
          [...makeOrder({ status: 'pending' }), `update public.orders set ${setClause} where id = :order_id;`].join('\n'),
          /columnas inmutables/,
        )
      })
    }

    // store_id es un caso aparte: para probar el intento hace falta una
    // SEGUNDA tienda a la que "mudar" el pedido.
    it('store_id rebota en un UPDATE', () => {
      expectSqlToFail(
        [
          ...makeOrder({ status: 'pending' }),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('sm-otra')}', 'Otra tienda', 'active') returning id \\gset otra_`,
          `update public.orders set store_id = :otra_id where id = :order_id;`,
        ].join('\n'),
        /columnas inmutables/,
      )
    })
  })
})
