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
 * `confirmPendingChangeAction` (`admin.actions.ts`), rama
 * `courier_collects_payment` — el candado de 6 dígitos que confirma quién
 * cobra en la puerta. El pipeline de ajustes-por-secciones movió ese campo a
 * la sub-ruta `/admin/ajustes/pedidos`, y `revalidatePath('/admin/ajustes')`
 * (sin `'layout'`) NO invalida una sub-ruta: la confirmación aplicaba en la
 * base pero el switch seguía mostrando el valor viejo hasta un refresh
 * manual. El fix fue agregar `'layout'` como segundo argumento — este archivo
 * es lo que prueba que sigue ahí, porque un `revalidatePath` sin segundo
 * argumento compila igual y no falla ningún test que solo mire `res.ok`.
 */
const {
  requireStoreMembershipMock,
  consumePendingChangeMock,
  adminFromMock,
  adminUpdateMock,
  adminEqMock,
  adminUpsertMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireStoreMembershipMock: vi.fn(),
  consumePendingChangeMock: vi.fn(),
  adminFromMock: vi.fn(),
  adminUpdateMock: vi.fn(),
  adminEqMock: vi.fn(),
  adminUpsertMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/models/store.model', () => ({
  getStoreById: vi.fn(),
  requireStoreMembership: requireStoreMembershipMock,
  updateStoreProfile: vi.fn(),
  updateStoreOrdering: vi.fn(),
  upsertBranding: vi.fn(),
}))

vi.mock('@/models/store-pending-change.model', () => ({
  createPendingChange: vi.fn(),
  consumePendingChange: consumePendingChangeMock,
  getLivePendingChange: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: vi.fn() } }),
  getCurrentUser: vi.fn(),
}))

vi.mock('@/services/notifications/email/payment-change', () => ({
  sendPaymentChangeCode: vi.fn(),
  sendPaymentChangeNotice: vi.fn(),
  sendPaymentSupportRequest: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const { confirmPendingChangeAction } = await import('@/controllers/admin.actions')

beforeEach(() => {
  requireStoreMembershipMock.mockReset().mockResolvedValue({ userId: 'owner-uid', role: 'owner' })
  consumePendingChangeMock.mockReset().mockResolvedValue({
    id: 99,
    kind: 'courier_collects_payment',
    payload: { courierCollectsPayment: true },
  })
  adminEqMock.mockReset().mockResolvedValue({ error: null })
  adminUpdateMock.mockReset().mockReturnValue({ eq: adminEqMock })
  adminUpsertMock.mockReset().mockResolvedValue({ error: null })
  adminFromMock.mockReset().mockReturnValue({ update: adminUpdateMock, upsert: adminUpsertMock })
  revalidatePathMock.mockReset()
})

describe('confirmPendingChangeAction — rama courier_collects_payment', () => {
  it('revalida "/admin/ajustes" con el segundo argumento "layout" — sin esto la sub-ruta /pedidos no se invalida', async () => {
    const res = await confirmPendingChangeAction(7, 99, '123456')

    expect(res.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith('/admin/ajustes', 'layout')
  })

  it('escribe courier_collects_payment con el admin client, no con el cliente de sesión', async () => {
    await confirmPendingChangeAction(7, 99, '123456')

    expect(adminFromMock).toHaveBeenCalledWith('stores')
    expect(adminUpdateMock).toHaveBeenCalledWith({ courier_collects_payment: true })
    expect(adminEqMock).toHaveBeenCalledWith('id', 7)
  })

  it('si el UPDATE falla, no revalida nada (el switch no debe pretender que se aplicó)', async () => {
    adminEqMock.mockResolvedValue({ error: { message: 'boom' } })

    const res = await confirmPendingChangeAction(7, 99, '123456')

    expect(res.ok).toBe(false)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('la rama payment_credentials sigue revalidando "/admin/pagos" (ruta propia, sin sub-rutas) y NO toca "/admin/ajustes"', async () => {
    consumePendingChangeMock.mockResolvedValue({
      id: 100,
      kind: 'payment_credentials',
      payload: { accessToken: 'tok', webhookSecret: 'sec', isSandbox: true },
    })

    const res = await confirmPendingChangeAction(7, 100, '123456')

    expect(res.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith('/admin/pagos')
  })
})
