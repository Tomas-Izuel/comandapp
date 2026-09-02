# Slice F (ronda 3) — "el hero es la demo"

Reemplazo completo del hero de `/`. El dueño del producto lo marcó como "por
lejos la peor parte": el titular con GSAP `mask: 'lines'` quedaba recortado a
una línea, las tres tarjetas del ticket no llegaban a aparecer, y la columna
derecha era una captura recortada del celular que no explicaba nada. Se
reemplazó entero por una escena del flujo completo del pedido.

## Qué se hizo

- **`src/views/landing/hero-flow.tsx` (nuevo, `'use client'`)**: `HeroFlow`,
  la escena "el pedido #A2A1 en diez segundos". Un solo tablero (`Panel`) que
  dibuja con las primitivas del sistema los cuatro pasos de `HERO_FLOW` (pide
  → paga → cocina → listo), sin una sola captura de pantalla:
  - **Pide**: fila de producto como la vitrina real — `PhotoFrame` con
    `fallbackLabel="Bacon Bomb"` (mismo comportamiento que un producto sin
    foto en el catálogo real), precio `tabular`, botón `+`
    (`iconButtonClass('primary')`) que simula una pulsación (`scale-90`
    transitorio).
  - **Paga**: la barra del carrito ("2 ítems · $ 16.700") entra un instante
    después, pasa de un botón "Pagar" a `StatusPill tone="live" dot` "Pagado
    21:20", y aparece la línea "→ a la cuenta de Mercado Pago del local" en
    `text-(--brand-ink)`.
  - **Cocina**: tarjeta del panel de cocina (`#A2A1`, ítems, `StatusPill`)
    que pasa de "Confirmado" a "En preparación" 800ms después de entrar
    (transición de color, `--dur-slow` + `--ease-out-expo`), con un botón
    "Marcar listo" que se "toca" cerca del final del paso.
  - **Listo**: burbuja de aviso "Tu pedido #A2A1 está listo para retirar"
    (paleta ComandApp, nunca verde WhatsApp) + `StatusPill` "Listo 21:41" +
    cierre "Nadie del local escribió un mensaje." en `text-(--brand-ink)`.
  - Arriba del tablero: una fila de `StepMark` (done/current/todo) con la
    hora de cada paso, que funciona a la vez de mapa del flujo y de indicador
    de progreso. Debajo de esa fila, en una región `aria-live="polite"` fija,
    el título y la frase del paso actual (`key={step.id}` + `.landing-num-in`
    para el crossfade).
- **`src/views/landing/hero.tsx`**: `<h1>` pasa a texto plano y ESTÁTICO (sin
  `SplitHeading`, sin GSAP). La columna derecha renderiza `<HeroFlow />` en
  vez del celular recortado + tarjetas flotantes. Grid `lg:grid-cols-[1fr_25rem]
  xl:grid-cols-[1fr_27rem]` (antes `24rem`/`26rem`): la escena necesita algo
  más de ancho que el celular angosto que reemplaza. La franja de los dos
  hechos ("Cobrás con tu propia cuenta…", "No competimos con Rappi…") se dejó
  intacta.
- **Borrados**: `src/views/landing/split-text.tsx` y
  `src/views/landing/hero-ticket.tsx`. Verificado con
  `grep -rn "split-text\|hero-ticket\|SplitHeading\|gsap" src/` → cero
  resultados antes de cerrar. No toqué `package.json`: `gsap` y `@gsap/react`
  quedan sin uso, a desinstalar por el hilo principal.

## Decisiones y trade-offs

- **SSR = estado final, nunca vacío.** Mismo patrón que `events-demo.tsx`
  (Slice D): todo el estado por defecto de React (`stepIndex`, `cartRevealed`,
  `cocinaAdvanced`, etc.) arranca en su valor FINAL, así que el HTML servido
  ya muestra el tablero completo con los cuatro pasos cumplidos y la frase de
  cierre. `play()` vacía el tablero (`stepIndex = 0`, fragmentos no revelados
  vía la clase `invisible` que reserva el espacio, sin achicar el panel) y lo
  vuelve a llenar. `play()` solo se llama desde un callback asincrónico (el
  `IntersectionObserver`, el botón) — nunca de forma síncrona en el cuerpo de
  un efecto, para no disparar `react-hooks/set-state-in-effect`.
