import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { PosEvent } from '@/services/pos/pos.port'

// Ver tests/services/hmac.test.ts: `server-only` tira salvo que se resuelva
// la condición `react-server`, que Vitest no setea. Se noopea acá, no en la
// config compartida.
vi.mock('server-only', () => ({}))

const SECRET = 'secreto-del-pos-la-birra'

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * `webhookAdapter.deliver` no depende de Supabase ni de `decryptSecret`, así
 * que estos tres tests solo interceptan `fetch` — el borde de I/O real.
 */
describe('webhookAdapter.deliver — P-10', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const endpoint = { id: 1, url: 'https://pos.ejemplo.com/webhook', secret: SECRET }
  const event: PosEvent = {
    id: 100,
    type: 'order.ready',
    orderId: 200,
    storeId: 42,
    payload: { shortCode: 'A7K2' },
    createdAt: '2020-01-01T00:00:00.000Z', // fecha del HECHO, deliberadamente vieja
  }

  it('la firma cubre `${timestamp}.${body}`, no solo el body: un POST capturado no se puede reenviar para siempre', async () => {
    const { webhookAdapter } = await import('@/services/pos/webhook.adapter')
    await webhookAdapter.deliver(endpoint, event, 'delivery-abc')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const body = init.body as string
    const timestamp = headers['x-burger-timestamp']
    const signature = headers['x-burger-signature'].replace('sha256=', '')

    const expectedConTimestamp = hmac(`${timestamp}.${body}`, SECRET)
    const expectedSoloBody = hmac(body, SECRET)

    expect(signature).toBe(expectedConTimestamp)
    // Si la firma fuera solo del body (el bug que describe P-10), este
    // assert también pasaría — la prueba real es que NO coincide con eso.
    expect(signature).not.toBe(expectedSoloBody)
  })

  it('el header x-burger-delivery-id es el id de destino recibido por parámetro, no un UUID generado en cada llamada', async () => {
    const { webhookAdapter } = await import('@/services/pos/webhook.adapter')

    await webhookAdapter.deliver(endpoint, event, 'destino-estable-77')
    await webhookAdapter.deliver(endpoint, event, 'destino-estable-77')

    const primeraLlamada = fetchMock.mock.calls[0]?.[1] as RequestInit
    const segundaLlamada = fetchMock.mock.calls[1]?.[1] as RequestInit
    const headers1 = primeraLlamada.headers as Record<string, string>
    const headers2 = segundaLlamada.headers as Record<string, string>

    expect(headers1['x-burger-delivery-id']).toBe('destino-estable-77')
    expect(headers2['x-burger-delivery-id']).toBe('destino-estable-77')
  })

  it('el body firmado incluye la fecha del EVENTO (createdAt), distinta de la del intento de entrega (x-burger-timestamp)', async () => {
    const { webhookAdapter } = await import('@/services/pos/webhook.adapter')
    const before = Date.now()
    await webhookAdapter.deliver(endpoint, event, 'delivery-xyz')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const body = JSON.parse(init.body as string) as { createdAt: string }
    const deliveryTimestampMs = Number(headers['x-burger-timestamp']) * 1000

    // La fecha del hecho de negocio viaja intacta en el body...
    expect(body.createdAt).toBe(event.createdAt)
    // ...y es una fecha completamente distinta al timestamp de este intento.
    expect(deliveryTimestampMs).toBeGreaterThanOrEqual(before - 1000)
    expect(Math.abs(deliveryTimestampMs - Date.parse(event.createdAt))).toBeGreaterThan(1000)
  })
})

/**
 * `dispatchPendingEvents` sí toca Supabase (el claim atómico) y descifra el
 * secreto de cada endpoint: acá se mockean esos dos bordes para probar que
 * un secreto corrupto en una tienda no tumba la entrega de las demás.
 */
const { adminRpcMock, decryptSecretMock } = vi.hoisted(() => ({
  adminRpcMock: vi.fn(),
  decryptSecretMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: adminRpcMock }),
}))

vi.mock('@/lib/crypto/secrets', () => ({
  decryptSecret: decryptSecretMock,
}))

describe('dispatchPendingEvents — P-10: un secreto que no se puede descifrar no tumba la entrega de las otras tiendas', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adminRpcMock.mockReset()
    decryptSecretMock.mockReset()
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('la tienda con secreto corrupto queda como entrega fallida y la otra tienda entrega igual', async () => {
    const claimedRows = [
      {
        delivery_id: 1001,
        store_id: 1,
        event_id: 1,
        event_type: 'order.ready',
        order_id: 10,
        payload: {},
        event_created_at: '2026-08-26T10:00:00.000Z',
        endpoint_id: 1,
        endpoint_url: 'https://pos-tienda-1.ejemplo.com',
        endpoint_secret: 'secreto-valido',
        attempts: 0,
      },
      {
        delivery_id: 1002,
        store_id: 2,
        event_id: 2,
        event_type: 'order.ready',
        order_id: 20,
        payload: {},
        event_created_at: '2026-08-26T10:00:00.000Z',
        endpoint_id: 2,
        endpoint_url: 'https://pos-tienda-2.ejemplo.com',
        endpoint_secret: 'secreto-corrupto',
        attempts: 0,
      },
    ]

    decryptSecretMock.mockImplementation((stored: string | null) => {
      if (stored === 'secreto-corrupto') {
        throw new Error('CREDENTIALS_ENCRYPTION_KEY inválida o secreto corrupto')
      }
      return stored
    })

    const settleCalls: { p_delivery_id: number; p_delivered: boolean; p_error?: string }[] = []
    adminRpcMock.mockImplementation(async (fnName: string, params: Record<string, unknown>) => {
      if (fnName === 'claim_event_deliveries') return { data: claimedRows, error: null }
      if (fnName === 'settle_event_delivery') {
        settleCalls.push(params as { p_delivery_id: number; p_delivered: boolean; p_error?: string })
        return { data: null, error: null }
      }
      throw new Error(`rpc inesperado en el test: ${fnName}`)
    })

    const { dispatchPendingEvents } = await import('@/services/pos/webhook.adapter')
    const result = await dispatchPendingEvents()

    expect(result.claimed).toBe(2)
    expect(result.delivered).toBe(1)
    expect(result.failed).toBe(1)

    const settleTienda1 = settleCalls.find((c) => c.p_delivery_id === 1001)
    const settleTienda2 = settleCalls.find((c) => c.p_delivery_id === 1002)
    expect(settleTienda1?.p_delivered).toBe(true)
    expect(settleTienda2?.p_delivered).toBe(false)
    expect(settleTienda2?.p_error).toMatch(/secreto|descifrar/i)

    // Solo se intentó entregar a la tienda 1 (la única que llegó a `fetch`):
    // el secreto corrupto de la tienda 2 se detecta ANTES de armar el POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // El id de destino que sale al POS es el `delivery_id` que devolvió el
    // claim de Postgres (1001), no un id inventado en cada intento.
    expect(headers['x-burger-delivery-id']).toBe('1001')
  })
})
