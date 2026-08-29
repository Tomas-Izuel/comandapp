# T3 — Routing por host en `next.config.ts`

**Agente**: `senior-backend-engineer` · **Lane**: `backend`
**Archivo tocado (único)**: `next.config.ts`

## Qué se implementó

Dos piezas nuevas en `next.config.ts`, ninguna lee variables de entorno (el
archivo se evalúa antes de que Next cargue los `.env` — misma trampa que ya
documentaba `remotePatterns`). Todo el gating es por `has: { type: 'host' }`.

### (a) `rewrites()` → `{ beforeFiles: [...] }`

Allowlist explícita de las cuatro formas reales bajo `src/app/[store]/`
(`page.tsx`, `carrito/`, `checkout/`, `producto/[id]/`), gateadas por
`has: [{ type: 'host', value: STORE_HOST_PATTERN }]` con
`STORE_HOST_PATTERN = '(?<slug>[^.]+)\\.comandapp\\.ar'`:

```
/                →  /:slug
/carrito         →  /:slug/carrito
/checkout        →  /:slug/checkout
/producto/:id    →  /:slug/producto/:id
```

`[^.]+` (sin punto) es lo que excluye `a.b.comandapp.ar`. `/pedido/*` y
`/mis-pedidos` **no** tienen entrada a propósito: tienen que seguir
sirviéndose sin reescribir desde el host de tenant para que
`clearResolvedOrderCart` (que vacía `localStorage` por origen) encuentre el
carrito y la `idempotencyKey` en el mismo origen donde se armaron
(`00-architecture.md` §2.2/§5.1).

### (b) `redirects()`, dos grupos

**Grupo 1 — apex path-based → subdominio, 308** (`permanent: true`), con
`has: [{ type: 'host', value: 'comandapp\\.ar' }]` (host exacto, no matchea
`www.comandapp.ar` ni un subdominio), sobre las mismas cuatro formas con el
slug en el path:

```
/:store                →  https://:store.comandapp.ar
/:store/carrito        →  https://:store.comandapp.ar/carrito
/:store/checkout       →  https://:store.comandapp.ar/checkout
/:store/producto/:id   →  https://:store.comandapp.ar/producto/:id
```

Dos guardas en las cuatro entradas:
- `missing: [{ type: 'query', key: 'preview' }]` — protege el `<iframe>` de
  `/admin/apariencia` (`?preview=brand`, mismo origen contra el apex).
