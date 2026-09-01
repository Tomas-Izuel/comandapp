import { describe, expect, it, vi } from 'vitest'

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

let sessionRpcMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: sessionRpcMock }),
}))

let adminFromMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

const getCouponByIdMock = vi.fn()
vi.mock('@/models/coupon.model', () => ({
  getCouponById: getCouponByIdMock,
}))

const getStoreByIdMock = vi.fn()
vi.mock('@/models/store.model', () => ({
  getStoreById: getStoreByIdMock,
}))

const { previewSegment, getMarketingQuotaStats } = await import('@/models/campaign.model')
const { DomainError } = await import('@/lib/errors')

function baseCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: COUPON_ID,
    storeId: STORE_ID,
    name: 'Promo',
    code: 'PROMO2026',
    discountType: 'percentage',
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

function baseStore(overrides: Record<string, unknown> = {}) {
  return { id: STORE_ID, timezone: 'America/Argentina/Buenos_Aires', ...overrides }
}

describe('previewSegment — cliente de SESIÓN (campaign_segment_preview es SECURITY DEFINER que lee auth.uid())', () => {
  it('segmento "all": no manda p_top_n ni p_min_spent', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 0, withEmail: 0, optedOut: 0, willSend: 0 }, error: null }))
    getCouponByIdMock.mockResolvedValue(baseCoupon())
    getStoreByIdMock.mockResolvedValue(baseStore())

    await previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)

    expect(sessionRpcMock).toHaveBeenCalledWith('campaign_segment_preview', { p_store_id: STORE_ID, p_kind: 'all' })
  })

  it('segmento "top_n": manda p_top_n', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 0, withEmail: 0, optedOut: 0, willSend: 0 }, error: null }))
    getCouponByIdMock.mockResolvedValue(baseCoupon())
    getStoreByIdMock.mockResolvedValue(baseStore())

    await previewSegment(STORE_ID, { kind: 'top_n', topN: 20 }, COUPON_ID)

    expect(sessionRpcMock).toHaveBeenCalledWith('campaign_segment_preview', { p_store_id: STORE_ID, p_kind: 'top_n', p_top_n: 20 })
  })

  it('segmento "min_spent": manda p_min_spent', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 0, withEmail: 0, optedOut: 0, willSend: 0 }, error: null }))
    getCouponByIdMock.mockResolvedValue(baseCoupon())
    getStoreByIdMock.mockResolvedValue(baseStore())

    await previewSegment(STORE_ID, { kind: 'min_spent', minSpentCents: 500000 }, COUPON_ID)

    expect(sessionRpcMock).toHaveBeenCalledWith('campaign_segment_preview', {
      p_store_id: STORE_ID,
      p_kind: 'min_spent',
      p_min_spent: 500000,
    })
  })

  it('42501 de la RPC (no es el dueño) se traduce a DomainError 403', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'solo el dueno' } }))

    await expect(previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)).rejects.toBeInstanceOf(DomainError)
    await expect(previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)).rejects.toMatchObject({ status: 403 })
  })

  it('un jsonb con forma inesperada no llega crudo', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { garbage: true }, error: null }))

    await expect(previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)).rejects.toThrow(/formato inesperado/)
  })

  it('si el cupón no existe en la tienda, tira DomainError 404 (aunque la RPC haya respondido bien)', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 0, withEmail: 0, optedOut: 0, willSend: 0 }, error: null }))
    getCouponByIdMock.mockResolvedValue(null)
    getStoreByIdMock.mockResolvedValue(baseStore())

    await expect(previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)).rejects.toBeInstanceOf(DomainError)
    await expect(previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)).rejects.toMatchObject({ status: 404 })
  })

  describe('fitsBeforeExpiry — capa 1 del bloqueo de §5.10.3.1', () => {
    it('cupón sin vencimiento (endsAt null): siempre entra, sin importar cuántos días tarde la campaña', async () => {
      sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 100, withEmail: 100, optedOut: 0, willSend: 100 }, error: null }))
      getCouponByIdMock.mockResolvedValue(baseCoupon({ endsAt: null }))
      getStoreByIdMock.mockResolvedValue(baseStore())

      const preview = await previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)

      expect(preview.fitsBeforeExpiry).toBe(true)
    })

    it('willSend = 0 (0 días necesarios): siempre entra, aunque el cupón ya haya vencido', async () => {
      sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 0, withEmail: 0, optedOut: 0, willSend: 0 }, error: null }))
      getCouponByIdMock.mockResolvedValue(baseCoupon({ endsAt: '2020-01-01T00:00:00.000Z' }))
      getStoreByIdMock.mockResolvedValue(baseStore())

      const preview = await previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)

      expect(preview.fitsBeforeExpiry).toBe(true)
      expect(preview.daysNeeded).toBe(0)
    })

    it('el cupón vence ANTES de que termine de drenar la campaña: no entra (bloqueo)', async () => {
      // 30 destinatarios con cupo 15/día = 2 días. Si el cupón vence HOY, el
      // segundo día de envío ya lo encuentra vencido.
      sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 30, withEmail: 30, optedOut: 0, willSend: 30 }, error: null }))
      const today = new Date()
      const endsAtToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12)).toISOString()
      getCouponByIdMock.mockResolvedValue(baseCoupon({ endsAt: endsAtToday }))
      getStoreByIdMock.mockResolvedValue(baseStore())

      const preview = await previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)

      expect(preview.daysNeeded).toBe(2)
      expect(preview.fitsBeforeExpiry).toBe(false)
    })

    it('el cupón vence bastante después de que termine de drenar: entra', async () => {
      sessionRpcMock = vi.fn(async () => ({ data: { inSegment: 10, withEmail: 10, optedOut: 0, willSend: 10 }, error: null }))
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      getCouponByIdMock.mockResolvedValue(baseCoupon({ endsAt: farFuture }))
      getStoreByIdMock.mockResolvedValue(baseStore())

      const preview = await previewSegment(STORE_ID, { kind: 'all' }, COUPON_ID)

      expect(preview.fitsBeforeExpiry).toBe(true)
    })
  })
})

