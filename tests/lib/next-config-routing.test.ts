import { readdirSync } from 'node:fs'
import path from 'node:path'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { matchHas, prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination'
import { describe, expect, it } from 'vitest'
import config from '../../next.config'

/**
 * `next.config.ts` — routing por host de "subdominio por local" (T3).
 *
 * Con el flujo local de subdominios fuera de alcance
 * (`00-architecture.md` §2.6), **estos tests son la única verificación
 * previa a producción**: nadie va a ejercitar este rewrite antes del primer
 * deploy real con el wildcard DNS andando. Por eso se escriben los 17
 * criterios completos (15 de `01-tasks.md` + 2 del bugfix de anclaje que
 * encontró T3), no una muestra representativa.
 *
 * Nada de esto reimplementa el matching de Next: usa las mismas funciones
 * que corre el framework en producción (`matchHas`, `getPathMatch` sobre
 * `path-to-regexp`, `prepareDestination`), invocadas directo en vez de a
 * través de un servidor HTTP — es "evaluar la config exportada", como pide
 * el criterio de aceptación, no una simulación de cosecha propia.
 */

/** El union real que espera `matchHas`, no una reimplementación: así el tipo
 * de `has`/`missing` de más abajo queda tan estricto como el de Next mismo. */
type RouteHas = NonNullable<Parameters<typeof matchHas>[2]>[number]

type RouteEntry = {
  source: string
  has?: RouteHas[]
  missing?: RouteHas[]
  destination: string
  permanent?: boolean
}

/**
 * `matchHas` solo lee `req.headers.host` (ver el propio código de
 * `prepare-destination.js`) pero está tipado contra `IncomingMessage`
 * completo. Un objeto con la forma real que usa en runtime alcanza — el
 * cast es sobre la FORMA, no sobre el comportamiento bajo prueba.
 */
type MatchHasRequest = Parameters<typeof matchHas>[0]

function reqFor(host: string): MatchHasRequest {
  return { headers: { host } } as MatchHasRequest
}

/** Busca la PRIMERA entrada que matchea host+path+query, y resuelve su destino
 * con la misma función que usa Next (`prepareDestination`). `null` si ninguna. */
function findMatch(entries: RouteEntry[], host: string, pathname: string, query: Record<string, string> = {}) {
  for (const entry of entries) {
    const hasParams = matchHas(reqFor(host), query, entry.has ?? [], entry.missing ?? [])
    if (hasParams === false) continue
    const pathParams = getPathMatch(entry.source)(pathname)
    if (pathParams === false) continue
    const params = { ...hasParams, ...pathParams }
    const { newUrl, parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: entry.destination,
      params,
      query,
    })
    return { entry, pathname: newUrl, hostname: parsedDestination.hostname, protocol: parsedDestination.protocol }
  }
  return null
}

const cfg = config(PHASE_PRODUCTION_BUILD)
const rewriteEntries = (cfg.rewrites as () => { beforeFiles: RouteEntry[] })().beforeFiles
const redirectEntries = (cfg.redirects as () => RouteEntry[])()

describe('next.config.ts — rewrites() vive en beforeFiles (criterio 1, la fase importa tanto como la entrada)', () => {
  it('rewrites() devuelve { beforeFiles: [...] }, NO un array plano — beforeFiles es lo único que puede pisar src/app/page.tsx', () => {
    const raw = (cfg.rewrites as () => unknown)()
    expect(Array.isArray(raw)).toBe(false)
    expect(raw).toHaveProperty('beforeFiles')
    expect(Array.isArray((raw as { beforeFiles: unknown }).beforeFiles)).toBe(true)
  })
})

describe('next.config.ts — rewrite host→path (criterios 1-4)', () => {
  const HOST = 'la-birra.comandapp.ar'

  it('1. host de tienda + "/" → rewrite a /la-birra', () => {
    const match = findMatch(rewriteEntries, HOST, '/')
    expect(match?.pathname).toBe('/la-birra')
  })

  it('2. host de tienda + "/carrito" → /la-birra/carrito', () => {
    const match = findMatch(rewriteEntries, HOST, '/carrito')
    expect(match?.pathname).toBe('/la-birra/carrito')
  })

  it('3. host de tienda + "/producto/42" → /la-birra/producto/42', () => {
    const match = findMatch(rewriteEntries, HOST, '/producto/42')
    expect(match?.pathname).toBe('/la-birra/producto/42')
  })

  it('4. host de tienda + "/checkout" → /la-birra/checkout', () => {
    const match = findMatch(rewriteEntries, HOST, '/checkout')
    expect(match?.pathname).toBe('/la-birra/checkout')
  })
})

