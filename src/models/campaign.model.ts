import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { CAMPAIGN_DAILY_BUDGET, campaignDaysNeeded, campaignLastSendDate } from '@/lib/coupon'
import { getCouponById } from '@/models/coupon.model'
import { getStoreById } from '@/models/store.model'
import { campaignSegmentPreviewRpcSchema } from '@/models/schemas/coupon.schema'
import type {
  CampaignPreview,
  CampaignSegment,
  CampaignStatus,
  CampaignStoppedReason,
  CouponCampaign,
  CouponDiscountType,
} from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

const CTX = 'campaign.model'

/**
 * Único lugar que habla con Postgres para `coupon_campaigns` y
 * `campaign_recipients`.
 *
 * `previewSegment` llama `campaign_segment_preview` con el cliente de
 * SESIÓN: es `SECURITY DEFINER` pero verifica `is_store_owner()` leyendo
 * `auth.uid()`, y con `service_role` esa verificación no tiene con qué
 * comparar — falla siempre. `enqueueCampaign`, `claimCampaignRecipients` y
 * `settleCampaignRecipient` son al revés: `service_role`, porque las llama
 * la Server Action (la primera) o el cron (las otras dos), nunca una sesión
 * de dueño.
 */

type CouponCampaignRow = Database['public']['Tables']['coupon_campaigns']['Row']

function toSegment(row: Pick<CouponCampaignRow, 'segment_kind' | 'segment_top_n' | 'segment_min_spent_cents'>): CampaignSegment {
  if (row.segment_kind === 'top_n') return { kind: 'top_n', topN: row.segment_top_n ?? 0 }
  if (row.segment_kind === 'min_spent') return { kind: 'min_spent', minSpentCents: row.segment_min_spent_cents ?? 0 }
  return { kind: 'all' }
}

function toCouponCampaign(row: CouponCampaignRow, couponCode: string): CouponCampaign {
  return {
    id: row.id,
    storeId: row.store_id,
    couponId: row.coupon_id,
    couponCode,
    segment: toSegment(row),
    subject: row.subject,
    message: row.message,
    status: row.status as CampaignStatus,
    stoppedReason: row.stopped_reason as CampaignStoppedReason | null,
    recipientsTotal: row.recipients_total,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export async function listCampaigns(storeId: number): Promise<CouponCampaign[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('coupon_campaigns')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (error) {
    log.error(CTX, 'no se pudieron listar las campañas', error, { storeId })
    throw new Error(`No se pudieron listar las campañas: ${error.message}`)
  }
  if (!data || data.length === 0) return []

  // Join a mano en vez de un embed de PostgREST (`coupons(code)`): evita
  // depender de cómo tipa supabase-js la dirección del FK, y son dos queries
  // baratas contra una lista que ya está acotada por tienda.
  const couponIds = [...new Set(data.map((row) => row.coupon_id))]
  const { data: coupons, error: couponsError } = await admin.from('coupons').select('id, code').in('id', couponIds)

  if (couponsError) {
    log.error(CTX, 'no se pudieron leer los códigos de las campañas', couponsError, { storeId })
    throw new Error(`No se pudieron leer los códigos de las campañas: ${couponsError.message}`)
  }
  const codeById = new Map((coupons ?? []).map((c) => [c.id, c.code]))

  return data.map((row) => toCouponCampaign(row, codeById.get(row.coupon_id) ?? '(cupón borrado)'))
}

/**
 * `daysNeeded`/`lastSendDate` no viven en la RPC: los deriva
 * `campaignDaysNeeded()`/`campaignLastSendDate()` de `lib/coupon.ts` a partir
 * de `willSend`, porque la pantalla necesita recalcularlos en vivo mientras
 * el dueño mueve el segmento, sin ir al servidor en cada tecla. Acá se
 * calculan una vez más para que el preview del servidor sea consistente con
 * lo que la UI ya mostraba.
 */
export async function previewSegment(storeId: number, segment: CampaignSegment, couponId: number): Promise<CampaignPreview> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('campaign_segment_preview', {
    p_store_id: storeId,
    p_kind: segment.kind,
    ...(segment.kind === 'top_n' ? { p_top_n: segment.topN } : {}),
    ...(segment.kind === 'min_spent' ? { p_min_spent: segment.minSpentCents } : {}),
  })

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Solo el dueño del local puede armar campañas', { status: 403 })
    }
    log.error(CTX, 'no se pudo previsualizar el segmento', error, { storeId })
    throw new Error(`No se pudo previsualizar el segmento: ${error.message}`)
  }

  const parsed = campaignSegmentPreviewRpcSchema.safeParse(data)
  if (!parsed.success) {
    log.error(CTX, 'campaign_segment_preview devolvió una forma inesperada', parsed.error, { storeId })
    throw new Error('La previsualización de la campaña llegó en un formato inesperado')
  }

  const [coupon, store] = await Promise.all([getCouponById(storeId, couponId), getStoreById(storeId)])
  if (!coupon) throw new DomainError('No encontramos ese cupón en esta tienda', { status: 404 })
  if (!store) throw new DomainError('No encontramos el local', { status: 404 })

  const daysNeeded = campaignDaysNeeded(parsed.data.willSend)
  const lastSendDate = campaignLastSendDate(parsed.data.willSend, store.timezone)

  return {
    inSegment: parsed.data.inSegment,
    withEmail: parsed.data.withEmail,
    optedOut: parsed.data.optedOut,
    willSend: parsed.data.willSend,
    daysNeeded,
    lastSendDate,
    couponEndsAt: coupon.endsAt,
    fitsBeforeExpiry: fitsCampaignBeforeCouponExpiry(daysNeeded, coupon.endsAt),
  }
}

