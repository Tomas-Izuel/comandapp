# Slice A — Chasis y hero

Dueño exclusivo de: `src/app/page.tsx`, `src/views/landing/landing-bar.tsx`,
`src/views/landing/landing-bar-progress.tsx` (nuevo), `src/views/landing/hero.tsx`,
`src/views/landing/split-text.tsx`, `src/views/landing/hero-ticket.tsx` (nuevo).

## Qué se hizo

### `page.tsx`
Reordenó las secciones al orden nuevo de `01-tasks.md`: `LandingBar` ·
`LandingHero` · `TodayVersus` · `OrderJourney` (import renombrado desde
`ThreeScreens`, que Slice C ya había cambiado para cuando se corrió el
typecheck final) · `WhatOnlyComandApp` · `DeliverySection` · `WhatsIncluded` ·
`Pricing` · `Faq` · `Closing` · `LandingFooter`. Metadata y los dos JSON-LD sin
cambios.

### `landing-bar.tsx` + `landing-bar-progress.tsx` (nuevo, cliente)
- **Logo**: medía real 2850×826 (no 1418×826 como decía el brief original —
  verificado con `sips -g pixelWidth -g pixelHeight`, y corregido a mitad de
  tarea tras un aviso del coordinador). Con el aspect-ratio mal declarado, la
  caja se dimensionaba por ALTO (`h-7…h-10`) contra una imagen mucho más
  apaisada de lo asumido, así que `object-contain` mandaba por el ANCHO de la
  caja y el logo terminaba con ~14px de alto real dentro de una caja de 28 —
  de ahí el "~50px de ancho" que reportó la inspección. Se corrigió a
  `aspect-[2850/826]` y se pasó a dimensionar por ANCHO (`w-26` = 104px mobile,
  `md:w-32` = 128px desktop, dentro del rango 120–140px pedido), que es el eje
  que de verdad limita a un wordmark tan apaisado.
- **`SectionLabel`**: el rótulo de la sección vigente, solo desde `md:`.
  `useActiveSectionId()` usa un `IntersectionObserver` sobre
  `[data-landing-section]` con `rootMargin: '-72px 0px -75% 0px'` (banda
  angosta justo debajo de la barra fija) y conserva el último activo cuando
  ninguno cruza la banda (evita parpadear a "nada" en cada límite de sección).
  El "crossfade" pedido se resolvió reusando `.landing-num-in` (la clase que ya
  existe para "un número que cambió") montada con `key={label}` en vez de un
  efecto manual con `setState` de fade-out→timeout→fade-in — ese manual
  disparaba `react-hooks/set-state-in-effect` (ESLint) porque llamaba
  `setState` síncronamente al tope del efecto sin pasar por un callback
  async/de suscripción; la versión con `key` no necesita estado propio para la
  transición, solo deriva `label` de `activeId`.
- **`ReadingProgressBar`**: línea de 2px, `bg-primary`, `absolute` al borde
  inferior del `<header>` (que ahora es `relative`). Progreso con
  `scroll`+`requestAnimationFrame` (throttle clásico con una bandera
  `ticking`), no `animation-timeline: scroll()` — Safari todavía no lo cubre
  parejo y esto no necesita JS adicional más allá del que ya hay. Actualiza
  `transform: scaleX(...)`, nunca `width` (no dispara layout).
- Verificado en vivo (Chrome, scroll manual): el rótulo cambia de "La carrera"
  a "Lo que WhatsApp no da" al cruzar la sección `diferencias`, y la línea de
  progreso pasa de ~25% a ~50% en el mismo tramo.

### `hero.tsx`
- `SplitHeading` sigue siendo la única pieza que cambia de forma (ver abajo);
  el resto del hero es igual salvo:
