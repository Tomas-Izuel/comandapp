import { describe, expect, it } from 'vitest'
import {
  campaignCreateInputSchema,
  campaignQuotaRequestInputSchema,
  campaignSegmentSchema,
  couponCodeSchema,
  couponInputSchema,
} from '@/models/schemas/coupon.schema'

function validCouponInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Promo de lanzamiento',
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

describe('couponCodeSchema — mismo CHECK que coupons_code_check (^[A-Z0-9]{4,16}$)', () => {
  it('normaliza a mayúsculas y recorta espacios', () => {
    const result = couponCodeSchema.safeParse('  descuento10  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('DESCUENTO10')
  })

  it('rechaza menos de 4 caracteres', () => {
    expect(couponCodeSchema.safeParse('AB1').success).toBe(false)
  })

  it('acepta exactamente 4 caracteres (el borde inferior)', () => {
    expect(couponCodeSchema.safeParse('AB12').success).toBe(true)
  })

  it('acepta exactamente 16 caracteres (el borde superior)', () => {
    expect(couponCodeSchema.safeParse('A'.repeat(16)).success).toBe(true)
  })

  it('rechaza más de 16 caracteres', () => {
    expect(couponCodeSchema.safeParse('A'.repeat(17)).success).toBe(false)
  })

  it('rechaza símbolos y espacios internos', () => {
    expect(couponCodeSchema.safeParse('PROMO-10').success).toBe(false)
    expect(couponCodeSchema.safeParse('PR OMO10').success).toBe(false)
  })
})

describe('couponInputSchema — espeja coupons_shape_check y coupons_window_check', () => {
  it('un cupón bien formado (percentage) pasa', () => {
    expect(couponInputSchema.safeParse(validCouponInput()).success).toBe(true)
  })

  it('un cupón fixed bien formado pasa', () => {
    const input = validCouponInput({ discountType: 'fixed', percent: null, amountOffCents: 50000 })
    expect(couponInputSchema.safeParse(input).success).toBe(true)
  })

  it('percentage sin percent (null) es inválido', () => {
    const input = validCouponInput({ percent: null })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('percentage con amountOffCents seteado es inválido — el tipo y el valor no pueden contradecirse', () => {
    const input = validCouponInput({ amountOffCents: 1000 })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('fixed sin amountOffCents (null) es inválido', () => {
    const input = validCouponInput({ discountType: 'fixed', percent: null, amountOffCents: null })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('fixed con percent seteado es inválido', () => {
    const input = validCouponInput({ discountType: 'fixed', percent: 10, amountOffCents: 1000 })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('fixed con maxDiscountCents seteado es inválido — el tope de descuento es solo para porcentuales', () => {
    const input = validCouponInput({ discountType: 'fixed', percent: null, amountOffCents: 1000, maxDiscountCents: 500 })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('percent fuera de 1..100 es inválido', () => {
    expect(couponInputSchema.safeParse(validCouponInput({ percent: 0 })).success).toBe(false)
    expect(couponInputSchema.safeParse(validCouponInput({ percent: 101 })).success).toBe(false)
  })

  it('endsAt <= startsAt es inválido — mismo predicado que coupons_window_check', () => {
    const input = validCouponInput({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-01T00:00:00.000Z' })
    expect(couponInputSchema.safeParse(input).success).toBe(false)
  })

  it('endsAt > startsAt es válido', () => {
    const input = validCouponInput({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-02T00:00:00.000Z' })
    expect(couponInputSchema.safeParse(input).success).toBe(true)
  })

  it('maxRedemptions tiene que ser positivo — NOT NULL en la base: con código compartido, sin tope es un cheque en blanco', () => {
    expect(couponInputSchema.safeParse(validCouponInput({ maxRedemptions: 0 })).success).toBe(false)
    expect(couponInputSchema.safeParse(validCouponInput({ maxRedemptions: -1 })).success).toBe(false)
  })

  it('paymentMethods: null (todos) es válido', () => {
    expect(couponInputSchema.safeParse(validCouponInput({ paymentMethods: null })).success).toBe(true)
  })

  it('paymentMethods: array vacío es inválido — inrepresentable, significaría "ningún método"', () => {
    expect(couponInputSchema.safeParse(validCouponInput({ paymentMethods: [] })).success).toBe(false)
  })

  it('paymentMethods: más de 3 métodos es inválido (solo hay 3 posibles, así que esto solo puede pasar con duplicados o basura)', () => {
    expect(
      couponInputSchema.safeParse(validCouponInput({ paymentMethods: ['online', 'in_store', 'transfer', 'online'] }))
        .success,
    ).toBe(false)
  })

  it('.strict(): un campo que no existe en el contrato (ej. reservedCount, un campo derivado) es rechazado, no ignorado', () => {
    const result = couponInputSchema.safeParse({ ...validCouponInput(), reservedCount: 5 })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/unrecognized_keys|reservedCount/i)
  })
})

describe('campaignSegmentSchema — discriminada por kind, .strict() por rama', () => {
  it('"all" sin campos extra es válido', () => {
    expect(campaignSegmentSchema.safeParse({ kind: 'all' }).success).toBe(true)
  })

  it('"all" con un topN colado es inválido — un dato ignorado en un segmento es peor que un 400', () => {
    expect(campaignSegmentSchema.safeParse({ kind: 'all', topN: 10 }).success).toBe(false)
  })

  it('"top_n" exige topN positivo', () => {
    expect(campaignSegmentSchema.safeParse({ kind: 'top_n', topN: 10 }).success).toBe(true)
    expect(campaignSegmentSchema.safeParse({ kind: 'top_n', topN: 0 }).success).toBe(false)
    expect(campaignSegmentSchema.safeParse({ kind: 'top_n' }).success).toBe(false)
  })

  it('"min_spent" exige minSpentCents >= 0', () => {
    expect(campaignSegmentSchema.safeParse({ kind: 'min_spent', minSpentCents: 0 }).success).toBe(true)
    expect(campaignSegmentSchema.safeParse({ kind: 'min_spent', minSpentCents: -1 }).success).toBe(false)
  })

  it('un kind desconocido es inválido', () => {
    expect(campaignSegmentSchema.safeParse({ kind: 'bogus' }).success).toBe(false)
  })
})

describe('campaignCreateInputSchema — el mensaje vacío se trata como ausente', () => {
  it('un mensaje vacío se transforma a null', () => {
    const result = campaignCreateInputSchema.safeParse({
      couponId: 1,
      segment: { kind: 'all' },
      subject: 'Promo',
      message: '',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.message).toBeNull()
  })

  it('omitir message también da null', () => {
    const result = campaignCreateInputSchema.safeParse({ couponId: 1, segment: { kind: 'all' }, subject: 'Promo' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.message).toBeNull()
  })

  it('un subject vacío es inválido', () => {
    const result = campaignCreateInputSchema.safeParse({ couponId: 1, segment: { kind: 'all' }, subject: '' })
    expect(result.success).toBe(false)
  })
})

describe('campaignQuotaRequestInputSchema', () => {
  it('acepta la forma completa', () => {
    const result = campaignQuotaRequestInputSchema.safeParse({
      requestedRecipients: 200,
      daysNeeded: 14,
      message: 'Necesito más cupo',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza requestedRecipients negativo', () => {
    const result = campaignQuotaRequestInputSchema.safeParse({ requestedRecipients: -1, daysNeeded: 1, message: 'x' })
    expect(result.success).toBe(false)
  })
})
