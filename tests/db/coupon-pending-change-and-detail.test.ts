import { describe, expect, it } from 'vitest'
import {
  asAnon,
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  sql,
  uniqueSlug,
} from './helpers'

/**
 * `coupon_detail`, `claim_store_pending_change` con `kind = 'coupon'`, y el
 * `subject_id` que separa los pendientes de dos cupones distintos en la misma
 * tienda (20260901130000_cupones.sql).
 */
describe.skipIf(!dbAvailable)('coupon_detail / store_pending_changes(kind=coupon) / grants', () => {
  // -------------------------------------------------------------------------
  // 1. coupon_detail — cliente de SESIÓN, no admin
  // -------------------------------------------------------------------------
  describe('public.coupon_detail', () => {
    function fixture() {
      const ownerId = newUserId()
      return {
        ownerId,
        statements: [
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('cd')}', 'Tienda CD', 'active') returning id \\gset store_`,
          createAuthUserSql(ownerId, `${ownerId}@example.com`),
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
          `insert into public.coupons (store_id, name, code, discount_type, percent, max_redemptions, status)
             values (:store_id, 'Cupón CD', 'CDDETAIL1', 'percentage', 10, 100, 'active') returning id \\gset coupon_`,
          // Un pedido in_store en delivered, impago, es billable igual
          // (private.order_is_billable: payment_method = 'in_store' y status
          // not in ('pending','cancelled')) — no hace falta simular el cobro.
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, discount_cents, coupon_code_snapshot)
             values (:store_id, 'delivered', 'Cliente Redeemed', '+5491100000001', gen_random_uuid()::text, 'in_store', 'pending', 10000, 9000, 1000, 'CDDETAIL1') returning id \\gset order_redeemed_`,
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents, status, redeemed_at)
             values (:store_id, :coupon_id, :order_redeemed_id, '+5491100000001', 1000, 'redeemed', now());`,
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, discount_cents, coupon_code_snapshot)
             values (:store_id, 'pending', 'Cliente Reserved', '+5491100000002', gen_random_uuid()::text, 'in_store', 'pending', 10000, 9000, 1000, 'CDDETAIL1') returning id \\gset order_reserved_`,
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents, status)
             values (:store_id, :coupon_id, :order_reserved_id, '+5491100000002', 1000, 'reserved');`,
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, discount_cents, coupon_code_snapshot)
             values (:store_id, 'cancelled', 'Cliente Released', '+5491100000003', gen_random_uuid()::text, 'in_store', 'pending', 10000, 9000, 1000, 'CDDETAIL1') returning id \\gset order_released_`,
          `insert into public.coupon_redemptions (store_id, coupon_id, order_id, customer_phone_e164, discount_cents, status, released_reason, released_at)
             values (:store_id, :coupon_id, :order_released_id, '+5491100000003', 1000, 'released', 'cancelled_unpaid', now());`,
        ],
      }
    }

    it('el dueño de la tienda ve el detalle: stats/totalRedemptions cuentan SOLO la fila redeemed (1, no 3)', () => {
      const f = fixture()
      const out = inTransaction(
        ...f.statements,
        ...asAuthenticated(f.ownerId, [
          `select coupon_detail(:store_id, :coupon_id)::text;`,
        ]),
      )
      const detail = JSON.parse(out) as {
        id: number
        storeId: number
        code: string
        stats: { redemptions: number; discountedCents: number; revenueCents: number }
        totalRedemptions: number
        recentRedemptions: Array<{ status: string; releasedReason: string | null }>
      }

      expect(detail.code).toBe('CDDETAIL1')
      // Solo la fila `redeemed`: las otras dos (reserved, released) no cuentan
      // como facturación ni como canje, aunque las tres ocupan/ocuparon cupo.
      expect(detail.stats.redemptions).toBe(1)
      expect(detail.totalRedemptions).toBe(1)
      expect(detail.stats.discountedCents).toBe(1000)
      // El pedido redeemed es billable (in_store, delivered): revenueCents > 0.
      expect(detail.stats.revenueCents).toBe(9000)

      // recentRedemptions en cambio trae las TRES, con su status/releasedReason.
      expect(detail.recentRedemptions).toHaveLength(3)
      const byStatus = Object.fromEntries(detail.recentRedemptions.map((r) => [r.status, r]))
      expect(byStatus.redeemed).toBeDefined()
      expect(byStatus.reserved).toBeDefined()
      expect(byStatus.released).toBeDefined()
      expect(byStatus.released!.releasedReason).toBe('cancelled_unpaid')
    })

    it('el dueño de OTRA tienda pidiendo este cupón recibe 42501 ("solo el dueno del local ve el detalle")', () => {
      const f = fixture()
      const otherOwnerId = newUserId()
      expectSqlToFail(
        [
          ...f.statements,
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('cd-otra')}', 'Otra tienda', 'active') returning id \\gset otra_store_`,
          createAuthUserSql(otherOwnerId, `${otherOwnerId}@example.com`),
          `insert into public.store_members (store_id, user_id, role) values (:otra_store_id, '${otherOwnerId}', 'owner');`,
          ...asAuthenticated(otherOwnerId, [`select coupon_detail(:store_id, :coupon_id);`]),
        ].join('\n'),
        /solo el dueno del local ve el detalle/,
      )
    })

    it('un coupon_id que no existe en esa tienda da no_data_found (P0002)', () => {
      const f = fixture()
      expectSqlToFail(
        [...f.statements, ...asAuthenticated(f.ownerId, [`select coupon_detail(:store_id, 999999999);`])].join('\n'),
        /el cupon .* no existe en la tienda/,
      )
    })

    it('llamada directa como service_role/postgres (sin sesión) falla: is_store_owner() no tiene auth.uid() para comparar', () => {
      // Prueba exactamente por qué getCouponDetail (coupon.model.ts) usa el
      // cliente de SESIÓN y no el admin client: con el admin client esta
      // llamada fallaría siempre, porque is_store_owner() lee auth.uid() y sin
      // JWT de usuario eso es null — la comparación nunca puede dar true.
      const f = fixture()
      expectSqlToFail(
        [...f.statements, `select coupon_detail(:store_id, :coupon_id);`].join('\n'),
        /solo el dueno del local ve el detalle/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. claim_store_pending_change con kind = 'coupon' — el candado de 5 intentos
  // -------------------------------------------------------------------------
  describe("claim_store_pending_change — kind = 'coupon'", () => {
    function fixture() {
      const ownerId = newUserId()
      return {
        ownerId,
        statements: [
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('pc')}', 'Tienda PC', 'active') returning id \\gset store_`,
          createAuthUserSql(ownerId, `${ownerId}@example.com`),
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
          `insert into public.coupons (store_id, name, code, discount_type, percent, max_redemptions, status)
             values (:store_id, 'Cupón PC', 'PCPENDING', 'percentage', 10, 100, 'draft') returning id \\gset coupon_`,
          `insert into public.store_pending_changes (store_id, requested_by, kind, subject_id, payload, code_hash, expires_at)
             values (:store_id, '${ownerId}', 'coupon', :coupon_id, '{"action":"activate"}'::jsonb, 'not-the-real-hash', now() + interval '10 minutes')
           returning id \\gset pending_`,
        ],
      }
    }

    it('no requiere ninguna función nueva: la firma vigente (bigint,bigint,uuid) no se tocó para cupones', () => {
      const out = sql(
        `select count(*) from pg_proc where proname = 'claim_store_pending_change';`,
      )
      expect(out).toBe('1')
    })

    it('la primera llamada devuelve la fila (kind=coupon) con attempts=1, sin importar si el código es correcto — el hash lo compara Node, no esta función', () => {
      const f = fixture()
      const out = inTransaction(
        ...f.statements,
        `select kind, attempts from public.claim_store_pending_change(:pending_id, :store_id, '${f.ownerId}');`,
      )
      expect(out).toBe('coupon|1')
    })

    it('a los 5 intentos (agotados) la sexta llamada devuelve CERO filas — el candado de fuerza bruta, no importa qué código se intente después', () => {
      const f = fixture()
      // `select count(*) from fn(...)` siempre imprime UNA línea (0 o 1),
      // a diferencia de `select * from fn(...)` que no imprime nada cuando la
      // función no devuelve filas — así los índices de `lines` no se corren.
      const calls = Array.from(
        { length: 6 },
        () => `select count(*) from public.claim_store_pending_change(:pending_id, :store_id, '${f.ownerId}');`,
      )
      const out = inTransaction(
        ...f.statements,
        ...calls,
        `select attempts from public.store_pending_changes where id = :pending_id;`,
      )
      const lines = out.split('\n')
      expect(lines).toHaveLength(7)
      // Las primeras 5 llamadas reclaman la fila (attempts 0..4 < 5, cuenta = 1).
      expect(lines.slice(0, 5)).toEqual(['1', '1', '1', '1', '1'])
      // La sexta encuentra attempts = 5, que ya NO es < 5: cero filas.
      expect(lines[5]).toBe('0')
      // Y el contador se quedó en 5, no en 6: la sexta llamada no llegó a incrementar.
      expect(lines[6]).toBe('5')
    })
  })

  // -------------------------------------------------------------------------
  // 3. subject_id — activar el cupón A y después el B no invalida el código de A
  // -------------------------------------------------------------------------
  describe('subject_id separa los pendientes de dos cupones en la misma tienda', () => {
    it('invalidar (kind=coupon, subject_id=B) NO toca la fila viva de A — mismo WHERE que createPendingChange en store-pending-change.model.ts', () => {
      const ownerId = newUserId()
      const out = inTransaction(
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('sid')}', 'Tienda SID', 'active') returning id \\gset store_`,
        createAuthUserSql(ownerId, `${ownerId}@example.com`),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
        `insert into public.coupons (store_id, name, code, discount_type, percent, max_redemptions, status)
           values (:store_id, 'Cupón A', 'SIDCPNA1', 'percentage', 10, 100, 'draft') returning id \\gset coupon_a_`,
        `insert into public.coupons (store_id, name, code, discount_type, percent, max_redemptions, status)
           values (:store_id, 'Cupón B', 'SIDCPNB1', 'percentage', 10, 100, 'draft') returning id \\gset coupon_b_`,
        `insert into public.store_pending_changes (store_id, requested_by, kind, subject_id, payload, code_hash, expires_at)
           values (:store_id, '${ownerId}', 'coupon', :coupon_a_id, '{"action":"activate"}'::jsonb, 'hash-a', now() + interval '10 minutes')
         returning id \\gset pending_a_`,
        // La MISMA invalidación que createPendingChange hace antes de insertar
        // el pendiente de B: `.eq('kind','coupon').is('consumed_at', null).eq('subject_id', B)`.
        `update public.store_pending_changes
            set consumed_at = now()
          where store_id = :store_id and kind = 'coupon' and subject_id = :coupon_b_id and consumed_at is null;`,
        `insert into public.store_pending_changes (store_id, requested_by, kind, subject_id, payload, code_hash, expires_at)
           values (:store_id, '${ownerId}', 'coupon', :coupon_b_id, '{"action":"activate"}'::jsonb, 'hash-b', now() + interval '10 minutes')
         returning id \\gset pending_b_`,
        `select consumed_at is null from public.store_pending_changes where id = :pending_a_id;`,
      )
      expect(out).toBe('t')
    })

    it('en cambio, un pendiente NUEVO para el MISMO cupón A sí invalida el anterior de A (subject_id igual)', () => {
      const ownerId = newUserId()
      const out = inTransaction(
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('sid2')}', 'Tienda SID2', 'active') returning id \\gset store_`,
        createAuthUserSql(ownerId, `${ownerId}@example.com`),
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
        `insert into public.coupons (store_id, name, code, discount_type, percent, max_redemptions, status)
           values (:store_id, 'Cupón A2', 'SIDCPNA2', 'percentage', 10, 100, 'draft') returning id \\gset coupon_a_`,
        `insert into public.store_pending_changes (store_id, requested_by, kind, subject_id, payload, code_hash, expires_at)
           values (:store_id, '${ownerId}', 'coupon', :coupon_a_id, '{"action":"activate"}'::jsonb, 'hash-a-1', now() + interval '10 minutes')
         returning id \\gset pending_a1_`,
        `update public.store_pending_changes
            set consumed_at = now()
          where store_id = :store_id and kind = 'coupon' and subject_id = :coupon_a_id and consumed_at is null;`,
        `insert into public.store_pending_changes (store_id, requested_by, kind, subject_id, payload, code_hash, expires_at)
           values (:store_id, '${ownerId}', 'coupon', :coupon_a_id, '{"action":"activate"}'::jsonb, 'hash-a-2', now() + interval '10 minutes')
         returning id \\gset pending_a2_`,
        `select (select consumed_at is not null from public.store_pending_changes where id = :pending_a1_id),
                (select consumed_at is null from public.store_pending_changes where id = :pending_a2_id);`,
      )
      expect(out).toBe('t|t')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Grants de las 4 tablas nuevas — cero acceso para anon/authenticated
  // -------------------------------------------------------------------------
  describe('las 4 tablas nuevas no tienen NINGÚN grant para anon/authenticated', () => {
    const tables = ['coupons', 'coupon_redemptions', 'coupon_campaigns', 'campaign_recipients']

    for (const table of tables) {
      it(`anon: select sobre ${table} → permission denied`, () => {
        expectSqlToFail(asAnon([`select 1 from public.${table} limit 1;`]).join('\n'), /permission denied/)
      })

      it(`authenticated: select sobre ${table} → permission denied (aunque el usuario sea dueño de una tienda real)`, () => {
        const userId = newUserId()
        expectSqlToFail(
          [
            createAuthUserSql(userId, `${userId}@example.com`),
            `insert into public.stores (slug, name, status) values ('${uniqueSlug('g-' + table.replace(/_/g, '-'))}', 'Tienda G', 'active') returning id \\gset store_`,
            `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
            ...asAuthenticated(userId, [`select 1 from public.${table} limit 1;`]),
          ].join('\n'),
          /permission denied/,
        )
      })
    }
  })
})
