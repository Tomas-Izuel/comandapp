import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, Store } from '@/models/types'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * Aclaración del `code-reviewer` (integración final de la rama): el dev log
 * de T2 describía un helper `toEmailPaymentMethod()` que colapsaba
 * `'transfer'` a `'online'` antes de mandarlo al mail — ESE helper no existe
 * en el código integrado. En cambio, `EmailVars.paymentMethod`
 * (`email.port.ts`) se ensanchó a `'online' | 'in_store' | 'transfer'` y
 * `toReceiptEmailVars` (`checkout.controller.ts`) pasa `order.paymentMethod`
 * TAL CUAL. Este test cubre el comportamiento real: un pedido por
 * transferencia llega al comprobante por mail como `'transfer'` literal, no
 * colapsado a `'online'`.
 *
 * Aunque hoy ninguna plantilla lea ese campo para decidir texto (decide todo
 * por `paymentPending`, un booleano), el campo SÍ viaja en el payload que
 * `EmailSender.send()` recibe, y es lo que un futuro cambio de plantilla va a
 * leer — un valor colapsado ahí sería un bug silencioso que aparece recién
 * cuando alguien lo use.
 */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue({ status: 'sent' }) }))

vi.mock('@/services/notifications/email', () => ({
  getEmailSender: () => ({ send: sendMock }),
}))

const { sendReceiptEmail } = await import('@/controllers/checkout.controller')

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 555,
    storeId: 7,
    shortCode: 'AB12',
    publicToken: '23456789abcdefghjkmnpqrs',
    status: 'pending',
    customerName: 'Cliente Test',
    customerPhoneE164: '+5493511234567',
    customerEmail: 'cliente@example.com',
    notes: null,
    currency: 'ARS',
    subtotalCents: 10000,
    totalCents: 10000,
    etaMinutes: 10,
    etaAt: '2026-01-01T00:10:00.000Z',
    paymentMethod: 'transfer',
    paymentStatus: 'pending',
    paymentRef: null,
    externalRef: null,
    confirmedAt: null,
    paidAt: null,
    readyAt: null,
    deliveredAt: null,
    cancelledAt: null,
    needsRefundAt: null,
    refundReason: null,
    refundedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    deliveryMethod: 'pickup',
    deliveryFeeCents: 0,
    deliveryAddressLine: null,
    deliveryAddressUnit: null,
    deliveryAddressBetween: null,
    deliveryAddressNotes: null,
    deliveryMinutes: null,
    courierId: null,
    courier: null,
    assignedAt: null,
    onTheWayAt: null,
    items: [],
    scheduledFor: null,
    fireAt: null,
    scheduledNight: null,
    transferReceiptPath: null,
    transferReceiptUploadedAt: null,
    transferReceiptMime: null,
    transferReceiptSizeBytes: null,
    transferReceiptSha256: null,
    ...overrides,
  } as Order
}

function storeFixture(): Pick<Store, 'name' | 'slug' | 'address' | 'timezone'> {
  return { name: 'La Birra', slug: 'la-birra', address: 'Calle Falsa 123', timezone: 'America/Argentina/Cordoba' }
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ status: 'sent' })
})

describe('sendReceiptEmail — paymentMethod viaja literal, sin colapsar "transfer" a "online"', () => {
  it('un pedido por transferencia manda vars.paymentMethod === "transfer"', async () => {
    await sendReceiptEmail(orderFixture({ paymentMethod: 'transfer' }), storeFixture(), false)

    expect(sendMock).toHaveBeenCalledOnce()
    const call = sendMock.mock.calls[0][0] as { vars: { paymentMethod: string } }
    expect(call.vars.paymentMethod).toBe('transfer')
  })

  it('control: un pedido online sigue mandando "online" (no-regresión)', async () => {
    await sendReceiptEmail(orderFixture({ paymentMethod: 'online' }), storeFixture(), true)

    const call = sendMock.mock.calls[0][0] as { vars: { paymentMethod: string } }
    expect(call.vars.paymentMethod).toBe('online')
  })

  it('control: un pedido de pago en el local sigue mandando "in_store"', async () => {
    await sendReceiptEmail(orderFixture({ paymentMethod: 'in_store' }), storeFixture(), false)

    const call = sendMock.mock.calls[0][0] as { vars: { paymentMethod: string } }
    expect(call.vars.paymentMethod).toBe('in_store')
  })
})
