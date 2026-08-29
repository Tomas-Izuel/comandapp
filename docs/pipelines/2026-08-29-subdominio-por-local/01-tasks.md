# Subdominio por local — tareas

Deriva de `00-architecture.md` (revisión 2). **Nada de esto arranca sin
aprobación.**

**Regla de reparto**: el corte es por archivo y es disjunto. Ninguna tarea toca
un archivo que otra declara como propio. Si un agente necesita tocar un archivo
que no es suyo, **lo reporta, no lo edita**.

**Ningún agente escribe migraciones ni resetea la base.** T1 es del hilo
principal.

**Ningún agente corre `npm install`.** Este plan **no agrega dependencias**:
`@vercel/config` quedó descartado (`00-architecture.md` §4.A).

**Alcance recortado**: el flujo de desarrollo con subdominios está **fuera**.
En local todo sigue path-based (`localhost:3000/[slug]`) exactamente como hoy.
Ninguna tarea agrega hosts locales, entradas de `/etc/hosts`, scripts de npm ni
documentación de flujo local.

## ⚠ Colisión con trabajo en curso

`git status` muestra `src/models/courier.model.ts` **modificado** por el slice
de repartidores/métricas que está en vuelo
(`docs/pipelines/2026-08-29-repartidores-metricas/`). Ese archivo es de **T5**.
**T5 no arranca hasta que ese slice esté integrado**, o se le saca ese archivo a
T5 y se hace en un pase aparte. Dos agentes sobre el mismo archivo se pisan sin
aviso.

## Grafo de dependencias

```
T1 (schema, hilo principal) ──┐
T2 (RESERVED_SLUGS)  ─────────┘   independientes entre sí, se despliegan juntas

T4 (src/lib/urls.ts + env) ──┬──> T5 (rewire de URLs absolutas, backend)
                             ├──> T6 (links internos, frontend)
                             └──> T7 (coherencia host↔pedido, frontend)

T3 (next.config.ts) ── independiente

T8 (CLAUDE.md, hilo principal) ── al final
T9 (tests) ── después de T2–T7
```

**Orden de arranque**: T4 primero y solo (fija el contrato). Cuando T4 esté,
arrancan **en paralelo** T3, T5, T6, T7. T1/T2 en cualquier momento.

---

## T4 — Autoridad de URLs: `src/lib/urls.ts` y contrato de entorno

**Lane**: `backend` · **Agente**: `senior-backend-engineer`
**Es la tarea que fija el contrato: arranca sola, antes que las demás.**

**Archivos que posee en exclusiva**

- `src/lib/urls.ts` (nuevo)
- `src/lib/env.client.ts`
- `src/lib/env.server.ts`
- `.env.example`

**No puede tocar**: `next.config.ts`, `package.json`, `vercel.json`, nada de
`src/controllers/`, `src/services/`, `src/views/`, `src/app/`, `tests/`.

**Objetivo**

Separar los dos roles que hoy cumple `NEXT_PUBLIC_SITE_URL`
(`00-architecture.md` §3.2) en una API chica y pura.

**Contrato a producir** (descrito, no codificado):

- `apexUrl(path: string): string` — origen del apex + path. El apex sale de
  `NEXT_PUBLIC_SITE_URL`, que a partir de ahora **significa exactamente eso** y
  no se renombra.
- `storeUrl(slug: string, path: string): string` — en modo `subdomain`,
  `https://<slug>.<host del apex><path>`; en modo `path`,
  `<apex>/<slug><path>`. Conserva el esquema y el puerto del apex.
- `parseStoreHost(host: string | null): string | null` — devuelve el slug si el
  host es de tenant (`<slug>.comandapp.ar`), `null` si es el apex, un host de
  preview, `localhost`, o cualquier otra cosa. **Tiene que tolerar que el header
  traiga puerto**, porque `headers()` lo entrega. **No** contempla hosts
  `.localhost`: el flujo local con subdominios está fuera de alcance.
- `storeBasePath(slug: string, host: string | null): string` — `''` cuando el
  host es de tenant para ese slug, `` `/${slug}` `` en cualquier otro caso. Es
  lo que consumen T6 y T7.

**Entorno**

- `NEXT_PUBLIC_STORE_HOST_MODE`: `z.enum(['subdomain', 'path']).default('path')`
  en `env.client.ts` **y** en `env.server.ts` (los dos schemas lo necesitan;
  `NEXT_PUBLIC_SITE_URL` ya está duplicado igual). **Default `path` a
  propósito**: en local y en preview nadie la setea y todo sigue como hoy. El
  desarrollador no tiene que enterarse de que existe.
