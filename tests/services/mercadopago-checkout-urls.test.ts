import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `mercadopagoAdapter.createCheckout` — T5 de subdominio-por-local. El
 * criterio que más importa: `back_urls` (donde vuelve el cliente después de
 * pagar, y donde corre `clearResolvedOrderCart`) va al SUBDOMINIO de la
 * tienda; `notification_url` (server-to-server, nunca lo ve un browser) va
 * al APEX. Si se confunden, el peor caso no es un error visible: es un
 * cliente que pagó y vuelve a una página que no vacía su carrito.
 *
 * Se mockea `Preference.create` (captura el `body` real que arma el
 * adapter) y `store_payment_credentials` (texto plano, sin necesidad de
 * `CREDENTIALS_ENCRYPTION_KEY`: `decryptSecret` devuelve tal cual un valor
 * que no empieza con el prefijo de versión `v1.`). `src/lib/urls.ts` NO se
 * mockea: es la autoridad real bajo prueba.
 */
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { access_token: 'TEST-plain-token', webhook_secret: null }, error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('mercadopago', () => {
  class MockPayment {}
  class MockMPNotFoundError extends Error {}
  class MockMercadoPagoConfig {
    constructor() {}
  }
  class MockPreference {
    create(args: unknown) {
      return createMock(args)
    }
  }
  class MockPaymentRefund {}
  return {
    MercadoPagoConfig: MockMercadoPagoConfig,
    MPNotFoundError: MockMPNotFoundError,
    Payment: MockPayment,
    PaymentRefund: MockPaymentRefund,
    Preference: MockPreference,
  }
})

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  CRON_SECRET: 'cron-secret',
}
const ENV_KEYS = [...Object.keys(BASE_ENV), 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_STORE_HOST_MODE'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  createMock.mockReset()
  createMock.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp.example/checkout' })
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadAdapter(env: { siteUrl: string; hostMode?: 'subdomain' | 'path' }) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  process.env.NEXT_PUBLIC_SITE_URL = env.siteUrl
  if (env.hostMode === undefined) delete process.env.NEXT_PUBLIC_STORE_HOST_MODE
  else process.env.NEXT_PUBLIC_STORE_HOST_MODE = env.hostMode
  const { mercadopagoAdapter } = await import('@/services/payments/mercadopago.adapter')
  return mercadopagoAdapter
}

function checkoutParams() {
  return {
    storeId: 42,
    orderToken: 'a'.repeat(24),
    orderShortCode: 'A7K2',
    storeName: 'La Birra',
    storeSlug: 'la-birra',
    items: [{ name: 'Burger', quantity: 1, unitPriceCents: 5000 }],
    payerName: 'Juan Pérez',
    payerPhoneE164: '+5491111111111',
    totalCents: 5000,
    currency: 'ARS',
    expiresInMinutes: 30,
  }
}

describe('createCheckout — modo subdomain: back_urls al subdominio, notification_url al apex', () => {
  it('los 3 back_urls (success/pending/failure) apuntan a https://la-birra.comandapp.ar/pedido/<token>', async () => {
    const adapter = await loadAdapter({ siteUrl: 'https://comandapp.ar', hostMode: 'subdomain' })

    await adapter.createCheckout(checkoutParams())

    const body = createMock.mock.calls[0]?.[0]?.body as { back_urls: { success: string; pending: string; failure: string } }
    const expected = 'https://la-birra.comandapp.ar/pedido/' + 'a'.repeat(24)
    expect(body.back_urls.success).toBe(expected)
    expect(body.back_urls.pending).toBe(expected)
    expect(body.back_urls.failure).toBe(expected)
  })

  it('notification_url apunta al APEX, un host DISTINTO al de back_urls', async () => {
    const adapter = await loadAdapter({ siteUrl: 'https://comandapp.ar', hostMode: 'subdomain' })

    await adapter.createCheckout(checkoutParams())

    const body = createMock.mock.calls[0]?.[0]?.body as { notification_url: string; back_urls: { success: string } }
    expect(body.notification_url).toBe('https://comandapp.ar/api/webhooks/mercadopago?store_id=42')
    expect(new URL(body.notification_url).hostname).not.toBe(new URL(body.back_urls.success).hostname)
  })

  it('las dos URLs son https:// siempre en modo subdomain (MP rechaza http y no admite localhost en back_urls)', async () => {
    const adapter = await loadAdapter({ siteUrl: 'https://comandapp.ar', hostMode: 'subdomain' })

    await adapter.createCheckout(checkoutParams())

    const body = createMock.mock.calls[0]?.[0]?.body as { back_urls: { success: string }; notification_url: string }
    expect(body.back_urls.success.startsWith('https://')).toBe(true)
    expect(body.notification_url.startsWith('https://')).toBe(true)
  })
})

describe('createCheckout — modo path (default, hoy): SIN regresión', () => {
  it('back_urls y notification_url vuelven a la forma de hoy: todo bajo el mismo host apex, con el slug en el path', async () => {
    const adapter = await loadAdapter({ siteUrl: 'https://comandapp.ar', hostMode: 'path' })

    await adapter.createCheckout(checkoutParams())

    const body = createMock.mock.calls[0]?.[0]?.body as { back_urls: { success: string }; notification_url: string }
    expect(body.back_urls.success).toBe('https://comandapp.ar/la-birra/pedido/' + 'a'.repeat(24))
    expect(body.notification_url).toBe('https://comandapp.ar/api/webhooks/mercadopago?store_id=42')
  })
})
