# 03-review.md — "La página es la demo"

**Veredicto: APROBADO CON OBSERVACIONES** (dos hallazgos se listan como
bloqueantes: hay que resolverlos y volver a pasar por review antes de
commitear; el resto no impide el commit pero conviene atenderlo).

## Alcance revisado

```
git status --porcelain (fuera de docs/, tests/, public/, .gitignore, robots.ts, sitemap.ts, seo.ts):
 M src/app/globals.css
 M src/app/layout.tsx
 M src/app/page.tsx
?? src/lib/landing.ts
?? src/views/landing/**  (19 archivos)

git diff --stat (archivos existentes tocados):
 .gitignore          |   3 +
 src/app/globals.css | 208 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 src/app/layout.tsx  |  23 ++++++
 src/app/page.tsx    | 116 +++++++++++++++++++++++++----
```

Confirmado: `package.json`/`package-lock.json` no tienen `gsap` ni
`@gsap/react`; `split-text.tsx` y `hero-ticket.tsx` no existen (los borró el
Slice F). Nada fuera del alcance declarado cambió. `npx tsc --noEmit -p .`,
`npx eslint` sobre los 21 archivos del scope y `npm run build` corren limpios;
`/` sale `○ Static` en el build de producción.

## Metodología

Leí `00-architecture.md`, `01-tasks.md`, los siete `02-development-slice-*.md`,
el bloque `LANDING (/)` de `layout.tsx` y `src/lib/landing.ts`. Audité
ejecutando, no solo leyendo: `curl` sobre el HTML servido por el dev server
(`http://127.0.0.1:3000/`) para grepear clases de motion y `IVA` en el HTML
crudo (sin JS), inspección de `node_modules/next/dist/shared/lib/get-img-props.js`
y `node_modules/next/dist/docs/.../image.md` para verificar la API real de
`next/image` en Next 16, y una ronda visual en Chrome (pestaña propia, cerrada
al final) a ~1568×764 —el entorno no permite bajar a 1440 ni a 390; el mobile
se revisó por código, como reportaron también varios slices—.

## Hallazgos

### 1. [BLOQUEANTE] Tres calculadoras violan la gramática de motion: `.landing-num-in` viaja en el HTML servido

**Archivos:** `src/views/landing/eta-demo.tsx:110`,
`src/views/landing/delivery-quote.tsx:72,120,135`,
`src/views/landing/pricing-calculator.tsx:44,58`.

`00-architecture.md` (Gramática de motion, punto 7) y `01-tasks.md` (Reglas
para los cinco, punto 2) son categóricos: *"Los keyframes nuevos... se aplican
solo a elementos que el JS agrega durante la escena... Un elemento presente en
el HTML servido NUNCA lleva esas clases."* El mismo texto está repetido en el
`DIRECTION_CONTRACT` de `layout.tsx`. Confirmé con `curl -s http://127.0.0.1:3000/`
que la clase `landing-num-in` aparece **cinco veces en el HTML servido sin
JS**: el ETA de `EtaDemo`, el subtotal/envío/minutos de `DeliveryQuote`, y el
total de `PricingCalculator`.