- El segmento `:store` usa `NOT_RESERVED_STORE_SEGMENT` (ver más abajo), para
  que `/admin`, `/backoffice`, `/api`, `/mis-pedidos`, `/pedido`, `/legal`,
  `/repartidor`, `/_next`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml` nunca
  califiquen como "tienda".

**Grupo 2 — tenant → apex, 308**, para `/admin/:path*`, `/backoffice/:path*`,
`/repartidor/:path*`, gateado por el mismo `STORE_HOST_PATTERN`. Es lo que
hace **cierta** en runtime la premisa "los subdominios sirven solo tráfico
anónimo", en vez de dejarla solo en `RESERVED_SLUGS`.

## Contrato expuesto (para quien integre / lea esto después)

- `next.config.ts` exporta `rewrites` y `redirects` además de `headers`,
  wireados en el objeto `nextConfig`. Nada más del archivo cambió de forma
  (mismo `images`, mismo `allowedDevOrigins`, misma función `config(phase)`).
- Constantes nuevas a nivel de módulo: `NOT_RESERVED_STORE_SEGMENT`,
  `STORE_HOST_PATTERN`, `APEX_HOST_PATTERN`. Si otro slice necesita el mismo
  criterio de "segmento reservado del apex" o "host de tenant", están acá —
  no las dupliquen.
- No se tocó nada de `src/`. `src/lib/urls.ts` (T4) es un módulo separado y
  este archivo no lo importa (restricción dura documentada arriba en el
  propio `next.config.ts`, y en el prompt de T3).

## Bug encontrado y corregido en código ya existente (dentro de mi archivo)

`previewFrameHeaders()` (preexistente, S-15) usaba
`const notReserved = '(?!admin$|backoffice$|api$|mis-pedidos$|pedido$)[^/]+'`
para excluir rutas del apex del segmento `:store`, en cuatro `source`:
`/:store(${notReserved})`, y la misma con sufijo `/carrito`, `/checkout`,
`/producto/:id`.

**El `$` de cada alternativa ancla contra el final de TODO el string que Next
testea, no contra el final del segmento.** Verificado con Node contra el
patrón viejo:

```js
new RegExp('^/(?<store>' + notReserved + ')/carrito$').test('/admin/carrito')
// -> true
```

O sea que la exclusión funcionaba para la forma sin sufijo (`/:store(...)`
sola, donde el segmento sí es lo último del string) pero **no** para las tres
formas con sufijo: `/admin/carrito`, `/backoffice/checkout`,
`/api/producto/9` calificaban como `:store = "admin"` etc. y quedaban
elegibles para el carve-out de `frame-ancestors 'self'` de
`previewFrameHeaders()`. En la práctica el blast radius era bajo (esas rutas
no existen como páginas reales del panel y `RESERVED_SLUGS` bloquea que una
tienda real se llame así), pero es exactamente el tipo de bypass silencioso
que este archivo ya trata como clase de bug seria (ver el comentario de
`remotePatterns`).

Al extraer el helper a la constante única `NOT_RESERVED_STORE_SEGMENT`
(requerido por el propio T3 para compartirlo con el redirect nuevo), lo
corregí ahí mismo:

```
(?!(?:admin|backoffice|api|mis-pedidos|pedido|legal|repartidor|_next|favicon\.ico|robots\.txt|sitemap\.xml)(?:/|$))[^/]+
```

El lookahead ahora exige que la palabra reservada esté seguida de `/` (fin de
segmento) o de fin de string — así excluye la palabra reservada en las
**cuatro** formas por igual, y sigue aceptando cualquier slug real que solo
empieza igual (`administracion`, `pedidos-ya`), porque ahí el siguiente
carácter no es `/` ni fin de string. Extendí la lista con `legal`,
`repartidor`, `_next`, `favicon.ico`, `robots.txt`, `sitemap.xml` — las que
pide T3 para el redirect nuevo, que cubre más superficie del apex que la
vista previa de marca.

**Esto es a la vez la corrección de un bug preexistente en `previewFrameHeaders()`
y la base correcta para el redirect nuevo.** No toqué ninguna otra cosa de
headers (ni el CSP, ni el orden, ni las rutas que cubre) — solo el helper
compartido, tal como autoriza el prompt de T3 ("no tocar los headers de
seguridad salvo para extraer la constante compartida").

## Verificación hecha (sin levantar servidor, como pide T3 §2.6)

Next 16 evalúa `has`/`missing` de rewrites y redirects con `matchHas()`
(`next/dist/shared/lib/router/utils/prepare-destination.js`) y matchea
`source` con el `pathToRegexp` compilado que trae el propio paquete
(`next/dist/compiled/path-to-regexp`). Escribí un script descartable (no
commiteado, vivió en el scratchpad y se borró) que:

1. Importa el `next.config.ts` real con `node --experimental-strip-types`
   (Node 24), invocando `config('phase-production-build')`.
2. Para cada uno de los 15 criterios de aceptación de T3 y dos casos extra del
   bugfix, arma un request falso (`{ headers: { host } }`) + query, corre
   **la función real `matchHas` de Next** contra `has`/`missing`, y **la
   función real `pathToRegexp` de Next** contra `source`.

Resultado: **17/17 PASS** — los 15 criterios de `01-tasks.md` §T3 más las dos
verificaciones del bugfix (`/admin/carrito` ya no es elegible como
`store=admin`; `/administracion` con prefijo reservado sigue funcionando como
slug real). No es una simulación de mi propia cosecha: son las mismas
funciones que corre Next en producción, solo que invocadas directamente en
vez de a través de un servidor HTTP — que es exactamente lo que T3 pide
("verificable evaluando la config exportada, sin levantar un servidor").

`npm run typecheck` y `npm run lint` limpios (`npx eslint next.config.ts` sin
salida; el `lint` completo del repo solo trae 6 warnings preexistentes de
`no-unused-vars` en archivos de `tests/`, ninguno mío).

## Lo que el `test-engineer` tiene que escribir (T3 §2.6: única verificación
previa a producción, no hay flujo local para esto)

Los 15 criterios de `01-tasks.md` línea por línea, más estos dos que salieron
del bugfix y valen la pena fijar con un test para que no vuelvan:

16. `/admin/carrito`, `/backoffice/checkout`, `/api/producto/9` (host
    `comandapp.ar`) **no** producen redirect (el segmento reservado con
    sufijo, el caso que estaba roto).
17. `/administracion`, `/pedidos-ya`, `/legal-cordobes` (host `comandapp.ar`)
    **sí** producen redirect a su propio subdominio (que la lista reservada
    no se vuelva de más y bloquee slugs reales que solo empiezan parecido).

Cómo ejercitarlo sin servidor: importar `matchHas` de
`next/dist/shared/lib/router/utils/prepare-destination.js` y `pathToRegexp`
de `next/dist/compiled/path-to-regexp`, invocar `config('phase-production-build').rewrites()`
/ `.redirects()` / `.headers()`, y correr esas mismas funciones contra un
request `{ headers: { host } }` + query fake — es el mecanismo que usé para
verificar arriba, y es determinista y corre en CI sin Docker ni Next
levantado.

## Fuera de alcance, no tocado

- `images`, `remotePatterns`, `deviceSizes`, `qualities`, `minimumCacheTTL`:
  intactos.
- `allowedDevOrigins`: intacto (verificado también por el script: mismo
  array, 5 entradas).
- CSP / headers de seguridad: intactos salvo la extracción de constante ya
  descripta.
- `vercel.json`, `package.json`, cualquier archivo de `src/`: no tocados.
- No hay variante `.localhost` en ningún patrón — el flujo local sigue
  path-based sin cambios, confirmado por los criterios 11 y 15.

## Riesgo que no puedo cerrar desde acá

El `store_id`/slug real que usan las páginas para resolver la tienda sigue
viniendo de `src/app/[store]/layout.tsx` vía `getStoreBySlug(params.store)` —
no cambié nada de eso, ni podía (fuera de mi archivo). El rewrite solo cambia
la FORMA de la URL que llega a esa página; la resolución de "slug inexistente
→ 404 de la app" (`00-architecture.md` §5.8) depende de código que no es mío
y no lo verifiqué de nuevo acá — sí verifiqué que el rewrite entrega
`/noexiste` a `/[store]/layout.tsx` para cualquier host `*.comandapp.ar` de un
solo label, que es todo lo que le corresponde a T3.
