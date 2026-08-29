import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitDecision } from '@/models/types'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

/**
 * T4 — los 5 caminos de invitación/cambio sensible de
 * `01-tasks.md` §T4, cableados sobre `consumeRateLimit`. Se mockea ESE
 * borde (no la RPC de Postgres — eso ya lo prueba
 * `tests/models/rate-limit.model.test.ts` y `tests/db/consume-rate-limit.test.ts`)
 * más los modelos que cada acción llama DESPUÉS de pasar el balde: lo que
 * importa acá es el ORDEN (autorización → balde → efecto) y que un balde
 * agotado corte el efecto (nunca invita, nunca crea la solicitud, nunca
 * manda mail).
 */
const {
  consumeRateLimitMock,
  requireStoreMembershipMock,
  inviteCourierMock,
  resendCourierInviteMock,
  getCurrentUserMock,
  getStoreByIdMock,
  createPendingChangeMock,
  sendPaymentChangeCodeMock,
  sendPaymentChangeNoticeMock,
  requirePlatformAdminMock,
  createStoreWithOwnerMock,
  resendOwnerInviteMock,
} = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  requireStoreMembershipMock: vi.fn(),
  inviteCourierMock: vi.fn(),
  resendCourierInviteMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getStoreByIdMock: vi.fn(),
  createPendingChangeMock: vi.fn(),
  sendPaymentChangeCodeMock: vi.fn(),
  sendPaymentChangeNoticeMock: vi.fn(),
  requirePlatformAdminMock: vi.fn(),
  createStoreWithOwnerMock: vi.fn(),
  resendOwnerInviteMock: vi.fn(),
}))

vi.mock('@/models/rate-limit.model', () => ({ consumeRateLimit: consumeRateLimitMock }))

vi.mock('@/models/store.model', () => ({
  requireStoreMembership: requireStoreMembershipMock,
  getStoreById: getStoreByIdMock,
  updateStoreSettings: vi.fn(),
  upsertBranding: vi.fn(),
}))

vi.mock('@/models/courier.model', () => ({
  inviteCourier: inviteCourierMock,
  resendCourierInvite: resendCourierInviteMock,
  setCourierActive: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: vi.fn() } }),
  getCurrentUser: getCurrentUserMock,
}))

vi.mock('@/models/store-pending-change.model', () => ({
  createPendingChange: createPendingChangeMock,
  consumePendingChange: vi.fn(),
  getLivePendingChange: vi.fn(),
}))

vi.mock('@/services/notifications/email/payment-change', () => ({
  sendPaymentChangeCode: sendPaymentChangeCodeMock,
  sendPaymentChangeNotice: sendPaymentChangeNoticeMock,
  sendPaymentSupportRequest: vi.fn(),
}))

vi.mock('@/models/platform.model', () => ({
  requirePlatformAdmin: requirePlatformAdminMock,
  createStoreWithOwner: createStoreWithOwnerMock,
  resendOwnerInvite: resendOwnerInviteMock,
  setStoreStatus: vi.fn(),
  getPlatformStoreById: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { inviteCourierAction, resendCourierInviteAction } = await import('@/controllers/staff.actions')
const { requestCourierPaymentPolicyChangeAction } = await import('@/controllers/admin.actions')
const { createStoreAction, resendOwnerInviteAction } = await import('@/controllers/platform.actions')

function allow(): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: true, remaining: 99, retryAfterSeconds: 0 })
}
function deny(retryAfterSeconds = 60): Promise<RateLimitDecision> {
  return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds })
}

beforeEach(() => {
  for (const m of [
    consumeRateLimitMock,
    requireStoreMembershipMock,
    inviteCourierMock,
    resendCourierInviteMock,
    getCurrentUserMock,
    getStoreByIdMock,
    createPendingChangeMock,
    sendPaymentChangeCodeMock,
    sendPaymentChangeNoticeMock,
    requirePlatformAdminMock,
    createStoreWithOwnerMock,
    resendOwnerInviteMock,
  ]) {
    m.mockReset()
  }
  consumeRateLimitMock.mockImplementation(allow)
  requireStoreMembershipMock.mockResolvedValue({ userId: 'owner-uid', role: 'owner' })
  inviteCourierMock.mockResolvedValue({ courierId: 1, emailSent: true })
})

