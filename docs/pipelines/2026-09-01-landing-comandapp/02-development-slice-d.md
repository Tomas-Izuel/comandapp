# Slice D — Página, SEO y datos estructurados

Agente: `senior-backend-engineer`. Dueño exclusivo de `src/app/page.tsx`,
`src/app/robots.ts`, `src/app/sitemap.ts`, `src/lib/seo.ts`. No se tocó ningún
otro archivo.

## Qué se construyó

### `src/app/page.tsx`

Routing fino: cuelga `data-comandapp` (atributo booleano, igual convención que
`data-store-theme` en `src/app/[store]/layout.tsx`) en el `<div>` raíz y
compone las once secciones en el orden exacto del contrato de `01-tasks.md`:
`LandingBar` · `LandingHero` · `TodayVersus` · `WhatsIncluded` ·
`ThreeScreens` · `WhatOnlyComandApp` · `DeliverySection` · `Pricing` · `Faq` ·
`Closing` · `LandingFooter`. Cero markup de presentación propio, cero data
fetching, cero `'use client'`.

Exporta `metadata: Metadata` (estático, no `generateMetadata`, para que la ruta
se pueda prerenderizar en build):

- `metadataBase: new URL(apexUrl('/'))` — usa la misma función que arma
  cualquier otro link de plataforma (`src/lib/urls.ts`), así que el origen de
  la preview de WhatsApp nunca puede divergir de `NEXT_PUBLIC_SITE_URL`
  (siempre el apex).
- `title` / `description` en español rioplatense, describiendo lo que el
  producto realmente hace (catálogo, Mercado Pago propio del local, delivery
  con repartidores propios, panel de cocina, 15 días sin cargo). Cero cifra de
  uso.
- `alternates.canonical: '/'` — se resuelve contra `metadataBase`.
- `openGraph`: `url: '/'`, `siteName`, `locale: 'es_AR'`, `type: 'website'`,
  imagen `/landing/og.jpg` 1200×630 con `alt` descriptivo.
- `twitter`: `card: 'summary_large_image'`, mismo título/descripción/imagen.

Inyecta los dos JSON-LD de `src/lib/seo.ts` con `<script
type="application/ld+json">` y `dangerouslySetInnerHTML` — es contenido propio
(`FAQ_ITEMS` y `PRICING`, ninguno viene del cliente), así que no hay superficie
de inyección.

### `src/lib/seo.ts`

Dos funciones puras, sin `schema-dts` (no es dependencia del proyecto, y son
solo dos objetos):

- `buildSoftwareApplicationJsonLd()` — `SoftwareApplication` con `offers` leído
  de `PRICING` (`@/lib/landing`). El precio pasa por `centsToDecimal()` de
  `src/lib/money.ts`, el mismo helper que usa el borde de Mercado Pago, para
  que el JSON-LD nunca reimplemente la conversión centavos→decimal a mano.
  `description` de la oferta menciona los 15 días de prueba en texto, porque
  no hay un campo de `Offer` que exprese "gratis N días y después este precio"
  sin forzar el dato. **Sin `aggregateRating`**: no hay reseñas.
- `buildFaqPageJsonLd(items: readonly Faq[])` — `FAQPage` armado directamente
  desde `FAQ_ITEMS` que exporta el Slice C (`@/views/landing/faq`). No
  duplica las preguntas: si el Slice C cambia una respuesta, el JSON-LD
  cambia solo.

### `src/app/robots.ts`

`MetadataRoute.Robots`. `allow: '/'`, `disallow` de `/admin`, `/backoffice`,
`/repartidor`, `/api` y `/pedido` (URLs de pedidos individuales con
`public_token` en el path — no son contenido, son una credencial; ver
`CLAUDE.md` §"Los dos identificadores del pedido"). El `disallow` de robots.txt
es un match de prefijo, así que `/admin` ya cubre `/admin/acceso` sin listar
cada subruta. `sitemap: apexUrl('/sitemap.xml')`.

### `src/app/sitemap.ts`

`MetadataRoute.Sitemap` con las tres rutas públicas y estáticas de plataforma:
`/`, `/legal/terminos`, `/legal/privacidad`. Sin `lastModified`: son páginas
versionadas en el repo, no contenido con fecha de publicación real.

