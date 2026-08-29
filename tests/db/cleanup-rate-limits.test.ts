import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, uniqueSlug } from './helpers'

/**
 * T0 criterio 7 — `cleanup_old_records` se REDECLARA entera para sumar el
 * barrido de `rate_limits` (`create or replace` reemplaza el cuerpo
 * COMPLETO, no solo agrega una sentencia). El riesgo real de este patrón no
 * es "¿borra `rate_limits`?" sino "¿se llevó puesto alguno de los tres
 * barridos que ya existían?" — no había ningún test de esta función antes de
 * esta migración, así que una regresión silenciosa en
 * `order_events`/`platform_audit_log` no tenía ninguna red.
 */
describe.skipIf(!dbAvailable)('cleanup_old_records — barre rate_limits SIN romper los barridos que ya existían', () => {
  function fixture(oldBucket: string, recentBucket: string) {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('cleanup')}', 'Tienda Cleanup', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 100, 100)
       returning id \\gset order_`,
      // order_events: uno viejo (delivered hace 31 días, default p_event_days=30) y uno reciente.
      `insert into public.order_events (order_id, store_id, type, delivered_at) values (:order_id, :store_id, 'order.created', now() - interval '31 days') returning id \\gset old_event_`,
      `insert into public.order_events (order_id, store_id, type, delivered_at) values (:order_id, :store_id, 'order.created', now()) returning id \\gset recent_event_`,
      // platform_audit_log: uno viejo (hace 400 días, default p_audit_days=365) y uno reciente.
      `insert into public.platform_audit_log (action, created_at) values ('test.cleanup.old', now() - interval '400 days') returning id \\gset old_audit_`,
      `insert into public.platform_audit_log (action, created_at) values ('test.cleanup.recent', now()) returning id \\gset recent_audit_`,
      // rate_limits: uno de hace 2 días (fuera de la retención de 1 día, hardcodeada
      // en la función) y uno de la ventana actual.
      `insert into public.rate_limits (bucket, subject, window_start, count) values ('${oldBucket}', 'subject-old', now() - interval '2 days', 9);`,
      `insert into public.rate_limits (bucket, subject, window_start, count) values ('${recentBucket}', 'subject-recent', now(), 1);`,
    ]
  }

  it('borra lo viejo y deja intacto lo reciente en las CUATRO tablas, y el jsonb reporta >= 1 rate_limit borrada', () => {
    const oldBucket = uniqueSlug('rl-old')
    const recentBucket = uniqueSlug('rl-recent')
    const out = inTransaction(
      ...fixture(oldBucket, recentBucket),
      `select (public.cleanup_old_records()->>'rateLimits')::int >= 1;`,
      `select count(*) from public.order_events where id = :old_event_id;`,
      `select count(*) from public.order_events where id = :recent_event_id;`,
      `select count(*) from public.platform_audit_log where id = :old_audit_id;`,
      `select count(*) from public.platform_audit_log where id = :recent_audit_id;`,
      `select count(*) from public.rate_limits where bucket = '${oldBucket}';`,
      `select count(*) from public.rate_limits where bucket = '${recentBucket}';`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('t') // rateLimits borradas >= 1, reportado en el jsonb
    expect(lines[1]).toBe('0') // order_event viejo: borrado
    expect(lines[2]).toBe('1') // order_event reciente: intacto
    expect(lines[3]).toBe('0') // audit viejo: borrado
    expect(lines[4]).toBe('1') // audit reciente: intacto
    expect(lines[5]).toBe('0') // rate_limit viejo: borrado
    expect(lines[6]).toBe('1') // rate_limit reciente: intacto
  })

  it('la firma del jsonb sigue trayendo orderEvents y auditEntries, no solo la clave nueva (rateLimits)', () => {
    const out = inTransaction(
      ...fixture(uniqueSlug('rl-old-2'), uniqueSlug('rl-recent-2')),
      `select
         (public.cleanup_old_records() ?& array['orderEvents','auditEntries','pendingChanges','rateLimits']);`,
    )
    expect(out).toBe('t')
  })
})
