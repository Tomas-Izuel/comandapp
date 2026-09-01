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

// --- mocks de los dos clientes de Supabase -----------------------------
// `validateCouponForCart`/`listCoupons`/etc. usan el ADMIN client;
// `getCouponDetail` usa el cliente de SESIÓN (misma trampa que
// `store_couriers`: `coupon_detail` es SECURITY DEFINER pero lee `auth.uid()`).

let sessionRpcMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: sessionRpcMock }),
}))

let adminFromMock: ReturnType<typeof vi.fn>
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

const { generateCouponCode, validateCouponForCart, getCouponDetail } = await import('@/models/coupon.model')
const { DomainError } = await import('@/lib/errors')

/** Fila cruda de `coupons`, tal como la devolvería PostgREST (snake_case). */
function couponRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    store_id: STORE_ID,
    name: 'Test',
    code: 'DESCUENTO10',
    discount_type: 'percentage',
    percent: 10,
    amount_off_cents: null,
    max_discount_cents: null,
    min_subtotal_cents: 0,
    starts_at: null,
    ends_at: null,
    max_redemptions: 100,
    max_redemptions_per_phone: null,
    reserved_count: 0,
    redeemed_count: 0,
    payment_methods: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Arma un `admin.from()` que responde distinto según la tabla: `coupons` para
 * el `select().eq().eq().maybeSingle()` y `coupon_redemptions` para el
 * `select().eq().eq().in()` (conteo del tope por teléfono, `head: true`).
 */
function mockAdminFrom(opts: { couponRow: Record<string, unknown> | null; phoneCount?: number }) {
  const calls: string[] = []
  adminFromMock = vi.fn((table: string) => {
    calls.push(table)
    if (table === 'coupons') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: opts.couponRow, error: null })),
            })),
          })),
        })),
      }
    }
    if (table === 'coupon_redemptions') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ count: opts.phoneCount ?? 0, error: null })),
            })),
          })),
        })),
      }
    }
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  return { calls }
}

describe('generateCouponCode — CSPRNG, nunca Math.random()', () => {
  it('siempre devuelve 8 caracteres', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCouponCode()).toHaveLength(8)
    }
  })

  it('todos los caracteres son del alfabeto declarado, sin 0/O/1/I/L (mismo alfabeto que private.random_token, en mayúsculas)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCouponCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
    }
  })

  it('respeta el formato que exige coupons_code_check / couponCodeSchema', () => {
    expect(generateCouponCode()).toMatch(/^[A-Z0-9]{4,16}$/)
  })

  it('dos llamadas sucesivas no producen el mismo código (con altísima probabilidad — CSPRNG, no un contador)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCouponCode()))
    expect(codes.size).toBe(50)
  })
})

