# Corte en slices

Cinco agentes `frontend-react-craftsman` en paralelo, después `test-engineer` y
`code-reviewer`. **Ningún archivo tiene dos dueños.** El hilo principal ya
escribió los contratos y es el único que toca `src/lib/landing.ts`,
`src/app/globals.css`, `src/app/layout.tsx` y `public/`.

## Contrato compartido, ya escrito (no se edita, se importa)

`src/lib/landing.ts`:

| Export | Para |
|---|---|
| `DEMO_ORDER`, `DemoOrderStatus` | El pedido #A2A1: ítems, total, horas del ciclo de cocina (`timeline`) y del dinero (`paidAt`), ETA congelado |
| `DEMO_THREAD`, `DemoMessage`, `THREAD_COSTS` | El hilo de WhatsApp de hoy, con hora por mensaje |
| `JOURNEY`, `JourneyStation` | Las cinco estaciones con su captura, quién, título, frase y 3 hechos |
| `ETA_DEMO`, `etaMinutesFor(active)` | El multiplicador de demanda con los defaults del schema |
| `DEMO_EVENTS`, `DemoEvent` | Los eventos del outbox del #A2A1 |
| `DELIVERY_DEMO` (tipo `StoreDelivery`), `DELIVERY_DEMO_SUBTOTAL` | Para `deliveryFeeFor`, `deliveryMinutesFor`, `buildDeliveryQuote` de `src/lib/delivery.ts` |
| `monthlyTotalCents(n)`, `PRICING_MAX_STORES` | La calculadora de precio |
| `SECTIONS` | `id` + rótulo de cada sección, en orden; la barra las observa |
| `DEMO_SCENE_CAPTION` | Epígrafe obligatorio de toda escena dramatizada |
| `whatsappQuestionHref(q)` | El CTA por pregunta del FAQ |
| Lo de antes: `PRODUCT_NAME`, `CONTACT`, `WHATSAPP_MESSAGE`, `whatsappHref()`, `PRICING`, `SCREENSHOT_CAPTION`, `Screenshot`, `Faq` | |

`src/app/globals.css`, dentro de `[data-comandapp]`: `--dur-beat`; clases
`.landing-msg-in`, `.landing-row-in`, `.landing-num-in`, `.landing-typing`; el
acordeón animado de `details` (progresivo). Los keyframes se aplican **solo a
lo que el JS agrega durante una escena**.

`src/views/shared/`: `Panel`, `SectionHeading`, `StatusPill`, `StepMark`,
`Stepper`, `iconButtonClass` (surfaces.tsx) y `OrderSteps` (order-status.tsx).
Se componen, no se editan.

## Reglas para los cinco

1. **Cada sección raíz** lleva `id` (el de `SECTIONS`), `data-scroll-anchor` y
   `data-landing-section`. Sin eso la barra no la ve.
2. **Motion**: la gramática de `00-architecture.md` § "Gramática de motion",
   entera. Resumen operativo: nada entra al hacer scroll; las demos se
   reproducen una vez al entrar en pantalla (`IntersectionObserver`, umbral
   ~0.4) y tienen "Ver de nuevo"; con `prefers-reduced-motion`
   (`window.matchMedia`) renderizan el estado final directo y sin botón; las
   clases `landing-*-in` solo van en nodos agregados por la escena; nada de
   `will-change` permanente; los timers se limpian al desmontar y se pausan
   cuando la pestaña está oculta (`document.visibilityState`).
3. **Islas cliente**: solo los archivos nombrados en tu slice llevan
   `'use client'`. La sección que las envuelve sigue siendo Server Component.
   Sin dependencias nuevas; GSAP solo en `split-text.tsx`.
4. **Cero data fetching, cero evidencia inventada.** Los números salen del
   contrato o de la aritmética real; toda escena dramatizada muestra
   `DEMO_SCENE_CAPTION` y toda captura `SCREENSHOT_CAPTION`.
5. Piso de calidad (`.claude/skills/impeccable/reference/craft-floor.md`):
   sin kicker, sin tarjetas anidadas, sin emoji, sin grilla ícono+título+texto
   como esqueleto, sin números de sección, targets ≥ 44 px, `tabular` en todo
   número que cambia, foco visible con `--ring`.
6. Contraste ya resuelto en tokens: sobre `bg-primary` va
   `text-primary-foreground` (navy), **nunca blanco**; el verde tipográfico es
   `text-(--brand-ink)`. Tailwind v4: `rounded-(--radius)`, no
   `rounded-[--radius]`.
7. Español rioplatense en UI; código en inglés; comentarios que explican el
   *por qué*.