- Documentarla en `.env.example` explicando que **solo se setea en Production**
  y que en local no se toca.
- Estrechar el comentario de `NEXT_PUBLIC_SITE_URL` en los dos schemas: es el
  **origen del apex**, siempre; nunca el de una tienda.

**Criterios de aceptación (spec del `test-engineer`)**

1. Modo `path` + apex `https://comandapp.ar`:
   `storeUrl('la-birra', '/pedido/x')` → `https://comandapp.ar/la-birra/pedido/x`.
2. Modo `subdomain` + mismo apex:
   `storeUrl('la-birra', '/pedido/x')` → `https://la-birra.comandapp.ar/pedido/x`.
3. Modo `path` + apex `http://localhost:3000`:
   `storeUrl('la-birra', '/carrito')` → `http://localhost:3000/la-birra/carrito`.
   **Es el caso de desarrollo y no debe cambiar respecto de hoy.**
4. `apexUrl` **nunca** devuelve un host de tienda, en ningún modo.
5. `parseStoreHost`: `'la-birra.comandapp.ar'` → `'la-birra'`;
   `'comandapp.ar'` → `null`; `'www.comandapp.ar'` → `null` (`www` es slug
   reservado); `'localhost:3000'` → `null`;
   `'proyecto-abc-scope.vercel.app'` → `null`; `'a.b.comandapp.ar'` → `null`;
   `null` → `null`.
6. `storeBasePath('la-birra', 'la-birra.comandapp.ar')` → `''`;
   `storeBasePath('la-birra', 'comandapp.ar')` → `'/la-birra'`;
   `storeBasePath('la-birra', 'localhost:3000')` → `'/la-birra'`;
   `storeBasePath('la-birra', 'otra.comandapp.ar')` → `'/la-birra'` (host de
   otra tienda: no se asume prefijo vacío).
7. Sin `NEXT_PUBLIC_STORE_HOST_MODE` seteada, el módulo se comporta como
   `path`. No tira.
8. `storeUrl` y `apexUrl` no producen doble barra ni pierden la query.

**Fuera de alcance**: cambiar cualquier call site (T5/T6/T7). No agregar
`NEXT_PUBLIC_STORE_DOMAIN` — el host del apex se deriva de
`NEXT_PUBLIC_SITE_URL`. **No agregar scripts a `package.json`.**

**Skills obligatorias**: `context7` (MCP) antes de usar cualquier API de Zod v4;
`vercel-react-best-practices`.

---

## T3 — Routing por host en `next.config.ts`

**Lane**: `backend` · **Agente**: `senior-backend-engineer`

**Archivos que posee en exclusiva**

- `next.config.ts`

**No puede tocar**: nada más. Ni `src/`, ni `vercel.json`, ni `package.json`.
**`vercel.json` queda intacto**: los 4 crons y `regions` no se migran (ver
`00-architecture.md` §4.A).

**Objetivo**

Dos cosas en el mismo archivo.

**(a) `rewrites()` → `beforeFiles`, allowlist explícita de cuatro rutas.**

Condición de host en cada entrada, con named capture group, contra
`comandapp.ar` **solamente** (sin variante `.localhost`: el flujo local con
subdominios está fuera de alcance). **El regex no lleva puerto**: verificado en
`node_modules/next/dist/shared/lib/router/utils/prepare-destination.js:84-90`,
Next hace `host.split(':', 1)[0].toLowerCase()` antes de matchear.

Las cuatro formas, y **solo** estas cuatro:

```
/                →  /:slug
/carrito         →  /:slug/carrito
/checkout        →  /:slug/checkout
/producto/:id    →  /:slug/producto/:id
```

**Tiene que ser `beforeFiles`, no `afterFiles`.** `src/app/page.tsx` existe: la
entrada `/` → `/:slug` **tiene que ganarle a un archivo de página real**, y
`beforeFiles` es la única fase que documenta poder hacerlo (*"before all files
including `_next/public` files which allows overriding page files"*, doc del
repo `.../01-next-config-js/rewrites.md:55-57`). Si esto queda en `afterFiles`,
**cada tienda sirve la landing de la plataforma en su home** — un 200 que
miente.

**Prohibido un `source: '/:path*'`.** La contracara de `beforeFiles` es que
corre antes de resolver `_next/static` (mismo doc, líneas 94-95), así que un
catch-all se lleva los chunks de Turbopack, React no hidrata y el síntoma se lee
como "el diseño está roto". El label del subdominio en el regex debe excluir el
punto (`[^.]+` o equivalente) para que `a.b.comandapp.ar` no matchee.