describe('next.config.ts — el rewrite NO se lleva puesto nada fuera de las 4 formas (criterio 5)', () => {
  const HOST = 'la-birra.comandapp.ar'
  const untouched = [
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/api/orders',
    '/pedido/abc',
    '/mis-pedidos',
    '/legal/privacidad',
    '/favicon.ico',
  ]

  for (const p of untouched) {
    it(`"${p}" no matchea ningún rewrite (un catch-all se llevaría puesto /_next y rompería la hidratación)`, () => {
      expect(findMatch(rewriteEntries, HOST, p)).toBeNull()
    })
  }
})

describe('next.config.ts — un subdominio de subdominio no es una tienda (criterio 6)', () => {
  it('a.b.comandapp.ar no matchea ningún rewrite (un slug es siempre UNA etiqueta)', () => {
    expect(findMatch(rewriteEntries, 'a.b.comandapp.ar', '/')).toBeNull()
    expect(findMatch(rewriteEntries, 'a.b.comandapp.ar', '/carrito')).toBeNull()
  })
})

describe('next.config.ts — redirect apex path-based → subdominio, 308 (criterios 7-9, 16-17)', () => {
  const APEX = 'comandapp.ar'

  it('7. apex + "/la-birra/carrito" → 308 a https://la-birra.comandapp.ar/carrito', () => {
    const match = findMatch(redirectEntries, APEX, '/la-birra/carrito')
    expect(match?.entry.permanent).toBe(true)
    expect(match?.hostname).toBe('la-birra.comandapp.ar')
    expect(match?.pathname).toBe('/carrito')
  })

  it('8. apex + "/la-birra?preview=brand" → SIN redirect (protege el iframe de vista previa, mismo origen)', () => {
    const match = findMatch(redirectEntries, APEX, '/la-birra', { preview: 'brand' })
    expect(match).toBeNull()
  })

  for (const p of ['/mis-pedidos', '/admin', '/backoffice', '/legal', '/pedido/x', '/repartidor']) {
    it(`9. apex + "${p}" → SIN redirect (no es un slug de tienda)`, () => {
      expect(findMatch(redirectEntries, APEX, p)).toBeNull()
    })
  }

  for (const p of ['/admin/carrito', '/backoffice/checkout', '/api/producto/9']) {
    it(`16. REGRESIÓN DEL BUG DE ANCLAJE: apex + "${p}" → SIN redirect (antes "admin"/"backoffice"/"api" calificaban como slug con un sufijo detrás)`, () => {
      expect(findMatch(redirectEntries, APEX, p)).toBeNull()
    })
  }

  for (const p of ['/administracion', '/pedidos-ya', '/legal-cordobes']) {
    it(`17. la lista de reservados no es "de más": apex + "${p}" (un slug real que solo EMPIEZA como uno reservado) SÍ redirige a su propio subdominio`, () => {
      const match = findMatch(redirectEntries, APEX, p)
      expect(match?.entry.permanent).toBe(true)
      expect(match?.hostname).toBe(`${p.slice(1)}.comandapp.ar`)
    })
  }
})

describe('next.config.ts — redirect tenant → apex para /admin, /backoffice, /repartidor (criterio 12)', () => {
  it('12. host de tienda + "/admin/pedidos" → 308 a https://comandapp.ar/admin/pedidos', () => {
    const match = findMatch(redirectEntries, 'la-birra.comandapp.ar', '/admin/pedidos')
    expect(match?.entry.permanent).toBe(true)
    expect(match?.hostname).toBe('comandapp.ar')
    expect(match?.pathname).toBe('/admin/pedidos')
  })

  it('host de tienda + "/backoffice/tiendas/1" → 308 al apex', () => {
    const match = findMatch(redirectEntries, 'la-birra.comandapp.ar', '/backoffice/tiendas/1')
    expect(match?.hostname).toBe('comandapp.ar')
  })

  it('host de tienda + "/repartidor" → 308 al apex', () => {
    const match = findMatch(redirectEntries, 'la-birra.comandapp.ar', '/repartidor')
    expect(match?.hostname).toBe('comandapp.ar')
  })
})

describe('next.config.ts — preview deployments y localhost quedan INERTES (criterios 10-11)', () => {
  it('10. host de preview (*.vercel.app) + "/la-birra/carrito": ni rewrite ni redirect — path-based intacto', () => {
    const HOST = 'proyecto-abc-scope.vercel.app'
    expect(findMatch(rewriteEntries, HOST, '/la-birra/carrito')).toBeNull()
    expect(findMatch(redirectEntries, HOST, '/la-birra/carrito')).toBeNull()
  })

  it('11. host "localhost" + "/la-birra/carrito": ni rewrite ni redirect — el desarrollo local no cambió', () => {
    expect(findMatch(rewriteEntries, 'localhost', '/la-birra/carrito')).toBeNull()
    expect(findMatch(redirectEntries, 'localhost', '/la-birra/carrito')).toBeNull()
  })
})

