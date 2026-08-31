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
 * `requestBankAccountChangeAction` / `lookupBankHolderAction` /
 * `setBankAccountActiveAction` / `deleteBankAccountAction` (`admin.actions.ts`,
 * T1.9) y la rama `bank_account` de `confirmPendingChangeAction`.
 *
 * La invariante que más importa acá NO es "el flujo funciona" — es
 * `00-architecture.md` §3.5: el nombre que devuelve un proveedor de
 * validación es un dato personal de UN TERCERO y no puede sobrevivir a la
 * llamada, ni en el `ActionResult` que llega al browser del dueño, ni en el
 * payload que se persiste en `store_pending_changes`. Un adapter stub que
 * devuelve un nombre reconocible ("OTRA PERSONA") es la forma de probar una
 * ausencia: si algún día alguien conecta ese nombre a la respuesta o al
 * payload, este test lo agarra.
 */
const {
  requireStoreMembershipMock,
  consumeRateLimitMock,
  getCurrentUserMock,
  getStoreByIdMock,
  createPendingChangeMock,
  consumePendingChangeMock,
  sendPaymentChangeCodeMock,
  sendPaymentChangeNoticeMock,
  upsertBankAccountMock,
  setBankAccountActiveMock,
  deleteBankAccountMock,
  lookupByCbuMock,
  lookupByAliasMock,
  revalidatePathMock,
  getLivePendingChangeMock,
} = vi.hoisted(() => ({
  requireStoreMembershipMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getStoreByIdMock: vi.fn(),
  createPendingChangeMock: vi.fn(),
  consumePendingChangeMock: vi.fn(),
  sendPaymentChangeCodeMock: vi.fn(),
  sendPaymentChangeNoticeMock: vi.fn(),
  upsertBankAccountMock: vi.fn(),
  setBankAccountActiveMock: vi.fn(),
  deleteBankAccountMock: vi.fn(),
  lookupByCbuMock: vi.fn(),
  lookupByAliasMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  getLivePendingChangeMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))

vi.mock('@/models/store.model', () => ({
  requireStoreMembership: requireStoreMembershipMock,
  getStoreById: getStoreByIdMock,
  updateStoreProfile: vi.fn(),
  updateStoreOrdering: vi.fn(),
  resumeAcceptingOrders: vi.fn(),
  upsertBranding: vi.fn(),
  listStoresForCurrentUser: vi.fn(),
}))

vi.mock('@/models/store-bank-account.model', () => ({
  upsertBankAccount: upsertBankAccountMock,
  setBankAccountActive: setBankAccountActiveMock,
  deleteBankAccount: deleteBankAccountMock,
  getBankAccountForAdmin: vi.fn(),
  getPublicBankAccount: vi.fn(),
}))

vi.mock('@/services/bank-validation', () => ({
  getBankAccountValidator: () => ({ lookupByCbu: lookupByCbuMock, lookupByAlias: lookupByAliasMock }),
  hasBankAccountValidator: () => false,
}))

vi.mock('@/models/store-pending-change.model', () => ({
  createPendingChange: createPendingChangeMock,
  consumePendingChange: consumePendingChangeMock,
  getLivePendingChange: getLivePendingChangeMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn() }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: vi.fn() } }),
  getCurrentUser: getCurrentUserMock,
}))

