# Slice C — El recorrido

## Qué se hizo

Reescribí `src/views/landing/screens.tsx` (Server Component) y creé
`src/views/landing/order-journey.tsx` (isla cliente nueva). El export de
`screens.tsx` pasó de `ThreeScreens` a **`OrderJourney`**; la vieja grilla 2×2
de capturas sueltas desapareció.

### Archivos tocados

- `src/views/landing/screens.tsx` — reescrito. Server Component puro: arma la
  `<section id="recorrido" data-scroll-anchor data-landing-section>`, el
  `SectionHeading` ("El recorrido de un pedido", sin kicker, sin 01/02/03) y le
  pasa `JOURNEY` (de `src/lib/landing.ts`, sin tocar) a `OrderJourneyClient`.
  Cero estado, cero `'use client'`.
- `src/views/landing/order-journey.tsx` — nuevo, `'use client'`. Toda la
  interacción vive acá.

## Cómo quedó armado

### Desktop (`lg:`)

`DesktopJourney`: grid de 2 columnas (`minmax(0,5fr)_minmax(0,6fr)`).

- **Izquierda — el visor** (`Visor` + `FrameStack`): `position: sticky; top:
  var(--sticky-offset)`. Es una caja de altura fija (`h-[26rem] xl:h-[30rem]`)
  que contiene DOS `FrameStack` superpuestos (`absolute inset-0 m-auto`): uno
  para las estaciones de aspecto celular (720×1560: compra, espera, reparto) y
  uno para las de escritorio (1920×1200: cocina, caja). El de celular se
  dimensiona por `h-full` (alto fijo, ancho vía `aspect-ratio`); el de
  escritorio por `w-full` (ancho fijo, alto vía `aspect-ratio`). Cambiar de
  aspecto es un crossfade de **opacidad** entre dos cajas que ya ocupan el
  mismo lugar — el contenedor mide siempre lo mismo, así que el alto del visor
  **nunca salta**. Verificado a mano: al cruzar de "El que compra" (celular) a
  "El mostrador" (escritorio) scrolleando, la transición es un fundido liso sin
  ningún salto de layout (ver sección de verificación).
  Las 5 imágenes están montadas desde el inicio (`next/image`, `fill`,
  `object-cover`); solo la de la estación 0 (`compra`) lleva `priority`, el
  resto `loading="lazy"` (ya montadas, no se descargan al cambiar). Cada imagen
  inactiva lleva `aria-hidden` individual, y cada `FrameStack` inactivo lleva
  `aria-hidden` en el contenedor — un lector de pantalla solo "ve" la captura
  activa.
  Debajo del visor, `figcaption` con el `claim` de la estación activa +
  `SCREENSHOT_CAPTION`.
- **Derecha — riel de texto**: `<ol>` con las 5 estaciones, cada una con
  `StepMark` (`done`/`current`/`todo`) + una línea de 1px (`bg-border`) que las
  une, y el bloque de copy (`StationCopy`): `who` como `<h3>` (el encabezado
  real de la estación, no una etiqueta chica sobre `title`), `title` debajo en
  cuerpo destacado, `claim` en `muted-foreground`, y los 3 `facts` como lista
  con marcador propio (sin íconos en círculo).
- **Activa = `IntersectionObserver`** sobre los 5 bloques de texto,
  `rootMargin: '-40% 0px -40% 0px'`: la franja central del viewport decide qué
  estación está "activa". Nada de pinning por JS ni scroll secuestrado — el
  scroll es 100% nativo, `sticky` es CSS puro.

### Mobile

`MobileJourney`: riel horizontal (`className="rail"` + `style={{
scrollSnapType: 'x mandatory' }}` — el `.rail` de `globals.css` trae
`proximity`, así que el `mandatory` que pide el contrato se fuerza con
`style` inline, que gana por especificidad sin tocar el archivo compartido).
Una `MobileStationCard` por estación (imagen arriba en su propio marco +
`who`/`title`/`claim`/`facts`/`SCREENSHOT_CAPTION` abajo, con `min-h-[16rem]
sm:min-h-[14rem]` en el bloque de texto para que las 5 tarjetas midan lo
mismo). Debajo del riel: botón anterior (`ChevronLeft`, `iconButtonClass('surface')`,
44px, `touch-manipulation`), los 5 `StepMark` como indicador de posición
(`aria-current` en el `<li>` activo) y botón siguiente. Los botones llaman
`scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', inline: 'start',
block: 'nearest' })` y se deshabilitan en los extremos. La estación activa se
detecta con un segundo `IntersectionObserver`, `root` = el propio riel,
`threshold: 0.6`.

