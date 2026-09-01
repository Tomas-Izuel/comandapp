import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `drainCampaignQueue`/`sendCampaignQuotaRequest`
 * (`src/services/notifications/email/campaign.tsx`). Mismo patrón que
 * `tests/services/owner-invite-email.adapter.test.ts`: `serverEnv()` cachea
 * por módulo, así que cada caso resetea `process.env` y hace
 * `vi.resetModules()` + `import()` dinámico. Resend y `campaign.model.ts`
 * (el borde real de Postgres) se mockean; el resto (armar el email, la clave
 * de idempotencia, el desglose de fallos) corre de verdad.
 */
const { batchSendMock, emailsSendMock, claimCampaignRecipientsMock, settleCampaignRecipientMock } = vi.hoisted(() => ({
  batchSendMock: vi.fn(),
  emailsSendMock: vi.fn(),
  claimCampaignRecipientsMock: vi.fn(),
  settleCampaignRecipientMock: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class MockResend {
    batch = { send: batchSendMock }
    emails = { send: emailsSendMock }
    constructor() {}
  },
}))

vi.mock('@/models/campaign.model', () => ({
  claimCampaignRecipients: claimCampaignRecipientsMock,
  settleCampaignRecipient: settleCampaignRecipientMock,
}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  NEXT_PUBLIC_SITE_URL: 'https://burgershop.test',
  CRON_SECRET: 'cron-secret',
}

const ENV_KEYS = [
  ...Object.keys(BASE_ENV),
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'RESEND_CAMPAIGN_FROM_EMAIL',
  'SALES_EMAIL',
] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  batchSendMock.mockReset()
  emailsSendMock.mockReset()
  claimCampaignRecipientsMock.mockReset()
  settleCampaignRecipientMock.mockReset().mockResolvedValue(undefined)
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadAdapter(env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_FROM_NAME', 'RESEND_CAMPAIGN_FROM_EMAIL', 'SALES_EMAIL'] as const) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  return import('@/services/notifications/email/campaign')
}

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    recipientId: 1,
    campaignId: 10,
    storeId: 7,
    chunkIndex: 0,
    email: 'cliente@test.com',
    customerName: 'Juan',
    unsubscribeToken: 'abc123token',
    storeName: 'La Birra',
    storeSlug: 'la-birra',
    subject: 'Promo de lanzamiento',
    message: null,
    couponCode: 'PROMO2026',
    discountType: 'percentage' as const,
    percent: 10,
    amountOffCents: null,
    maxDiscountCents: null,
    minSubtotalCents: 0,
    couponEndsAt: null,
    ...overrides,
  }
}

