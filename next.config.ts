import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

/**
 * Hosts de imagen permitidos para `next/image`.
 *
 * ESTA LISTA ES ESTÁTICA A PROPÓSITO, y el motivo costó un bug entero.
 *
 * Antes se derivaba de `process.env.NEXT_PUBLIC_SUPABASE_URL`. El problema es
 * que **este archivo se evalúa antes de que Next cargue los `.env`**, así que
 * esa variable era `undefined`, el `if` no entraba, `remotePatterns` quedaba
 * VACÍO y `/_next/image` respondía `400 "url" parameter is not allowed` a TODA
 * foto de producto. La página no rompe: se ve el ícono de imagen rota, que es
 * el síntoma más fácil de atribuir a la foto —o al celular— antes que a la
 * config. En un producto donde la foto ES el motor de venta, eso apagaba la
 * premisa del diseño entero sin un solo error en la consola del servidor.
 *
 * `loadEnvConfig()` de `@next/env` parece la solución y no lo es: en el
 * contexto donde Next evalúa este archivo el import no resuelve el named
 * export (`@next/env` es CommonJS), y el resultado es el mismo silencio.
 * Verificado contra el matcher real de Next
 * (`next/dist/shared/lib/match-remote-pattern`): el patrón de abajo matchea la
 * URL de una foto local, así que cuando fallaba no era el patrón — era la
 * lista vacía.
 *
 * Estático significa determinístico: no depende del orden de carga de nada.
 * Cubre los tres entornos, y el `pathname` sigue acotado a objetos PÚBLICOS de
 * Storage, que es lo que realmente limita el alcance.
 */
/**
 * `search: ''` NO ES COSMÉTICO: sin esa clave, el optimizador acepta CUALQUIER
 * query string en la URL de origen. El matcher de Next es literal
 * (`next/dist/shared/lib/match-remote-pattern.js`):
 *
 *     if (pattern.search !== undefined) { if (pattern.search !== url.search) ... }
 *
 * `undefined` significa "no comparo", así que `?v=1` … `?v=1000` sobre UNA sola
 * foto legítima son mil cache keys distintas y mil transformaciones. En Hobby
 * el cupo es 5K/mes y pasarse no se cobra: devuelve **402 y la `<Image>` cae al
 * `alt`**. O sea la carta sin fotos, que en este producto es apagar el motor de
 * venta. `search: ''` exige que la URL de origen no traiga query string, que es
 * exactamente la forma de un objeto público de Storage.
 *
 * Y el hostname va PINNEADO al proyecto real: `*.supabase.co` matchea cualquier
 * proyecto de Supabase del mundo, así que un tercero podía hacernos pagar el
 * cupo transformando imágenes que hostea él.
 */
const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] = [
  // Proyecto hosted (producción y previews).
  {
    protocol: 'https',
    hostname: 'xyjracoaufarsnhurhdc.supabase.co',
    pathname: '/storage/v1/object/public/**',
    search: '',
  },
  // Stack local del CLI de Supabase. Las dos formas: `supabase start` imprime
  // `127.0.0.1`, pero un `.env` escrito a mano suele decir `localhost`, y para
  // `next/image` son dos hosts distintos.
  { protocol: 'http', hostname: '127.0.0.1', port: '54321', pathname: '/storage/v1/object/public/**', search: '' },
  { protocol: 'http', hostname: 'localhost', port: '54321', pathname: '/storage/v1/object/public/**', search: '' },
]

/**
 * Headers de seguridad (S-10). Nada impedía hoy embeber /admin (un KDS con
 * botones de un toque) o /backoffice en un iframe ajeno, y sin Referrer-Policy
 * el `public_token` del pedido —la ÚNICA credencial de acceso, viaja en la
 * URL— se filtraba a cualquier destino externo por el header `Referer`.
 *
 * `frame-ancestors 'none'` va como CSP real (no Report-Only) junto al
 * `X-Frame-Options` legacy: a diferencia de `script-src`/`style-src`, esta
 * directiva no toca nada que dependa del <style> inline del tema de marca, así
 * que se puede activar de una sin nonce y sin riesgo de romper el theming.
 */
