import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `sendOwnerInviteEmail` (`src/services/notifications/email/owner-invite.tsx`)
 * es el mismo principio de resiliencia que el resto de los envíos del
 * proyecto: sin `RESEND_API_KEY`/`RESEND_FROM_EMAIL` devuelve `skipped` y
 * NUNCA tira. La tienda (o, en el reenvío, nada) ya existe cuando esto se
 * llama — que no salga el mail no puede romper esa transacción.
 *
 * `serverEnv()` cachea por módulo, así que cada caso re-setea `process.env` y
 * hace `vi.resetModules()` + `import()` dinámico (mismo patrón que
 * `tests/lib/secrets.test.ts`) para poder alternar "con key" / "sin key" en
 * el mismo archivo.
 */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: sendMock }
    constructor(_apiKey: string) {}
  },
}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  NEXT_PUBLIC_SITE_URL: 'https://burgershop.test',
  CRON_SECRET: 'cron-secret',
}

const ENV_KEYS = [...Object.keys(BASE_ENV), 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_FROM_NAME'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  sendMock.mockReset()
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadAdapter(env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string; RESEND_FROM_NAME?: string }) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_FROM_NAME'] as const) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  return import('@/services/notifications/email/owner-invite')
}

describe('sendOwnerInviteEmail — resiliencia sin RESEND_API_KEY / RESEND_FROM_EMAIL', () => {
  it('sin RESEND_API_KEY devuelve { status: "skipped" } y no llama a Resend', async () => {
    const { sendOwnerInviteEmail } = await loadAdapter({ RESEND_FROM_EMAIL: 'hola@burgershop.test' })

    const result = await sendOwnerInviteEmail({
      storeId: 1,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    expect(result.status).toBe('skipped')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sin RESEND_FROM_EMAIL (aunque haya API key) también devuelve "skipped"', async () => {
    const { sendOwnerInviteEmail } = await loadAdapter({ RESEND_API_KEY: 'una-key-cualquiera' })

    const result = await sendOwnerInviteEmail({
      storeId: 1,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    expect(result.status).toBe('skipped')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('con ambas variables configuradas, llama a Resend y devuelve "sent" con el providerRef', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-id-123' }, error: null })
    const { sendOwnerInviteEmail } = await loadAdapter({
      RESEND_API_KEY: 'una-key-cualquiera',
      RESEND_FROM_EMAIL: 'hola@burgershop.test',
    })

    const result = await sendOwnerInviteEmail({
      storeId: 7,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    expect(result).toEqual({ status: 'sent', providerRef: 'resend-id-123' })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('Resend responde con error (dominio no verificado, etc.) → "failed", nunca tira', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const { sendOwnerInviteEmail } = await loadAdapter({
      RESEND_API_KEY: 'una-key-cualquiera',
      RESEND_FROM_EMAIL: 'hola@burgershop.test',
    })

    const result = await sendOwnerInviteEmail({
      storeId: 7,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe('domain not verified')
  })

  it('un fallo de red (Resend tira una excepción) también se atrapa como "failed", nunca se propaga', async () => {
    sendMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'))
    const { sendOwnerInviteEmail } = await loadAdapter({
      RESEND_API_KEY: 'una-key-cualquiera',
      RESEND_FROM_EMAIL: 'hola@burgershop.test',
    })

    const result = await sendOwnerInviteEmail({
      storeId: 7,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    expect(result.status).toBe('failed')
  })

  it('el idempotencyKey mandado a Resend es determinístico por storeId (store-owner-invite/<id>) — un doble click no manda dos mails', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-id-999' }, error: null })
    const { sendOwnerInviteEmail } = await loadAdapter({
      RESEND_API_KEY: 'una-key-cualquiera',
      RESEND_FROM_EMAIL: 'hola@burgershop.test',
    })

    await sendOwnerInviteEmail({
      storeId: 99,
      to: 'dueno@la-birra.test',
      storeName: 'La Birra',
      inviteUrl: 'https://burgershop.test/admin/acceso/confirm?token_hash=x&type=email',
    })

    const options = sendMock.mock.calls[0]?.[1]
    expect(options).toEqual({ idempotencyKey: 'store-owner-invite/99' })
  })
})