8. **Desktop no puede quedar con media pantalla vacía.** Cada sección se
   compone para 1440 y para 390, y se mira en las dos antes de cerrar.
9. Skills obligatorias: `impeccable` (leer `reference/craft-floor.md` antes de
   editar y `reference/animate.md` para toda demo), `web-design-guidelines`
   antes de cerrar, `vercel-react-best-practices`, y `context7` antes de usar
   una API (GSAP SplitText, `IntersectionObserver`, `interpolate-size`).
10. Al terminar, cada agente escribe
    `docs/pipelines/2026-09-02-landing-la-pagina-es-la-demo/02-development-<slice>.md`:
    qué hizo, decisiones, qué verificó a mano (desktop y mobile), qué quedó
    afuera. No corre `npm install`, no toca migraciones ni `tests/`.

## Orden de la página (lo escribe Slice A en `page.tsx`)

`LandingBar` · `LandingHero` · `TodayVersus` · `OrderJourney` ·
`WhatOnlyComandApp` · `DeliverySection` · `WhatsIncluded` · `Pricing` · `Faq` ·
`Closing` · `LandingFooter`, más los dos JSON-LD que ya existen.

Exports que cada slice tiene que respetar exactamente (Slice A los importa):

| Archivo | Export | `id` de sección |
|---|---|---|
| `landing-bar.tsx` | `LandingBar` | — |
| `hero.tsx` | `LandingHero` | — |
| `versus.tsx` | `TodayVersus` | `como-funciona` |
| `screens.tsx` | `OrderJourney` | `recorrido` |
| `edge.tsx` | `WhatOnlyComandApp` | `diferencias` |
| `delivery.tsx` | `DeliverySection` | `delivery` |
| `included.tsx` | `WhatsIncluded` | `incluido` |
| `pricing.tsx` | `Pricing` | `precio` |
| `faq.tsx` | `Faq`, `FAQ_ITEMS` | `faq` |
| `closing.tsx` | `Closing` | — |
| `landing-footer.tsx` | `LandingFooter` | — |

---

## Slice A — Chasis y hero

**Dueño exclusivo de:** `src/app/page.tsx`, `src/views/landing/landing-bar.tsx`,
`src/views/landing/landing-bar-progress.tsx` (nuevo, cliente),
`src/views/landing/hero.tsx`, `src/views/landing/split-text.tsx`,
`src/views/landing/hero-ticket.tsx` (nuevo, cliente).

**`LandingBar`**: sigue sticky con logo y CTA. Se le suma (a) una línea de
progreso de lectura de 2 px en el borde inferior, y (b) en `md:` y más, el
rótulo de la sección actual (de `SECTIONS`) como texto discreto entre el logo y
el CTA, que cambia con un crossfade de `--dur-base`. Las dos cosas viven en
`landing-bar-progress.tsx`: `IntersectionObserver` sobre
`[data-landing-section]` para la sección activa, `scroll` con `rAF` (o CSS
`animation-timeline: scroll()` con fallback) para el progreso. El logo hoy
renderiza a ~50 px de ancho: corregir a un tamaño legible (≈ 120–140 px en
desktop, ≈ 104 px en mobile) respetando el aspect-ratio real del archivo. En
mobile no hay rótulo: logo + CTA.

**`LandingHero`**: (1) `SplitHeading` pasa de `chars` a `lines` con
`mask: 'lines'` (GSAP SplitText 3.13+; verificar la API con context7), stagger
por línea, total ≤ 900 ms, mismo ease. El `<h1>` **no puede depender del JS
para verse**: si el efecto no corre, tiene que estar visible dentro de ~1 s
(por ejemplo, la clase de ocultamiento se aplica solo cuando el JS ya está
listo para animar, o un `animation` CSS de respaldo la vence). Con reduced
motion, sin tween. (2) Las tres tarjetas flotantes pasan a ser **el ticket del
#A2A1** (`hero-ticket.tsx`): "Entró 21:20 · pagado", "Cocinando · listo aprox.
21:44", "#A2A1 · Listo 21:41" —datos de `DEMO_ORDER`—, y en desktop entran una
tras otra **después** de que termina el titular (cadencia `--dur-beat`), una
sola vez; en mobile se muestran estáticas en una fila compacta debajo del
celular (hoy en mobile no existen: eso es contenido que se pierde). (3)
Componer el desktop para que la columna de texto no deje media pantalla vacía:
alinear la altura del bloque de texto con el recorte del celular, o bajar el
recorte. (4) La franja de dos hechos debajo se mantiene.

**`page.tsx`**: el orden de arriba, con los imports nuevos; metadata y JSON-LD
sin cambios.

## Slice B — La carrera