**(b) `redirects()`, dos grupos.**

- **Apex → subdominio, 308** (`permanent: true`), con `has` de host igual a
  `comandapp.ar` **exacto**, sobre las mismas cuatro formas pero con el slug en
  el path. Dos guardas obligatorias:
  - `missing: [{ type: 'query', key: 'preview' }]` — sin esto se rompe el
    `<iframe>` de vista previa de marca de `/admin/apariencia`, que apunta a
    `/${slug}?preview=brand` **en el apex** y depende de ser mismo origen
    (`frame-ancestors 'self'`). El bloqueo sería del browser, sin ningún error
    en la app.
  - El segmento del slug tiene que excluir las rutas de un segmento del apex.
    **Reusar y extender el helper `notReserved` que ya existe en este archivo**
    (hoy `(?!admin$|backoffice$|api$|mis-pedidos$|pedido$)[^/]+`), sumando
    `legal`, `repartidor`, `_next`, `favicon.ico`, `robots.txt`, `sitemap.xml`.
    **Extraerlo a una constante única del módulo** y usarla también en
    `previewFrameHeaders()`, que hoy tiene su propia copia. Esto es parte del
    argumento por el que el routing vive acá y no en `vercel.json`: una sola
    copia, no dos sintaxis.
- **Tenant → apex, 308**, con `has` de host de tenant, para `/admin/:path*`,
  `/backoffice/:path*` y `/repartidor/:path*`. Destino absoluto
  `https://comandapp.ar/...`. Es lo que hace cierta la premisa "los subdominios
  sirven solo tráfico anónimo".

**Restricción dura**: `next.config.ts` **no puede leer ninguna variable de
entorno de app**. Se evalúa antes de que Next cargue los `.env` — la trampa que
el comentario de `remotePatterns` ya documenta en este mismo archivo. Todo el
gating es por `has: { type: 'host' }`, que además deja el config inerte solo en
`*.vercel.app` y en `localhost`.

**`allowedDevOrigins` NO se toca.** No hay hosts locales nuevos.

**Criterios de aceptación (spec del `test-engineer`)**

Todos verificables evaluando la config exportada, sin levantar un servidor.
Con el alcance recortado **estos tests son la única verificación previa a
producción** (`00-architecture.md` §2.6), así que se escriben completos.

1. Host `la-birra.comandapp.ar` + `/` → rewrite a `/la-birra`, **en la fase
   `beforeFiles`**. El test tiene que afirmar la fase, no solo la existencia de
   la entrada.
2. Host `la-birra.comandapp.ar` + `/carrito` → `/la-birra/carrito`.
3. Host `la-birra.comandapp.ar` + `/producto/42` → `/la-birra/producto/42`.
4. Host `la-birra.comandapp.ar` + `/checkout` → `/la-birra/checkout`.
5. Host `la-birra.comandapp.ar` + `/_next/static/chunks/main.js` → **ningún
   rewrite matchea**. Idem `/_next/image`, `/api/orders`, `/pedido/abc`,
   `/mis-pedidos`, `/legal/privacidad`, `/favicon.ico`.
6. Host `a.b.comandapp.ar` → ningún rewrite matchea.
7. Host `comandapp.ar` + `/la-birra/carrito` → 308 a
   `https://la-birra.comandapp.ar/carrito`.
8. Host `comandapp.ar` + `/la-birra?preview=brand` → **ningún redirect**.
9. Host `comandapp.ar` + `/mis-pedidos`, `/admin`, `/backoffice`, `/legal`,
   `/pedido/x`, `/repartidor` → **ningún redirect** (no son slugs).
10. Host `proyecto-abc-scope.vercel.app` + `/la-birra/carrito` → ni rewrite ni
    redirect: path-based intacto. **Criterio de los preview deployments.**
11. Host `localhost` + `/la-birra/carrito` → ni rewrite ni redirect.
    **Criterio de que el desarrollo local no cambió.**
12. Host `la-birra.comandapp.ar` + `/admin/pedidos` → 308 a
    `https://comandapp.ar/admin/pedidos`.
13. `previewFrameHeaders()` y el redirect apex→subdominio usan **la misma
    constante** de segmento reservado. El test falla si divergen.
14. **Cobertura**: un test enumera los directorios de ruta reales bajo
    `src/app/[store]/` y falla si alguno no tiene entrada en la tabla de
    rewrites. Convierte "me olvidé de agregar la ruta nueva" en un test rojo en
    vez de una página muerta en producción.
15. `allowedDevOrigins` no cambió respecto de `main`.

