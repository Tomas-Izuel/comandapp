import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

const { DomainError } = await import('@/lib/errors')

/**
 * `src/app/api/webhooks/mercadopago/route.ts` es el peor caso del producto
 * si se equivoca (P-05): un 200 en un error transitorio deja un pago
 * aprobado en MP con un pedido `pending` para siempre.
 *
 * Se mockean el provider y el controller enteros — son los bordes de I/O de
 * la ruta — para poder controlar exactamente qué error se lanza sin tener
 * que levantar Postgres ni la API de MP.
 */
const { verifyWebhookSignatureMock, confirmMercadoPagoPaymentMock } = vi.hoisted(() => ({
  verifyWebhookSignatureMock: vi.fn(),
  confirmMercadoPagoPaymentMock: vi.fn(),
}))

vi.mock('@/services/payments', () => ({
  getPaymentProvider: () => ({
    verifyWebhookSignature: verifyWebhookSignatureMock,
  }),
}))

vi.mock('@/controllers/checkout.controller', () => ({
  confirmMercadoPagoPayment: confirmMercadoPagoPaymentMock,
}))

const { POST } = await import('@/app/api/webhooks/mercadopago/route')

function buildRequest(opts: { storeId?: string; type?: string; dataId?: string | null }): Request {
  const url = new URL('https://burgershop.test/api/webhooks/mercadopago')
  if (opts.storeId !== undefined) url.searchParams.set('store_id', opts.storeId)
  if (opts.type !== undefined) url.searchParams.set('type', opts.type)

  const body: { type?: string; data?: { id?: string } } = {}
  if (opts.dataId !== undefined && opts.dataId !== null) body.data = { id: opts.dataId }

  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': 'ts=1700000000,v1=firma-cualquiera',
      'x-request-id': 'req-1',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  verifyWebhookSignatureMock.mockReset()
  confirmMercadoPagoPaymentMock.mockReset()
})

describe('POST /api/webhooks/mercadopago', () => {
  it('firma inválida → 401, y la base no se toca (confirmMercadoPagoPayment nunca se llama)', async () => {
    verifyWebhookSignatureMock.mockResolvedValue(false)

    const res = await POST(buildRequest({ storeId: '42', type: 'payment', dataId: '999' }))

    expect(res.status).toBe(401)
    expect(confirmMercadoPagoPaymentMock).not.toHaveBeenCalled()
  })

  it('falta store_id → 400', async () => {
    const res = await POST(buildRequest({ type: 'payment', dataId: '999' }))

    expect(res.status).toBe(400)
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled()
  })

  it('un topic que no es "payment" → 200 sin procesar', async () => {
    const res = await POST(buildRequest({ storeId: '42', type: 'merchant_order', dataId: '999' }))

    expect(res.status).toBe(200)
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled()
    expect(confirmMercadoPagoPaymentMock).not.toHaveBeenCalled()
  })

  it('P-05: un error transitorio (timeout de MP, Postgres caído) devuelve 5xx para que Mercado Pago reintente', async () => {
    verifyWebhookSignatureMock.mockResolvedValue(true)
    confirmMercadoPagoPaymentMock.mockRejectedValue(new Error('timeout consultando a Mercado Pago'))

    const res = await POST(buildRequest({ storeId: '42', type: 'payment', dataId: '999' }))

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.status).toBeLessThan(600)
  })

  it('P-05: un error permanente (DomainError: tienda sin credenciales) devuelve 200, MP no tiene por qué reintentar', async () => {
    verifyWebhookSignatureMock.mockResolvedValue(true)
    confirmMercadoPagoPaymentMock.mockRejectedValue(
      new DomainError('Esta tienda todavía no conectó Mercado Pago.', { status: 409 }),
    )

    const res = await POST(buildRequest({ storeId: '42', type: 'payment', dataId: '999' }))

    expect(res.status).toBe(200)
  })
})
