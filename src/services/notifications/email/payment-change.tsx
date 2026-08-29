import 'server-only'

import { Resend } from 'resend'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import { DomainError } from '@/lib/errors'
import StorePaymentChangeCodeEmail from '@/emails/store-payment-change-code'
import StorePaymentChangeNoticeEmail from '@/emails/store-payment-change-notice'
import StorePaymentSupportEmail from '@/emails/store-payment-support'

/**
 * Mails de la pantalla de Pagos: el código de confirmación, el aviso que lo
 * acompaña, y el pedido de soporte.
 *
 * Canal aparte del `EmailSender` de `email.port.ts`, mismo motivo que
 * `courier-invite.tsx`: ese contrato es `{ storeId, orderId, ... }` porque las
 * plantillas que sirve son sobre un PEDIDO, y acá no hay pedido.
 *
 * **La resiliencia va al revés que en el resto del sistema.** El comprobante de
 * un pedido devuelve `skipped` sin key porque no puede romper una venta ya
 * cobrada. Acá el mail ES el segundo factor: si no sale, el dueño no tiene cómo
 * confirmar y la solicitud queda creada sin forma de completarla. Por eso
 * `sendPaymentChangeCode` **tira** en vez de degradar — el error claro es
 * mejor que un formulario esperando un código que nunca va a llegar.
 *
 * El aviso y el soporte sí degradan: son informativos, no bloquean nada.
 */

/** Qué se está por cambiar, en palabras del dueño. Un nombre de columna no le dice nada. */
export const CHANGE_LABELS = {
  payment_credentials: 'la cuenta de Mercado Pago donde recibís los cobros',
  courier_payment_policy: 'si el repartidor cobra en la puerta',
} as const

function resendClient(): Resend | null {
  const env = serverEnv()
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return null
  return new Resend(env.RESEND_API_KEY)
}

function from(): string {
  const env = serverEnv()
  return `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`
}

/**
 * El código. Tira si no sale — ver el comentario de arriba.
 *
 * `attempt` entra en la clave de idempotencia porque cada reenvío genera un
 * código NUEVO y tiene que salir sí o sí. La ventana de idempotencia de Resend
 * es de 24hs: con una clave fija por solicitud, el segundo mail se descartaría
 * en silencio y el dueño se quedaría tipeando un código viejo que ya no vale.
 * Es exactamente el bug que `courier-invite.tsx` resolvió en el reenvío de
 * invitaciones.
 */
export async function sendPaymentChangeCode(p: {
  requestId: number
  attempt: number
  to: string
  storeName: string
  kind: keyof typeof CHANGE_LABELS
  code: string
}): Promise<void> {
  const resend = resendClient()
  if (!resend) {
    log.error('notifications.email.paymentChange', 'Resend sin configurar: no se puede mandar el código', undefined, {
      pendingChangeId: p.requestId,
    })
    throw new DomainError(
      'No pudimos mandarte el código por mail. Probá de nuevo en un rato o pedí ayuda desde el botón de soporte.',
      { status: 503 },
    )
  }

  const { error } = await resend.emails.send(
    {
      from: from(),
      to: [p.to],
      subject: `Tu código para cambiar los pagos de ${p.storeName}`,
      react: (
        <StorePaymentChangeCodeEmail
          storeName={p.storeName}
          code={p.code}
          changeLabel={CHANGE_LABELS[p.kind]}
        />
      ),
    },
    { idempotencyKey: `store-payment-change-code/${p.requestId}/${p.attempt}` },
  )

  if (error) {
    log.error('notifications.email.paymentChange', 'Resend rechazó el envío del código', undefined, {
      pendingChangeId: p.requestId,
      resendError: error.message,
    })
    throw new DomainError('No pudimos mandarte el código por mail. Probá de nuevo en un rato.', { status: 503 })
  }
}

/**
 * El aviso, sin código. Best-effort: si esto falla, el cambio igual está
 * frenado por el código, así que romper el flujo no protege a nadie — solo
 * impide que el dueño confirme un cambio que sí quería hacer.
 */
export async function sendPaymentChangeNotice(p: {
  requestId: number
  to: string
  storeName: string
  kind: keyof typeof CHANGE_LABELS
  requestedByEmail: string
  requestedAtLabel: string
}): Promise<void> {
  const resend = resendClient()
  if (!resend) return

  try {
    const { error } = await resend.emails.send(
      {
        from: from(),
        to: [p.to],
        subject: `Movimiento en los pagos de ${p.storeName}`,
        react: (
          <StorePaymentChangeNoticeEmail
            storeName={p.storeName}
            changeLabel={CHANGE_LABELS[p.kind]}
            requestedByEmail={p.requestedByEmail}
            requestedAtLabel={p.requestedAtLabel}
          />
        ),
      },
      { idempotencyKey: `store-payment-change-notice/${p.requestId}` },
    )

    if (error) {
      log.warn('notifications.email.paymentChange', 'no salió el aviso de cambio de pagos', {
        pendingChangeId: p.requestId,
        resendError: error.message,
      })
    }
  } catch (err) {
    log.warn('notifications.email.paymentChange', 'fallo de red mandando el aviso de cambio de pagos', {
      pendingChangeId: p.requestId,
      error: err instanceof Error ? err.message : 'desconocido',
    })
  }
}

export type SupportRequestResult = { status: 'sent' | 'skipped' | 'failed'; error?: string }

/**
 * Pedido de ayuda para conectar Mercado Pago, del panel del local a soporte.
 *
 * `replyTo` con el mail de quien lo pide: sin eso, responder el mail le
 * contesta al remitente de la plataforma y el pedido muere ahí.
 *
 * El balde de un minuto en la clave de idempotencia frena el doble tap sin
 * bloquear a alguien que manda un segundo pedido con más detalle diez minutos
 * después. El throttle de verdad vive en la acción.
 */
export async function sendPaymentSupportRequest(p: {
  storeId: number
  storeName: string
  storeSlug: string
  requestedByEmail: string
  requestedByRole: 'owner' | 'staff'
  connectionLabel: string
  message: string | null
}): Promise<SupportRequestResult> {
  const env = serverEnv()
  const resend = resendClient()

  if (!resend) {
    const error = 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó el pedido de soporte.'
    log.warn('notifications.email.paymentSupport', error, { storeId: p.storeId })
    return { status: 'skipped', error }
  }

  try {
    const { error } = await resend.emails.send(
      {
        from: from(),
        to: [env.SUPPORT_EMAIL],
        replyTo: p.requestedByEmail,
        subject: `Soporte de pagos — ${p.storeName} (/${p.storeSlug})`,
        react: (
          <StorePaymentSupportEmail
            storeName={p.storeName}
            storeSlug={p.storeSlug}
            storeId={p.storeId}
            requestedByEmail={p.requestedByEmail}
            requestedByRole={p.requestedByRole}
            connectionLabel={p.connectionLabel}
            message={p.message}
          />
        ),
      },
      { idempotencyKey: `store-payment-support/${p.storeId}/${Math.floor(Date.now() / 60_000)}` },
    )

    if (error) {
      log.error('notifications.email.paymentSupport', 'Resend rechazó el pedido de soporte', undefined, {
        storeId: p.storeId,
        resendError: error.message,
      })
      return { status: 'failed', error: error.message }
    }

    return { status: 'sent' }
  } catch (err) {
    log.error('notifications.email.paymentSupport', 'fallo de red mandando el pedido de soporte', err, {
      storeId: p.storeId,
    })
    return { status: 'failed', error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
