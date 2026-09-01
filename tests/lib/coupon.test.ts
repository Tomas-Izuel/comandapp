import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_DAILY_BUDGET,
  campaignDaysNeeded,
  campaignLastSendDate,
  couponState,
  describeDiscount,
  discountForSubtotal,
  isCouponUsable,
  requiresConfirmation,
  worstCaseCents,
  type CouponShape,
} from '@/lib/coupon'
import type { Coupon } from '@/models/types'

/**
 * Lógica pura de cupones y campañas (`src/lib/coupon.ts`). Sin `server-only`
 * a propósito (mismo criterio que `src/lib/delivery.ts`), así que se importa
 * directo, sin mocks.
 */

function baseCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    storeId: 1,
    name: 'Test',
    code: 'TEST1234',
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

function shapeOf(coupon: Coupon): CouponShape {
  const {
    code,
    discountType,
    percent,
    amountOffCents,
    maxDiscountCents,
    minSubtotalCents,
    startsAt,
    endsAt,
    maxRedemptions,
    maxRedemptionsPerPhone,
    paymentMethods,
    status,
  } = coupon
  return {
    code,
    discountType,
    percent,
    amountOffCents,
    maxDiscountCents,
    minSubtotalCents,
    startsAt,
    endsAt,
    maxRedemptions,
    maxRedemptionsPerPhone,
    paymentMethods,
    status,
  }
}

describe('couponState — el estado derivado que se MUESTRA', () => {
  it('draft manda incluso si además tiene ventana vencida (el dueño necesita saber que ES un borrador)', () => {
    const c = baseCoupon({ status: 'draft', endsAt: '2020-01-01T00:00:00.000Z' })
    expect(couponState(c)).toBe('draft')
  })

  it('paused manda sobre "vencido" — un cupón que el dueño apagó a mano no se reporta como vencido', () => {
    const c = baseCoupon({ status: 'paused', endsAt: '2020-01-01T00:00:00.000Z' })
    expect(couponState(c)).toBe('paused')
  })

  it('scheduled: activo pero starts_at todavía no llegó', () => {
    const c = baseCoupon({ status: 'active', startsAt: '2999-01-01T00:00:00.000Z' })
    expect(couponState(c)).toBe('scheduled')
  })

  it('expired: activo, sin ventana futura, pero ends_at ya pasó — estrictamente >=', () => {
    const now = new Date('2026-06-15T12:00:00.000Z')
    const c = baseCoupon({ status: 'active', endsAt: now.toISOString() })
    expect(couponState(c, now)).toBe('expired')
  })

  it('exhausted: reservedCount + redeemedCount ya alcanzó el tope, mismo predicado que el CHECK de la tabla', () => {
    const c = baseCoupon({ status: 'active', maxRedemptions: 5, reservedCount: 3, redeemedCount: 2 })
    expect(couponState(c)).toBe('exhausted')
  })

  it('un cupón con cupo restante, dentro de ventana, activo: active', () => {
    const c = baseCoupon({ status: 'active', maxRedemptions: 5, reservedCount: 1, redeemedCount: 1 })
    expect(couponState(c)).toBe('active')
  })

  it('isCouponUsable es equivalente a couponState === "active"', () => {
    const usable = baseCoupon({ status: 'active' })
    const exhausted = baseCoupon({ status: 'active', maxRedemptions: 1, reservedCount: 1, redeemedCount: 0 })
    expect(isCouponUsable(usable)).toBe(true)
    expect(isCouponUsable(exhausted)).toBe(false)
  })
})

describe('describeDiscount', () => {
  it('un cupón fixed muestra el monto formateado', () => {
    const c = baseCoupon({ discountType: 'fixed', amountOffCents: 150000, percent: null })
    expect(describeDiscount(c)).toMatch(/1\.500/)
  })

  it('un cupón percentage sin tope muestra solo el porcentaje', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 20, maxDiscountCents: null })
    expect(describeDiscount(c)).toBe('20%')
  })

  it('un cupón percentage CON tope lo aclara entre paréntesis', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 20, maxDiscountCents: 500000 })
    expect(describeDiscount(c)).toContain('20%')
    expect(describeDiscount(c)).toMatch(/hasta/)
  })
})