**Fuera de alcance**: no tocar los headers de seguridad salvo para extraer la
constante compartida. No agregar CSP. No tocar `images`, `remotePatterns` ni
`deviceSizes`. **No migrar nada a `vercel.json` ni a `vercel.ts`.**

**Skills obligatorias**: `context7` (MCP) para la API de `rewrites`/`redirects`
de Next 16; lectura obligatoria de
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`.

---

## T5 — Rewire de las URLs absolutas de salida

**Lane**: `backend` · **Agente**: `senior-backend-engineer` · **Depende de T4**
**⚠ No arranca hasta que el slice de repartidores/métricas esté integrado** (ver
la nota de colisión arriba: `src/models/courier.model.ts` está modificado).

**Archivos que posee en exclusiva**

- `src/controllers/checkout.controller.ts`
- `src/controllers/kitchen.controller.ts`
- `src/controllers/admin.actions.ts`
- `src/models/courier.model.ts`
- `src/models/platform.model.ts`
- `src/services/payments/payment.port.ts`
- `src/services/payments/mercadopago.adapter.ts`
- `src/services/notifications/email/owner-invite.tsx`
- `src/services/notifications/email/courier-invite.tsx`
- `src/app/admin/(app)/pagos/page.tsx`

**No puede tocar**: `src/lib/urls.ts` ni los env (T4), `next.config.ts` (T3),
nada de `src/views/`, ni `src/app/[store]/`, ni `src/app/pedido/`, ni `tests/`.

**Objetivo**

Reemplazar los 9 usos de `serverEnv().NEXT_PUBLIC_SITE_URL` por `apexUrl()` o
`storeUrl()` según la tabla de `00-architecture.md` §3.2. Ningún uso queda como
concatenación cruda.

**Al APEX** (`apexUrl`): `admin.actions.ts:127` (`emailRedirectTo`),
`courier.model.ts:81`, `platform.model.ts:343`,
`app/admin/(app)/pagos/page.tsx:12`, `mercadopago.adapter.ts:198`
(`notification_url`), y el prop `siteUrl` de los dos adapters de mail de
invitación.

**Al SUBDOMINIO** (`storeUrl(slug, ...)`): `checkout.controller.ts:65` y `:110`,
`kitchen.controller.ts:58` y `:108`, `mercadopago.adapter.ts:176` (`back_urls`).

**Cambio de contrato del port de pagos**

`PaymentProvider.createCheckout` gana un campo `storeSlug: string` en su objeto
de parámetros, al lado de `storeName`. Lo necesita el adapter para armar
`back_urls` con `storeUrl`. El único call site es
`checkout.controller.ts:183`, que ya tiene `store` en scope. Documentar en el
port **por qué** el adapter necesita el slug: arma la URL de regreso del
cliente, y esa URL tiene que caer en el mismo origen donde vive su carrito
(`00-architecture.md` §2.2).

`kitchen.controller.ts` ya tiene el slug: `getOrderWithStoreById` devuelve
`{ order, store }`.

**Criterios de aceptación (spec del `test-engineer`)**

1. En modo `subdomain`, `back_urls.success/pending/failure` de la preferencia de
   MP apuntan a `https://<slug>.comandapp.ar/pedido/<token>` — los tres.
2. En el mismo caso, `notification_url` apunta a
   `https://comandapp.ar/api/webhooks/mercadopago?store_id=<id>`. **Host distinto
   al de `back_urls`, a propósito.**
3. En modo `path`, las dos vuelven a la forma de hoy: sin regresión.
4. `back_urls` y `notification_url` son siempre `https://` en modo `subdomain`
   (MP rechaza HTTP con 400 desde 2025-03-29 y no admite `localhost` en
   `back_urls`).
5. El `trackingUrl` del comprobante, de la confirmación por WhatsApp, del
   "pedido listo" y del "salió tu pedido" apunta al **subdominio de la tienda
   del pedido**, no al apex ni al de otra tienda.
6. `emailRedirectTo` del magic link apunta al **apex**, para las dos superficies
   (`admin` y `courier`), y conserva el `?next=/repartidor` de la variante
   courier.
7. Las URLs de invitación de dueño y de repartidor apuntan al apex.
8. La URL de webhook que `/admin/pagos` le muestra al dueño apunta al apex.
9. **Ningún archivo de `src/` fuera de `src/lib/urls.ts` referencia
   `NEXT_PUBLIC_SITE_URL` directamente para construir una URL.** Test de
   barrido; garantiza que no quedó un call site sin migrar.
10. Ninguna de estas rutas cambia de comportamiento cuando la notificación
    falla: un mail o un WhatsApp que revientan siguen sin revertir el pedido
    (los `try/catch` existentes no se tocan).

