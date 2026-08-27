import { describe, expect, it } from 'vitest'
import { createStoreInputSchema, RESERVED_SLUGS, storeStatusSchema } from '@/models/schemas/platform.schema'

describe('createStoreInputSchema — alta de tienda desde el backoffice de plataforma', () => {
  function valid() {
    return {
      slug: 'la-birra',
      name: 'La Birra',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      ownerEmail: 'dueno@example.com',
    }
  }

  it('un alta bien formada pasa', () => {
    expect(createStoreInputSchema.safeParse(valid()).success).toBe(true)
  })

  it('el slug se normaliza a minúsculas', () => {
    const result = createStoreInputSchema.safeParse({ ...valid(), slug: 'La-Birra' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.slug).toBe('la-birra')
  })

  it('un slug con espacios o mayúsculas sueltas fuera de forma se rechaza', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: 'la birra' }).success).toBe(false)
  })

  it('un slug con guion bajo se rechaza: solo minúsculas, números y guion medio', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: 'la_birra' }).success).toBe(false)
  })

  it('un slug que empieza o termina en guion se rechaza', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: '-la-birra' }).success).toBe(false)
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: 'la-birra-' }).success).toBe(false)
  })

  it('un slug de un solo carácter falla (mínimo 2)', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: 'x' }).success).toBe(false)
  })

  it('ownerEmail inválido falla: sin un dueño identificable no hay a quién mandarle el magic link', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), ownerEmail: 'no-es-un-email' }).success).toBe(false)
  })
})

describe('storeStatusSchema', () => {
  it('solo admite active o suspended', () => {
    expect(storeStatusSchema.safeParse('active').success).toBe(true)
    expect(storeStatusSchema.safeParse('suspended').success).toBe(true)
    expect(storeStatusSchema.safeParse('deleted').success).toBe(false)
  })
})

/**
 * Lista negra de slugs reservados (S-01/roadmap de subdominios en CLAUDE.md):
 * hoy el segmento estático de Next le gana a `[store]`, así que una tienda con
 * slug `admin` queda inalcanzable; con subdominios pasa a ser secuestro de
 * ruta. La lista está duplicada a propósito en el CHECK
 * `stores_slug_not_reserved_check` (`20260826120000_hardening.sql`): la base
 * es la que garantiza que no entre por ningún camino, y este schema es el que
 * hace que el dueño reciba un mensaje que se entiende en vez del texto de una
 * constraint de Postgres.
 */
describe('createStoreInputSchema — lista negra de slugs reservados', () => {
  function valid() {
    return {
      slug: 'la-birra',
      name: 'La Birra',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      ownerEmail: 'dueno@example.com',
    }
  }

  it.each(['admin', 'api', 'backoffice', 'pedido', 'mis-pedidos'])('rechaza el slug reservado "%s"', (slug) => {
    const result = createStoreInputSchema.safeParse({ ...valid(), slug })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Esa dirección está reservada por la plataforma: elegí otra')
    }
  })

  it('acepta un slug que NO está en la lista negra', () => {
    expect(createStoreInputSchema.safeParse({ ...valid(), slug: 'la-birra' }).success).toBe(true)
  })

  // OJO: "_next" está en RESERVED_SLUGS, pero el guion bajo no pasa el regex
  // de forma (`slugSchema` solo admite minúsculas, números y guion medio), así
  // que ahí rebota ANTES de llegar al `.refine()` de la lista negra. El
  // mensaje que recibe el dueño es el de forma, no el de "reservada".
  it('"_next" está en la lista negra, pero lo rechaza antes la regla de forma (guion bajo)', () => {
    expect(RESERVED_SLUGS as readonly string[]).toContain('_next')
    const result = createStoreInputSchema.safeParse({ ...valid(), slug: '_next' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).not.toBe('Esa dirección está reservada por la plataforma: elegí otra')
      expect(result.error.issues[0]?.message).toBe('El slug tiene que ser minúsculas, números y guiones, por ejemplo mi-local')
    }
  })
})