**Dueño exclusivo de:** `src/views/landing/versus.tsx`,
`src/views/landing/versus-race.tsx` (nuevo, cliente).

Dos carriles enfrentados: **"Hoy, por WhatsApp"** y **"Con ComandApp"**, cada
uno con su reloj. Empiezan juntos a las 21:20 cuando la sección entra en
pantalla.

- Carril izquierdo: el hilo de `DEMO_THREAD` se escribe solo. Cada mensaje
  aparece con `.landing-msg-in` a cadencia `--dur-beat`; antes de cada
  respuesta del local aparece el indicador `.landing-typing` (tres puntos)
  durante un beat. Cada burbuja muestra su hora (`at`). Arriba, un contador
  "N mensajes · nadie cocinó todavía" que va sumando. Paleta de ComandApp,
  nunca verde WhatsApp ni doble tilde (misma decisión que la ronda anterior).
- Carril derecho: el pedido #A2A1 con `OrderSteps` (`deliveryMethod: 'pickup'`,
  `timestamps` desde `DEMO_ORDER.timeline`), avanzando de `confirmed` a
  `preparing` a `ready` sincronizado con el reloj: como la escena comprime
  ~40 minutos en ~8 segundos, cada carril avanza según su hora del guion, y el
  de la derecha termina a las 21:41 mientras el izquierdo sigue hasta 21:58.
  Contador: "0 mensajes".
