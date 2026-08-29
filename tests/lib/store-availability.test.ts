import { describe, expect, it } from 'vitest'
import { canCollectPayment, canTakeOrders } from '@/lib/store-availability'

/**
 * `canCollectPayment` / `canTakeOrders` — el gate que faltaba antes de que
 * el checkout ofreciera "pagar online" a una tienda que no tiene NINGÚN
 * medio de pago conectado (el estado por defecto de toda tienda recién dada
 * de alta). Tabla de verdad completa: son dos booleanos con un OR, así que
 * los cuatro casos son los únicos que existen.
 */
describe('canCollectPayment — al menos un medio de pago activo', () => {
  it('online sí, en el local no → true', () => {
    expect(canCollectPayment({ onlinePaymentEnabled: true, inStorePaymentEnabled: false })).toBe(true)
  })

  it('online no, en el local sí → true', () => {
    expect(canCollectPayment({ onlinePaymentEnabled: false, inStorePaymentEnabled: true })).toBe(true)
  })

  it('los dos activos → true', () => {
    expect(canCollectPayment({ onlinePaymentEnabled: true, inStorePaymentEnabled: true })).toBe(true)
  })

  it('NINGÚN medio de pago → false — el caso que motivó la guarda de createOrder', () => {
    expect(canCollectPayment({ onlinePaymentEnabled: false, inStorePaymentEnabled: false })).toBe(false)
  })
})

describe('canTakeOrders — acceptingOrders Y algún medio de pago', () => {
  it('acepta pedidos y tiene medio de pago → true', () => {
    expect(
      canTakeOrders({ acceptingOrders: true, onlinePaymentEnabled: true, inStorePaymentEnabled: false }),
    ).toBe(true)
  })

  it('el dueño cerró la tienda (acceptingOrders false) aunque tenga medios de pago → false', () => {
    expect(
      canTakeOrders({ acceptingOrders: false, onlinePaymentEnabled: true, inStorePaymentEnabled: true }),
    ).toBe(false)
  })

  /**
   * El caso que exactamente motivó todo esto: una tienda recién dada de alta
   * queda `accepting_orders = true` por default pero sin ningún medio de pago
   * conectado. Antes de esta guarda la vitrina la trataba como abierta.
   */
  it('acepta pedidos pero NINGÚN medio de pago (alta reciente, sin configurar) → false', () => {
    expect(
      canTakeOrders({ acceptingOrders: true, onlinePaymentEnabled: false, inStorePaymentEnabled: false }),
    ).toBe(false)
  })

  it('ni acepta pedidos ni tiene medio de pago → false', () => {
    expect(
      canTakeOrders({ acceptingOrders: false, onlinePaymentEnabled: false, inStorePaymentEnabled: false }),
    ).toBe(false)
  })
})
