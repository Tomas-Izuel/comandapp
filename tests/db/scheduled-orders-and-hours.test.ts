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
  sqlConcurrentlySettled,
  uniqueSlug,
} from './helpers'

/**
 * Pedidos programados y horarios de apertura — invariantes que viven en
 * Postgres (migración `20260829140000_scheduled_orders_and_hours.sql`).
 *
 * `00-architecture.md` y `01-tasks.md` (T0) marcan estos casos explícitamente
 * como "solo probable contra base real": la atomicidad de las RPC de
 * horarios, la carrera del tope por noche, el CHECK de coherencia, la
 * inmutabilidad en el trigger, y que `active_order_count`/`advance_auto_orders`
 * excluyan a los programados en espera. Ninguno de estos se puede probar con
 * un mock — son invariantes de transacción, de lock o de permiso de Postgres.
 */
describe.skipIf(!dbAvailable)('pedidos programados y horarios — Postgres', () => {
  // -------------------------------------------------------------------------
  // set_store_hours — permisos y atomicidad
  // -------------------------------------------------------------------------
  describe('public.set_store_hours', () => {
    function ownerFixture(prefix: string) {
      const userId = newUserId()
      return {
        userId,
        setup: [
          createAuthUserSql(userId, `${prefix}@example.com`),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`,
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
        ],
      }
    }

    it('el dueño de la tienda SÍ puede guardar su horario semanal', () => {
      const { userId, setup } = ownerFixture('sh-owner')
      const out = inTransaction(
        ...setup,
        ...asAuthenticated(userId, [
          `select public.set_store_hours(:store_id, '[{"day_of_week":5,"opens_at_minute":1080,"duration_minutes":480}]'::jsonb);`,
        ]),
        `select count(*) from public.store_hours where store_id = :store_id;`,
      )
      expect(out).toBe('1')
    })

    it('reemplaza la semana ENTERA: la segunda llamada borra los rangos de la primera, no los suma', () => {
      const { userId, setup } = ownerFixture('sh-replace')
      const out = inTransaction(
        ...setup,
        ...asAuthenticated(userId, [
          `select public.set_store_hours(:store_id, '[{"day_of_week":1,"opens_at_minute":0,"duration_minutes":60}]'::jsonb);`,
          `select public.set_store_hours(:store_id, '[{"day_of_week":2,"opens_at_minute":0,"duration_minutes":60}]'::jsonb);`,
        ]),
        `select count(*), (select count(*) from public.store_hours where store_id = :store_id and day_of_week = 1)
           from public.store_hours where store_id = :store_id;`,
      )
      // Una sola fila total (la del día 2), y CERO del día 1: si fuera un
      // insert que se acumula en vez de un reemplazo, esto daría "2|1".
      expect(out).toBe('1|0')
    })

    it('un miembro de OTRA tienda no puede setear los horarios de esta (tenancy)', () => {
      const userId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(userId, `${userId}@example.com`),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('sh-a')}', 'A', 'active') returning id \\gset storeA_`,
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('sh-b')}', 'B', 'active') returning id \\gset storeB_`,
          `insert into public.store_members (store_id, user_id, role) values (:storeB_id, '${userId}', 'owner');`,
          ...asAuthenticated(userId, [`select public.set_store_hours(:storeA_id, '[]'::jsonb);`]),
        ].join('\n'),
        /no tenes permiso sobre la tienda/,
      )
    })

    it('falla para service_role: is_store_member() lee auth.uid(), que con el rol de servicio no existe', () => {
      expectSqlToFail(
        [
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('sh-svc')}', 'Tienda', 'active') returning id \\gset store_`,
          'set local role service_role;',
          `select public.set_store_hours(:store_id, '[]'::jsonb);`,
          'reset role;',
        ].join('\n'),
        /no tenes permiso sobre la tienda/,
      )
    })

    it('rechaza el solapamiento CIRCULAR de la semana (sábado 22:00+4h choca con domingo 01:00), aunque nunca pasó por Zod', () => {
      const { userId, setup } = ownerFixture('sh-overlap')
      expectSqlToFail(
        [
          ...setup,
          ...asAuthenticated(userId, [
            `select public.set_store_hours(:store_id,
              '[{"day_of_week":6,"opens_at_minute":1320,"duration_minutes":240},
                {"day_of_week":0,"opens_at_minute":60,"duration_minutes":30}]'::jsonb);`,
          ]),
        ].join('\n'),
        /rangos que se superponen/,
      )
    })

    it('rechaza más de 4 rangos en el mismo día', () => {
      const { userId, setup } = ownerFixture('sh-max4')
      const fiveRanges = Array.from({ length: 5 }, (_, i) => `{"day_of_week":1,"opens_at_minute":${i * 100},"duration_minutes":50}`).join(',')
      expectSqlToFail(
        [...setup, ...asAuthenticated(userId, [`select public.set_store_hours(:store_id, '[${fiveRanges}]'::jsonb);`])].join('\n'),
        /maximo 4 rangos por dia/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // set_store_hours_override / delete_store_hours_override
  // -------------------------------------------------------------------------
  describe('public.set_store_hours_override / delete_store_hours_override', () => {
    function ownerFixture(prefix: string) {
      const userId = newUserId()
      return {
        userId,
        setup: [
          createAuthUserSql(userId, `${prefix}@example.com`),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`,
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
        ],
      }
    }

    it('cierra una fecha (is_closed=true, sin rangos) — la forma que exige el CHECK de la tabla', () => {
      const { userId, setup } = ownerFixture('ov-closed')
      const out = inTransaction(
        ...setup,
        ...asAuthenticated(userId, [`select public.set_store_hours_override(:store_id, '2026-12-25', true, '[]'::jsonb);`]),
        `select is_closed, opens_at_minute, duration_minutes from public.store_hours_overrides where store_id = :store_id;`,
      )
      expect(out).toBe('t||') // is_closed=true, minutos NULL (columnas vacías en -t -A)
    })

    it('abre una fecha con rangos propios', () => {
      const { userId, setup } = ownerFixture('ov-open')
      const out = inTransaction(
        ...setup,
        ...asAuthenticated(userId, [
          `select public.set_store_hours_override(:store_id, '2026-12-24', false, '[{"opens_at_minute":600,"duration_minutes":120}]'::jsonb);`,
        ]),
        `select count(*), is_closed from public.store_hours_overrides where store_id = :store_id group by is_closed;`,
      )
      expect(out).toBe('1|f')
    })

    it('rechaza abrir una fecha sin ningún rango: "una fecha abierta necesita al menos un rango"', () => {
      const { userId, setup } = ownerFixture('ov-empty')
      expectSqlToFail(
        [
          ...setup,
          ...asAuthenticated(userId, [`select public.set_store_hours_override(:store_id, '2026-12-24', false, '[]'::jsonb);`]),
        ].join('\n'),
        /necesita al menos un rango/,
      )
    })

    it('delete_store_hours_override borra la excepción y el patrón semanal vuelve a regir', () => {
      const { userId, setup } = ownerFixture('ov-delete')
      const out = inTransaction(
        ...setup,
        ...asAuthenticated(userId, [
          `select public.set_store_hours_override(:store_id, '2026-12-25', true, '[]'::jsonb);`,
          `select public.delete_store_hours_override(:store_id, '2026-12-25');`,
        ]),
        `select count(*) from public.store_hours_overrides where store_id = :store_id;`,
      )
      expect(out).toBe('0')
    })

    it('un miembro de otra tienda no puede tocar el calendario de excepciones ajeno', () => {
      const userId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(userId, `${userId}@example.com`),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('ov-a')}', 'A', 'active') returning id \\gset storeA_`,
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('ov-b')}', 'B', 'active') returning id \\gset storeB_`,
          `insert into public.store_members (store_id, user_id, role) values (:storeB_id, '${userId}', 'owner');`,
          ...asAuthenticated(userId, [`select public.set_store_hours_override(:storeA_id, '2026-12-25', true, '[]'::jsonb);`]),
        ].join('\n'),
        /no tenes permiso sobre la tienda/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Grants: lectura pública, escritura CERO por la tabla directa
  // -------------------------------------------------------------------------
  describe('grants de store_hours / store_hours_overrides', () => {
    function activeStore(prefix: string) {
      return [`insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`]
    }

    it('anon SÍ puede leer los horarios de una tienda activa — es el dato más público del local', () => {
      const out = inTransaction(
        ...activeStore('grant-read'),
        `insert into public.store_hours (store_id, day_of_week, opens_at_minute, duration_minutes) values (:store_id, 5, 1080, 480);`,
        ...asAnon([`select count(*) from public.store_hours where store_id = :store_id;`]),
      )
      expect(out).toBe('1')
    })

    it('anon NO puede escribir store_hours directo — ni un insert', () => {
      expectSqlToFail(
        [
          ...activeStore('grant-anon-write'),
          ...asAnon([`insert into public.store_hours (store_id, day_of_week, opens_at_minute, duration_minutes) values (:store_id, 1, 0, 60);`]),
        ].join('\n'),
        /permission denied for table store_hours/,
      )
    })

    it('un STAFF LOGUEADO tampoco puede escribir store_hours por la tabla directa: cero grants de escritura a authenticated, toda la escritura pasa por la RPC', () => {
      const userId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(userId, `${userId}@example.com`),
          ...activeStore('grant-staff-write'),
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
          ...asAuthenticated(userId, [
            `insert into public.store_hours (store_id, day_of_week, opens_at_minute, duration_minutes) values (:store_id, 1, 0, 60);`,
          ]),
        ].join('\n'),
        /permission denied for table store_hours/,
      )
    })

    it('anon NO puede escribir store_hours_overrides directo', () => {
      expectSqlToFail(
        [
          ...activeStore('grant-anon-ov'),
          ...asAnon([`insert into public.store_hours_overrides (store_id, on_date, is_closed) values (:store_id, '2026-12-25', true);`]),
        ].join('\n'),
        /permission denied for table store_hours_overrides/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Grant por columna en `stores`: scheduled_delivery_enabled / scheduled_capacity_per_night
  // -------------------------------------------------------------------------
  it('un dueño SÍ puede escribir scheduled_delivery_enabled y scheduled_capacity_per_night con el cliente de SESIÓN (Q2/Q3, grant por columna)', () => {
    const userId = newUserId()
    const out = inTransaction(
      createAuthUserSql(userId, `${userId}@example.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('col-grant')}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
      ...asAuthenticated(userId, [
        `update public.stores set scheduled_delivery_enabled = true, scheduled_capacity_per_night = 5 where id = :store_id;`,
        `select scheduled_delivery_enabled, scheduled_capacity_per_night from public.stores where id = :store_id;`,
      ]),
    )
    expect(out).toBe('t|5')
  })

  // -------------------------------------------------------------------------
  // create_order: fire_at, CHECK de coherencia, inmutabilidad
  // -------------------------------------------------------------------------
  describe('public.create_order — pedidos programados', () => {
    function store(prefix: string) {
      return [`insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`]
    }

    function scheduledOrderCall(opts: {
      key: string
      scheduledFor: string
      night: string
      basePrep?: number
      deliveryMinutes?: number
      capacity?: number | null
    }): string {
      const { key, scheduledFor, night, basePrep = 10, deliveryMinutes = 0, capacity = null } = opts
      return `select public.create_order(
        jsonb_build_object(
          'store_id', :store_id, 'status', 'confirmed', 'customer_name', 'Cliente',
          'customer_phone_e164', '+5491100000000', 'customer_email', null,
          'idempotency_key', '${key}', 'notes', null, 'currency', 'ARS',
          'subtotal_cents', 1000, 'total_cents', 1000, 'base_prep_minutes', ${basePrep},
          'demand_multiplier', null, 'eta_minutes', null, 'eta_at', '${scheduledFor}',
          'payment_method', 'in_store', 'payment_status', 'pending',
          'delivery_minutes', ${deliveryMinutes},
          'scheduled_for', '${scheduledFor}', 'scheduled_night', '${night}',
          'night_capacity', ${capacity === null ? 'null' : capacity}
        ),
        '[]'::jsonb
      ) as id \\gset order_`
    }

    it('calcula fire_at = scheduled_for − (base_prep + delivery_minutes + 5 de margen), exacto', () => {
      const out = inTransaction(
        ...store('fire-calc'),
        scheduledOrderCall({
          key: uniqueSlug('fire-calc'),
          scheduledFor: '2026-06-01T22:00:00.000Z',
          night: '2026-06-01',
          basePrep: 10,
          deliveryMinutes: 20,
        }),
        `select round(extract(epoch from ('2026-06-01T22:00:00.000Z'::timestamptz - fire_at)) / 60)::int from public.orders where id = :order_id;`,
      )
      // 10 (cocción) + 20 (viaje) + 5 (margen) = 35 minutos antes de la promesa.
      expect(out).toBe('35')
    })

    it('un fire_at que queda EN EL PASADO (lead corto + carrito lento) se acepta igual: no es un bug, es la recuperación correcta', () => {
      // scheduled_for a 10 minutos de "ahora" con 60 minutos de cocción+viaje:
      // fire_at = scheduled_for - 65min, bien atrás de "ahora". El CHECK
      // (fire_at <= scheduled_for) se cumple igual.
      const nearFuture = sql(`select (now() + interval '10 minutes')::text;`)
      const out = inTransaction(
        ...store('fire-past'),
        scheduledOrderCall({
          key: uniqueSlug('fire-past'),
          scheduledFor: nearFuture,
          night: '2026-06-02',
          basePrep: 40,
          deliveryMinutes: 20,
        }),
        `select (fire_at < now()) from public.orders where id = :order_id;`,
      )
      expect(out).toBe('t')
    })

    describe('CHECK orders_scheduled_coherence_check', () => {
      it('los tres campos null (pedido inmediato) es válido', () => {
        const out = inTransaction(
          ...store('coh-immediate'),
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
             values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000)
           returning (scheduled_for is null and fire_at is null and scheduled_night is null);`,
        )
        expect(out).toBe('t')
      })

      it('los tres no-null con fire_at <= scheduled_for es válido', () => {
        const out = inTransaction(
          ...store('coh-valid'),
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
             values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000,
                     '2026-06-01T22:00:00Z', '2026-06-01T21:30:00Z', '2026-06-01')
           returning id;`,
        )
        expect(out).toMatch(/^\d+$/)
      })

      it('scheduled_for null con fire_at no-null rebota (mezcla parcial)', () => {
        expectSqlToFail(
          [
            ...store('coh-partial-1'),
            `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, fire_at)
               values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000, now());`,
          ].join('\n'),
          /orders_scheduled_coherence_check/,
        )
      })

      it('scheduled_night null con scheduled_for no-null rebota', () => {
        expectSqlToFail(
          [
            ...store('coh-partial-2'),
            `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at)
               values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000, now() + interval '1 day', now());`,
          ].join('\n'),
          /orders_scheduled_coherence_check/,
        )
      })

      it('fire_at DESPUÉS de scheduled_for rebota: el fire nunca puede quedar después de la promesa', () => {
        expectSqlToFail(
          [
            ...store('coh-fire-after'),
            `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
               values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000,
                       '2026-06-01T20:00:00Z', '2026-06-01T20:30:00Z', '2026-06-01');`,
          ].join('\n'),
          /orders_scheduled_coherence_check/,
        )
      })
    })

    describe('inmutabilidad en private.enforce_order_rules', () => {
      function scheduledOrder(prefix: string) {
        return [
          ...store(prefix),
          `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
             values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000,
                     '2026-06-01T22:00:00Z', '2026-06-01T21:30:00Z', '2026-06-01')
           returning id \\gset order_`,
        ]
      }

      it('scheduled_for rebota en un UPDATE: la promesa no se renegocia', () => {
        expectSqlToFail(
          [...scheduledOrder('immut-sf'), `update public.orders set scheduled_for = scheduled_for + interval '1 hour' where id = :order_id;`].join('\n'),
          /columnas inmutables/,
        )
      })

      it('fire_at rebota en un UPDATE', () => {
        expectSqlToFail(
          [...scheduledOrder('immut-fa'), `update public.orders set fire_at = fire_at - interval '1 hour' where id = :order_id;`].join('\n'),
          /columnas inmutables/,
        )
      })

      it('scheduled_night rebota en un UPDATE', () => {
        expectSqlToFail(
          [...scheduledOrder('immut-sn'), `update public.orders set scheduled_night = '2026-06-02' where id = :order_id;`].join('\n'),
          /columnas inmutables/,
        )
      })

      it('el ESTADO de un programado SÍ puede cambiar (la inmutabilidad es de la promesa, no del pedido)', () => {
        const out = inTransaction(
          ...scheduledOrder('immut-status'),
          `update public.orders set status = 'preparing' where id = :order_id;`,
          `select status from public.orders where id = :order_id;`,
        )
        expect(out).toBe('preparing')
      })
    })

    /**
     * LA CARRERA DEL TOPE. Es el test que justifica el advisory lock: un `if`
     * en el servidor (leer el conteo, decidir, insertar) pierde cuando dos
     * clientes agarran el último lugar de la misma noche a la vez. Acá se
     * lanzan N conexiones REALES en paralelo (procesos `psql` separados, no
     * un `for` secuencial) contra la misma `(store_id, scheduled_night)` con
     * capacidad N-1.
     */
    it('LA CARRERA DEL TOPE: N create_order concurrentes por la misma noche con capacidad N-1 crean EXACTAMENTE N-1 pedidos', async () => {
      const N = 5
      const capacity = N - 1
      const night = '2026-07-04'
      const scheduledFor = '2026-07-04T23:00:00.000Z'

      const storeId = sql(
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('race')}', 'Tienda Race', 'active') returning id;`,
      )

      function callFor(i: number): string {
        const key = uniqueSlug(`race-key-${i}`)
        return `select public.create_order(
          jsonb_build_object(
            'store_id', ${storeId}, 'status', 'confirmed', 'customer_name', 'Cliente',
            'customer_phone_e164', '+5491100000000', 'customer_email', null,
            'idempotency_key', '${key}', 'notes', null, 'currency', 'ARS',
            'subtotal_cents', 1000, 'total_cents', 1000, 'base_prep_minutes', 10,
            'demand_multiplier', null, 'eta_minutes', null, 'eta_at', '${scheduledFor}',
            'payment_method', 'in_store', 'payment_status', 'pending',
            'scheduled_for', '${scheduledFor}', 'scheduled_night', '${night}',
            'night_capacity', ${capacity}
          ),
          '[]'::jsonb
        );`
      }

      try {
        const results = await sqlConcurrentlySettled(Array.from({ length: N }, (_, i) => callFor(i)))

        const succeeded = results.filter((r) => r.ok)
        const failed = results.filter((r) => !r.ok)

        expect(succeeded).toHaveLength(capacity)
        expect(failed).toHaveLength(N - capacity)
        // El resto no perdió por CUALQUIER motivo: perdió específicamente
        // contra el tope de la noche, con el marcador que la app traduce.
        for (const loss of failed) {
          if (!loss.ok) expect(loss.error).toMatch(/scheduled_night_full/)
        }

        const realCount = sql(
          `select count(*) from public.orders where store_id = ${storeId} and scheduled_night = '${night}' and status <> 'cancelled';`,
        )
        expect(realCount).toBe(String(capacity))
      } finally {
        // Este test no puede envolverse en begin/rollback (necesita conexiones
        // de verdad, concurrentes): limpia a mano lo que creó. `orders.store_id`
        // es ON DELETE RESTRICT, así que primero los pedidos.
        sql(`delete from public.orders where store_id = ${storeId}; delete from public.stores where id = ${storeId};`)
      }
    })
  })

  // -------------------------------------------------------------------------
  // cancel_scheduled_orders — el apagado destructivo
  // -------------------------------------------------------------------------
  describe('public.cancel_scheduled_orders', () => {
    function ownerFixture(prefix: string) {
      const userId = newUserId()
      return {
        userId,
        setup: [
          createAuthUserSql(userId, `${prefix}@example.com`),
          `insert into public.stores (slug, name, status, accepting_orders) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active', true) returning id \\gset store_`,
          `insert into public.store_members (store_id, user_id, role) values (:store_id, '${userId}', 'owner');`,
        ],
      }
    }

    function scheduledOrder(varName: string, opts: { night: string; fireAtOffset: string; status?: string; paymentStatus?: string }) {
      const { night, fireAtOffset, status = 'confirmed', paymentStatus = 'pending' } = opts
      return `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
         values (:store_id, '${status}', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', '${paymentStatus}', 5000, 5000,
                 now() + interval '1 day', now() + interval '${fireAtOffset}', '${night}')
       returning id \\gset ${varName}_`
    }

    it('cancela solo los de ESA noche que todavía NO dispararon (fire_at > now), respetando pending/confirmed', () => {
      const { userId, setup } = ownerFixture('csn-scope')
      const out = inTransaction(
        ...setup,
        scheduledOrder('future', { night: '2026-08-01', fireAtOffset: '2 hours' }), // todavía no dispara
        scheduledOrder('fired', { night: '2026-08-01', fireAtOffset: '-2 hours' }), // ya disparó (ya está en la plancha)
        scheduledOrder('otherNight', { night: '2026-08-02', fireAtOffset: '2 hours' }), // noche distinta
        ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:store_id, '2026-08-01', false)::text;`]),
        `select status from public.orders where id = :future_id;`,
        `select status from public.orders where id = :fired_id;`,
        `select status from public.orders where id = :otherNight_id;`,
      )
      const lines = out.split('\n')
      const result = JSON.parse(lines[0]) as { cancelledIds: number[]; cancelled: number; paidCents: number }
      expect(result.cancelled).toBe(1)
      expect(lines[1]).toBe('cancelled') // el que no había disparado
      expect(lines[2]).toBe('confirmed') // el que ya disparó: NO se toca (está en la plancha)
      expect(lines[3]).toBe('confirmed') // otra noche: NO se toca
    })

    it('NO toca los pedidos de OTRA tienda, aunque compartan el mismo valor de scheduled_night', () => {
      const { userId, setup: setupA } = ownerFixture('csn-ten-a') // deja :store_id gseteado a la tienda A
      const userB = newUserId()
      const out = inTransaction(
        ...setupA,
        createAuthUserSql(userB, `${userB}@example.com`),
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('csn-ten-b')}', 'Tienda B', 'active') returning id \\gset storeB_`,
        `insert into public.store_members (store_id, user_id, role) values (:storeB_id, '${userB}', 'owner');`,
        `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
           values (:storeB_id, 'confirmed', 'Cliente B', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 5000, 5000,
                   now() + interval '1 day', now() + interval '2 hours', '2026-08-01')
         returning id \\gset ajena_`,
        ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:store_id, '2026-08-01', false)::text;`]),
        `select status from public.orders where id = :ajena_id;`,
      )
      const lines = out.split('\n')
      const result = JSON.parse(lines[0]) as { cancelled: number }
      expect(result.cancelled).toBe(0) // la tienda A no tenía ningún programado
      expect(lines[1]).toBe('confirmed') // el de la tienda B sigue intacto
    })

    it('paidCents suma SOLO los pagos aprobados de lo que cancela', () => {
      const { userId, setup } = ownerFixture('csn-paid')
      const out = inTransaction(
        ...setup,
        scheduledOrder('paid', { night: '2026-08-01', fireAtOffset: '2 hours', paymentStatus: 'approved' }),
        scheduledOrder('unpaid', { night: '2026-08-01', fireAtOffset: '2 hours', paymentStatus: 'pending' }),
        ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:store_id, '2026-08-01', false)::text;`]),
      )
      const result = JSON.parse(out) as { cancelled: number; paidCents: number }
      expect(result.cancelled).toBe(2)
      expect(result.paidCents).toBe(5000) // solo el aprobado, no los 10000 de los dos
    })

    it('p_pause=true apaga accepting_orders EN LA MISMA transacción que cancela', () => {
      const { userId, setup } = ownerFixture('csn-pause')
      const out = inTransaction(
        ...setup,
        scheduledOrder('n1', { night: '2026-08-01', fireAtOffset: '2 hours' }),
        ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:store_id, '2026-08-01', true)::text;`]),
        `select accepting_orders from public.stores where id = :store_id;`,
      )
      const lines = out.split('\n')
      expect(lines[1]).toBe('f')
    })

    it('p_pause=false (default) NO toca accepting_orders — el cierre de una fecha puntual no pausa la tienda entera', () => {
      const { userId, setup } = ownerFixture('csn-nopause')
      const out = inTransaction(
        ...setup,
        scheduledOrder('n1', { night: '2026-08-01', fireAtOffset: '2 hours' }),
        ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:store_id, '2026-08-01', false)::text;`]),
        `select accepting_orders from public.stores where id = :store_id;`,
      )
      const lines = out.split('\n')
      expect(lines[1]).toBe('t')
    })

    it('falla para un miembro de OTRA tienda (tenancy)', () => {
      const userId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(userId, `${userId}@example.com`),
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('csn-a')}', 'A', 'active') returning id \\gset storeA_`,
          `insert into public.stores (slug, name, status) values ('${uniqueSlug('csn-b')}', 'B', 'active') returning id \\gset storeB_`,
          `insert into public.store_members (store_id, user_id, role) values (:storeB_id, '${userId}', 'owner');`,
          ...asAuthenticated(userId, [`select public.cancel_scheduled_orders(:storeA_id, '2026-08-01', false);`]),
        ].join('\n'),
        /no tenes permiso sobre la tienda/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // private.active_order_count — el espejo en Postgres de COOKING_STATUSES
  // -------------------------------------------------------------------------
  describe('private.active_order_count', () => {
    function store(prefix: string) {
      return [`insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`]
    }
    function order(status: string, scheduledForFireOffset?: string) {
      const scheduled = scheduledForFireOffset
        ? `, scheduled_for, fire_at, scheduled_night) values (:store_id, '${status}', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000, now() + interval '1 day', now() + interval '${scheduledForFireOffset}', '2026-09-01'`
        : `) values (:store_id, '${status}', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000`
      return `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents${scheduled});`
    }

    it('excluye un programado en "confirmed" que todavía NO disparó (fire_at en el futuro)', () => {
      const out = inTransaction(...store('aoc-waiting'), order('confirmed', '2 hours'), `select private.active_order_count(:store_id);`)
      expect(out).toBe('0')
    })

    it('SÍ cuenta un programado en "confirmed" que YA disparó (fire_at en el pasado)', () => {
      const out = inTransaction(...store('aoc-fired'), order('confirmed', '-2 hours'), `select private.active_order_count(:store_id);`)
      expect(out).toBe('1')
    })

    it('cuenta normal un pedido inmediato en confirmed/preparing (fire_at null)', () => {
      const out = inTransaction(
        ...store('aoc-normal'),
        order('confirmed'),
        order('preparing'),
        `select private.active_order_count(:store_id);`,
      )
      expect(out).toBe('2')
    })

    it('no cuenta un pedido "ready" ni uno "on_the_way" (fuera de COOKING_STATUSES)', () => {
      const out = inTransaction(...store('aoc-ready'), order('ready'), order('on_the_way'), `select private.active_order_count(:store_id);`)
      expect(out).toBe('0')
    })
  })

  // -------------------------------------------------------------------------
  // advance_auto_orders — auto-comenzar respeta fire_at
  // -------------------------------------------------------------------------
  describe('public.advance_auto_orders — auto-start respeta fire_at', () => {
    function autoStore(prefix: string) {
      return [
        `insert into public.stores (slug, name, status, auto_start_orders) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active', true) returning id \\gset store_`,
      ]
    }

    it('NO arranca un programado que todavía no disparó (fire_at futuro): sigue en confirmed', () => {
      const out = inTransaction(
        ...autoStore('aa-waiting'),
        `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
           values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000,
                   now() + interval '4 hours', now() + interval '3 hours', '2026-09-02')
         returning id \\gset order_`,
        `select public.advance_auto_orders();`,
        `select status from public.orders where id = :order_id;`,
      )
      expect(out.split('\n').at(-1)).toBe('confirmed')
    })

    it('SÍ arranca un programado cuyo fire_at ya venció: pasa a preparing igual que un pedido inmediato', () => {
      const out = inTransaction(
        ...autoStore('aa-fired'),
        `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, scheduled_for, fire_at, scheduled_night)
           values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 1000, 1000,
                   now() + interval '1 hour', now() - interval '5 minutes', '2026-09-02')
         returning id \\gset order_`,
        `select public.advance_auto_orders();`,
        `select status from public.orders where id = :order_id;`,
      )
      expect(out.split('\n').at(-1)).toBe('preparing')
    })
  })

  // -------------------------------------------------------------------------
  // expire_pending_orders — sigue cancelando un programado impago abandonado
  // -------------------------------------------------------------------------
  it('expire_pending_orders SIGUE cancelando un pedido programado online sin pagar y viejo (libera el cupo de la noche)', () => {
    const out = inTransaction(
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('expire-sched')}', 'Tienda', 'active') returning id \\gset store_`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at, scheduled_for, fire_at, scheduled_night)
         values (:store_id, 'pending', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 1000, 1000,
                 now() - interval '2 hours', now() + interval '1 day', now() + interval '1 day' - interval '15 minutes', '2026-09-05')
       returning id \\gset order_`,
      `select public.expire_pending_orders(45);`,
      `select status from public.orders where id = :order_id;`,
    )
    expect(out.split('\n').at(-1)).toBe('cancelled')
  })
})