En los tres casos el patrón es `<span key={valor} className="landing-num-in ...">`,
sin ningún gate (`hasInteracted`/`hasPlayed`) que distinga "el valor inicial,
tal como sale del servidor" de "el valor cambió porque el usuario tocó el
control". Como `animation: landing-num-in ... both`, el navegador aplica el
fotograma `from` (`opacity: 0`) antes de reproducir la animación: en la
práctica, **cualquier visita a `/` dispara un fade-in de esos cinco números en
el instante del parseo**, sin scroll, sin `IntersectionObserver`, sin que el
usuario haya tocado nada — exactamente lo que la regla prohíbe ("nunca en el
HTML servido inicial"), y contradice el punto 3 de la misma gramática ("cada
demo se reproduce una vez cuando entra en pantalla").

Contraste con el resto del propio PR: `hero-flow.tsx` (`hasPlayed`),
`versus-race.tsx` (`animated`) y `events-demo.tsx` (`hasPlayed`) sí gatean
correctamente sus clases de entrada arrancando en `false` y subiéndolas solo
dentro de un callback real. Los tres archivos de esta sección no replican ese
patrón.

**Escenario de falla concreto:** un visitante entra a `/`, nunca toca el
slider de `EtaDemo` ni el de `DeliveryQuote` ni el stepper de `PricingCalculator`,
y aun así ve esos tres números "asentarse" con una animación de entrada al
cargar la página — el mismo efecto "algo entra solo" que esta ronda vino a
eliminar del resto de la landing.

**Arreglo sugerido:** en los tres componentes, agregar un flag que arranque en
`false` (p. ej. `hasChanged`, análogo a `hasPlayed`) y subirlo a `true` solo
dentro del `onChange`/`onClick` que efectivamente cambia el valor; aplicar
`landing-num-in` condicionado a ese flag, nunca de forma incondicional.

### 2. [BLOQUEANTE] `order-journey.tsx` usa la API de `next/image` deprecada en Next 16, y duplica el preload del mismo asset

**Archivo:** `src/views/landing/order-journey.tsx:329` (dentro de `FrameStack`,
árbol desktop) y `:472` (dentro de `MobileStationCard`, árbol mobile).

`AGENTS.md` advierte explícitamente: *"This version has breaking changes...
Read the relevant guide in `node_modules/next/dist/docs/`... before writing any
code."* Verificado contra
`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`:

> *"Starting with Next.js 16, the `priority` property has been deprecated in
> favor of the `preload` property in order to make the behavior clear."*

`order-journey.tsx` usa `{ priority: true }` (la forma pre-16) en dos
`<Image>` distintos, **no uno**: `DesktopJourney`/`FrameStack` (oculto por
`hidden lg:grid` a nivel del padre, pero montado siempre) y
`MobileJourney`/`MobileStationCard` (oculto por `lg:hidden`, también montado
siempre). Los dos apuntan al mismo archivo, `pantalla-cliente.png`.

Confirmé con `curl` sobre el HTML servido: el `<head>` trae **dos**
`<link rel="preload" as="image">` para `pantalla-cliente.png`, con `imageSizes`
distintos (`14rem` para el visor desktop, `(min-width: 640px) 14rem, 60vw` para
la tarjeta mobile) — el navegador precarga el mismo recurso dos veces en
paralelo con prioridad alta, en la primera pantalla, sobre una conexión que
"muchas veces" es mala (CLAUDE.md, Estilo). Esto es justo lo que el criterio
de revisión pide chequear literalmente: *"next/image con sizes correctos y
una sola priority"* — acá hay dos.

**Arreglo sugerido:** migrar a `preload` (el nombre vigente en Next 16) y
dejar la marca de precarga en un solo árbol — no tiene sentido precargar la
imagen que el CSS oculta para el breakpoint actual. Alternativa más simple:
sacar la precarga de esta sección por completo (el H1 del hero ya es el LCP
real de la página; la primera estación del recorrido está más abajo y puede
cargar `loading="lazy"` como el resto).

### 3. [MAYOR] `versus-race.tsx` lee `prefers-reduced-motion` con el patrón que el resto del pipeline evitó a propósito

**Archivo:** `src/views/landing/versus-race.tsx:144,270-282,285-301`.

El propio criterio de esta revisión lo pide verificar explícitamente:
*"¿matchMedia en lazy init o useSyncExternalStore, nunca en un efecto que
setea estado?"*. `versus-race.tsx` es la única isla de las ocho que falla este
chequeo: lee `window.matchMedia(...)` dentro de un `useEffect` y llama
`setReducedMotion(query.matches)` (y, si aplica, `showFinalState()`, que a su
vez dispara varios `setState`) de forma síncrona en el cuerpo del efecto de
montaje.

Los otros tres archivos que necesitan la misma preferencia en este mismo PR
—`hero-flow.tsx`, `events-demo.tsx` (con `useSyncExternalStore`, documentando
en el propio código por qué) y `order-journey.tsx` (con inicializador perezoso
de `useState`)— migraron deliberadamente lejos de este patrón, citando la
regla `react-hooks/set-state-in-effect` y, más importante, el riesgo real: el
efecto que arma el `IntersectionObserver` (`useEffect` con `[reducedMotion,
play]` como deps, más abajo en el archivo) se ejecuta en el MISMO commit con
el valor de clausura `reducedMotion=false` viejo, así que en teoría puede
llegar a `observer.observe(node)` antes de que el re-render con
`reducedMotion=true` lo desmonte. Es probable que en la práctica el segundo
render (síncrono, por lotes) gane la carrera contra el callback asíncrono del
observer, pero es exactamente el bug de raíz que el resto del pipeline cerró
por diseño, no por casualidad — y ningún slice pudo verificarlo en vivo con
`prefers-reduced-motion` emulado (todos reportan la misma limitación de
entorno).

**Arreglo sugerido:** alinear `versus-race.tsx` al mismo patrón que
`events-demo.tsx` (`useSyncExternalStore`) para eliminar la ventana de riesgo
y la inconsistencia dentro del propio PR.

### 4. [MENOR] `PhotoFrame` con `fallbackLabel="Bacon Bomb"` es ilegible al tamaño usado

**Archivo:** `src/views/landing/hero-flow.tsx:329-330`.

Verificado visualmente a 1568px (zoom sobre la fila de producto del hero): el
texto "Bacon Bomb" dentro de una caja `size-12` (48px) se parte en dos líneas
apenas legibles ("Bac"/"Bom"). `PhotoFrame` es una primitiva existente y no se
tocó, pero el uso puntual acá no cumple la intención de la regla ("sin foto no
es un hueco gris: es el nombre en grande") — a 48px no es "grande". Sugerencia:
agrandar la miniatura en esta escena puntual, o usar un `fallbackLabel` más
corto.

### 5. [MENOR] `WhatsIncluded`: columnas de altura muy dispar en desktop

**Archivo:** `src/views/landing/included.tsx`.

Verificado visualmente a 1568px: "Para tu cliente" tiene 9 ítems y las otras
tres columnas 2/3/2, así que tres de las cuatro columnas quedan con más de la
mitad de su alto vacío por debajo del último ítem. No es la "media pantalla
vacía" de sección completa que prohíbe el brief, pero sí un desbalance
visible dentro de la sección. Sugerencia: repensar la proporción de columnas
(p. ej. una columna angosta para "Para tu cliente" y las otras tres
compartiendo el resto del ancho) o usar `columns-4` con flujo para que el
contenido empareje.

### 6. [NIT] `ReadingProgressBar` sincroniza estado en el cuerpo de un efecto

**Archivo:** `src/views/landing/landing-bar-progress.tsx:101-124`.

`measure()` llama `setProgress(...)` de forma síncrona en el montaje del
efecto — el mismo patrón que otros archivos de este PR (`SectionLabel` en el
mismo archivo, `hero-flow.tsx`, `events-demo.tsx`) evitaron a propósito citando
`react-hooks/set-state-in-effect`. Acá el lint no lo marca (el componente es
puramente visual y `aria-hidden`, sin riesgo funcional real), pero es
inconsistente con el criterio que el resto del PR sigue. No bloquea nada.

## Verificaciones ejecutadas

- `npx tsc --noEmit -p .` → limpio.
- `npx eslint src/app/page.tsx src/app/layout.tsx src/lib/landing.ts src/views/landing/*.tsx` → limpio.
- `npm run build` → compila, `/` sale `○ Static`, sin warnings de bundle.
- `curl http://127.0.0.1:3000/`:
  - `grep -o "IVA"` → 0 matches (la deuda `PRICING.IVA_DISCLOSED=false` se
    respeta en el HTML servido).
  - `<h1>` completo y estático en el HTML servido, sin `opacity-0` ni
    dependencia de JS (Slice F resolvió correctamente el bug de la ronda
    anterior).
  - Clases de escena (`landing-msg-in`, `landing-row-in`, `landing-blink`,
    `landing-typing`) → 0 apariciones en el HTML servido (correctamente
    gateadas). `landing-num-in` → 5 apariciones (hallazgo 1).
  - Dos `<link rel="preload" as="image">` para `pantalla-cliente.png`
    (hallazgo 2).
- Chrome MCP, pestaña propia (creada y cerrada en esta sesión), ~1568×764 (el
  entorno no bajó a 1440 exacto ni permitió 390 — limitación ya reportada por
  varios slices, no del código): hero sin mitad de pantalla vacía, carrera
  corriendo con reloj sincronizado y `OrderSteps` avanzando paso a paso,
  recorrido con crossfade celular↔escritorio liso y sin salto de layout,
  calculadora de precio con aritmética correcta (1→3 locales: `$59.999` →
  `$159.999` = `1×59.999 + 2×50.000`), acordeón FAQ abre con el link de
  WhatsApp correcto. Sin errores ni warnings en consola.
- No pude emular `prefers-reduced-motion` con las herramientas disponibles —
  mismo límite que reportaron los slices B, C y D. Recomiendo a
  `test-engineer` cubrir ese camino con Playwright (`page.emulateMedia`), en
  particular sobre el hallazgo 3.

## Qué está bien

- La aritmética es real en las ocho islas: `etaMinutesFor`/`scaleUpInt`,
  `buildDeliveryQuote`/`delivery.ts`, `monthlyTotalCents` — cero valores
  hardcodeados, cero floats. Verificado también en vivo (stepper de precio).
- `DEMO_SCENE_CAPTION` presente en las tres escenas dramatizadas (hero,
  carrera, eventos) y `SCREENSHOT_CAPTION` en cada captura del recorrido; "IVA"
  ausente del HTML servido.
- El bug real de la ronda anterior (el `<h1>` en `opacity-0` dependiente de
  GSAP) está resuelto de raíz: Slice F lo reemplazó por texto estático,
  eliminó `gsap`/`@gsap/react` del bundle y limpió `split-text.tsx`/
  `hero-ticket.tsx` sin dejar rastros (`grep` confirmado).
- Disciplina de capas intacta: nada en `src/views/landing/**` importa
  `@supabase/*` ni modelos; los Server Components (`versus.tsx`,
  `screens.tsx`, `edge.tsx`, `delivery.tsx`, `pricing.tsx`, `faq.tsx`,
  `closing.tsx`, `landing-footer.tsx`) se mantienen sin `'use client'` y sin
  estado.
- Piso de calidad: sin kicker, sin `Panel` anidado (verificado por archivo),
  sin emoji, sin grilla ícono+título+texto como esqueleto, sin números de
  sección, `tabular` en todos los valores numéricos que cambian, focos
  visibles heredados del sistema, `rounded-(--radius)` (sintaxis v4 correcta)
  en todo el diff.
- Accesibilidad, en general sólida: `role="radiogroup"` + roving `tabindex`
  en `DeliveryQuote`, `aria-valuetext` en los dos ranges, `aria-live` correcto
  en el paso del hero y en el total de precio, `aria-current` en los
  indicadores del recorrido, `alt` reales en las capturas, `aria-hidden`
  puntual solo en lo decorativo/repetido. La falta de `aria-live` en
  `EtaDemo`/`DeliveryQuote` (mencionada en el criterio de revisión
  explícitamente) es la única brecha real — la señalo aparte porque no llega a
  bloquear, pero conviene que `test-engineer` la cubra: el resultado ("Envío
  gratis", "Te faltan $X", minutos) cambia lejos del control que lo dispara y
  hoy no se anuncia a un lector de pantalla.
- Idempotencia de motion: cada demo autoplay (`hero-flow`, `versus-race`,
  `events-demo`) tiene control de pausa/reanudación, se pausa con
  `document.hidden` y respeta `prefers-reduced-motion` (salvo el matiz del
  hallazgo 3).

## Para `test-engineer` (no implementado por mí)

- Falta `aria-live="polite"` en el bloque de resultado de `EtaDemo`
  (`eta-demo.tsx`, el `<div>` que envuelve el ETA en grande) y de
  `DeliveryQuote` (`delivery-quote.tsx`, el `<div>` de envío/minutos): un test
  de accesibilidad debería fallar hoy si verifica que un cambio de valor se
  anuncia sin mover el foco.
- Un test que renderice `EtaDemo`, `DeliveryQuote` y `PricingCalculator` con
  `renderToStaticMarkup` (o lea el HTML servido) y assertee la AUSENCIA de
  `landing-num-in` en el primer render cerraría el hallazgo 1 de forma
  duradera — hoy nada en la suite lo hubiera detectado.
- Cobertura de `prefers-reduced-motion` con Playwright
  (`page.emulateMedia({ reducedMotion: 'reduce' })`) sobre `versus-race.tsx`,
  para confirmar o descartar en un navegador real el riesgo del hallazgo 3.
- `tests/lib/landing-source-scan.test.ts` necesita actualizar su allowlist a
  las 8 islas vigentes (reemplazar `split-text.tsx` por `hero-flow.tsx`, sumar
  `delivery-quote.tsx`, `eta-demo.tsx`, `events-demo.tsx`,
  `landing-bar-progress.tsx`, `order-journey.tsx`, `pricing-calculator.tsx`,
  `versus-race.tsx`) — reportado ya por Slice D como fallo esperado, no un bug
  de producción.

## Bloqueantes

1. `.landing-num-in` presente en el HTML servido de `eta-demo.tsx`,
   `delivery-quote.tsx` y `pricing-calculator.tsx` (hallazgo 1).
2. `order-journey.tsx` usa la API `priority` de `next/image`, deprecada en
   Next 16, duplicada en dos árboles simultáneos para el mismo asset
   (hallazgo 2).
