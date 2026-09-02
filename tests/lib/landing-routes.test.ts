import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/app/robots.ts` y `src/app/sitemap.ts` derivan todo de `apexUrl`, que
 * lee `clientEnv` al importarse — mismo patrón que `tests/lib/urls.test.ts`
 * y `tests/lib/seo.test.ts`: hay que fijar `NEXT_PUBLIC_SITE_URL` ANTES de
 * importar y resetear el registro de módulos entre casos, o el resultado
 * depende de qué test corrió antes en el mismo worker.
 */
vi.mock('server-only', () => ({}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
}

const ENV_KEYS = [...Object.keys(BASE_ENV), 'NEXT_PUBLIC_SITE_URL']
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadRobots(siteUrl: string) {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SITE_URL = siteUrl
  const { default: robots } = await import('@/app/robots')
  return robots()
}

async function loadSitemap(siteUrl: string) {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SITE_URL = siteUrl
  const { default: sitemap } = await import('@/app/sitemap')
  return sitemap()
}

/** `rules` puede venir como objeto único o como array; normalizamos a array. */
function disallowList(result: Awaited<ReturnType<typeof loadRobots>>): string[] {
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  return rules.flatMap((r) => {
    if (!r.disallow) return []
    return Array.isArray(r.disallow) ? r.disallow : [r.disallow]
  })
}

describe('robots.ts', () => {
  it('Disallow cubre /admin, /backoffice, /repartidor, /api y /pedido', async () => {
    const result = await loadRobots('https://comandapp.ar')
    const disallow = disallowList(result)

    for (const path of ['/admin', '/backoffice', '/repartidor', '/api', '/pedido']) {
      expect(disallow, `falta ${path} en Disallow`).toContain(path)
    }
  })

  it('/pedido especialmente: son URLs de UN pedido con token de acceso en el path, no contenido para indexar', async () => {
    const result = await loadRobots('https://comandapp.ar')
    expect(disallowList(result)).toContain('/pedido')
  })

  it('el sitemap declarado deriva del origen configurado, no de un dominio hardcodeado', async () => {
    const result = await loadRobots('https://otro-dominio.test')
    expect(result.sitemap).toBe('https://otro-dominio.test/sitemap.xml')
  })
})

describe('sitemap.ts', () => {
  it('todas las URLs cuelgan del origen de NEXT_PUBLIC_SITE_URL, no de comandapp.ar a mano', async () => {
    const entries = await loadSitemap('https://otro-dominio.test')

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.url.startsWith('https://otro-dominio.test')).toBe(true)
    }
  })

  it('lista la raíz y las dos páginas legales', async () => {
    const entries = await loadSitemap('https://comandapp.ar')
    const urls = entries.map((e) => e.url)

    expect(urls).toContain('https://comandapp.ar')
    expect(urls).toContain('https://comandapp.ar/legal/terminos')
    expect(urls).toContain('https://comandapp.ar/legal/privacidad')
  })
})
