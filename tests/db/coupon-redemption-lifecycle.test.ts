import { describe, expect, it } from 'vitest'
import {
  asAnon,
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  sql,
  sqlConcurrentlySettled,
  uniqueSlug,
} from './helpers'

/**
 * `coupon_redemptions` — el libro mayor de reservas y canjes, y los tres
 * triggers que lo sostienen: `enforce_coupon_redemption` (el candado y el
 * off-by-one), `sync_coupon_counters` (los dos contadores, recalculados
 * desde acá y nunca incrementados) y `sync_coupon_reservation` (la
 * proyección del ciclo del pedido sobre el libro mayor).
 *
 * La creación real de un pedido con cupón (`public.create_order`, con su
 * propio candado redundante y sus propios SQLSTATE CPN01..CPN10) vive en
 * `coupon-create-order-discount.test.ts`. Acá se inserta directo en
 * `coupon_redemptions`/`orders` para poder ejercitar los triggers en
 * aislamiento, sin la capa extra de `create_order`.
 */
describe.skipIf(!dbAvailable)('coupon_redemptions — enforce_coupon_redemption, sync_coupon_counters, sync_coupon_reservation', () => {
  function storeFixture(prefix = 'cpn') {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda Cupón', 'active') returning id \\gset store_`,
    ]
  }

  function couponFixture(opts: {
    maxRedemptions: number
    maxRedemptionsPerPhone?: number | null
    status?: 'draft' | 'active' | 'paused'
    endsAtExpr?: string | null
    startsAtExpr?: string | null
    paymentMethodsLiteral?: string | null
    code?: string
    varPrefix?: string
  }) {
    const {
      maxRedemptions,
      maxRedemptionsPerPhone = null,
      status = 'active',
      endsAtExpr = null,
      startsAtExpr = null,
      paymentMethodsLiteral = null,
      code = 'CPNTEST1',
      varPrefix = 'coupon_',
    } = opts
    return [
      `insert into public.coupons (
         store_id, name, code, discount_type, percent, min_subtotal_cents,
         max_redemptions, max_redemptions_per_phone, payment_methods, status, starts_at, ends_at
       ) values (
         :store_id, 'Cupón Test', '${code}', 'percentage', 10, 0,
         ${maxRedemptions}, ${maxRedemptionsPerPhone === null ? 'null' : maxRedemptionsPerPhone},
         ${paymentMethodsLiteral ?? 'null'}, '${status}', ${startsAtExpr ?? 'null'}, ${endsAtExpr ?? 'null'}
       ) returning id \\gset ${varPrefix}`,
    ]
  }

  function orderFixture(
    varPrefix: string,
    opts: { status?: string; paymentMethod?: string; paymentStatus?: string; phone?: string } = {},
  ) {
    const { status = 'pending', paymentMethod = 'in_store', paymentStatus = 'pending', phone = '+5491100000000' } = opts
    return [
      `insert into public.orders (
         store_id, status, customer_name, customer_phone_e164, idempotency_key,
         payment_method, payment_status, subtotal_cents, total_cents
       ) values (
         :store_id, '${status}', 'Cliente', '${phone}', gen_random_uuid()::text,
         '${paymentMethod}', '${paymentStatus}', 1000, 1000
       ) returning id \\gset ${varPrefix}`,
    ]
  }

  function redemptionFixture(varPrefix: string, orderVar: string, opts: { couponVar?: string; phone?: string } = {}) {
    const { couponVar = 'coupon_id', phone = '+5491100000000' } = opts
    return [
      `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
       values (:store_id, :${couponVar}, :${orderVar}, '${phone}', 100) returning id \\gset ${varPrefix}`,
    ]
  }

  it('el off-by-one: un cupón de 2 usos acepta 2 reservas y la TERCERA da CPN05, no un 23514 crudo', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 2 }),
        ...orderFixture('order1_'),
        ...redemptionFixture('r1_', 'order1_id'),
        ...orderFixture('order2_'),
        ...redemptionFixture('r2_', 'order2_id'),
        ...orderFixture('order3_'),
        `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
         values (:store_id, :coupon_id, :order3_id, '+5491100000000', 100);`,
      ].join('\n'),
      /CPN05|el cupon se agoto/,
    )
  })

  it('la carrera del último uso, con concurrencia REAL: max_redemptions=1, 5 conexiones simultáneas, gana exactamente una', async () => {
    // Setup con COMMIT real: la concurrencia entre conexiones solo tiene
    // sentido sobre filas ya confirmadas, no dentro de una transacción que
    // ningún otro cliente puede ver todavía.
    const setup = sql(
      [
        'begin;',
        ...storeFixture('cpn-race'),
        ...couponFixture({ maxRedemptions: 1 }),
        ...orderFixture('o1_'),
        ...orderFixture('o2_'),
        ...orderFixture('o3_'),
        ...orderFixture('o4_'),
        ...orderFixture('o5_'),
        `select :store_id, :coupon_id, :o1_id, :o2_id, :o3_id, :o4_id, :o5_id;`,
        'commit;',
      ].join('\n'),
    )
    const [storeId, couponId, ...orderIds] = setup.split('|').map((v) => v.trim())

    try {
      const results = await sqlConcurrentlySettled(
        orderIds.map(
          (orderId, i) => `begin;
            insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
            values (${storeId}, ${couponId}, ${orderId}, '+549110000000${i}', 100)
            returning id;
          commit;`,
        ),
      )

      const wins = results.filter((r) => r.ok)
      const losses = results.filter((r) => !r.ok)
      expect(wins).toHaveLength(1)
      expect(losses).toHaveLength(orderIds.length - 1)
      for (const loss of losses) {
        expect(loss.ok).toBe(false)
        if (!loss.ok) expect(loss.error).toMatch(/CPN05|el cupon se agoto/)
      }

      const finalCount = sql(
        `select reserved_count, (select count(*) from public.coupon_redemptions where coupon_id = ${couponId} and status = 'reserved') from public.coupons where id = ${couponId};`,
      )
      expect(finalCount).toBe('1|1')
    } finally {
      sql(
        [
          `delete from public.coupon_redemptions where coupon_id = ${couponId};`,
          `delete from public.orders where store_id = ${storeId};`,
          `delete from public.coupons where id = ${couponId};`,
          `delete from public.stores where id = ${storeId};`,
        ].join('\n'),
      )
    }
  })

  it('coupons_within_cap_check no se viola ni escribiendo el contador directo (bypasseando el trigger) — la defensa real es el CHECK, no el trigger', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 1 }),
        ...orderFixture('order1_'),
        ...redemptionFixture('r1_', 'order1_id'),
        // Simula un camino futuro que tocara el contador a mano en vez de
        // dejar que `sync_coupon_counters` lo recalcule: reserved_count ya
        // está en 1 (max), forzarlo a 2 tiene que rebotar en el CHECK de la
        // SUMA, no en el trigger de inserción (que acá ni corre).
        `update public.coupons set reserved_count = reserved_count + 1 where id = :coupon_id;`,
      ].join('\n'),
      /coupons_within_cap_check/,
    )
  })

  it('el ciclo completo: reservar (pending) → confirmar la reserva cuando el pedido llega a delivered', () => {
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ maxRedemptions: 5 }),
      ...orderFixture('order_', { status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
      ...redemptionFixture('r_', 'order_id'),
      `update public.orders set status = 'confirmed' where id = :order_id;`,
      `update public.orders set status = 'preparing' where id = :order_id;`,
      `update public.orders set status = 'ready' where id = :order_id;`,
      `update public.orders set status = 'delivered' where id = :order_id;`,
      `select status, redeemed_at is not null from public.coupon_redemptions where id = :r_id;`,
      `select reserved_count, redeemed_count from public.coupons where id = :coupon_id;`,
    )
    const [redemptionLine, countersLine] = out.split('\n')
    expect(redemptionLine).toBe('redeemed|t')
    expect(countersLine).toBe('0|1')
  })

  /**
   * `released_reason` distingue QUIÉN canceló, no solo QUE se canceló
   * (comentario de `sync_coupon_reservation` en la migración). El
   * discriminador es `auth.uid()`, que es `null` para `service_role`: los
   * únicos caminos de servidor que cancelan un pedido impago
   * (`expire_pending_orders`, el barrido de abandonados, y la conciliación)
   * corren sin sesión, así que caen acá con `'expired'`. Este test corre como
   * `postgres` (sin JWT, mismos privilegios que `service_role`), que es
   * exactamente ese camino — el hermano con sesión de staff está en el
   * siguiente test, y prueba `'cancelled_unpaid'`.
   */
  it('liberar (barrido del cron, sin sesión): un pedido cancelado SIN plata libera la reserva con released_reason = "expired", y el cupo liberado sirve para otro cliente', () => {
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ maxRedemptions: 1 }),
      ...orderFixture('order1_', { status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
      ...redemptionFixture('r1_', 'order1_id', { phone: '+5491100000001' }),
      `update public.orders set status = 'cancelled' where id = :order1_id;`,
      `select status, released_reason, released_at is not null from public.coupon_redemptions where id = :r1_id;`,
      // El cupo liberado (reserved_count vuelve a 0) permite que OTRO cliente
      // reserve, aunque max_redemptions sea 1 y ya se haya "usado" una vez.
      ...orderFixture('order2_', { status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
      ...redemptionFixture('r2_', 'order2_id', { phone: '+5491100000002' }),
      `select status from public.coupon_redemptions where id = :r2_id;`,
    )
    const [first, second] = out.split('\n')
    expect(first).toBe('released|expired|t')
    expect(second).toBe('reserved')
  })

  /**
   * El hermano del test de arriba: la MISMA cancelación, pero con sesión de
   * staff (`auth.uid()` presente vía `request.jwt.claims`) — el único otro
   * camino que puede escribir `orders.status` desde afuera del servidor,
   * porque `orders` tiene `grant update (status)` para `authenticated`. Sin
   * este caso, la distinción entre "se venció solo" y "lo canceló alguien"
   * vuelve a no estar cubierta, y el próximo que toque el trigger la puede
   * colapsar sin que ningún test falle.
   */
  it('liberar (cancelación manual de staff, con sesión): released_reason = "cancelled_unpaid", nunca "expired"', () => {
    const staffUserId = newUserId()
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ maxRedemptions: 1 }),
      createAuthUserSql(staffUserId, 'staff-cancela@example.com'),
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${staffUserId}', 'staff');`,
      ...orderFixture('order_', { status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
      ...redemptionFixture('r_', 'order_id'),
      ...asAuthenticated(staffUserId, [`update public.orders set status = 'cancelled' where id = :order_id;`]),
      // El `reset role` de asAuthenticated ya corrió acá: esta lectura es
      // como `postgres`, porque `coupon_redemptions` no tiene un solo grant
      // para `authenticated` (es el libro mayor, nadie lo lee por PostgREST).
      `select status, released_reason from public.coupon_redemptions where id = :r_id;`,
    )
    expect(out).toBe('released|cancelled_unpaid')
  })

  it('un pedido cancelado DESPUÉS de aprobado el pago NO libera la reserva (hubo plata) — la condición es paid_at IS NULL, no el status', () => {
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ maxRedemptions: 5 }),
      ...orderFixture('order_', { status: 'pending', paymentMethod: 'online', paymentStatus: 'pending' }),
      ...redemptionFixture('r_', 'order_id'),
      // Aprobar el pago sella paid_at (trigger de timestamps), TODAVÍA en pending.
      `update public.orders set payment_status = 'approved' where id = :order_id;`,
      `select paid_at is not null from public.orders where id = :order_id;`,
      `update public.orders set status = 'cancelled' where id = :order_id;`,
      `select status, released_reason from public.coupon_redemptions where id = :r_id;`,
    )
    const [paidAtLine, redemptionLine] = out.split('\n')
    expect(paidAtLine).toBe('t')
    expect(redemptionLine).toBe('reserved|')
  })

  it('redeemed_count es monótono: una vez delivered (terminal), no hay transición legal que pueda tocar la fila redeemed de vuelta', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 5 }),
        ...orderFixture('order_', { status: 'pending', paymentMethod: 'in_store', paymentStatus: 'pending' }),
        ...redemptionFixture('r_', 'order_id'),
        `update public.orders set status = 'confirmed' where id = :order_id;`,
        `update public.orders set status = 'preparing' where id = :order_id;`,
        `update public.orders set status = 'ready' where id = :order_id;`,
        `update public.orders set status = 'delivered' where id = :order_id;`,
        // delivered es terminal: ningún camino puede volver a tocar el pedido,
        // así que la fila que `sync_coupon_reservation` dejó en `redeemed` no
        // tiene forma de moverse de nuevo.
        `update public.orders set status = 'cancelled' where id = :order_id;`,
      ].join('\n'),
      /transicion de estado ilegal.*delivered -> cancelled/,
    )
  })

  it('unique(order_id): un pedido no puede tener dos filas en el libro mayor, aunque sean de cupones distintos', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 5, code: 'CPNTEST1', varPrefix: 'couponA_' }),
        ...couponFixture({ maxRedemptions: 5, code: 'CPNTEST2', varPrefix: 'couponB_' }),
        ...orderFixture('order_'),
        `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
         values (:store_id, :couponA_id, :order_id, '+5491100000000', 100);`,
        `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
         values (:store_id, :couponB_id, :order_id, '+5491100000000', 100);`,
      ].join('\n'),
      /duplicate key.*coupon_redemptions/,
    )
  })

  it('un cupón de OTRA tienda no se puede canjear: la FK compuesta lo rechaza aunque el order_id sea válido', () => {
    expectSqlToFail(
      [
        ...storeFixture('cpn-a'),
        ...couponFixture({ maxRedemptions: 5 }),
        // Guarda el cupón de la tienda A en una variable propia ANTES de que
        // el fixture de la tienda B pise `:store_id`/`:coupon_id`.
        `select :coupon_id as cid \\gset a_`,
        ...storeFixture('cpn-b'),
        ...orderFixture('order_'),
        // `:store_id` acá es la tienda B (el fixture lo acaba de pisar), pero
        // el cupón (`:a_cid`) es de la tienda A.
        `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
         values (:store_id, :a_cid, :order_id, '+5491100000000', 100);`,
      ].join('\n'),
      /coupon_redemptions_coupon_same_store_fkey|foreign key/,
    )
  })

  describe('un cupón que no está activo, o fuera de ventana, o agotado, nunca canjea', () => {
    it('draft → CPN02', () => {
      expectSqlToFail(
        [
          ...storeFixture(),
          ...couponFixture({ maxRedemptions: 5, status: 'draft' }),
          ...orderFixture('order_'),
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
           values (:store_id, :coupon_id, :order_id, '+5491100000000', 100);`,
        ].join('\n'),
        /CPN02|no esta activo/,
      )
    })

    it('paused → CPN02', () => {
      expectSqlToFail(
        [
          ...storeFixture(),
          ...couponFixture({ maxRedemptions: 5, status: 'paused' }),
          ...orderFixture('order_'),
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
           values (:store_id, :coupon_id, :order_id, '+5491100000000', 100);`,
        ].join('\n'),
        /CPN02|no esta activo/,
      )
    })

    it('vencido (ends_at en el pasado) → CPN04', () => {
      expectSqlToFail(
        [
          ...storeFixture(),
          ...couponFixture({ maxRedemptions: 5, endsAtExpr: "now() - interval '1 day'" }),
          ...orderFixture('order_'),
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
           values (:store_id, :coupon_id, :order_id, '+5491100000000', 100);`,
        ].join('\n'),
        /CPN04|vencio/,
      )
    })

    it('agotado (ya con una reserva viva en el tope) → CPN05', () => {
      expectSqlToFail(
        [
          ...storeFixture(),
          ...couponFixture({ maxRedemptions: 1 }),
          ...orderFixture('order1_'),
          ...redemptionFixture('r1_', 'order1_id'),
          ...orderFixture('order2_'),
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
           values (:store_id, :coupon_id, :order2_id, '+5491100000000', 100);`,
        ].join('\n'),
        /CPN05|el cupon se agoto/,
      )
    })
  })

  it('el tope por teléfono cuenta SOLO reserved/redeemed: una reserva liberada no consume la cuota de esa persona', () => {
    const phone = '+5491100000099'
    const out = inTransaction(
      ...storeFixture(),
      // Cupo GLOBAL holgado a propósito: así el rechazo que buscamos es
      // específicamente CPN06 (tope por teléfono), no CPN05 (tope global).
      ...couponFixture({ maxRedemptions: 100, maxRedemptionsPerPhone: 1 }),
      ...orderFixture('order1_', { phone }),
      ...redemptionFixture('r1_', 'order1_id', { phone }),
      `select 1;`, // marca de posición, no hace falta nada acá
    )
    expect(out).toBe('1')

    // Una segunda reserva para el MISMO teléfono, con la primera todavía
    // 'reserved', rebota con CPN06 (no CPN05: hay cupo global de sobra).
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 100, maxRedemptionsPerPhone: 1 }),
        ...orderFixture('order1_', { phone }),
        ...redemptionFixture('r1_', 'order1_id', { phone }),
        ...orderFixture('order2_', { phone }),
        `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents)
         values (:store_id, :coupon_id, :order2_id, '${phone}', 100);`,
      ].join('\n'),
      /CPN06|ya uso este cupon/,
    )

    // Pero si la primera reserva de ESE teléfono se LIBERA, el índice parcial
    // (`where status in ('reserved','redeemed')`) deja de contarla, y una
    // tercera reserva para el mismo teléfono entra bien.
    const afterRelease = inTransaction(
      ...storeFixture(),
      ...couponFixture({ maxRedemptions: 100, maxRedemptionsPerPhone: 1 }),
      ...orderFixture('order1_', { phone }),
      ...redemptionFixture('r1_', 'order1_id', { phone }),
      `update public.coupon_redemptions set status = 'released', released_reason = 'expired', released_at = now() where id = :r1_id;`,
      ...orderFixture('order2_', { phone }),
      ...redemptionFixture('r2_', 'order2_id', { phone }),
      `select status from public.coupon_redemptions where id = :r2_id;`,
    )
    expect(afterRelease).toBe('reserved')
  })

  describe('coupons_payment_methods_check: el array vacío y un valor fuera del enum se rechazan', () => {
    it("payment_methods = '{}' (array vacío) rebota — significaría 'ningún método' en silencio", () => {
      expectSqlToFail(
        [...storeFixture(), ...couponFixture({ maxRedemptions: 5, paymentMethodsLiteral: "'{}'::text[]" })].join('\n'),
        /coupons_payment_methods_check/,
      )
    })

    it("payment_methods con un valor fuera de {online, in_store, transfer} rebota", () => {
      expectSqlToFail(
        [...storeFixture(), ...couponFixture({ maxRedemptions: 5, paymentMethodsLiteral: "array['bogus']" })].join('\n'),
        /coupons_payment_methods_check/,
      )
    })
  })

  it('un cupón con CUALQUIER fila en el libro mayor no se puede borrar (23503), ni siquiera si esa fila está released', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ maxRedemptions: 5 }),
        ...orderFixture('order_'),
        ...redemptionFixture('r_', 'order_id'),
        `update public.coupon_redemptions set status = 'released', released_reason = 'expired', released_at = now() where id = :r_id;`,
        `delete from public.coupons where id = :coupon_id;`,
      ].join('\n'),
      /23503|foreign key|violates foreign key constraint/,
    )
  })

  describe('las cuatro tablas nuevas: SELECT denegado a anon y a authenticated', () => {
    const tables = ['coupons', 'coupon_redemptions', 'coupon_campaigns', 'campaign_recipients']

    for (const table of tables) {
      it(`${table}: anon no puede leer`, () => {
        expectSqlToFail(asAnon([`select * from public.${table} limit 1;`]).join('\n'), /permission denied/)
      })

      it(`${table}: authenticated (cualquier sesión) no puede leer`, () => {
        expectSqlToFail(asAuthenticated(newUserId(), [`select * from public.${table} limit 1;`]).join('\n'), /permission denied/)
      })
    }
  })
})
