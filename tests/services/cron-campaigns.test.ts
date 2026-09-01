import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `/api/cron/campaigns` — el drenaje de campañas de cupón, disparado por
 * pg_cron cada 5 minutos (§5.10.3). Mismo esquema de auth que los otros
 * crons (`CRON_SECRET` en tiempo constante): este archivo prueba el 401 sin
 * el header correcto, que un tick delega TODO el trabajo a
 * `drainCampaignQueue` (T1B/T3B, ya probado aparte en
 * `tests/services/campaign-email.test.ts`), y que una excepción ahí se
 * traduce a un 500 legible en vez de tirar cruda.
 */
const { drainCampaignQueueMock } = vi.hoisted(() => ({ drainCampaignQueueMock: vi.fn() }))

vi.mock('@/services/notifications/email/campaign', () => ({
  drainCampaignQueue: drainCampaignQueueMock,
}))

const { GET } = await import('@/app/api/cron/campaigns/route')

function authorizedRequest(): Request {
  return new Request('https://burgershop.test/api/cron/campaigns', {
    headers: { authorization: 'Bearer cron-secret' },
  })
}

beforeEach(() => {
  drainCampaignQueueMock.mockReset().mockResolvedValue({ claimed: 0, sent: 0, failed: 0 })
})

describe('GET /api/cron/campaigns — auth', () => {
  it('sin el header Authorization → 401, y ni siquiera llama a drainCampaignQueue', async () => {
    const res = await GET(new Request('https://burgershop.test/api/cron/campaigns') as never)
    expect(res.status).toBe(401)
    expect(drainCampaignQueueMock).not.toHaveBeenCalled()
  })

  it('con un secreto incorrecto (mismo largo, otro contenido) → 401', async () => {
    const res = await GET(
      new Request('https://burgershop.test/api/cron/campaigns', {
        headers: { authorization: 'Bearer cron-secre1' },
      }) as never,
    )
    expect(res.status).toBe(401)
  })

  it('con el secreto correcto → llama a drainCampaignQueue y devuelve su resultado', async () => {
    drainCampaignQueueMock.mockResolvedValue({ claimed: 5, sent: 4, failed: 1 })

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { claimed: number; sent: number; failed: number }

    expect(res.status).toBe(200)
    expect(body).toEqual({ claimed: 5, sent: 4, failed: 1 })
    expect(drainCampaignQueueMock).toHaveBeenCalledOnce()
  })
})

describe('GET /api/cron/campaigns — un fallo real de drainCampaignQueue no tira crudo', () => {
  it('una excepción se traduce a un error de API legible, nunca el stack ni el mensaje interno', async () => {
    drainCampaignQueueMock.mockRejectedValue(new Error('permission denied for table campaign_recipients'))

    const res = await GET(authorizedRequest() as never)
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(JSON.stringify(body)).not.toContain('permission denied')
  })
})
