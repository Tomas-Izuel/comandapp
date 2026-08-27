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
 * `platform_metrics` / `platform_stores` exigen DOS cosas: `aal2` (TOTP
 * verificado en la sesión) Y una fila en `platform_admins`. Poner el aal2
 * en la RLS/RPC —y no en la pantalla de login— es lo que cierra el atajo de
 * "pedir un magic link para saltear el segundo factor": un dueño de local
 * con una sesión normal, aunque de alguna forma tuviera aal2, sigue sin
 * poder leer las métricas de la plataforma porque no está en
 * `platform_admins`.
 */
describe.skipIf(!dbAvailable)('platform_metrics / platform_stores — aal2 + platform_admins', () => {
  function platformAdmin(userId: string) {
    return [createAuthUserSql(userId, `${userId}@example.com`), `insert into public.platform_admins (user_id, email) values ('${userId}', '${userId}@example.com');`]
  }

  it('un platform admin con aal2 puede leer platform_metrics', () => {
    const adminId = newUserId()
    const out = inTransaction(
      ...platformAdmin(adminId),
      ...asAuthenticated(adminId, [`select (public.platform_metrics() ? 'totalStores');`], 'aal2'),
    )
    expect(out).toBe('t')
  })

  it('un dueño de local con aal2 pero SIN fila en platform_admins no puede leer platform_metrics', () => {
    const ownerId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(ownerId, `${ownerId}@example.com`),
        ...asAuthenticated(ownerId, [`select public.platform_metrics();`], 'aal2'),
      ].join('\n'),
      /no autorizado/,
    )
  })

  it('un platform admin sin aal2 (TOTP no verificado en esta sesión) no puede leer platform_metrics', () => {
    const adminId = newUserId()
    expectSqlToFail(
      [...platformAdmin(adminId), ...asAuthenticated(adminId, [`select public.platform_metrics();`], 'aal1')].join('\n'),
      /no autorizado/,
    )
  })

  it('platform_stores con aal2 + platform_admins devuelve el email del dueño de la tienda', () => {
    const adminId = newUserId()
    const ownerId = newUserId()
    const out = inTransaction(
      ...platformAdmin(adminId),
      createAuthUserSql(ownerId, `${ownerId}@example.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('platstores')}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
      ...asAuthenticated(adminId, [`select (public.platform_stores(:store_id) -> 0 ->> 'owner_email');`], 'aal2'),
    )
    expect(out).toBe(`${ownerId}@example.com`)
  })

  it('un dueño de local con aal2 no puede leer platform_stores', () => {
    const ownerId = newUserId()
    expectSqlToFail(
      [createAuthUserSql(ownerId, `${ownerId}@example.com`), ...asAuthenticated(ownerId, [`select public.platform_stores();`], 'aal2')].join(
        '\n',
      ),
      /no autorizado/,
    )
  })
})