/**
 * CSP completa — deliberadamente NO activada.
 *
 * `buildThemeCss()` inyecta el tema de marca como <style> inline en
 * [store]/layout.tsx y pedido/[token]/page.tsx: un `style-src` estricto sin
 * 'unsafe-inline' rompe el theming de todas las tiendas de una. La forma
 * correcta es un nonce por request, y next.config.ts no puede generarlo: los
 * headers acá son estáticos, calculados en build. El nonce tiene que salir de
 * `proxy.ts` (dueño: otro agente) — ver el reporte final del slice de layout
 * compartido para el pedido exacto.
 *
 * Con el nonce viajando en un header propio (p. ej. `x-nonce`, seteado por
 * `proxy.ts`) y ese mismo valor puesto en el <style nonce={...}> de esas dos
 * rutas, la política pasaría a esta forma (armada en el propio proxy, que sí
 * corre por request, no en esta función estática):
 *
 * `default-src 'self'; style-src 'self' 'nonce-<NONCE>'; script-src 'self';
 *  img-src 'self' https: data:; connect-src 'self' https://api.mercadopago.com;
 *  frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
 */
/**
 * Excepción puntual a `frame-ancestors 'none'` / `X-Frame-Options: DENY` de
 * arriba, para `/admin/apariencia` (S-15).
 *
 * La vista previa de marca embebe la vitrina REAL en un `<iframe>` mismo
 * origen (`?preview=brand`, ver `src/lib/preview-mode.ts` y
 * `views/admin/apariencia/brand-preview.tsx`) en vez de dibujar una réplica
 * a mano. Sin esta excepción, el bloqueo global de arriba —pensado para que
 * NADIE pueda embeber `/admin` o `/backoffice`— también le pega a
 * `/[store]/*`, y el propio panel no puede mostrar su vitrina adentro de un
 * iframe propio: el navegador la bloquearía en silencio, sin ningún error en
 * la app que lo explique.
 *
 * Achicado a propósito en dos ejes, no solo uno:
 *   - `has: [{ type: 'query', key: 'preview', value: 'brand' }]` — SOLO se
 *     afloja para pedidos que ya traen el flag. Sin el query param, la
 *     vitrina sigue exactamente tan no-frameable como hoy.
 *   - `frame-ancestors 'self'` (no una lista abierta) — un origen ajeno
 *     nunca puede embeberla, con o sin el flag puesto. Esto no es
 *     clickjacking cross-origin: el `<iframe>` solo puede venir de una
 *     página del propio dominio.
 *
 * Las cuatro rutas de `/[store]/*` se listan explícitas (nada de comodín
 * `*`/grupo opcional en el patrón): son las únicas que existen hoy, y la
 * exclusión de `NOT_RESERVED_STORE_SEGMENT` en el segmento `:store` es la que
 * garantiza que esto NUNCA matchee `/admin`, `/backoffice`, `/api/*`,
 * `/mis-pedidos` ni `/pedido/*` — aunque nunca vaya a existir una tienda con
 * esos slugs (`RESERVED_SLUGS` en `platform.schema.ts` los prohíbe), el
 * matching de headers de Next es sobre la FORMA de la URL, no sobre qué page
 * la termina sirviendo. Ese mismo símbolo lo reusa el redirect apex→subdominio
 * de subdominio-por-local (T3): una sola copia, no dos listas que divergen.
 */
/**
 * OJO AL AGREGAR EL CSP COMPLETO que sugiere el comentario de arriba
 * (`script-src`, `object-src`, `base-uri`, `form-action`…): un header de Next
 * REEMPLAZA, no fusiona. Estas cuatro rutas emiten su propio
 * `Content-Security-Policy`, así que en cuanto el CSP global deje de ser solo
 * `frame-ancestors` habrá que repetir todas las directivas ACÁ ADENTRO o la
 * vitrina se queda sin ninguna de ellas justo con `?preview=brand` puesto.
 * Hoy no pasa nada porque el global es únicamente `frame-ancestors 'none'`
 * —verificado con curl: la respuesta trae UN solo header CSP— pero el día que
 * crezca, esto es el lugar donde se rompe en silencio.
 */
