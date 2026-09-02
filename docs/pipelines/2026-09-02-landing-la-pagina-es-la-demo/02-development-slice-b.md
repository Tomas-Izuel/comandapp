# Slice B — La carrera

## Qué se implementó

Dos archivos, ambos bajo `src/views/landing/`:

- **`versus.tsx`** (Server Component, reescrito) — mantiene `export function
  TodayVersus()` y la `<section id="como-funciona">`. Se le agregaron
  `data-scroll-anchor` y `data-landing-section` (regla 1 de "Reglas para los
  cinco" en `01-tasks.md`; el archivo previo solo tenía `data-scroll-anchor`).
  Compone `<VersusRace />` (la escena interactiva) y, debajo, el **veredicto**
  y la lista de `THREAD_COSTS` como contenido **puramente servido**: los dos
  relojes finales ("Listo a las 21:58 por WhatsApp" / "Listo a las 21:41 con
  ComandApp") y la frase "Nadie del local escribe un solo mensaje." salen
  directo de `DEMO_THREAD[DEMO_THREAD.length - 1].at` y
  `DEMO_ORDER.timeline.ready` — no de un estado que la animación revela. Esto
  es deliberado y está explicado en el comentario del archivo: satisface al
  pie de la letra el requisito de la tarea ("el veredicto NO depende del JS:
  es texto servido") sin depender de que la escena haya terminado de correr.
- **`versus-race.tsx`** (nuevo, `'use client'`) — la escena: dos carriles
  (`Panel` cada uno, sin anidar), un reloj de escena único, y el control de
  reproducción.

## Cómo funciona el reloj de escena

Un solo `requestAnimationFrame` maneja las dos horas visibles y todos los
eventos (mensajes, indicador de "escribiendo", cambios de estado del pedido).
La compresión de tiempo es **lineal y derivada del contrato**, no un número
mágico por evento:

```
SCRIPT_START = 21:20 (DEMO_THREAD[0].at)
SCRIPT_END   = 21:58 (DEMO_THREAD.at último)
SCENE_MS     = 8000
msFor(hora)  = (hora_en_min - SCRIPT_START_min) / (SCRIPT_END_min - SCRIPT_START_min) * SCENE_MS
```

Con ese mapeo, `DEMO_ORDER.timeline.ready` (21:41) cae en ~4421ms de los
8000ms totales: el carril de ComandApp llega a "Listo" y se congela ahí
mientras el de WhatsApp sigue corriendo hasta el final — la misma proporción
real (21 min de 38), sin hardcodear "el carril derecho termina a los 4.4s".
Cada mensaje del local dispara primero un beat de `.landing-typing` (un
`--dur-beat` antes de su hora real, leído de `getComputedStyle` con 700ms de
respaldo) y después el mensaje con `.landing-msg-in`.

`applyBeat` recorre un array de "beats" pre-ordenado por `ms` (mensajes +
indicadores de escritura + transiciones de estado) y va aplicando los que ya
vencieron en cada frame — es el único lugar que toca `setState` durante la
reproducción.

## Pausar/reanudar: no estaba en el pedido, lo agregué por accesibilidad

`01-tasks.md` solo pedía "Ver de nuevo" al terminar. Al pasar
`web-design-guidelines` (fetch fresco antes de cerrar) encontré la regla
**"Autoplay motion >5 seconds needs pause/stop/hide controls"** — la escena
dura ~8s y arranca sola al entrar en pantalla, así que un control de replay
posterior no alcanza: durante esos 8 segundos no había forma de detenerla.

Agregué un `ScenePhase` (`idle | playing | paused | done`) y un único botón
que cambia de rol según la fase: `Pausar` (ícono `Pause`) mientras corre,
`Seguir` (ícono `Play`) mientras está pausada, `Ver de nuevo` (ícono
`RotateCcw`) cuando termina. Pausar y el corte por pestaña oculta
(`document.visibilitychange`) comparten el mismo mecanismo de acumulación de
tiempo (`elapsedAtPauseRef` + cortar `runningSinceRef`), así que reanudar
retoma exactamente donde quedó en los dos casos — verificado a mano (ver
abajo): pausé en "Confirmado" y "Seguir" seguía desde ahí, no reiniciaba.

## Reduced motion y SSR

- **`prefers-reduced-motion`**: un efecto con `window.matchMedia` llama a
  `showFinalState()` (sin timers, sin observer) y el botón de control
  desaparece por completo (`{!reducedMotion ? <button>… : null}`). Las
  burbujas nunca reciben `.landing-msg-in` en ese camino (`animated =
  !reducedMotion`), así que no hay ni una animación residual antes de que
  `globals.css` la recorte a 0.01ms.
- **Estado inicial (SSR / sin JS)**: antes de que corra cualquier efecto,
  `messages = []`, `orderStatus = 'confirmed'` con
  `orderTimestamps = { confirmed: '21:20' }`. Esto es intencional y **no** es
  "el estado final": el carril de WhatsApp se ve vacío con su cabecera (0
  mensajes), y el de ComandApp muestra solo lo que es cierto en el instante
  21:20 (pagado + confirmado), sin haber llegado a "Listo". El veredicto de
  abajo, en cambio, sale de `versus.tsx` (Server Component) y **siempre**
  está completo, con o sin JS.
- El botón de control no existe en el HTML servido inicial en el sentido de
  que su label depende de `phase`/`reducedMotion` (estado de cliente), pero
  como Next SSR-ea Client Components con su estado inicial, el HTML servido
  ya trae el botón en su forma "Ver de nuevo" (fase `idle` inicial) — nunca
  queda un hueco vacío esperando hidratación.

## Sincronía sin isla propia para el reloj de cada carril

`OrderSteps` (de `src/views/shared/order-status.tsx`) se compone tal cual,
sin tocarlo: le paso `status`, `deliveryMethod: DEMO_ORDER.deliveryMethod`
('pickup') y un `timestamps` que se va llenando de a un campo por vez
(`{ confirmed }` → `{ confirmed, preparing }` → `{ confirmed, preparing,
ready }`), nunca los tres de una — si pasara los tres desde el arranque,
`OrderSteps` mostraría "Listo 21:41" al lado de un paso que todavía no pasó,
arruinando la dramatización.

## Decisiones y trade-offs

- **El veredicto vive en el Server Component, no en la isla cliente.** Es la
  lectura más literal del requisito "el veredicto NO depende del JS" —
  ponerlo en `versus-race.tsx` habría significado renderizarlo siempre iguial
  igual (no hay motivo real para que dependa de JS), pero server-side es la
  garantía estructural: no hay forma de que un bug de JS lo oculte.
- **`min-h` reservado SOLO en el carril de WhatsApp, no en el de ComandApp.**
  Primera versión tenía `min-h-[27rem] sm:min-h-[24rem]` en los dos carriles
  (para "que la llegada de burbujas no mueva el layout", según el pedido).
  Inspeccionando a 1440 vi que el panel de ComandApp quedaba con ~150px de
  aire vacío debajo de "Entregado": `OrderSteps` nunca agrega ni saca filas
  (son siempre los mismos 4 pasos cambiando de estado), así que no tiene el
  problema de layout shift que sí tiene el chat (que va de 0 a 7 burbujas). Se
  lo saqué solo al carril derecho.
- **Sin primitivos nuevos en `src/views/shared/surfaces.tsx`.** `Panel`,
  `StatusPill` y `OrderSteps` cubren todo lo que hacía falta.
- **`applyBeat`/`play`/`pause` como `useCallback` con refs para el estado
  mutable de la animación** (`beatsRef`, `nextBeatIndexRef`, `rafRef`,
  `runningSinceRef`, `elapsedAtPauseRef`, `phaseRef`) en vez de meter todo en
  `useState`: son valores que cambian en cada frame y no necesitan re-render
  por sí mismos (lo que re-renderiza es `setLeftClock`/`setRightClock`/etc.,
  que sí importan visualmente). Mezclar los dos en `useState` habría forzado
  re-renders de más o closures obsoletas dentro del loop de `requestAnimationFrame`.

## Bug real que encontré y corregí durante la verificación visual

Agregué `grid-cols-1` explícito al contenedor de los dos carriles
(`grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-start`). No pude
confirmar en vivo si esto era necesario o cosmético porque el entorno de
verificación tiene la ventana de Chrome fija en 1440px (varios agentes
comparten la misma ventana física y se pisan al hacer `resize_window`) — al
forzar el layout mobile con un override de CSS (`.lg\:grid-cols-2 {
grid-template-columns: 1fr !important }` en una página de scratch, mismo
truco que ya había usado Slice C) confirmé que **con o sin el `grid-cols-1`
explícito el resultado a ancho angosto es el mismo** (un solo `<div
className="grid">` sin columnas explícitas ya apila en una columna por
defecto). Lo dejé de todos modos: es el idiom estándar de Tailwind
(`grid-cols-1 lg:grid-cols-2`) y hace la intención explícita en vez de
depender del comportamiento implícito del navegador sin `grid-template-columns`.

## Qué verifiqué a mano

- `npx tsc --noEmit -p .`: limpio para todo el proyecto en el momento de
  cerrar (el único error que vi en el camino, en `delivery-quote.tsx` de
  Slice D, no es mío y no lo toqué).
- `npx eslint src/views/landing/versus.tsx src/views/landing/versus-race.tsx`:
  sin hallazgos.
- El hook de `impeccable` corrió después de cada edición: "No deterministic
  design-quality issues found" en las dos primeras pasadas; después de la
  sexta edición avisó que dejaba de emitir hallazgos nuevos en la sesión — no
  hubo ningún hallazgo pendiente sin atender.
- **Chrome MCP, esta vez sí funcionó** (a diferencia de lo reportado por Slice
  E): la clave fue navegar a `http://127.0.0.1:3000/...` en vez de
  `http://localhost:3000/...` — con `localhost` la navegación reportaba éxito
  pero `tabs_context_mcp` mostraba que la pestaña se quedaba en
  `chrome://newtab/`, con `127.0.0.1` cargó siempre. Dejo esto anotado por si
  le sirve a otro agente o al `code-reviewer`.
- Con Chrome MCP funcionando, monté una página de scratch temporal
  (`src/app/scratch-slice-b-preview/`, borrada antes de cerrar) porque
  `page.tsx` (Slice A) estuvo roto por momentos mientras los cinco slices
  guardaban en paralelo (`Export ThreeScreens doesn't exist`, y después un
  literal a medio escribir en `landing-bar.tsx`) — until-loop con
  `curl`/`run_in_background` hasta que `/` volvió a compilar, y en paralelo
  seguí verificando mi sección de forma aislada.
- **Verifiqué visualmente a 1440**: la escena completa corrió sola al cargar
  la página (mock de "entra en pantalla" porque en el scratch ya estaba
  arriba de todo), terminó con 7 mensajes / "Listo 21:58" a la izquierda y
  "Listo 21:41" con los 4 pasos completos a la derecha, el botón pasó a "Ver
  de nuevo", y el veredicto + los 4 `THREAD_COSTS` se vieron completos debajo.
- **Verifiqué mobile con el layout real** (no un contenedor angosto, que NO
  cambia qué media queries de Tailwind aplican — error que cometí primero y
  corregí forzando el CSS del breakpoint, ver arriba): los carriles apilados,
  WhatsApp primero, ComandApp segundo, sin overflow horizontal, el veredicto
  y la lista de costos legibles al ancho de 390px.
- **Verifiqué la interacción real con clicks**: "Ver de nuevo" reinicia la
  escena desde 0 mensajes / "Confirmado"; "Pausar" mid-escena congela el
  reloj y las burbujas exactamente donde estaban (probé pausando en
  "Confirmado" 21:20); "Seguir" retoma desde ahí — llegó hasta "Listo 21:41",
  no reinició. Foco visible (`:focus-visible`) en el botón después de cada
  click.
- **No pude emular `prefers-reduced-motion` en vivo**: el MCP de Chrome
  disponible no expone `Emulation.setEmulatedMedia` ni un toggle de
  DevTools Rendering. Verificado por lectura de código en cambio: el efecto
  de `matchMedia` llama a `showFinalState()` y nunca agrega
  `.landing-msg-in` (`animated = !reducedMotion`); el mismo patrón que usa
  el resto del pipeline (Slice E confía en el bloque global
  `@media (prefers-reduced-motion: reduce)` de `globals.css` para el resto).
  Sugiero que el `code-reviewer` o `test-engineer`, si tienen acceso a
  DevTools con emulación de medios, confirmen el camino de reduced motion
  en vivo.
- No se generó ningún archivo de test ni se tocó `tests/`.

## Qué quedó afuera / follow-ups

- No agregué el ícono `WhatsApp` (el SVG de marca) a la etiqueta "Hoy, por
  WhatsApp": es texto plano a propósito, coherente con la decisión ya tomada
  de no clonar la identidad visual de WhatsApp en esta escena (nunca verde,
  nunca doble tilde) — usar su ícono de marca al lado del texto habría sido
  la misma trampa con otro disfraz.
- No pude confirmar en vivo si `grid-cols-1` explícito cambia algo respecto
  del comportamiento implícito del navegador (ver sección de arriba); lo dejé
  puesto por claridad de intención, sin impacto negativo conocido.
- El `code-reviewer`/`test-engineer` deberían confirmar el camino de
  `prefers-reduced-motion` con herramientas que sí puedan emularlo.

## Acceptance criteria para `test-engineer` (comportamientos user-facing)

- **`#como-funciona`**: la sección raíz lleva `id="como-funciona"`,
  `data-scroll-anchor` y `data-landing-section`. Título de sección "El mismo
  pedido, dos maneras" (h2, sin kicker).
- **Antes de que la escena entre en pantalla / sin JS**: carril "Hoy, por
  WhatsApp" muestra "0 mensajes · nadie cocinó todavía" con el reloj en
  21:20 y sin burbujas; carril "Con ComandApp" muestra "0 mensajes",
  "#A2A1 · $ 16.700", `StatusPill` "Pagado 21:20", y `OrderSteps` con
  "Confirmado" como paso actual (con hora 21:20) y los demás pasos
  pendientes. Debajo, el veredicto YA está completo: "Listo a las 21:58 por
  WhatsApp", "Listo a las 21:41 con ComandApp", "Nadie del local escribe un
  solo mensaje." y los cuatro `THREAD_COSTS` — este bloque no depende de que
  la animación haya corrido.
- **La escena, con `IntersectionObserver` (umbral 0.4)**: arranca una sola
  vez al entrar la sección en pantalla. Los 7 mensajes de `DEMO_THREAD`
  aparecen en orden con su hora (`at`), con un indicador de "escribiendo"
  (tres puntos animados) antes de cada uno de los 4 mensajes del `local`. El
  contador de arriba del carril WhatsApp sube de "0 mensajes" a "7 mensajes"
  (singular correcto en "1 mensaje"). El reloj visible de WhatsApp avanza de
  21:20 a 21:58; el de ComandApp avanza de 21:20 a 21:41 y se congela ahí
  (no sigue a 21:58). `OrderSteps` pasa de "Confirmado" a "En preparación"
  (21:21) a "Listo" (21:41), con las horas apareciendo de a una a medida que
  se cumplen (nunca las tres desde el arranque).
- **Control de reproducción**: mientras la escena corre, un botón "Pausar"
  (con ícono, ≥44px de alto) congela el reloj y las burbujas exactamente
  donde están; el mismo botón pasa a decir "Seguir" y, al tocarlo, continúa
  desde donde se pausó (no reinicia). Al terminar la escena, el botón pasa a
  decir "Ver de nuevo" y, al tocarlo, reinicia todo el carril desde 0
  mensajes / "Confirmado" 21:20.
- **`prefers-reduced-motion: reduce`**: no debe verse ningún timer ni
  indicador de "escribiendo"; los dos carriles deben mostrar directamente el
  estado final (7 mensajes, "Listo 21:41"/"21:58" en los relojes) y el botón
  de control no debe existir en el DOM.
- **Pestaña oculta durante la escena** (`document.visibilityState ===
  'hidden'`): la escena se pausa sola y retoma exactamente donde estaba al
  volver a la pestaña (mismo mecanismo que "Pausar" manual).
- **`DEMO_SCENE_CAPTION`** ("Escena de demostración · no es un caso real")
  visible en la sección, en todo momento (con y sin JS).
- Ningún componente de este slice renderiza la palabra "IVA" (no aplica
  directamente a esta sección, pero se mantiene la invariante general del
  barrido de `landing-source-scan.test.ts`).

## Correcciones (ronda post-review, 2026-09-02)

Atendí el hallazgo 3 [MAYOR] de `03-review.md` sobre `versus-race.tsx`: leía
`prefers-reduced-motion` con `useState` + `setState` síncrono dentro de un
`useEffect`, el único de las ocho islas que no seguía el patrón que el resto
del pipeline adoptó a propósito. El riesgo real que señaló la review: el
efecto que arma el `IntersectionObserver` de autoplay podía correr en el
MISMO commit con el valor de clausura `reducedMotion=false` viejo (antes de
que el re-render con el valor correcto lo desmontara), así que en teoría
`observer.observe(node)` se llamaba con la guarda equivocada.

**Arreglo**: migré a `useSyncExternalStore` con `matchMedia`, exactamente el
patrón de `events-demo.tsx` (`subscribeReducedMotion` / `getReducedMotionSnapshot`
/ `getReducedMotionServerSnapshot`, snapshot del servidor `false`). El valor ya
está disponible en el primer render del cliente, así que el efecto del
`IntersectionObserver` nunca ve un valor stale — la ventana de carrera queda
eliminada por construcción, no por suerte de timing.

Esto obligó a un segundo cambio, más de fondo: seguí el mismo criterio que
`hero-flow.tsx` y arranqué TODO el estado de la escena en su valor FINAL
(los 7 mensajes de `DEMO_THREAD`, `orderStatus: 'ready'`, los dos relojes en
`21:58`/`21:41`) en vez de vacío. Es lo que garantiza que el HTML servido y el
primer paint de un cliente con `prefers-reduced-motion` — que ahora nunca
llama a `play()`, ver el guard `if (reducedMotion) return` — muestren la
carrera ya resuelta, sin ningún efecto adicional que "fuerce" el estado
terminado (no hace falta: nace así). `play()` es quien la vacía con
`resetToStart()` para animarla desde cero cuando la sección entra en pantalla.

**Trampa que este cambio introducía y que corregí en el mismo commit**: al
arrancar `messages` con el thread completo, `animated = !reducedMotion` (la
condición vieja) hubiera aplicado `landing-msg-in` a los 7 `<ChatBubble>` ya
presentes en el HTML servido — exactamente el hallazgo 1 de esta misma
review, pero en mi propio archivo. Agregué `hasPlayed` (arranca en `false`,
lo sube solo `play()`) y cambié la condición a `animated = hasPlayed &&
!reducedMotion`, igual que `hero-flow.tsx`. Verificado con `curl` sobre el
HTML servido del dev server: `landing-msg-in` y `landing-typing` aparecen 0
veces; el carril de WhatsApp muestra las 7 líneas completas y "Ver de nuevo"
como control inicial (estado final, coherente con el resto del PR).

Verificación: `npx tsc --noEmit -p .` limpio, `npx eslint
src/views/landing/versus-race.tsx` limpio. No pude reproducir la escena en
Chrome en esta sesión — la extensión denegó permiso sobre `localhost`
(`Permission denied for this action on this domain`) sin que hubiera forma de
otorgarlo desde el agente; recomiendo a quien retome confirmar visualmente
que la carrera sigue reproduciéndose al entrar en pantalla y que
`prefers-reduced-motion` (emulado con Playwright, como ya pedía
`03-review.md` para este mismo archivo) muestra la escena completa sin
autoplay ni botón de control.