**Fuera de alcance**: no cambiar plantillas de mail (`src/emails/*`), no tocar
`supabase/templates/magic-link.html` (usa `{{ .SiteURL }}` y ya es correcto), no
tocar la lógica de idempotencia ni de estados.

**Skills obligatorias**: `context7` (MCP) antes de tocar cualquier API del SDK
de Mercado Pago; `supabase` para lo de `emailRedirectTo` / `signInWithOtp`.

---

## T6 — Links internos de la vitrina relativos al host

**Lane**: `frontend` · **Agente**: `frontend-react-craftsman` · **Depende de T4**

**Archivos que posee en exclusiva**

- `src/views/storefront/store-base-path.tsx` (nuevo)
- `src/app/[store]/layout.tsx`
- `src/app/[store]/checkout/page.tsx`
- `src/app/mis-pedidos/page.tsx`
- `src/views/storefront/store-chrome.tsx`
- `src/views/storefront/store-dock.tsx`
- `src/views/storefront/product-card.tsx`
- `src/views/storefront/product-detail.tsx`
- `src/views/storefront/cart-view.tsx`
- `src/views/storefront/checkout-form.tsx`
- `src/views/storefront/my-orders.tsx`

**No puede tocar**: `src/lib/urls.ts` (T4), `next.config.ts` (T3),
`src/app/pedido/**` (T7), nada de `src/controllers/`, `src/models/`,
`src/services/`, `tests/`.

**Objetivo**

Hoy diez `href` construyen `` `/${slug}/...` ``. En un subdominio eso navega a
`la-birra.comandapp.ar/la-birra/carrito`, el rewrite lo vuelve
`/la-birra/la-birra/carrito` y **es 404**. El prefijo tiene que salir del host,
no de una constante.

**Diseño**

- `src/app/[store]/layout.tsx` (Server Component) lee el host con `headers()` y
  calcula `storeBasePath(store.slug, host)` (contrato de T4). Lo provee a todo
  el árbol con un provider nuevo, `StoreBasePathProvider`, en
  `store-base-path.tsx`, más un hook `useStoreBasePath()` y un helper
  `storeHref(basePath, path)`.
  - `headers()` no cambia la estrategia de render: `/[store]/*` ya es dinámica
    de punta a punta (usa el cliente de Supabase con cookies). Verificarlo, no
    asumirlo.
  - El provider tiene que envolver a `StoreChrome` y a `children`.
- Los siete archivos de `views/storefront/` cambian
  `` href={`/${slug}/carrito`} `` por `href={storeHref(basePath, '/carrito')}`.
  Ninguno arma el prefijo a mano.
- `src/app/[store]/checkout/page.tsx` (Server Component) puede calcular su
  `basePath` igual que el layout, o recibirlo — el agente decide, pero no
  duplica la lógica de derivación.
- `src/app/mis-pedidos/page.tsx` vive **fuera** de `/[store]`, así que no tiene
  el provider: lee el host por su cuenta y le pasa a `MyOrders` lo que necesita
  para armar el link de "Reiterar". En un host de tenant ese link es
  `/?reorder=<token>`; en el apex y en local, `` /${storeSlug}?reorder=<token> ``.

**Contratos a respetar**

- Las primitivas de `src/views/shared/surfaces.tsx` (`Panel`, `PhotoFrame`,
  `Stepper`, `ActionBar`, `CategoryRail`, `OptionRow`, `StatusPill`…) **no
  cambian**. Esto es plomería de URLs: **cero cambios visuales**. Si algo se ve
  distinto después, es un bug de esta tarea.
- No se toca `src/lib/preview-mode.ts` ni `preview-bridge.tsx`. El modo vista
  previa tiene que seguir funcionando **path-based en el apex dentro del
  iframe**, y el diseño derivado del host es lo que lo garantiza solo: ahí el
  host es el apex, así que el `basePath` sale `` `/${slug}` `` y los links del
  iframe siguen siendo los de hoy.
- El vocabulario nuevo (`useStoreBasePath`, `storeHref`) es de presentación:
  **no va a `src/models/types.ts`**.

**Criterios de aceptación (spec del `test-engineer`)**

1. Con host `la-birra.comandapp.ar`, todo `href` interno de la vitrina empieza
   en `/` y **no** contiene el slug: `/carrito`, `/checkout`, `/producto/42`, `/`.
2. Con host `comandapp.ar` (path-based), los mismos `href` son idénticos a los
   de hoy: `/la-birra/carrito`, etc. **Cero regresión.**
3. Con host `localhost:3000`, ídem. **Criterio de que el desarrollo local no
   cambió.**
