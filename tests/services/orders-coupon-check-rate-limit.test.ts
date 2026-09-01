import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { RateLimitDecision } from '@/models/types'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `GET /api/orders` (cotización) — el balde `coupon_check:ip` (§5.13).
 *
 * Se mockea `priceCartForStore` (el borde real que decide `couponCodeMissing`)
 * y `consumeRateLimit` (el borde real de Postgres): lo que este archivo prueba
 * es la orquestación del route handler — el balde se cobra SOLO cuando el
 * código de cupón mandado no existe, nunca en una cotización sin cupón ni con
 * uno que existe pero está pausado/vencido/no aplica al método de pago. Sin
 * esta distinción, un cliente tocando "+" repetidas veces en su propio carrito
 * (la cotización dispara con cada cambio, sin debounce) se autobloquearía a
 * los 30 toques.
 */
const { consumeRateLimitMock, priceCartForStoreMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  priceCartForStoreMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))

vi.mock('@/controllers/checkout.controller', () => ({
  priceCartForStore: priceCartForStoreMock,
  submitOrder: vi.fn(),
}))

const { GET } = await import('@/app/api/orders/route')

function allow(): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: true, remaining: 29, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 600): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

function baseQuote(overrides: Record<string, unknown> = {}) {
  return {
    store: {
      slug: 'la-birra',
      name: 'La Birra',
      currency: 'ARS',
      acceptingOrders: true,
      inStorePaymentEnabled: true,
      onlinePaymentEnabled: true,
      transferPaymentEnabled: false,
      minOrderCents: 0,
    },
    priced: { items: [], subtotalCents: 10000, totalCents: 10000, discountCents: 0, coupon: null },
    eta: { minutes: 10, at: new Date().toISOString() },
    delivery: null,
    fullNights: [],
    couponCodeMissing: false,
    ...overrides,
  }
}

function getRequest(params: Record<string, string>): NextRequest {
  const url = new URL('https://burgershop.test/api/orders')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

function query(overrides: Record<string, string> = {}) {
  return {
    storeSlug: 'la-birra',
    items: JSON.stringify([{ productId: 1, quantity: 1, optionIds: [] }]),
    ...overrides,
  }
}

beforeEach(() => {
  consumeRateLimitMock.mockReset().mockImplementation(allow)
  priceCartForStoreMock.mockReset()
})

describe('GET /api/orders — coupon_check:ip solo se cobra cuando el código NO EXISTE', () => {
  it('sin couponCode en la query, nunca consume el balde', async () => {
    priceCartForStoreMock.mockResolvedValue(baseQuote({ couponCodeMissing: false }))

    const res = await GET(getRequest(query()))

    expect(res.status).toBe(200)
    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).not.toContain('coupon_check:ip')
  })

  it('con un código que EXISTE pero no aplica (pausado, vencido, método de pago, etc — couponCodeMissing: false), NO consume el balde', async () => {
    priceCartForStoreMock.mockResolvedValue(baseQuote({ couponCodeMissing: false }))

    const res = await GET(getRequest(query({ couponCode: 'PAUSADO1' })))

    expect(res.status).toBe(200)
    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).not.toContain('coupon_check:ip')
  })

  it('con un código que NO EXISTE (couponCodeMissing: true), consume el balde con el IP como subject', async () => {
    priceCartForStoreMock.mockResolvedValue(baseQuote({ couponCodeMissing: true }))

    const res = await GET(
      new NextRequest(
        `https://burgershop.test/api/orders?${new URLSearchParams({ ...query({ couponCode: 'NOEXISTE' }) }).toString()}`,
        { headers: { 'x-forwarded-for': '203.0.113.9' } },
      ),
    )

    expect(res.status).toBe(200)
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'coupon_check:ip', subject: '203.0.113.9' }),
    )
  })

  it('agotado el balde, responde 429 con Retry-After y NUNCA expone couponCodeMissing en el JSON', async () => {
    priceCartForStoreMock.mockResolvedValue(baseQuote({ couponCodeMissing: true }))
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'coupon_check:ip' ? deny(120) : allow(),
    )

    const res = await GET(getRequest(query({ couponCode: 'NOEXISTE' })))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('120')
    expect(JSON.stringify(body)).not.toContain('couponCodeMissing')
  })

  it('la cotización exitosa NUNCA expone el campo interno couponCodeMissing en el JSON de respuesta', async () => {
    priceCartForStoreMock.mockResolvedValue(baseQuote({ couponCodeMissing: false }))

    const res = await GET(getRequest(query()))
    const body = (await res.json()) as Record<string, unknown>

    expect(JSON.stringify(body)).not.toContain('couponCodeMissing')
  })
})
