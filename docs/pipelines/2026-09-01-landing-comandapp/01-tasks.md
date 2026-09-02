# Corte en slices

Cuatro agentes en paralelo. **Ningún archivo tiene dos dueños.** El hilo
principal ya fijó los contratos y es el único que toca `globals.css`,
`src/lib/landing.ts`, las migraciones y los assets de `public/landing/`.

## Contrato compartido, ya escrito

- `src/lib/landing.ts` — `PRODUCT_NAME`, `CONTACT`, `WHATSAPP_MESSAGE`,
  `whatsappHref()`, `PRICING`, `SCREENSHOT_CAPTION`, y los tipos `Screenshot`
  y `Faq`. **Nadie lo edita**; todos lo importan.
- `[data-comandapp]` en `src/app/globals.css` — la paleta de la plataforma.
  El `<main>` de la página lo cuelga; todo lo demás lo hereda.
- `src/views/shared/surfaces.tsx` — `Panel`, `SectionHeading`, `StatusPill`,
  etc. Se **componen**, no se reinventan y no se editan.

## Reglas que valen para los cuatro

1. **Cero `'use client'`.** La página no hidrata nada. Sticky por CSS,
   acordeón por `<details>`, CTA por `<a>`, animación por `:active`.
2. **Cero data fetching.** `src/views/**` no consulta nada, nunca.
3. **Cero evidencia inventada**: ni métricas, ni testimonios, ni logos de
   clientes, ni "N locales confían". No existen.
4. Español rioplatense en la UI; nombres de código en inglés.
5. Mobile-first. Targets de 44px. El contraste ya está resuelto en los tokens:
   sobre `bg-primary` el texto va `text-primary-foreground` (navy), **nunca
   blanco**. El verde tipográfico es `text-(--brand-ink)`.
6. Tailwind v4: `rounded-(--radius)`, nunca `rounded-[--radius]`.
7. Nada de kicker/eyebrow arriba de un título. Nada de tarjetas anidadas.
   Nada de emoji como íconos (`lucide-react`). Nada de grilla de tarjetas
   ícono+título+texto como estructura de sección.

## Manifiesto de capturas (las produce el hilo principal)

Existen en `public/landing/` para cuando integres. Dimensiones exactas:

| Archivo | Intrínseco | Qué se ve |
|---|---|---|
| `pantalla-cliente.webp` | 720×1560 | La carta del local en el celular |
| `pantalla-seguimiento.webp` | 720×1560 | El cliente siguiendo su pedido |
| `pantalla-cocina.webp` | 1920×1200 | El panel de cocina con pedidos reales |
| `pantalla-dueno.webp` | 1920×1200 | El dashboard de ventas |
| `pantalla-repartidor.webp` | 720×1560 | La cola del repartidor |
| `og.jpg` | 1200×630 | Imagen de OpenGraph |

Toda captura va en `next/image` y **lleva su epígrafe** `SCREENSHOT_CAPTION`.

---

## Slice A — Cabecera y confrontación

**Dueño exclusivo de:**
- `src/views/landing/landing-bar.tsx` → `export function LandingBar()`
- `src/views/landing/hero.tsx` → `export function LandingHero()`
- `src/views/landing/versus.tsx` → `export function TodayVersus()`

`LandingBar`: barra que acompaña todo el scroll (`sticky top-0`), con el logo
horizontal y el botón de WhatsApp. Es la elevación "el marco trabaja": el CTA
está siempre a un toque, no solo al final.

`LandingHero`: la marca, **una** frase de qué es esto, el precio ya visible, y
el CTA. Todo antes del primer scroll en un celular.

`TodayVersus`: el flujo de hoy contra el nuevo, enfrentados. Hoy es el hilo de
WhatsApp (mensaje → alguien contesta → el cliente dice qué quiere → le pasan el
total → manda comprobante → cocinan → le avisan) y lo que cuesta: consume una
persona entera en hora pico, se cae con cinco pedidos juntos, pierde ventas
mientras nadie contesta, no deja ningún dato. Enfrente, el mismo pedido sin que
nadie del local escriba un mensaje.

## Slice B — Producto y prueba

**Dueño exclusivo de:**
- `src/views/landing/included.tsx` → `export function WhatsIncluded()`
- `src/views/landing/screens.tsx` → `export function ThreeScreens()`
- `src/views/landing/delivery.tsx` → `export function DeliverySection()`
- `src/views/landing/edge.tsx` → `export function WhatOnlyComandApp()`