4. Con host de preview (`*.vercel.app`), se comporta como path-based.
5. **Barrido**: ningún archivo de `src/views/storefront/**` ni de
   `src/app/[store]/**` construye un `href` con el slug interpolado a mano. Test
   de fuente; es la red que atrapa un call site olvidado.
6. Dentro del iframe de vista previa (host apex + `?preview=brand`), navegar del
   catálogo a un producto sigue funcionando y sigue siendo mismo origen.
7. `/mis-pedidos` en un host de tenant: "Reiterar" apunta a `/?reorder=<token>`.
   En el apex: `` /<storeSlug>?reorder=<token> ``.
8. No hay error de hidratación: el `basePath` viene del servidor, así que el
   primer render del cliente coincide.
9. Todos los targets táctiles siguen en 44px mínimo y ningún `<Link>` pierde su
   `aria-label`.

**Fuera de alcance**: no rediseñar nada, no tocar tipografía, color, motion ni
composición. No agregar `sitemap`/`robots`. **No reabrir la decisión de
identidad visual: no correr `context.mjs` ni `concept-seed.mjs`.**

**Skills obligatorias**:
- `impeccable`, con lectura previa de
  `.claude/skills/impeccable/reference/craft-floor.md`.
- `web-design-guidelines` antes de cerrar el slice.
- `vercel-react-best-practices` (Server vs Client Components, `headers()` y
  render dinámico).
- `context7` (MCP) antes de usar cualquier API de Next 16 o React 19.
- Brief de superficie: `.impeccable/surfaces/src-app-store-page-tsx.md`.

---

## T7 — Coherencia host ↔ pedido en el seguimiento

**Lane**: `frontend` · **Agente**: `frontend-react-craftsman` · **Depende de T4**

**Archivos que posee en exclusiva**

- `src/app/pedido/[token]/page.tsx`

**No puede tocar**: nada más. En particular **no** `src/lib/cart.tsx` — el
comportamiento de `clearResolvedOrderCart` no cambia; lo que cambia es el origen
desde el que se lo llama, y eso lo resuelve T5.

**Objetivo**

`/pedido/[token]` no se reescribe: se sirve tal cual en cualquier host. Eso está
bien y es deliberado (mantiene el seguimiento en el mismo origen que el
carrito), pero deja abierto que
`otra-tienda.comandapp.ar/pedido/<token-de-la-birra>` renderice el tema de La
Birra bajo el host de otra tienda **y escriba en el `localStorage`
equivocado**.

Resolver: leer el host, y si es un host de tenant cuyo slug no es
`order.storeSlug`, `permanentRedirect` a
`storeUrl(order.storeSlug, '/pedido/' + token)`. Si el host es el apex o
`localhost`, no redirigir. Aprovechar y setear `metadataBase`.

**Criterios de aceptación (spec del `test-engineer`)**

1. `la-birra.comandapp.ar/pedido/<token de La Birra>` → 200, sin redirect.
2. `otra.comandapp.ar/pedido/<token de La Birra>` → redirect permanente a
   `https://la-birra.comandapp.ar/pedido/<token>`.
3. `comandapp.ar/pedido/<token>` → 200, sin redirect.
4. `localhost:3000/pedido/<token>` → 200, sin redirect. **El comportamiento en
   desarrollo es exactamente el de hoy.**
5. Un token inexistente sigue mostrando el `EmptyState` de "No encontramos este
   pedido" **antes** de cualquier lógica de host: nunca se filtra por redirect si
   un token existe o no. **Esto es un requisito de seguridad**, no de UX: el
   `public_token` es la única credencial del pedido y un redirect condicional a
   su existencia sería un oráculo.
6. El tema del local se sigue inyectando igual y el pie sigue heredándolo.
7. `metadataBase` corresponde al origen efectivo del pedido.

**Fuera de alcance**: no tocar `OrderTracking`, ni el polling, ni
`clearResolvedOrderCart`.

**Skills obligatorias**: `impeccable` +
`.claude/skills/impeccable/reference/craft-floor.md`;
`vercel-react-best-practices`; `context7` (MCP) para `permanentRedirect` y
`headers()` en Next 16.

---

## T2 — Extender `RESERVED_SLUGS` en TypeScript

**Lane**: `shared` (lo ejecuta `senior-backend-engineer`)

**Archivos que posee en exclusiva**

- `src/models/schemas/platform.schema.ts`

**No puede tocar**: `supabase/migrations/**` (es T1, del hilo principal), ni
nada más.

**Objetivo**