describe('inviteCourierAction — courier_invite:store + courier_invite:email', () => {
  it('autorización corre ANTES que cualquier balde: un no-owner falla sin que consumeRateLimit se llame ni una vez', async () => {
    requireStoreMembershipMock.mockRejectedValue(new Error('Esta acción es solo para el dueño del local'))

    const res = await inviteCourierAction(1, { displayName: 'Nuevo Repartidor', email: 'nuevo@repartidor.test' })

    expect(res.ok).toBe(false)
    expect(consumeRateLimitMock).not.toHaveBeenCalled()
    expect(inviteCourierMock).not.toHaveBeenCalled()
  })

  it('consume courier_invite:store (clave=storeId) y courier_invite:email (clave=storeId:email), en ese orden', async () => {
    await inviteCourierAction(7, { displayName: 'Juan Repartidor', email: 'juan@repartidor.test' })

    const calls = consumeRateLimitMock.mock.calls.map((c) => c[0] as { bucket: string; subject: string })
    expect(calls[0]).toMatchObject({ bucket: 'courier_invite:store', subject: '7' })
    expect(calls[1]).toMatchObject({ bucket: 'courier_invite:email', subject: '7:juan@repartidor.test' })
  })

  it('courier_invite:store agotado → 429, NO llama a inviteCourier (nunca manda el mail)', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'courier_invite:store' ? deny() : allow(),
    )

    const res = await inviteCourierAction(7, { displayName: 'Juan Repartidor', email: 'juan@repartidor.test' })

    expect(res.ok).toBe(false)
    expect(inviteCourierMock).not.toHaveBeenCalled()
  })

  it('AISLAMIENTO MULTI-TENANT: el subject de courier_invite:store es el storeId — dos tiendas nunca comparten clave', async () => {
    await inviteCourierAction(1, { displayName: 'Repartidor A', email: 'a@x.test' })
    await inviteCourierAction(2, { displayName: 'Repartidor B', email: 'b@x.test' })

    const subjects = consumeRateLimitMock.mock.calls
      .map((c) => c[0] as { bucket: string; subject: string })
      .filter((c) => c.bucket === 'courier_invite:store')
      .map((c) => c.subject)
    expect(subjects).toEqual(['1', '2'])
  })
})

describe('resendCourierInviteAction — SOLO courier_invite:store (no :email, por diseño)', () => {
  it('más de 10/hora para la misma tienda (courier_invite:store agotado) → 429 y NO llama a resendCourierInvite', async () => {
    consumeRateLimitMock.mockImplementation(() => deny())

    const res = await resendCourierInviteAction(7, 55)

    expect(res.ok).toBe(false)
    expect(resendCourierInviteMock).not.toHaveBeenCalled()
  })

  it('no consume courier_invite:email — el reenvío no tiene el email a mano sin una segunda consulta', async () => {
    await resendCourierInviteAction(7, 55)

    const buckets = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string }).bucket)
    expect(buckets).toEqual(['courier_invite:store'])
  })
})

