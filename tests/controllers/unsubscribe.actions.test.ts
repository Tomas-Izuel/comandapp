import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

const TOKEN = '23456789abcdefghjkmnpqrs'

const { findCustomerByUnsubscribeTokenMock, optOutByTokenMock, consumeRateLimitMock, headersGetMock } = vi.hoisted(() => ({
  findCustomerByUnsubscribeTokenMock: vi.fn(),
  optOutByTokenMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
  headersGetMock: vi.fn(() => null),
}))

vi.mock('@/models/customer.model', () => ({
  findCustomerByUnsubscribeToken: findCustomerByUnsubscribeTokenMock,
  optOutByToken: optOutByTokenMock,
}))
vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))
vi.mock('next/headers', () => ({ headers: async () => ({ get: headersGetMock }) }))

const { getUnsubscribeTargetAction, confirmUnsubscribeAction } = await import('@/controllers/unsubscribe.actions')

beforeEach(() => {
  vi.clearAllMocks()
  headersGetMock.mockReturnValue(null)
})

function allow() {
  consumeRateLimitMock.mockResolvedValueOnce({ allowed: true, remaining: 29, retryAfterSeconds: 0 })
}

function deny(retryAfterSeconds = 300) {
  consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds })
}

/**
 * `/baja/[token]` no lleva sesión: lo único que la protege de que alguien
 * camine el espacio de tokens es el balde `unsubscribe:ip` (fail-open,
 * 30/1h). Estos tests prueban el borde de la acción; el mecanismo de la baja
 * en sí (idempotencia, aislamiento por tienda) está en
 * `tests/models/customer.model.test.ts` y `tests/db/store-customers.test.ts`.
 */
describe('getUnsubscribeTargetAction', () => {
  it('un token inválido o inexistente da DomainError 404 — mismo mensaje para los dos casos (no es un oráculo)', async () => {
    allow()
    findCustomerByUnsubscribeTokenMock.mockResolvedValueOnce(null)

    const result = await getUnsubscribeTargetAction('token-cualquiera')

    expect(result).toMatchObject({ ok: false, error: 'Este link de baja no es válido' })
  })

  it('un token válido devuelve el nombre del local, nunca datos del cliente', async () => {
    allow()
    findCustomerByUnsubscribeTokenMock.mockResolvedValueOnce({ storeName: 'La Birra Burgers', alreadyOptedOut: false })

    const result = await getUnsubscribeTargetAction(TOKEN)

    expect(result).toEqual({ ok: true, data: { storeName: 'La Birra Burgers', alreadyOptedOut: false } })
  })

  it('el balde unsubscribe:ip agotado da un ActionResult<{ok:false}> con Retry-After humanizado, no una excepción sin capturar', async () => {
    deny(120)

    const result = await getUnsubscribeTargetAction(TOKEN)

    expect(result.ok).toBe(false)
    expect(findCustomerByUnsubscribeTokenMock).not.toHaveBeenCalled()
  })

  it('nunca ejecuta con optOutByToken — es de solo lectura (RFC 8058: un GET no puede dar de baja)', async () => {
    allow()
    findCustomerByUnsubscribeTokenMock.mockResolvedValueOnce({ storeName: 'La Birra Burgers', alreadyOptedOut: false })

    await getUnsubscribeTargetAction(TOKEN)

    expect(optOutByTokenMock).not.toHaveBeenCalled()
  })
})

describe('confirmUnsubscribeAction', () => {
  it('confirma la baja llamando a optOutByToken con el token', async () => {
    allow()
    optOutByTokenMock.mockResolvedValueOnce(undefined)

    const result = await confirmUnsubscribeAction(TOKEN)

    expect(result).toEqual({ ok: true, data: undefined })
    expect(optOutByTokenMock).toHaveBeenCalledWith(TOKEN)
  })

  it('nunca tira: el route handler de RFC 8058 depende de que esto SIEMPRE resuelva a un ActionResult, nunca a una excepción', async () => {
    allow()
    optOutByTokenMock.mockRejectedValueOnce(new Error('fallo interno inesperado'))

    const result = await confirmUnsubscribeAction(TOKEN)

    expect(result.ok).toBe(false)
  })

  it('el balde agotado también da ok:false en vez de tirar (el route.ts de RFC 8058 no tiene rama de error que manejar)', async () => {
    deny()

    const result = await confirmUnsubscribeAction(TOKEN)

    expect(result.ok).toBe(false)
    expect(optOutByTokenMock).not.toHaveBeenCalled()
  })
})