Un slug ahora es un hostname. Agregar a `RESERVED_SLUGS` las categorías de
`00-architecture.md` §5.5 (correo/entrega, DNS/red, entornos, CDN/assets,
identidad/pagos, observabilidad, marca/proveedores, superficie de cliente). La
lista final **tiene que ser idéntica, entrada por entrada, a la del CHECK de
T1** — esa paridad es un test (T9).

Actualizar el comentario del bloque: la lista ahora protege **hostnames**, no
solo paths, y el riesgo cambió — ya no es una tienda inalcanzable sino un
conflicto entre un registro DNS de la plataforma y un tenant vivo.

Agregar en `slugSchema` un comentario corto: cualquier cambio a ese regex es
ahora un cambio de superficie DNS. **No cambiar el regex** — ya produce labels
DNS válidos (sin guion inicial/final, sin `--`, ≤60 < 63 caracteres).

**Criterios de aceptación**

1. El mensaje de error de slug reservado no cambia: "Esa dirección está
   reservada por la plataforma: elegí otra".
2. `RESERVED_SLUGS` sigue siendo `as const` y no gana duplicados.
3. Ningún slug del seed local queda invalidado (`la-birra` sigue siendo válido).
4. **Paridad TS ↔ DB**: hay un test en `tests/db/` que lee la definición del
   CHECK y compara conjunto contra conjunto. Falla si divergen.

**Fuera de alcance**: no escribir la migración, no correr `db:reset`.

**Skills obligatorias**: `supabase-postgres-best-practices` **antes** de
proponer la lista final (aunque no escriba SQL, la lista es el contenido de una
constraint).

---

## T1 — Migración: CHECK de slugs reservados

**Lane**: `schema` · **DUEÑO: EL HILO PRINCIPAL. Ningún agente escribe esto.**

**Archivo**: `supabase/migrations/<timestamp>_reserve_subdomain_slugs.sql` (nuevo)

**Qué tiene que contener** (descripción, no SQL):

- `drop constraint if exists stores_slug_not_reserved_check` y volver a crearlo
  con la lista extendida de §5.5, **idéntica** a `RESERVED_SLUGS` de T2.
- Comentario de cabecera explicando el cambio de naturaleza: la lista pasa de
  proteger paths a proteger **hostnames de `comandapp.ar`**, y el riesgo nuevo
  es un conflicto entre un registro DNS de la plataforma (Resend, CDN, staging)
  y una tienda ya dada de alta. Reiterar la regla de que se agrega en los dos
  lados.
- Se mantiene el `not in (...)` en vez de una tabla: una tabla sería una tercera
  fuente de verdad y necesitaría RLS y grants propios; un CHECK no se puede
  esquivar por ningún camino y no tiene superficie de API.

**Seguridad de la migración**: `add constraint` valida contra las filas
existentes. El proyecto hosted está vacío (cero migraciones, sin tabla `stores`)
y el seed local usa `la-birra`, que no colisiona. Reversible: la migración
inversa es el CHECK anterior.

**Precondición**: correr `mcp__supabase__get_advisors` después de aplicar.

---

## T8 — Documentación

**Lane**: `shared` · **DUEÑO: EL HILO PRINCIPAL** (CLAUDE.md no lo edita un
agente). Va al final, con T1–T7 integradas.

**Archivo**: `CLAUDE.md`

Qué tiene que quedar escrito:

- La sección "Próxima iteración: subdominio por local" pasa de *decidido* a
  *implementado*, con el mapa de hosts de §5.1.
- **Que el subdominio NO se prueba en local, a propósito**, y que en desarrollo
  todo sigue path-based en `localhost:3000/[slug]`. Escribirlo explícitamente
  para que nadie lo lea como un bug y agregue hosts locales "para arreglarlo".
  Con eso, la verificación previa a producción son los tests de configuración de
  T3 más el checklist de smoke de `00-architecture.md` §7.
- **Por qué el routing vive en `next.config.ts`**, con las tres alternativas y
  por qué se descartaron. Sin esto, alguien va a "simplificar" moviéndolo:
  - `vercel.json` **no puede**: sus `rewrites` corren después del filesystem
    (*"precedence is given to the filesystem prior to rewrites being applied"*),
    así que `source: "/"` no dispara y cada tienda serviría la landing de la
    plataforma en su home. Vercel además documenta que mezclar routing de
    `vercel.json` con Next.js *"creates conflicts"*.
  - `vercel.ts` no resuelve eso y habría obligado a migrar los 4 crons.
  - **`proxy.ts` sí puede, y de hecho es lo que Vercel recomienda** para
    multi-tenant por subdominio. Se descartó igual, y hay que dejar escrito el
    motivo real: es la única opción **no testeable como dato en CI**, y con el
    subdominio sin ejercitarse en local ni en preview esa es la única
    verificación previa que existe. Más el blast radius de un archivo que hoy
    tiene un solo trabajo. **Anotar también que el motivo original —"costaría
    una invocación por request"— es falso**: el matcher del proxy ya matchea
    esas rutas.
