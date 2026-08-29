import 'server-only'

import { createHash } from 'node:crypto'
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
    // La clave de idempotencia deriva del CONTENIDO (`inviteUrl`), no del id
    // de la tienda ni del reloj — mismo fix que `courier-invite.tsx`, ver el
    // comentario largo ahí para el porqué completo. Resumen: `inviteUrl` trae
    // un `token_hash` nuevo en cada llamada a `generateLink()`, que nunca
    // repite token. Con una clave atada solo al `storeId` (con o sin balde de
    // tiempo: se probó con un balde de un minuto y dio el mismo resultado) el
    // cuerpo YA es distinto en la segunda invitación, así que Resend nunca
    // encuentra qué deduplicar y responde `409 invalid_idempotent_request`
    // (verificado contra la API real) — no un 200 silencioso. Ese 409 se traga
    // en el log si lo dispara `sendOwnerInvite` (el alta inicial, que nunca
    // tira) o sale como `DomainError` con el mensaje crudo de Resend si lo
    // dispara `resendOwnerInvite`. Ninguna de las dos cosas es lo que se
    // busca: una clave atada a la entidad no deduplica nada, solo convierte
    // cualquier invitación posterior en un error.
    //
    // Hasheando el `inviteUrl`, la clave coincide únicamente cuando el cuerpo
    // es idéntico —un reintento real del mismo request— y dedupea bien
    // (Resend devuelve el `id` cacheado); una invitación nueva trae un link
    // nuevo y por lo tanto una clave nueva, así que sale sin colisionar. Lo
    // que esto NO cubre es el doble click en "Reenviar invitación": dos
    // clicks generan dos links y dos claves, así que salen los dos mails —
    // eso lo frena `disabled={pending}` en la UI, no la idempotencia.
    const idempotencyKey = `store-owner-invite/${p.storeId}/${createHash('sha256').update(p.inviteUrl).digest('hex').slice(0, 32)}`

    const { data, error } = await resend.emails.send(
      {
        from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
        to: [p.to],
        subject: `Entrá al panel de ${p.storeName}`,
        react: <StoreOwnerInviteEmail storeName={p.storeName} inviteUrl={p.inviteUrl} siteUrl={env.NEXT_PUBLIC_SITE_URL} />,
      },
      { idempotencyKey },
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