- **`hasPlayed` gatea TODAS las clases `landing-*-in`.** Arranca en `false` y
  solo pasa a `true` dentro de `play()`. Es lo que garantiza la regla de
  `00-architecture.md`: "un elemento presente en el HTML servido nunca lleva
  esas clases" — en el primer paint (SSR o hidratación antes de jugar la
  escena) ningún nodo lleva clase de animación, aunque el tablero ya esté
  completo.
- **El reloj de la escena reusa el mecanismo de `versus-race.tsx`** (Slice B):
  un `requestAnimationFrame` que acumula tiempo transcurrido en un ref
  (`elapsedAtPauseRef`), así que pausar/reanudar —a mano, por pestaña oculta
  o porque la escena salió del viewport— retoma exactamente donde quedó. Un
  `autoPausedRef` distingue una pausa del sistema (que se reanuda sola cuando
  vuelven las condiciones) de una pausa manual del usuario (que solo se
  reanuda con "Seguir").
- **Arranca al entrar en pantalla, no al montar.** A diferencia de
  `SplitHeading` (donde "montar" y "entrar en pantalla" eran lo mismo porque
  el hero siempre estaba en el primer viewport), acá en mobile la escena
  queda DEBAJO del bloque de texto, así que un `IntersectionObserver`
  (umbral 0.3) dispara el primer `play()` y además pausa/retoma la escena
  cuando sale y vuelve a entrar al viewport — un solo observer para las dos
  cosas.
- **Sin la OrderSteps completa para el fragmento "cliente".** El brief
  ofrecía elegir entre `OrderSteps` compacto o una línea de ETA; se optó por
  la burbuja de aviso + `StatusPill` (sin `OrderSteps`) para mantener la
  altura del tablero dentro de lo razonable — la vertical de `OrderSteps`
  (cuatro pasos con línea conectora) sumaba varios rem que no entraban junto
  con los otros tres fragmentos.
- **Sin el hilo SVG explícito.** El brief lo marcaba como opcional
  ("recomendado, no obligatorio"). Se omitió a favor de separadores simples
  (`border-t`) entre fragmentos dentro del tablero: la fila de `StepMark` de
  arriba ya cumple el rol de "mapa del flujo e indicador de progreso", y un
  segundo hilo conectando los fragmentos del tablero hubiera sido una
  segunda lectura de progreso compitiendo con la primera.
- **"2 ítems", no "1 ítem".** El brief sugería el texto "1 ítem · $ 16.700 ·
  Pagar" a modo de ejemplo, pero `DEMO_ORDER.items` tiene dos líneas (Bacon
  Bomb + Papas Cheddar); se corrigió a `DEMO_ORDER.items.length` ítems para
  no afirmar un número que el propio contrato contradice.
- **`Doble medallón, cheddar y panceta`** es la única línea de texto que no
  sale de `src/lib/landing.ts` (el contrato no lleva descripciones de
  producto). Es flavor text de una fila de producto dibujada dentro de una
  escena marcada `DEMO_SCENE_CAPTION` — no es una afirmación de producto, es
  decoración de la demo.

## Contratos consumidos

`HERO_FLOW`, `HERO_FLOW_DURATION_MS`, `DEMO_ORDER`, `DEMO_SCENE_CAPTION` de
`src/lib/landing.ts` (sin editarlo). `Panel`, `PhotoFrame`, `StatusPill`,
`StepMark`, `iconButtonClass` de `src/views/shared/surfaces.tsx` (sin
editarlo). Clases `.landing-msg-in` / `.landing-num-in` y `--dur-beat` de
`globals.css` (sin editarlo, y `--dur-beat` no se usó porque la cadencia de
esta escena está guionada con constantes propias en ms, no con la cadencia
"evento por evento" que sí usan `versus-race`/`events-demo`).

