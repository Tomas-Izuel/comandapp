import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

const STORE_ID = 7
const COUPON_ID = 3

const {
  requireStoreMembershipMock,
  getStoreByIdMock,
  getCurrentUserMock,
  consumeRateLimitMock,
  createPendingChangeMock,
  consumePendingChangeMock,
  sendPaymentChangeCodeMock,
  sendPaymentChangeNoticeMock,
  createCouponDraftMock,
  updateCouponMock,
  setCouponStatusMock,
  deleteUnusedCouponMock,
  getCouponByIdMock,
  previewSegmentMock,
  enqueueCampaignMock,
  getMarketingQuotaStatsMock,
  sendCampaignQuotaRequestMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireStoreMembershipMock: vi.fn(),
  getStoreByIdMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
  createPendingChangeMock: vi.fn(),
  consumePendingChangeMock: vi.fn(),
  sendPaymentChangeCodeMock: vi.fn(),
  sendPaymentChangeNoticeMock: vi.fn(),
  createCouponDraftMock: vi.fn(),
  updateCouponMock: vi.fn(),
  setCouponStatusMock: vi.fn(),
  deleteUnusedCouponMock: vi.fn(),
  getCouponByIdMock: vi.fn(),
  previewSegmentMock: vi.fn(),
  enqueueCampaignMock: vi.fn(),
  getMarketingQuotaStatsMock: vi.fn(),
  sendCampaignQuotaRequestMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/models/store.model', () => ({
  requireStoreMembership: requireStoreMembershipMock,
  getStoreById: getStoreByIdMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: getCurrentUserMock,
}))

vi.mock('@/models/rate-limit.model', () => ({
  consumeRateLimit: consumeRateLimitMock,
}))

vi.mock('@/models/store-pending-change.model', () => ({
  createPendingChange: createPendingChangeMock,
  consumePendingChange: consumePendingChangeMock,
}))

vi.mock('@/services/notifications/email/payment-change', () => ({
  sendPaymentChangeCode: sendPaymentChangeCodeMock,
  sendPaymentChangeNotice: sendPaymentChangeNoticeMock,
}))

vi.mock('@/models/coupon.model', () => ({
  createCouponDraft: createCouponDraftMock,
  updateCoupon: updateCouponMock,
  setCouponStatus: setCouponStatusMock,
  deleteUnusedCoupon: deleteUnusedCouponMock,
  getCouponById: getCouponByIdMock,
}))

vi.mock('@/models/campaign.model', () => ({
  previewSegment: previewSegmentMock,
  enqueueCampaign: enqueueCampaignMock,
  getMarketingQuotaStats: getMarketingQuotaStatsMock,
}))

vi.mock('@/services/notifications/email/campaign', () => ({
  sendCampaignQuotaRequest: sendCampaignQuotaRequestMock,
}))

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const {
  createCouponDraftAction,
  updateCouponAction,
  setCouponStatusAction,
  deleteCouponAction,
  requestCouponActivationAction,
  confirmCouponChangeAction,
  sendCampaignAction,
} = await import('@/controllers/marketing.actions')
const { DomainError } = await import('@/lib/errors')

function couponInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Promo',
    code: 'PROMO2026',
    discountType: 'percentage' as const,
    percent: 10,
    amountOffCents: null,
    maxDiscountCents: null,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: 100,
    maxRedemptionsPerPhone: null,
    paymentMethods: null,
    ...overrides,
  }
}

function couponRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: COUPON_ID,
    storeId: STORE_ID,
    name: 'Promo',
    code: 'PROMO2026',
    discountType: 'percentage' as const,
    percent: 10,
    amountOffCents: null,
    maxDiscountCents: null,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: 100,
    maxRedemptionsPerPhone: null,
    reservedCount: 0,
    redeemedCount: 0,
    paymentMethods: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  requireStoreMembershipMock.mockReset().mockResolvedValue({ userId: 'owner-uid', role: 'owner' })
  getStoreByIdMock.mockReset().mockResolvedValue({ id: STORE_ID, name: 'La Birra', timezone: 'America/Argentina/Buenos_Aires' })
  getCurrentUserMock.mockReset().mockResolvedValue({ email: 'owner@test.com' })
  consumeRateLimitMock.mockReset().mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 })
  createPendingChangeMock.mockReset().mockResolvedValue({ id: 55, code: '123456' })
  consumePendingChangeMock.mockReset()
  sendPaymentChangeCodeMock.mockReset().mockResolvedValue(undefined)
  sendPaymentChangeNoticeMock.mockReset().mockResolvedValue(undefined)
  createCouponDraftMock.mockReset().mockResolvedValue(couponRecord({ status: 'draft' }))
  updateCouponMock.mockReset().mockResolvedValue(couponRecord())
  setCouponStatusMock.mockReset().mockResolvedValue(couponRecord({ status: 'active' }))
  deleteUnusedCouponMock.mockReset().mockResolvedValue(undefined)
  getCouponByIdMock.mockReset()
  previewSegmentMock.mockReset()
  enqueueCampaignMock.mockReset()
  getMarketingQuotaStatsMock.mockReset()
  sendCampaignQuotaRequestMock.mockReset()
  revalidatePathMock.mockReset()
})

describe('createCouponDraftAction', () => {
  it('nace SIEMPRE draft y consume el balde coupon_create:store', async () => {
    const res = await createCouponDraftAction(STORE_ID, couponInput())

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.status).toBe('draft')
    expect(consumeRateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'coupon_create:store' }))
    expect(createCouponDraftMock).toHaveBeenCalledWith(STORE_ID, expect.objectContaining({ code: 'PROMO2026' }), 'owner-uid')
  })

  it('con el balde agotado, rechaza y no llega a crear el cupón', async () => {
    consumeRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 })

    const res = await createCouponDraftAction(STORE_ID, couponInput())

    expect(res.ok).toBe(false)
    expect(createCouponDraftMock).not.toHaveBeenCalled()
  })
})

describe('setCouponStatusAction — "no apagar se apaga sin código"', () => {
  it('acepta "draft" y "paused" y nunca pide código (no toca store-pending-change)', async () => {
    const res1 = await setCouponStatusAction(STORE_ID, COUPON_ID, 'paused')
    const res2 = await setCouponStatusAction(STORE_ID, COUPON_ID, 'draft')

    expect(res1.ok).toBe(true)
    expect(res2.ok).toBe(true)
    expect(createPendingChangeMock).not.toHaveBeenCalled()
  })

  it('"active" NO es un status válido para esta acción: el schema lo rechaza ANTES de llamar a setCouponStatus — activar siempre pasa por requestCouponActivationAction', async () => {
    // @ts-expect-error — 'active' es justamente el valor prohibido en runtime
    const res = await setCouponStatusAction(STORE_ID, COUPON_ID, 'active')

    expect(res.ok).toBe(false)
    expect(setCouponStatusMock).not.toHaveBeenCalled()
  })
})

