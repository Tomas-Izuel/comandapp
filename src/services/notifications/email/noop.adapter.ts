import 'server-only'

import type { NotificationResult } from '../notifier.port'
import { logNotification } from '../log'
import type { EmailSender } from './email.port'
import { wasAlreadySent } from './log'

/**
 * Adapter por defecto sin `RESEND_API_KEY` / `RESEND_FROM_EMAIL`. Nunca
 * lanza: que no salga un comprobante no puede romper un pedido que ya se
 * pagó. Mismo principio que el `skipped` del adapter `cloud` de WhatsApp
 * cuando faltan sus credenciales.
 */
export const noopEmailSender: EmailSender = {
  kind: 'noop',
  async send({ storeId, orderId, to, template }) {
    if (await wasAlreadySent(orderId, template)) {
      return { status: 'skipped' }
    }

    const result: NotificationResult = {
      status: 'skipped',
      error: 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó comprobante por mail.',
    }
    await logNotification({ channel: 'email', storeId, orderId, toAddress: to, template, result })
    return result
  },
}
