import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, uniqueSlug } from './helpers'

/**
 * P-10 — outbox por ENDPOINT, no por evento.
 *
 * El outbox viejo marcaba entregado o fallido el EVENTO entero. Si una
 * tienda tiene dos endpoints y uno se cae, el evento reintentaba completo y
 * el POS que sí había respondido recibía el mismo pedido de nuevo — plata
 * mal contada en la cocina. `order_event_deliveries` le da a cada destino su
 * propio contador de intentos, su propio backoff y su propia dead-letter, y
 * `claim_event_deliveries` hace el fan-out perezoso: recién arma las filas
 * de entrega cuando el cron reclama, no en el camino caliente del pedido.
 *
 * Crear un pedido dispara el trigger `orders_log_created`, que inserta un
 * `order_events` de tipo `order.created` — es lo que alimenta todo este
 * outbox, no hace falta insertarlo a mano.
 */
describe.skipIf(!dbAvailable)('outbox por endpoint — claim_event_deliveries / settle_event_delivery', () => {
  function storeWithEndpointAndOrder(prefix: string, events: string[] = ['order.created']) {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`,
      `insert into public.pos_endpoints (store_id, name, url, secret, events, is_active)
         values (:store_id, 'POS test', 'https://example.com/hook', 'sekret', array[${events.map((e) => `'${e}'`).join(',')}], true)
       returning id \\gset endpoint_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  it('un endpoint activo suscripto a order.created recibe una fila de entrega al reclamar', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-fanout'),
      `select delivery_id, (endpoint_id = :endpoint_id), event_type
         from public.claim_event_deliveries(50, 8, 120)
        where store_id = :store_id;`,
    )
    const [deliveryId, matchesEndpoint, eventType] = out.split('|')
    expect(Number(deliveryId)).toBeGreaterThan(0)
    expect(matchesEndpoint).toBe('t')
    expect(eventType).toBe('order.created')
  })

  it('un segundo claim inmediato NO devuelve la misma entrega (el lock)', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-lock'),
      `select delivery_id, endpoint_id from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id \\gset first_`,
      `select attempts, locked_until is not null from public.order_event_deliveries where id = :first_delivery_id;`,
      `select count(*) from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id;`,
    )
    const [attempts, wasLocked, secondClaimCount] = out.split(/[|\n]/)
    expect(attempts).toBe('0')
    expect(wasLocked).toBe('t')
    expect(secondClaimCount).toBe('0')
  })

  it('settle_event_delivery(false) suma attempts, guarda last_attempt_at y libera el lock', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-settle'),
      `select delivery_id from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id \\gset d_`,
      `select public.settle_event_delivery(:d_delivery_id, false, 'timeout del POS', 8);`,
      `select attempts, last_attempt_at is not null, locked_until is null, dead_at is null
         from public.order_event_deliveries where id = :d_delivery_id;`,
    )
    const lines = out.split('\n')
    expect(lines.at(-1)).toBe('1|t|t|t') // attempts=1, last_attempt_at seteado, sin lock, sin dead-letter
  })

  it('el backoff impide reclamar la entrega recién fallada, aunque el lock ya se liberó', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-backoff'),
      `select delivery_id from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id \\gset d_`,
      `select public.settle_event_delivery(:d_delivery_id, false, 'transitorio', 8);`,
      `select count(*) from public.claim_event_deliveries(50, 8, 120) where delivery_id = :d_delivery_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('0')
  })

  it('al agotar los intentos queda dead_at y deja de reclamarse', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-dead'),
      // p_max_attempts=2 para no tener que simular 8 fallos.
      `select delivery_id from public.claim_event_deliveries(50, 2, 120) where store_id = :store_id \\gset d_`,
      `select public.settle_event_delivery(:d_delivery_id, false, 'falla 1', 2);`,
      `select public.settle_event_delivery(:d_delivery_id, false, 'falla 2', 2);`,
      `select attempts, dead_at is not null from public.order_event_deliveries where id = :d_delivery_id;`,
      `select count(*) from public.claim_event_deliveries(50, 2, 120) where delivery_id = :d_delivery_id;`,
    )
    const lines = out.split('\n')
    expect(lines.at(-2)).toBe('2|t') // 2 intentos, dead-letter marcada
    expect(lines.at(-1)).toBe('0') // ya no se reclama
  })

  it('cuando el único destino de un evento cierra bien, order_events.delivered_at queda seteado', () => {
    const out = inTransaction(
      ...storeWithEndpointAndOrder('p10-delivered'),
      `select delivery_id, event_id from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id \\gset d_`,
      `select public.settle_event_delivery(:d_delivery_id, true, null, 8);`,
      `select delivered_at is not null from public.order_events where id = :d_event_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('t')
  })

  it('un evento al que ningún endpoint activo está suscripto se cierra solo (no queda pendiente para siempre)', () => {
    const out = inTransaction(
      // El endpoint existe y está activo, pero suscripto a otro tipo de evento.
      ...storeWithEndpointAndOrder('p10-sinsub', ['order.paid']),
      `select id from public.order_events where order_id = :order_id and type = 'order.created' \\gset e_`,
      `select count(*) from public.claim_event_deliveries(50, 8, 120) where store_id = :store_id;`,
      `select delivered_at is not null, last_error from public.order_events where id = :e_id;`,
    )
    const lines = out.split('\n')
    expect(lines.at(-2)).toBe('0') // no se crea ninguna fila de entrega
    expect(lines.at(-1)).toBe('t|sin endpoints suscriptos')
  })
})