### Estado compartido

`OrderJourneyClient` (el único export del archivo) mantiene `activeIndex` (un
solo estado, alimentado por CUALQUIERA de los dos observers — el que esté
realmente visible según el breakpoint CSS es el único que dispara) y
`reducedMotion` (leído con inicializador perezoso de `useState`, no en el
cuerpo del efecto, para no disparar un `setState` síncrono ahí — esto lo marcó
el hook de `react-hooks/set-state-in-effect` en la primera pasada y lo corregí).
`reducedMotion` solo se usa para decidir `behavior` de `scrollIntoView` en
mobile: el crossfade de opacidad en desktop ya lo recorta a instantáneo el
bloque global `@media (prefers-reduced-motion: reduce)` de `globals.css`
(clampea `transition-duration` a 0.01ms), así que no hace falta lógica propia
para eso.

## Contratos consumidos (sin tocar)

- `JOURNEY`, `JourneyStation`, `SCREENSHOT_CAPTION` de `src/lib/landing.ts`.
- `SectionHeading`, `StepMark`, `iconButtonClass` de `src/views/shared/surfaces.tsx`.
- `--sticky-offset` y `.rail` de `globals.css` (el `mandatory` se fuerza vía
  `style` inline sobre `.rail`, como se explica arriba).

El aspecto de cada estación (celular vs. escritorio) se deriva en runtime de
`screen.width < screen.height` (`aspectOf()`), no de una lista de ids a mano:
si `landing.ts` agrega una estación nueva con una captura, esto no se
desactualiza en silencio.

## Comportamiento user-facing y a11y (spec para el test engineer)

- **SSR / sin JS**: la primera estación ("El que compra") se ve activa por
  default en desktop (StepMark `current` en la fila 0, el `FrameStack` de
  celular en opacidad 100%) sin depender de que el JS corra — es el estado
  inicial de React, presente en el HTML servido. Las 5 estaciones de texto
  están todas servidas (no hay contenido oculto detrás de JS). En mobile, el
  riel funciona solo por `scroll-snap` nativo (swipe) aunque los botones no
  hidraten; solo los botones y el indicador de posición requieren JS.
- **Desktop**: scrollear la columna de texto cambia la captura del visor
  (crossfade de opacidad) y actualiza los `StepMark` (`done`/`current`/`todo`)
  sin que el usuario tenga que hacer nada más. El visor queda pegado (`sticky`)
  bajo la barra mientras dura el recorrido y se despega naturalmente al llegar
  al final de la columna de texto.
- **Mobile**: el riel se navega por swipe (scroll-snap nativo) o con los
  botones anterior/siguiente (≥44px, `aria-label` descriptivo, se deshabilitan
  en los extremos, `touch-manipulation` para evitar el delay de doble-tap). El
  indicador de posición (`StepMark` × 5) refleja la tarjeta visible
  (`aria-current="true"` en el `<li>` activo).
  clarify: la detección de "cuál tarjeta está visible" es por
  `IntersectionObserver` con `threshold: 0.6` sobre el propio riel — o sea que
  una tarjeta se considera "activa" cuando ocupa al menos el 60% del ancho
  visible del riel.
- **Reduced motion**: el crossfade del visor pasa a instantáneo (heredado del
  bloque global de `globals.css`, no hay lógica propia acá). El botón
  anterior/siguiente de mobile mueve el riel con `scrollIntoView({behavior:
  'auto'})` en vez de `'smooth'`.
- **Accesibilidad de las imágenes superpuestas**: cada `FrameStack` inactivo
  (el aspecto que no corresponde a la estación actual) lleva `aria-hidden` en
  el contenedor, y dentro de cada `FrameStack`, cada imagen que no es la activa
  también lleva `aria-hidden` individual — un lector de pantalla solo anuncia
  el `alt` de la captura realmente visible, nunca las 4 apiladas detrás.
  Los `alt` son los reales del contrato (`JourneyStation.screen.alt`), no
  genéricos.
  Los `figcaption` (desktop: debajo del visor; mobile: debajo de cada
  captura) llevan `SCREENSHOT_CAPTION` siempre.
- **Contenido largo**: los `<span>` de texto dentro de flex rows (los `facts`)
  llevan `min-w-0` para que el texto pueda envolver sin forzar overflow del
  contenedor flex (piso de `web-design-guidelines`).

## Decisiones y trade-offs