vi.mock('@/services/notifications/email/payment-change', () => ({
  sendPaymentChangeCode: sendPaymentChangeCodeMock,
  sendPaymentChangeNotice: sendPaymentChangeNoticeMock,
  sendPaymentSupportRequest: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const {
  requestBankAccountChangeAction,
  lookupBankHolderAction,
  setBankAccountActiveAction,
  deleteBankAccountAction,
  confirmPendingChangeAction,
  resendPendingChangeCodeAction,
} = await import('@/controllers/admin.actions')

const VALID_CBU = '0070325120000003733248' // vector real, verificado en 00-architecture.md §3.1

/** `BankAccountInput` (z.infer) tiene las cuatro claves REQUERIDAS aunque
 *  cada valor pueda ser `undefined` (así resuelve Zod un `.optional()` +
 *  `.transform()`) — a diferencia de una clave opcional de TS. Este helper
 *  evita repetir `alias: undefined, holderTaxId: undefined` en cada test. */
function bankAccountInput(overrides: {
  cbu?: string
  alias?: string
  holderName?: string
  holderTaxId?: string
}) {
  return {
    cbu: undefined,
    alias: undefined,
    holderName: 'La Birra SRL',
    holderTaxId: undefined,
    ...overrides,
  }
}

function allow() {
  return Promise.resolve({ allowed: true, remaining: 99, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 60) {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

beforeEach(() => {
  for (const m of [
    requireStoreMembershipMock,
    consumeRateLimitMock,
    getCurrentUserMock,
    getStoreByIdMock,
    createPendingChangeMock,
    consumePendingChangeMock,
    sendPaymentChangeCodeMock,
    sendPaymentChangeNoticeMock,
    upsertBankAccountMock,
    setBankAccountActiveMock,
    deleteBankAccountMock,
    lookupByCbuMock,
    lookupByAliasMock,
    revalidatePathMock,
    getLivePendingChangeMock,
  ]) {
    m.mockReset()
  }
  requireStoreMembershipMock.mockResolvedValue({ userId: 'owner-uid', role: 'owner' })
  consumeRateLimitMock.mockImplementation(allow)
  getCurrentUserMock.mockResolvedValue({ id: 'owner-uid', email: 'dueno@la-birra.test' })
  getStoreByIdMock.mockResolvedValue({ id: 7, name: 'La Birra', timezone: 'America/Argentina/Cordoba' })
  createPendingChangeMock.mockResolvedValue({ id: 99, code: '123456' })
  lookupByCbuMock.mockResolvedValue(null)
  lookupByAliasMock.mockResolvedValue(null)
})

describe('requestBankAccountChangeAction — bank_account_change:store, FAIL-CLOSED', () => {
  it('el balde se consume con onError:"deny" — si Postgres cae, este camino RECHAZA (toca el destino de la plata)', async () => {
    await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU }))

    const call = consumeRateLimitMock.mock.calls[0]?.[0] as { bucket: string; onError?: string }
    expect(call.bucket).toBe('bank_account_change:store')
    expect(call.onError).toBe('deny')
  })

  it('balde agotado → rechaza, NO crea la solicitud pendiente ni manda el código', async () => {
    consumeRateLimitMock.mockImplementation(() => deny())

    const res = await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU }))

    expect(res.ok).toBe(false)
    expect(createPendingChangeMock).not.toHaveBeenCalled()
    expect(sendPaymentChangeCodeMock).not.toHaveBeenCalled()
  })

  it('un no-owner (staff) no puede pedir el cambio — falla ANTES de consumir el balde', async () => {
    requireStoreMembershipMock.mockRejectedValue(new Error('Esta acción es solo para el dueño del local'))

    const res = await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU }))

    expect(res.ok).toBe(false)
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
  })

  it('con cupo y CBU válido, crea la solicitud y manda el código (camino feliz, de control)', async () => {
    const res = await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU }))

    expect(res.ok).toBe(true)
    expect(createPendingChangeMock).toHaveBeenCalledOnce()
    expect(sendPaymentChangeCodeMock).toHaveBeenCalledOnce()
  })

  it('acepta un objeto con SOLO alias (sin cbu) — decisión D3', async () => {
    const res = await requestBankAccountChangeAction(7, bankAccountInput({ alias: 'la.birra.pagos' }))
    expect(res.ok).toBe(true)
  })

  it('rechaza un objeto sin cbu NI alias (CHECK de la base espejado en el schema)', async () => {
    const res = await requestBankAccountChangeAction(7, bankAccountInput({}))
    expect(res.ok).toBe(false)
  })

  /**
   * La aserción central de este archivo (00-architecture.md §3.5). El
   * adapter devuelve un nombre reconocible a propósito: si algún cambio
   * futuro empieza a propagarlo, este assert falla con un mensaje que dice
   * exactamente qué reventó, en vez de un `expect(x).toBeUndefined()` mudo.
   */
  it('el nombre que devuelve el proveedor NUNCA llega al payload de store_pending_changes, ni cuando hay match', async () => {
    lookupByCbuMock.mockResolvedValue({
      cbu: VALID_CBU,
      alias: null,
      holderName: 'OTRA PERSONA',
      holderTaxId: '20111111112',
      bankCode: null,
      accountStatus: null,
    })

    await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU, holderTaxId: '20111111112' }))

    expect(createPendingChangeMock).toHaveBeenCalledOnce()
    const payload = createPendingChangeMock.mock.calls[0][0].payload as Record<string, unknown>
    expect(JSON.stringify(payload)).not.toContain('OTRA PERSONA')
    // Lo único que sobrevive del contraste es el veredicto + el timestamp.
    expect(payload.holderMatch).toBe('match')
    expect(typeof payload.checkedAt).toBe('string')
  })

  it('holderMatch = "mismatch" cuando el CUIT declarado y el que devuelve el proveedor difieren, y el nombre TAMPOCO se filtra', async () => {
    lookupByCbuMock.mockResolvedValue({
      cbu: VALID_CBU,
      alias: null,
      holderName: 'OTRA PERSONA',
      holderTaxId: '20999999992',
      bankCode: null,
      accountStatus: null,
    })

    await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU, holderTaxId: '20111111112' }))

    const payload = createPendingChangeMock.mock.calls[0][0].payload as Record<string, unknown>
    expect(payload.holderMatch).toBe('mismatch')
    expect(JSON.stringify(payload)).not.toContain('OTRA PERSONA')
  })

  it('holderMatch = "unavailable" sin holderTaxId declarado — nunca cae a comparar por nombre', async () => {
    await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU }))

    const payload = createPendingChangeMock.mock.calls[0][0].payload as Record<string, unknown>
    expect(payload.holderMatch).toBe('unavailable')
    expect(lookupByCbuMock).not.toHaveBeenCalled() // sin CUIT declarado, ni se llama al proveedor
  })

  it('holderMatch = "unavailable" cuando el proveedor no contesta (adapter manual, null)', async () => {
    lookupByCbuMock.mockResolvedValue(null)

    await requestBankAccountChangeAction(7, bankAccountInput({ cbu: VALID_CBU, holderTaxId: '20111111112' }))

    const payload = createPendingChangeMock.mock.calls[0][0].payload as Record<string, unknown>
    expect(payload.holderMatch).toBe('unavailable')
  })
})

