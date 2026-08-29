# T4 — Autoridad de URLs (`src/lib/urls.ts` + contrato de entorno)

**Lane**: backend · **Agente**: senior-backend-engineer · **Estado**: hecho.

Este documento es el contrato que T5/T6/T7 consumen. Si algo de acá no
alcanza, es un problema de T4 y se reporta contra este archivo, no se
reinventa localmente.

## Archivos tocados

- `src/lib/urls.ts` — **nuevo**. Toda la API pública descrita abajo.
- `src/lib/env.server.ts` — agregada `NEXT_PUBLIC_STORE_HOST_MODE` al
  `serverSchema`, y estrechado el comentario de `NEXT_PUBLIC_SITE_URL`.
- `src/lib/env.client.ts` — mismo agregado en `clientSchema` (ambos schemas la
  necesitan, igual que ya pasaba con `NEXT_PUBLIC_SITE_URL`).
- `.env.example` — documentada la variable nueva y estrechado el comentario de
  `NEXT_PUBLIC_SITE_URL`.

No toqué nada más. En particular no toqué `next.config.ts` (T3), ni
`src/controllers/**`, `src/views/**`, `src/app/**`, `supabase/**`.

**Nota de convivencia**: mientras trabajaba, otro slice (rate-limiting) tenía
`src/views/admin/catalogo/image-upload.ts` modificado y agregó
`src/models/rate-limit.model.ts` en el mismo working tree — no son míos, no
los toqué, los dejé como estaban.

## Variable de entorno nueva — cargarla en Vercel

**`NEXT_PUBLIC_STORE_HOST_MODE`**

- Schema: `z.enum(['subdomain', 'path']).default('path')`, en **los dos**
  schemas (`env.server.ts` y `env.client.ts`), tal como ya estaba duplicada
  `NEXT_PUBLIC_SITE_URL`.
- **Production**: `subdomain` — pero recién cuando el dominio wildcard de
  `comandapp.ar` esté con los nameservers en Vercel y el certificado wildcard
  emitido (bloqueante nombrado en `00-architecture.md` §3.4). Hasta ese
  momento, dejarla sin setear en Production también, para no romper nada.
- **Preview**: no se setea. Cae al default `path`, que es el comportamiento de
  hoy y lo que mantiene vivos los preview deployments (nunca quedan bajo el
  wildcard).
- **Local**: no se setea. Nunca. El flujo local con subdominios está fuera de
  alcance de este plan.

No agregué `NEXT_PUBLIC_STORE_DOMAIN` ni ninguna otra variable: el host del
apex se deriva de `NEXT_PUBLIC_SITE_URL`, como pide el plan.

## API pública de `src/lib/urls.ts`

Módulo **isomórfico a propósito**: no lleva `import 'server-only'`. Lee
`clientEnv` (no `serverEnv()`) porque las dos variables que usa
(`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_STORE_HOST_MODE`) ya son `NEXT_PUBLIC_*`
— ya viajan al bundle del browser sin este módulo — así que exigir
`server-only` acá solo le negaría el módulo a las Client Components que arman
un `href` interno (T6) sin ganar nada de superficie de secretos a cambio.

```ts
function apexUrl(path: string): string
function storeUrl(slug: string, path: string): string
function parseStoreHost(host: string | null): string | null
function storeBasePath(slug: string, host: string | null): string
```

### `apexUrl(path: string): string`

Origen + path del **apex**, siempre, en cualquier modo de host. Todo lo que es
de plataforma va acá: magic link, `emailRedirectTo`, `notification_url` de MP,
invitaciones, la URL de webhook que se le muestra al dueño en `/admin/pagos`.

Internamente usa `new URL(NEXT_PUBLIC_SITE_URL).origin`, así que si algún
`.env` trae un path o una barra de más colgando en esa variable, se descarta
solo — `apexUrl` **nunca** puede devolver un host ni un path que no sean los
del apex.

### `storeUrl(slug: string, path: string): string`

Origen + path de **una tienda**. Es la única función que mira
`NEXT_PUBLIC_STORE_HOST_MODE`:

- `subdomain`: `https://<slug>.<hostname del apex><path>`, conservando
  protocolo y puerto del apex.
- `path` (default): `<apex>/<slug><path>` — el comportamiento de hoy, sin
  cambios.

Va acá: `trackingUrl` del comprobante/WhatsApp/"pedido listo", y sobre todo
`back_urls` de Checkout Pro (T5) — es el regreso del cliente después de pagar,
y ahí corre `clearResolvedOrderCart`; si `storeUrl` devolviera el apex en vez
del subdominio, ese vaciado correría en el origen equivocado (ver §2.2 de
`00-architecture.md`, ya la conocen T5/T7 pero lo repito acá porque es la
razón de ser de que existan DOS funciones y no una con un flag).

