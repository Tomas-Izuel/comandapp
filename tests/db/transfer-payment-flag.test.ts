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
 * `stores.transfer_payment_enabled` (`20260831120000_transferencia_bancaria.sql`).
 * Hermano exacto de `tests/db/online-payment-flag.test.ts`, mismo motivo:
 * la vitrina necesita "¿esta tienda cobra por transferencia?" sin leer
 * `store_bank_accounts` completa (que además tiene columnas que `anon` no
 * puede ver). El trigger `private.sync_store_transfer_payment()` la
 * mantiene en sync con `store_bank_accounts.is_active` en insert/update/delete.
 */
describe.skipIf(!dbAvailable)('stores.transfer_payment_enabled — derivada de store_bank_accounts.is_active', () => {
  function storeFixture(prefix: string) {
    return [`insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`]
  }

  it('una tienda recién creada, sin cuenta bancaria, arranca en false (el default de la columna)', () => {
    const out = inTransaction(
      ...storeFixture('trflag-default'),
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('insertar una cuenta ACTIVA pone la tienda en true', () => {
    const out = inTransaction(
      ...storeFixture('trflag-insert'),
      `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'La Birra SRL');`,
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('t')
  })

  it('insertar la cuenta con is_active = false NO prende el flag', () => {
    const out = inTransaction(
      ...storeFixture('trflag-insert-inactive'),
      `insert into public.store_bank_accounts (store_id, cbu, holder_name, is_active) values (:store_id, '0070325120000003733248', 'La Birra SRL', false);`,
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('apagar is_active (UPDATE) vuelve la tienda a false', () => {
    const out = inTransaction(
      ...storeFixture('trflag-off'),
      `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'La Birra SRL');`,
      `update public.store_bank_accounts set is_active = false where store_id = :store_id;`,
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('reactivar is_active (UPDATE) vuelve la tienda a true', () => {
    const out = inTransaction(
      ...storeFixture('trflag-reactivate'),
      `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'La Birra SRL');`,
      `update public.store_bank_accounts set is_active = false where store_id = :store_id;`,
      `update public.store_bank_accounts set is_active = true where store_id = :store_id;`,
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('t')
  })

  it('borrar la fila (DELETE) vuelve la tienda a false', () => {
    const out = inTransaction(
      ...storeFixture('trflag-delete'),
      `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'La Birra SRL');`,
      `delete from public.store_bank_accounts where store_id = :store_id;`,
      `select transfer_payment_enabled from public.stores where id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('un staff no puede escribir stores.transfer_payment_enabled directo por PostgREST (columna derivada, sin grant, igual que status/slug/online_payment_enabled)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, 'trflag-grant@example.com'),
        ...storeFixture('trflag-grant'),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
        ...asAuthenticated(userId, [`update public.stores set transfer_payment_enabled = true where id = :store_id;`]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })
})
