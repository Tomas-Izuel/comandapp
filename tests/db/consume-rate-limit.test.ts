import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, sql, sqlConcurrently, uniqueSlug } from './helpers'

/**
 * `public.consume_rate_limit` — T0 criterios 3 a 6. El de concurrencia
 * (criterio 4) es EL test de todo el plan de rate limiting: si esto falla,
 * el limitador no existe, porque en Vercel cada lambda es un proceso
 * separado y solo Postgres puede arbitrar entre ellas.
 *
 * `sqlConcurrently` lanza cada llamada en su PROPIA conexión de Postgres, en
 * paralelo de verdad (`Promise.all` sobre procesos `docker exec psql`
 * separados) — no un `for` secuencial disfrazado. Es la única forma de que
 * este test pueda fallar si alguien cambia el `insert ... on conflict` por
 * un `select` + `update` en dos pasos (que perdería la carrera).
 */
describe.skipIf(!dbAvailable)('public.consume_rate_limit', () => {
  it('con p_limit=3, las 3 primeras llamadas dan allowed=true y la 4ª da allowed=false, en la MISMA ventana', () => {
    const bucket = uniqueSlug('cb')
    const subject = uniqueSlug('cs')
    const out = inTransaction(
      `select allowed from public.consume_rate_limit('${bucket}', '${subject}', 3600, 3);`,
      `select allowed from public.consume_rate_limit('${bucket}', '${subject}', 3600, 3);`,
      `select allowed from public.consume_rate_limit('${bucket}', '${subject}', 3600, 3);`,
      `select allowed, count from public.consume_rate_limit('${bucket}', '${subject}', 3600, 3);`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('t')
    expect(lines[1]).toBe('t')
    expect(lines[2]).toBe('t')
    expect(lines[3]).toBe('f|4') // 4ta llamada: ya pasó el límite, pero el conteo real SIGUE subiendo
  })

  /**
   * EL TEST QUE IMPORTA. 30 llamadas concurrentes, mismo (bucket, subject):
   * si el incremento no fuera atómico, N conexiones que leen el mismo
   * `count` antes de que la otra escriba dejarían `count` bien por debajo de
   * 30 (o varias filas duplicadas por una PK que no alcanzó a hacer su
   * trabajo). Verificado a mano por el hilo principal contra esta misma
   * base: 30 concurrentes → 30. Acá queda en la suite.
   */
  it('30 llamadas CONCURRENTES (conexiones separadas) al mismo (bucket, subject) dejan count = 30 EXACTO, en una sola fila', async () => {
    const bucket = uniqueSlug('concurrent-bucket')
    const subject = uniqueSlug('concurrent-subject')
    const N = 30

    const scripts = Array.from({ length: N }, () => `select public.consume_rate_limit('${bucket}', '${subject}', 3600, ${N});`)
    await sqlConcurrently(scripts)

    const out = sql(
      `select count, (select count(*) from public.rate_limits where bucket = '${bucket}' and subject = '${subject}') as rows
         from public.rate_limits where bucket = '${bucket}' and subject = '${subject}';`,
    )
    const [count, rows] = out.split('|')
    expect(count).toBe(String(N)) // el contador real, no una aproximación
    expect(rows).toBe('1') // una sola fila: la PK compuesta hizo su trabajo
  })

  it('dos SUBJECTS distintos con el MISMO bucket no se pisan (cada uno con su propio contador)', () => {
    const bucket = uniqueSlug('shared-bucket')
    const subjectA = uniqueSlug('subject-a')
    const subjectB = uniqueSlug('subject-b')
    const out = inTransaction(
      `select count from public.consume_rate_limit('${bucket}', '${subjectA}', 3600, 5);`,
      `select count from public.consume_rate_limit('${bucket}', '${subjectA}', 3600, 5);`,
      `select count from public.consume_rate_limit('${bucket}', '${subjectB}', 3600, 5);`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('1') // subjectA, primera vez
    expect(lines[1]).toBe('2') // subjectA, segunda vez
    expect(lines[2]).toBe('1') // subjectB: arranca de cero, no hereda el 2 de A
  })

  it('dos BUCKETS distintos con el MISMO subject tampoco se pisan (aislamiento multi-tenant genérico: es el mismo mecanismo detrás de order:store, courier_invite:*, owner_invite:store)', () => {
    const subject = uniqueSlug('shared-subject')
    const bucketA = uniqueSlug('bucket-a')
    const bucketB = uniqueSlug('bucket-b')
    const out = inTransaction(
      `select count from public.consume_rate_limit('${bucketA}', '${subject}', 3600, 5);`,
      `select count from public.consume_rate_limit('${bucketA}', '${subject}', 3600, 5);`,
      `select count from public.consume_rate_limit('${bucketB}', '${subject}', 3600, 5);`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('1')
    expect(lines[1]).toBe('2')
    expect(lines[2]).toBe('1') // el otro bucket ni se entera de que ya iba en 2
  })

  it('al cruzar el borde de la ventana, el contador arranca de nuevo con un window_start nuevo (fila nueva, no la misma)', () => {
    const bucket = uniqueSlug('window-bucket')
    const subject = uniqueSlug('window-subject')
    // Se inserta a mano una fila "vieja" (ventana ya cerrada) con un contador
    // alto, simulando que ya se agotó en una ventana pasada, y se llama a la
    // función con la ventana ACTUAL: tiene que ignorar la fila vieja del todo
    // (no la ve: su window_start no matchea el de `now()`) y arrancar en 1.
    const out = inTransaction(
      `insert into public.rate_limits (bucket, subject, window_start, count)
         values ('${bucket}', '${subject}', to_timestamp(floor(extract(epoch from now() - interval '1 hour') / 60) * 60), 999);`,
      `select count from public.consume_rate_limit('${bucket}', '${subject}', 60, 5);`,
      `select count(*) from public.rate_limits where bucket = '${bucket}' and subject = '${subject}';`,
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe('1') // ventana nueva: arranca de 1, no continúa desde 999
    expect(lines[1]).toBe('2') // y ahora hay DOS filas: la vieja (999) y la nueva (1)
  })

  it('parámetros inválidos (ventana <= 0) rebotan con una excepción, no devuelven una fila rara', () => {
    expect(() =>
      sql(['begin;', `select public.consume_rate_limit('x', 'y', 0, 5);`, 'rollback;'].join('\n')),
    ).toThrow(/Parametros invalidos/)
  })

  /**
   * El gate de idempotencia real que usa `POST /api/orders`
   * (`enforceOrderRateLimits`, ver `02-development-t3.md` de rate-limiting):
   * consumir `order:idempotency` (limit 1) ANTES de `order:phone`, y solo si
   * gana esa carrera consumir el balde real. Se replica acá exactamente la
   * misma secuencia de dos llamadas dentro de un solo `do $$ ... $$`, una vez
   * por conexión concurrente — es la forma de probar la invariante sin
   * montar el route handler completo (mocks de Supabase, `request.json()`,
   * etc.), y prueba lo mismo: el balde REAL (`order:phone`) queda en 1, no en
   * N, aunque N requests reintenten la misma compra en simultáneo. Verificado
   * a mano por el hilo principal: 8 concurrentes → `order:idempotency` 8,
   * `order:phone` 1.
   */
  it('N reintentos concurrentes de la MISMA compra (mismo idempotencyKey) dejan el balde real en 1 cupo, no en N (el gate de order:idempotency)', async () => {
    const idempotencyBucket = uniqueSlug('order-idempotency')
    const phoneBucket = uniqueSlug('order-phone')
    const key = uniqueSlug('idem-key')
    const phoneHash = uniqueSlug('phone-hash')
    const N = 8

    const gate = (n: number) => `
      do $$
      declare
        dedupe record;
      begin
        select * into dedupe from public.consume_rate_limit('${idempotencyBucket}', '${key}', 600, 1);
        if dedupe.allowed then
          perform public.consume_rate_limit('${phoneBucket}', '${phoneHash}', 600, 5);
        end if;
      end $$;
      -- comentario de depuración, ignorado por Postgres: intento ${n}
    `
    await sqlConcurrently(Array.from({ length: N }, (_, i) => gate(i)))

    const out = sql(
      `select
         (select count from public.rate_limits where bucket = '${idempotencyBucket}' and subject = '${key}'),
         (select count from public.rate_limits where bucket = '${phoneBucket}' and subject = '${phoneHash}');`,
    )
    const [idempotencyCount, phoneCount] = out.split('|')
    expect(idempotencyCount).toBe(String(N)) // las N llamadas SÍ se registraron
    expect(phoneCount).toBe('1') // pero solo UNA ganó la carrera y gastó cupo real
  })
})
