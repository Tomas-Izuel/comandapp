'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/supabase/server'
import { requireStoreMembership, getStoreById } from '@/models/store.model'
import { DomainError, RateLimitError } from '@/lib/errors'
import { formatDayShort, formatDateTimeLong, zonedDay } from '@/lib/dates'
import { toActionResult } from '@/lib/action-result'
import { requiresConfirmation, type CouponShape } from '@/lib/coupon'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
import {
  createPendingChange,
  consumePendingChange,
  type PendingChangePayload,
} from '@/models/store-pending-change.model'
import { confirmationCodeSchema, type PendingChangeStarted } from '@/controllers/admin.controller'
import { sendPaymentChangeCode, sendPaymentChangeNotice } from '@/services/notifications/email/payment-change'
import {
  createCouponDraft,
  updateCoupon,
  setCouponStatus,
  deleteUnusedCoupon,
  getCouponById,
} from '@/models/coupon.model'
import { previewSegment, enqueueCampaign, getMarketingQuotaStats } from '@/models/campaign.model'
import { sendCampaignQuotaRequest } from '@/services/notifications/email/campaign'
import {
  storeIdSchema,
  couponIdSchema,
  couponInputSchema,
  campaignPreviewInputSchema,
  campaignCreateInputSchema,
  campaignQuotaRequestInputSchema,
  type CouponInput,
} from '@/models/schemas/coupon.schema'
import type { ActionResult, CampaignPreview, CampaignSegment, Coupon } from '@/models/types'
import type { RateLimitBucket } from '@/models/types'

/**
 * Server Actions de cupones y campañas (T1B). Todas repiten
 * `requireStoreMembership(storeId, { role: 'owner' })`: un cupón es plata y
 * una campaña habla en nombre de la marca, así que ni siquiera el staff del
 * mostrador entra (00-architecture.md §5.11.1).
 *
 * Solo funciones async exportadas — regla dura de un archivo `'use server'`.
 */

/**
 * Frase legible para un `RateLimitError`. Duplicada a propósito en cada
 * `.actions.ts` (ya lo está en `admin.actions.ts`, `staff.actions.ts` y
 * `platform.actions.ts`): un archivo con `'use server'` en la primera línea
 * solo puede EXPORTAR funciones async, así que este helper no puede vivir en
 * un controller compartido sin dejar de ser privado.
 */
function humanizeRetryAfter(seconds: number): string {
  if (seconds < 60) return 'unos segundos'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} hora${hours === 1 ? '' : 's'}`
}

/** Consume un balde y tira `RateLimitError` si ya no queda cupo. Mismo helper que el resto de `.actions.ts`. */
async function consumeOrThrow(
  bucket: RateLimitBucket,
  subject: string,
  message: (retryAfterSeconds: number) => string,
  onError?: 'allow' | 'deny',
): Promise<void> {
  const policy = RATE_LIMIT_POLICY[bucket]
  const decision = await consumeRateLimit({ bucket, subject, ...policy, onError })
  if (!decision.allowed) {
    throw new RateLimitError(message(decision.retryAfterSeconds), decision.retryAfterSeconds)
  }
}

/** `du••••@gmail.com`: alcanza para que el dueño reconozca su casilla sin publicarla en pantalla. Mismo helper que `admin.actions.ts`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(2, local.length - 2))}@${domain}`
}

// ---------------------------------------------------------------------------
// El segundo factor de cupones (§5.11.3)
// ---------------------------------------------------------------------------

/**
 * Lo que viaja en `store_pending_changes.payload` para `kind: 'coupon'`.
 *
 * Discriminado por `action` porque hay DOS caminos que piden código y son
 * distintos: activar/reactivar no cambia ni un campo (el cupón ya tiene la
 * forma que va a tener), así que su payload es solo el id; editar un cupón
 * activo escalando manda la forma NUEVA completa, y confirmarlo reemplaza el
 * cupón entero sin tocar `status` (que ya es `active`).
 */
type CouponPendingChangePayload =
  | { action: 'activate'; couponId: number }
  | { action: 'update'; couponId: number; input: CouponInput }

/**
 * Arranca un cambio de cupón que pide código: crea la solicitud (con
 * `subjectId = couponId`, para que dos cupones activándose el mismo día no se
 * invaliden el código entre sí) y manda el código + el aviso, reusando las
 * plantillas de `/admin/pagos` — `CHANGE_LABELS` ya tiene la entrada
 * `coupon: 'un cupón de descuento'`.
 */
