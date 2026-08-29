import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS } from '@/models/schemas/platform.schema'
import { dbAvailable, expectSqlToFail, sql } from './helpers'

/**
 * Paridad `RESERVED_SLUGS` (TypeScript) ↔ `stores_slug_not_reserved_check`
 * (Postgres) — mismo patrón que el test que compara `ALLOWED_TRANSITIONS`
 * contra `private.enforce_order_rules` (CLAUDE.md). Existe porque hoy son
 * idénticas —verificado a mano— pero eso es un hecho de HOY: sin este test,
 * el día que alguien agregue un slug reservado de un solo lado (el típico
 * "ya lo puse en el schema, ya está"), la lista diverge en silencio y el
 * riesgo que describe la migración —un slug de tienda choca con un registro
 * DNS de la plataforma— vuelve a estar abierto.
 */
describe.skipIf(!dbAvailable)('RESERVED_SLUGS (TypeScript) ↔ stores_slug_not_reserved_check (Postgres)', () => {
  function reservedSlugsFromConstraint(): string[] {
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'stores_slug_not_reserved_check';`,
    )
    const matches = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1])
    if (matches.length === 0) {
      throw new Error(`No se pudo parsear la definición del CHECK. Definición cruda: ${def}`)
    }
    return matches
  }

  it('el conjunto es IDÉNTICO — mismos elementos, sin importar orden (falla si diverge)', () => {
    const fromDb = new Set(reservedSlugsFromConstraint())
    const fromTs = new Set(RESERVED_SLUGS as readonly string[])

    const soloEnDb = [...fromDb].filter((s) => !fromTs.has(s)).sort()
    const soloEnTs = [...fromTs].filter((s) => !fromDb.has(s)).sort()

    expect(soloEnDb, 'slugs reservados en Postgres pero no en RESERVED_SLUGS (TypeScript)').toEqual([])
    expect(soloEnTs, 'slugs reservados en RESERVED_SLUGS (TypeScript) pero no en el CHECK de Postgres').toEqual([])
  })

  it('RESERVED_SLUGS no tiene duplicados (si los tuviera, el conteo de arriba podría ocultar una divergencia real)', () => {
    const asArray = RESERVED_SLUGS as readonly string[]
    expect(new Set(asArray).size).toBe(asArray.length)
  })

  it('la constraint rechaza de VERDAD un insert con un slug reservado, con 23514 — no es solo Zod', () => {
    expectSqlToFail(
      `insert into public.stores (slug, name, status) values ('mail', 'Tienda Mail', 'active');`,
      /violates check constraint "stores_slug_not_reserved_check"/,
    )
  })

  it('un slug NUEVO de la lista (agregado en la migración de subdominio) también rebota — no solo los históricos', () => {
    expectSqlToFail(
      `insert into public.stores (slug, name, status) values ('webhooks', 'Tienda Webhooks', 'active');`,
      /violates check constraint "stores_slug_not_reserved_check"/,
    )
  })

  it('un slug que solo EMPIEZA como uno reservado (no es exacto) sigue siendo válido — la constraint es de igualdad, no de prefijo', () => {
    // "administracion" no es "admin": si el CHECK usara LIKE en vez de IN,
    // esto rebotaría por error y bloquearía slugs reales.
    const slug = `zz-test-administracion-${Date.now().toString(36)}`
    const out = sql(
      ['begin;', `insert into public.stores (slug, name, status) values ('${slug}', 'Tienda', 'active') returning slug;`, 'rollback;'].join(
        '\n',
      ),
    )
    expect(out).toBe(slug)
  })
})