- **Recorte del celular**: `lg:aspect-[720/1390]` → `lg:aspect-[720/1150]`. La
  inspección había medido ~587px de alto de celular contra ~430px de columna
  de texto a `xl`, dejando aire vacío debajo del texto. Con el nuevo recorte
  el celular mide ~460–500px según el breakpoint, mucho más parejo con el
  bloque de texto (título + párrafo + precio + botones). Verificado en vivo a
  ~1440–1568px: la sección ya no deja una franja vacía notoria bajo el texto.
- **Tarjetas flotantes → ticket real**: las tres `Panel` con datos sueltos
  ("Falta 18 min", "#A2A1 Listo", "$ 23.600 Pagado") se reemplazan por
  `<HeroTicketFloat />`, que usa `DEMO_ORDER` de `src/lib/landing.ts` —el mismo
  pedido que corre el resto de la página— y muestra: "Entró 21:20 · Pagado",
  "Cocinando · listo aprox. 21:44", "#A2A1 · Listo 21:41".
- **Mobile**: antes las tres tarjetas no existían en mobile y esa información
  se perdía. Ahora `<HeroTicketRow />` (siempre en el DOM, `lg:hidden`, NO
  `aria-hidden` porque ahí es la única forma en la que ese dato existe) las
  muestra como fila compacta de 3 `Panel` debajo del celular.

### `hero-ticket.tsx` (nuevo, cliente)
Dos exports: `HeroTicketFloat` (desktop, decorativo, `aria-hidden`) y
`HeroTicketRow` (mobile, contenido real, sin `aria-hidden`). El desktop entra
en escena una vez, sin replay (`useRevealCount`): arranca 1000ms después del
mount (le da tiempo a `SplitHeading`, que dura ≤900ms) y cada tarjeta sigue a
la anterior con `--dur-beat` (700ms), medido con `requestAnimationFrame`
acumulando tiempo solo mientras `!document.hidden` (se pausa con la pestaña
oculta, se retoma al volver). `prefers-reduced-motion` se resuelve con
`useSyncExternalStore` (no con un `useEffect`+`setState`, que hubiera
disparado el mismo lint de "set-state-in-effect"): las tres entran juntas,
sin escena, desde el primer render que detecta la preferencia.

**Decisión de acoplamiento**: no se encadenó el arranque del ticket al
`onLinesAnimationComplete` real del titular (esa prop existe en
`SplitHeading` pero no tiene consumidor). `hero.tsx` es Server Component y no
puede pasar una función de una isla cliente a otra a través suyo — hubiera
hecho falta un bus de eventos (`CustomEvent` en `window`) para una coreografía
de una sola vez en una sola sección. Un timer fijo de 1000ms (holgado contra
el presupuesto de 900ms del titular) es más simple y cumple igual.

### `split-text.tsx`
- `SplitHeading` pasa de `type: 'chars'` a `type: 'lines', mask: 'lines'`
  (GSAP SplitText 3.13+, verificado contra
  `node_modules/gsap/src/SplitText.ts` y la doc vía Context7). `autoSplit:
  true` reemplaza el `document.fonts.ready` manual de la ronda anterior (la
  doc de GSAP dice que ya re-parte solo al terminar de cargar la fuente o al
  cambiar el ancho del elemento); `animationCompletedRef` evita que un
  re-split posterior (fuente, resize, o el doble montaje de React en
  desarrollo) repita la entrada — solo reacomoda con `gsap.set`.
