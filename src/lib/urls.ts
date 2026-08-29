import { RESERVED_SLUGS } from '@/models/schemas/platform.schema'
import { clientEnv } from './env.client'

/**
 * Autoridad de URLs del subdominio por local (`comandapp.ar` →
 * `<slug>.comandapp.ar`). Ver `docs/pipelines/2026-08-29-subdominio-por-local/`.
 *
 * Isomórfico a propósito: lee `clientEnv`, no `serverEnv()`. Las dos variables
 * que usa (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_STORE_HOST_MODE`) ya son
 * públicas — se inlinean en el bundle del browser igual — así que exigir
 * `server-only` acá solo le negaría este módulo a las Client Components que
 * arman un `href` interno (T6/T7), sin ganar nada a cambio.
 *
 * Separación de responsabilidad, y por qué son dos funciones y no una:
 * - `apexUrl` es el origen de la PLATAFORMA (panel, callbacks de auth, webhook
 *   de MP). Nunca depende del modo de host: el apex es el apex siempre.
 * - `storeUrl` es el origen de UNA TIENDA, y ahí sí importa el modo: en
 *   `subdomain` es `<slug>.<host del apex>`, en `path` es `<apex>/<slug>`.
 * Mezclar las dos en una sola función con un flag fue tentador y se descartó:
 * el call site de un `back_url` de Mercado Pago no debería poder pasar el
 * flag equivocado y mandar al cliente al panel por accidente.
 */

/** Origen del apex (protocolo + host + puerto), sin trailing slash ni path. */
function apexOrigin(): URL {
  // `new URL(...)` normaliza: si alguna vez `NEXT_PUBLIC_SITE_URL` trae un path
  // o una barra de más a mano en el `.env`, acá se descarta — el origen nunca
  // se contamina con eso.
  return new URL(clientEnv.NEXT_PUBLIC_SITE_URL)
}

function hostMode(): 'subdomain' | 'path' {
  return clientEnv.NEXT_PUBLIC_STORE_HOST_MODE
}

/**
 * Normaliza un path para concatenar sin doble barra: exige un solo `/` inicial
 * y trata `''`/`'/'` como "sin path" (no agrega nada al origen).
 */
function normalizePath(path: string): string {
  if (path === '' || path === '/') return ''
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Origen + path del APEX. Todo lo que es de plataforma —panel, magic link,
 * `notification_url`/webhook de MP, invitaciones— va acá, en cualquier modo de
 * host. Nunca devuelve un host de tienda.
 */
export function apexUrl(path: string): string {
  return `${apexOrigin().origin}${normalizePath(path)}`
}

/**
 * Origen + path de UNA TIENDA. Depende de `NEXT_PUBLIC_STORE_HOST_MODE`:
 * - `subdomain`: `https://<slug>.<host del apex><path>` (conserva esquema y
 *   puerto del apex).
 * - `path` (default): `<apex>/<slug><path>` — el comportamiento de hoy.
 */
export function storeUrl(slug: string, path: string): string {
  const apex = apexOrigin()
  const suffix = normalizePath(path)

  if (hostMode() === 'subdomain') {
    const port = apex.port ? `:${apex.port}` : ''
    return `${apex.protocol}//${slug}.${apex.hostname}${port}${suffix}`
  }

  return `${apex.origin}/${slug}${suffix}`
}

/**
 * Slug de tienda a partir de un header `Host`, o `null` si el host es el
 * apex, un host de preview, `localhost`, o cualquier cosa que no sea un
 * subdominio de tienda de `comandapp.ar`.
 *
 * El apex NO está hardcodeado: se deriva del hostname de `NEXT_PUBLIC_SITE_URL`
 * (`apexOrigin().hostname`), a propósito — es lo que hace que en local
 * (apex = `localhost`) y en preview (apex = `<proyecto>.vercel.app`) esta
 * función nunca encuentre un subdominio de tienda, sin un solo `if` de entorno.
 *
 * Tolera que `host` traiga puerto (`headers().get('host')` lo entrega así en
 * `next dev`). No contempla `.localhost`: el flujo local con subdominios está
 * fuera de alcance de este plan.
 */
export function parseStoreHost(host: string | null): string | null {
  if (!host) return null

  const hostname = host.split(':')[0].toLowerCase()
  const apexHostname = apexOrigin().hostname

  if (hostname === apexHostname) return null
  if (!hostname.endsWith(`.${apexHostname}`)) return null

  const label = hostname.slice(0, hostname.length - apexHostname.length - 1)

  // Más de un nivel (`a.b.comandapp.ar`) no es un subdominio de tienda válido:
  // un slug es siempre una sola etiqueta.
  if (label === '' || label.includes('.')) return null

  // `www.comandapp.ar` y compañía: reservado como PATH también implica
  // reservado como HOSTNAME (mismo motivo que `platform.schema.ts` documenta
  // para el resto de la lista). No es una copia — es la misma constante.
  if ((RESERVED_SLUGS as readonly string[]).includes(label)) return null

  return label
}

/**
 * Prefijo de path que hay que anteponer a una ruta interna de tienda para que
 * funcione tanto si el request llegó por subdominio como por path.
 *
 * `''` cuando `host` ya es el subdominio de ESE slug (el rewrite de
 * `next.config.ts` ya puso al usuario en el árbol correcto, un prefijo extra
 * duplicaría el path — ver §2.1 de `00-architecture.md`); `/${slug}` en
 * cualquier otro caso, incluido el host de OTRA tienda: no se asume que un
 * host de tenant matchea el slug que se está armando.
 *
 * Es lo que consumen los `href` internos de la vitrina (T6) y la verificación
 * de coherencia host↔pedido (T7). Se resuelve una sola vez por request en una
 * Server Component (el header `Host` no existe en el bundle del browser) y se
 * pasa como prop a las Client Components que arman links.
 */
export function storeBasePath(slug: string, host: string | null): string {
  return parseStoreHost(host) === slug ? '' : `/${slug}`
}
