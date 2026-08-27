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
 * S-01 — grants por columna en `stores`.
 *
 * Antes de la migración de hardening, la policy de staff era `FOR ALL`: un
 * grant de tabla es todo o nada sobre las columnas, así que un encargado
 * podía reactivar su propia tienda suspendida por la plataforma o robarse el
 * slug `admin`. Verificado en la auditoría contra el stack local: el
 * `PATCH /rest/v1/stores` devolvía 1 fila.
 *
 * Ahora `status` y `slug` están revocados por columna para `authenticated`:
 * son de la plataforma, y el backoffice los escribe con `createAdminClient()`.
 */
describe.skipIf(!dbAvailable)('S-01 — un staff no puede tocar stores.status ni stores.slug', () => {
  function fixture(prefix: string, userId: string) {
    return [
      createAuthUserSql(userId, `${prefix}@example.com`),
      `insert into public.stores (slug, name, status)
         values ('${uniqueSlug(prefix)}', 'Tienda de test', 'active')
       returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
    ]
  }

  it('un staff no puede reactivar su propia tienda suspendida ni suspenderla (stores.status revocada)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('s01-status', userId),
        ...asAuthenticated(userId, [`update public.stores set status = 'suspended' where id = :store_id;`]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })

  it('un staff no puede cambiar el slug de su tienda a uno reservado como "admin" (stores.slug revocada)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('s01-slug', userId),
        ...asAuthenticated(userId, [`update public.stores set slug = 'admin' where id = :store_id;`]),
      ].join('\n'),
      /permission denied for table stores/,
    )
  })

  it('un staff SÍ puede cambiar el nombre de su tienda', () => {
    const userId = newUserId()
    const out = inTransaction(
      ...fixture('s01-name', userId),
      ...asAuthenticated(userId, [
        `update public.stores set name = 'Nombre nuevo' where id = :store_id;`,
        `select name from public.stores where id = :store_id;`,
      ]),
    )
    expect(out).toBe('Nombre nuevo')
  })

  it('un staff que NO es miembro de la tienda no puede tocarla, aunque la columna esté permitida (RLS, no solo el grant)', () => {
    const userId = newUserId()
    // El UPDATE no tira error: la policy `stores_staff_update` filtra por
    // `is_store_member(id)`, así que para alguien ajeno la fila simplemente no
    // matchea y el UPDATE afecta 0 filas. Por eso se verifica leyendo de
    // nuevo, no con expectSqlToFail — acá no hay excepción que capturar, el
    // silencio ES el bug si algo sale mal.
    const out = inTransaction(
      createAuthUserSql(userId, 'no-miembro@example.com'),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('s01-ajena')}', 'Ajena', 'active') returning id \\gset store_`,
      ...asAuthenticated(userId, [`update public.stores set name = 'hackeada' where id = :store_id;`]),
      `select name from public.stores where id = :store_id;`,
    )
    expect(out).toBe('Ajena')
  })
})
