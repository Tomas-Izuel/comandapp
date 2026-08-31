import { describe, expect, it } from 'vitest'
import {
  asAnon,
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  uniqueSlug,
} from './helpers'

/**
 * `store_bank_accounts` — grants por COLUMNA (`00-architecture.md` §5.2). El
 * CBU tiene que ser público (el cliente necesita transferir); el CUIT
 * declarado y el resultado del contraste automático, NO. Es la misma
 * doctrina que `stores` no puede aplicar porque su `grant select` es de
 * TABLA (no se puede "restar" una columna después de otorgada) — por eso el
 * CBU vive en una tabla propia.
 *
 * Nada de esto tiene policy de INSERT/UPDATE/DELETE para nadie que no sea
 * `service_role`: toda escritura pasa por `requireStoreMembership(storeId,
 * { role: 'owner' })` + (para el CBU) el código de 6 dígitos.
 */
describe.skipIf(!dbAvailable)('store_bank_accounts — grants por columna', () => {
  function activeAccountFixture(prefix: string, overrides: { isActive?: boolean; storeStatus?: string } = {}) {
    const { isActive = true, storeStatus = 'active' } = overrides
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', '${storeStatus}') returning id \\gset store_`,
      `insert into public.store_bank_accounts (store_id, cbu, alias, holder_name, holder_tax_id, bank_name, is_active, holder_match, checked_at)
         values (:store_id, '0070325120000003733248', 'la.birra.pagos', 'La Birra SRL', '20111111112', 'Banco de Galicia', ${isActive}, 'unavailable', now());`,
    ]
  }

  it('anon puede leer cbu, alias, holder_name, bank_name de una cuenta activa de una tienda activa', () => {
    const out = inTransaction(
      ...activeAccountFixture('gba-anon-ok'),
      ...asAnon([`select cbu || '|' || alias || '|' || holder_name || '|' || bank_name from public.store_bank_accounts where store_id = :store_id;`]),
    )
    expect(out).toBe('0070325120000003733248|la.birra.pagos|La Birra SRL|Banco de Galicia')
  })

  it('anon NO puede leer holder_tax_id (42501/permission denied) aunque la fila sea visible por RLS', () => {
    expectSqlToFail(
      [...activeAccountFixture('gba-anon-cuit'), ...asAnon([`select holder_tax_id from public.store_bank_accounts where store_id = :store_id;`])].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('anon NO puede leer holder_match', () => {
    expectSqlToFail(
      [...activeAccountFixture('gba-anon-match'), ...asAnon([`select holder_match from public.store_bank_accounts where store_id = :store_id;`])].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('anon NO puede leer checked_at', () => {
    expectSqlToFail(
      [...activeAccountFixture('gba-anon-checked'), ...asAnon([`select checked_at from public.store_bank_accounts where store_id = :store_id;`])].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('anon no ve la fila si is_active = false, aunque pida solo las columnas permitidas', () => {
    const out = inTransaction(
      ...activeAccountFixture('gba-inactive', { isActive: false }),
      ...asAnon([`select count(*) from public.store_bank_accounts where store_id = :store_id;`]),
    )
    expect(out).toBe('0')
  })

  it('anon no ve la fila si la tienda está suspendida, aunque la cuenta esté is_active', () => {
    const out = inTransaction(
      ...activeAccountFixture('gba-suspended', { storeStatus: 'suspended' }),
      ...asAnon([`select count(*) from public.store_bank_accounts where store_id = :store_id;`]),
    )
    expect(out).toBe('0')
  })

  it('authenticated (staff logueado) tampoco puede insertar por PostgREST — toda escritura es service_role', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, 'gba-staff-insert@example.com'),
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('gba-staff-ins')}', 'Tienda', 'active') returning id \\gset store_`,
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
        ...asAuthenticated(userId, [
          `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'Cualquiera');`,
        ]),
      ].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('authenticated (incluso el DUEÑO) no puede update por PostgREST — el candado de código vive del lado de la app, no de RLS', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, 'gba-owner-update@example.com'),
        ...activeAccountFixture('gba-owner-upd'),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
        ...asAuthenticated(userId, [`update public.store_bank_accounts set is_active = false where store_id = :store_id;`]),
      ].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('authenticated no puede delete por PostgREST', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, 'gba-owner-delete@example.com'),
        ...activeAccountFixture('gba-owner-del'),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
        ...asAuthenticated(userId, [`delete from public.store_bank_accounts where store_id = :store_id;`]),
      ].join('\n'),
      /permission denied for table store_bank_accounts/,
    )
  })

  it('service_role SÍ puede insert/update/delete — es el camino real detrás de requireStoreMembership + el código', () => {
    const out = inTransaction(
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('gba-svc')}', 'Tienda', 'active') returning id \\gset store_`,
      'set local role service_role;',
      `insert into public.store_bank_accounts (store_id, cbu, holder_name) values (:store_id, '0070325120000003733248', 'La Birra SRL');`,
      `update public.store_bank_accounts set is_active = false where store_id = :store_id;`,
      `select is_active from public.store_bank_accounts where store_id = :store_id;`,
    )
    expect(out).toBe('f')
  })

  it('sin CBU ni alias, el CHECK store_bank_accounts_has_identifier_check rebota (D3)', () => {
    expectSqlToFail(
      [
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('gba-noid')}', 'Tienda', 'active') returning id \\gset store_`,
        `insert into public.store_bank_accounts (store_id, holder_name) values (:store_id, 'La Birra SRL');`,
      ].join('\n'),
      /store_bank_accounts_has_identifier_check/,
    )
  })

  it('D3: SOLO alias (sin cbu) entra — es la decisión del dueño, no un error', () => {
    const out = inTransaction(
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('gba-onlyalias')}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.store_bank_accounts (store_id, alias, holder_name) values (:store_id, 'la.birra.pagos', 'La Birra SRL') returning cbu is null;`,
    )
    expect(out).toBe('t')
  })
})