describe('discountForSubtotal — la fórmula que también vive en SQL', () => {
  it('percentage: floor, nunca ceil — 15% de 833333 es 124999, no 125000', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 15, maxDiscountCents: null })
    expect(discountForSubtotal(c, 833333)).toBe(124999)
  })

  it('percentage con maxDiscountCents: el tope gana si el porcentaje lo superaría', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 50, maxDiscountCents: 100000 })
    expect(discountForSubtotal(c, 1000000)).toBe(100000) // 50% de 1000000 = 500000, clampeado a 100000
  })

  it('percentage con maxDiscountCents que NO se alcanza: gana el porcentaje', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 10, maxDiscountCents: 999999 })
    expect(discountForSubtotal(c, 100000)).toBe(10000)
  })

  it('fixed: el monto tal cual, si entra en el subtotal', () => {
    const c = baseCoupon({ discountType: 'fixed', amountOffCents: 50000, percent: null })
    expect(discountForSubtotal(c, 100000)).toBe(50000)
  })

  it('el CLAMP: un fixed mayor que el subtotal se recorta al subtotal entero — nunca deja el pedido negativo', () => {
    const c = baseCoupon({ discountType: 'fixed', amountOffCents: 999999, percent: null })
    expect(discountForSubtotal(c, 5000)).toBe(5000)
  })

  it('el clamp también aplica a percentage con un subtotal chico y sin tope', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 100, maxDiscountCents: null })
    expect(discountForSubtotal(c, 999)).toBe(999)
  })
})

describe('worstCaseCents — exposición máxima si el código se filtra', () => {
  it('fixed: maxRedemptions × amountOffCents', () => {
    const c = baseCoupon({ discountType: 'fixed', amountOffCents: 1000, percent: null, maxRedemptions: 50 })
    expect(worstCaseCents(c)).toBe(50000)
  })

  it('percentage CON tope: maxRedemptions × maxDiscountCents', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 90, maxDiscountCents: 2000, maxRedemptions: 10 })
    expect(worstCaseCents(c)).toBe(20000)
  })

  it('percentage SIN tope: null, no un número grande — null es lo que hace que la comparación de requiresConfirmation escale siempre', () => {
    const c = baseCoupon({ discountType: 'percentage', percent: 90, maxDiscountCents: null })
    expect(worstCaseCents(c)).toBeNull()
  })
})

/**
 * `requiresConfirmation` — 18 casos. Los dos que más se prestan a error, según
 * el pedido explícito: pausar+escalar en la misma acción NO pide código, y
 * poner un tope en `null` SÍ pide código porque `null` es el valor más amplio.
 */