/**
 * Segmento `:store` que NO puede ser una ruta del apex — compartido entre
 * `previewFrameHeaders()` de acá abajo y el redirect apex→subdominio de
 * `redirects()` (subdominio-por-local, T3). Una sola copia a propósito: el
 * criterio de aceptación de T3 exige que las dos usen el MISMO símbolo, no
 * dos listas que puedan divergir con el tiempo.
 *
 * **Bug encontrado y corregido al unificar**: la forma anterior de
 * `previewFrameHeaders()` (`(?!admin$|backoffice$|api$|mis-pedidos$|pedido$)[^/]+`,
 * llamada `notReserved` ahí) anclaba el `$` de cada alternativa al FINAL DE
 * TODA LA URL, no al final del segmento. Eso funcionaba para
 * `/:store(${notReserved})` sola (ahí el segmento SÍ es lo último de la URL),
 * pero en `/:store(${notReserved})/carrito` el `$` nunca matcheaba con
 * `/admin/carrito` de por medio, así que la exclusión NO corría para las tres
 * formas con sufijo (`/carrito`, `/checkout`, `/producto/:id`). Verificado con
 * Node: `new RegExp('^/(?<store>' + notReserved + ')/carrito$').test('/admin/carrito')`
 * daba `true` con el patrón viejo. La forma de abajo ancla contra el
 * segmento (`/` o fin de URL), no contra el final absoluto, así que excluye
 * `admin` en las cuatro formas por igual y sigue aceptando cualquier slug
 * real (`administracion`, `pedidos-ya`) que solo empieza igual.
 *
 * Lista extendida respecto de la que traía `previewFrameHeaders()`: T3 suma
 * `legal`, `repartidor`, `_next`, `favicon.ico`, `robots.txt` y `sitemap.xml`
 * porque el redirect apex→subdominio cubre más superficie del apex que la
 * vista previa de marca.
 */
const NOT_RESERVED_STORE_SEGMENT =
  '(?!(?:admin|backoffice|api|mis-pedidos|pedido|legal|repartidor|_next|favicon\\.ico|robots\\.txt|sitemap\\.xml)(?:/|$))[^/]+'