- **La invariante de cookies**: nunca pasar `cookieOptions.domain` a
  `createServerClient`/`createBrowserClient`. `@supabase/ssr` 0.12.5 lo soporta;
  lo único que nos salva es no usarlo, y hay un test que lo custodia.
- **Nunca agregar un wildcard `*.comandapp.ar` a las Redirect URLs de Supabase
  Auth**, con el motivo (§3.5).
- Trampas nuevas, en la sección de trampas conocidas:
  - `beforeFiles` corre antes de `_next/static`: un rewrite catch-all mata la
    hidratación sin un error visible.
  - `beforeFiles` es también lo único que puede pisar un archivo de página, y
    por eso el rewrite de `/` va ahí.
  - Next le saca el puerto al Host antes de matchear `has: {type:'host'}`.
  - `next.config.ts` no ve los `.env`, por eso el routing es host-gated y no
    env-gated.
  - Mover los nameservers a Vercel sin recrear los registros de Resend apaga el
    magic link, o sea la única puerta a `/admin`.
  - `/.well-known` está reservado en Vercel y no se puede reescribir.
- Las precondiciones operativas P1–P6 y el checklist de smoke de §7.

---

## T9 — Suite de tests

**Lane**: `tests` · **Agente**: `test-engineer` · **Dueño exclusivo de `tests/**`**

Corre después de T2–T7. Los criterios de aceptación de cada tarea son la
especificación; acá va solo lo que necesita tratamiento especial.

**Contexto que cambia la prioridad**: con el flujo local fuera de alcance, el
rewrite por host **no se ejercita en ningún entorno antes de producción**
(`00-architecture.md` §2.6). Estos tests dejan de ser una red adicional y pasan
a ser la verificación principal. Escribirlos completos, no representativos.

**Tests que solo se pueden probar contra una base real → `tests/db/`**

- **Paridad `RESERVED_SLUGS` ↔ `stores_slug_not_reserved_check`**: leer la
  definición de la constraint de `pg_constraint` y comparar el conjunto contra
  la constante de TypeScript. Mismo patrón que el test que ya compara
  `ALLOWED_TRANSITIONS` contra el trigger.
- **La constraint rechaza de verdad**: un `insert` directo de una tienda con
  slug `mail` (o cualquiera de los nuevos) tiene que rebotar con `23514`, no con
  un error de Zod. La defensa es de la base, no del schema.

**Tests que no necesitan base**

- Toda la tabla de rewrites/redirects de T3 (15 criterios), evaluando la config
  exportada. **Incluye afirmar la fase `beforeFiles`**, no solo la existencia de
  la entrada: es lo que separa "funciona" de "cada tienda sirve la landing".
- El módulo de T4 en sus dos modos.
- El adapter de MP: hosts de `back_urls` vs `notification_url`.
- Los barridos de fuente: ningún `NEXT_PUBLIC_SITE_URL` fuera de
  `src/lib/urls.ts`; ningún slug interpolado a mano en un `href` de la vitrina.
- **Cobertura de rutas**: enumerar `src/app/[store]/` y exigir entrada en la
  tabla de rewrites.

**El test de cookies, con cuidado**

No alcanza un grep. El test correcto **corre `proxy()`** con un `NextRequest`
falso que trae cookies de sesión, y afirma que **ningún `Set-Cookie` de la
respuesta trae el atributo `Domain=`**. Prueba el comportamiento real por el
camino real, y falla el día que alguien agregue `cookieOptions` a cualquiera de
las tres fábricas de cliente. Agregar además el caso de
`src/lib/supabase/server.ts`.

**Lo que NO se puede probar en CI**

Va como checklist de deploy en el reporte final, no como test. Es el checklist
de smoke de `00-architecture.md` §7 (9 puntos), y con el alcance recortado **es
obligatorio**, no opcional: el certificado wildcard, el home de la tienda en su
subdominio, el 308 del apex, la vista previa de marca, el 404 de slug
inexistente, un pago real de MP volviendo al subdominio con el carrito vaciado,
y un magic link real entrando al apex.

**Skills obligatorias**: `supabase-postgres-best-practices` antes de escribir
los tests de `tests/db/`; `supabase` para el test del proxy y las cookies.
