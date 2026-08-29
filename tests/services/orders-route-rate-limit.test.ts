import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { RateLimitDecision } from '@/models/types'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `POST /api/orders` (`src/app/api/orders/route.ts`) — T3 de rate-limiting.
 * Se mockean `submitOrder` (el borde real de creación de pedido) y
 * `consumeRateLimit` (el borde real de Postgres): lo que este archivo prueba
 * es `enforceOrderRateLimits`, que es lógica pura de orquestación —en qué
 * orden se consumen los baldes, cuál bloquea y cuál no, qué pasa con el 429—.
 *
 * Lo que necesita concurrencia real (que el candado `order:idempotency` deje
 * a lo sumo un cupo real gastado de N reintentos concurrentes) lo prueba
 * `tests/db/consume-rate-limit.test.ts` contra Postgres de verdad: un mock no
 * puede demostrar una condición de carrera, solo simular su resultado.
 */
const { consumeRateLimitMock, submitOrderMock, priceCartForStoreMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  submitOrderMock: vi.fn(),
  priceCartForStoreMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))

vi.mock('@/controllers/checkout.controller', () => ({
  submitOrder: submitOrderMock,
  priceCartForStore: priceCartForStoreMock,
}))

const { POST } = await import('@/app/api/orders/route')

function allow(): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: true, remaining: 99, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 60): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

function orderBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    storeSlug: 'la-birra',
    idempotencyKey: randomUUID(),
    items: [{ productId: 1, quantity: 1, optionIds: [] }],
    customerName: 'Juan Pérez',
    customerPhone: '1123456789',
    ...overrides,
  }
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('https://burgershop.test/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  consumeRateLimitMock.mockReset()
  submitOrderMock.mockReset()
  priceCartForStoreMock.mockReset()
  consumeRateLimitMock.mockImplementation(allow)
  submitOrderMock.mockResolvedValue({ token: 'tok', shortCode: 'A7K2' })
})

describe('POST /api/orders — orden de los baldes: idempotency → phone → store', () => {
  it('consume order:idempotency PRIMERO, y si deja pasar, después order:phone y order:store', async () => {
    await POST(postRequest(orderBody()))

    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['order:idempotency', 'order:phone', 'order:store'])
  })

  it('order:idempotency NO permite (reintento de la misma compra): NUNCA llega a consumir order:phone ni order:store, y el pedido se crea igual (201)', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'order:idempotency' ? deny() : allow(),
    )

    const res = await POST(postRequest(orderBody()))

    expect(res.status).toBe(201)
    expect(submitOrderMock).toHaveBeenCalledOnce()
    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['order:idempotency']) // ni :phone ni :store
  })
})

describe('POST /api/orders — order:phone SÍ bloquea', () => {
  it('con order:phone agotado, responde 429 con Retry-After y un mensaje en castellano que dice qué hacer, y NO crea el pedido', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'order:phone' ? deny(45) : allow(),
    )

    const res = await POST(postRequest(orderBody()))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('45')
    expect(body.error.toLowerCase()).toMatch(/esper|momento|seguido/)
    expect(submitOrderMock).not.toHaveBeenCalled() // el pedido nº 6 no crea fila ni preferencia de MP
  })
})

describe('POST /api/orders — order:store NUNCA bloquea (detector de anomalía, no un límite)', () => {
  it('con order:store por encima del umbral, responde 201 igual (no 429) y deja un log.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'order:store' ? deny() : allow(),
    )

    const res = await POST(postRequest(orderBody()))

    expect(res.status).toBe(201)
    expect(submitOrderMock).toHaveBeenCalledOnce()
    const logged = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).toContain('order:store')
    vi.restoreAllMocks()
  })

  it('AISLAMIENTO MULTI-TENANT: el subject de order:store es el storeSlug — agotar el balde de una tienda no es ni siquiera el mismo sujeto que el de otra', async () => {
    await POST(postRequest(orderBody({ storeSlug: 'la-birra' })))
    await POST(postRequest(orderBody({ storeSlug: 'otra-tienda' })))

    const subjects = consumeRateLimitMock.mock.calls
      .map((c) => c[0] as { bucket: string; subject: string })
      .filter((c) => c.bucket === 'order:store')
      .map((c) => c.subject)
    expect(subjects).toEqual(['la-birra', 'otra-tienda'])
  })
})

describe('POST /api/orders — cero PII en los logs de rate limit', () => {
  it('el log.warn de order:phone NO lleva el teléfono', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'order:phone' ? deny() : allow(),
    )

    await POST(postRequest(orderBody({ customerPhone: '1155554444' })))

    const logged = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('1155554444')
    expect(logged).not.toContain('5554444')
    vi.restoreAllMocks()
  })

  it('el log.warn de order:store NO lleva el teléfono ni el nombre del cliente, solo el slug (que ya es público)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'order:store' ? deny() : allow(),
    )

    await POST(postRequest(orderBody({ customerName: 'Nombre Secreto', customerPhone: '1155554444' })))

    const logged = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('1155554444')
    expect(logged).not.toContain('Nombre Secreto')
    vi.restoreAllMocks()
  })
})

describe('POST /api/orders — validación de forma sigue corriendo ANTES que cualquier balde', () => {
  it('un body inválido (falta customerName) da 400 y no consume ningún balde', async () => {
    const res = await POST(postRequest(orderBody({ customerName: undefined })))

    expect(res.status).toBe(400)
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
    expect(submitOrderMock).not.toHaveBeenCalled()
  })
})
