import { describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `markPaidByTransfer` (`order.model.ts`) — el árbitro del "doble cobro" de
 * una transferencia. Dos redes distintas y este archivo prueba las dos por
 * separado: el CAS sobre `orders` (`.eq('payment_status','pending')`, calcado
 * de `markPaidInStore`) y el índice único de `payments` para el caso en que
 * el CAS no alcanzara a cubrir la carrera.
 */
const ORDER_ID = 555
const STORE_ID = 7

function orderWithItemsFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    store_id: STORE_ID,
    short_code: 'AB12',
    public_token: '23456789abcdefghjkmnpqrs',
    status: 'pending',
    customer_name: 'Cliente Test',
    customer_phone_e164: '+5493511234567',
    customer_email: null,
    notes: null,
    currency: 'ARS',
    subtotal_cents: 10000,
    total_cents: 10000,
    base_prep_minutes: 10,
    demand_multiplier: '1.00',
    eta_minutes: 10,
    eta_at: '2026-01-01T00:10:00.000Z',
    payment_method: 'transfer',
    payment_status: 'approved',
    preference_id: null,
    preference_expires_at: null,
    payment_ref: 'transfer',
    external_ref: null,
    confirmed_at: null,
    paid_at: '2026-01-01T00:05:00.000Z',
    ready_at: null,
    delivered_at: null,
    cancelled_at: null,
    needs_refund_at: null,
    refund_reason: null,
    refunded_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    delivery_method: 'pickup',
    delivery_fee_cents: 0,
    delivery_address_line: null,
    delivery_address_unit: null,
    delivery_address_between: null,
    delivery_address_notes: null,
    delivery_minutes: null,
    courier_id: null,
    courier: null,
    assigned_at: null,
    on_the_way_at: null,
    order_items: [],
    scheduled_for: null,
    fire_at: null,
    scheduled_night: null,
    transfer_receipt_path: null,
    transfer_receipt_uploaded_at: null,
    transfer_receipt_mime: null,
    transfer_receipt_size: null,
    transfer_receipt_sha256: null,
    ...overrides,
  }
}

type AdminMockOpts = {
  /** `null` simula el CAS perdiendo la carrera (0 filas afectadas). */
  updatedOrderRow: Record<string, unknown> | null
  paymentInsertError?: { code?: string; message: string } | null
}

function buildAdminMock(opts: AdminMockOpts) {
  const paymentsInsertMock = vi.fn(async (row: Record<string, unknown>) => {
    void row
    return { error: opts.paymentInsertError ?? null }
  })

  return {
    admin: {
      from: (table: string) => {
        if (table === 'orders') {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: opts.updatedOrderRow, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'payments') {
          return { insert: paymentsInsertMock }
        }
        throw new Error(`tabla admin inesperada en el test: ${table}`)
      },
    },
    paymentsInsertMock,
  }
}

let currentMock: ReturnType<typeof buildAdminMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => currentMock.admin,
}))

const { markPaidByTransfer } = await import('@/models/order.model')

function input(overrides: Partial<{ reference: string | null }> = {}) {
  return { storeId: STORE_ID, orderId: ORDER_ID, reference: null, confirmedBy: 'staff-uid', ...overrides }
}

describe('markPaidByTransfer — el CAS sobre orders es la primera red contra el doble cobro', () => {
  it('CAS perdido (0 filas: ya estaba approved, o no es transfer, o es de otra tienda) ⇒ 409, no 500', async () => {
    currentMock = buildAdminMock({ updatedOrderRow: null })

    await expect(markPaidByTransfer(input())).rejects.toMatchObject({ status: 409 })
    expect(currentMock.paymentsInsertMock).not.toHaveBeenCalled() // nunca llega a insertar el pago
  })

  it('camino feliz: CAS gana, inserta en payments con provider=transfer y amount_cents=totalCents', async () => {
    currentMock = buildAdminMock({ updatedOrderRow: orderWithItemsFixture() })

    const order = await markPaidByTransfer(input({ reference: 'op-12345' }))

    expect(order.id).toBe(ORDER_ID)
    expect(currentMock.paymentsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: ORDER_ID,
        store_id: STORE_ID,
        provider: 'transfer',
        provider_payment_id: `order:${ORDER_ID}`,
        status: 'approved',
        amount_cents: 10000,
      }),
    )
  })

  it('SIN número de operación (reference: null) igual funciona — no exige comprobante ni referencia (00-architecture.md §5.9)', async () => {
    currentMock = buildAdminMock({ updatedOrderRow: orderWithItemsFixture() })

    await expect(markPaidByTransfer(input({ reference: null }))).resolves.toBeDefined()
    const call = currentMock.paymentsInsertMock.mock.calls[0][0] as { raw: { reference: string | null } }
    expect(call.raw.reference).toBeNull()
  })

  it('segunda red: el índice único de payments (23505) también se traduce a 409, no a un 500 con el mensaje crudo de Postgres', async () => {
    currentMock = buildAdminMock({
      updatedOrderRow: orderWithItemsFixture(),
      paymentInsertError: { code: '23505', message: 'duplicate key value violates unique constraint "payments_one_approved_per_order_idx"' },
    })

    await expect(markPaidByTransfer(input())).rejects.toMatchObject({ status: 409 })
  })

  it('un error de Postgres que NO es la unicidad (ej. conexión caída) propaga un error real, no un 409 de dominio', async () => {
    currentMock = buildAdminMock({
      updatedOrderRow: orderWithItemsFixture(),
      paymentInsertError: { message: 'connection reset' },
    })

    const promise = markPaidByTransfer(input())
    await expect(promise).rejects.toThrow(/No se pudo registrar el pago/)
  })
})