describe('updateCouponAction — el segundo factor solo aplica a un cupón ACTIVO que escala', () => {
  it('editar un cupón draft/paused se aplica de inmediato, SIN pending change, aunque el cambio "escale" en abstracto', async () => {
    getCouponByIdMock.mockResolvedValue(couponRecord({ status: 'paused', percent: 5 }))

    const res = await updateCouponAction(STORE_ID, COUPON_ID, couponInput({ percent: 90, maxDiscountCents: null }))

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.requiresConfirmation).toBe(false)
    expect(updateCouponMock).toHaveBeenCalledOnce()
    expect(createPendingChangeMock).not.toHaveBeenCalled()
  })

  it('editar un cupón activo bajando la exposición (percent menor) se aplica de inmediato', async () => {
    getCouponByIdMock.mockResolvedValue(couponRecord({ status: 'active', percent: 20 }))

    const res = await updateCouponAction(STORE_ID, COUPON_ID, couponInput({ percent: 10 }))

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.requiresConfirmation).toBe(false)
    expect(updateCouponMock).toHaveBeenCalledOnce()
    expect(createPendingChangeMock).not.toHaveBeenCalled()
  })

  it('editar un cupón activo subiendo la exposición (percent mayor) pide código: NO aplica el cambio todavía', async () => {
    getCouponByIdMock.mockResolvedValue(couponRecord({ status: 'active', percent: 10 }))

    const res = await updateCouponAction(STORE_ID, COUPON_ID, couponInput({ percent: 50 }))

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.requiresConfirmation).toBe(true)
      if (res.data.requiresConfirmation) expect(res.data.pending.requestId).toBe(55)
    }
    expect(updateCouponMock).not.toHaveBeenCalled()
    expect(createPendingChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: STORE_ID, kind: 'coupon', subjectId: COUPON_ID }),
    )
  })

  it('cupón inexistente en la tienda: DomainError 404, no llega a comparar nada', async () => {
    getCouponByIdMock.mockResolvedValue(null)

    const res = await updateCouponAction(STORE_ID, COUPON_ID, couponInput())

    expect(res.ok).toBe(false)
    expect(updateCouponMock).not.toHaveBeenCalled()
  })
})

describe('deleteCouponAction', () => {
  it('borra un cupón sin uso', async () => {
    const res = await deleteCouponAction(STORE_ID, COUPON_ID)
    expect(res.ok).toBe(true)
    expect(deleteUnusedCouponMock).toHaveBeenCalledWith(STORE_ID, COUPON_ID)
  })

  it('un cupón ya usado (23503 traducido a DomainError 409 en el modelo) se propaga como rechazo de dominio, nunca como 500', async () => {
    deleteUnusedCouponMock.mockRejectedValue(new DomainError('Este cupón ya se usó: se puede pausar, no borrar.', { status: 409 }))

    const res = await deleteCouponAction(STORE_ID, COUPON_ID)

    expect(res.ok).toBe(false)
  })
})

describe('requestCouponActivationAction', () => {
  it('un cupón ya activo no puede "reactivarse": DomainError, sin pending change', async () => {
    getCouponByIdMock.mockResolvedValue(couponRecord({ status: 'active' }))

    const res = await requestCouponActivationAction(STORE_ID, COUPON_ID)

    expect(res.ok).toBe(false)
    expect(createPendingChangeMock).not.toHaveBeenCalled()
  })

  it('un cupón draft/paused SIEMPRE pide código para activarse', async () => {
    getCouponByIdMock.mockResolvedValue(couponRecord({ status: 'draft' }))

    const res = await requestCouponActivationAction(STORE_ID, COUPON_ID)

    expect(res.ok).toBe(true)
    expect(createPendingChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'coupon', subjectId: COUPON_ID }),
    )
  })
})

describe('confirmCouponChangeAction — despacha por payload.action', () => {
  it('un pending change que no es kind "coupon" se rechaza (defensa en profundidad)', async () => {
    consumePendingChangeMock.mockResolvedValue({ id: 1, kind: 'payment_credentials', payload: {} })

    const res = await confirmCouponChangeAction(STORE_ID, 1, '123456')

    expect(res.ok).toBe(false)
    expect(setCouponStatusMock).not.toHaveBeenCalled()
    expect(updateCouponMock).not.toHaveBeenCalled()
  })

  it('action "activate": llama setCouponStatus(id, couponId, "active")', async () => {
    consumePendingChangeMock.mockResolvedValue({
      id: 1,
      kind: 'coupon',
      payload: { action: 'activate', couponId: COUPON_ID },
    })

    const res = await confirmCouponChangeAction(STORE_ID, 1, '123456')

    expect(res.ok).toBe(true)
    expect(setCouponStatusMock).toHaveBeenCalledWith(STORE_ID, COUPON_ID, 'active')
    expect(updateCouponMock).not.toHaveBeenCalled()
  })

  it('action "update": llama updateCoupon(id, couponId, input) con la forma NUEVA congelada en el payload', async () => {
    const input = couponInput({ percent: 50 })
    consumePendingChangeMock.mockResolvedValue({
      id: 1,
      kind: 'coupon',
      payload: { action: 'update', couponId: COUPON_ID, input },
    })

    const res = await confirmCouponChangeAction(STORE_ID, 1, '123456')

    expect(res.ok).toBe(true)
    expect(updateCouponMock).toHaveBeenCalledWith(STORE_ID, COUPON_ID, input)
    expect(setCouponStatusMock).not.toHaveBeenCalled()
  })
})