- Cierre: al terminar, una fila de veredicto con los dos relojes ("Listo a las
  21:58" / "Listo a las 21:41") y la frase "Nadie del local escribe un solo
  mensaje." en `text-(--brand-ink)`. Debajo, los cuatro `THREAD_COSTS` como
  lista densa (sin íconos en círculo).
- Control "Ver de nuevo" (≥ 44 px) que reinicia la escena. `DEMO_SCENE_CAPTION`
  visible. Reduced motion: los dos carriles renderizan el estado final.
- Mobile: los carriles apilados, WhatsApp primero; los relojes siguen
  sincronizados. Desktop: lado a lado, alineados arriba.
- La sección conserva `id="como-funciona"` (ancla de "Ver cómo funciona").

## Slice C — El recorrido

**Dueño exclusivo de:** `src/views/landing/screens.tsx` (el export pasa a
llamarse `OrderJourney`), `src/views/landing/order-journey.tsx` (nuevo, cliente).

Las cinco estaciones de `JOURNEY`, en orden, como **un solo recorrido**:

- **Desktop (`lg:`)**: dos columnas. Izquierda, el visor: un marco donde vive la
  captura de la estación activa (marco de celular para las de 720×1560, marco
  de escritorio para las de 1920×1200), `position: sticky` bajo la barra
  (`top` = `--sticky-offset`), con crossfade de `--dur-base` al cambiar y las
  cinco imágenes ya montadas (`next/image`, solo la primera `priority`) para
  que el cambio no descargue nada. Derecha, las cinco estaciones apiladas como
  bloques de texto (quién, título, frase, 3 hechos) unidos por un riel vertical
  con `StepMark` (`done` / `current` / `todo` según la activa).
  `IntersectionObserver` decide la activa; **nada de pinning con JS ni de
  scroll secuestrado**.
- **Mobile**: un riel horizontal con `scroll-snap-type: x mandatory`, una
  estación por pantalla (captura arriba, texto abajo), botones anterior /
  siguiente de ≥ 44 px y los `StepMark` como indicador de posición. El scroll
  nativo manda; los botones solo hacen `scrollIntoView`.
- Cada captura lleva `alt` real y `SCREENSHOT_CAPTION`. El encabezado de la
  sección es el "quién" de la estación, no una etiqueta chica arriba del título.
- `id="recorrido"`. El título de sección: "El recorrido de un pedido".

## Slice D — Las pruebas

**Dueño exclusivo de:** `src/views/landing/edge.tsx`,
`src/views/landing/eta-demo.tsx` (nuevo, cliente),
`src/views/landing/events-demo.tsx` (nuevo, cliente),
`src/views/landing/delivery.tsx`, `src/views/landing/delivery-quote.tsx`
(nuevo, cliente), `src/views/landing/included.tsx`.

**`WhatOnlyComandApp`** (`id="diferencias"`), los dos diferenciadores como dos
pruebas interactivas, no dos párrafos:

1. **`EtaDemo`** — "El tiempo de espera se mueve con la cocina". Un control de
   rango (`<input type="range">` estilizado con los tokens, 0 a
   `ETA_DEMO.maxActiveOrders`, con etiqueta "Pedidos activos en la cocina" y
   marcas en el umbral) que recalcula con `etaMinutesFor()`. Se ve: los dos
   ítems con su `prep_minutes` y cuál manda ("se entrega junto, manda el más
   lento"), el multiplicador aplicado o no, y el ETA resultante en grande y
   `tabular`, re-montado con `key` y `.landing-num-in` al cambiar. Al lado, fijo
   y en `text-muted-foreground`: "Hoy por WhatsApp: 20 minutos, siempre"
   (`todaysFixedAnswerMinutes`). Sin autoplay: es interactivo, y el valor
   inicial es 2 pedidos activos.
2. **`EventsDemo`** — "El pedido sale por eventos hacia tu sistema". El log de
   `DEMO_EVENTS` apareciendo fila por fila (`.landing-row-in`, cadencia
   `--dur-beat`) al entrar en pantalla, cada fila con hora, nombre del evento
   en `font-mono` (es dato, no disfraz) y detalle; a la derecha de cada fila,
   la entrega "→ tu sistema" con un tilde que se cumple un beat después.
   "Ver de nuevo". `DEMO_SCENE_CAPTION`. El texto de apoyo dice lo que es
   cierto: cada cambio de estado se anota y se entrega al software que el
   local ya usa, sin migrar ni cargar nada dos veces.

**`DeliverySection`** (`id="delivery"`): la captura del repartidor **se va al
recorrido** (Slice C). Queda (a) el cotizador **`DeliveryQuote`**: un control de
rango para el subtotal (`DELIVERY_DEMO_SUBTOTAL`) y un par de botones
segmentados "Hay un repartidor libre / Están todos en la calle"; muestra con
`buildDeliveryQuote({ delivery: DELIVERY_DEMO, subtotalCents, availability,
currency: 'ARS' })` el envío (o "Envío gratis" al pasar `freeFromCents`),
"faltan $X para el mínimo" cuando corresponde, y los minutos de viaje; los
montos con `formatCentsCompact`, `tabular`, `.landing-num-in` al cambiar. Y (b)
los cinco hechos del delivery como **lista de definiciones densa** (término en
negrita + una línea), sin íconos en círculo. Título: "Delivery con flota
propia".

**`WhatsIncluded`** (`id="incluido"`): los mismos 16 ítems, **textual**,
reagrupados por quién los usa en cuatro columnas densas con subtítulo: "Para tu
cliente", "Para el mostrador", "Para vos", "Para tu marca". Lista simple con
separador de 1 px, sin tildes ni tarjetas. Dos columnas en `sm:`, cuatro en
`lg:`.

## Slice E — Cierre comercial

**Dueño exclusivo de:** `src/views/landing/pricing.tsx`,
`src/views/landing/pricing-calculator.tsx` (nuevo, cliente),
`src/views/landing/faq.tsx`, `src/views/landing/closing.tsx`,
`src/views/landing/landing-footer.tsx`.

**`Pricing`** (`id="precio"`), en la banda navy: el `Panel` blanco se mantiene y
adentro va **`PricingCalculator`**: `Stepper` de `surfaces.tsx` ("¿Cuántos
locales?", 1 a `PRICING_MAX_STORES`), el total mensual grande en
`text-(--brand-ink)` `tabular` (re-montado con `key` y `.landing-num-in`), y el
desglose en una línea ("1 × $ 59.999 + 2 × $ 50.000") que aparece solo desde 2
locales. Todo con `monthlyTotalCents()` y `formatCentsCompact`. La línea de los
15 días queda arriba, tal cual. **Ni una palabra sobre IVA** mientras
`PRICING.IVA_DISCLOSED` sea `false`.

**`Faq`** (`id="faq"`): sigue `<details>`/`<summary>` nativo y todos cerrados.
Se le suma el atributo `name` común para que abrir uno cierre el otro (nativo,
sin JS); el chevron gira con `transition` de `--dur-base`; la apertura animada
ya la da `globals.css`. Cada respuesta termina con un link
"Preguntar esto por WhatsApp" → `whatsappQuestionHref(item.q)`, con
`target="_blank" rel="noopener noreferrer"`, ≥ 44 px de alto. Los textos de
`FAQ_ITEMS` no cambian (viajan al JSON-LD).

**`Closing`**: banda navy con el CTA grande, y **debajo del botón, el mensaje
exacto que va a abrir** (`WHATSAPP_MESSAGE`) como una burbuja de chat en la
paleta de ComandApp con el rótulo "Esto es lo que se manda". El lector no toca
un botón a ciegas. El mail de respaldo se mantiene.

**`LandingFooter`**: sin cambios de contenido; el logo se lleva al mismo tamaño
legible que fijó Slice A en la barra (≈ 104 px).
