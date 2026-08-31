import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * `getOrderByToken` (`order.model.ts`) — es el ÚNICO camino por el que el
 * CBU de la tienda llega al cliente anónimo (`OrderPublicView.bankAccount`,
 * T2.2). Se puebla solo cuando `paymentMethod === 'transfer'` y el pedido no
 * está cancelado; para cualquier otro método, siempre `null` — nunca se
 * expone el CBU de la tienda a un pedido que no lo necesita.
 */
const ORDER_ID = 555
const STORE_ID = 7

const { getPublicBankAccountMock } = vi.hoisted(() => ({ getPublicBankAccountMock: vi.fn() }))

vi.mock('@/models/store-bank-account.model', () => ({
  getPublicBankAccount: getPublicBankAccountMock,
}))

function orderRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    store_id: STORE_ID,
    short_code: 'AB12',
    public_token: '23456789abcdefghjkmnpqrs',
    status: 'pending',
    customer_name: 'Cliente Test',
    currency: 'ARS',
    subtotal_cents: 10000,
    total_cents: 10000,
    eta_minutes: 10,
    eta_at: '2026-01-01T00:10:00.000Z',
    payment_method: 'online',
    payment_status: 'pending',
    paid_at: null,
    ready_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    delivery_method: 'pickup',
    delivery_fee_cents: 0,
    delivery_address_line: null,
    delivery_address_unit: null,
    delivery_address_between: null,
    delivery_address_notes: null,
    scheduled_for: null,
    transfer_receipt_uploaded_at: null,
    order_items: [],
    courier: null,
    stores: { name: 'La Birra', slug: 'la-birra' },
    ...overrides,
  }
}

function buildAdminMock(orderRow: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table !== 'orders') throw new Error(`tabla inesperada: ${table}`)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orderRow, error: null }) }) }) }
    },
  }
}

let currentMock: ReturnType<typeof buildAdminMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => currentMock,
}))

const { getOrderByToken } = await import('@/models/order.model')

const VALID_TOKEN = '23456789abcdefghjkmnpqrs'

beforeEach(() => {
  getPublicBankAccountMock.mockReset().mockResolvedValue({
    cbu: '0070325120000003733248',
    alias: 'la.birra.pagos',
    holderName: 'La Birra SRL',
    bankName: 'Banco de Galicia y Buenos Aires S.A.',
  })
})

describe('getOrderByToken — bankAccount solo para transfer, y solo si no está cancelado', () => {
  it('paymentMethod "online" → bankAccount es null, y ni siquiera consulta getPublicBankAccount', async () => {
    currentMock = buildAdminMock(orderRowFixture({ payment_method: 'online' }))

    const view = await getOrderByToken(VALID_TOKEN)

    expect(view?.bankAccount).toBeNull()
    expect(getPublicBankAccountMock).not.toHaveBeenCalled()
  })

  it('paymentMethod "in_store" → bankAccount es null', async () => {
    currentMock = buildAdminMock(orderRowFixture({ payment_method: 'in_store' }))

    const view = await getOrderByToken(VALID_TOKEN)

    expect(view?.bankAccount).toBeNull()
    expect(getPublicBankAccountMock).not.toHaveBeenCalled()
  })

  it('paymentMethod "transfer" y NO cancelado → trae los cuatro campos públicos de la cuenta', async () => {
    currentMock = buildAdminMock(orderRowFixture({ payment_method: 'transfer', status: 'pending' }))

    const view = await getOrderByToken(VALID_TOKEN)

    expect(getPublicBankAccountMock).toHaveBeenCalledWith(STORE_ID)
    expect(view?.bankAccount).toEqual({
      cbu: '0070325120000003733248',
      alias: 'la.birra.pagos',
      holderName: 'La Birra SRL',
      bankName: 'Banco de Galicia y Buenos Aires S.A.',
    })
  })

  it('paymentMethod "transfer" pero CANCELADO → bankAccount vuelve a ser null, ya no hay nada que transferir', async () => {
    currentMock = buildAdminMock(orderRowFixture({ payment_method: 'transfer', status: 'cancelled' }))

    const view = await getOrderByToken(VALID_TOKEN)

    expect(view?.bankAccount).toBeNull()
    expect(getPublicBankAccountMock).not.toHaveBeenCalled()
  })

  it('transfer con la cuenta desactivada/borrada después de crear el pedido → bankAccount es null, no un CBU inventado', async () => {
    getPublicBankAccountMock.mockResolvedValue(null)
    currentMock = buildAdminMock(orderRowFixture({ payment_method: 'transfer', status: 'pending' }))

    const view = await getOrderByToken(VALID_TOKEN)

    expect(view?.bankAccount).toBeNull()
  })

  it('token inexistente → null', async () => {
    currentMock = buildAdminMock(null)
    const view = await getOrderByToken(VALID_TOKEN)
    expect(view).toBeNull()
  })

  it('token con forma inválida → null, ni siquiera consulta la base', async () => {
    currentMock = buildAdminMock(orderRowFixture())
    const view = await getOrderByToken('demasiado-corto')
    expect(view).toBeNull()
  })
})