### `parseStoreHost(host: string | null): string | null`

Slug de tienda a partir de un header `Host`, o `null` si el host es el apex,
un host de preview, `localhost`, o cualquier cosa que no sea un subdominio de
tienda válido.

Puntos de diseño que T6/T7 necesitan saber:

- **El apex no está hardcodeado como `'comandapp.ar'`.** Se deriva de
  `new URL(NEXT_PUBLIC_SITE_URL).hostname`. Por eso en local (apex =
  `localhost`) y en preview (apex = `<proyecto>-<hash>.vercel.app`) esta
  función nunca encuentra un subdominio de tienda, sin ningún `if` de entorno
  — el mismo mecanismo que hace que el módulo entero sea inerte fuera de
  producción.
- Tolera puerto en el host (`headers().get('host')` lo trae así en algunos
  contextos): lo pela con `host.split(':')[0]` antes de comparar.
- Un solo nivel de subdominio: `a.b.comandapp.ar` → `null`. Un slug es siempre
  una sola etiqueta.
- **Reusa `RESERVED_SLUGS` de `src/models/schemas/platform.schema.ts`** — no
  la duplica. `www.comandapp.ar` → `null` porque `'www'` ya está en esa lista.
  Es una importación de solo lectura (`src/models` no es mío para editar, pero
  para importar no hay restricción y evita una tercera copia de la lista, que
  el propio `CLAUDE.md` ya trata como una fuente de verdad compartida entre TS
  y SQL).
- No cubre `.localhost`: fuera de alcance, como pide el plan.

### `storeBasePath(slug: string, host: string | null): string`

`''` cuando `host` ya es el subdominio de ESE slug (el rewrite de
`next.config.ts` — T3 — ya puso al usuario en el árbol correcto, anteponer
`/slug` otra vez duplicaría el path exactamente como describe §2.1 de
`00-architecture.md`); `/${slug}` en cualquier otro caso, **incluido el host
de otra tienda** — no asume que cualquier host de tenant matchea el slug que
se está armando.

Implementación: `parseStoreHost(host) === slug ? '' : '/'+slug`. Es
literalmente eso, un one-liner sobre `parseStoreHost` — no hay lógica
adicional escondida.

## Cómo se obtiene `host` en el caller (para T6/T7)

Verificado contra la doc de Next 16 vía Context7 (`/vercel/next.js/v16.1.6`,
`headers.mdx`): `headers()` es **async**, y solo puede usarse en Server
Components, Server Actions, Route Handlers y `proxy.ts` — **no existe en
Client Components**. Consecuencia práctica para T6/T7:

```ts
// en una Server Component (layout o page de /[store]/*)
const h = await headers()
const basePath = storeBasePath(store.slug, h.get('host'))
```

y ese `basePath` (un string ya resuelto, no una función) es lo que se pasa
como prop a las Client Components que arman `href`. Ninguna Client Component
debería llamar `storeBasePath`/`parseStoreHost` con un host propio: no tienen
acceso al header `Host` de ningún modo (ver `impeccable`/`vercel-react-best-
practices`: el dato de request vive en el server, no se re-deriva en cliente).

## Criterios de aceptación verificados a mano

Repasé la tabla completa de §T4 en `01-tasks.md` contra la implementación
línea por línea (no hay test que corra esto todavía — T9 lo hace):

1. Modo `path`, apex `https://comandapp.ar`: `storeUrl('la-birra','/pedido/x')`
   → `https://comandapp.ar/la-birra/pedido/x`. ✓ (`origin + '/la-birra' +
   '/pedido/x'`, sin normalización de doble barra porque el path ya trae un
   solo `/` inicial).
2. Modo `subdomain`, mismo apex → `https://la-birra.comandapp.ar/pedido/x`. ✓
3. Modo `path`, apex `http://localhost:3000` →
   `http://localhost:3000/la-birra/carrito`. Sin cambios respecto de hoy. ✓
4. `apexUrl` nunca devuelve host de tienda, en ningún modo: no lee
   `hostMode()` en absoluto, así que no hay rama que pueda hacerlo. ✓
5. `parseStoreHost`: los 7 casos de la tabla (`la-birra.comandapp.ar` →
   `'la-birra'`; `comandapp.ar` → `null`; `www.comandapp.ar` → `null`;
   `localhost:3000` → `null`; `proyecto-abc-scope.vercel.app` → `null`;
   `a.b.comandapp.ar` → `null`; `null` → `null`). Los siete están cubiertos
   por las cuatro ramas de la función (host nulo, host === apex, host no
   termina en `.<apex>`, label con punto o reservado). ✓
6. `storeBasePath` con los 4 casos de la tabla, incluido "host de otra tienda
   no asume prefijo vacío". ✓ (es consecuencia directa de que `storeBasePath`
   compara CONTRA el slug pedido, no solo pregunta "¿es un host de tenant?").