describe('requestCourierPaymentPolicyChangeAction — payment_change:store, FAIL-CLOSED', () => {
  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue({ id: 'owner-uid', email: 'dueno@la-birra.test' })
    getStoreByIdMock.mockResolvedValue({
      id: 7,
      name: 'La Birra',
      timezone: 'America/Argentina/Cordoba',
    })
    // Default del camino feliz: así el test que solo inspecciona los
    // argumentos de `consumeRateLimit` no se ensucia con un error de
    // `startPendingChange` por un mock sin configurar que no viene al caso.
    createPendingChangeMock.mockResolvedValue({ id: 99, code: '123456' })
  })

  it('el balde se consume con onError:"deny" — si la RPC de Postgres cae, este camino RECHAZA, no deja pasar', async () => {
    await requestCourierPaymentPolicyChangeAction(7, true)

    const call = consumeRateLimitMock.mock.calls[0]?.[0] as { bucket: string; onError?: string }
    expect(call.bucket).toBe('payment_change:store')
    expect(call.onError).toBe('deny')
  })

  it('balde agotado (o RPC caída, que con onError:"deny" se ve igual) → rechaza, NO crea la solicitud pendiente NI manda ningún mail', async () => {
    consumeRateLimitMock.mockImplementation(() => deny())

    const res = await requestCourierPaymentPolicyChangeAction(7, true)

    expect(res.ok).toBe(false)
    expect(createPendingChangeMock).not.toHaveBeenCalled()
    expect(sendPaymentChangeCodeMock).not.toHaveBeenCalled()
    expect(sendPaymentChangeNoticeMock).not.toHaveBeenCalled()
  })

  it('con cupo, SÍ crea la solicitud y manda el código (camino feliz, de control)', async () => {
    createPendingChangeMock.mockResolvedValue({ id: 99, code: '123456' })

    const res = await requestCourierPaymentPolicyChangeAction(7, true)

    expect(res.ok).toBe(true)
    expect(createPendingChangeMock).toHaveBeenCalledOnce()
    expect(sendPaymentChangeCodeMock).toHaveBeenCalledOnce()
  })
})

describe('createStoreAction / resendOwnerInviteAction — owner_invite:admin y owner_invite:store', () => {
  beforeEach(() => {
    requirePlatformAdminMock.mockResolvedValue({ userId: 'admin-uid', email: 'admin@plataforma.test' })
    createStoreWithOwnerMock.mockResolvedValue({ storeId: 42 })
  })

  it('createStoreAction consume SOLO owner_invite:admin (la tienda todavía no existe, no hay storeId para owner_invite:store)', async () => {
    await createStoreAction({
      slug: 'nueva-tienda',
      name: 'Nueva Tienda',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      ownerEmail: 'nuevo-dueno@x.test',
    })

    const calls = consumeRateLimitMock.mock.calls.map((c) => (c[0] as { bucket: string; subject: string }))
    expect(calls).toEqual([{ bucket: 'owner_invite:admin', subject: 'admin-uid', limit: 20, windowSeconds: 3600 }])
  })

  it('createStoreAction: owner_invite:admin agotado → NO crea la tienda', async () => {
    consumeRateLimitMock.mockImplementation(() => deny())

    const res = await createStoreAction({
      slug: 'otra-tienda',
      name: 'Otra Tienda',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      ownerEmail: 'x@x.test',
    })

    expect(res.ok).toBe(false)
    expect(createStoreWithOwnerMock).not.toHaveBeenCalled()
  })

  it('resendOwnerInviteAction consume owner_invite:store (clave=storeId) Y owner_invite:admin (clave=userId), en ese orden', async () => {
    await resendOwnerInviteAction(7)

    const calls = consumeRateLimitMock.mock.calls.map((c) => c[0] as { bucket: string; subject: string })
    expect(calls[0]).toMatchObject({ bucket: 'owner_invite:store', subject: '7' })
    expect(calls[1]).toMatchObject({ bucket: 'owner_invite:admin', subject: 'admin-uid' })
  })

  it('resendOwnerInviteAction: owner_invite:store agotado → NO reenvía', async () => {
    consumeRateLimitMock.mockImplementation(async ({ bucket }: { bucket: string }) =>
      bucket === 'owner_invite:store' ? deny() : allow(),
    )

    const res = await resendOwnerInviteAction(7)

    expect(res.ok).toBe(false)
    expect(resendOwnerInviteMock).not.toHaveBeenCalled()
  })

  it('AISLAMIENTO MULTI-TENANT: owner_invite:store keyed por storeId — dos tiendas no comparten balde', async () => {
    await resendOwnerInviteAction(1)
    await resendOwnerInviteAction(2)

    const subjects = consumeRateLimitMock.mock.calls
      .map((c) => c[0] as { bucket: string; subject: string })
      .filter((c) => c.bucket === 'owner_invite:store')
      .map((c) => c.subject)
    expect(subjects).toEqual(['1', '2'])
  })
})