describe('drainCampaignQueue', () => {
  it('sin destinatarios reclamados, no llama a Resend y devuelve el resultado en cero', async () => {
    claimCampaignRecipientsMock.mockResolvedValue([])
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })

    const result = await drainCampaignQueue()

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 })
    expect(batchSendMock).not.toHaveBeenCalled()
  })

  it('sin RESEND_API_KEY: no llama a Resend, asienta cada destinatario como fallido (settleCampaignRecipient), y el cierre de la campaña NO lo hace este archivo', async () => {
    const rows = [claimRow({ recipientId: 1 }), claimRow({ recipientId: 2 })]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    const { drainCampaignQueue } = await loadAdapter({ RESEND_FROM_EMAIL: 'hola@test.com' })

    const result = await drainCampaignQueue()

    expect(result).toEqual({ claimed: 2, sent: 0, failed: 2 })
    expect(batchSendMock).not.toHaveBeenCalled()
    expect(settleCampaignRecipientMock).toHaveBeenCalledTimes(2)
    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 1, ok: false }))
    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 2, ok: false }))
  })

  it('sin ningún remitente configurado (ni RESEND_FROM_EMAIL ni RESEND_CAMPAIGN_FROM_EMAIL): tampoco llama a Resend', async () => {
    const rows = [claimRow()]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key' })

    const result = await drainCampaignQueue()

    expect(result.sent).toBe(0)
    expect(batchSendMock).not.toHaveBeenCalled()
  })

  it('camino feliz: llama a resend.batch.send con List-Unsubscribe + List-Unsubscribe-Post por destinatario, y asienta "sent" con el providerRef en el MISMO orden', async () => {
    const rows = [claimRow({ recipientId: 1, unsubscribeToken: 'tok1' }), claimRow({ recipientId: 2, unsubscribeToken: 'tok2' })]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    batchSendMock.mockResolvedValue({ data: [{ id: 'resend-1' }, { id: 'resend-2' }], error: null })
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })

    const result = await drainCampaignQueue()

    expect(result).toEqual({ claimed: 2, sent: 2, failed: 0 })
    expect(batchSendMock).toHaveBeenCalledTimes(1)
    const [emails] = batchSendMock.mock.calls[0] as [Array<{ headers: Record<string, string> }>]
    expect(emails[0].headers['List-Unsubscribe']).toContain('tok1/one-click')
    expect(emails[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(emails[1].headers['List-Unsubscribe']).toContain('tok2/one-click')

    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 1, ok: true, providerRef: 'resend-1' }),
    )
    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 2, ok: true, providerRef: 'resend-2' }),
    )
  })

  it('la clave de idempotencia depende del CONTENIDO del chunk (el set de recipientId), no solo del índice: mismo set en otro orden da la MISMA clave', async () => {
    batchSendMock.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })

    claimCampaignRecipientsMock.mockResolvedValue([claimRow({ recipientId: 1 }), claimRow({ recipientId: 2 })])
    const first = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })
    await first.drainCampaignQueue()
    const [, firstOptions] = batchSendMock.mock.calls[0] as [unknown, { idempotencyKey: string }]

    batchSendMock.mockClear()
    claimCampaignRecipientsMock.mockResolvedValue([claimRow({ recipientId: 2 }), claimRow({ recipientId: 1 })])
    const second = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })
    await second.drainCampaignQueue()
    const [, secondOptions] = batchSendMock.mock.calls[0] as [unknown, { idempotencyKey: string }]

    expect(firstOptions.idempotencyKey).toBe(secondOptions.idempotencyKey)
  })

  it('un chunk DISTINTO (otro recipientId) produce una clave de idempotencia DISTINTA', async () => {
    batchSendMock.mockResolvedValue({ data: [{ id: 'a' }], error: null })

    claimCampaignRecipientsMock.mockResolvedValue([claimRow({ recipientId: 1 })])
    const first = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })
    await first.drainCampaignQueue()
    const [, firstOptions] = batchSendMock.mock.calls[0] as [unknown, { idempotencyKey: string }]

    batchSendMock.mockClear()
    claimCampaignRecipientsMock.mockResolvedValue([claimRow({ recipientId: 99 })])
    const second = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })
    await second.drainCampaignQueue()
    const [, secondOptions] = batchSendMock.mock.calls[0] as [unknown, { idempotencyKey: string }]

    expect(firstOptions.idempotencyKey).not.toBe(secondOptions.idempotencyKey)
  })

  it('Resend rechaza el batch: asienta TODOS como fallidos con el mensaje de Resend, nunca tira', async () => {
    const rows = [claimRow({ recipientId: 1 }), claimRow({ recipientId: 2 })]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    batchSendMock.mockResolvedValue({ data: null, error: { message: 'batch inválido' } })
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })

    const result = await drainCampaignQueue()

    expect(result).toEqual({ claimed: 2, sent: 0, failed: 2 })
    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'batch inválido' }),
    )
  })

  it('un fallo de red (excepción) al llamar a Resend NUNCA propaga: se asienta como fallido', async () => {
    const rows = [claimRow({ recipientId: 1 })]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    batchSendMock.mockRejectedValue(new Error('ECONNRESET'))
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })

    await expect(drainCampaignQueue()).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 })
    expect(settleCampaignRecipientMock).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'ECONNRESET' }))
  })

  it('un fallo al asentar UN destinatario (settleCampaignRecipient tira) no aborta el resto del Promise.all', async () => {
    const rows = [claimRow({ recipientId: 1 }), claimRow({ recipientId: 2 })]
    claimCampaignRecipientsMock.mockResolvedValue(rows)
    batchSendMock.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    settleCampaignRecipientMock.mockImplementation(async (input: { recipientId: number }) => {
      if (input.recipientId === 1) throw new Error('boom asentando')
    })
    const { drainCampaignQueue } = await loadAdapter({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'hola@test.com' })

    await expect(drainCampaignQueue()).resolves.toEqual({ claimed: 2, sent: 2, failed: 0 })
    expect(settleCampaignRecipientMock).toHaveBeenCalledTimes(2)
  })
})