async function startCouponPendingChange(p: {
  storeId: number
  userId: string
  couponId: number
  payload: CouponPendingChangePayload
}): Promise<PendingChangeStarted> {
  const user = await getCurrentUser()
  const email = user?.email
  if (!email) {
    throw new DomainError(
      'Tu cuenta no tiene un mail asociado, así que no podemos mandarte el código de confirmación.',
      { status: 400 },
    )
  }

  const store = await getStoreById(p.storeId)
  if (!store) throw new DomainError('No encontramos el local.', { status: 404 })

  // Fail-closed: son un segundo factor, y Supabase Auth / Resend son
  // servicios aparte que pueden seguir mandando mail con Postgres caído
  // (00-architecture.md §5.13, mismo criterio que `magic_link:*`).
  await consumeOrThrow(
    'coupon_change:store',
    String(p.storeId),
    (s) => `Ya pediste demasiados cambios de cupones para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    'deny',
  )
  await consumeOrThrow(
    'coupon_change:store:day',
    String(p.storeId),
    (s) => `Llegaste al máximo de cambios de cupones por hoy para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
    'deny',
  )

  const { id, code } = await createPendingChange({
    storeId: p.storeId,
    userId: p.userId,
    kind: 'coupon',
    subjectId: p.couponId,
    payload: p.payload as unknown as PendingChangePayload,
  })

  await sendPaymentChangeCode({ requestId: id, attempt: 1, to: email, storeName: store.name, kind: 'coupon', code })
  await sendPaymentChangeNotice({
    requestId: id,
    to: email,
    storeName: store.name,
    kind: 'coupon',
    requestedByEmail: email,
    requestedAtLabel: formatDateTimeLong(new Date().toISOString(), store.timezone),
  })

  return { requestId: id, sentTo: maskEmail(email) }
}

// ---------------------------------------------------------------------------
// Cupones
// ---------------------------------------------------------------------------

