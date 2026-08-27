import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, sql, uniqueSlug } from './helpers'

/**
 * P-09 — `create_order` atómico e idempotente.
 *
 * `createOrder` insertaba la cabecera, después un insert por ítem y después
 * las opciones, con un `delete` compensatorio en el catch. Si el delete
 * fallaba quedaba un pedido sin ítems en el KDS, y el trigger del outbox ya
 * había publicado `order.created` de un pedido que después no existía. Ahora
 * es una función SQL: cabecera + ítems + opciones en UNA transacción, e
 * idempotente por `(store_id, idempotency_key)`.
 */
describe.skipIf(!dbAvailable)('public.create_order', () => {
  function catalogFixture() {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('p09')}', 'Tienda P09', 'active') returning id \\gset store_`,
      `insert into public.categories (store_id, name) values (:store_id, 'Cat') returning id \\gset cat_`,
      `insert into public.products (store_id, category_id, name, price_cents) values (:store_id, :cat_id, 'Burger', 5000) returning id \\gset product_`,
      `insert into public.option_groups (product_id, name, min_select, max_select) values (:product_id, 'Tamaño', 1, 1) returning id \\gset group_`,
      `insert into public.options (group_id, name, price_delta_cents) values (:group_id, 'Grande', 500) returning id \\gset option_`,
    ]
  }

  function createOrderCall(idempotencyKey: string, varPrefix: string) {
    return `select public.create_order(
      jsonb_build_object(
        'store_id', :store_id, 'status', 'pending', 'customer_name', 'Cliente Test',
        'customer_phone_e164', '+5491111111111', 'customer_email', null,
        'idempotency_key', '${idempotencyKey}', 'notes', null, 'currency', 'ARS',
        'subtotal_cents', 10500, 'total_cents', 10500, 'base_prep_minutes', 10,
        'demand_multiplier', 1.0, 'eta_minutes', 10, 'eta_at', now(),
        'payment_method', 'online', 'payment_status', 'pending'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', :product_id, 'name_snapshot', 'Burger Test', 'unit_price_cents', 5000,
          'quantity', 1, 'total_cents', 5500, 'prep_minutes', 10, 'notes', null,
          'options', jsonb_build_array(
            jsonb_build_object('option_id', :option_id, 'name_snapshot', 'Grande', 'group_snapshot', 'Tamaño', 'price_delta_cents', 500)
          )
        ),
        jsonb_build_object(
          'product_id', :product_id, 'name_snapshot', 'Burger Test 2', 'unit_price_cents', 5000,
          'quantity', 1, 'total_cents', 5000, 'prep_minutes', 10, 'notes', null, 'options', '[]'::jsonb
        )
      )
    ) as id \\gset ${varPrefix}`
  }

  it('crea la cabecera, los 2 ítems y las opciones del ítem que las tiene, en una sola llamada', () => {
    const out = inTransaction(
      ...catalogFixture(),
      createOrderCall('p09-idem-1', 'order_'),
      `select length(public_token), short_code is not null from public.orders where id = :order_id;`,
      `select count(*) from public.order_items where order_id = :order_id;`,
      `select count(*) from public.order_item_options oio
         join public.order_items oi on oi.id = oio.order_item_id
        where oi.order_id = :order_id;`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('24|t') // public_token de 24 chars, short_code asignado por el trigger
    expect(lines[1]).toBe('2') // los 2 ítems
    expect(lines[2]).toBe('1') // la opción del primer ítem
  })

  it('llamarla dos veces con la misma idempotency_key devuelve el mismo pedido y no crea uno nuevo', () => {
    const out = inTransaction(
      ...catalogFixture(),
      createOrderCall('p09-idem-2', 'order_'),
      createOrderCall('p09-idem-2', 'order2_'),
      `select (:order2_id = :order_id), (select count(*) from public.orders where store_id = :store_id and idempotency_key = 'p09-idem-2');`,
    )
    expect(out).toBe('t|1')
  })

  it('un pedido sin ítems (array vacío) igual crea la cabecera', () => {
    const out = sql(
      [
        'begin;',
        ...catalogFixture(),
        `select public.create_order(
          jsonb_build_object(
            'store_id', :store_id, 'status', 'pending', 'customer_name', 'Cliente Vacío',
            'customer_phone_e164', '+5491111111111', 'customer_email', null,
            'idempotency_key', 'p09-idem-3', 'notes', null, 'currency', 'ARS',
            'subtotal_cents', 0, 'total_cents', 0, 'base_prep_minutes', 0,
            'demand_multiplier', 1.0, 'eta_minutes', 0, 'eta_at', now(),
            'payment_method', 'online', 'payment_status', 'pending'
          ),
          '[]'::jsonb
        ) as id \\gset order_`,
        `select count(*) from public.orders where id = :order_id;`,
        'rollback;',
      ].join('\n'),
    )
    expect(out).toBe('1')
  })
})
