import { describe, expect, it } from 'vitest'
import { dbAvailable, expectSqlToFail, inTransaction, uniqueSlug } from './helpers'

/**
 * "Un comprobante por pedido" — la invariante que sostiene toda la decisión
 * D6 del dueño ("el límite es no subir más de una imagen"). Vive en
 * `private.enforce_order_rules`: `transfer_receipt_uploaded_at` es inmutable
 * una vez no nula. Es la ÚNICA capa que sobrevive a alguien pegándole
 * directo a PostgREST con el `service_role` (el CAS de la aplicación,
 * `storeTransferReceipt`, se puede saltear con un cliente propio; esto no).
 *
 * Corre como `postgres` (superusuario, mismos privilegios que `service_role`)
 * a propósito: el punto es que ni siquiera el servidor puede reemplazar un
 * comprobante ya subido, ni por accidente ni por un bug.
 */
describe.skipIf(!dbAvailable)('transfer_receipt_uploaded_at — inmutable una vez no nula (private.enforce_order_rules)', () => {
  function transferOrderWithReceipt(prefix: string) {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents,
                                  transfer_receipt_path, transfer_receipt_uploaded_at, transfer_receipt_mime, transfer_receipt_size, transfer_receipt_sha256)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000,
                 'x/1/comprobante', now() - interval '5 minutes', 'image/jpeg', 12345, repeat('a', 64))
       returning id \\gset order_`,
    ]
  }

  function transferOrderNoReceipt(prefix: string) {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000)
       returning id \\gset order_`,
    ]
  }

  it('cambiar transfer_receipt_uploaded_at cuando YA tenía valor rebota, incluso corriendo como el superusuario (service_role)', () => {
    expectSqlToFail(
      [
        ...transferOrderWithReceipt('tri-change'),
        `update public.orders set transfer_receipt_uploaded_at = now() where id = :order_id;`,
      ].join('\n'),
      /ya tiene un comprobante: no se puede reemplazar/,
    )
  })

  it('la PRIMERA subida (de null a un valor) SÍ está permitida — es el camino normal de storeTransferReceipt', () => {
    const out = inTransaction(
      ...transferOrderNoReceipt('tri-first'),
      `update public.orders set transfer_receipt_uploaded_at = now(), transfer_receipt_path = 'x/1/comprobante' where id = :order_id;`,
      `select transfer_receipt_uploaded_at is not null from public.orders where id = :order_id;`,
    )
    expect(out).toBe('t')
  })

  it('nulear transfer_receipt_path (la purga) SIN tocar uploaded_at está permitido', () => {
    const out = inTransaction(
      ...transferOrderWithReceipt('tri-purge'),
      `update public.orders set transfer_receipt_path = null, transfer_receipt_mime = null where id = :order_id;`,
      `select transfer_receipt_path is null and transfer_receipt_uploaded_at is not null from public.orders where id = :order_id;`,
    )
    expect(out).toBe('t')
  })

  it('un UPDATE que no toca transfer_receipt_uploaded_at para nada (por ejemplo, otra columna cualquiera) no se ve afectado por esta guarda', () => {
    const out = inTransaction(
      ...transferOrderWithReceipt('tri-untouched'),
      `update public.orders set notes = 'una nota cualquiera' where id = :order_id;`,
      `select notes from public.orders where id = :order_id;`,
    )
    expect(out).toBe('una nota cualquiera')
  })

  it('poner transfer_receipt_uploaded_at en NULL de vuelta (intentar "deshacer" la subida) también rebota', () => {
    expectSqlToFail(
      [
        ...transferOrderWithReceipt('tri-unset'),
        `update public.orders set transfer_receipt_uploaded_at = null where id = :order_id;`,
      ].join('\n'),
      /ya tiene un comprobante: no se puede reemplazar/,
    )
  })
})
