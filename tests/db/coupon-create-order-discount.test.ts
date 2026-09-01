import { describe, expect, it } from 'vitest'
import { dbAvailable, expectSqlToFail, inTransaction, uniqueSlug } from './helpers'

/**
 * `public.create_order` con cupón — el candado redundante (el mismo que
 * `enforce_coupon_redemption`, pero con mensajes CPN01..CPN10 legibles) y el
 * cálculo del descuento que la base vuelve a hacer y compara contra lo que
 * dice el llamador.
 *
 * El ciclo de vida del libro mayor en sí (reservar/confirmar/liberar, el
 * off-by-one, la carrera del último uso) está en
 * `coupon-redemption-lifecycle.test.ts`, insertando directo en
 * `coupon_redemptions` para aislar los triggers de esta capa. Acá lo que
 * importa es la función completa: el JSON que arma `order.model.ts` y lo que
 * `create_order` hace con él.
 */
describe.skipIf(!dbAvailable)('public.create_order — descuento de cupón', () => {
  function storeFixture(prefix = 'cpn-co') {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda Cupón CO', 'active') returning id \\gset store_`,
    ]
  }

  function couponFixture(opts: {
    discountType?: 'percentage' | 'fixed'
    percent?: number | null
    amountOffCents?: number | null
    maxRedemptions?: number
    paymentMethodsLiteral?: string | null
    code?: string
  }) {
    const {
      discountType = 'percentage',
      percent = 15,
      amountOffCents = null,
      maxRedemptions = 5,
      paymentMethodsLiteral = null,
      code = 'CPNORDER1',
    } = opts
    return [
      `insert into public.coupons (
         store_id, name, code, discount_type, percent, amount_off_cents, min_subtotal_cents,
         max_redemptions, payment_methods, status
       ) values (
         :store_id, 'Cupón CO', '${code}', '${discountType}',
         ${discountType === 'percentage' ? percent : 'null'},
         ${discountType === 'fixed' ? amountOffCents : 'null'},
         0, ${maxRedemptions}, ${paymentMethodsLiteral ?? 'null'}, 'active'
       ) returning id \\gset coupon_`,
    ]
  }

  function createOrderCall(opts: {
    idempotencyKey: string
    subtotal: number
    discount?: number
    fee?: number
    total?: number
    couponCode?: string | null
    paymentMethod?: 'online' | 'in_store' | 'transfer'
    deliveryMethod?: 'pickup' | 'delivery'
    deliveryAddressLine?: string | null
    varPrefix: string
  }): string {
    const {
      idempotencyKey,
      subtotal,
      discount = 0,
      fee = 0,
      couponCode = null,
      paymentMethod = 'online',
      deliveryMethod = 'pickup',
      deliveryAddressLine = null,
      varPrefix,
    } = opts
    const total = opts.total ?? subtotal - discount + fee

    const parts = [
      `'store_id', :store_id`,
      `'status', 'pending'`,
      `'customer_name', 'Cliente Test'`,
      `'customer_phone_e164', '+5491111111111'`,
      `'customer_email', null`,
      `'idempotency_key', '${idempotencyKey}'`,
      `'notes', null`,
      `'currency', 'ARS'`,
      `'subtotal_cents', ${subtotal}`,
      `'total_cents', ${total}`,
      `'base_prep_minutes', 10`,
      `'demand_multiplier', 1.0`,
      `'eta_minutes', 10`,
      `'eta_at', now()`,
      `'payment_method', '${paymentMethod}'`,
      `'payment_status', 'pending'`,
      `'delivery_method', '${deliveryMethod}'`,
      `'discount_cents', ${discount}`,
      `'coupon_code', ${couponCode === null ? 'null' : `'${couponCode}'`}`,
    ]
    if (deliveryMethod === 'delivery') {
      parts.push(`'delivery_fee_cents', ${fee}`, `'delivery_address_line', '${deliveryAddressLine ?? 'Calle 123'}'`)
    }

    return `select public.create_order(jsonb_build_object(${parts.join(', ')}), '[]'::jsonb) as id \\gset ${varPrefix}`
  }

  it('un cupón porcentual activo se aplica: discount_cents = floor(subtotal*percent/100), snapshot del código, y una reserva en el libro mayor', () => {
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ percent: 15 }), // floor(10000*15/100) = 1500
      createOrderCall({ idempotencyKey: 'co-1', subtotal: 10000, discount: 1500, couponCode: 'CPNORDER1', varPrefix: 'order_' }),
      `select discount_cents, coupon_code_snapshot from public.orders where id = :order_id;`,
      `select status from public.coupon_redemptions where order_id = :order_id;`,
    )
    const [orderLine, redemptionLine] = out.split('\n')
    expect(orderLine).toBe('1500|CPNORDER1')
    expect(redemptionLine).toBe('reserved')
  })

  it('CPN09: el llamador dice un discount_cents que no coincide con lo que la base calcula', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ percent: 15 }), // la base calcula 1500
        createOrderCall({ idempotencyKey: 'co-2', subtotal: 10000, discount: 1000, couponCode: 'CPNORDER1', varPrefix: 'order_' }),
      ].join('\n'),
      /CPN09|coupon_amount_mismatch/,
    )
  })

  it('CPN09 (variante total): el discount_cents coincide pero el total_cents mandado no cierra la cuenta', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ percent: 15 }),
        createOrderCall({
          idempotencyKey: 'co-2b',
          subtotal: 10000,
          discount: 1500,
          total: 9999, // debería ser 8500
          couponCode: 'CPNORDER1',
          varPrefix: 'order_',
        }),
      ].join('\n'),
      /CPN09|coupon_total_mismatch/,
    )
  })

  it('CPN10: llega un descuento sin código de cupón — el CHECK del total no lo ataja porque los tres números son consistentes entre sí', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        createOrderCall({
          idempotencyKey: 'co-3',
          subtotal: 10000,
          discount: 500,
          couponCode: null, // sin cupón que lo justifique
          varPrefix: 'order_',
        }),
      ].join('\n'),
      /CPN10|coupon_missing/,
    )
  })

  describe('el clamp de un cupón fijo mayor que el carrito', () => {
    it('el descuento efectivo queda clampeado al subtotal: total = 0 (o solo el envío), nunca negativo', () => {
      const out = inTransaction(
        ...storeFixture(),
        ...couponFixture({ discountType: 'fixed', amountOffCents: 20000 }), // > subtotal
        createOrderCall({
          idempotencyKey: 'co-4',
          subtotal: 10000,
          discount: 10000, // clampeado al subtotal, no a los 20000 del cupón
          couponCode: 'CPNORDER1',
          varPrefix: 'order_',
        }),
        `select discount_cents, total_cents from public.orders where id = :order_id;`,
      )
      expect(out).toBe('10000|0')
    })

    it('mandar el amount_off_cents CRUDO (sin clampear) no coincide con lo que la base calcula (que sí clampea) → CPN09', () => {
      expectSqlToFail(
        [
          ...storeFixture(),
          ...couponFixture({ discountType: 'fixed', amountOffCents: 20000 }),
          createOrderCall({
            idempotencyKey: 'co-5',
            subtotal: 10000,
            discount: 20000, // sin clampear
            total: -10000, // el número que "cerraría" si no hubiera clamp
            couponCode: 'CPNORDER1',
            varPrefix: 'order_',
          }),
        ].join('\n'),
        /CPN09|coupon_amount_mismatch/,
      )
    })
  })

  it('orders_discount_within_subtotal_check: un INSERT directo (bypasseando create_order) con discount_cents > subtotal_cents rebota, aunque total/subtotal/descuento sean consistentes entre sí', () => {
    // subtotal 1000, descuento 5000 (mayor al subtotal), envío 6000 →
    // total = 1000 - 5000 + 6000 = 2000: POSITIVO y consistente con
    // orders_total_is_subtotal_minus_discount_plus_delivery_check. Es
    // exactamente el agujero que el plan describe ("con un envío
    // suficientemente caro el total queda positivo") y el segundo CHECK
    // (`orders_discount_within_subtotal_check`) es el que lo ataja, porque
    // create_order ni se está usando acá.
    expectSqlToFail(
      [
        ...storeFixture(),
        `insert into public.orders (
           store_id, status, customer_name, customer_phone_e164, idempotency_key,
           currency, subtotal_cents, discount_cents, total_cents,
           payment_method, payment_status,
           delivery_method, delivery_fee_cents, delivery_address_line
         ) values (
           :store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text,
           'ARS', 1000, 5000, 2000,
           'online', 'pending',
           'delivery', 6000, 'Calle Falsa 123'
         );`,
      ].join('\n'),
      /orders_discount_within_subtotal_check/,
    )
  })

  it('idempotencia: la MISMA idempotency_key con el MISMO cupón dos veces devuelve un solo pedido y consume UN solo uso', () => {
    const out = inTransaction(
      ...storeFixture(),
      ...couponFixture({ percent: 15 }),
      createOrderCall({ idempotencyKey: 'co-6', subtotal: 10000, discount: 1500, couponCode: 'CPNORDER1', varPrefix: 'order1_' }),
      createOrderCall({ idempotencyKey: 'co-6', subtotal: 10000, discount: 1500, couponCode: 'CPNORDER1', varPrefix: 'order2_' }),
      `select (:order1_id = :order2_id);`,
      `select count(*) from public.coupon_redemptions where coupon_id = :coupon_id;`,
      `select reserved_count from public.coupons where id = :coupon_id;`,
    )
    const [sameOrder, redemptionCount, reservedCount] = out.split('\n')
    expect(sameOrder).toBe('t')
    expect(redemptionCount).toBe('1')
    expect(reservedCount).toBe('1')
  })

  it('CPN08: un cupón restringido a "online" usado con "in_store" se rechaza', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ percent: 15, paymentMethodsLiteral: "array['online']" }),
        createOrderCall({
          idempotencyKey: 'co-7',
          subtotal: 10000,
          discount: 0,
          total: 10000,
          couponCode: 'CPNORDER1',
          paymentMethod: 'in_store',
          varPrefix: 'order_',
        }),
      ].join('\n'),
      /CPN08|coupon_payment_method/,
    )
  })

  it('discount_cents y coupon_code_snapshot son inmutables después de creado el pedido', () => {
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ percent: 15 }),
        createOrderCall({ idempotencyKey: 'co-8', subtotal: 10000, discount: 1500, couponCode: 'CPNORDER1', varPrefix: 'order_' }),
        `update public.orders set discount_cents = 0 where id = :order_id;`,
      ].join('\n'),
      /columnas inmutables/,
    )
    expectSqlToFail(
      [
        ...storeFixture(),
        ...couponFixture({ percent: 15 }),
        createOrderCall({ idempotencyKey: 'co-9', subtotal: 10000, discount: 1500, couponCode: 'CPNORDER1', varPrefix: 'order_' }),
        `update public.orders set coupon_code_snapshot = 'OTRO' where id = :order_id;`,
      ].join('\n'),
      /columnas inmutables/,
    )
  })

  it('un pedido SIN cupón sigue funcionando exactamente igual que antes (regresión)', () => {
    const out = inTransaction(
      ...storeFixture(),
      createOrderCall({ idempotencyKey: 'co-10', subtotal: 10000, discount: 0, couponCode: null, varPrefix: 'order_' }),
      `select discount_cents, coupon_code_snapshot, total_cents from public.orders where id = :order_id;`,
      `select count(*) from public.coupon_redemptions where order_id = :order_id;`,
    )
    const [orderLine, redemptionCount] = out.split('\n')
    expect(orderLine).toBe('0||10000')
    expect(redemptionCount).toBe('0')
  })
})