describe('getMarketingQuotaStats — los cuatro conteos de §5.10.6', () => {
  it('arma las cuatro queries con los filtros correctos: store_id siempre, status=active para cupones activos, status=redeemed + ventana de 30 días para canjes, not(email is null) para clientes con mail', async () => {
    const selectCalls: Array<{ table: string; args: unknown[] }> = []
    const eqCalls: Array<{ table: string; args: unknown[] }> = []

    adminFromMock = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn((...args: unknown[]) => {
        selectCalls.push({ table, args })
        return chain
      })
      chain.eq = vi.fn((...args: unknown[]) => {
        eqCalls.push({ table, args })
        return chain
      })
      chain.not = vi.fn(() => chain)
      chain.gte = vi.fn(() => Promise.resolve({ count: 4, error: null }))
      // Encadenable sin más pasos (customersTotal, activeCouponsCount vía eq nomás).
      ;(chain as { then: PromiseLike<unknown>['then'] }).then = (resolve) =>
        Promise.resolve({ count: 4, error: null }).then(resolve as never)
      return chain
    })

    const stats = await getMarketingQuotaStats(STORE_ID)

    expect(adminFromMock).toHaveBeenCalledWith('store_customers')
    expect(adminFromMock).toHaveBeenCalledWith('coupons')
    expect(adminFromMock).toHaveBeenCalledWith('coupon_redemptions')

    expect(eqCalls.some((c) => c.table === 'coupons' && c.args[0] === 'status' && c.args[1] === 'active')).toBe(true)
    expect(eqCalls.some((c) => c.table === 'coupon_redemptions' && c.args[0] === 'status' && c.args[1] === 'redeemed')).toBe(
      true,
    )
    expect(stats).toEqual({
      customersTotal: 4,
      customersWithEmail: 4,
      activeCouponsCount: 4,
      redemptionsLastMonth: 4,
    })
  })

  /**
   * HALLAZGO — `docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md`,
   * "Hallazgo 3 — MENOR": el mail a la vía comercial (§5.10.6) promete
   * "canjes del último mes", pero la query filtra por
   * `coupon_redemptions.created_at` (el momento en que se RESERVÓ la fila, al
   * crear el pedido), no por `redeemed_at` (cuando de verdad se confirmó el
   * canje al entregarse). Un pedido reservado hace 40 días y entregado hace 3
   * queda AFUERA del conteo; uno reservado hace 25 días y entregado el mismo
   * día entra igual — el número que ve ventas no mide lo que el mail dice que
   * mide.
   *
   * Este test afirma el comportamiento CORRECTO (filtrar por `redeemed_at`) y
   * por eso queda FALLANDO a propósito hasta que se corrija
   * `getMarketingQuotaStats` en `campaign.model.ts`. No se toca `src/` para
   * arreglarlo: es trabajo de `senior-backend-engineer`.
   */
  it('HALLAZGO: redemptionsLastMonth debería filtrar por redeemed_at, no por created_at (hoy cuenta reservas, no canjes)', async () => {
    const gteCalls: Array<{ table: string; column: string }> = []

    adminFromMock = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.not = vi.fn(() => chain)
      chain.gte = vi.fn((column: string) => {
        gteCalls.push({ table, column })
        return Promise.resolve({ count: 0, error: null })
      })
      ;(chain as { then: PromiseLike<unknown>['then'] }).then = (resolve) =>
        Promise.resolve({ count: 0, error: null }).then(resolve as never)
      return chain
    })

    await getMarketingQuotaStats(STORE_ID)

    const redemptionsWindowColumn = gteCalls.find((c) => c.table === 'coupon_redemptions')?.column
    expect(
      redemptionsWindowColumn,
      'la ventana de 30 días de "canjes del último mes" debería filtrar por redeemed_at, no por created_at',
    ).toBe('redeemed_at')
  })

  it('propaga un error de Postgres de cualquiera de las cuatro queries', async () => {
    adminFromMock = vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.not = vi.fn(() => chain)
      chain.gte = vi.fn(() => Promise.resolve({ count: null, error: { message: 'timeout' } }))
      ;(chain as { then: PromiseLike<unknown>['then'] }).then = (resolve) =>
        Promise.resolve({ count: null, error: { message: 'timeout' } }).then(resolve as never)
      return chain
    })

    await expect(getMarketingQuotaStats(STORE_ID)).rejects.toThrow(/No se pudieron reunir los datos/)
  })
})