/**
 * `false` bloquea el envío (§5.10.3.1): el daño de dejarlo pasar es diferido
 * e invisible, así que el bloqueo previo es mejor que una advertencia.
 *
 * Trabaja en días UTC, no en la zona del local, porque el presupuesto que se
 * está proyectando (`claim_campaign_recipients`) se raciona en UTC. El último
 * envío ocurre en algún momento del día UTC número `daysNeeded − 1` contado
 * desde hoy; el peor caso es que salga al final de ese día, así que "entra"
 * si el cupón sigue vigente hasta ahí.
 */
function fitsCampaignBeforeCouponExpiry(daysNeeded: number, couponEndsAt: string | null): boolean {
  if (couponEndsAt === null) return true
  if (daysNeeded === 0) return true

  const now = new Date()
  const todayUtcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const lastSendDayEnd = todayUtcStart + daysNeeded * 24 * 60 * 60 * 1000

  return new Date(couponEndsAt).getTime() >= lastSendDayEnd
}

/**
 * Crea la campaña y CONGELA la lista de destinatarios en la misma
 * transacción (vía la RPC): una campaña con `recipientsTotal` sin filas, o
 * filas sin campaña, son los dos estados rotos que esto evita.
 *
 * Los args nullable de la RPC (`p_top_n`, `p_min_spent`, `p_message`) están
 * tipados como no-nullable en `database.types.ts` — típico de un parámetro de
 * función Postgres sin default: el generador no marca la nulabilidad real.
 * El cast es hacia el tipo declarado, no hacia `any`.
 */
export async function enqueueCampaign(
  storeId: number,
  input: { couponId: number; segment: CampaignSegment; subject: string; message: string | null; createdBy: string },
): Promise<number> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('enqueue_campaign', {
    p_store_id: storeId,
    p_coupon_id: input.couponId,
    p_kind: input.segment.kind,
    p_top_n: (input.segment.kind === 'top_n' ? input.segment.topN : null) as unknown as number,
    p_min_spent: (input.segment.kind === 'min_spent' ? input.segment.minSpentCents : null) as unknown as number,
    p_subject: input.subject,
    p_message: input.message as unknown as string,
    p_created_by: input.createdBy,
    p_budget: CAMPAIGN_DAILY_BUDGET,
  })

  if (error) {
    log.error(CTX, 'no se pudo encolar la campaña', error, { storeId })
    throw new Error(`No se pudo encolar la campaña: ${error.message}`)
  }
  if (data == null) throw new Error('enqueue_campaign no devolvió el id de la campaña')
  return data
}

