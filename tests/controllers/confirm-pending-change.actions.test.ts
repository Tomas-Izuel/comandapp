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
 * `courier_payment_policy` — el candado de 6 dígitos que confirma quién cobra
 * en la puerta. El pipeline de ajustes-por-secciones movió ese campo a la
 * sub-ruta `/admin/ajustes/pedidos`, y `revalidatePath('/admin/ajustes')`
 * (sin `'layout'`) NO invalida una sub-ruta: la confirmación aplicaba en la
 * base pero el switch seguía mostrando el valor viejo hasta un refresh
 * manual. El fix fue agregar `'layout'` como segundo argumento — este archivo
 * es lo que prueba que sigue ahí, porque un `revalidatePath` sin segundo
 * argumento compila igual y no falla ningún test que solo mire `res.ok`.
 *
 * ⚠️ El kind real de este cambio, leído de `PendingChangeKind`
 * (`store-pending-change.model.ts`), es `'courier_payment_policy'` —
 * `'courier_collects_payment'` NO EXISTE como kind, es el nombre de la
 * COLUMNA que esta rama escribe en `stores`. Esta suite mockeaba ese nombre
 * inventado y pasaba igual, porque `confirmPendingChangeAction` no tenía
 * guarda: cualquier kind desconocido caía en el branch por defecto y escribía
 * `courier_collects_payment` igual. Cuando la migración de cupones ensanchó
 * el CHECK de `kind` con `'coupon'`, ese fall-through pasó a poder apagar el
 * cobro en la puerta sin que nadie lo pidiera. Ya está cerrado en
 * `admin.actions.ts` (un kind sin manejar tira) — el test de abajo,
 * "un kind sin manejar tira y no escribe ninguna columna de stores", es el
 * que debería haber atajado esto desde el principio.
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
    kind: 'courier_payment_policy',
    payload: { courierCollectsPayment: true },
  })
  adminEqMock.mockReset().mockResolvedValue({ error: null })
  adminUpdateMock.mockReset().mockReturnValue({ eq: adminEqMock })
  adminUpsertMock.mockReset().mockResolvedValue({ error: null })
  adminFromMock.mockReset().mockReturnValue({ update: adminUpdateMock, upsert: adminUpsertMock })
  revalidatePathMock.mockReset()
})

describe('confirmPendingChangeAction — rama courier_payment_policy', () => {
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

  /**
   * El test que faltaba, y el que habría atajado el bug real: un `kind` sin
   * rama en ESTA acción — `'coupon'` es el caso concreto que lo disparó, un
   * kind real que existe en `PendingChangeKind` desde la migración de cupones
   * pero que `confirmPendingChangeAction` nunca manejó (los cupones confirman
   * su propio segundo factor en `marketing.actions.ts`). Antes del guard, esto
   * caía en el default implícito y hacía `Boolean(undefined)` sobre
   * `courierCollectsPayment` → escribía `false` en `stores` sin que nadie lo
   * pidiera. Ahora tiene que tirar, y sobre todo: NUNCA debe llegar a
   * `admin.from('stores').update(...)`.
   */
  it('un kind sin manejar (p. ej. "coupon", que existe pero es de otra acción) tira y no escribe ninguna columna de stores', async () => {
    consumePendingChangeMock.mockResolvedValue({
      id: 101,
      kind: 'coupon',
      payload: { couponId: 5 },
    })

    const res = await confirmPendingChangeAction(7, 101, '123456')

    expect(res.ok).toBe(false)
    expect(adminFromMock).not.toHaveBeenCalledWith('stores')
    expect(adminUpdateMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