describe('sendCampaignAction — capa 1 de §5.10.3.1: la campaña que no puede terminar no se puede empezar', () => {
  /**
   * HALLAZGO — `docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md`,
   * "Hallazgo 5-bis — MENOR": `campaign_send:store` (3 por 24h, `deny`) se
   * consume ANTES de chequear `fitsBeforeExpiry`. Tres intentos de mandar una
   * campaña rechazados por vencimiento del cupón agotan el balde y bloquean
   * cualquier campaña REAL de ese local por 24 horas, sin haber mandado un
   * solo mail.
   *
   * Este test afirma el comportamiento CORRECTO (el balde solo se gasta
   * cuando la campaña realmente se va a encolar) y por eso queda FALLANDO a
   * propósito hasta que se mueva el `consumeOrThrow` después del chequeo de
   * `fitsBeforeExpiry` en `marketing.actions.ts`. No se toca `src/`: es
   * trabajo de `senior-backend-engineer`.
   */
  it('HALLAZGO: un rechazo por fitsBeforeExpiry NO debería gastar el balde campaign_send:store — hoy lo gasta igual', async () => {
    previewSegmentMock.mockResolvedValue({
      inSegment: 30,
      withEmail: 30,
      optedOut: 0,
      willSend: 30,
      daysNeeded: 2,
      lastSendDate: '2026-09-02',
      couponEndsAt: '2026-09-01T00:00:00.000Z',
      fitsBeforeExpiry: false,
    })

    await sendCampaignAction(STORE_ID, { couponId: COUPON_ID, segment: { kind: 'all' }, subject: 'Promo' })

    const spentBucket = consumeRateLimitMock.mock.calls.some(
      (c) => (c[0] as { bucket: string }).bucket === 'campaign_send:store',
    )
    expect(spentBucket, 'campaign_send:store no debería gastarse en un intento que ni llega a encolar').toBe(false)
  })

  it('si fitsBeforeExpiry es false, rechaza y NUNCA llama enqueueCampaign (nada se encola)', async () => {
    previewSegmentMock.mockResolvedValue({
      inSegment: 30,
      withEmail: 30,
      optedOut: 0,
      willSend: 30,
      daysNeeded: 2,
      lastSendDate: '2026-09-02',
      couponEndsAt: '2026-09-01T00:00:00.000Z',
      fitsBeforeExpiry: false,
    })

    const res = await sendCampaignAction(STORE_ID, {
      couponId: COUPON_ID,
      segment: { kind: 'all' },
      subject: 'Promo',
    })

    expect(res.ok).toBe(false)
    expect(enqueueCampaignMock).not.toHaveBeenCalled()
  })

  it('si fitsBeforeExpiry es true, encola la campaña', async () => {
    previewSegmentMock.mockResolvedValue({
      inSegment: 10,
      withEmail: 10,
      optedOut: 0,
      willSend: 10,
      daysNeeded: 1,
      lastSendDate: '2026-09-01',
      couponEndsAt: null,
      fitsBeforeExpiry: true,
    })
    enqueueCampaignMock.mockResolvedValue(42)

    const res = await sendCampaignAction(STORE_ID, {
      couponId: COUPON_ID,
      segment: { kind: 'all' },
      subject: 'Promo',
    })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.campaignId).toBe(42)
    expect(enqueueCampaignMock).toHaveBeenCalledOnce()
  })
})