7. Sin `NEXT_PUBLIC_STORE_HOST_MODE` seteada: el default de Zod (`'path'`) la
   resuelve antes de que `hostMode()` la lea. No tira. ✓
8. Sin doble barra ni pérdida de query: `normalizePath` exige exactamente un
   `/` inicial y trata `''`/`'/'` como "nada que agregar"; todo lo que venga
   después (incluida una query string) viaja intacto porque nunca se parsea,
   solo se concatena. ✓

## Qué necesita una base real para probarse

Nada de este módulo toca Postgres ni RLS — es una función pura sobre strings
y `process.env`. Todo lo verificable arriba se prueba con vitest normal
(dominio del `test-engineer`), sin Docker. No hay nada que enrutar a
`tests/db/`.

## Decisiones y trade-offs

- **`clientEnv` en vez de `serverEnv()`**: la alternativa (marcar `urls.ts`
  como `server-only` y forzar a T6/T7 a resolver `storeBasePath` server-side y
  pasar el string ya armado) es la que terminé recomendando igual para
  `parseStoreHost`/`storeBasePath` — porque `headers()` no existe en cliente,
  no porque el módulo lo exija. Pero `apexUrl`/`storeUrl` sí tiene sentido que
  una Client Component los llame directo (por ejemplo, para armar un `href`
  con el slug que ya tiene en las props, sin ningún dato de request), así que
  el módulo entero se dejó isomórfico y la restricción real (necesitás el
  header `Host`, que es server-only) queda documentada, no forzada por un
  import que rompería casos legítimos.
- **`apexOrigin()` recalcula `new URL(...)` en cada llamada** en vez de
  cachear el resultado a nivel de módulo. Es barato (parseo de una URL corta)
  y evita un estado mutable compartido entre requests en el mismo proceso —
  no hay ninguna razón de performance para cachearlo y sí una de simplicidad
  para no hacerlo.
- **Reusar `RESERVED_SLUGS` importando `platform.schema.ts`** en vez de
  copiar `'www'` a mano en `urls.ts`. La alternativa (una constante propia)
  era más aislada pero creaba una tercera fuente de verdad para algo que
  `CLAUDE.md` ya trata como una lista que se actualiza en dos lugares (TS +
  SQL) a propósito; agregar un tercero por conveniencia local iba en contra
  de esa disciplina. El import es de solo lectura y no crea ciclo (`models` no
  importa de `lib/urls.ts`).
- **No agregué caché ni memoización a `apexUrl`/`storeUrl`**: son funciones
  puras baratas, llamarlas por request no es un problema de performance real
  en este dominio (comparado con, por ejemplo, una query a Postgres).

## Qué NO hice (fuera de alcance, explícito)

- No toqué ningún call site de `NEXT_PUBLIC_SITE_URL` (`courier.model.ts`,
  `platform.model.ts`, `checkout.controller.ts`, `kitchen.controller.ts`,
  `admin.actions.ts`, `mercadopago.adapter.ts`, `owner-invite.tsx`,
  `courier-invite.tsx`, `src/app/admin/(app)/pagos/page.tsx`) — eso es T5.
  Los nueve usos siguen leyendo `serverEnv().NEXT_PUBLIC_SITE_URL` tal como
  estaban; el contrato de reemplazo es: los que la doc marca "van al APEX"
  pasan a `apexUrl(path)`, los que van "al SUBDOMINIO de la tienda" pasan a
  `storeUrl(slug, path)` (ver la tabla completa en `00-architecture.md` §3.2).
- No toqué ningún `href` interno de la vitrina (T6) ni la verificación de
  coherencia host↔pedido (T7).
- No toqué `next.config.ts` (T3) ni `package.json`/`vercel.json`.
- No agregué `NEXT_PUBLIC_STORE_DOMAIN` ni ningún otro env var nuevo.

## Verificación

- `npm run typecheck` → limpio.
- `npm run lint` → limpio (los 6 warnings preexistentes en `tests/**` no son
  míos, confirmado con `git stash` + rerun antes de mi cambio).
- `npm test` → 3 archivos con 8 tests fallando, **preexistentes y ajenos a
  este slice**: `platform-owner-invite.model.test.ts` (mock de
  `supabase.auth.getClaims` roto) y `owner-invite-email.adapter.test.ts`
  (formato del `idempotencyKey`). Confirmado con `git stash` de mis 3 archivos
  tocados + `npm test`: los mismos 8 tests fallan igual sin mi cambio en el
  árbol. No los toqué — son de otro slice en vuelo (rate-limiting) y no son
  míos para arreglar ni para reportar acá más que como aviso de que ya
  fallaban antes de que yo empezara.
