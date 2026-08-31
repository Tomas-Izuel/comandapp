import { describe, expect, it } from 'vitest'
import { canCollectPayment, canTakeOrders } from '@/lib/store-availability'

/**
 * `canCollectPayment` / `canTakeOrders` — el gate que faltaba antes de que
 * el checkout ofreciera "pagar online" a una tienda que no tiene NINGÚN
 * medio de pago conectado (el estado por defecto de toda tienda recién dada
 * de alta). Ahora son TRES booleanos con un OR: la tabla de verdad completa
 * son ocho combinaciones, y el caso que más importa (transferencia como único
 * medio) tiene su propio test porque es exactamente el bug que la feature de
 * transferencia bancaria vino a matar — un ternario de dos ramas (`online ?
 * 'online' : 'in_store'`) mandaba el pedido como `in_store` y lo nacía
 * `confirmed` e impago.
 */
describe('canCollectPayment — al menos un medio de pago activo', () => {
  it('online sí, el resto no → true', () => {
    expect(
      canCollectPayment({ onlinePaymentEnabled: true, inStorePaymentEnabled: false, transferPaymentEnabled: false }),
    ).toBe(true)
  })

  it('en el local sí, el resto no → true', () => {
    expect(
      canCollectPayment({ onlinePaymentEnabled: false, inStorePaymentEnabled: true, transferPaymentEnabled: false }),
    ).toBe(true)
  })

  it('SOLO transferencia habilitada → true — el caso que motivó la feature: un local que solo acepta transferencia no puede quedar "sin medio de pago"', () => {
    expect(
      canCollectPayment({ onlinePaymentEnabled: false, inStorePaymentEnabled: false, transferPaymentEnabled: true }),
    ).toBe(true)
  })

  it('los tres activos → true', () => {
    expect(
      canCollectPayment({ onlinePaymentEnabled: true, inStorePaymentEnabled: true, transferPaymentEnabled: true }),
    ).toBe(true)
  })

  it('NINGÚN medio de pago → false — el caso que motivó la guarda de createOrder', () => {
    expect(
      canCollectPayment({ onlinePaymentEnabled: false, inStorePaymentEnabled: false, transferPaymentEnabled: false }),
    ).toBe(false)
  })
})

describe('canTakeOrders — acceptingOrders Y algún medio de pago', () => {
  it('acepta pedidos y tiene medio de pago online → true', () => {
    expect(
      canTakeOrders({
        acceptingOrders: true,
        onlinePaymentEnabled: true,
        inStorePaymentEnabled: false,
        transferPaymentEnabled: false,
      }),
    ).toBe(true)
  })

  it('acepta pedidos y SOLO tiene transferencia → true', () => {
    expect(
      canTakeOrders({
        acceptingOrders: true,
        onlinePaymentEnabled: false,
        inStorePaymentEnabled: false,
        transferPaymentEnabled: true,
      }),
    ).toBe(true)
  })

  it('el dueño cerró la tienda (acceptingOrders false) aunque tenga medios de pago → false', () => {
    expect(
      canTakeOrders({
        acceptingOrders: false,
        onlinePaymentEnabled: true,
        inStorePaymentEnabled: true,
        transferPaymentEnabled: true,
      }),
    ).toBe(false)
  })

  /**
   * El caso que exactamente motivó todo esto: una tienda recién dada de alta
   * queda `accepting_orders = true` por default pero sin ningún medio de pago
   * conectado. Antes de esta guarda la vitrina la trataba como abierta.
   */
  it('acepta pedidos pero NINGÚN medio de pago (alta reciente, sin configurar) → false', () => {
    expect(
      canTakeOrders({
        acceptingOrders: true,
        onlinePaymentEnabled: false,
        inStorePaymentEnabled: false,
        transferPaymentEnabled: false,
      }),
    ).toBe(false)
  })

  it('ni acepta pedidos ni tiene medio de pago → false', () => {
    expect(
      canTakeOrders({
        acceptingOrders: false,
        onlinePaymentEnabled: false,
        inStorePaymentEnabled: false,
        transferPaymentEnabled: false,
      }),
    ).toBe(false)
  })
})