describe('sendCampaignQuotaRequest — la vía comercial de §5.10.6, degrada en vez de tirar', () => {
  function quotaInput(overrides: Record<string, unknown> = {}) {
    return {
      storeId: 7,
      storeName: 'La Birra',
      storeSlug: 'la-birra',
      ownerEmail: 'dueno@la-birra.test',
      customersTotal: 100,
      customersWithEmail: 40,
      campaignRecipients: 200,
      daysNeeded: 14,
      activeCoupons: 2,
      redemptionsLastMonth: 30,
      message: null,
      ...overrides,
    }
  }

  it('sin RESEND_API_KEY: skipped, no llama a Resend', async () => {
    const { sendCampaignQuotaRequest } = await loadAdapter({ RESEND_FROM_EMAIL: 'hola@test.com', SALES_EMAIL: 'ventas@test.com' })

    const result = await sendCampaignQuotaRequest(quotaInput())

    expect(result.status).toBe('skipped')
    expect(emailsSendMock).not.toHaveBeenCalled()
  })

  it('sin SALES_EMAIL: skipped (no hay a dónde mandarlo), aunque el resto esté configurado', async () => {
    const { sendCampaignQuotaRequest } = await loadAdapter({
      RESEND_API_KEY: 'key',
      RESEND_FROM_EMAIL: 'hola@test.com',
    })

    const result = await sendCampaignQuotaRequest(quotaInput())

    expect(result.status).toBe('skipped')
    expect(emailsSendMock).not.toHaveBeenCalled()
  })

  it('camino feliz: manda a SALES_EMAIL con replyTo al dueño', async () => {
    emailsSendMock.mockResolvedValue({ data: { id: 'ok' }, error: null })
    const { sendCampaignQuotaRequest } = await loadAdapter({
      RESEND_API_KEY: 'key',
      RESEND_FROM_EMAIL: 'hola@test.com',
      SALES_EMAIL: 'ventas@test.com',
    })

    const result = await sendCampaignQuotaRequest(quotaInput())

    expect(result.status).toBe('sent')
    expect(emailsSendMock).toHaveBeenCalledTimes(1)
    const [payload] = emailsSendMock.mock.calls[0] as [{ to: string[]; replyTo: string }]
    expect(payload.to).toEqual(['ventas@test.com'])
    expect(payload.replyTo).toBe('dueno@la-birra.test')
  })

  it('Resend rechaza: failed, con el mensaje de Resend', async () => {
    emailsSendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const { sendCampaignQuotaRequest } = await loadAdapter({
      RESEND_API_KEY: 'key',
      RESEND_FROM_EMAIL: 'hola@test.com',
      SALES_EMAIL: 'ventas@test.com',
    })

    const result = await sendCampaignQuotaRequest(quotaInput())

    expect(result).toEqual({ status: 'failed', error: 'rate limited' })
  })

  it('un fallo de red nunca tira: se traduce a { status: "failed" }', async () => {
    emailsSendMock.mockRejectedValue(new Error('ECONNRESET'))
    const { sendCampaignQuotaRequest } = await loadAdapter({
      RESEND_API_KEY: 'key',
      RESEND_FROM_EMAIL: 'hola@test.com',
      SALES_EMAIL: 'ventas@test.com',
    })

    const result = await sendCampaignQuotaRequest(quotaInput())

    expect(result.status).toBe('failed')
  })
})