export async function createCouponDraftAction(storeId: number, input: CouponInput): Promise<ActionResult<Coupon>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const { userId } = await requireStoreMembership(id, { role: 'owner' })
      const parsed = couponInputSchema.parse(input)

      // Fail-open: crear un cupón necesita Postgres de todos modos, así que
      // negar con la base caída no protege nada y sí frena a un dueño
      // legítimo (00-architecture.md §5.13).
      await consumeOrThrow(
        'coupon_create:store',
        String(id),
        (s) => `Ya creaste muchos cupones para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
      )

      const coupon = await createCouponDraft(id, parsed, userId)
      revalidatePath('/admin/clientes/cupones')
      return coupon
    },
    'marketing.createCouponDraft',
    { storeId },
  )
}

/**
 * Lo que devuelve editar un cupón: se aplicó ya, o quedó esperando el código.
 * La UI decide qué mostrar según `requiresConfirmation`.
 */
export type CouponUpdateResult =
  | { requiresConfirmation: false; coupon: Coupon }
  | { requiresConfirmation: true; pending: PendingChangeStarted }

export async function updateCouponAction(
  storeId: number,
  couponId: number,
  input: CouponInput,
): Promise<ActionResult<CouponUpdateResult>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const cId = couponIdSchema.parse(couponId)
      const { userId } = await requireStoreMembership(id, { role: 'owner' })
      const parsed = couponInputSchema.parse(input)

      const current = await getCouponById(id, cId)
      if (!current) throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })

      // Editar un cupón que NO está activo es gratis, cuantas veces quiera:
      // mientras está apagado no hay nada que canjear, y volver a prenderlo
      // (draft/paused → active) siempre pasa por
      // `requestCouponActivationAction`, que sí pide código. El costo del
      // segundo factor queda en ESE checkpoint, no acá.
      if (current.status !== 'active') {
        const coupon = await updateCoupon(id, cId, parsed)
        revalidatePath('/admin/clientes/cupones')
        return { requiresConfirmation: false, coupon }
      }

      const next: CouponShape = {
        code: parsed.code,
        discountType: parsed.discountType,
        percent: parsed.percent,
        amountOffCents: parsed.amountOffCents,
        maxDiscountCents: parsed.maxDiscountCents,
        minSubtotalCents: parsed.minSubtotalCents,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        maxRedemptions: parsed.maxRedemptions,
        maxRedemptionsPerPhone: parsed.maxRedemptionsPerPhone,
        paymentMethods: parsed.paymentMethods,
        status: 'active',
      }

      if (!requiresConfirmation(current, next)) {
        const coupon = await updateCoupon(id, cId, parsed)
        revalidatePath('/admin/clientes/cupones')
        return { requiresConfirmation: false, coupon }
      }

      const pending = await startCouponPendingChange({
        storeId: id,
        userId,
        couponId: cId,
        payload: { action: 'update', couponId: cId, input: parsed },
      })
      return { requiresConfirmation: true, pending }
    },
    'marketing.updateCoupon',
    { storeId },
  )
}

const deactivateStatusSchema = z.enum(['draft', 'paused'])

/**
 * Pausar o volver a borrador. **Nunca pide código** — "no apagar se apaga sin
 * código", aprobado por el dueño del producto. Pasar a `active` NO vive acá:
 * eso es siempre `requestCouponActivationAction`.
 */
export async function setCouponStatusAction(
  storeId: number,
  couponId: number,
  status: 'draft' | 'paused',
): Promise<ActionResult<Coupon>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const cId = couponIdSchema.parse(couponId)
      const parsedStatus = deactivateStatusSchema.parse(status)
      await requireStoreMembership(id, { role: 'owner' })

      const coupon = await setCouponStatus(id, cId, parsedStatus)
      revalidatePath('/admin/clientes/cupones')
      return coupon
    },
    'marketing.setCouponStatus',
    { storeId },
  )
}

export async function deleteCouponAction(storeId: number, couponId: number): Promise<ActionResult<void>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const cId = couponIdSchema.parse(couponId)
      await requireStoreMembership(id, { role: 'owner' })
      await deleteUnusedCoupon(id, cId)
      revalidatePath('/admin/clientes/cupones')
    },
    'marketing.deleteCoupon',
    { storeId },
  )
}

/** Activar (`draft → active`) o reactivar (`paused → active`). Siempre pide código: es el único checkpoint antes de que el cupón vuelva a ser canjeable. */
export async function requestCouponActivationAction(
  storeId: number,
  couponId: number,
): Promise<ActionResult<PendingChangeStarted>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const cId = couponIdSchema.parse(couponId)
      const { userId } = await requireStoreMembership(id, { role: 'owner' })

      const current = await getCouponById(id, cId)
      if (!current) throw new DomainError('No se encontró ese cupón en esta tienda', { status: 404 })
      if (current.status === 'active') {
        throw new DomainError('Ese cupón ya está activo.', { status: 400 })
      }

      return startCouponPendingChange({
        storeId: id,
        userId,
        couponId: cId,
        payload: { action: 'activate', couponId: cId },
      })
    },
    'marketing.requestCouponActivation',
    { storeId },
  )
}

/**
 * Confirma cualquier cambio de cupón pendiente (activar, reactivar, o editar
 * un activo escalando). Todo lo que decide si se aplica —vencimiento,
 * intentos, un solo uso— vive en `consumePendingChange`, o sea en Postgres.
 * Acá solo se despacha por `payload.action`.
 */
export async function confirmCouponChangeAction(
  storeId: number,
  requestId: number,
  code: string,
): Promise<ActionResult<void>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const request = z.number().int().positive().parse(requestId)
      const parsedCode = confirmationCodeSchema.parse(code)
      const { userId } = await requireStoreMembership(id, { role: 'owner' })

      const change = await consumePendingChange({ id: request, storeId: id, userId, code: parsedCode })
      if (change.kind !== 'coupon') {
        throw new DomainError('Esa solicitud no corresponde a un cupón.', { status: 400 })
      }

      const payload = change.payload as unknown as CouponPendingChangePayload
      if (payload.action === 'activate') {
        await setCouponStatus(id, payload.couponId, 'active')
      } else {
        await updateCoupon(id, payload.couponId, payload.input)
      }

      revalidatePath('/admin/clientes/cupones')
    },
    'marketing.confirmCouponChange',
    { storeId },
  )
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

export async function previewCampaignAction(
  storeId: number,
  input: { couponId: number; segment: CampaignSegment },
): Promise<ActionResult<CampaignPreview>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      await requireStoreMembership(id, { role: 'owner' })
      const parsed = campaignPreviewInputSchema.parse(input)
      return previewSegment(id, parsed.segment, parsed.couponId)
    },
    'marketing.previewCampaign',
    { storeId },
  )
}

export async function sendCampaignAction(
  storeId: number,
  input: { couponId: number; segment: CampaignSegment; subject: string; message?: string | null },
): Promise<ActionResult<{ campaignId: number }>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      const { userId } = await requireStoreMembership(id, { role: 'owner' })
      const parsed = campaignCreateInputSchema.parse(input)

      const store = await getStoreById(id)
      if (!store) throw new DomainError('No encontramos el local.', { status: 404 })

      // Capa 1 de §5.10.3.1: la campaña que no puede terminar no se puede
      // empezar. El daño de dejarla arrancar es diferido e invisible, así
      // que esto es un bloqueo, no una advertencia.
      const preview = await previewSegment(id, parsed.segment, parsed.couponId)
      if (!preview.fitsBeforeExpiry) {
        const endsAtLabel = preview.couponEndsAt ? formatDayShort(zonedDay(preview.couponEndsAt, store.timezone)) : ''
        throw new DomainError(
          `Con este cupo, el último mail sale el ${formatDayShort(preview.lastSendDate)} y el cupón vence el ${endsAtLabel}. Estirá la vigencia, mandá a menos gente, o escribinos para ampliar el cupo.`,
          { status: 400 },
        )
      }

      // Fail-closed: gasta la cuota compartida de mail y habla en nombre de
      // la marca a clientes reales (00-architecture.md §5.13). DESPUÉS de
      // `fitsBeforeExpiry`: un rechazo por vigencia todavía no encoló nada, así
      // que gastar acá el balde de 3/24h dejaba al dueño sin poder ajustar
      // parámetros (acortar el segmento, por ejemplo) sin mandar un solo mail
      // real (docs/pipelines/2026-08-31-clientes-y-cupones/03-review.md,
      // Hallazgo 10).
      await consumeOrThrow(
        'campaign_send:store',
        String(id),
        (s) => `Ya mandaste varias campañas hoy para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
        'deny',
      )

      const campaignId = await enqueueCampaign(id, {
        couponId: parsed.couponId,
        segment: parsed.segment,
        subject: parsed.subject,
        message: parsed.message,
        createdBy: userId,
      })

      revalidatePath('/admin/clientes/cupones')
      return { campaignId }
    },
    'marketing.sendCampaign',
    { storeId },
  )
}

