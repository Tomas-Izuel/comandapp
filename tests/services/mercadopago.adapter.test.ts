import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * Interceptamos SOLO el borde de I/O: el acceso a `store_payment_credentials`
 * (vía `@/lib/supabase/admin`) y el SDK de Mercado Pago. La lógica de firma,
 * de manifest y de mapeo de estados corre de verdad — es exactamente lo que
 * estos tests prueban.
 */
const { credentialsRows, paymentGetMock } = vi.hoisted(() => ({
  credentialsRows: new Map<number, { access_token: string | null; webhook_secret: string | null }>(),
  paymentGetMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, storeId: number) => ({
          maybeSingle: async () => ({ data: credentialsRows.get(storeId) ?? null, error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('mercadopago', () => {
  class MockPayment {
    get(args: { id: string }) {
      return paymentGetMock(args)
    }
  }
  class MockMPNotFoundError extends Error {}
  class MockMercadoPagoConfig {
    constructor(_opts: { accessToken: string }) {}
  }
  class MockPreference {}
  class MockPaymentRefund {}
  return {
    MercadoPagoConfig: MockMercadoPagoConfig,
    MPNotFoundError: MockMPNotFoundError,
    Payment: MockPayment,
    PaymentRefund: MockPaymentRefund,
    Preference: MockPreference,
  }
})

const { mercadopagoAdapter } = await import('@/services/payments/mercadopago.adapter')

const STORE_ID = 42

beforeEach(() => {
  credentialsRows.clear()
  paymentGetMock.mockReset()
})

function sign(manifest: string, secret: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex')
}

describe('mercadopagoAdapter.verifyWebhookSignature (P-14)', () => {
  const SECRET = 'secreto-de-webhook-la-birra'

  it('con el secreto correcto y el manifest id:<dataId>;request-id:<requestId>;ts:<ts>; la firma valida', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })
    const ts = Math.floor(Date.now() / 1000).toString()
    const manifest = `id:123456789;request-id:req-abc-1;ts:${ts};`
    const v1 = sign(manifest, SECRET)

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId: 'req-abc-1',
      dataId: '123456789',
    })

    expect(ok).toBe(true)
  })

  it('P-14: sin webhook_secret configurado devuelve false, nunca true (aceptar por defecto = tomar cualquier POST como pago real)', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: null })
    const ts = Math.floor(Date.now() / 1000).toString()
    // Firma "válida" contra un secreto arbitrario: no debería importar, porque
    // sin secreto configurado ni siquiera se llega a comparar.
    const manifest = `id:1;ts:${ts};`
    const v1 = sign(manifest, 'cualquier-cosa')

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId: null,
      dataId: '1',
    })

    expect(ok).toBe(false)
  })

  it('header x-signature ausente devuelve false', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: null,
      requestId: null,
      dataId: '1',
    })

    expect(ok).toBe(false)
  })

  it('header x-signature malformado (sin ts=/v1=) devuelve false', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: 'esto-no-tiene-el-formato-esperado',
      requestId: null,
      dataId: '1',
    })

    expect(ok).toBe(false)
  })

  it('P-14: data.id en mayúsculas se normaliza a minúsculas antes de firmar', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })
    const ts = Math.floor(Date.now() / 1000).toString()
    // El manifest se firma con el id YA en minúsculas.
    const manifest = `id:abc123xyz;request-id:req-2;ts:${ts};`
    const v1 = sign(manifest, SECRET)

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId: 'req-2',
      // Llega en mayúsculas, como lo mandaría MP.
      dataId: 'ABC123XYZ',
    })

    expect(ok).toBe(true)
  })

  it('P-14: si falta x-request-id, el segmento se omite del manifest (no va vacío)', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })
    const ts = Math.floor(Date.now() / 1000).toString()
    // Sin segmento request-id: "id:...;ts:...;", NO "id:...;request-id:;ts:...;"
    const manifestSinRequestId = `id:99;ts:${ts};`
    const v1 = sign(manifestSinRequestId, SECRET)

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId: null,
      dataId: '99',
    })

    expect(ok).toBe(true)
  })

  it('P-14: un ts de hace más de 5 minutos se rechaza aunque la firma sea criptográficamente correcta (ventana de replay)', async () => {
    credentialsRows.set(STORE_ID, { access_token: null, webhook_secret: SECRET })
    const staleTs = Math.floor(Date.now() / 1000 - 6 * 60).toString() // 6 minutos atrás
    const manifest = `id:1;ts:${staleTs};`
    const v1 = sign(manifest, SECRET) // firma perfecta, pero vieja

    const ok = await mercadopagoAdapter.verifyWebhookSignature({
      storeId: STORE_ID,
      signatureHeader: `ts=${staleTs},v1=${v1}`,
      requestId: null,
      dataId: '1',
    })

    expect(ok).toBe(false)
  })
})

