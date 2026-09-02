# Tests — landing de ComandApp

`npm test`: **103 archivos, 1307 tests pasados, 4 skipped** (los de `tests/db/`,
sin Docker levantado). Los 4 archivos nuevos de esta corrida:

```
tests/lib/landing.test.ts             3 tests
tests/lib/seo.test.ts                 6 tests
tests/lib/landing-routes.test.ts      5 tests
tests/lib/landing-source-scan.test.ts 4 tests
```

## Qué cubrí

### `tests/lib/landing.test.ts` — `whatsappHref()`

- El número lleva el `9` después del `54` (regex de forma, no el literal
  completo: lo que importa es la propiedad, no acoplarse al número real).
- El mensaje default viaja percent-encoded en el querystring — chequeado
  sobre la forma CRUDA del string (`href.not.toContain(' ')`), no solo sobre
  lo que `URLSearchParams` ya decodificó de vuelta.
- Un mensaje propio pisa el default, no lo concatena.

### `tests/lib/seo.test.ts` — `buildSoftwareApplicationJsonLd` / `buildFaqPageJsonLd`

- El precio del `Offer` es el valor **exacto** `"59999.00"` (unidades
  decimales), no `5999900` (centavos) — la regresión que el brief pide cubrir
  explícitamente.
- La moneda del `Offer` es la de `PRICING`, no una hardcodeada aparte.
- El objeto serializado no contiene `aggregateRating`, `review` ni
  `ratingValue` en ningún nivel.
- `buildFaqPageJsonLd` produce una `Question` por item, en el mismo orden, con
  `acceptedAnswer` completo — probado contra un fixture propio Y contra las
  `FAQ_ITEMS` reales de `src/views/landing/faq.tsx` (para que un texto
  editado en la Slice C sin querer no quede huérfano del JSON-LD).
- Borde: cero preguntas → `mainEntity: []`, no tira.

Nota técnica: `seo.ts` cuelga de `apexUrl()` (`@/lib/urls`), que lee
`clientEnv` **al importarse**. Igual que `tests/lib/urls.test.ts`, el test
fija `NEXT_PUBLIC_SITE_URL` y compañía antes de un `import()` dinámico con
`vi.resetModules()` entre casos, para no depender de qué test corrió antes en
el mismo worker (`singleFork: true` en `vitest.config.ts`).

### `tests/lib/landing-routes.test.ts` — `robots.ts` / `sitemap.ts`

- `Disallow` cubre `/admin`, `/backoffice`, `/repartidor`, `/api` y `/pedido`
  (con un test dedicado a `/pedido`, que es el que más importa: token de
  acceso en el path, no contenido).
- El campo `sitemap` de `robots.ts` y las URLs de `sitemap.ts` se recalculan
  contra un origen **distinto** (`https://otro-dominio.test`) para probar que
  derivan de `NEXT_PUBLIC_SITE_URL` y no están hardcodeadas a `comandapp.ar`.
- `sitemap.ts` lista la raíz y las dos páginas legales.

### `tests/lib/landing-source-scan.test.ts` — las reglas que se rompen solas

- **`'use client'` con UNA sola excepción declarada, no un `skip` de
  directorio**: la isla `src/views/landing/split-text.tsx` (`SplitHeading`,
  GSAP `SplitText` sobre el `<h1>` del hero) es la única excepción admitida
  al "cero JavaScript de cliente", según el contrato de dirección de
  `src/app/layout.tsx` (bloque `LANDING (/):`). Son dos tests separados,
  a propósito:
  1. Que la allowlist siga apuntando a algo real: `split-text.tsx` existe
     Y de verdad lleva la directiva. Sin esto, borrar o renombrar el
     archivo no rompe nada y la excepción queda documentada en un test
     que dejó de probarla.
  2. Que sea el **único** archivo del directorio con `'use client'` —
     allowlist de exactamente un path, no un patrón ni un directorio
     entero, así que un segundo archivo cliente mañana sigue haciendo
     fallar el test.
- **El `<h1>` se sirve en el HTML del servidor**: se renderiza `LandingHero`
  entero con `renderToStaticMarkup` (funciona sin jsdom porque, aunque
  `SplitHeading` lleve `'use client'`, React sigue ejecutando esa función
  durante el render de servidor — la directiva marca el límite de
  hidratación, no de server-render, y ningún acceso a `window`/`document`
  ocurre en el cuerpo de render de `SplitHeading`, solo dentro de sus
  `useEffect`/`useGSAP`, que `renderToStaticMarkup` nunca ejecuta) y se
  extrae el texto del `<h1>` sacando tags (para no depender de si GSAP
  reparte el texto en `<span>` por carácter). Literal a propósito: lo que
  prueba la invariante es que el texto REAL está en el HTML servido, no que
  aparezca vacío hasta que el cliente monte y corra el split — si el copy
  del titular cambia, se actualiza el literal, no se afloja el test a
  "no vacío".