- **El bug real que arregla esta ronda**: el `<h1>` arrancaba en `opacity: 0`
  por CSS (`className="opacity-0 motion-reduce:opacity-100 ..."` en la versión
  anterior), y si el efecto de GSAP no llegaba a correr —o corría tarde— el
  titular quedaba en blanco (la inspección real lo vio a medio partir, como
  "Ve"). Ahora el `<h1>` se sirve VISIBLE en el HTML, sin `opacity-0` ni clase
  de ocultamiento alguna. Lo único que oculta algo es `useGSAP`, que corre por
  debajo en `useLayoutEffect` (confirmado leyendo
  `node_modules/@gsap/react/src/index.js`): partir el texto y ponerlo en su
  posición de arranque (`gsap.fromTo`, que aplica el `from` sincrónicamente al
  crear el tween) pasa en el mismo commit, antes de que el navegador pinte el
  frame siguiente. Consecuencia: si el JS nunca corre, el titular queda visible
  de inmediato (no hace falta ningún timer de respaldo ni `@keyframes` con
  `clearProps`, que era la alternativa que sugería el brief); si reduced motion
  está activo, ni siquiera se llama a `SplitText`.
- **Falso positivo encontrado y descartado, documentado en el archivo**: en la
  inspección en vivo la segunda línea del titular apareció recortada varias
  veces, con un `transform: translateY(...)` que nunca llegaba a 0. Antes de
  concluir que `mask: 'lines'` chocaba con el `line-height: 1.06` de
  `.display` (la voz tipográfica apretada de TODOS los títulos del sistema),
  se aisló la causa real: el navegador de este entorno comparte pestañas entre
  los cinco agentes de la corrida, y `document.hidden` daba `true` en esas
  lecturas — la pestaña quedaba de fondo a mitad de la animación de GSAP (que
  corre por `requestAnimationFrame`, que el navegador pausa en pestañas
  ocultas). Repetido en una corrida sin interferencia (navegar y leer el DOM
  en el mismo lote de acciones, sin pasos sueltos en el medio) el resultado
  fue consistente: las dos líneas terminan en `transform: none`, exactamente
  encuadradas dentro del alto del `<h1>`. `mask: 'lines'` se mantiene tal como
  pide el brief.

## Verificación hecha

- `npx tsc --noEmit -p .` → limpio, sin errores (los cinco slices ya habían
  converg­ido para cuando se corrió; no quedó pendiente el import de
  `OrderJourney`).
- `npx eslint src/app/page.tsx src/views/landing/landing-bar.tsx src/views/landing/landing-bar-progress.tsx src/views/landing/hero.tsx src/views/landing/split-text.tsx src/views/landing/hero-ticket.tsx`
  → limpio. Encontró y forzó a corregir tres antipatrones reales de React 19 /
  el nuevo `eslint-plugin-react-hooks` ("React Compiler" ruleset), documentados
  arriba: `setState` síncrono dentro de un efecto (dos casos, resueltos con
  `useSyncExternalStore` y con derivar el rótulo por `key` en vez de estado
  propio) y mutación de un ref durante el render (resuelto moviendo la
  asignación a un `useEffect`).
- `curl -s http://localhost:3000/ | grep -o '<h1[^>]*>[^<]*'` → devuelve el
  titular completo, sin `opacity-0` en la clase.
- `web-design-guidelines`: sin `transition: all`, sin `outline-none`, motion
  limitado a `transform`/`opacity`, reduced-motion cubierto en las tres islas.
- Chrome, 1440–1568px: titular en dos líneas legibles y asentadas
  (`transform: none` verificado en consola), las tres tarjetas del ticket
  entran en cascada (verificado forzando momentáneamente el camino de reduced
  motion para no depender del timing real en un navegador con pestañas
  compartidas entre agentes), el recorte del celular ya no deja una franja
  vacía notoria, el rótulo de sección cambia y la línea de progreso avanza al
  scrollear.
