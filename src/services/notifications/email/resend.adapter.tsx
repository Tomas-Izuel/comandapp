import 'server-only'

import { Resend } from 'resend'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import OrderReadyEmail from '@/emails/order-ready'
import OrderReceiptEmail from '@/emails/order-receipt'
import type { NotificationResult } from '../notifier.port'
import { logNotification } from '../log'
import type { EmailSender, EmailTemplate, EmailVars } from './email.port'
import { wasAlreadySent } from './log'

function subjectFor(template: EmailTemplate, vars: EmailVars): string {
  switch (template) {
    case 'order_receipt':
      return vars.paymentPending
        ? `Pedido ${vars.shortCode} confirmado en ${vars.storeName}`
        : `Comprobante de tu pedido ${vars.shortCode} en ${vars.storeName}`
    case 'order_ready':
      return `Tu pedido ${vars.shortCode} en ${vars.storeName} ya está listo`
  }
}

function componentFor(template: EmailTemplate, vars: EmailVars) {
  switch (template) {
    case 'order_receipt':
      return <OrderReceiptEmail {...vars} />
    case 'order_ready':
      return <OrderReadyEmail {...vars} />
  }
}

/**
 * Adapter real. Solo lo entrega `getEmailSender()` cuando `RESEND_API_KEY` y
 * `RESEND_FROM_EMAIL` están seteados, pero se revalida acá adentro también
 * (defensa en profundidad: este archivo no asume que el caller lo garantizó).
 */
export const resendEmailSender: EmailSender = {
  kind: 'resend',
  async send({ storeId, orderId, to, template, vars }) {
    if (await wasAlreadySent(orderId, template)) {
      return { status: 'skipped' }
    }

    const env = serverEnv()

    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      const result: NotificationResult = {
        status: 'skipped',
        error: 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó comprobante por mail.',
      }
      await logNotification({ channel: 'email', storeId, orderId, toAddress: to, template, result })
      return result
    }

    const resend = new Resend(env.RESEND_API_KEY)

    try {
      // Idempotency key con el formato recomendado <evento>/<entidad>: si el
      // webhook de Mercado Pago reintenta la llamada HTTP en simultáneo con
      // otra, Resend devuelve la respuesta original en vez de mandar dos
      // veces. Es una segunda red de contención además del check de arriba.
      const { data, error } = await resend.emails.send(
        {
          from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
          to: [to],
          subject: subjectFor(template, vars),
          react: componentFor(template, vars),
        },
        { idempotencyKey: `${template}/${orderId}` },
      )

      if (error) {
        // Nunca se loguea el body completo de la respuesta de Resend.
        log.error('notifications.email.resend', 'Resend rechazó el envío', undefined, {
          storeId,
          orderId,
          template,
          resendError: error.message,
        })
        const result: NotificationResult = { status: 'failed', error: error.message }
        await logNotification({ channel: 'email', storeId, orderId, toAddress: to, template, result })
        return result
      }

      const result: NotificationResult = { status: 'sent', providerRef: data?.id }
      await logNotification({ channel: 'email', storeId, orderId, toAddress: to, template, result })
      return result
    } catch (err) {
      log.error('notifications.email.resend', 'fallo de red llamando a la API de Resend', err, {
        storeId,
        orderId,
        template,
      })
      const result: NotificationResult = {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Error desconocido llamando a la API de Resend.',
      }
      await logNotification({ channel: 'email', storeId, orderId, toAddress: to, template, result })
      return result
    }
  },
}