/** Lo que el drenaje (`/api/cron/campaigns`, T3B) necesita para armar y mandar un mail de campaña. */
export type CampaignRecipientClaim = {
  recipientId: number
  campaignId: number
  storeId: number
  chunkIndex: number
  email: string
  customerName: string
  unsubscribeToken: string
  storeName: string
  storeSlug: string
  subject: string
  message: string | null
  couponCode: string
  discountType: CouponDiscountType
  percent: number | null
  amountOffCents: number | null
  maxDiscountCents: number | null
  minSubtotalCents: number
  couponEndsAt: string | null
}

/**
 * El drenaje. `service_role`, `for update skip locked` adentro de la RPC:
 * dos ticks solapados no reclaman el mismo destinatario. Un claim vacío es un
 * resultado normal (sin cupo hoy, sin campañas en cola, o el chunk esperando
 * su ventana de reintento), no un error.
 */
export async function claimCampaignRecipients(
  budget: number = CAMPAIGN_DAILY_BUDGET,
  maxAttempts = 5,
  retrySeconds = 900,
): Promise<CampaignRecipientClaim[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_campaign_recipients', {
    p_budget: budget,
    p_max_attempts: maxAttempts,
    p_retry_seconds: retrySeconds,
  })

  if (error) {
    log.error(CTX, 'no se pudo reclamar el chunk de campaña', error)
    throw new Error(`No se pudo reclamar destinatarios de campaña: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    recipientId: row.recipient_id,
    campaignId: row.campaign_id,
    storeId: row.store_id,
    chunkIndex: row.chunk_index,
    email: row.email,
    customerName: row.customer_name,
    unsubscribeToken: row.unsubscribe_token,
    storeName: row.store_name,
    storeSlug: row.store_slug,
    subject: row.subject,
    message: row.message,
    couponCode: row.coupon_code,
    discountType: row.discount_type as CouponDiscountType,
    percent: row.percent,
    amountOffCents: row.amount_off_cents,
    maxDiscountCents: row.max_discount_cents,
    minSubtotalCents: row.min_subtotal_cents,
    couponEndsAt: row.coupon_ends_at,
  }))
}

/** Cierra una fila reclamada y recalcula los contadores de la campaña, en la misma llamada a la RPC. `service_role`. */
export async function settleCampaignRecipient(input: {
  recipientId: number
  ok: boolean
  providerRef?: string | null
  error?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('settle_campaign_recipient', {
    p_recipient_id: input.recipientId,
    p_ok: input.ok,
    p_provider_ref: input.providerRef ?? undefined,
    p_error: input.error ?? undefined,
  })

  if (error) {
    log.error(CTX, 'no se pudo asentar el resultado del envío de campaña', error)
    throw new Error(`No se pudo asentar el resultado del envío: ${error.message}`)
  }
}

/** Los seis datos de §5.10.6 que necesita el mail a la vía comercial, la parte que sale de Postgres. */
export type MarketingQuotaStats = {
  customersTotal: number
  customersWithEmail: number
  activeCouponsCount: number
  redemptionsLastMonth: number
}

export async function getMarketingQuotaStats(storeId: number): Promise<MarketingQuotaStats> {
  const admin = createAdminClient()
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [customersTotal, customersWithEmail, activeCouponsCount, redemptionsLastMonth] = await Promise.all([
    admin.from('store_customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    admin.from('store_customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).not('email', 'is', null),
    admin.from('coupons').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
    admin
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'redeemed')
      // `redeemed_at`, no `created_at`: la fila nace al RESERVAR el cupón (al
      // crear el pedido), y lo que el mail a la vía comercial promete es
      // "canjes del último mes" — actividad de canje real, sellada recién al
      // entregarse (03-review.md, Hallazgo 9).
      .gte('redeemed_at', oneMonthAgo),
  ])

  for (const result of [customersTotal, customersWithEmail, activeCouponsCount, redemptionsLastMonth]) {
    if (result.error) {
      log.error(CTX, 'no se pudieron reunir los datos para el pedido de cupo', result.error, { storeId })
      throw new Error(`No se pudieron reunir los datos para el pedido de cupo: ${result.error.message}`)
    }
  }

  return {
    customersTotal: customersTotal.count ?? 0,
    customersWithEmail: customersWithEmail.count ?? 0,
    activeCouponsCount: activeCouponsCount.count ?? 0,
    redemptionsLastMonth: redemptionsLastMonth.count ?? 0,
  }
}
