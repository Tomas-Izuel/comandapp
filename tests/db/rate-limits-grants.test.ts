import { describe, expect, it } from 'vitest'
import { asAnon, asAuthenticated, dbAvailable, expectSqlToFail, newUserId, sql } from './helpers'

/**
 * T0 criterios 1 y 2 — `public.rate_limits` y `consume_rate_limit` no los toca
 * NUNCA un browser, ni con la publishable key de un staff logueado.
 *
 * Mismo patrón que `tests/db/anon-grants.test.ts` y
 * `tests/db/grants-orders.test.ts`: `set local role` + los claims que
 * PostgREST arma a partir del JWT, corriendo contra la base real — es
 * exactamente lo que viaja desde el browser del staff, no una simulación.
 *
 * La postura de esta tabla es "doble candado" a propósito (RLS prendida SIN
 * ninguna policy + revoke explícito de tabla): aunque un GRANT se filtrara por
 * error, RLS sin policy sigue negando todo. Se prueban los dos candados por
 * separado para que un test rojo diga cuál se rompió.
 */
describe.skipIf(!dbAvailable)('rate_limits — privilegios (T0 criterios 1 y 2)', () => {
  describe('anon', () => {
    it('no puede leer la tabla', () => {
      expectSqlToFail(asAnon(['select count(*) from public.rate_limits;']).join('\n'), /permission denied for table rate_limits/)
    })

    it('no puede insertar', () => {
      expectSqlToFail(
        asAnon([`insert into public.rate_limits (bucket, subject, window_start, count) values ('x','y', now(), 1);`]).join('\n'),
        /permission denied for table rate_limits/,
      )
    })

    it('no puede invocar consume_rate_limit', () => {
      expectSqlToFail(
        asAnon([`select * from public.consume_rate_limit('order:phone','hash-de-prueba',60,5);`]).join('\n'),
        /permission denied for function consume_rate_limit/,
      )
    })
  })

  describe('authenticated (staff logueado, mismo camino que la publishable key en el browser)', () => {
    const userId = newUserId()

    it('no puede leer la tabla', () => {
      expectSqlToFail(
        asAuthenticated(userId, ['select count(*) from public.rate_limits;']).join('\n'),
        /permission denied for table rate_limits/,
      )
    })

    it('no puede actualizar (ni siquiera su propia fila, si existiera)', () => {
      expectSqlToFail(
        asAuthenticated(userId, [`update public.rate_limits set count = 0 where bucket = 'x';`]).join('\n'),
        /permission denied for table rate_limits/,
      )
    })

    it('no puede invocar consume_rate_limit, ni siquiera con aal2', () => {
      expectSqlToFail(
        asAuthenticated(userId, [`select * from public.consume_rate_limit('order:phone','hash-de-prueba',60,5);`], 'aal2').join(
          '\n',
        ),
        /permission denied for function consume_rate_limit/,
      )
    })
  })

  describe('service_role', () => {
    it('SÍ puede invocar consume_rate_limit y le funciona (allowed=true en la primera llamada)', () => {
      const out = sql(
        ['begin;', `select allowed, count from public.consume_rate_limit('grants-test-bucket', 'grants-test-subject-${Date.now()}', 60, 5);`, 'rollback;'].join(
          '\n',
        ),
      )
      // `service_role` es el rol de conexión de docker exec (superusuario), así
      // que esto corre sin `set local role`: confirma que el GRANT explícito a
      // service_role (no `alter default privileges`) alcanza por sí solo.
      const [allowed, count] = out.split('|')
      expect(allowed).toBe('t')
      expect(count).toBe('1')
    })
  })
})