describe('next.config.ts — previewFrameHeaders() y el redirect apex→subdominio comparten el MISMO criterio de "reservado" (criterio 13)', () => {
  /**
   * No se puede leer la constante `NOT_RESERVED_STORE_SEGMENT` desde afuera
   * (no está exportada — a propósito, es un detalle interno del módulo), así
   * que se prueba lo que de verdad importa: que las DOS superficies que la
   * comparten (el redirect de acá y `previewFrameHeaders()`) tratan la MISMA
   * lista de palabras reservadas de forma IDÉNTICA. Si algún día alguien le
   * agrega una copia separada a cualquiera de las dos, este test detecta la
   * divergencia por comportamiento, que es lo único observable desde fuera
   * del archivo.
   */
  type HeaderEntry = {
    source: string
    has?: RouteHas[]
    headers: Array<{ key: string; value: string }>
  }

  async function headerEntries() {
    const raw = await (cfg.headers as () => Promise<HeaderEntry[]>)()
    return raw.filter((h) => h.has?.some((cond) => cond.type === 'query' && cond.key === 'preview'))
  }

  it('las 4 fuentes del carve-out de headers excluyen exactamente las mismas palabras que el redirect', async () => {
    const previewHeaderSources = await headerEntries()
    const reservedWords = ['admin', 'backoffice', 'api', 'mis-pedidos', 'pedido', 'legal', 'repartidor']

    for (const word of reservedWords) {
      const redirectMatch = findMatch(redirectEntries, 'comandapp.ar', `/${word}`)
      const headerMatch = previewHeaderSources.some(
        (h) => getPathMatch(h.source)(`/${word}`) !== false && matchHas(reqFor('comandapp.ar'), { preview: 'brand' }, h.has ?? [], []) !== false,
      )
      expect(redirectMatch, `"${word}" no debería activar el redirect apex→subdominio`).toBeNull()
      expect(headerMatch, `"${word}" no debería activar el carve-out de frame-ancestors`).toBe(false)
    }

    // Y un slug real que solo EMPIEZA igual sí activa las dos superficies —
    // confirma que no divergieron hacia "de más" tampoco.
    const realSlug = 'administracion'
    const redirectMatchReal = findMatch(redirectEntries, 'comandapp.ar', `/${realSlug}`)
    const headerMatchReal = previewHeaderSources.some(
      (h) =>
        getPathMatch(h.source)(`/${realSlug}`) !== false &&
        matchHas(reqFor('comandapp.ar'), { preview: 'brand' }, h.has ?? [], []) !== false,
    )
    expect(redirectMatchReal).not.toBeNull()
    expect(headerMatchReal).toBe(true)
  })
})

describe('next.config.ts — cobertura: cada ruta real bajo src/app/[store]/ tiene su entrada en el rewrite (criterio 14)', () => {
  function collectStoreRoutes(): string[] {
    const root = path.join(process.cwd(), 'src/app/[store]')
    const routes: string[] = []
    function walk(dir: string, segments: string[]) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const seg = entry.name.startsWith('[') && entry.name.endsWith(']') ? `:${entry.name.slice(1, -1)}` : entry.name
          walk(path.join(dir, entry.name), [...segments, seg])
        } else if (entry.name === 'page.tsx') {
          routes.push(segments.length === 0 ? '/' : `/${segments.join('/')}`)
        }
      }
    }
    walk(root, [])
    return routes
  }

  it('toda ruta real bajo src/app/[store]/ (page.tsx) tiene una entrada `source`+`destination` en rewrites().beforeFiles', () => {
    const routes = collectStoreRoutes()
    expect(routes.length).toBeGreaterThan(0) // que el propio test no esté vacío por un cambio de estructura

    for (const route of routes) {
      const expectedDestination = route === '/' ? '/:slug' : `/:slug${route}`
      const found = rewriteEntries.some((e) => e.source === route && e.destination === expectedDestination)
      expect(found, `Falta entrada de rewrite para la ruta real "${route}" (se esperaba destination "${expectedDestination}")`).toBe(
        true,
      )
    }
  })

  it('rewrites().beforeFiles no tiene una entrada de MÁS que no corresponda a ninguna ruta real (detecta una entrada vieja que quedó huérfana)', () => {
    const routes = new Set(collectStoreRoutes())
    for (const entry of rewriteEntries) {
      expect(routes.has(entry.source), `La entrada de rewrite "${entry.source}" no tiene una page.tsx real bajo src/app/[store]/`).toBe(
        true,
      )
    }
  })
})

describe('next.config.ts — allowedDevOrigins no cambió (criterio 15)', () => {
  it('sigue siendo exactamente la lista de siempre — un cambio acá afecta qué LAN puede hidratar en dev', () => {
    expect(cfg.allowedDevOrigins).toEqual(['127.0.0.1', '192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'])
  })
})