## Comportamiento visible / a11y (spec para el test engineer)

- La escena arranca sola una vez que entra en el viewport (no antes) y
  recorre los cuatro pasos de `HERO_FLOW` en `HERO_FLOW_DURATION_MS` (10s:
  2,5s por paso), terminando en el estado final (los cuatro `StepMark` en
  "done"/"current" final, tablero completo, "Nadie del local escribió un
  mensaje." visible).
- Botón único de control, `h-11` (44px): mientras reproduce dice "Pausar"
  (ícono `Pause`) y pausa al tocarlo; en pausa dice "Seguir" (`Play`) y
  reanuda; en reposo (antes de arrancar o al terminar) dice "Ver de nuevo"
  (`RotateCcw`) y reinicia la escena desde el paso 1. No se muestra con
  `prefers-reduced-motion`.
- Con `prefers-reduced-motion: reduce`: la escena nunca se reinicia (no hay
  `IntersectionObserver` activo), se sirve y se mantiene siempre en su
  estado final completo, sin timers y sin botón.
- Pausa automática (sin botón) cuando `document.hidden` es verdadero o
  cuando la escena sale del viewport; se reanuda sola cuando vuelven ambas
  condiciones, salvo que el usuario la haya pausado a mano (ahí espera el
  click en "Seguir").
- El título y la frase del paso actual viven en una única región
  `aria-live="polite"`; el tablero entero es `aria-hidden` (repite en dibujo
  lo que la región accesible ya dice en texto). Ningún elemento decorativo
  del tablero es un `<button>` real —son `<span>` con estilo de botón—, así
  que no quedan controles fantasma dentro de un contenedor `aria-hidden`.
- El `<h1>` del hero es texto plano desde el primer byte del HTML: no hay
  ninguna dependencia de JS para que se vea, y ninguna clase lo oculta.
- Verificado con `curl -s http://localhost:3000/ | grep -o '<h1[^>]*>[^<]*'`
  → titular completo. `grep -c "Bacon Bomb"`, `"está listo para retirar"`,
  `"Nadie del local escribió un mensaje"` → 1 cada uno (la escena completa
  está en el HTML servido). El check sugerido en el brief
  (`grep -c "El cliente pide"` ≥ 1) también pasa, aunque por una coincidencia:
  esa frase también aparece en una respuesta del FAQ — la comprobación real
  usada acá fue el contenido propio de `HeroFlow` (arriba).

## Verificación hecha

- `grep -rn "split-text\|hero-ticket\|SplitHeading\|gsap" src/` → cero
  resultados.
- `npx tsc --noEmit -p .` limpio.
- `npx eslint src/views/landing/hero.tsx src/views/landing/hero-flow.tsx` →
  limpio.
- El hook de `impeccable` (post-edit) no reportó hallazgos en
  `hero-flow.tsx`.
- Visual en Chrome a 1440px: la escena arranca sola al cargar, "El cliente
  pide" → producto + botón `+` con press simulado → cart bar entra → "Paga"
  con `StatusPill` "Pagado" y la línea de Mercado Pago → "Cocina" con la
  tarjeta `#A2A1` avanzando de "Confirmado" a "En preparación" y el botón
  "Marcar listo" → "Listo" con la burbuja de aviso y el cierre. "Ver de
  nuevo" reinicia correctamente desde el paso 1; "Pausar" congela la escena
  (verificado que el botón cambia a "Seguir" y el contenido no avanza
  mientras está pausado). Ninguna columna quedó con media pantalla vacía: el
  bloque de texto llega a ~460px de alto, la escena a ~510px — comparable, no
  "media pantalla de aire".
- **Mobile (390px): no se pudo verificar visualmente.** La herramienta
  `resize_window` del MCP de Chrome no logró achicar la ventana real por
  debajo de ~1568px de ancho en este entorno (confirmado repitiendo el
  intento a 390, 500 y 800px: las tres veces el screenshot resultante quedó
  fijo en 1568×764 y mostró el layout de escritorio) — parece una ventana de
  SO que no puede reducirse en esta sesión. Se hizo en su lugar una auditoría
  por código de los breakpoints: `hero.tsx` usa `grid` sin columnas
  explícitas por debajo de `lg:`, así que apila texto y `HeroFlow` a una sola
  columna de ancho completo por default (correcto: "en mobile va debajo del
  texto, a todo el ancho"). Dentro de `HeroFlow`, ningún elemento tiene un
  ancho fijo que no sea `shrink-0` sobre un total que quepa en ~326px de
  contenido (390 − 32px de padding de página − 32px de padding del panel):
  la fila de producto tiene ~188px de elementos fijos (thumbnail 48px +
  precio + botón 44px) dejando margen para el nombre/descripción con
  `min-w-0 flex-1 truncate`; las filas de carrito, cocina y cliente usan
  `flex-wrap`, así que en el peor caso envuelven a dos líneas en vez de
  desbordar horizontalmente. Recomiendo que quien tenga un dispositivo o un
  entorno con resize funcional confirme esto a ojo antes de dar la superficie
  por cerrada del todo.
- No se probó `web-design-guidelines` con un lector de pantalla real; la
  revisión fue por código (roles, `aria-live`, ausencia de controles
  fantasma dentro de `aria-hidden`, contraste heredado de `StatusPill`/tokens
  ya corregidos por `ensureContrast()`).

## Qué queda afuera / follow-ups

- El test `tests/lib/landing-source-scan.test.ts` referencia `split-text.tsx`
  en su allowlist y va a fallar hasta que `test-engineer` lo actualice para
  incluir `hero-flow.tsx` en su lugar. Es el resultado esperado de este
  slice, no un bug.
- `gsap` y `@gsap/react` quedan como dependencias sin uso en `package.json`;
  no las toqué (instrucción explícita) — a desinstalar desde el hilo
  principal.
- La verificación visual mobile queda pendiente de una corrida con viewport
  real (ver nota arriba); el análisis de código no reemplaza un vistazo real
  a 390px.
- No se agregó ningún primitivo nuevo a `src/views/shared/`: todo lo que
  necesitaba `HeroFlow` (`Panel`, `PhotoFrame`, `StatusPill`, `StepMark`,
  `iconButtonClass`) ya existía.

## Correcciones (ronda de fixes tras 03-tests.md / 03-review.md)

Dos hallazgos, ambos en `hero-flow.tsx`. `hero.tsx` no cambió — no tenía
hallazgos propios.

### 1. Bloqueante de `03-tests.md`: el flujo no se leía en el HTML servido

**Causa exacta** (confirmada por el test que agregó test-engineer,
`tests/lib/landing-render.test.ts`): el `<ol aria-hidden>` del mapa de pasos
solo dibujaba la hora (`flowStep.at`) de cada paso, nunca su título ni su
rótulo. La única región con texto legible del paso (`aria-live`, el título +
la frase) muestra siempre `HERO_FLOW[stepIndex].title`, y `stepIndex` arranca
en `LAST_STEP` (estado final, a propósito, para que el tablero se sirva
completo) — así que en el HTML servido solo aparecía el título del ÚLTIMO
paso, nunca los otros tres.

**Fix** (según instrucción explícita del orquestador, que reemplaza la
sugerencia original del test-engineer de repetir los 4 `title`): el `<ol>`
dejó de ser `aria-hidden` y ahora muestra, bajo cada `StepMark`, el rótulo
`short` de `HERO_FLOW` (`'Pide' | 'Paga' | 'Cocina' | 'Listo'`, campo que el
hilo principal agregó a `HeroFlowStep`/`landing.ts` para esta ronda) —
siempre visible, no depende de `stepIndex` ni de `hasPlayed`, así que el HTML
servido trae los cuatro sin JS. `text-xs font-medium`, el paso activo en
`text-foreground` y el resto en `text-muted-foreground`; la hora sigue debajo
en `tabular text-[11px]`. El `<li>` del paso activo lleva
`aria-current="step"`. La región `aria-live` con el título/frase del paso
activo NO se tocó (instrucción explícita: "eso está bien") — sigue mostrando
un solo título, el del estado que corresponda (final en SSR/reduced-motion,
el del paso en curso mientras la escena anima).

**Resultado verificado**: `curl -s http://localhost:3000/ | grep -oE
'>Pide<|>Paga<|>Cocina<|>Listo<' | wc -l` → 6 (los 4 rótulos del mapa más dos
apariciones incidentales de "Listo" en otro texto de la misma escena —
`StatusPill` "Listo 21:41" y la etiqueta de estado "Listo" de cocina — nunca
menos de las 4 requeridas). `aria-current="step"` → 1 aparición (el paso
activo en el estado SSR, que es el último).

**Nota para quien retome `tests/lib/landing-render.test.ts`**: el test que
dejó test-engineer (`describe('el hero cuenta el flujo entero sin JS...')`)
todavía assertea los 4 `title` completos en el HTML — con este fix esa
aserción exacta sigue fallando a propósito, porque el criterio de esta ronda
cambió (4 `short` + al menos 1 `title`, no los 4 `title`). Se lo señalo al
orquestador para que test-engineer actualice esa aserción; no toqué
`tests/**` yo mismo (fuera de mi alcance).

### 2. Menor de `03-review.md` (hallazgo 4): miniatura sin foto ilegible

`PhotoFrame` con `fallbackLabel="Bacon Bomb"` en una caja `size-12` (48px)
partía el nombre en dos líneas casi ilegibles ("Bac"/"Bom"). Se agrandó la
miniatura a `h-16 w-16` (64px) manteniendo el `fallbackLabel` por defecto de
`PhotoFrame` (sin tocar la primitiva ni inventar un estilo de texto propio):
es exactamente la medida que ya usa `src/views/storefront/cart-view.tsx` para
el mismo caso real (miniatura sin foto en una fila angosta), así que el hero
queda consistente con cómo se ve el catálogo real cuando falta una foto, en
vez de una solución puntual. Verificado con `curl` que "Bacon Bomb" sigue
apareciendo en el HTML (ahora envuelto en dos líneas legibles dentro de la
caja de 64px en vez de recortado).

### Verificación de esta ronda

- `npx tsc --noEmit -p .` → limpio.
- `npx eslint src/views/landing/hero-flow.tsx src/views/landing/hero.tsx` →
  limpio.
- `curl -s http://localhost:3000/` (dev server ya corriendo, no se relanzó):
  4 rótulos `short` presentes (6 apariciones de las 4 palabras en total,
  incluyendo las 2 incidentales ya explicadas), `aria-current="step"` presente
  una vez, "Bacon Bomb" presente.
- Verificación visual en Chrome: **no se pudo completar**. El MCP de
  Chrome-in-the-browser denegó el permiso de screenshot/interacción sobre
  `localhost:3000` en este entorno (`Permission denied for this action on
  this domain`) y la pestaña volvió sola a `chrome://newtab/` tras el intento
  de navegar — no hay forma de otorgar el permiso desde esta sesión. Se cerró
  la pestaña. La verificación quedó apoyada en `curl` sobre el HTML servido
  (arriba) y en la lectura del código; recomiendo a quien tenga acceso a
  Chrome con permisos ya otorgados para este proyecto confirmar a ojo que (a)
  el mapa de pasos se lee con los cuatro rótulos y (b) la miniatura de 64px
  muestra "Bacon Bomb" en dos líneas legibles.
- No se tocó `hero.tsx`: no tenía hallazgos propios en esta ronda de
  correcciones.
