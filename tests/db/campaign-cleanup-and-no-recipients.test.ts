import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, uniqueSlug } from './helpers'

/**
 * Cobertura de los arreglos que el hilo principal aplicó DESPUÉS de la
 * primera corrida de esta suite, sobre `claim_campaign_recipients` /
 * `settle_campaign_recipient` en `supabase/migrations/20260901130000_cupones.sql`:
 *
 * 1. La limpieza (marcar `failed` a los que agotaron reintentos, y cerrar la
 *    campaña que se quedó sin cola) ahora corre ANTES del `if v_remaining <= 0
 *    then return`. Antes, un día con el presupuesto ya gastado (el chunk ES
 *    el presupuesto, así que el primer envío del día lo agota) no cerraba
 *    nada hasta la rotación de las 00:00 UTC: el dueño veía "enviando" un día
 *    entero después de que en la práctica ya había terminado.
 * 2. `stopped_reason` tiene un cuarto valor, `no_recipients`: una campaña
 *    donde NADIE era elegible al momento de drenar (todos se dieron de baja,
 *    o perdieron su fila del padrón, entre encolar y enviar) cierra en
 *    `stopped` / `no_recipients`, no en `sent` con `sent_count = 0` — que es
 *    la misma falla silenciosa-con-cara-de-éxito que el resto del feature ya
 *    evita en otros caminos.
 *
 * El hermano negativo importa tanto como el positivo: una campaña que
 * simplemente está ESPERANDO la ventana de reintento (`p_retry_seconds`) no
 * tiene que cerrarse de prepo solo porque `v_chunk` salió `null` en ese tick
 * — hay dos motivos distintos para `v_chunk is null` (cola vacía de verdad, o
 * cola con filas que todavía no cumplieron la espera) y solo el primero cierra.
 */
describe.skipIf(!dbAvailable)('claim_campaign_recipients — limpieza antes del presupuesto, y el cierre a no_recipients', () => {
  function uniqueCouponCode(prefix: string): string {
    const raw = (prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
    return raw.slice(0, 16).padEnd(4, '0')
  }

  function couponFixture(prefix: string, opts: { maxRedemptions?: number } = {}) {
    const code = uniqueCouponCode(prefix)
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`,
      `insert into public.coupons (store_id, name, code, discount_type, percent, min_subtotal_cents, max_redemptions, status)
         values (:store_id, 'Promo', '${code}', 'percentage', 10, 0, ${opts.maxRedemptions ?? 1000}, 'active') returning id \\gset coupon_`,
    ]
  }

  function customerRow(phone: string, name: string, email: string, spentCents: number) {
    return `insert into public.store_customers (store_id, phone_e164, display_name, email, total_spent_cents) values (:store_id, '${phone}', '${name}', '${email}', ${spentCents}) returning id \\gset cust_${phone.slice(-2)}_`
  }

  function enqueueCall(budget: number, varPrefix = 'camp_') {
    return `select public.enqueue_campaign(:store_id, :coupon_id, 'all', null, null, 'Asunto', null, null, ${budget}) as id \\gset ${varPrefix}`
  }

  /** 15 filas ya `sent_at = now()` en CUALQUIER campaña — agota el presupuesto diario GLOBAL, mismo mecanismo que el test de presupuesto en `campaign-lifecycle.test.ts`. */
  function budgetExhaustedToday(prefix: string) {
    return [
      ...couponFixture(`${prefix}-filler`),
      `insert into public.coupon_campaigns (store_id, coupon_id, segment_kind, subject, status, recipients_total)
         values (:store_id, :coupon_id, 'all', 'Filler', 'sent', 15) returning id \\gset filler_camp_`,
      `insert into public.campaign_recipients (campaign_id, store_id, customer_id, email, chunk_index, status, sent_at)
         select :filler_camp_id, :store_id, null, 'ya-enviado-' || g || '@test.com', 0, 'sent', now()
           from generate_series(1, 15) g;`,
    ]
  }

  it('con el presupuesto de HOY agotado, igual pasa a "failed" a los destinatarios que agotaron reintentos y cierra la campaña sin cola', () => {
    const out = inTransaction(
      ...budgetExhaustedToday('cc-budget'),
      ...couponFixture('cc-budget-target'),
      `insert into public.coupon_campaigns (store_id, coupon_id, segment_kind, subject, status, recipients_total)
         values (:store_id, :coupon_id, 'all', 'Asunto', 'sending', 1) returning id \\gset camp_`,
      // Ya agotó los reintentos: attempts >= max_attempts, ANTES de este claim.
      `insert into public.campaign_recipients (campaign_id, store_id, customer_id, email, chunk_index, status, attempts)
         values (:camp_id, :store_id, null, 'agotado@test.com', 0, 'queued', 5);`,
      // Presupuesto de HOY ya en cero (15 ya enviados por el filler de arriba):
      // esta llamada no debería reclamar nada, pero SÍ debería limpiar.
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      `select cc.status, cc.failed_count from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    const [claimed, campaignLine] = out.split('\n')
    expect(claimed).toBe('0') // presupuesto agotado: no reclama nada nuevo
    expect(campaignLine).toBe('failed|1') // pero SÍ cerró la campaña sin cola
  })

  it('nadie era elegible al drenar (todos se dieron de baja entre encolar y enviar): la campaña cierra en stopped / no_recipients, NUNCA en sent', () => {
    const out = inTransaction(
      ...couponFixture('cc-norecip'),
      customerRow('+5491100000271', 'A', 'a@test.com', 100),
      enqueueCall(15),
      `update public.store_customers set marketing_opt_out_at = now() where store_id = :store_id;`,
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      `select cc.status, cc.stopped_reason, cc.sent_count, cc.failed_count from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    const [claimed, campaignLine] = out.split('\n')
    expect(claimed).toBe('0') // no reclama a nadie: el único destinatario se dio de baja
    expect(campaignLine).toBe('stopped|no_recipients|0|0')
  })

  it('el hermano negativo: una campaña que solo está esperando la ventana de reintento sigue viva (sending), no se cierra de prepo', () => {
    const out = inTransaction(
      ...couponFixture('cc-waiting-retry'),
      customerRow('+5491100000272', 'A', 'a@test.com', 100),
      enqueueCall(15),
      // Primer claim: reclama el único destinatario, sube attempts a 1 y
      // sella last_attempt_at = now(). La fila queda 'queued' (nadie la
      // asentó con settle_campaign_recipient todavía).
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      // Segundo claim, EN LA MISMA TRANSACCIÓN (o sea milisegundos después):
      // el retry_seconds (900) no pasó, así que v_chunk sale null por el
      // motivo (a) del comentario de la migración — "todavía no cumplió la
      // espera" — y NO por el motivo (b) —"la cola quedó vacía de verdad"—.
      // Tiene que devolver vacío y NO tocar la campaña.
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      `select cc.status, cc.stopped_reason from public.coupon_campaigns cc where cc.id = :camp_id;`,
      `select status, attempts from public.campaign_recipients where campaign_id = :camp_id;`,
    )
    const [firstClaimed, secondClaimed, campaignLine, recipientLine] = out.split('\n')
    expect(firstClaimed).toBe('1')
    expect(secondClaimed).toBe('0') // nada reclamable todavía, pero por la espera, no por vacío
    expect(campaignLine).toBe('sending|') // sigue viva: NO pasó a stopped/no_recipients
    expect(recipientLine).toBe('queued|1') // la fila sigue esperando su reintento, no se tocó
  })
})