describe('mercadopagoAdapter.fetchPayment — mapStatus', () => {
  beforeEach(() => {
    credentialsRows.set(STORE_ID, { access_token: 'APP_USR-token-de-prueba', webhook_secret: null })
  })

  it("mapea 'approved' → 'approved'", async () => {
    paymentGetMock.mockResolvedValue({ id: 1, status: 'approved', transaction_amount: 100 })
    const snapshot = await mercadopagoAdapter.fetchPayment(STORE_ID, '1')
    expect(snapshot.status).toBe('approved')
  })

  it.each(['rejected', 'cancelled'])("mapea '%s' → 'rejected'", async (mpStatus) => {
    paymentGetMock.mockResolvedValue({ id: 2, status: mpStatus, transaction_amount: 100 })
    const snapshot = await mercadopagoAdapter.fetchPayment(STORE_ID, '2')
    expect(snapshot.status).toBe('rejected')
  })

  it.each(['refunded', 'charged_back'])("mapea '%s' → 'refunded'", async (mpStatus) => {
    paymentGetMock.mockResolvedValue({ id: 3, status: mpStatus, transaction_amount: 100 })
    const snapshot = await mercadopagoAdapter.fetchPayment(STORE_ID, '3')
    expect(snapshot.status).toBe('refunded')
  })

  it.each(['in_process', 'authorized', 'pending', 'un-estado-que-mp-invente-mañana', undefined])(
    "cualquier estado desconocido o nuevo ('%s') mapea a 'pending' por default — nunca asumir aprobado",
    async (mpStatus) => {
      paymentGetMock.mockResolvedValue({ id: 4, status: mpStatus, transaction_amount: 100 })
      const snapshot = await mercadopagoAdapter.fetchPayment(STORE_ID, '4')
      expect(snapshot.status).toBe('pending')
    },
  )
})

describe('mercadopagoAdapter.fetchPayment — P-12: raw no puede contener PII del pagador', () => {
  it('el raw devuelto no incluye payer.email, payer.identification.number ni card.first_six_digits', async () => {
    credentialsRows.set(STORE_ID, { access_token: 'APP_USR-token-de-prueba', webhook_secret: null })

    const payerEmail = 'cliente-secreto@example.com'
    const payerDni = '30123456'
    const cardFirstSix = '450995'

    // Respuesta falsa de MP con la forma real: trae mucho más que lo que
    // necesitamos, PII incluida.
    paymentGetMock.mockResolvedValue({
      id: 555,
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 5000,
      transaction_amount_refunded: 0,
      currency_id: 'ARS',
      date_approved: '2026-08-26T12:00:00.000Z',
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      live_mode: true,
      external_reference: 'token-de-pedido',
      payer: {
        email: payerEmail,
        identification: { type: 'DNI', number: payerDni },
      },
      card: {
        first_six_digits: cardFirstSix,
        last_four_digits: '1234',
        cardholder: { name: 'JUAN PEREZ' },
      },
    })

    const snapshot = await mercadopagoAdapter.fetchPayment(STORE_ID, '555')
    const rawSerialized = JSON.stringify(snapshot.raw)

    expect(rawSerialized).not.toContain(payerEmail)
    expect(rawSerialized).not.toContain(payerDni)
    expect(rawSerialized).not.toContain(cardFirstSix)
    // `payment_type_id` legítimamente vale "credit_card", así que no alcanza
    // con buscar la substring "card": lo que no puede aparecer es la CLAVE
    // `payer` ni la clave `card` como objeto propio.
    expect(snapshot.raw).not.toHaveProperty('payer')
    expect(snapshot.raw).not.toHaveProperty('card')
  })
})