- **`PRICING.IVA_DISCLOSED = false` → ningún componente de contenido
  MENCIONA "IVA"**: igual que antes, probado **renderizando** los
  componentes reales en vez de grepear el código fuente, porque
  `pricing.tsx` implementa la regla correctamente con
  `{PRICING.IVA_DISCLOSED ? ' + IVA' : ''}` — esa línea CONTIENE la palabra
  "IVA" en la fuente sin que aparezca jamás en el HTML mientras el flag esté
  en `false`, y un grep la habría marcado como infractora por error. El
  barrido descubre los componentes dinámicamente (funciones exportadas, sin
  argumentos, nombre en PascalCase) y **excluye explícitamente
  `split-text.tsx`**: no es una sección con copy propio (recibe `text` por
  prop desde `hero.tsx`, que sí queda cubierto) y es la única pieza que toca
  GSAP en un entorno sin DOM real — intentar renderizarla ahí mediría la
  fragilidad de Node, no una propiedad del producto.
  Usa `it.runIf(PRICING.IVA_DISCLOSED === false)`: si el flag pasa a `true`
  el día de mañana, este test queda "skipped" (visible en el resumen, nunca
  "passed" en silencio) como señal de que hay que invertirlo para EXIGIR la
  mención en vez de seguir prohibiéndola.

## Qué decidí NO cubrir, y por qué

- **Snapshots de markup o de clases de Tailwind**: excluidos a propósito por
  el propio brief — se rompen con cada ajuste visual y no prueban nada.
- **Componentes de presentación uno por uno** (`LandingHero`, `TodayVersus`,
  `WhatsIncluded`, etc.): tampoco pedidos por el brief. El único lugar donde
  los renderizo es el barrido genérico de IVA, y ahí no aserto nada sobre SU
  contenido puntual — solo sobre la ausencia de una palabra.
- **`PRICING.IVA_DISCLOSED === false` como aserción aislada**: descartado
  porque es un valor de negocio, no una propiedad de código — asertar "hoy
  vale false" no atrapa ningún bug por sí solo. Lo que sí vale la pena, y
  está cubierto, es el efecto de ese flag sobre lo que la página renderiza.
- **Metadata de `page.tsx`** (title/description/OpenGraph/canonical): es
  markup de configuración estático, sin lógica condicional ni invariante de
  negocio — literal que se lee a simple vista en el archivo. No hay nada que
  un test pueda demostrar ahí que revisar el archivo no muestre ya.
- **`FAQ_ITEMS` contenido de las preguntas en sí** (que sea EXACTAMENTE esas
  7 preguntas con ESE texto): es copy, no comportamiento — cambiará con
  cualquier iteración de redacción y un test que lo fijara se rompería sin
  que hubiera ningún bug.
- **`courier`/store isolation, dinero en centavos de pedidos, máquina de
  estados**: no aplica — esta superficie no toca Postgres ni el modelo de
  pedidos, es presentación estática pura (`00-architecture.md`: "la landing
  no tiene una sola llamada al servidor").

## Hallazgos

Ninguno. No encontré ningún caso donde el comportamiento observado
difiriera de lo que documentan `00-architecture.md`/`01-tasks.md`:

- `whatsappHref()` arma bien el link con el `9`.
- El precio del JSON-LD ya sale en decimales (`centsToDecimal` en `seo.ts`
  está usado correctamente), y no hay `aggregateRating`/`review`/
  `ratingValue` en ningún lado.
- `robots.ts` y `sitemap.ts` derivan todo de `apexUrl()`/`NEXT_PUBLIC_SITE_URL`.
- `split-text.tsx` es la única isla cliente de la landing, `hero.tsx` sigue
  siendo Server Component, y el `<h1>` con el titular llega completo en el
  HTML del servidor (verificado con `renderToStaticMarkup`, no asumido).
- `pricing.tsx` implementa la deuda de IVA correctamente: el HTML renderizado
  no menciona "IVA" mientras el flag esté en `false`.

## Ajuste en vivo: la isla cliente de `SplitHeading`

Mientras corría esta tanda, el dueño del producto pidió animar el `<h1>` del
hero con GSAP `SplitText` (`src/views/landing/split-text.tsx`), lo que agrega
la única excepción admitida a "cero `'use client'`" de toda la landing. El
coordinador me pidió ajustar `tests/lib/landing-source-scan.test.ts` sin
aflojarlo: la regla pasó de "cero archivos cliente" a "cero archivos cliente
salvo `split-text.tsx`, y si ese archivo desaparece o aparece un segundo, el
test tiene que fallar" — ver el detalle arriba. De paso sumé la prueba de que
el `<h1>` sigue llegando completo en el HTML del servidor pese a que
`SplitHeading` es un Client Component (SEO real, no asumido). El archivo
llegó y se terminó de integrar en `hero.tsx` durante esta misma corrida;
`npm test` quedó verde contra la integración final, no contra un estado a
medio camino.

**Verdict: SUITE GREEN**
