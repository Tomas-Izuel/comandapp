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
 * `updateOrderStatus` (`order.model.ts`) — el espejo en TypeScript del
 * predicado `<> 'in_store'` de `private.enforce_order_rules`
 * (`tests/db/order-state-machine.test.ts` prueba el lado de Postgres, que es
 * el que manda: esto es la UX, no la autorización real). Los dos tienen que
 * decir LO MISMO — si uno rechaza `payment_method='transfer'` y el otro no,
 * la UI ofrece un botón que el servidor va a rechazar, o peor, deja pasar
 * algo que Postgres bloquearía.
 */
const ORDER_ID = 555

function buildSessionMock(opts: {
  current: { status: string; payment_status: string; payment_method: string } | null
  updateRows?: { id: number }[]
}) {
  return {
    from: (table: string) => {
      if (table !== 'orders') throw new Error(`tabla inesperada: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.current, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => ({ data: opts.updateRows ?? [{ id: ORDER_ID }], error: null }),
            }),
          }),
        }),
      }
    },
  }
}

let currentMock: ReturnType<typeof buildSessionMock>

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => currentMock,
}))

const { updateOrderStatus } = await import('@/models/order.model')
const { DomainError } = await import('@/lib/errors')

describe('updateOrderStatus — "impago no confirma", espejo de <> \'in_store\'', () => {
  it('transfer impago (payment_status=pending) → confirmed rechaza con DomainError', async () => {
    currentMock = buildSessionMock({ current: { status: 'pending', payment_status: 'pending', payment_method: 'transfer' } })

    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).rejects.toThrow('Este pedido todavía no está pago')
    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).rejects.toBeInstanceOf(DomainError)
  })

  it('transfer YA aprobado (payment_status=approved) → confirmed pasa', async () => {
    currentMock = buildSessionMock({ current: { status: 'pending', payment_status: 'approved', payment_method: 'transfer' } })

    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).resolves.toBeUndefined()
  })

  it('online impago → confirmed rechaza (no-regresión, mismo criterio que transfer)', async () => {
    currentMock = buildSessionMock({ current: { status: 'pending', payment_status: 'pending', payment_method: 'online' } })

    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).rejects.toThrow('Este pedido todavía no está pago')
  })

  it('in_store impago → confirmed PASA — es el único método que confirma sin plata asegurada (cobro presencial)', async () => {
    currentMock = buildSessionMock({ current: { status: 'pending', payment_status: 'pending', payment_method: 'in_store' } })

    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).resolves.toBeUndefined()
  })

  it('una transición ilegal (pending → delivered) rechaza ANTES de evaluar la guarda de pago', async () => {
    currentMock = buildSessionMock({ current: { status: 'pending', payment_status: 'approved', payment_method: 'in_store' } })

    await expect(updateOrderStatus(ORDER_ID, 'delivered')).rejects.toThrow(/no puede pasar a/)
  })

  it('pedido inexistente → 404', async () => {
    currentMock = buildSessionMock({ current: null })
    await expect(updateOrderStatus(ORDER_ID, 'confirmed')).rejects.toMatchObject({ status: 404 })
  })
})
