import { describe, expect, it } from 'vitest'
import {
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  uniqueSlug,
} from './helpers'

/**
 * `stores.courier_collects_payment` (20260829000433_revoke_courier_collects_payment_grant.sql).
 *
 * Es el candado del código de 6 dígitos: cambiar quién cobra en la puerta
 * pasa por `requestCourierPaymentPolicyChangeAction` +
 * `confirmPendingChangeAction` (S-03), con `createAdminClient()` detrás de un
 * chequeo de `owner` y una confirmación por email. El pipeline de
 * ajustes-por-secciones partió `updateStoreSettings` en dos acciones nuevas
 * (`updateStoreProfile`/`updateStoreOrdering`) precisamente para que ninguna
 * de las dos pudiera reabrir ese bypass agregando la columna de vuelta a su
 * `.pick()` — pero esa garantía en TypeScript solo vale mientras nadie la
 * cambie. La defensa real, la que sobrevive aunque alguien la reintroduzca en
 * un schema, es que `authenticated` no tiene ni un grant de UPDATE sobre la
 * columna: ni por la app, ni pegándole a PostgREST directo con la sesión de
 * un staff (la publicable key está en el browser).
 *
 * Sin este test, la migración que revoca el grant podía desaparecer en un
 * `db reset` mal aplicado o en una migración futura que "limpia" grants sin
 * saber que este es a propósito, y nada en la suite lo notaría — exactamente
 * el mismo motivo que `grants-stores.test.ts` (S-01) para `status`/`slug`.
 */
describe.skipIf(!dbAvailable)('courier_collects_payment — sin grant de UPDATE para authenticated (candado de S-03)', () => {
  function fixture(prefix: string, userId: string, role: 'owner' | 'staff' = 'owner') {
    return [
      createAuthUserSql(userId, `${prefix}@example.com`),
      `insert into public.stores (slug, name, status, delivery_enabled)
         values ('${uniqueSlug(prefix)}', 'Tienda de test', 'active', true)
       returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', '${role}');`,
    ]
  }

  it('el DUEÑO del local no puede tocar courier_collects_payment por PostgREST directo, aunque sea owner', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('ccp-owner', userId, 'owner'),
        ...asAuthenticated(userId, [
          `update public.stores set courier_collects_payment = true where id = :store_id;`,
        ]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })

  it('un staff (no owner) tampoco puede — mismo resultado, doble motivo (ni el rol ni el grant alcanzan)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('ccp-staff', userId, 'staff'),
        ...asAuthenticated(userId, [
          `update public.stores set courier_collects_payment = true where id = :store_id;`,
        ]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })

  it('el mismo UPDATE, pero solo tocando una columna SÍ permitida (name), pasa — no es que la fila esté bloqueada entera', () => {
    const userId = newUserId()
    const out = inTransaction(
      ...fixture('ccp-control', userId, 'owner'),
      ...asAuthenticated(userId, [
        `update public.stores set name = 'Nombre nuevo' where id = :store_id;`,
        `select name from public.stores where id = :store_id;`,
      ]),
    )
    expect(out).toBe('Nombre nuevo')
  })

  it('service_role SÍ puede — es el camino real: confirmPendingChangeAction usa createAdminClient()', () => {
    const userId = newUserId()
    // `set local role service_role`, no el superusuario de la conexión (que
    // bypasea todo grant por defecto y no probaría nada sobre el rol real):
    // mismo mecanismo que `asAuthenticated`, pero para el rol que usa el
    // admin client.
    const out = inTransaction(
      ...fixture('ccp-admin', userId, 'owner'),
      'set local role service_role;',
      `update public.stores set courier_collects_payment = true where id = :store_id;`,
      'reset role;',
      `select courier_collects_payment from public.stores where id = :store_id;`,
    )
    expect(out).toBe('t')
  })
})
