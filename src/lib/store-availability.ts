import type { Store } from '@/models/types'

/**
 * "¿Esta tienda puede cobrar?" — la pregunta que faltaba.
 *
 * Un local puede estar `active` y con `accepting_orders = true` y aun así no
 * tener NINGÚN medio de pago: no conectó Mercado Pago y no habilitó el pago en
 * el local. Es el estado por defecto de toda tienda recién dada de alta. Hasta
 * ahora la vitrina lo trataba como abierta, el cliente armaba el pedido y el
 * error aparecía al final, después de dejar nombre y teléfono.
 *
 * Funciones puras y sin dependencias para que las use la misma lógica en los
 * dos lados: el modelo, que decide si el pedido se crea, y las pages, que
 * deciden si se puede empezar a armarlo.
 */

type PaymentFlags = Pick<Store, 'inStorePaymentEnabled' | 'onlinePaymentEnabled' | 'transferPaymentEnabled'>

export function canCollectPayment(store: PaymentFlags): boolean {
  return store.onlinePaymentEnabled || store.inStorePaymentEnabled || store.transferPaymentEnabled
}

/**
 * El gate real de la vitrina. `acceptingOrders` es la decisión del dueño
 * ("estoy cerrado ahora"); esto le suma la realidad ("no tengo cómo cobrar").
 * Para el cliente el resultado es el mismo: no se puede pedir.
 */
export function canTakeOrders(store: PaymentFlags & Pick<Store, 'acceptingOrders'>): boolean {
  return store.acceptingOrders && canCollectPayment(store)
}
