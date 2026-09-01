import 'server-only'

import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { z } from 'zod'
import { serverEnv } from '@/lib/env.server'
import { apexUrl, storeUrl } from '@/lib/urls'
import { log } from '@/lib/log'
import { CAMPAIGN_DAILY_BUDGET, describeDiscount } from '@/lib/coupon'
import { claimCampaignRecipients, settleCampaignRecipient, type CampaignRecipientClaim } from '@/models/campaign.model'
import type { Coupon } from '@/models/types'
import StoreCouponCampaignEmail from '@/emails/store-coupon-campaign'
import StoreCampaignQuotaRequestEmail from '@/emails/store-campaign-quota-request'

/**
 * El drenaje de campañas de cupón (§5.10.3 del plan de cupones y campañas) y
 * la vía comercial cuando el cupo no alcanza (§5.10.6).
 *
 * Canal aparte del `EmailSender` de `email.port.ts`, mismo motivo que
 * `courier-invite.tsx`/`payment-change.tsx`: ese contrato es
 * `{ storeId, orderId, ... }` porque las plantillas que sirve son sobre un
 * PEDIDO, y una campaña no tiene pedido — así que no hay fila que insertar en
 * `notifications`. El log de la campaña es `campaign_recipients`.
 *
 * El claim/settle usa `claimCampaignRecipients`/`settleCampaignRecipient` de
 * `campaign.model.ts` (T1B) — ese es el único lugar que le habla a Postgres
 * para estas dos tablas, y ESTE archivo no escribe una sola columna de
 * `coupon_campaigns`/`campaign_recipients` a mano: los tres contadores de la
 * campaña se recalculan y se cierran enteramente adentro de la migración
 * (ver el comentario de cabecera de `claim_campaign_recipients` y
 * `settle_campaign_recipient` en `supabase/migrations/20260901130000_cupones.sql`
 * para el detalle de dónde se cierra cada camino). Hubo una versión anterior
 * de este archivo con `finalizeExhaustedCampaigns`/`forceFailCampaign` que
 * escribían el estado de la campaña desde acá — se sacó apenas la migración
 * cerró el agujero que esas dos funciones parchaban, porque un `update
 * coupon_campaigns` desde TypeScript es exactamente el camino paralelo que la
 * doctrina del feature prohíbe (los contadores se recalculan desde el libro
 * mayor, nadie los escribe a mano — vale para `reserved_count`,
 * `redeemed_count` y para los tres de la campaña).
 */

/**
 * A los 3 intentos (no el default de 5 de `claimCampaignRecipients`) una fila
 * deja de bloquear su chunk. Es el número que pidió la spec de este slice
 * ("3 intentos → failed"), pasado explícito para no depender del default.
 */
const CAMPAIGN_MAX_ATTEMPTS = 3

/**
 * Revalidación real con `z.email()` antes de armar el batch — no un comentario
 * que la promete (03-review.md, Hallazgo 3). `private.looks_like_email()` en
 * la migración es una regex laxa, aplicada una sola vez al encolar
 * (`enqueue_campaign`): entre ese momento y el drenaje no hay ningún otro
 * filtro, y `resend.batch.send()` es ATÓMICO — una sola dirección que la
 * gramática (más estricta) de Resend rechace tira abajo el chunk de 15
 * ENTERO, y con `CAMPAIGN_MAX_ATTEMPTS = 3` esa dirección rota se lleva puesta
 * a las otras 14 tres veces antes de que la campaña quede `failed`.
 */
const campaignEmailSchema = z.email()

/**
 * Sin el timezone del local en lo que devuelve `claimCampaignRecipients`,
 * formateamos la vigencia en UTC EXPLÍCITO — mejor decir "UTC" que heredar en
 * silencio el huso del runtime (que en Vercel ya es UTC, pero un entorno que
 * no lo fuera mentiría sin decirlo). Si hace falta la zona exacta del local,
 * la RPC necesita sumar `stores.timezone` a su `returns table` — queda
 * anotado en el dev log para quien mantenga `campaign.model.ts`.
 */
function formatCouponEndsAt(iso: string | null): string | null {
  if (!iso) return null
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso))
}

/** Los cuatro campos que `describeDiscount()` lee. El resto de `Coupon` no se completa: la función nunca los toca. */
function discountShapeFrom(row: CampaignRecipientClaim): Coupon {
  return {
    discountType: row.discountType,
    percent: row.percent,
    amountOffCents: row.amountOffCents,
    maxDiscountCents: row.maxDiscountCents,
  } as Coupon
}

