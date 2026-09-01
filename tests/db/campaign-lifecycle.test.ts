import { describe, expect, it } from 'vitest'
import { dbAvailable, inTransaction, sql, sqlConcurrentlySettled, uniqueSlug } from './helpers'

/**
 * `enqueue_campaign` / `claim_campaign_recipients` / `settle_campaign_recipient`
 * — el ciclo completo de una campaña de cupón por mail. Las tres son
 * `service_role`, así que corren acá directo como `postgres` (mismos
 * privilegios), sin wrapper de rol: quien las llama en la app es la Server
 * Action (`enqueueCampaign`) o el cron de drenaje (`claimCampaignRecipients`/
 * `settleCampaignRecipient`), nunca una sesión de dueño.
 */
describe.skipIf(!dbAvailable)('campañas de cupón — enqueue_campaign / claim_campaign_recipients / settle_campaign_recipient', () => {
  function uniqueCouponCode(prefix: string): string {
    const raw = (prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase().replace(/[^A-Z0-9]/g, '')
    return raw.slice(0, 16).padEnd(4, '0')
  }

  /** Tienda + un cupón `active` con cupo amplio, listo para encolar campañas. */
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

  it('enqueue_campaign congela la lista COMPLETA o nada: recipients_total coincide exacto con las filas insertadas', () => {
    const out = inTransaction(
      ...couponFixture('cl-freeze'),
      customerRow('+5491100000101', 'A', 'a@test.com', 100),
      customerRow('+5491100000102', 'B', 'b@test.com', 200),
      customerRow('+5491100000103', 'C', 'c@test.com', 300),
      enqueueCall(15),
      `select cc.recipients_total, (select count(*) from public.campaign_recipients r where r.campaign_id = cc.id)
         from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    expect(out).toBe('3|3')
  })

  it('el orden de los chunks es por plata gastada, descendente', () => {
    const out = inTransaction(
      ...couponFixture('cl-chunks'),
      customerRow('+5491100000111', 'A', 'a@test.com', 500),
      customerRow('+5491100000112', 'B', 'b@test.com', 400),
      customerRow('+5491100000113', 'C', 'c@test.com', 300),
      customerRow('+5491100000114', 'D', 'd@test.com', 200),
      customerRow('+5491100000115', 'E', 'e@test.com', 100),
      enqueueCall(2), // chunk_index = min(2,100) = 2 personas por chunk
      `select r.chunk_index, c.total_spent_cents from public.campaign_recipients r
         join public.store_customers c on c.id = r.customer_id
        where r.campaign_id = :camp_id
        order by r.chunk_index, c.total_spent_cents desc;`,
    )
    expect(out.split('\n')).toEqual(['0|500', '0|400', '1|300', '1|200', '2|100'])
  })

  it('dedupe de mail en el encolado: dos clientes con la misma casilla en distinto casing producen UNA sola fila', () => {
    const out = inTransaction(
      ...couponFixture('cl-dedupe'),
      customerRow('+5491100000121', 'A', 'Same@Test.com', 500),
      customerRow('+5491100000122', 'B', 'same@test.com', 100),
      enqueueCall(15),
      `select cc.recipients_total, (select count(*) from public.campaign_recipients r where r.campaign_id = :camp_id) from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    expect(out).toBe('1|1')
  })

  it('el cupón tiene que ser de la tienda que arma la campaña', () => {
    let message: string | null = null
    try {
      sql(
        [
          'begin;',
          ...couponFixture('cl-fk-a'),
          ...couponFixture('cl-fk-b').map((s) => s.replace(/:store_id/g, ':storeb_id').replace(/:coupon_id/g, ':couponb_id').replace(/\\gset store_/, '\\gset storeb_').replace(/\\gset coupon_/, '\\gset couponb_')),
          `select public.enqueue_campaign(:store_id, :couponb_id, 'all', null, null, 'Asunto', null, null, 15);`,
          'rollback;',
        ].join('\n'),
      )
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/no es de la tienda/)
  })

  describe('claim_campaign_recipients — un chunk completo o nada', () => {
    it('con presupuesto MENOR al tamaño del chunk, el claim devuelve vacío', () => {
      const out = inTransaction(
        ...couponFixture('cl-atomic-empty', { maxRedemptions: 1000 }),
        customerRow('+5491100000131', 'A', 'a@test.com', 300),
        customerRow('+5491100000132', 'B', 'b@test.com', 200),
        customerRow('+5491100000133', 'C', 'c@test.com', 100),
        enqueueCall(3), // chunk único de 3 personas
        `select count(*) from public.claim_campaign_recipients(2, 5, 900);`, // presupuesto 2 < chunk 3
      )
      expect(out).toBe('0')
    })

    it('con presupuesto suficiente, devuelve exactamente el chunk, con attempts++ y last_attempt_at seteado', () => {
      const out = inTransaction(
        ...couponFixture('cl-atomic-full', { maxRedemptions: 1000 }),
        customerRow('+5491100000141', 'A', 'a@test.com', 300),
        customerRow('+5491100000142', 'B', 'b@test.com', 200),
        customerRow('+5491100000143', 'C', 'c@test.com', 100),
        enqueueCall(3),
        `select count(*) from public.claim_campaign_recipients(5, 5, 900);`,
        `select count(*) from public.campaign_recipients where campaign_id = :camp_id and attempts = 1 and last_attempt_at is not null;`,
      )
      expect(out.split('\n')).toEqual(['3', '3'])
    })
  })

  it('dos llamadas CONCURRENTES a claim_campaign_recipients nunca reclaman el mismo destinatario (for update skip locked)', async () => {
    const fixtureOut = sql(
      [
        'begin;',
        ...couponFixture('cl-concurrent', { maxRedemptions: 1000 }),
        ...Array.from({ length: 10 }, (_, i) =>
          customerRow(`+549110000${String(2000 + i).slice(1)}`, `C${i}`, `c${i}-concurrent@test.com`, 1000 - i),
        ),
        enqueueCall(15), // chunk único de 10
        `select :store_id, :camp_id;`,
        'commit;',
      ].join('\n'),
    )
    const [storeId, campaignId] = fixtureOut.trim().split('|')

    try {
      const claimScript = `begin;\nselect recipient_id from public.claim_campaign_recipients(100, 5, 900);\ncommit;\n`
      const results = await sqlConcurrentlySettled([claimScript, claimScript])

      for (const r of results) {
        if (!r.ok) throw new Error(`una de las dos llamadas concurrentes falló: ${r.error}`)
      }
      const idsA = results[0].ok ? results[0].value.split('\n').filter(Boolean).map(Number) : []
      const idsB = results[1].ok ? results[1].value.split('\n').filter(Boolean).map(Number) : []

      const intersection = idsA.filter((id) => idsB.includes(id))
      expect(intersection).toEqual([])
      // Entre las dos, se reclamó como máximo el chunk entero (10) — nunca de más.
      expect(idsA.length + idsB.length).toBeLessThanOrEqual(10)
      expect(idsA.length + idsB.length).toBeGreaterThan(0)
      void campaignId
    } finally {
      sql(`begin;\ndelete from public.stores where id = ${storeId};\ncommit;`)
    }
  })

  it('el presupuesto diario se cuenta en ventana UTC, GLOBAL entre campañas: con 15 ya enviados hoy, la siguiente llamada da cero', () => {
    const out = inTransaction(
      ...couponFixture('cl-budget', { maxRedemptions: 1000 }),
      customerRow('+5491100000151', 'Real', 'real@test.com', 100),
      enqueueCall(15),
      // 15 filas "ya enviadas hoy" en la MISMA campaña (el conteo de
      // v_sent_today no filtra por campcampaign_id, así que da igual).
      `insert into public.campaign_recipients (campaign_id, store_id, customer_id, email, chunk_index, status, sent_at)
         select :camp_id, :store_id, null, 'dummy-' || g || '@test.com', 99, 'sent', now()
           from generate_series(1, 15) g;`,
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
    )
    expect(out).toBe('0')
  })

  describe('el corte por cupón que dejó de valer — la campaña queda "stopped" con su motivo, la cola pasa a "skipped"', () => {
    it('cupón pausado → stopped_reason = coupon_paused', () => {
      const out = inTransaction(
        ...couponFixture('cl-stop-paused'),
        `update public.coupons set status = 'paused' where id = :coupon_id;`,
        customerRow('+5491100000161', 'A', 'a@test.com', 100),
        enqueueCall(15),
        `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
        `select cc.status, cc.stopped_reason from public.coupon_campaigns cc where cc.id = :camp_id;`,
        `select count(*) from public.campaign_recipients where campaign_id = :camp_id and status = 'skipped';`,
      )
      const lines = out.split('\n')
      expect(lines[0]).toBe('0') // el claim no devuelve nada: se cortó
      expect(lines[1]).toBe('stopped|coupon_paused')
      expect(lines[2]).toBe('1')
    })

    it('cupón vencido → stopped_reason = coupon_expired', () => {
      const out = inTransaction(
        ...couponFixture('cl-stop-expired'),
        `update public.coupons set ends_at = now() - interval '1 day' where id = :coupon_id;`,
        customerRow('+5491100000162', 'A', 'a@test.com', 100),
        enqueueCall(15),
        `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
        `select cc.status, cc.stopped_reason from public.coupon_campaigns cc where cc.id = :camp_id;`,
      )
      expect(out.split('\n')).toEqual(['0', 'stopped|coupon_expired'])
    })

    it('cupón agotado → stopped_reason = coupon_exhausted', () => {
      const out = inTransaction(
        ...couponFixture('cl-stop-exhausted', { maxRedemptions: 1 }),
        `update public.coupons set reserved_count = 1 where id = :coupon_id;`, // 1 >= max_redemptions(1)
        customerRow('+5491100000163', 'A', 'a@test.com', 100),
        enqueueCall(15),
        `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
        `select cc.status, cc.stopped_reason from public.coupon_campaigns cc where cc.id = :camp_id;`,
      )
      expect(out.split('\n')).toEqual(['0', 'stopped|coupon_exhausted'])
    })
  })

  it('la baja aplicada ENTRE el encolado y el envío tiene efecto inmediato: la fila pasa a skipped sin ser reclamada', () => {
    const out = inTransaction(
      ...couponFixture('cl-optout-midflight'),
      customerRow('+5491100000171', 'A', 'a@test.com', 100),
      enqueueCall(15),
      `update public.store_customers set marketing_opt_out_at = now() where store_id = :store_id;`,
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      `select status from public.campaign_recipients where campaign_id = :camp_id;`,
    )
    expect(out.split('\n')).toEqual(['0', 'skipped'])
  })

  it('el cierre a "failed" cuando NINGÚN destinatario salió — antes quedaba en sent con sent_count=0, o en sending para siempre', () => {
    const out = inTransaction(
      ...couponFixture('cl-allfailed'),
      `insert into public.coupon_campaigns (store_id, coupon_id, segment_kind, subject, status, recipients_total)
         values (:store_id, :coupon_id, 'all', 'Asunto', 'queued', 1) returning id \\gset camp_`,
      // Ya agotó los reintentos ANTES de que el claim corra: attempts >= max_attempts.
      `insert into public.campaign_recipients (campaign_id, store_id, customer_id, email, chunk_index, status, attempts)
         values (:camp_id, :store_id, null, 'agotado@test.com', 0, 'queued', 5);`,
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`,
      `select cc.status, cc.sent_count, cc.failed_count from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    expect(out.split('\n')).toEqual(['0', 'failed|0|1'])
  })

  it('settle_campaign_recipient con éxito parcial: la campaña NO se cierra mientras quede algo en cola', () => {
    const out2 = inTransaction(
      ...couponFixture('cl-partial2'),
      customerRow('+5491100000183', 'A', 'a@test.com', 100),
      customerRow('+5491100000184', 'B', 'b@test.com', 200),
      enqueueCall(15),
      `create temporary table claimed as select * from public.claim_campaign_recipients(15, 5, 900);`,
      `select id into temporary claimed_ids from public.campaign_recipients where campaign_id = :camp_id order by id;`,
      // settle_campaign_recipient devuelve void: `perform` adentro de un `do`
      // no imprime fila, a diferencia de un `select` de una función void
      // (que sí imprime una línea vacía y correría el resto del parseo).
      `do $$ begin perform public.settle_campaign_recipient((select min(id) from claimed_ids), true, 'provider-ref-1', null); end $$;`,
      `do $$ begin perform public.settle_campaign_recipient((select max(id) from claimed_ids), false, null, 'boom'); end $$;`,
      `select cc.status, cc.sent_count, cc.failed_count from public.coupon_campaigns cc where cc.id = :camp_id;`,
      `select status, last_error from public.campaign_recipients where id = (select max(id) from claimed_ids);`,
    )
    expect(out2.split('\n')).toEqual(['sending|1|0', 'queued|boom'])
  })

  it('una campaña "stopped" no vuelve a "sent" por un settle tardío sobre una fila vieja', () => {
    const out = inTransaction(
      ...couponFixture('cl-stopped-late-settle'),
      `update public.coupons set status = 'paused' where id = :coupon_id;`,
      customerRow('+5491100000191', 'A', 'a@test.com', 100),
      enqueueCall(15),
      `select count(*) from public.claim_campaign_recipients(15, 5, 900);`, // corta la campaña a stopped
      `select id into temporary skipped_row from public.campaign_recipients where campaign_id = :camp_id limit 1;`,
      // settle_campaign_recipient devuelve void: un `select` de eso imprime
      // una línea vacía. `do $$ ... perform ... $$` no devuelve fila alguna.
      `do $$ begin perform public.settle_campaign_recipient((select id from skipped_row), true, 'late-ref', null); end $$;`,
      `select cc.status from public.coupon_campaigns cc where cc.id = :camp_id;`,
    )
    expect(out.split('\n')).toEqual(['0', 'stopped'])
  })
})