`WhatsIncluded`: **lista densa en tres columnas, no tarjetas.** Lo confirmado
que existe: catálogo con categorías, productos y modificadores; carrito sin
cuenta y sin instalar nada; retiro y delivery; pago online con la cuenta de
Mercado Pago **del local** o pago al retirar; seguimiento por link; "mis
pedidos"; repetir un pedido anterior; panel de cocina; ABM de catálogo con
foto; dashboard de ventas; cupones y campañas; padrón de clientes; la web con
la marca del local (logo, colores, tipografía, portada) y su propio subdominio.

`ThreeScreens`: las tres capturas grandes con quién las mira (el que compra,
el mostrador, el dueño) y la única frase que cada una prueba. Epígrafe
obligatorio en las tres.

`DeliverySection`: repartidores propios del local, tarifa plana por tienda,
mínimo de pedido y envío gratis desde un monto, el portal del repartidor con
su cola, y el ETA que se estira cuando la flota está ocupada en vez de apagar
el delivery. Captura `pantalla-repartidor.webp`.

`WhatOnlyComandApp`: los **dos** diferenciadores de PRODUCT.md, sin adornos.
(1) El tiempo de espera se mueve con la carga real de la cocina: cada producto
declara cuánto tarda, y cuando hay muchos pedidos activos el estimado se
multiplica — el cliente ve un número honesto en vez del "20 minutos" que el
local dice siempre igual. (2) El pedido sale por eventos hacia el software de
gestión del local, sea cual sea, sin rehacer nada.

## Slice C — Cierre comercial

**Dueño exclusivo de:**
- `src/views/landing/pricing.tsx` → `export function Pricing()`
- `src/views/landing/faq.tsx` → `export function Faq()` y
  `export const FAQ_ITEMS: readonly Faq[]` (el tipo viene de `@/lib/landing`)
- `src/views/landing/closing.tsx` → `export function Closing()`
- `src/views/landing/landing-footer.tsx` → `export function LandingFooter()`

`Pricing`: lee **todo** de `PRICING`. 15 días con la integración ya hecha sin
pagar nada; después $59.999 por mes por local; desde el segundo local, $50.000
cada uno. Formatea con `src/lib/money.ts` (son centavos). **Si
`PRICING.IVA_DISCLOSED` es `false`, la página no menciona IVA en ninguna
forma.**

`Faq`: `<details>`/`<summary>` nativos, todos **cerrados** de entrada. Las
preguntas que un dueño hace de verdad: quién se queda con la plata (cada local
cobra con SU cuenta de Mercado Pago, la plata va directo ahí); qué pasa con el
sistema de gestión que ya usa; cuánto tarda en arrancar; si el cliente tiene
que instalar algo o crear una cuenta (no); si puede cobrar en el local; si se
queda con sus clientes y sus datos; qué pasa si no tiene fotos de los
productos. `FAQ_ITEMS` lo importa el Slice D para el JSON-LD: exportalo como
dato plano.

`Closing`: la última banda, navy, con el CTA grande y el mail de respaldo.

`LandingFooter`: **no reusa `SiteFooter`** (ese lleva "¿Tenés un local?", que
acá no tiene sentido). Logo, links a `/legal/terminos` y `/legal/privacidad`,
el mail, y nada más.

## Slice D — Página, SEO y datos estructurados

**Dueño exclusivo de:**
- `src/app/page.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `src/lib/seo.ts`

`page.tsx`: cuelga `[data-comandapp]`, ordena las diez secciones de los otros
tres slices y no contiene markup de presentación propio. Exporta `metadata`
completa: title, description, canonical, OpenGraph (imagen `/landing/og.jpg`,
1200×630, `locale: es_AR`) y Twitter card. **La preview de WhatsApp es
literalmente lo primero que ve el lector**, así que es tan importante como el
primer viewport.

Orden: `LandingBar` · `LandingHero` · `TodayVersus` · `WhatsIncluded` ·
`ThreeScreens` · `WhatOnlyComandApp` · `DeliverySection` · `Pricing` · `Faq` ·
`Closing` · `LandingFooter`.

`seo.ts`: JSON-LD de `SoftwareApplication` (con `offers` leyendo `PRICING`) y
de `FAQPage` (leyendo `FAQ_ITEMS` del Slice C). Se inyecta con
`<script type="application/ld+json">`.

`robots.ts` y `sitemap.ts`: derivan el origen de `NEXT_PUBLIC_SITE_URL`, que
**siempre es el apex**. El sitemap lista `/`, `/legal/terminos` y
`/legal/privacidad`. Robots permite todo salvo `/admin`, `/backoffice`,
`/repartidor`, `/api` y `/pedido`.

**Verificá que la página quede estática**: `npm run build` tiene que marcarla
como prerenderizada. Si aparece como dinámica, algo metió una API dinámica y
hay que sacarla.
