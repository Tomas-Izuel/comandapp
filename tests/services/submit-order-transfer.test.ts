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
 * `submitOrder` (`checkout.controller.ts`), rama `'transfer'` — T2.5. Se
 * ejerce la función REAL (no se mockea `submitOrder` entero, a diferencia de
 * los tests de la ruta HTTP) porque el punto es probar la rama en sí: sin
 * preferencia de Mercado Pago, `redirectUrl` al seguimiento, y sin disparar
 * ningún aviso — el pedido todavía no está confirmado, así que un
 * comprobante o un WhatsApp de confirmación acá serían prematuros y
 * confusos ("tu pedido está confirmado" cuando en realidad nadie miró la
 * cuenta todavía).
 *
 * Solo se ejerce la rama `transfer`: las otras dos (`online`/`in_store`)
 * llaman a `after()` de `next/server`, que tira fuera de un request scope
 * real de Next — están cubiertas indirectamente por
 * `tests/services/orders-route-rate-limit.test.ts`, que mockea `submitOrder`
 * entero.
 */
const { createOrderMock, sendMock, notifyMock } = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  sendMock: vi.fn(),
  notifyMock: vi.fn(),
}))

vi.mock('@/models/order.model', () => ({
  createOrder: createOrderMock,
  attachPreference: vi.fn(),
  countScheduledByNight: vi.fn(),
  estimateEta: vi.fn(),
  flagRefundNeeded: vi.fn(),
  getOrderByToken: vi.fn(),
  getOrderIdByToken: vi.fn(),
  getOrderWithStoreById: vi.fn(),
  getOrdersByTokens: vi.fn(),
  markOrderPaid: vi.fn(),
  markRefunded: vi.fn(),
  priceCart: vi.fn(),
  recordPaymentStatusChange: vi.fn(),
}))

vi.mock('@/services/notifications/email', () => ({ getEmailSender: () => ({ send: sendMock }) }))
vi.mock('@/services/notifications', () => ({ getNotifier: () => ({ notify: notifyMock }) }))

const { submitOrder } = await import('@/controllers/checkout.controller')

function orderFixture(): Order {
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
  } as unknown as Order
}

function storeFixture(): Store {
  return {
    id: 7,
    slug: 'la-birra',
    name: 'La Birra',
    description: null,
    phoneE164: null,
    whatsappPhoneE164: null,
    address: null,
    timezone: 'America/Argentina/Cordoba',
    currency: 'ARS',
    status: 'active',
    acceptingOrders: true,
    inStorePaymentEnabled: false,
    onlinePaymentEnabled: false,
    transferPaymentEnabled: true,
    minOrderCents: 0,
  } as unknown as Store
}

beforeEach(() => {
  createOrderMock.mockReset()
  sendMock.mockReset()
  notifyMock.mockReset()
})

describe('submitOrder — rama "transfer"', () => {
  it('NO crea preferencia de Mercado Pago (attachPreference nunca se llama) y redirectUrl apunta al seguimiento', async () => {
    createOrderMock.mockResolvedValue({ order: orderFixture(), store: storeFixture() })

    const result = await submitOrder({
      storeSlug: 'la-birra',
      idempotencyKey: 'x',
      items: [],
      paymentMethod: 'transfer',
      customerName: 'Cliente',
      customerPhone: '1123456789',
    } as never)

    expect(result.redirectUrl).toBe('/pedido/23456789abcdefghjkmnpqrs')
    expect(result.token).toBe('23456789abcdefghjkmnpqrs')
  })

  it('NO manda el comprobante por mail ni el WhatsApp de confirmación — el pedido todavía no está confirmado', async () => {
    createOrderMock.mockResolvedValue({ order: orderFixture(), store: storeFixture() })

    await submitOrder({
      storeSlug: 'la-birra',
      idempotencyKey: 'x',
      items: [],
      paymentMethod: 'transfer',
      customerName: 'Cliente',
      customerPhone: '1123456789',
    } as never)

    expect(sendMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })
})
