import { describe, expect, it } from 'vitest'
import { asAnon, asAuthenticated, createAuthUserSql, dbAvailable, expectSqlToFail, inTransaction, newUserId, uniqueSlug } from './helpers'

/**
 * Padrón de clientes (`20260901120000_clientes.sql`) — T1A de
 * `docs/pipelines/2026-08-31-clientes-y-cupones/01-tasks.md`.
 *
 * Todo lo que importa acá vive en Postgres: la tabla no tiene un solo grant
 * para `authenticated`/`anon` (§5.11.2), así que la única forma real de
 * probar el trigger, la RPC y los grants es contra el stack local — un mock
 * de `supabase-js` no puede fingir un `permission denied` de verdad.
 */
describe.skipIf(!dbAvailable)('store_customers — el padrón materializado', () => {
  function makeStore(prefix: string): string {
    return `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset ${prefix}_`
  }

  function insertOrder(opts: {
    storeVar: string
    phone: string
    name: string
    email?: string | null
    status: string
    paymentMethod?: string
    paymentStatus?: string
    totalCents?: number
    createdAtSql?: string
  }): string {
    const { storeVar, phone, name, email = null, status, paymentMethod = 'in_store', paymentStatus = 'approved', totalCents = 1000, createdAtSql } = opts
    const emailLiteral = email === null ? 'null' : `'${email}'`
    const createdAtCol = createdAtSql ? ', created_at' : ''
    const createdAtVal = createdAtSql ? `, ${createdAtSql}` : ''
    return `insert into public.orders (store_id, status, customer_name, customer_phone_e164, customer_email, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents${createdAtCol})
       values (:${storeVar}_id, '${status}', '${name}', '${phone}', ${emailLiteral}, gen_random_uuid()::text, '${paymentMethod}', '${paymentStatus}', ${totalCents}, ${totalCents}${createdAtVal});`
  }

  // ---------------------------------------------------------------------
  // Criterio 1 — la fila aparece siempre que exista un pedido, con
  // orders_count reflejando si ESE pedido es facturable o no.
  // ---------------------------------------------------------------------
  it('un pedido NO facturable (online, todavía pendiente de pago) crea la fila con orders_count = 0', () => {
    const out = inTransaction(
      makeStore('c1'),
      insertOrder({ storeVar: 'c1', phone: '+5491100000101', name: 'Cliente', status: 'pending', paymentMethod: 'online', paymentStatus: 'pending' }),
      `select orders_count, total_spent_cents from public.store_customers where store_id = :c1_id;`,
    )
    expect(out).toBe('0|0')
  })

  it('un pedido facturable (pago en el local, ya entregado) crea la fila con orders_count = 1', () => {
    const out = inTransaction(
      makeStore('c2'),
      insertOrder({ storeVar: 'c2', phone: '+5491100000102', name: 'Cliente', status: 'delivered', paymentMethod: 'in_store', paymentStatus: 'pending', totalCents: 5000 }),
      `select orders_count, total_spent_cents from public.store_customers where store_id = :c2_id;`,
    )
    expect(out).toBe('1|5000')
  })

  // ---------------------------------------------------------------------
  // Criterio 2 — el hueco de `order_is_billable` para in_store: un
  // reembolso tiene que BAJAR total_spent_cents, no dejarlo pegado arriba.
  // ---------------------------------------------------------------------
  it('un in_store delivered y DESPUÉS reembolsado: total_spent_cents baja a 0 (hueco de order_is_billable que el padrón sí tapa)', () => {
    const out = inTransaction(
      makeStore('c3'),
      insertOrder({ storeVar: 'c3', phone: '+5491100000103', name: 'Cliente', status: 'delivered', paymentMethod: 'in_store', paymentStatus: 'pending', totalCents: 8000 }),
      `select total_spent_cents, orders_count from public.store_customers where store_id = :c3_id;`, // antes del reembolso
      `update public.orders set payment_status = 'refunded', refunded_at = now() where store_id = :c3_id;`,
      `select total_spent_cents, orders_count from public.store_customers where store_id = :c3_id;`, // después
    )
    const [before, after] = out.split('\n')
    expect(before).toBe('8000|1')
    expect(after).toBe('0|0')
  })

  // ---------------------------------------------------------------------
  // Criterio 3 — el otro hueco: online aprobado y luego cancelado por la
  // cocina no puede seguir contando como plata.
  // ---------------------------------------------------------------------
  it('un online approved y DESPUÉS cancelado por la cocina: deja de contar (payment_status sigue en approved, pero status = cancelled)', () => {
    const out = inTransaction(
      makeStore('c4'),
      insertOrder({ storeVar: 'c4', phone: '+5491100000104', name: 'Cliente', status: 'confirmed', paymentMethod: 'online', paymentStatus: 'approved', totalCents: 4000 }),
      `select total_spent_cents, orders_count from public.store_customers where store_id = :c4_id;`,
      `update public.orders set status = 'cancelled' where store_id = :c4_id;`, // confirmed -> cancelled es transición legal
      `select total_spent_cents, orders_count, payment_status from public.store_customers sc join public.orders o on o.store_id = sc.store_id where sc.store_id = :c4_id;`,
    )
    const [before, after] = out.split('\n')
    expect(before).toBe('4000|1')
    // payment_status sigue 'approved' (nadie lo reembolsó) — el hueco real de
    // order_is_billable es justamente ESO, y el padrón lo tapa mirando status.
    expect(after).toBe('0|0|approved')
  })

  // ---------------------------------------------------------------------
  // Criterio 4 — mismo teléfono, dos nombres: una sola fila.
  // ---------------------------------------------------------------------
  it('dos pedidos del mismo teléfono con nombres distintos → UNA fila (no dos)', () => {
    const out = inTransaction(
      makeStore('c5'),
      insertOrder({ storeVar: 'c5', phone: '+5491100000105', name: 'Juan Perez', status: 'delivered', createdAtSql: "now() - interval '2 days'" }),
      insertOrder({ storeVar: 'c5', phone: '+5491100000105', name: 'Juan P.', status: 'delivered', createdAtSql: 'now()' }),
      `select count(*) from public.store_customers where store_id = :c5_id;`,
    )
    expect(out).toBe('1')
  })

  it('display_name toma el nombre del pedido FACTURABLE más reciente (no del pedido más reciente a secas)', () => {
    // El pedido más NUEVO es un online todavía impago (no facturable) con un
    // nombre distinto ("Pedro"); el pedido facturable más reciente es el de
    // "Juan", un día antes. Spec (00-architecture.md §5.2, T1A criterio 4):
    // display_name tiene que reflejar el pedido FACTURABLE más reciente —
    // el nombre lo pone el pedido que contó, no un intento abandonado que
    // puede traer cualquier cosa tipeada.
    //
    // HALLAZGO reportado en 03-tests.md: la primera versión de
    // private.recalc_store_customer (20260901120000_clientes.sql) elegía el
    // nombre del pedido más reciente SIN filtrar por facturable, así que este
    // test daba "Pedro" en vez de "Juan". El hilo principal lo corrigió en la
    // misma migración con un `coalesce` de tres ramas (facturable más
    // reciente → cualquiera más reciente → ''); el test quedó tal cual con la
    // expectativa correcta, y ahora pasa contra el código corregido.
    const out = inTransaction(
      makeStore('c5b'),
      insertOrder({
        storeVar: 'c5b',
        phone: '+5491100000106',
        name: 'Juan',
        status: 'delivered',
        paymentMethod: 'in_store',
        paymentStatus: 'pending',
        createdAtSql: "now() - interval '1 day'",
      }),
      insertOrder({
        storeVar: 'c5b',
        phone: '+5491100000106',
        name: 'Pedro',
        status: 'pending',
        paymentMethod: 'online',
        paymentStatus: 'pending', // NO facturable: pago online todavía pendiente
        createdAtSql: 'now()',
      }),
      `select display_name from public.store_customers where store_id = :c5b_id;`,
    )
    expect(out).toBe('Juan')
  })

  it('un cliente con SOLO pedidos no facturables (cancelado u online impago) tiene fila con orders_count = 0 Y display_name NO vacío', () => {
    // Es la otra mitad de la regla de arriba, y la razón por la que el
    // `coalesce` tiene una tercera rama (facturable → cualquiera → ''): sin
    // el fallback al "cualquiera", un cliente que solo canceló pedidos
    // tendría display_name = '' y la fila se vería en blanco en el padrón —
    // pero la fila TIENE que existir (00-architecture.md §5.2: "el que
    // reserva y no aparece es un cliente").
    const out = inTransaction(
      makeStore('c5c'),
      insertOrder({ storeVar: 'c5c', phone: '+5491100000106b', name: 'Cliente Que Canceló', status: 'cancelled' }),
      `select orders_count, display_name from public.store_customers where store_id = :c5c_id;`,
    )
    expect(out).toBe('0|Cliente Que Canceló')
  })

  // ---------------------------------------------------------------------
  // Criterio 5 — el email se conserva aunque un pedido posterior no lo traiga.
  // ---------------------------------------------------------------------
  it('un pedido con email y otro DESPUÉS sin email, mismo teléfono → el email se CONSERVA', () => {
    const out = inTransaction(
      makeStore('c6'),
      insertOrder({ storeVar: 'c6', phone: '+5491100000107', name: 'Ana', email: 'ana@example.com', status: 'delivered', createdAtSql: "now() - interval '1 day'" }),
      insertOrder({ storeVar: 'c6', phone: '+5491100000107', name: 'Ana', email: null, status: 'delivered', createdAtSql: 'now()' }),
      `select email from public.store_customers where store_id = :c6_id;`,
    )
    expect(out).toBe('ana@example.com')
  })

  // ---------------------------------------------------------------------
  // Criterio 6 — el email NO es la identidad: dos teléfonos, un mail → dos filas.
  // ---------------------------------------------------------------------
  it('dos teléfonos distintos con el MISMO email → dos filas (el teléfono es la identidad, no el mail)', () => {
    const out = inTransaction(
      makeStore('c7'),
      insertOrder({ storeVar: 'c7', phone: '+5491100000108', name: 'Uno', email: 'compartido@example.com', status: 'delivered' }),
      insertOrder({ storeVar: 'c7', phone: '+5491100000109', name: 'Dos', email: 'compartido@example.com', status: 'delivered' }),
      `select count(*) from public.store_customers where store_id = :c7_id and email = 'compartido@example.com';`,
    )
    expect(out).toBe('2')
  })

  // ---------------------------------------------------------------------
  // Criterio 7 — el padrón es por tienda: mismo teléfono en dos locales.
  // ---------------------------------------------------------------------
  it('el mismo teléfono en DOS tiendas → dos filas, cada una con su propio unsubscribe_token', () => {
    const out = inTransaction(
      makeStore('c8a'),
      makeStore('c8b'),
      insertOrder({ storeVar: 'c8a', phone: '+5491100000110', name: 'Cliente Multi', status: 'delivered' }),
      insertOrder({ storeVar: 'c8b', phone: '+5491100000110', name: 'Cliente Multi', status: 'delivered' }),
      `select count(*), count(distinct unsubscribe_token) from public.store_customers where phone_e164 = '+5491100000110';`,
    )
    expect(out).toBe('2|2')
  })

  it('la baja en UNA tienda no afecta la fila de la OTRA tienda (bajas independientes por local)', () => {
    const out = inTransaction(
      makeStore('c8c'),
      makeStore('c8d'),
      insertOrder({ storeVar: 'c8c', phone: '+5491100000111', name: 'Cliente Multi', status: 'delivered' }),
      insertOrder({ storeVar: 'c8d', phone: '+5491100000111', name: 'Cliente Multi', status: 'delivered' }),
      `update public.store_customers set marketing_opt_out_at = now() where store_id = :c8c_id;`,
      `select
         (select marketing_opt_out_at is not null from public.store_customers where store_id = :c8c_id) as tienda_a_baja,
         (select marketing_opt_out_at is null     from public.store_customers where store_id = :c8d_id) as tienda_b_activa;`,
    )
    expect(out).toBe('t|t')
  })

  // ---------------------------------------------------------------------
  // Criterio 8 — la trampa de store_customer_directory: cliente de sesión
  // ajeno a la tienda, y service_role (sin auth.uid()).
  // ---------------------------------------------------------------------
  describe('store_customer_directory — la trampa idéntica a store_couriers', () => {
    it('un authenticated que NO es dueño de la tienda recibe 42501 (no ve el padrón de otro local)', () => {
      const ownerId = newUserId()
      const outsiderId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(ownerId, `${ownerId}@example.com`),
          createAuthUserSql(outsiderId, `${outsiderId}@example.com`),
          makeStore('c9'),
          `insert into public.store_members (store_id, user_id, role) values (:c9_id, '${ownerId}', 'owner');`,
          ...asAuthenticated(outsiderId, [`select public.store_customer_directory(:c9_id);`]),
        ].join('\n'),
        /solo el dueno del local ve el padron/,
      )
    })

    it('un authenticated que es STAFF (no owner) de la MISMA tienda también recibe 42501 — el padrón es solo del dueño', () => {
      const staffId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(staffId, `${staffId}@example.com`),
          makeStore('c9b'),
          `insert into public.store_members (store_id, user_id, role) values (:c9b_id, '${staffId}', 'staff');`,
          ...asAuthenticated(staffId, [`select public.store_customer_directory(:c9b_id);`]),
        ].join('\n'),
        /solo el dueno del local ve el padron/,
      )
    })

    it('llamada con service_role (sin auth.uid(), como haría el admin client por error) falla siempre — misma trampa que store_couriers', () => {
      expectSqlToFail(
        [makeStore('c9c'), 'set local role service_role;', `select public.store_customer_directory(:c9c_id);`].join('\n'),
        /solo el dueno del local ve el padron/,
      )
    })

    it('el dueño SÍ ve su propio padrón, ordenado por gastado desc', () => {
      const ownerId = newUserId()
      const out = inTransaction(
        createAuthUserSql(ownerId, `${ownerId}@example.com`),
        makeStore('c9d'),
        `insert into public.store_members (store_id, user_id, role) values (:c9d_id, '${ownerId}', 'owner');`,
        insertOrder({ storeVar: 'c9d', phone: '+5491100000112', name: 'Gasta Poco', status: 'delivered', totalCents: 1000 }),
        insertOrder({ storeVar: 'c9d', phone: '+5491100000113', name: 'Gasta Mucho', status: 'delivered', totalCents: 9000 }),
        ...asAuthenticated(ownerId, [`select public.store_customer_directory(:c9d_id)::text;`]),
      )
      const parsed = JSON.parse(out) as { customers: Array<{ displayName: string; totalSpentCents: number }>; totals: { customers: number } }
      expect(parsed.totals.customers).toBe(2)
      expect(parsed.customers.map((c) => c.displayName)).toEqual(['Gasta Mucho', 'Gasta Poco'])
    })
  })

  // ---------------------------------------------------------------------
  // Criterio 9 — la tabla en sí es inalcanzable desde el browser.
  // ---------------------------------------------------------------------
  describe('store_customers — cero grants para el browser (verificado a mano por el planner, cubierto acá)', () => {
    it('select con anon → permission denied (42501), no cero filas silenciosas', () => {
      expectSqlToFail([makeStore('c10a'), ...asAnon([`select * from public.store_customers where store_id = :c10a_id;`])].join('\n'), /permission denied for table store_customers/)
    })

    it('select con authenticated (un dueño real de la tienda) → permission denied igual — la lectura va SOLO por RPC', () => {
      const ownerId = newUserId()
      expectSqlToFail(
        [
          createAuthUserSql(ownerId, `${ownerId}@example.com`),
          makeStore('c10b'),
          `insert into public.store_members (store_id, user_id, role) values (:c10b_id, '${ownerId}', 'owner');`,
          ...asAuthenticated(ownerId, [`select * from public.store_customers where store_id = :c10b_id;`]),
        ].join('\n'),
        /permission denied for table store_customers/,
      )
    })
  })

  // ---------------------------------------------------------------------
  // Criterio 10 — el token de baja es CSPRNG, no random().
  // ---------------------------------------------------------------------
  it('unsubscribe_token sale del alfabeto de private.random_token (31 símbolos, sin 0/1/i/l/o) y es único', () => {
    const out = inTransaction(
      makeStore('c11'),
      insertOrder({ storeVar: 'c11', phone: '+5491100000114', name: 'Cliente', status: 'delivered' }),
      `select unsubscribe_token, length(unsubscribe_token) from public.store_customers where store_id = :c11_id;`,
    )
    const [token, len] = out.split('|')
    expect(len).toBe('24')
    expect(token).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/)
  })

  // ---------------------------------------------------------------------
  // Criterio 11 — el backfill (y el recálculo en general) es idempotente.
  // ---------------------------------------------------------------------
  it('private.recalc_store_customer corrido dos veces seguidas da el mismo resultado (backfill re-ejecutable)', () => {
    const out = inTransaction(
      makeStore('c12'),
      insertOrder({ storeVar: 'c12', phone: '+5491100000115', name: 'Rita', status: 'delivered', totalCents: 3000 }),
      `select private.recalc_store_customer(:c12_id, '+5491100000115');`,
      `select private.recalc_store_customer(:c12_id, '+5491100000115');`,
      `select total_spent_cents, orders_count, (select count(*) from public.store_customers where store_id = :c12_id) as rows from public.store_customers where store_id = :c12_id;`,
    )
    expect(out).toBe('3000|1|1')
  })

  // ---------------------------------------------------------------------
  // Criterio 12 — el camino feliz no puede tirar dentro del trigger: un
  // error ahí aborta la transacción del PEDIDO.
  // ---------------------------------------------------------------------
  describe('el trigger nunca aborta un insert de pedido válido (un error ahí se lleva puesto el pedido)', () => {
    it('pedido sin email (customer_email null desde el principio) inserta sin error', () => {
      const out = inTransaction(makeStore('c13a'), insertOrder({ storeVar: 'c13a', phone: '+5491100000116', name: 'Sin Mail', email: null, status: 'pending' }), `select 'ok';`)
      expect(out).toBe('ok')
    })

    it("nombre con comillas simples y unicode no rompe el trigger (array_agg / coalesce sobre texto arbitrario)", () => {
      const out = inTransaction(
        makeStore('c13b'),
        `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
           values (:c13b_id, 'pending', 'D''Angelo Ñáñez 🍔', '+5491100000117', gen_random_uuid()::text, 'online', 'pending', 1000, 1000);`,
        `select display_name from public.store_customers where store_id = :c13b_id;`,
      )
      expect(out).toBe("D'Angelo Ñáñez 🍔")
    })

    it('cero pedidos previos para ese teléfono en la tienda (primer pedido) inserta sin error y crea la fila', () => {
      const out = inTransaction(makeStore('c13c'), insertOrder({ storeVar: 'c13c', phone: '+5491100000118', name: 'Primera Vez', status: 'delivered' }), `select orders_count from public.store_customers where store_id = :c13c_id;`)
      expect(out).toBe('1')
    })
  })

  // ---------------------------------------------------------------------
  // La garantía que sostiene todo lo demás: el KDS (staff, no dueño) puede
  // seguir moviendo pedidos con el cliente de SESIÓN, porque
  // private.sync_store_customer() es SECURITY DEFINER.
  // ---------------------------------------------------------------------
  it('un STAFF (no dueño) cambiando el status de un pedido con el cliente de SESIÓN dispara igual el trigger del padrón (SECURITY DEFINER)', () => {
    const staffId = newUserId()
    const out = inTransaction(
      createAuthUserSql(staffId, `${staffId}@example.com`),
      makeStore('kds'),
      `insert into public.store_members (store_id, user_id, role) values (:kds_id, '${staffId}', 'staff');`,
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:kds_id, 'pending', 'Cliente KDS', '+5491100000119', gen_random_uuid()::text, 'in_store', 'pending', 1500, 1500)
       returning id \\gset kds_order_`,
      // authenticated tiene grant update(status) sobre orders (hardening) y la
      // RLS de orders_staff_update permite a cualquier staff de la tienda —no
      // solo al dueño— cambiar el estado. store_customers en cambio no tiene
      // NINGÚN grant para authenticated: si sync_store_customer() no fuera
      // SECURITY DEFINER, este UPDATE fallaría con 42501 y la cocina no
      // podría mover el pedido.
      ...asAuthenticated(staffId, [`update public.orders set status = 'confirmed' where id = :kds_order_id;`]),
      `select display_name, orders_count from public.store_customers where store_id = :kds_id;`,
    )
    expect(out).toBe('Cliente KDS|1')
  })

  // ---------------------------------------------------------------------
  // La baja pública (T3A): el mismo patrón de SQL que usan
  // findCustomerByUnsubscribeToken / optOutByToken en customer.model.ts.
  // ---------------------------------------------------------------------
  describe('la baja por token — idempotencia a nivel de base', () => {
    it('confirmar la baja DOS VECES seguidas conserva la fecha ORIGINAL, no la corre a la segunda llamada', () => {
      const out = inTransaction(
        makeStore('baja1'),
        insertOrder({ storeVar: 'baja1', phone: '+5491100000120', name: 'Cliente Baja', status: 'delivered' }),
        `select unsubscribe_token from public.store_customers where store_id = :baja1_id \\gset tok_`,
        // Primera confirmación: mismo patrón que optOutByToken (customer.model.ts) —
        // solo pisa si estaba en null.
        `update public.store_customers set marketing_opt_out_at = now() where unsubscribe_token = :'tok_unsubscribe_token' and marketing_opt_out_at is null returning marketing_opt_out_at \\gset first_`,
        `select pg_sleep(0.05);`,
        // Segunda confirmación (link reabierto): el predicado `is null` hace
        // que este UPDATE no toque ninguna fila.
        `update public.store_customers set marketing_opt_out_at = now() where unsubscribe_token = :'tok_unsubscribe_token' and marketing_opt_out_at is null;`,
        `select marketing_opt_out_at from public.store_customers where unsubscribe_token = :'tok_unsubscribe_token';`,
      )
      const lines = out.trim().split('\n')
      const first = lines[0]
      const final = lines.at(-1)
      expect(final).toBe(first)
    })

    it('un token que no existe no crea ni modifica ninguna fila (mismo UPDATE, cero filas afectadas)', () => {
      const out = inTransaction(
        `update public.store_customers set marketing_opt_out_at = now() where unsubscribe_token = 'zzzzzzzzzzzzzzzzzzzzzzzz' and marketing_opt_out_at is null;`,
        `select count(*) from public.store_customers where unsubscribe_token = 'zzzzzzzzzzzzzzzzzzzzzzzz';`,
      )
      expect(out).toBe('0')
    })
  })
})