describe('lookupBankHolderAction — el contraste en vivo, NUNCA devuelve un nombre', () => {
  it('el ActionResult no contiene el string devuelto por el proveedor en NINGUNA parte, en match', async () => {
    lookupByCbuMock.mockResolvedValue({
      cbu: VALID_CBU,
      alias: null,
      holderName: 'OTRA PERSONA',
      holderTaxId: '20111111112',
      bankCode: null,
      accountStatus: null,
    })

    const res = await lookupBankHolderAction(7, { cbu: VALID_CBU, holderTaxId: '20111111112' })

    expect(res.ok).toBe(true)
    expect(JSON.stringify(res)).not.toContain('OTRA PERSONA')
    if (res.ok) {
      expect(res.data.match).toBe('match')
      expect('holderName' in res.data).toBe(false)
    }
  })

  it('mismatch cuando los CUIT no coinciden, y tampoco se filtra el nombre', async () => {
    lookupByCbuMock.mockResolvedValue({
      cbu: VALID_CBU,
      alias: null,
      holderName: 'OTRA PERSONA',
      holderTaxId: '20999999992',
      bankCode: null,
      accountStatus: null,
    })

    const res = await lookupBankHolderAction(7, { cbu: VALID_CBU, holderTaxId: '20111111112' })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.match).toBe('mismatch')
    expect(JSON.stringify(res)).not.toContain('OTRA PERSONA')
  })

  it('unavailable sin holderTaxId en el probe', async () => {
    const res = await lookupBankHolderAction(7, { cbu: VALID_CBU })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.match).toBe('unavailable')
  })

  it('rechaza un probe sin cbu NI alias', async () => {
    const res = await lookupBankHolderAction(7, {})
    expect(res.ok).toBe(false)
  })

  it('un no-owner no puede contrastar', async () => {
    requireStoreMembershipMock.mockRejectedValue(new Error('Esta acción es solo para el dueño del local'))
    const res = await lookupBankHolderAction(7, { cbu: VALID_CBU, holderTaxId: '20111111112' })
    expect(res.ok).toBe(false)
  })
})

