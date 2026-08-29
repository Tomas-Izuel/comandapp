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
 * `stores.online_payment_enabled` (20260829160000_online_payment_flag.sql).
 *
 * Antes de esta columna, "¿esta tienda puede cobrar online?" solo se podía
 * responder leyendo `store_payment_credentials`, que no tiene grant ni para
 * `anon` ni para `authenticated` — a propósito, ahí vive el access token. La
 * vitrina no tenía forma de saberlo y ofrecía "pagar ahora" a cualquiera.
 *
 * Dos cosas se prueban acá:
 *  1. El trigger `private.sync_store_online_payment()` mantiene la columna en
 *     sync con `access_token` (no nulo y no vacío) en insert/update/delete.
 *  2. Igual que `status` y `slug`: es derivada, así que `authenticated` NO
 *     tiene grant de UPDATE sobre ella. Mismo patrón que S-01
 *     (`grants-stores.test.ts`) — un dueño que la pusiera en `true` a mano por
 *     PostgREST solo lograría que sus clientes elijan un medio de pago que
 *     va a fallar.
 */
describe.skipIf(!dbAvailable)('stores.online_payment_enabled — derivada de store_payment_credentials.access_token', () => {
  function storeFixture(prefix: string) {
    return [`insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`]
  }

  it('una tienda recién creada, sin credenciales, arranca en false (el default de la columna)', () => {
    const out = inTransaction(
      ...storeFixture('flag-default'),
      `select online_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('insertar store_payment_credentials CON access_token pone la tienda en true', () => {
    const out = inTransaction(
      ...storeFixture('flag-insert'),
      `insert into public.store_payment_credentials (store_id, access_token) values (:store_id, 'APP_USR-valid-token');`,
      `select online_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('t')
  })

  it('poner access_token en NULL (desconectar) vuelve la tienda a false', () => {
    const out = inTransaction(
      ...storeFixture('flag-null'),
      `insert into public.store_payment_credentials (store_id, access_token) values (:store_id, 'APP_USR-valid-token');`,
      `update public.store_payment_credentials set access_token = null where store_id = :store_id;`,
      `select online_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  /**
   * `''` no es lo mismo que "sin fila" para un CHECK de NOT NULL, pero para
   * este negocio es exactamente igual de inútil que null: el formulario de
   * `/admin/pagos` puede dejar el campo vacío al "limpiarlo". El trigger lo
   * trata igual — si alguien lo cambiara a solo `is not null`, este test
   * rompe.
   */
  it('poner access_token en \'\' (string vacío) TAMBIÉN vuelve la tienda a false, no solo NULL', () => {
    const out = inTransaction(
      ...storeFixture('flag-empty'),
      `insert into public.store_payment_credentials (store_id, access_token) values (:store_id, 'APP_USR-valid-token');`,
      `update public.store_payment_credentials set access_token = '' where store_id = :store_id;`,
      `select online_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('borrar la fila de credenciales (desconexión total) vuelve la tienda a false', () => {
    const out = inTransaction(
      ...storeFixture('flag-delete'),
      `insert into public.store_payment_credentials (store_id, access_token) values (:store_id, 'APP_USR-valid-token');`,
      `delete from public.store_payment_credentials where store_id = :store_id;`,
      `select online_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('un staff no puede escribir stores.online_payment_enabled directo por PostgREST (columna revocada, igual que status/slug)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, 'flag-grant@example.com'),
        ...storeFixture('flag-grant'),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
        ...asAuthenticated(userId, [`update public.stores set online_payment_enabled = true where id = :store_id;`]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })
})