- Mobile 390px: **no se pudo confirmar por captura real** — el entorno de
  Chrome de esta corrida comparte una sola ventana entre los cinco agentes en
  paralelo, y `resize_window` a 390×844 fue pisado repetidamente por el resize
  de otro agente (`window.innerWidth` seguía reportando 1920 después de varios
  intentos). Se verificó en su lugar por inspección de DOM: `HeroTicketRow`
  está siempre presente en el árbol con la clase `lg:hidden` y el contenido
  correcto ("Entró 21:20", "Pagado", "Cocinando", "Listo aprox. 21:44",
  "#A2A1", "Listo 21:41"), y por lectura de código que `HeroTicketFloat`
  (`hidden lg:block` en cada `Panel`), el rótulo de sección (`md:block`) y el
  logo (`w-26` sin sufijo, es decir 104px por debajo de `md:`) se ocultan/
  ajustan correctamente por debajo de los breakpoints de Tailwind. Recomiendo
  que el reviewer o el test-engineer confirmen con una ventana propia si el
  entorno lo permite.

## Acceptance criteria para el test engineer (comportamiento observable)

- **`<h1>` del hero**: el texto completo "Vendé online sin que nadie escriba
  un WhatsApp." tiene que estar en el HTML servido (sin JS) y ser accesible
  por `getByRole('heading', { level: 1 })` con ese `accessible name` completo
  (SplitText pone `aria-label` con el texto entero en el `<h1>` y `aria-hidden`
  en cada línea generada — un test debería consultar el heading por rol/nombre,
  nunca el DOM interno de líneas).
- **Reduced motion** (`prefers-reduced-motion: reduce` emulado en el test):
  el `<h1>` no debe partirse en `<div class="split-line">` — sigue como texto
  plano; las tres tarjetas de `HeroTicketFloat` deben estar TODAS presentes
  desde el primer render (sin esperar ningún timer).
- **`HeroTicketFloat`** (viewport `lg:` o mayor): sus tres `Panel` son
  `aria-hidden` — un test de accesibilidad no debería encontrarlas como
  contenido, y un test de contenido visible debería ignorarlas a propósito
  (son decorativas, repiten lo que ya dice el texto accesible del hero).
- **`HeroTicketRow`** (cualquier viewport, siempre en el DOM): SÍ es contenido
  accesible — un test puede buscar el texto "Entró 21:20", "Cocinando",
  "#A2A1" ahí sin que esté oculto por ARIA. Nota: está SIEMPRE en el DOM
  (oculto visualmente por CSS `lg:hidden` en desktop, no por JS), así que un
  test que solo consulta el DOM (sin evaluar CSS real, p. ej. jsdom) lo
  encuentra en cualquier viewport — eso es esperado y no un bug.
- **`SectionLabel`** (barra fija): antes de que cualquier sección cruce la
  banda de detección, el componente renderiza `null` (no hay rótulo). Después,
  muestra el `label` de la sección de `SECTIONS` cuya `id` está activa. Un
  test de integración necesitaría simular `IntersectionObserver` (jsdom no lo
  implementa nativamente) o correr en un navegador real (Playwright) con
  scroll real.
- **`ReadingProgressBar`**: es puramente visual/`aria-hidden`, no hay
  comportamiento que testear más allá de que no rompa el render.
- **Logo de `LandingBar`**: `alt=""` a propósito (es decorativo, el nombre del
  producto ya está en el `aria-label` del `<Link>` padre, "ComandApp, ir al
  inicio") — un test de accesibilidad debe buscar el link por ese
  `aria-label`, no por el alt de la imagen.

## Qué quedó afuera / follow-ups

- No se implementó ningún mecanismo de comunicación entre `SplitHeading` y
  `HeroTicketFloat` más allá del timer fijo — si en una ronda futura el
  titular cambia de duración considerablemente, el timer de 1000ms de
  `hero-ticket.tsx` (`FIRST_DELAY_MS`) se desalinea y hay que ajustarlo a mano.
- La verificación visual completa en mobile (390px) quedó pendiente por la
  limitación de la ventana de Chrome compartida entre agentes en esta corrida
  — ver sección de Verificación arriba.
- No se tocó `SplitHeading`'s `stagger`/`duration` defaults más allá de lo
  necesario para el presupuesto de ≤900ms; con el texto actual (2 líneas)
  el total es 0.6s + 0.09s = 0.69s.
