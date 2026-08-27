import 'server-only'

import { mercadopagoAdapter } from './mercadopago.adapter'
import type { PaymentProvider } from './payment.port'

/**
 * Único punto de entrada al proveedor de pagos activo. Hoy siempre devuelve
 * el adapter de Mercado Pago, pero el resto del código nunca debería
 * importar `mercadopago.adapter.ts` directo — así cambiar de proveedor, o
 * agregar uno nuevo, es tocar este archivo y nada más.
 */
export function getPaymentProvider(): PaymentProvider {
  return mercadopagoAdapter
}

export type { CheckoutSession, PaymentProvider, PaymentSnapshot, RefundResult } from './payment.port'
