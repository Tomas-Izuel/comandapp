import 'server-only'

import { Resend } from 'resend'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import StoreOwnerInviteEmail from '@/emails/store-owner-invite'

export type SendOwnerInviteResult = { status: 'sent' | 'skipped' | 'failed'; providerRef?: string; error?: string }

/**
 * Canal aparte del `EmailSender` de `email.port.ts`: ESE contrato es
 * `{storeId, orderId, ...}` porque las tres plantillas que sirve son sobre un
 * PEDIDO, y `notifications` (la tabla que registra los intentos) tiene
 * `order_id not null` — no hay pedido acá, así que no hay fila que insertar.
 * Mismo principio de resiliencia igual: sin `RESEND_API_KEY` o
 * `RESEND_FROM_EMAIL` devuelve `skipped` y nunca tira. La tienda ya está
 * creada cuando esto se llama; que no salga el mail no puede deshacerla.
 */
export async function sendOwnerInviteEmail(p: {
  storeId: number
  to: string
  storeName: string
  inviteUrl: string
}): Promise<SendOwnerInviteResult> {
  const env = serverEnv()

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    const error = 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó la invitación por mail.'
    log.warn('notifications.email.ownerInvite', error, { storeId: p.storeId })
    return { status: 'skipped', error }
  }

  const resend = new Resend(env.RESEND_API_KEY)

  try {
    // Idempotency key con el mismo formato que el resto de los envíos
    // (<evento>/<entidad>): un reenvío accidental por doble click en
    // "Reenviar invitación" dentro de la ventana de 24hs de Resend devuelve
    // la respuesta original en vez de mandar el mail dos veces.
    const { data, error } = await resend.emails.send(
      {
        from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
        to: [p.to],
        subject: `Entrá al panel de ${p.storeName}`,
        react: <StoreOwnerInviteEmail storeName={p.storeName} inviteUrl={p.inviteUrl} siteUrl={env.NEXT_PUBLIC_SITE_URL} />,
      },
      { idempotencyKey: `store-owner-invite/${p.storeId}` },
    )

    if (error) {
      log.error('notifications.email.ownerInvite', 'Resend rechazó el envío de la invitación', undefined, {
        storeId: p.storeId,
        resendError: error.message,
      })
      return { status: 'failed', error: error.message }
    }

    return { status: 'sent', providerRef: data?.id }
  } catch (err) {
    log.error('notifications.email.ownerInvite', 'fallo de red llamando a la API de Resend', err, {
      storeId: p.storeId,
    })
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Error desconocido llamando a la API de Resend.',
    }
  }
}