/**
 * Balde propio y no `support:store`: son dos intenciones distintas, y un
 * pedido de soporte de Pagos no tiene por qué comerse el cupo de un pedido de
 * ventas (00-architecture.md §5.10.6).
 */
async function consumeCampaignQuotaBudget(storeId: number): Promise<void> {
  await consumeOrThrow(
    'campaign_quota:store',
    String(storeId),
    (s) => `Ya mandaste este pedido hace poco. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
  )
  await consumeOrThrow(
    'campaign_quota:store:day',
    String(storeId),
    (s) => `Ya mandaste varios pedidos de cupo hoy para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
  )
}

/**
 * La vía comercial de §5.10.6: cuando 15 mails/día no alcanzan. Mismo patrón
 * que `requestPaymentSupportAction` — reusa la forma, no inventa otra.
 *
 * Llama a `sendCampaignQuotaRequest` (T3B, `services/notifications/email/campaign.tsx`).
 */
export async function requestCampaignQuotaAction(
  storeId: number,
  input: { requestedRecipients: number; daysNeeded: number; message: string },
): Promise<ActionResult<void>> {
  return toActionResult(
    async () => {
      const id = storeIdSchema.parse(storeId)
      await requireStoreMembership(id, { role: 'owner' })
      const parsed = campaignQuotaRequestInputSchema.parse(input)

      await consumeCampaignQuotaBudget(id)

      const user = await getCurrentUser()
      const store = await getStoreById(id)
      if (!store) throw new DomainError('No encontramos el local.', { status: 404 })

      const stats = await getMarketingQuotaStats(id)

      const result = await sendCampaignQuotaRequest({
        storeId: id,
        storeName: store.name,
        storeSlug: store.slug,
        ownerEmail: user?.email ?? 'sin-mail@desconocido',
        customersTotal: stats.customersTotal,
        customersWithEmail: stats.customersWithEmail,
        campaignRecipients: parsed.requestedRecipients,
        daysNeeded: parsed.daysNeeded,
        activeCoupons: stats.activeCouponsCount,
        redemptionsLastMonth: stats.redemptionsLastMonth,
        message: parsed.message || null,
      })

      if (result.status === 'failed') {
        throw new DomainError('No pudimos mandar tu pedido. Escribinos directo a ventas@comandapp.ar.', { status: 503 })
      }
    },
    'marketing.requestCampaignQuota',
    { storeId },
  )
}