1. **Un solo `IntersectionObserver` por layout, no un tercero para "sincronizar"
   ambos.** Como `DesktopJourney` y `MobileJourney` están montados los dos
   siempre (uno con `hidden lg:grid`, el otro con `lg:hidden`), solo el que
   realmente tiene `display` distinto de `none` produce intersecciones reales;
   el otro nunca dispara su callback. Es más simple que condicionar el montaje
   por breakpoint con JS (que además rompería el requisito de que el mobile
   funcione sin JS).
2. **El "marco" de celular y de escritorio son el mismo lenguaje visual**
   (`border-border bg-muted shadow-raise rounded-(--radius) border`), sin
   bezel skeuomórfico (ni "notch" de teléfono ni barra de navegador con 3
   puntos). Es la MISMA convención que ya usaban `screens.tsx` (versión vieja)
   y `delivery.tsx` para enmarcar capturas — inventar un mockup ilustrado
   hubiera sido exactamente el tipo de adorno genérico de landing que
   `00-architecture.md` pide evitar, y hubiera introducido una superficie
   nueva a mantener.
3. **`reducedMotion` con inicializador perezoso de `useState`**, no
   `useState(false)` + `setState` en el `useEffect`: el hook de
   `react-hooks/set-state-in-effect` de este repo lo marcó como error en la
   primera pasada (dispara renders en cascada). El efecto ahora solo
   **suscribe** al cambio de la media query; el valor inicial se lee en el
   primer render del cliente.
4. **No usé `context7` para `IntersectionObserver` puntualmente** porque es
   una Web API estable sin cambios recientes relevantes al patrón usado
   (options `root`/`rootMargin`/`threshold`, callback con `entries`); sí revisé
   `craft-floor.md` y `animate.md` de `impeccable` antes de escribir el CSS de
   motion (transiciones de opacidad, sin `transition: all`, sin animar
   `width`/`height`/`aspect-ratio`).

## Verificación hecha a mano

- `npx tsc --noEmit -p .` — limpio al integrar con las otras slices (al cierre
  de este slice, sin errores en todo el proyecto).
- `npx eslint src/views/landing/screens.tsx src/views/landing/order-journey.tsx`
  — limpio.
- **Desktop (1440)**: verificado en el navegador real, integrado con
  `page.tsx` (Slice A) — scrollear la columna de texto cambia la captura del
  visor con un fundido liso, el `StepMark` avanza en sincronía
  (`done`/`current`/`todo`), y la transición celular→escritorio (compra→
  cocina) no produce ningún salto de alto: se probó explícitamente cruzando
  esa frontera de aspecto.
- **Mobile (390, simulado con un arnés temporal — el entorno de verificación
  no puede redimensionar la ventana real del navegador)**: swipe/scroll
  horizontal con snap funciona, los botones anterior/siguiente mueven el riel
  y quedan deshabilitados en los extremos, y el indicador de posición
  (`StepMark`) se sincroniza con la tarjeta visible. Nota metodológica: la
  primera ronda de pruebas con scroll **programático** (`element.scrollTo`/
  `scrollIntoView` disparado solo por JS, sin un evento de input real) no
  disparaba el `IntersectionObserver` en ese entorno — confirmé con un
  observer de prueba aislado que ni siquiera el callback inicial (garantizado
  por spec) llegaba a correr, así que es una limitación del entorno de
  verificación (probablemente throttling de una pestaña sin foco/composición
  real), no un bug del componente: con un scroll real (rueda del mouse o click
  real vía el mismo mecanismo que ya funcionaba en desktop) el observer
  respondía correctamente y de inmediato.
- Todos los archivos y rutas temporales de verificación (`scratch-slice-c-test/`,
  el export de debug `__DebugMobileJourney`) se borraron antes de cerrar.

## Qué quedó afuera / follow-ups

- No se probó en un dispositivo táctil real (solo swipe simulado vía scroll de
  mouse/rueda) — el `scroll-snap-type: x mandatory` + `scroll-snap-align:
  start` es CSS estándar y no debería comportarse distinto en touch, pero es
  el test engineer quien puede correr esto contra Playwright con emulación
  táctil real si hace falta.
- No agregué ningún primitivo nuevo a `src/views/shared/surfaces.tsx`: todo lo
  necesario (`StepMark`, `SectionHeading`, `iconButtonClass`) ya existía.
- El ancho exacto del visor (`h-[26rem] xl:h-[30rem]`) y de los marcos
  (`14rem` para celular en el visor, `34rem`/`28rem` para escritorio) son
  valores ajustados a ojo contra el `--content-max` de la landing (75rem) y la
  proporción real de las 5 capturas; si `--content-max` cambiara, convendría
  revisar estos números a mano.
