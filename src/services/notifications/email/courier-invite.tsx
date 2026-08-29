import 'server-only'

import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { serverEnv } from '@/lib/env.server'
import { apexUrl } from '@/lib/urls'
import { log } from '@/lib/log'
import StoreCourierInviteEmail from '@/emails/store-courier-invite'

export type SendCourierInviteResult = { status: 'sent' | 'skipped' | 'failed'; providerRef?: string; error?: string }

/**
 * Canal aparte del `EmailSender` de `email.port.ts`, mismo motivo que
 * `owner-invite.tsx`: ese contrato es `{storeId, orderId, ...}` porque las
 * plantillas que sirve son sobre un PEDIDO (`notifications.order_id` es
 * `not null`), y acá no hay pedido. Misma resiliencia igual: sin
 * `RESEND_API_KEY` o `RESEND_FROM_EMAIL` devuelve `skipped` y nunca tira. El
 * repartidor ya está dado de alta en `store_members` cuando esto se llama;
 * que no salga el mail no puede deshacer esa fila.
 */
export async function sendCourierInviteEmail(p: {
  courierId: number
  to: string
  storeName: string
  courierName: string
  inviteUrl: string
}): Promise<SendCourierInviteResult> {
  const env = serverEnv()

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    const error = 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó la invitación por mail.'
    log.warn('notifications.email.courierInvite', error, { courierId: p.courierId })
    return { status: 'skipped', error }
  }

  const resend = new Resend(env.RESEND_API_KEY)

  try {
    // La clave de idempotencia deriva del CONTENIDO (`inviteUrl`), no del id
    // del repartidor ni del reloj. Es la única forma de que el mecanismo
    // dedupe algo de verdad acá:
    //
    // `inviteUrl` trae un `token_hash` nuevo en CADA llamada a
    // `generateCourierInviteLink` (que a su vez llama a
    // `admin.auth.admin.generateLink()`, que nunca devuelve el mismo token dos
    // veces). Eso significa que dos invocaciones de `inviteCourier` —sean un
    // reintento nuestro, un doble click, o dos invitaciones genuinamente
    // separadas— casi nunca mandan el mismo cuerpo. Con una clave atada al
    // `courierId` (con o sin balde de tiempo: se probó con un balde de un
    // minuto y el resultado fue el mismo) el cuerpo YA cambió para la segunda
    // llamada, así que Resend no encuentra un duplicado que devolver: responde
    // `409 invalid_idempotent_request` ("the request body was modified"),
    // verificado contra la API real. Es decir, una clave atada a la entidad no
    // deduplica nada — solo convierte cualquier segunda invitación en un error,
    // silencioso en `inviteCourier` (que lo traga en el log) y visible como
    // `DomainError` en `resendCourierInvite` (que si tira).
    //
    // Hasheando el `inviteUrl` en cambio, la clave SOLO coincide cuando el
    // cuerpo es idéntico: un reintento real del mismo request (un blip de red
    // que reintenta el SDK, o una replay de la función) manda el mismo link y
    // dedupea correcto (Resend devuelve el `id` cacheado); una invitación
    // nueva trae un link nuevo y por lo tanto una clave nueva, así que sale
    // sin colisionar jamás con la anterior.
    //
    // Lo que esto NO cubre es el doble click en el botón: dos clicks generan
    // dos links (dos `token_hash`) y por lo tanto dos claves distintas, así
    // que salen los DOS mails — la clave de idempotencia no puede frenar eso
    // porque los cuerpos nunca son iguales. Esa protección es de la UI:
    // `disabled={pending}` en `invite-courier-form.tsx` y `courier-row.tsx`
    // evita que un click repetido dispare una segunda invocación mientras la
    // primera sigue en vuelo.
    const idempotencyKey = `store-courier-invite/${p.courierId}/${createHash('sha256').update(p.inviteUrl).digest('hex').slice(0, 32)}`

    const { data, error } = await resend.emails.send(
      {
        from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
        to: [p.to],
        subject: `Te sumaron como repartidor de ${p.storeName}`,
        // El panel vive en el apex siempre, igual que en `owner-invite.tsx`
        // (sin uso hoy en esta plantilla, ver el comentario de `siteUrl` en
        // `StoreCourierInviteVars`).
        react: (
          <StoreCourierInviteEmail
            storeName={p.storeName}
            courierName={p.courierName}
            inviteUrl={p.inviteUrl}
            siteUrl={apexUrl('/')}
          />
        ),
      },
      { idempotencyKey },
    )

    if (error) {
      log.error('notifications.email.courierInvite', 'Resend rechazó el envío de la invitación', undefined, {
        courierId: p.courierId,
        resendError: error.message,
      })
      return { status: 'failed', error: error.message }
    }

    return { status: 'sent', providerRef: data?.id }
  } catch (err) {
    log.error('notifications.email.courierInvite', 'fallo de red llamando a la API de Resend', err, {
      courierId: p.courierId,
    })
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Error desconocido llamando a la API de Resend.',
    }
  }
}