describe('requiresConfirmation — el criterio de si un cambio necesita el código de 6 dígitos', () => {
  const active = shapeOf(baseCoupon({ status: 'active' }))

  it('1. next.status !== "active" nunca pide código, aunque el resto escale muchísimo (de-escalación)', () => {
    const next = { ...active, status: 'paused' as const, percent: 100, maxDiscountCents: null, maxRedemptions: 1_000_000 }
    expect(requiresConfirmation(active, next)).toBe(false)
  })

  it('2. pausar Y escalar en la misma acción no pide código — el resultado final es un cupón apagado', () => {
    const current = shapeOf(baseCoupon({ status: 'active', percent: 5 }))
    const next = { ...current, status: 'draft' as const, percent: 99 }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('3. current no activo (draft) y next activo: SIEMPRE pide código, sea cual sea la forma', () => {
    const current = shapeOf(baseCoupon({ status: 'draft' }))
    const next = { ...current, status: 'active' as const }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('4. current paused y next active: pide código (reactivar)', () => {
    const current = shapeOf(baseCoupon({ status: 'paused' }))
    const next = { ...current, status: 'active' as const }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('5. cambiar el código del cupón, mismo status activo, pide código', () => {
    const next = { ...active, code: 'OTRO9999' }
    expect(requiresConfirmation(active, next)).toBe(true)
  })

  it('6. cambiar discountType (percentage -> fixed) pide código, no son comparables campo a campo', () => {
    const next: CouponShape = { ...active, discountType: 'fixed', amountOffCents: 100, percent: null }
    expect(requiresConfirmation(active, next)).toBe(true)
  })

  it('7. subir percent pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', percent: 10 }))
    const next = { ...current, percent: 20 }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('8. bajar percent NO pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', percent: 20 }))
    const next = { ...current, percent: 10 }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('9. subir amountOffCents pide código (cupón fixed)', () => {
    const current = shapeOf(baseCoupon({ status: 'active', discountType: 'fixed', amountOffCents: 100, percent: null }))
    const next = { ...current, amountOffCents: 200 }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('10. ⚠️ poner maxDiscountCents en null (de un valor finito) pide código — null es el valor MÁS AMPLIO, no el más chico', () => {
    const current = shapeOf(baseCoupon({ status: 'active', maxDiscountCents: 5000 }))
    const next = { ...current, maxDiscountCents: null }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('11. bajar maxDiscountCents (de un valor finito a otro menor) NO pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', maxDiscountCents: 5000 }))
    const next = { ...current, maxDiscountCents: 1000 }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('12. subir maxRedemptions pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', maxRedemptions: 10 }))
    const next = { ...current, maxRedemptions: 50 }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('13. bajar maxRedemptions NO pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', maxRedemptions: 50 }))
    const next = { ...current, maxRedemptions: 10 }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('14. ⚠️ poner maxRedemptionsPerPhone en null pide código — mismo criterio que maxDiscountCents: null es el tope más amplio', () => {
    const current = shapeOf(baseCoupon({ status: 'active', maxRedemptionsPerPhone: 1 }))
    const next = { ...current, maxRedemptionsPerPhone: null }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('15. bajar minSubtotalCents ensancha quién puede canjear: pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', minSubtotalCents: 10000 }))
    const next = { ...current, minSubtotalCents: 1000 }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('16. subir minSubtotalCents (más restrictivo) NO pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', minSubtotalCents: 1000 }))
    const next = { ...current, minSubtotalCents: 10000 }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('17. estirar endsAt (fecha más lejana) pide código; poner endsAt en null (sin vencimiento) también, por ser el extremo amplio', () => {
    const current = shapeOf(baseCoupon({ status: 'active', endsAt: '2026-06-01T00:00:00.000Z' }))
    const laterDate = { ...current, endsAt: '2026-12-01T00:00:00.000Z' }
    const noExpiry = { ...current, endsAt: null }
    expect(requiresConfirmation(current, laterDate)).toBe(true)
    expect(requiresConfirmation(current, noExpiry)).toBe(true)
  })

  it('18. adelantar startsAt (empieza antes / null = ya empezó) pide código; atrasarlo NO', () => {
    const current = shapeOf(baseCoupon({ status: 'active', startsAt: '2026-06-01T00:00:00.000Z' }))
    const earlier = { ...current, startsAt: '2026-01-01T00:00:00.000Z' }
    const noStart = { ...current, startsAt: null }
    const later = { ...current, startsAt: '2026-09-01T00:00:00.000Z' }
    expect(requiresConfirmation(current, earlier)).toBe(true)
    expect(requiresConfirmation(current, noStart)).toBe(true)
    expect(requiresConfirmation(current, later)).toBe(false)
  })

  it('agregar un método de pago nuevo (ensancha CÓMO se canjea) pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', paymentMethods: ['online'] }))
    const next = { ...current, paymentMethods: ['online', 'in_store'] as CouponShape['paymentMethods'] }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('sacar un método de pago (restringe) NO pide código', () => {
    const current = shapeOf(baseCoupon({ status: 'active', paymentMethods: ['online', 'in_store'] }))
    const next = { ...current, paymentMethods: ['online'] as CouponShape['paymentMethods'] }
    expect(requiresConfirmation(current, next)).toBe(false)
  })

  it('pasar paymentMethods de un array a null (todos los métodos) pide código — null es el extremo amplio', () => {
    const current = shapeOf(baseCoupon({ status: 'active', paymentMethods: ['online'] }))
    const next = { ...current, paymentMethods: null }
    expect(requiresConfirmation(current, next)).toBe(true)
  })

  it('ningún cambio real (misma forma exacta) no pide código', () => {
    expect(requiresConfirmation(active, { ...active })).toBe(false)
  })
})

describe('campaignDaysNeeded', () => {
  it('cero destinatarios son cero días — una campaña vacía no se manda', () => {
    expect(campaignDaysNeeded(0)).toBe(0)
  })

  it('exactamente el presupuesto es 1 día', () => {
    expect(campaignDaysNeeded(CAMPAIGN_DAILY_BUDGET)).toBe(1)
  })

  it('uno más que el presupuesto son 2 días — ceil, no floor: 16 destinatarios con cupo 15 no entran en un día', () => {
    expect(campaignDaysNeeded(CAMPAIGN_DAILY_BUDGET + 1)).toBe(2)
  })

  it('respeta un presupuesto custom', () => {
    expect(campaignDaysNeeded(21, 10)).toBe(3)
  })
})

describe('campaignLastSendDate', () => {
  it('con 0 destinatarios, la fecha es la de hoy (0 días de margen)', () => {
    const from = new Date('2026-09-01T12:00:00.000Z')
    const out = campaignLastSendDate(0, 'America/Argentina/Buenos_Aires', from)
    expect(out).toBe('2026-09-01')
  })

  it('con exactamente el presupuesto (1 día), la fecha del último envío es la de hoy', () => {
    const from = new Date('2026-09-01T12:00:00.000Z')
    const out = campaignLastSendDate(CAMPAIGN_DAILY_BUDGET, 'America/Argentina/Buenos_Aires', from)
    expect(out).toBe('2026-09-01')
  })

  it('con más del presupuesto, suma los días que hagan falta (daysNeeded - 1)', () => {
    const from = new Date('2026-09-01T12:00:00.000Z')
    const out = campaignLastSendDate(CAMPAIGN_DAILY_BUDGET + 1, 'America/Argentina/Buenos_Aires', from) // 2 días
    expect(out).toBe('2026-09-02')
  })
})
