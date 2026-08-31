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
 * S-02 — grants por columna en `orders`.
 *
 * Con la policy vieja (`FOR ALL`), cualquier encargado con la publishable key
 * podía marcar un pedido online como pagado o pisar el total desde
 * PostgREST, sin que entrara plata. Verificado en la auditoría: 1 fila
 * afectada. Ahora `authenticated` solo tiene grant sobre `status`; el ciclo
 * del dinero (`payment_status`, `payment_ref`, `total_cents`, ...) lo escribe
 * el servidor con `createAdminClient()` detrás de un chequeo explícito.
 */
describe.skipIf(!dbAvailable)('S-02 — un staff solo puede mover orders.status, no el ciclo del dinero', () => {
  // Pedido en el local: nace 'pending' e impago, así que un UPDATE de status
  // a 'confirmed' es una transición válida sin chocar con la regla de "online
  // impago no confirma" — lo que se está probando acá es el grant, no la
  // máquina de estados (esa tiene su propio archivo).
  function fixture(prefix: string, userId: string) {
    return [
      createAuthUserSql(userId, `${prefix}@example.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  it('un staff no puede marcar un pedido online como pagado (orders.payment_status revocada)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('s02-pago', userId),
        ...asAuthenticated(userId, [`update public.orders set payment_status = 'approved' where id = :order_id;`]),
      ].join('\n'),
      /permission denied for table orders/,
    )
  })

  it('un staff no puede reescribir el total del pedido (orders.total_cents revocada)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('s02-total', userId),
        ...asAuthenticated(userId, [`update public.orders set total_cents = 1 where id = :order_id;`]),
      ].join('\n'),
      /permission denied for table orders/,
    )
  })

  it('un staff no puede pisar el public_token del pedido (orders.public_token revocada)', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        ...fixture('s02-token', userId),
        ...asAuthenticated(userId, [`update public.orders set public_token = 'x' where id = :order_id;`]),
      ].join('\n'),
      /permission denied for table orders/,
    )
  })

  it('un staff SÍ puede mover un pedido por la cocina (orders.status concedida)', () => {
    const userId = newUserId()
    const out = inTransaction(
      ...fixture('s02-status', userId),
      ...asAuthenticated(userId, [
        `update public.orders set status = 'confirmed' where id = :order_id;`,
        `select status from public.orders where id = :order_id;`,
      ]),
    )
    expect(out).toBe('confirmed')
  })
})

/**
 * Transferencia bancaria: las cinco columnas del comprobante NO ganaron
 * ningún grant (`00-architecture.md` §5.7 — "ningún grant nuevo"). Toda
 * escritura es `service_role` detrás de `storeTransferReceipt`/
 * `markPaidByTransfer`. Sin este candado, un staff con la publishable key
 * podría plantarle a su propio pedido un `transfer_receipt_uploaded_at`
 * fantasma por PostgREST directo — que es exactamente lo que el trigger de
 * inmutabilidad da por sentado que NADIE puede hacer salvo por acá.
 */
describe.skipIf(!dbAvailable)('S-02 — las columnas transfer_receipt_* de orders tampoco tienen grant para authenticated', () => {
  function transferFixture(prefix: string, userId: string) {
    return [
      createAuthUserSql(userId, `${prefix}@example.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'staff');`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  const columns: Array<{ name: string; slug: string; setClause: string }> = [
    { name: 'transfer_receipt_path', slug: 's02-tr-path', setClause: "transfer_receipt_path = 'x'" },
    { name: 'transfer_receipt_uploaded_at', slug: 's02-tr-uploaded', setClause: 'transfer_receipt_uploaded_at = now()' },
    { name: 'transfer_receipt_mime', slug: 's02-tr-mime', setClause: "transfer_receipt_mime = 'image/jpeg'" },
    { name: 'transfer_receipt_size', slug: 's02-tr-size', setClause: 'transfer_receipt_size = 123' },
    { name: 'transfer_receipt_sha256', slug: 's02-tr-sha', setClause: "transfer_receipt_sha256 = 'a'" },
  ]

  for (const { name, slug, setClause } of columns) {
    it(`un staff no puede escribir ${name} por PostgREST`, () => {
      const userId = newUserId()
      expectSqlToFail(
        [
          ...transferFixture(slug, userId),
          ...asAuthenticated(userId, [`update public.orders set ${setClause} where id = :order_id;`]),
        ].join('\n'),
        /permission denied for table orders/,
      )
    })
  }
})