Los dos derivan el origen con `apexUrl()` de `src/lib/urls.ts` — no se duplicó
lógica de origen; se reusó la función existente, que ya lee
`NEXT_PUBLIC_SITE_URL` y siempre devuelve el apex sin importar
`NEXT_PUBLIC_STORE_HOST_MODE`.

## Decisiones no obvias

- **`metadataBase` en el `page.tsx`, no en el root layout.** El root layout
  (`src/app/layout.tsx`) es compartido por `/admin`, `/backoffice`,
  `/[store]/**`, etc., y no es dueño de este slice. Como `metadataBase`
  aplica "al segmento actual y por debajo", declararlo en la página hoja
  alcanza para resolver `alternates.canonical` y las URLs de `openGraph` sin
  tocar un archivo que no es mío.
- **`disallow` de robots.txt sin sufijo `/*`.** Verificado contra la doc de
  Next 16 (`node_modules/next/dist/docs/.../robots.md`): el objeto es
  `{ userAgent, allow, disallow }` con strings de path, y el estándar de
  Robots Exclusion trata `disallow: '/admin'` como prefijo. No hace falta
  `/admin/*`.
- **Sin `schema-dts`.** El proyecto no lo tiene como dependencia y no se
  puede instalar (ningún agente corre `npm install`). Para dos objetos JSON-LD
  un `Record<string, unknown>` tipado a mano es proporcional; no se agregó una
  dependencia nueva para esto.
- **La descripción de la oferta en `Offer.description`, no un campo de precio
  separado.** Schema.org no tiene una forma limpia de expresar "gratis 15
  días, después $X/mes" sin inventar una estructura (`PriceSpecification` con
  fechas relativas no existe). Se optó por decirlo en texto dentro de la
  misma oferta en vez de forzar un campo que no le corresponde.
- **No se creó `src/app/opengraph-image.tsx` ni ningún generador de imagen.**
  El manifiesto de capturas de `01-tasks.md` dice que `og.jpg` la produce el
  hilo principal en `public/landing/`; la metadata solo referencia esa ruta.

## Build: no se pudo verificar íntegro

`npx tsc --noEmit` y `npx eslint` sobre mis cuatro archivos (`src/app/page.tsx`,
`src/app/robots.ts`, `src/app/sitemap.ts`, `src/lib/seo.ts`) están **limpios**:
cero error propio. Filtrando el output de `tsc --noEmit` para excluir
`views/landing/**` no queda ningún error.

`npm run build` falla, como se esperaba, porque los Slices A/B/C todavía no
existían en el momento de esta corrida: `Module not found` para los once
imports de `@/views/landing/*` (`landing-bar`, `hero`, `versus`, `included`,
`screens`, `edge`, `delivery`, `pricing`, `faq`, `closing`, `landing-footer`).
No se crearon stubs — la consigna es explícita en no taparlo. **Falta re-correr
`npm run build` una vez que los otros tres slices integren**, y ahí sí
verificar la línea que dice si `/` quedó `○ (Static)` / prerenderizada. Nada en
`page.tsx`, `robots.ts` ni `sitemap.ts` usa `cookies()`, `headers()`,
`searchParams` ni una API dinámica, así que no hay motivo de diseño para que
salga dinámica — pero hay que confirmarlo con la build real, no asumirlo.

## Contratos que expone este slice

- `src/lib/seo.ts` exporta `buildSoftwareApplicationJsonLd(): Record<string,
  unknown>` y `buildFaqPageJsonLd(items: readonly Faq[]): Record<string,
  unknown>`. Nadie más los necesita hoy; están acá por si otro slice futuro
  quisiera JSON-LD adicional (no es el caso ahora).
- `src/app/page.tsx` depende en firme del contrato de imports que fijó el
  hilo principal (nombres de archivo y de export bajo `src/views/landing/`).
  Si algún slice cambia el nombre de un export, este archivo rompe con
  `Module not found` o con un tipo que no matchea — no hay indirección que lo
  amortigüe, a propósito (menos capas).

## Qué falta / seguimiento

- Re-correr `npm run build` completo cuando los Slices A, B y C terminen, y
  pegar la línea de salida que confirma `/` prerenderizada.
- `public/landing/og.jpg` (1200×630) tiene que existir para que la preview de
  WhatsApp/Twitter funcione en producción; lo produce el hilo principal según
  el manifiesto de capturas.
- No hay nada que requiera base de datos real en este slice: es 100% estático,
  sin RLS, sin triggers, sin invariantes de dinero o de estado. No hay ítem
  para `tests/db/`.
