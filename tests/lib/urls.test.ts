import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/lib/urls.ts` — T4 de `docs/pipelines/2026-08-29-subdominio-por-local/`.
 * Es la autoridad de URLs del subdominio por local, y con el flujo local de
 * subdominios fuera de alcance (`00-architecture.md` §2.6), este archivo es
 * la única verificación previa a producción para `apexUrl`/`storeUrl`/
 * `parseStoreHost`/`storeBasePath` — se escriben los 8 criterios completos,
 * no una muestra.
 *
 * Es un módulo isomórfico que lee `clientEnv`, y `clientEnv` se parsea UNA
 * sola vez al importar el módulo (top-level, sin función de caché explícita
 * como `serverEnv()`). Para poder alternar `NEXT_PUBLIC_SITE_URL` y
 * `NEXT_PUBLIC_STORE_HOST_MODE` entre tests hace falta `vi.resetModules()` +
 * `import()` dinámico por caso — mismo patrón que
 * `tests/services/owner-invite-email.adapter.test.ts`.
 */
vi.mock('server-only', () => ({}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
}

const ENV_KEYS = [...Object.keys(BASE_ENV), 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_STORE_HOST_MODE'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadUrls(env: { siteUrl: string; hostMode?: 'subdomain' | 'path' }) {
  vi.resetModules()
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  process.env.NEXT_PUBLIC_SITE_URL = env.siteUrl
  if (env.hostMode === undefined) delete process.env.NEXT_PUBLIC_STORE_HOST_MODE
  else process.env.NEXT_PUBLIC_STORE_HOST_MODE = env.hostMode
  return import('@/lib/urls')
}

describe('storeUrl / apexUrl — criterios 1-4 y 8', () => {
  it('1. modo path + apex https://comandapp.ar: storeUrl da <apex>/<slug><path>', async () => {
    const { storeUrl } = await loadUrls({ siteUrl: 'https://comandapp.ar', hostMode: 'path' })
    expect(storeUrl('la-birra', '/pedido/x')).toBe('https://comandapp.ar/la-birra/pedido/x')
  })

  it('2. modo subdomain + mismo apex: storeUrl da https://<slug>.comandapp.ar<path>', async () => {
    const { storeUrl } = await loadUrls({ siteUrl: 'https://comandapp.ar', hostMode: 'subdomain' })
    expect(storeUrl('la-birra', '/pedido/x')).toBe('https://la-birra.comandapp.ar/pedido/x')
  })

  it('3. modo path + apex http://localhost:3000: SIN CAMBIOS respecto de hoy (caso de desarrollo)', async () => {
    const { storeUrl } = await loadUrls({ siteUrl: 'http://localhost:3000', hostMode: 'path' })
    expect(storeUrl('la-birra', '/carrito')).toBe('http://localhost:3000/la-birra/carrito')
  })

  it('4. apexUrl NUNCA devuelve un host de tienda, en NINGÚN modo', async () => {
    const path = await loadUrls({ siteUrl: 'https://comandapp.ar', hostMode: 'path' })
    const sub = await loadUrls({ siteUrl: 'https://comandapp.ar', hostMode: 'subdomain' })
    expect(path.apexUrl('/admin')).toBe('https://comandapp.ar/admin')
    expect(sub.apexUrl('/admin')).toBe('https://comandapp.ar/admin') // no cambia con el modo
  })

  it('8a. storeUrl conserva protocolo Y puerto del apex en modo subdomain', async () => {
    const { storeUrl } = await loadUrls({ siteUrl: 'http://localhost:3000', hostMode: 'subdomain' })
    expect(storeUrl('la-birra', '/x')).toBe('http://la-birra.localhost:3000/x')
  })

  it('8b. ni storeUrl ni apexUrl producen doble barra, y la query string viaja intacta', async () => {
    const { storeUrl, apexUrl } = await loadUrls({ siteUrl: 'https://comandapp.ar', hostMode: 'path' })
    expect(storeUrl('la-birra', '/carrito?x=1&y=2')).toBe('https://comandapp.ar/la-birra/carrito?x=1&y=2')
    expect(apexUrl('/')).toBe('https://comandapp.ar') // raíz: no cuelga un "/" de más
    expect(apexUrl('')).toBe('https://comandapp.ar')
    expect(apexUrl('/admin/')).not.toContain('//admin') // sin doble barra en medio
  })

  it('7. sin NEXT_PUBLIC_STORE_HOST_MODE seteada, se comporta como "path" — no tira', async () => {
    const { storeUrl } = await loadUrls({ siteUrl: 'https://comandapp.ar' }) // hostMode omitido
    expect(storeUrl('la-birra', '/x')).toBe('https://comandapp.ar/la-birra/x')
  })
})

describe('parseStoreHost — criterio 5 (los 7 casos + los 2 que más importan)', () => {
  it('la-birra.comandapp.ar → "la-birra"', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('la-birra.comandapp.ar')).toBe('la-birra')
  })

  it('comandapp.ar (el apex mismo) → null', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('comandapp.ar')).toBeNull()
  })

  it('www.comandapp.ar → null (www es slug reservado)', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('www.comandapp.ar')).toBeNull()
  })

  it('localhost:3000 → null (con puerto, y el apex local es "localhost")', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'http://localhost:3000' })
    expect(parseStoreHost('localhost:3000')).toBeNull()
  })

  it('proyecto-abc-scope.vercel.app (preview) → null', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('proyecto-abc-scope.vercel.app')).toBeNull()
  })

  it('a.b.comandapp.ar (multinivel) → null — un slug es siempre UNA sola etiqueta', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('a.b.comandapp.ar')).toBeNull()
  })

  it('null → null', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost(null)).toBeNull()
  })

  /**
   * Los dos casos que MÁS importan (spec del orquestador): un host que
   * contiene el apex como SUFIJO de un dominio ajeno, y uno que lo contiene
   * como PREFIJO de texto sin ser un subdominio real. Si `parseStoreHost`
   * usara un `includes()` o un regex sin anclar, los dos serían un bypass:
   * un atacante registraría cualquiera de los dos dominios y su página se
   * confundiría con un subdominio legítimo de la plataforma.
   */
  it('comandapp.ar.evil.com → null (el apex como SUFIJO de un dominio ajeno — no es un subdominio nuestro)', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('comandapp.ar.evil.com')).toBeNull()
  })

  it('evilcomandapp.ar → null (el apex pegado como sufijo de TEXTO, sin el punto que separa un subdominio real)', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('evilcomandapp.ar')).toBeNull()
  })

  it('host vacío ("") → null', async () => {
    const { parseStoreHost } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(parseStoreHost('')).toBeNull()
  })
})

describe('storeBasePath — criterio 6 (los 4 casos, incluido "host de otra tienda")', () => {
  it('storeBasePath("la-birra", "la-birra.comandapp.ar") → "" (el rewrite ya puso al usuario en el árbol correcto)', async () => {
    const { storeBasePath } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(storeBasePath('la-birra', 'la-birra.comandapp.ar')).toBe('')
  })

  it('storeBasePath("la-birra", "comandapp.ar") → "/la-birra" (apex, path-based)', async () => {
    const { storeBasePath } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(storeBasePath('la-birra', 'comandapp.ar')).toBe('/la-birra')
  })

  it('storeBasePath("la-birra", "localhost:3000") → "/la-birra" (desarrollo local, sin cambios)', async () => {
    const { storeBasePath } = await loadUrls({ siteUrl: 'http://localhost:3000' })
    expect(storeBasePath('la-birra', 'localhost:3000')).toBe('/la-birra')
  })

  it('storeBasePath("la-birra", "otra.comandapp.ar") → "/la-birra" — un host de OTRA tienda no se asume vacío', async () => {
    const { storeBasePath } = await loadUrls({ siteUrl: 'https://comandapp.ar' })
    expect(storeBasePath('la-birra', 'otra.comandapp.ar')).toBe('/la-birra')
  })
})