describe('setBankAccountActiveAction / deleteBankAccountAction — solo el dueño, sin código', () => {
  it('un staff (no owner) no puede apagar/prender la cuenta', async () => {
    requireStoreMembershipMock.mockRejectedValue(new Error('Esta acción es solo para el dueño del local'))
    const res = await setBankAccountActiveAction(7, false)
    expect(res.ok).toBe(false)
    expect(setBankAccountActiveMock).not.toHaveBeenCalled()
  })

  it('el dueño SÍ puede, y no se pide ningún código (00-architecture.md §5.11: apagar no redirige plata)', async () => {
    const res = await setBankAccountActiveAction(7, false)
    expect(res.ok).toBe(true)
    expect(setBankAccountActiveMock).toHaveBeenCalledWith(7, false)
    expect(createPendingChangeMock).not.toHaveBeenCalled()
  })

  it('un staff (no owner) no puede borrar la cuenta', async () => {
    requireStoreMembershipMock.mockRejectedValue(new Error('Esta acción es solo para el dueño del local'))
    const res = await deleteBankAccountAction(7)
    expect(res.ok).toBe(false)
    expect(deleteBankAccountMock).not.toHaveBeenCalled()
  })

  it('el dueño SÍ puede borrar, sin código', async () => {
    const res = await deleteBankAccountAction(7)
    expect(res.ok).toBe(true)
    expect(deleteBankAccountMock).toHaveBeenCalledWith(7)
  })
})

describe('confirmPendingChangeAction — rama bank_account', () => {
  it('confirma con el código correcto: llama upsertBankAccount con el payload guardado y revalida /admin/pagos', async () => {
    consumePendingChangeMock.mockResolvedValue({
      id: 99,
      kind: 'bank_account',
      payload: {
        cbu: VALID_CBU,
        alias: null,
        holderName: 'La Birra SRL',
        holderTaxId: '20111111112',
        bankName: 'Banco de Galicia y Buenos Aires S.A.',
        holderMatch: 'unavailable',
        checkedAt: '2026-08-31T00:00:00.000Z',
      },
    })

    const res = await confirmPendingChangeAction(7, 99, '123456')

    expect(res.ok).toBe(true)
    expect(upsertBankAccountMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ cbu: VALID_CBU, holderName: 'La Birra SRL' }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/pagos')
  })

  it('si el código está mal (consumePendingChange tira), no se llama upsertBankAccount ni se revalida nada', async () => {
    consumePendingChangeMock.mockRejectedValue(new Error('Código incorrecto'))

    const res = await confirmPendingChangeAction(7, 99, '000000')

    expect(res.ok).toBe(false)
    expect(upsertBankAccountMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

/**
 * GAP CONOCIDO, señalado por el `code-reviewer` (no bloqueante, preexistente
 * — ya pasaba con `courier_payment_policy` antes de esta feature): el
 * reenvío de código NO tiene rama por `kind`, así que un `kind: 'bank_account'`
 * consume el mismo balde que Mercado Pago (`payment_change:store`) en vez del
 * balde dedicado `bank_account_change:store`. Los dos tienen los mismos
 * números (3/1h, fail-closed) hoy, así que es ACOPLAMIENTO operativo, no un
 * agujero de seguridad: un dueño que reenvía tres veces el código de la
 * cuenta bancaria se queda una hora sin poder tampoco cambiar las
 * credenciales de MP, y viceversa.
 *
 * Este test DOCUMENTA el comportamiento actual, no lo prescribe. Si el día de
 * mañana `resendPendingChangeCodeAction` gana una rama por `kind` que consuma
 * `bank_account_change:store` para este caso, este test tiene que actualizarse
 * — no es una regla que haya que defender.
 */
describe('resendPendingChangeCodeAction — GAP: reenvío de "bank_account" consume el balde de MP, no el propio (pendiente de decisión de producto)', () => {
  it('[GAP CONOCIDO] reenviar el código de una solicitud kind:"bank_account" consume "payment_change:store", NO "bank_account_change:store"', async () => {
    getLivePendingChangeMock.mockResolvedValue({
      kind: 'bank_account',
      payload: { cbu: VALID_CBU, holderName: 'La Birra SRL' },
    })

    await resendPendingChangeCodeAction(7, 99)

    const call = consumeRateLimitMock.mock.calls[0]?.[0] as { bucket: string }
    // Esto es lo que HOY hace el código — no lo que "debería" hacer. Ver el
    // comentario del describe: es un gap conocido que el dueño del producto
    // todavía no resolvió, compartido con `courier_payment_policy`.
    expect(call.bucket).toBe('payment_change:store')
  })
})
