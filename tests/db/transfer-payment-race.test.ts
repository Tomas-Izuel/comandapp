import { describe, expect, it } from 'vitest'
import { dbAvailable, sql, sqlConcurrently, uniqueSlug } from './helpers'

/**
 * La carrera real de "dos operarios tocando Confirmar pago a la vez"
 * (`markPaidByTransfer`, `order.model.ts`). La primera red —y la que de
 * verdad arbitra la carrera, según el dev log de T2— es el CAS sobre
 * `orders`: `UPDATE ... WHERE payment_status = 'pending'`. Postgres serializa
 * las dos transacciones a nivel de fila, así que como MUCHO una de N
 * confirmaciones concurrentes puede ganar.
 *
 * Se prueba la sentencia SQL exacta que ejecuta `markPaidByTransfer`
 * (mismos cuatro `.eq()`), con conexiones REALES en paralelo
 * (`sqlConcurrently`, un proceso `psql` por conexión) — no secuencialmente:
 * un `for` que dispara N updates uno atrás del otro nunca ejercería el lock
 * de fila, y un bug en el WHERE (por ejemplo, sin `payment_status='pending'`)
 * pasaría el test igual.
 *
 * No se prueba acá el segundo insert en `payments` (el índice único) porque
 * ahora mismo `payments_provider_check` rechaza `provider='transfer'` — bug
 * real reportado aparte. El CAS de `orders`, que es el que arbitra la
 * carrera según la propia decisión de diseño de T2, no depende de esa tabla
 * y se puede probar igual.
 */
describe.skipIf(!dbAvailable)('markPaidByTransfer — la carrera real sobre orders (CAS), con paralelismo real', () => {
  it('N confirmaciones concurrentes del MISMO pedido: exactamente UNA gana el UPDATE, el resto ve 0 filas', async () => {
    const N = 6
    const slug = uniqueSlug('tr-race')
    const storeId = sql(`insert into public.stores (slug, name, status) values ('${slug}', 'Tienda', 'active') returning id;`)
    const orderId = sql(
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (${storeId}, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000)
       returning id;`,
    )

    try {
      const casUpdate = () =>
        `update public.orders
            set payment_status = 'approved', payment_ref = 'transfer', paid_at = now()
          where id = ${orderId}
            and store_id = ${storeId}
            and payment_method = 'transfer'
            and payment_status = 'pending'
          returning id;`

      const results = await sqlConcurrently(Array.from({ length: N }, () => casUpdate()))

      // El que gana devuelve el id (RETURNING de una fila); el resto no
      // afecta ninguna fila y `psql -t -A` devuelve un string vacío.
      const winners = results.filter((r) => r.trim() !== '')
      const losers = results.filter((r) => r.trim() === '')

      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(N - 1)
      expect(winners[0].trim()).toBe(String(orderId))

      // Y el estado final de la fila confirma que solo se aplicó una vez:
      // no quedó en un estado intermedio raro por dos escrituras pisándose.
      const finalStatus = sql(`select payment_status from public.orders where id = ${orderId};`)
      expect(finalStatus).toBe('approved')
    } finally {
      // Fuera de begin/rollback (conexiones concurrentes de verdad): limpieza manual.
      sql(`delete from public.orders where id = ${orderId}; delete from public.stores where id = ${storeId};`)
    }
  })
})

/**
 * La misma técnica, para la otra carrera del feature: dos subidas
 * SIMULTÁNEAS del comprobante del mismo pedido (`storeTransferReceipt`,
 * T2.2). El CAS es `WHERE transfer_receipt_uploaded_at IS NULL`, y "un
 * comprobante por pedido" depende de que como MUCHO una gane. El trigger de
 * Postgres (`tests/db/transfer-receipt-immutable.test.ts`) prueba que ni
 * siquiera `service_role` puede REEMPLAZAR un valor ya seteado; esto prueba
 * que, cuando el valor arranca en NULL, dos escrituras concurrentes a él
 * no pueden colar las dos.
 */
describe.skipIf(!dbAvailable)('storeTransferReceipt — la carrera de la subida del comprobante (CAS), con paralelismo real', () => {
  it('N subidas concurrentes al MISMO pedido: exactamente UNA gana el UPDATE de transfer_receipt_uploaded_at', async () => {
    const N = 6
    const slug = uniqueSlug('tr-receipt-race')
    const storeId = sql(`insert into public.stores (slug, name, status) values ('${slug}', 'Tienda', 'active') returning id;`)
    const orderId = sql(
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (${storeId}, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'transfer', 'pending', 1000, 1000)
       returning id;`,
    )

    try {
      const casUpdate = (i: number) =>
        `update public.orders
            set transfer_receipt_path = '${storeId}/${orderId}/comprobante',
                transfer_receipt_uploaded_at = now(),
                transfer_receipt_mime = 'image/jpeg',
                transfer_receipt_size = ${100 + i},
                transfer_receipt_sha256 = repeat('${String(i)}', 64)
          where id = ${orderId}
            and transfer_receipt_uploaded_at is null
          returning id;`

      const results = await sqlConcurrently(Array.from({ length: N }, (_, i) => casUpdate(i)))

      const winners = results.filter((r) => r.trim() !== '')
      expect(winners).toHaveLength(1)
      expect(winners[0].trim()).toBe(String(orderId))

      const uploadedCount = sql(
        `select count(*) from public.orders where id = ${orderId} and transfer_receipt_uploaded_at is not null;`,
      )
      expect(uploadedCount).toBe('1')
    } finally {
      sql(`delete from public.orders where id = ${orderId}; delete from public.stores where id = ${storeId};`)
    }
  })
})
