'use server'

import { toActionResult } from '@/lib/action-result'
import { DomainError } from '@/lib/errors'
import { getOrderIdByToken, getOrderWithStoreById } from '@/models/order.model'
import { isTerminalStatus, orderTokenSchema } from '@/models/schemas/order.schema'
import { resolveCheckoutUrl } from './checkout.controller'
import type { ActionResult } from '@/models/types'

/**
 * Botón "Ir a pagar" del seguimiento (F-01, hallazgo crítico de frontend).
 *
 * El link de pago nunca viaja en `OrderPublicView`: `canResumePayment` solo
 * dice si tiene sentido mostrar el botón. La URL se resuelve acá, contra
 * Mercado Pago, en el momento en que el cliente la pide — así nunca se le
 * ofrece un `init_point` que ya venció.
 */
export async function resumePaymentAction(token: string): Promise<ActionResult<{ checkoutUrl: string }>> {
  return toActionResult(async () => {
    const parsedToken = orderTokenSchema.parse(token)

    const orderId = await getOrderIdByToken(parsedToken)
    if (orderId == null) throw new DomainError('No encontramos ese pedido')

    const found = await getOrderWithStoreById(orderId)
    if (!found) throw new DomainError('No encontramos ese pedido')

    const { order, store } = found
    if (order.paymentMethod !== 'online') throw new DomainError('Este pedido no se paga online')
    if (isTerminalStatus(order.status)) throw new DomainError('Este pedido ya no se puede pagar')
    if (order.paymentStatus === 'approved') throw new DomainError('Este pedido ya está pago')

    const checkoutUrl = await resolveCheckoutUrl(order, store)
    return { checkoutUrl }
  }, 'checkout.resumePayment')
}