/**
 * Envoltorio de `settleCampaignRecipient` que nunca tira: la RPC del modelo
 * propaga el error de Postgres (correcto para un caller que necesita
 * enterarse), pero acá cerrar 15 filas en paralelo con `Promise.all` no puede
 * abortar por una sola que falle al asentarse — esa fila simplemente sigue
 * `queued` y el próximo tick la vuelve a intentar.
 */
async function safeSettle(input: { recipientId: number; ok: boolean; providerRef?: string; error?: string }): Promise<void> {
  try {
    await settleCampaignRecipient(input)
  } catch (err) {
    log.error('notifications.email.campaign', 'no se pudo cerrar un destinatario de campaña', err, {
      recipientId: input.recipientId,
    })
  }
}

export type CampaignDrainResult = {
  claimed: number
  sent: number
  failed: number
}

/**
 * Un tick del cron: reclama COMO MUCHO un chunk (≤15, el cupo diario
 * completo — §5.10.3) y lo manda por `/emails/batch`.
 *
 * Nunca tira: un fallo de Resend o de red se registra por destinatario vía
 * `settleCampaignRecipient`, que deja la fila en `queued` para el próximo
 * tick. El cierre de la campaña —a `sent` o a `failed`, según cómo haya
 * terminado el libro mayor— vive ENTERO en la migración
 * (`claim_campaign_recipients`/`settle_campaign_recipient`): este archivo no
 * escribe una sola columna de `coupon_campaigns` a mano. Solo un error
 * reclamando el chunk (permission denied, RPC caída) propaga — ahí sí es
 * nuestro, no de Resend, y el handler del cron lo loguea y responde 500.
 */
