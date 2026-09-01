import { describe, expect, it } from 'vitest'
import { asAuthenticated, createAuthUserSql, dbAvailable, expectSqlToFail, inTransaction, newUserId, uniqueSlug } from './helpers'

/**
 * `public.campaign_segment_preview` — los cuatro conteos del segmento, antes
 * de mandar nada. Es `SECURITY DEFINER` pero verifica `is_store_owner()`
 * leyendo `auth.uid()`, así que TODOS los casos que representan una llamada
 * legítima van con `asAuthenticated(ownerId, ...)`: llamarla con el admin
 * client (sin sesión) falla siempre, y eso también se prueba acá abajo.
 */
describe.skipIf(!dbAvailable)('public.campaign_segment_preview', () => {
  function ownerStoreFixture(prefix: string, ownerId: string) {
    return [
      createAuthUserSql(ownerId, `${prefix}@test.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug(prefix)}', 'Tienda ${prefix}', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
    ]
  }

  function customerRow(phone: string, name: string, email: string | null, spentCents: number, optedOut = false) {
    const emailVal = email ? `'${email}'` : 'null'
    const optedOutVal = optedOut ? 'now()' : 'null'
    return `insert into public.store_customers (store_id, phone_e164, display_name, email, total_spent_cents, marketing_opt_out_at) values (:store_id, '${phone}', '${name}', ${emailVal}, ${spentCents}, ${optedOutVal});`
  }

  /** Los cuatro conteos, pipe-separated, para no depender de parsear jsonb a mano. */
  function previewCounts(kind: string, topN: number | null, minSpent: number | null) {
    return `select (r->>'inSegment')::int, (r->>'withEmail')::int, (r->>'optedOut')::int, (r->>'willSend')::int
      from (select public.campaign_segment_preview(:store_id, '${kind}', ${topN ?? 'null'}, ${minSpent ?? 'null'}) as r) x;`
  }

  it('segmento "all": mail válido, sin mail, de baja, mail roto, y dos filas que comparten la misma casilla en distinto casing', () => {
    const ownerId = newUserId()
    const out = inTransaction(
      ...ownerStoreFixture('csp-all', ownerId),
      customerRow('+5491100000001', 'C1', 'valid1@test.com', 100),
      customerRow('+5491100000002', 'C2', null, 50),
      customerRow('+5491100000003', 'C3', 'valid2@test.com', 30, true),
      // Mail sintácticamente roto (sin @): cuenta en inSegment/withEmail pero
      // NO en willSend, porque looks_like_email lo filtra ahí. withEmail NO
      // valida formato — solo `email is not null` — así que un mail roto
      // pero no-null SÍ suma a withEmail. Es el comportamiento real de la
      // RPC, no lo que "debería" ser.
      customerRow('+5491100000004', 'C4', 'no-arroba-nada', 20),
      customerRow('+5491100000005', 'C5', 'Juan@Test.com', 10),
      // Misma casilla que C5, distinto casing: cuenta 2 veces en
      // inSegment/withEmail pero UNA sola vez en willSend (distinct
      // lower(trim(email))).
      customerRow('+5491100000006', 'C6', 'juan@test.com', 5),
      ...asAuthenticated(ownerId, [previewCounts('all', null, null)]),
    )
    // inSegment=6 (los 6 clientes), withEmail=5 (todos menos C2),
    // optedOut=1 (C3), willSend=2 (valid1@test.com + juan@test.com deduplicado).
    expect(out).toBe('6|5|1|2')
  })

  it('segmento "top_n": solo entran los N de mayor gasto — un cliente fuera del top no cuenta en willSend', () => {
    const ownerId = newUserId()
    const out = inTransaction(
      ...ownerStoreFixture('csp-topn', ownerId),
      customerRow('+5491100000011', 'A', 'a@test.com', 500),
      customerRow('+5491100000012', 'B', 'b@test.com', 400),
      customerRow('+5491100000013', 'C', 'c@test.com', 300),
      customerRow('+5491100000014', 'D', 'd@test.com', 200),
      // El de menor gasto, con mail válido, queda AFUERA del top_n=2.
      customerRow('+5491100000015', 'E', 'e@test.com', 100),
      ...asAuthenticated(ownerId, [previewCounts('top_n', 2, null)]),
    )
    expect(out).toBe('2|2|0|2')
  })

  it('segmento "min_spent": el borde es inclusivo (>=) — exactamente el mínimo entra, uno menos no', () => {
    const ownerId = newUserId()
    const out = inTransaction(
      ...ownerStoreFixture('csp-minspent', ownerId),
      customerRow('+5491100000021', 'A', 'a@test.com', 1000),
      customerRow('+5491100000022', 'B', 'b@test.com', 999),
      ...asAuthenticated(ownerId, [previewCounts('min_spent', null, 1000)]),
    )
    expect(out).toBe('1|1|0|1')
  })

  it('la matemática de "17 con email · 3 de baja · se manda a 14" cierra exacto sin mails rotos de por medio', () => {
    const ownerId = newUserId()
    const rows: string[] = []
    for (let i = 1; i <= 17; i++) {
      const optedOut = i <= 3
      rows.push(customerRow(`+549110000${String(1000 + i).slice(1)}`, `C${i}`, `c${i}@test.com`, i, optedOut))
    }
    const out = inTransaction(
      ...ownerStoreFixture('csp-math', ownerId),
      ...rows,
      ...asAuthenticated(ownerId, [previewCounts('all', null, null)]),
    )
    expect(out).toBe('17|17|3|14')
  })

  it('el dueño de OTRA tienda, pidiendo SU propia tienda vacía, no ve nada de la primera — sin fuga entre tiendas', () => {
    const ownerAId = newUserId()
    const ownerBId = newUserId()
    const out = inTransaction(
      ...ownerStoreFixture('csp-leak-a', ownerAId),
      customerRow('+5491100000031', 'A', 'a@test.com', 100),
      createAuthUserSql(ownerBId, 'csp-leak-b@test.com'),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('csp-leak-b')}', 'Tienda B', 'active') returning id \\gset storeb_`,
      `insert into public.store_members (store_id, user_id, role) values (:storeb_id, '${ownerBId}', 'owner');`,
      ...asAuthenticated(ownerBId, [
        `select (r->>'inSegment')::int, (r->>'withEmail')::int, (r->>'optedOut')::int, (r->>'willSend')::int
           from (select public.campaign_segment_preview(:storeb_id, 'all', null, null) as r) x;`,
      ]),
    )
    expect(out).toBe('0|0|0|0')
  })

  it('el dueño de la tienda A pidiendo el store_id de la tienda B (que no es suya) rechaza con 42501', () => {
    const ownerAId = newUserId()
    const ownerBId = newUserId()
    expectSqlToFail(
      [
        ...ownerStoreFixture('csp-cross-a', ownerAId),
        createAuthUserSql(ownerBId, 'csp-cross-b@test.com'),
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('csp-cross-b')}', 'Tienda B', 'active') returning id \\gset storeb_`,
        `insert into public.store_members (store_id, user_id, role) values (:storeb_id, '${ownerBId}', 'owner');`,
        ...asAuthenticated(ownerAId, [`select public.campaign_segment_preview(:storeb_id, 'all', null, null);`]),
      ].join('\n'),
      /solo el dueno del local manda campanas/,
    )
  })

  it('llamada con service_role (sin auth.uid()) falla siempre — la trampa que documenta previewSegment en campaign.model.ts', () => {
    expectSqlToFail(
      [
        ...ownerStoreFixture('csp-svc', newUserId()),
        // Sin asAuthenticated: corre como postgres/service_role, auth.uid() es null.
        `select public.campaign_segment_preview(:store_id, 'all', null, null);`,
      ].join('\n'),
      /solo el dueno del local manda campanas/,
    )
  })

  it('un STAFF (no owner) de la tienda no puede armar campañas — is_store_owner, no is_store_member', () => {
    const staffId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(staffId, 'csp-staff@test.com'),
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('csp-staff')}', 'Tienda', 'active') returning id \\gset store_`,
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${staffId}', 'staff');`,
        ...asAuthenticated(staffId, [`select public.campaign_segment_preview(:store_id, 'all', null, null);`]),
      ].join('\n'),
      /solo el dueno del local manda campanas/,
    )
  })

  it('un kind desconocido rechaza con check_violation', () => {
    const ownerId = newUserId()
    expectSqlToFail(
      [
        ...ownerStoreFixture('csp-badkind', ownerId),
        ...asAuthenticated(ownerId, [`select public.campaign_segment_preview(:store_id, 'bogus', null, null);`]),
      ].join('\n'),
      /segmento desconocido/,
    )
  })

  it('"top_n" sin p_top_n (o con 0/negativo) rechaza con el mensaje del N positivo', () => {
    const ownerId = newUserId()
    const fixture = ownerStoreFixture('csp-topn-bad', ownerId)
    for (const topN of [null, 0, -1]) {
      expectSqlToFail(
        [...fixture, ...asAuthenticated(ownerId, [previewCounts('top_n', topN, null)])].join('\n'),
        /el segmento top_n necesita un N positivo/,
      )
    }
  })
})