describe('validateCouponForCart — la validación de COTIZACIÓN, nunca tira', () => {
  it('un código con formato inválido (símbolos, no matchea couponCodeSchema) se rechaza SIN tocar la base', async () => {
    mockAdminFrom({ couponRow: null })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: '¡¡inválido!!',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.quote.status).toBe('rejected')
    expect(result.reasonCode).toBe('not_found')
    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it('un código bien formado pero inexistente en la tienda: not_found', async () => {
    mockAdminFrom({ couponRow: null })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'NOEXISTE1',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.quote).toMatchObject({ status: 'rejected', reason: 'Ese código no existe o ya no está disponible.' })
    expect(result.reasonCode).toBe('not_found')
  })

  it('anti-enumeración: un cupón que existe pero está draft/paused da el MISMO texto que "no existe" — pero el reasonCode interno distingue "inactive"', async () => {
    mockAdminFrom({ couponRow: couponRow({ status: 'paused' }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.quote).toMatchObject({ status: 'rejected', reason: 'Ese código no existe o ya no está disponible.' })
    expect(result.reasonCode).toBe('inactive') // nunca llega al cliente, pero decide el balde coupon_check:ip
  })

  it('un cupón activo que todavía no arrancó (startsAt en el futuro): not_started', async () => {
    mockAdminFrom({ couponRow: couponRow({ starts_at: '2999-01-01T00:00:00.000Z' }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('not_started')
    expect(result.quote).toMatchObject({ reason: 'Ese cupón todavía no arrancó.' })
  })

  it('un cupón vencido (endsAt en el pasado, estrictamente >=): expired', async () => {
    mockAdminFrom({ couponRow: couponRow({ ends_at: '2020-01-01T00:00:00.000Z' }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('expired')
  })

  it('subtotal por debajo del mínimo: min_subtotal, con el faltante calculado', async () => {
    mockAdminFrom({ couponRow: couponRow({ min_subtotal_cents: 500000 }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 300000,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('min_subtotal')
    expect(result.quote).toMatchObject({ status: 'rejected' })
    if (result.quote.status === 'rejected') {
      expect(result.quote.reason).toContain('2.000') // faltan $2.000 (5000-3000 en pesos)
    }
  })

  it('método de pago no habilitado por el cupón: payment_method', async () => {
    mockAdminFrom({ couponRow: couponRow({ payment_methods: ['transfer'] }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('payment_method')
  })

  it('cupón agotado (reservedCount + redeemedCount >= maxRedemptions, estrictamente >=): exhausted', async () => {
    mockAdminFrom({ couponRow: couponRow({ max_redemptions: 5, reserved_count: 3, redeemed_count: 2 }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('exhausted')
  })

  it('tope por teléfono ya alcanzado: phone_limit, y consulta coupon_redemptions con el filtro correcto', async () => {
    const { calls } = mockAdminFrom({ couponRow: couponRow({ max_redemptions_per_phone: 1 }), phoneCount: 1 })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
      customerPhoneE164: '+5491111111111',
    })

    expect(result.reasonCode).toBe('phone_limit')
    expect(calls).toContain('coupon_redemptions')
  })

  it('SIN customerPhoneE164, el tope por teléfono se saltea — nunca consulta coupon_redemptions', async () => {
    const { calls } = mockAdminFrom({ couponRow: couponRow({ max_redemptions_per_phone: 1 }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 10000,
      paymentMethod: 'online',
    })

    expect(result.quote.status).toBe('applied') // sin teléfono, nada lo rechaza
    expect(calls).not.toContain('coupon_redemptions')
  })

  it('camino feliz: aplica y calcula el descuento con discountForSubtotal (floor)', async () => {
    mockAdminFrom({ couponRow: couponRow({ percent: 15 }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 833333,
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBeNull()
    expect(result.quote).toMatchObject({ status: 'applied', discountCents: 124999 })
  })

  it('ORDEN de los chequeos: un cupón que falla min_subtotal Y payment_method a la vez muestra min_subtotal primero — el mismo orden que create_order en SQL', async () => {
    mockAdminFrom({ couponRow: couponRow({ min_subtotal_cents: 500000, payment_methods: ['transfer'] }) })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 100000, // por debajo del mínimo
      paymentMethod: 'online', // y además el método no aplica
    })

    expect(result.reasonCode).toBe('min_subtotal')
  })

  it('ORDEN: exhausted se chequea DESPUÉS de min_subtotal y payment_method, nunca antes', async () => {
    mockAdminFrom({
      couponRow: couponRow({ min_subtotal_cents: 500000, max_redemptions: 1, reserved_count: 1, redeemed_count: 0 }),
    })

    const result = await validateCouponForCart({
      storeId: STORE_ID,
      code: 'DESCUENTO10',
      subtotalCents: 100000, // también por debajo del mínimo
      paymentMethod: 'online',
    })

    expect(result.reasonCode).toBe('min_subtotal') // no 'exhausted', aunque el cupón también esté agotado
  })
})

describe('getCouponDetail — cliente de SESIÓN, nunca admin (misma trampa que store_couriers)', () => {
  it('42501 de la RPC se traduce a DomainError 403', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'solo el dueno del local ve el detalle' } }))

    await expect(getCouponDetail(STORE_ID, 1)).rejects.toBeInstanceOf(DomainError)
    await expect(getCouponDetail(STORE_ID, 1)).rejects.toMatchObject({ status: 403 })
  })

  it('P0002 (no_data_found) se traduce a DomainError 404', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: null, error: { code: 'P0002', message: 'el cupon no existe' } }))

    await expect(getCouponDetail(STORE_ID, 999)).rejects.toBeInstanceOf(DomainError)
    await expect(getCouponDetail(STORE_ID, 999)).rejects.toMatchObject({ status: 404 })
  })

  it('un jsonb con forma inesperada no llega crudo a la vista', async () => {
    sessionRpcMock = vi.fn(async () => ({ data: { unexpected: true }, error: null }))

    await expect(getCouponDetail(STORE_ID, 1)).rejects.toThrow(/formato inesperado/)
  })

  it('llama la RPC con los parámetros correctos', async () => {
    sessionRpcMock = vi.fn(async () => ({
      data: {
        id: 1,
        storeId: STORE_ID,
        name: 'Test',
        code: 'ABC12345',
        discountType: 'percentage',
        percent: 10,
        amountOffCents: null,
        maxDiscountCents: null,
        minSubtotalCents: 0,
        startsAt: null,
        endsAt: null,
        maxRedemptions: 10,
        maxRedemptionsPerPhone: null,
        reservedCount: 0,
        redeemedCount: 0,
        paymentMethods: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        stats: { redemptions: 0, discountedCents: 0, revenueCents: 0 },
        totalRedemptions: 0,
        recentRedemptions: [],
      },
      error: null,
    }))

    await getCouponDetail(STORE_ID, 5)

    expect(sessionRpcMock).toHaveBeenCalledWith('coupon_detail', { p_store_id: STORE_ID, p_coupon_id: 5 })
  })
})