export async function drainCampaignQueue(): Promise<CampaignDrainResult> {
  const rows = await claimCampaignRecipients(CAMPAIGN_DAILY_BUDGET, CAMPAIGN_MAX_ATTEMPTS)

  if (rows.length === 0) {
    return { claimed: 0, sent: 0, failed: 0 }
  }

  const campaignId = rows[0].campaignId
  const chunkIndex = rows[0].chunkIndex

  // Las que no pasan `z.email()` se asientan como fallidas ACÁ, antes de
  // tocar Resend: dejarlas adentro del batch tira abajo el chunk de 15
  // entero por una sola dirección rota (ver el comentario de
  // `campaignEmailSchema` arriba). No cuentan para el hash de idempotencia
  // de más abajo — ese tiene que reflejar lo que de verdad se manda.
  const invalidRows = rows.filter((row) => !campaignEmailSchema.safeParse(row.email).success)
  const validRows = rows.filter((row) => campaignEmailSchema.safeParse(row.email).success)

  if (invalidRows.length > 0) {
    log.error('notifications.email.campaign', 'direcciones con formato inválido descartadas del batch', undefined, {
      campaignId,
      chunkIndex,
      count: invalidRows.length,
    })
    await Promise.all(
      invalidRows.map((row) =>
        safeSettle({ recipientId: row.recipientId, ok: false, error: 'La dirección de email tiene un formato inválido.' }),
      ),
    )
  }

  if (validRows.length === 0) {
    return { claimed: rows.length, sent: 0, failed: invalidRows.length }
  }

  const recipientIds = validRows.map((row) => row.recipientId)

  const env = serverEnv()
  const fromAddress = env.RESEND_CAMPAIGN_FROM_EMAIL ?? env.RESEND_FROM_EMAIL
  const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

  // Sin key o sin NINGÚN remitente configurado: ni siquiera intentamos la
  // llamada a Resend. Cada destinatario se asienta como fallido por la vía
  // normal (`settleCampaignRecipient`, que deja la fila `queued` con el
  // error anotado) — el cierre a `failed` de la campaña, cuando los
  // reintentos se agoten, lo hace la migración sola. Nada de esto escribe
  // `coupon_campaigns` desde acá: eso era el bug que se sacó (ver el
  // comentario de cabecera del archivo).
  if (!resend || !fromAddress) {
    const reason = !env.RESEND_API_KEY
      ? 'Resend sin configurar (falta RESEND_API_KEY): la campaña no se pudo mandar.'
      : 'Sin remitente configurado (falta RESEND_FROM_EMAIL o RESEND_CAMPAIGN_FROM_EMAIL): la campaña no se pudo mandar.'
    log.error('notifications.email.campaign', reason, undefined, { campaignId, chunkIndex })
    await Promise.all(validRows.map((row) => safeSettle({ recipientId: row.recipientId, ok: false, error: reason })))
    return { claimed: rows.length, sent: 0, failed: rows.length }
  }

  // Degrada, no tira (§5.10.5): el aislamiento de reputación es un riesgo
  // estadístico, no binario, así que la campaña sale igual desde el
  // remitente de siempre — pero el `log.warn` deja visible el paso operativo
  // pendiente en vez de que se olvide.
  if (!env.RESEND_CAMPAIGN_FROM_EMAIL) {
    log.warn(
      'notifications.email.campaign',
      'RESEND_CAMPAIGN_FROM_EMAIL sin configurar: la campaña sale del remitente de siempre',
      { campaignId },
    )
  }

  const from = `${env.RESEND_FROM_NAME} <${fromAddress}>`

  // La clave de idempotencia deriva del CONTENIDO del chunk, no solo de su
  // índice: si un destinatario se da de baja entre dos ticks,
  // `claim_campaign_recipients` lo saca del chunk, el payload cambia, y esta
  // clave TIENE que cambiar con él — si no, Resend responde
  // `409 invalid_idempotent_request` para siempre en ese chunk (verificado
  // contra la API real en el feature de repartidores, ver el comentario largo
  // de `courier-invite.tsx`). Un reintento por `attempts` manda el MISMO
  // payload, así que la clave coincide y Resend dedupea de verdad.
  const contentHash = createHash('sha256')
    .update([...recipientIds].sort((a, b) => a - b).join(','))
    .digest('hex')
    .slice(0, 16)
  const idempotencyKey = `campaign/${campaignId}/${chunkIndex}/${contentHash}`

  const emails = validRows.map((row) => {
    const unsubscribePageUrl = apexUrl(`/baja/${row.unsubscribeToken}`)
    // La ruta de one-click es DISTINTA de la página humana a propósito: Next
    // no permite un `page.tsx` y un `route.ts` en el mismo path. El header va
    // acá, el link del cuerpo va a la página humana — invertirlos deja el
    // botón "Cancelar suscripción" de Gmail/Outlook sin efecto y sin error
    // visible. Ver `src/app/baja/[token]/one-click/route.ts`.
    const unsubscribeOneClickUrl = apexUrl(`/baja/${row.unsubscribeToken}/one-click`)

    return {
      from,
      to: [row.email],
      subject: row.subject,
      react: (
        <StoreCouponCampaignEmail
          storeName={row.storeName}
          customerName={row.customerName}
          subject={row.subject}
          message={row.message}
          couponCode={row.couponCode}
          discountLabel={describeDiscount(discountShapeFrom(row))}
          endsAtLabel={formatCouponEndsAt(row.couponEndsAt)}
          storeUrl={storeUrl(row.storeSlug, '/')}
          unsubscribeUrl={unsubscribePageUrl}
        />
      ),
      // Resend NO inyecta esto en `/emails` ni en `/emails/batch` — hay que
      // ponerlo por destinatario, con SU token (§5.10.4). RFC 8058 exige las
      // dos cabeceras juntas para que Gmail/Outlook muestren el botón de un
      // click.
      headers: {
        'List-Unsubscribe': `<${unsubscribeOneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
  })

  try {
    // Atómico: Resend lo dice explícito (§3.4 del plan) — un destinatario
    // inválido hace fallar el batch ENTERO. Por eso `validRows` ya pasó por
    // `campaignEmailSchema` arriba: si esto falla, es la API o la red, no un
    // mail mal tipeado que se nos coló.
    const sendResult = await resend.batch.send(emails, { idempotencyKey })
    const sendError = sendResult.error
    // Cast puntual: el tipo `CreateBatchSuccessResponse<Options>` del SDK
    // intersecta `{ data: {id:string}[] }` con `Record<string, never>` cuando
    // `batchValidation` no es literalmente `'permissive'` (nuestro caso, el
    // default `'strict'`), y esa intersección colapsa `data` a `never` —
    // reproducido en aislamiento contra `resend@6.24`. El shape en runtime es
    // el documentado: un array de `{id}` en el mismo orden que se mandó.
    const data = sendResult.data as { id: string }[] | null

    if (sendError) {
      // Nunca el body completo de la respuesta de Resend en el log.
      log.error('notifications.email.campaign', 'Resend rechazó el batch de campaña', undefined, {
        campaignId,
        chunkIndex,
        resendError: sendError.message,
      })
      await Promise.all(
        validRows.map((row) => safeSettle({ recipientId: row.recipientId, ok: false, error: sendError.message })),
      )
      return { claimed: rows.length, sent: 0, failed: rows.length }
    }

    // `data` viene en el MISMO orden que se mandó (`batchValidation: 'strict'`,
    // el default): se puede indexar por posición sin reordenar nada.
    await Promise.all(
      validRows.map((row, index) => safeSettle({ recipientId: row.recipientId, ok: true, providerRef: data?.[index]?.id })),
    )
    return { claimed: rows.length, sent: validRows.length, failed: invalidRows.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido llamando a la API de Resend.'
    log.error('notifications.email.campaign', 'fallo de red mandando el batch de campaña', err, {
      campaignId,
      chunkIndex,
    })
    await Promise.all(validRows.map((row) => safeSettle({ recipientId: row.recipientId, ok: false, error: message })))
    return { claimed: rows.length, sent: 0, failed: rows.length }
  }
}

export type CampaignQuotaRequestResult = { status: 'sent' | 'skipped'; error?: string } | { status: 'failed'; error: string }

/**
 * El pedido de más cupo de campaña (§5.10.6), a `SALES_EMAIL`. Degrada, no
 * tira: si no sale, el panel le muestra al dueño la dirección para escribir a
 * mano — un pedido comercial que no sale no rompe nada.
 *
 * Mismo patrón que `sendPaymentSupportRequest` de `payment-change.tsx`:
 * `replyTo` con el mail del dueño (responder le llega directo a quien lo
 * pidió) y un balde de un minuto en la clave de idempotencia para el doble
 * tap, sin bloquear un segundo pedido con más contexto diez minutos después.
 */
export async function sendCampaignQuotaRequest(p: {
  storeId: number
  storeName: string
  storeSlug: string
  ownerEmail: string
  customersTotal: number
  customersWithEmail: number
  campaignRecipients: number
  daysNeeded: number
  activeCoupons: number
  redemptionsLastMonth: number
  message: string | null
}): Promise<CampaignQuotaRequestResult> {
  const env = serverEnv()

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    const error = 'Resend sin configurar (falta RESEND_API_KEY o RESEND_FROM_EMAIL): no se mandó el pedido de cupo.'
    log.warn('notifications.email.campaignQuota', error, { storeId: p.storeId })
    return { status: 'skipped', error }
  }
  if (!env.SALES_EMAIL) {
    const error = 'SALES_EMAIL sin configurar: no hay a dónde mandar el pedido de cupo.'
    log.warn('notifications.email.campaignQuota', error, { storeId: p.storeId })
    return { status: 'skipped', error }
  }

  const resend = new Resend(env.RESEND_API_KEY)

  try {
    const { error } = await resend.emails.send(
      {
        from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
        to: [env.SALES_EMAIL],
        replyTo: p.ownerEmail,
        subject: `Pedido de más cupo de campaña — ${p.storeName} (/${p.storeSlug})`,
        react: (
          <StoreCampaignQuotaRequestEmail
            storeName={p.storeName}
            storeSlug={p.storeSlug}
            storeId={p.storeId}
            ownerEmail={p.ownerEmail}
            customersTotal={p.customersTotal}
            customersWithEmail={p.customersWithEmail}
            campaignRecipients={p.campaignRecipients}
            daysNeeded={p.daysNeeded}
            activeCoupons={p.activeCoupons}
            redemptionsLastMonth={p.redemptionsLastMonth}
            message={p.message}
          />
        ),
      },
      { idempotencyKey: `store-campaign-quota-request/${p.storeId}/${Math.floor(Date.now() / 60_000)}` },
    )

    if (error) {
      log.error('notifications.email.campaignQuota', 'Resend rechazó el pedido de cupo', undefined, {
        storeId: p.storeId,
        resendError: error.message,
      })
      return { status: 'failed', error: error.message }
    }

    return { status: 'sent' }
  } catch (err) {
    log.error('notifications.email.campaignQuota', 'fallo de red mandando el pedido de cupo', err, {
      storeId: p.storeId,
    })
    return { status: 'failed', error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}
