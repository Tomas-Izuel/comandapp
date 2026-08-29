import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitDecision } from '@/models/types'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `POST /api/orders/lookup` — la ÚNICA lectura del plan que lleva límite de
 * aplicación (T3, criterio 8): acepta hasta 50 tokens por request, así que
 * frenar acá evita hasta 50 consultas de más por request bloqueado.
 */
const { consumeRateLimitMock, lookupOrdersMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  lookupOrdersMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))
vi.mock('@/controllers/checkout.controller', () => ({ lookupOrders: lookupOrdersMock }))

const { POST } = await import('@/app/api/orders/lookup/route')

const VALID_TOKEN = 'a'.repeat(24) // alfabeto de private.random_token: 'a' es válido

function allow(): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: true, remaining: 19, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 30): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

function lookupRequest(tokens: string[], ip = '203.0.113.5'): Request {
  return new Request('https://burgershop.test/api/orders/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ tokens }),
  })
}

beforeEach(() => {
  consumeRateLimitMock.mockReset()
  lookupOrdersMock.mockReset()
  consumeRateLimitMock.mockImplementation(allow)
  lookupOrdersMock.mockResolvedValue([])
})

describe('POST /api/orders/lookup — lookup:ip (20/60s)', () => {
  it('con cupo, consulta lookupOrders y devuelve 200', async () => {
    const res = await POST(lookupRequest([VALID_TOKEN]))

    expect(res.status).toBe(200)
    expect(lookupOrdersMock).toHaveBeenCalledWith([VALID_TOKEN])
  })

  it('más de 20 consultas en la ventana desde la misma IP → 429 con Retry-After, y NO llama a lookupOrders', async () => {
    consumeRateLimitMock.mockImplementation(() => deny())

    const res = await POST(lookupRequest([VALID_TOKEN]))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(body.error).toBeTruthy()
    expect(lookupOrdersMock).not.toHaveBeenCalled()
  })

  it('el subject del balde es la IP (x-forwarded-for), no un token ni un valor constante', async () => {
    await POST(lookupRequest([VALID_TOKEN], '198.51.100.9'))

    const call = consumeRateLimitMock.mock.calls[0]?.[0] as { bucket: string; subject: string }
    expect(call.bucket).toBe('lookup:ip')
    expect(call.subject).toBe('198.51.100.9')
  })

  it('un body inválido (token con formato inválido) da 400 y ni siquiera llega a consumir el balde', async () => {
    const res = await POST(lookupRequest(['esto-no-es-un-token-valido']))

    expect(res.status).toBe(400)
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
  })
})