function previewFrameHeaders() {
  const previewHeaders = [
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  ]
  const has = [{ type: 'query' as const, key: 'preview', value: 'brand' }]

  return [
    { source: `/:store(${NOT_RESERVED_STORE_SEGMENT})`, has, headers: previewHeaders },
    { source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/carrito`, has, headers: previewHeaders },
    { source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/checkout`, has, headers: previewHeaders },
    { source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/producto/:id`, has, headers: previewHeaders },
  ]
}

async function headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        // `frame-ancestors` no depende de nonce ni toca script-src/style-src:
        // se puede activar de una, a diferencia de la CSP completa de más abajo.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Nada de este producto usa cámara, micrófono, geolocalización ni
        // sensores; y el pago pasa por un redirect a Checkout Pro, no por un
        // iframe propio, así que `payment` tampoco hace falta acá.
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
        },
      ],
    },
    {
      // El public_token de un pedido es su única credencial y viaja en esta
      // URL. `strict-origin-when-cross-origin` ya no manda el path a otro
      // origen, pero un link de esta página compartido en WhatsApp o pegado
      // en un ticket de soporte igual dispara un Referer con el token puesto.
      // Va después del bloque global para que gane (Next.js: last match wins
      // cuando dos configuraciones tocan la misma clave).
      source: '/pedido/:token*',
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    },
    ...previewFrameHeaders(),
  ]
}

/**
 * Routing por host — subdominio por local (T3 de
 * `docs/pipelines/2026-08-29-subdominio-por-local/`).
 *
 * Decisión ya tomada por el dueño del producto, no se reabre acá: el mapeo
 * `<slug>.comandapp.ar` → `/[store]` vive en ESTE archivo (`beforeFiles`), no
 * en `proxy.ts` ni en `vercel.json`. El motivo completo está en
 * `00-architecture.md` §4.A; en resumen: `beforeFiles` es la única fase que la
 * doc de Next documenta capaz de pisar un archivo de página real
 * (`src/app/page.tsx` existe, y `la-birra.comandapp.ar/` tiene que servir
 * `/[store]`, no la landing de la plataforma), y es la única forma testeable
 * como dato en CI — con el flujo local fuera de alcance (§2.6 del mismo doc),
 * esos tests de configuración son la única verificación previa a producción.
 *
 * Todo el gating es por `has: { type: 'host' }`, nunca por variable de
 * entorno: este archivo se evalúa antes de que Next cargue los `.env` (mismo
 * problema que ya sufrió `remotePatterns` más arriba). Consecuencia buscada:
 * en `localhost` y en `*.vercel.app` (preview deployments) el host nunca
 * matchea `comandapp.ar`, así que rewrite y redirects quedan inertes solos y
 * el acceso path-based sigue funcionando sin ningún cambio.
 */
/**
 * Host de un subdominio de tienda: UN solo label seguido de `.comandapp.ar`.
 * `[^.]+` (sin punto) es lo que excluye `a.b.comandapp.ar` — un subdominio de
 * subdominio no es una forma que la plataforma emite nunca, así que no hace
 * falta que matchee nada.
 *
 * `has.value` de Next se prueba con `new RegExp('^' + value + '$')`
 * (verificado en
 * `next/dist/shared/lib/router/utils/prepare-destination.js`, función
 * `matchHas`), o sea que está ANCLADO a los dos extremos del header `Host` —
 * sin eso, `value` sin ancla matchearía como substring de cualquier host que
 * *contenga* `comandapp.ar`, lo cual sería explotable armando un DNS propio.
 * El grupo con nombre `(?<slug>...)` es lo que después se usa como `:slug` en
 * el `destination` del rewrite.
 */
const STORE_HOST_PATTERN = '(?<slug>[^.]+)\\.comandapp\\.ar'

/** Host del apex, exacto — ni `www.comandapp.ar` ni un subdominio de tienda. */
const APEX_HOST_PATTERN = 'comandapp\\.ar'

/**
 * (a) Rewrite host→path, `beforeFiles`.
 *
 * Allowlist explícita de las cuatro formas que existen hoy bajo
 * `src/app/[store]/` (`page.tsx`, `carrito/`, `checkout/`, `producto/[id]/`).
 * **Nada de `source: '/:path*'`**: `beforeFiles` corre ANTES de resolver
 * `_next/static` (doc del repo, líneas 94-95 de `rewrites.md`), así que un
 * catch-all se lleva puestos los chunks de Turbopack, React nunca hidrata, y
 * el síntoma se lee como "el diseño está roto en mobile" — el mismo modo de
 * falla que `allowedDevOrigins` ya documenta más abajo en este archivo. Con
 * cuatro `source` fijos (`/`, `/carrito`, `/checkout`, `/producto/:id`), nada
 * que empiece con `/_next`, `/api`, `/pedido` o `/mis-pedidos` matchea jamás:
 * no hace falta excluirlos a mano, la forma del `source` ya los deja afuera.
 *
 * `/pedido/*` y `/mis-pedidos` a propósito NO tienen entrada acá: tienen que
 * seguir sirviéndose sin reescribir desde el host de tenant (mismo origen
 * donde se armó el carrito), porque `clearResolvedOrderCart` vacía el
 * `localStorage` del ORIGEN donde corre, y `localStorage` es por origen
 * (`00-architecture.md` §2.2 y §5.1). Si el seguimiento volviera al apex, el
 * carrito y la `idempotencyKey` de la compra ya resuelta quedarían vivos en
 * el subdominio.
 */
function rewrites() {
  const has = [{ type: 'host' as const, value: STORE_HOST_PATTERN }]

  return {
    beforeFiles: [
      { source: '/', has, destination: '/:slug' },
      { source: '/carrito', has, destination: '/:slug/carrito' },
      { source: '/checkout', has, destination: '/:slug/checkout' },
      { source: '/producto/:id', has, destination: '/:slug/producto/:id' },
    ],
  }
}

/**
 * (b) Redirects, dos grupos — corren ANTES que el rewrite de arriba en el
 * orden de Next (headers → redirects → proxy → `beforeFiles`), así que un
 * request al apex nunca llega a evaluar la tabla de rewrites.
 *
 * **Grupo 1 — apex path-based → subdominio, 308.** Mismo origen canónico para
 * toda tienda: sin esto, `comandapp.ar/la-birra` y `la-birra.comandapp.ar`
 * servirían el mismo catálogo desde dos orígenes con dos `localStorage`
 * (carrito y "mis pedidos") sin relación entre sí. `permanent: true` → 308,
 * no 301: preserva el método (no que haga falta acá, pero es la garantía
 * correcta para un link que un cliente puede reintentar).
 *
 * Dos guardas obligatorias en las CUATRO formas:
 *   - `missing: [{ type: 'query', key: 'preview' }]` — el `<iframe>` de
 *     `/admin/apariencia` embebe `/${slug}?preview=brand` **en el apex**
 *     (mismo origen, ver `previewFrameHeaders()` más arriba) para poder
 *     mostrar la vitrina real dentro del panel. Si esto redirigiera al
 *     subdominio, el iframe pasaría a ser cross-origin y `frame-ancestors
 *     'self'` lo bloquearía en el browser sin ningún error visible en la app
 *     (`00-architecture.md` §2.3).
 *   - `NOT_RESERVED_STORE_SEGMENT` en el segmento `:store` — sin esto,
 *     `comandapp.ar/admin` calificaría como "tienda `admin`" y respondería
 *     308 a `https://admin.comandapp.ar`, un host que ni siquiera puede
 *     existir como tienda real (`RESERVED_SLUGS` lo prohíbe), rompiendo el
 *     panel en el apex igual.
 *
 * **Grupo 2 — tenant → apex, 308**, para `/admin`, `/backoffice` y
 * `/repartidor`. Es lo que hace CIERTA la premisa "los subdominios sirven
 * solo tráfico anónimo" en vez de dejarla en un `RESERVED_SLUGS` que nadie
 * verifica en runtime: si alguna vez alguien pega un link de panel con el
 * host de una tienda, vuelve al apex en vez de intentar (y fallar) servir
 * `/admin` bajo el rewrite del grupo (a) de arriba.
 */
function redirects() {
  const apexHas = [{ type: 'host' as const, value: APEX_HOST_PATTERN }]
  const noPreview = [{ type: 'query' as const, key: 'preview' }]
  const tenantHas = [{ type: 'host' as const, value: STORE_HOST_PATTERN }]

  return [
    {
      source: `/:store(${NOT_RESERVED_STORE_SEGMENT})`,
      has: apexHas,
      missing: noPreview,
      permanent: true,
      destination: 'https://:store.comandapp.ar',
    },
    {
      source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/carrito`,
      has: apexHas,
      missing: noPreview,
      permanent: true,
      destination: 'https://:store.comandapp.ar/carrito',
    },
    {
      source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/checkout`,
      has: apexHas,
      missing: noPreview,
      permanent: true,
      destination: 'https://:store.comandapp.ar/checkout',
    },
    {
      source: `/:store(${NOT_RESERVED_STORE_SEGMENT})/producto/:id`,
      has: apexHas,
      missing: noPreview,
      permanent: true,
      destination: 'https://:store.comandapp.ar/producto/:id',
    },
    { source: '/admin/:path*', has: tenantHas, permanent: true, destination: 'https://comandapp.ar/admin/:path*' },
    {
      source: '/backoffice/:path*',
      has: tenantHas,
      permanent: true,
      destination: 'https://comandapp.ar/backoffice/:path*',
    },
    {
      source: '/repartidor/:path*',
      has: tenantHas,
      permanent: true,
      destination: 'https://comandapp.ar/repartidor/:path*',
    },
  ]
}

/**
 * Orígenes que `next dev` acepta para servir `/_next/*`.
 *
 * Next 16 bloquea con **403** cualquier pedido a `/_next/*` que llegue con un
 * header `Origin` que no esté en esta lista, y por defecto la lista es
 * `localhost` a secas. Verificado a mano contra el dev server:
 *
 *   sin Origin                          -> 200
 *   Origin: http://localhost:3000       -> 200
 *   Origin: http://127.0.0.1:3000       -> 403
 *   Origin: http://192.168.54.180:3000  -> 403
 *
 * El síntoma no menciona CORS en ningún lado y es brutal: los chunks que el
 * runtime de Turbopack pide con CORS (los que mandan `Origin`) no cargan, así
 * que **React nunca hidrata** —nada clickeable, ningún control de Radix
 * funciona— y, como en dev el CSS se inyecta desde esos mismos chunks, las
 * variables de `next/font` tampoco se definen y la app entera cae a Times con
 * medio layout sin aplicar. Se ve como "el diseño está roto en mobile", no
 * como un problema de red.
 *
 * Esto importa especialmente en este producto: el 90% de los pedidos entra
 * desde un celular, así que probar desde un teléfono real por la IP de LAN no
 * es un caso de borde, es EL caso. Sin estas entradas ese flujo es imposible.
 *
 * Solo afecta a `next dev`; en producción no existe.
 */
const allowedDevOrigins = [
  '127.0.0.1',
  // Rangos privados: la IP que le toca a la máquina en la red de casa o la
  // oficina cambia sola, así que fijar una sola sería romperlo en el próximo
  // DHCP.
  '192.168.*.*',
  '10.*.*.*',
  '172.16.*.*',
  // Bonjour: `mi-mac.local:3000` desde el celular, sin depender de la IP.
  '*.local',
]

const nextConfig: NextConfig = {
  allowedDevOrigins,
  images: {
    remotePatterns,
    // El catálogo se ve casi siempre en un celular; no hace falta servir 3840px.
    deviceSizes: [360, 420, 640, 828, 1080, 1200, 1920],
    /**
     * Un año. El default de Next son 4 horas (`minimumCacheTTL: 14400`,
     * verificado en `image-config.js`) y Vercel **factura cada MISS y cada
     * STALE**, así que con el default el mismo catálogo se re-transforma seis
     * veces por día para siempre: una tienda de 40 productos proyecta seis
     * cifras de transformaciones al mes contra un cupo de 5K.
     *
     * Un TTL largo es correcto acá, no un atajo: los objetos de Storage se
     * suben con `upsert: false` y path UUID, así que el contenido de una URL
     * dada NUNCA cambia. Cambiar la foto de un producto genera una URL nueva.
     */
    minimumCacheTTL: 31536000,
    /**
     * Pinneado, no agregado: el default de Next YA es `[75]` y el optimizador
     * lo aplica (`if (qualities) ... not allowed`), así que hoy un `q=90` ya
     * rebota. Se declara explícito por el mismo motivo que `search`: el otro
     * default —el de `search`, que es permisivo— es justamente el que abrió el
     * agujero. Un default del que dependemos en silencio es una decisión que no
     * tomamos nosotros y que un upgrade puede cambiar sin avisar.
     *
     * Cada valor de `q` admitido es un multiplicador sobre las variantes por
     * foto: uno solo mantiene el conteo en anchos × formatos.
     */
    qualities: [75],
  },
  headers,
  rewrites,
  redirects,
}

/**
 * El config se exporta como FUNCIÓN para poder leer la fase.
 *
 * Motivo: `images.dangerouslyAllowLocalIP` tiene que estar prendido **solo en
 * desarrollo**. Next 16 resuelve el hostname de toda imagen remota y rechaza
 * las que caen en una IP privada, como guarda anti-SSRF; el error es
 * `400 "url" parameter is not allowed`, el MISMO texto que usa para una URL
 * que no matchea `remotePatterns`, así que se diagnostica como un problema de
 * patrones cuando no lo es. En local el Storage de Supabase vive en
 * `127.0.0.1:54321` (y `localhost` resuelve ahí también), o sea que sin esto
 * NINGUNA foto de producto se ve en desarrollo.
 *
 * En producción queda apagado, que es como tiene que estar: ahí el Storage es
 * un host público y permitir IPs privadas convertiría al optimizador de
 * imágenes en un proxy para escanear la red interna del servidor.
 *
 * Se usa la fase y no `process.env.NODE_ENV` porque este archivo se evalúa
 * antes de que Next cargue los `.env` (ver el comentario de `remotePatterns`):
 * la fase la pasa el propio framework y siempre está.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...nextConfig,
      images: { ...nextConfig.images, dangerouslyAllowLocalIP: true },
    }
  }
  return nextConfig
}
