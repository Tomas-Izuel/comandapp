# Slice D — Las pruebas

Agente: `frontend-react-craftsman`. Archivos propios: `src/views/landing/edge.tsx`,
`src/views/landing/eta-demo.tsx` (nuevo), `src/views/landing/events-demo.tsx` (nuevo),
`src/views/landing/delivery.tsx`, `src/views/landing/delivery-quote.tsx` (nuevo),
`src/views/landing/included.tsx`.

## Qué se implementó

### `WhatOnlyComandApp` (`edge.tsx`, `id="diferencias"`)

Los dos párrafos con ícono de la ronda anterior se reemplazaron por dos pruebas
interactivas, compuestas dentro del mismo layout de dos columnas con divisor de
1px que ya existía.

- **`EtaDemo`** (`eta-demo.tsx`, cliente): `<input type="range">` nativo
  (0–`ETA_DEMO.maxActiveOrders`, paso 1, valor inicial 2), con `aria-valuetext`
  ("N pedidos activos"). Muestra los dos ítems (`Bacon Bomb 15 min`,
  `Papas Cheddar 8 min`) con el más lento resaltado y la frase "se entrega
  junto: manda el más lento"; una marca visual en el umbral
  (`ETA_DEMO.thresholdOrders = 5`); si el multiplicador está aplicado o no,
  **en texto**, no solo color; y el ETA resultante en grande (`display tabular`,
  remontado con `key={eta}` + `.landing-num-in`). Al lado, fijo:
  "Hoy por WhatsApp: 20 minutos, siempre". Cálculo 100% con `etaMinutesFor()`
  del contrato — cero aritmética propia. Sin autoplay ni `IntersectionObserver`:
  es una calculadora, no una escena; por eso tampoco lleva `DEMO_SCENE_CAPTION`
  (esa marca es para reconstrucciones de la línea de tiempo real del pedido,
  no para un cálculo interactivo hipotético).
- **`EventsDemo`** (`events-demo.tsx`, cliente): el log de `DEMO_EVENTS` (5
  filas) apareciendo fila por fila a `--dur-beat` (700ms, duplicado como
  constante `BEAT_MS` — incluye el motivo en el comentario) al entrar en
  pantalla (`IntersectionObserver`, umbral 0.4, una sola vez). Cada fila: hora
  `tabular`, evento en `font-mono text-xs`, detalle en texto normal; a la
  derecha un indicador "→ tu sistema" cuyo círculo se rellena con un tilde un
  beat después de que la fila aparece (no la fila entera: el indicador está
  desde que la fila existe, sólo el tilde se demora, tal como pide el brief).
  Botón "Ver de nuevo" (`h-11`, ≥44px). `DEMO_SCENE_CAPTION` visible.

### `DeliverySection` (`delivery.tsx`, `id="delivery"`)

La captura del repartidor se sacó (la mueve Slice C al recorrido). Queda:

- **`DeliveryQuote`** (`delivery-quote.tsx`, cliente): range para el subtotal
  (`DELIVERY_DEMO_SUBTOTAL`: 0–$30.000, paso $500, inicial $16.700 — el mismo
  subtotal del #A2A1) y un segmentado `role="radiogroup"` de dos botones
  ("Hay un repartidor libre" / "Están todos en la calle", roving `tabIndex` +
  flechas ←/→, ambos ≥44px). Todo el resultado sale de
  `buildDeliveryQuote({ delivery: DELIVERY_DEMO, subtotalCents, availability,
  currency: 'ARS' })` — la MISMA función de `src/lib/delivery.ts` que cobra en
  el checkout real. Los montos van `tabular`, remontados con `key` +
  `.landing-num-in`.
- Los cinco hechos del delivery, ahora como `<dl>` densa (término en negrita +
  una línea), sin íconos en círculo — se sacó el `Bike/Banknote/Gift/...` de
  la ronda anterior porque ese ícono+título+texto es exactamente el esqueleto
  que el piso de calidad prohíbe.

### `WhatsIncluded` (`included.tsx`, `id="incluido"`)

Los mismos 16 ítems, texto idéntico, reagrupados en 4 columnas
("Para tu cliente"×9, "Para el mostrador"×2, "Para vos"×3, "Para tu marca"×2)
con subtítulo `display` + lista con separador de 1px. Se sacaron los tildes
(`Check` de lucide) de la versión anterior: ahora es lista pura, no checklist.
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` tal como pide el brief.

## Decisiones y trade-offs

- **`<input type="range">` nativo, no el `Slider` de Radix** que ya existe en
  `src/components/ui/slider.tsx` (usado en `branding-form.tsx`): lo pide el
  contrato de la tarea explícitamente. Estilizado a mano con selectores
  `[&::-webkit-slider-thumb]`/`[&::-moz-range-thumb]` sobre los tokens (track
  `bg-muted` 6px, thumb `bg-primary` 24px). El foco NO se re-implementa: ya lo
  resuelve la regla global de `globals.css`
  (`:where(...,input,...):focus-visible { outline: 2px solid var(--ring) }`),
  que envuelve la caja entera del `<input>` (44px de alto), no solo el thumb.
  El área táctil real es esa caja de 44px (`h-11`), no el track dibujado de
  6px — verificado que el navegador arrastra el thumb clickeando en cualquier
  punto vertical de esa caja, no solo sobre la línea visual.
- **La clase de estilos del range está duplicada** entre `eta-demo.tsx` y
  `delivery-quote.tsx` a propósito: son dos islas cliente independientes y la
  alternativa (una primitiva nueva en `views/shared/surfaces.tsx`) está fuera
  del alcance declarado de este slice — lo dejo como follow-up más abajo.
- **`react-hooks/set-state-in-effect`** (regla nueva del plugin de React
  Hooks) bloqueó el diseño inicial de `EventsDemo`, que leía
  `prefers-reduced-motion` con `useState` + `setState` dentro de un efecto.
  Se resolvió en dos pasos: (1) `reducedMotion` pasó a `useSyncExternalStore`
  (la forma que React recomienda para sincronizarse con un sistema externo
  como `matchMedia`, sin la carrera de dos efectos separados que discutí y
  descarté en el camino: leer la preferencia y vaciar el log en el MISMO
  efecto podía vaciar el log de alguien que sí pidió reducir movimiento, por
  el orden de ejecución de efectos en el primer render); (2) el log ya NO se
  "vacía" en un efecto — nunca hace falta: arranca completo (`revealedRows =
  TOTAL`) y solo se resetea a 0 **dentro de `play()`**, que el
  `IntersectionObserver` llama desde su propio callback (o el botón "Ver de
  nuevo" desde `onClick`). Con `reducedMotion === true`, el efecto del
  observer nunca deja que `play()` se llame, así que el log queda completo
  para siempre sin una rama de código aparte.
- **Estrategia "sin JS" para `EventsDemo`, documentada en el propio archivo**:
  el HTML servido (y el primer render del cliente, antes de cualquier efecto)
  siempre muestra las 5 filas y los 5 tildes — nada depende de JS para verse.
  La escena solo "vacía" el log en el momento exacto en que
  `IntersectionObserver` confirma que la sección entró en pantalla (no antes,
  al montar): así no hay una ventana en la que el contenido ya visible
  parpadee a vacío para nadie que esté mirando la sección en ese momento —
  el vaciado y la reconstrucción son un solo gesto continuo, no dos.
- **Discrepancia con la verificación a mano pedida en el prompt**: el prompt
  original pide comprobar "subtotal $16.700 → envío $1.800". Con
  `DELIVERY_DEMO.freeFromCents = 1.500.000` ($15.000) y
  `buildDeliveryQuote()` real (`src/lib/delivery.ts`), un subtotal de $16.700
  **supera** el umbral de envío gratis, así que el resultado correcto —y el
  que efectivamente muestra el cotizador, verificado en el browser— es
  **"Envío gratis"**, no $1.800. Los otros dos valores sí cierran exacto:
  $4.000 → "Para pedir con envío el mínimo es $5.000. Te faltan $1.000."; y
  $10.000 (elegido para mostrar el costo plano real) → envío $1.800, "Te
  faltan $5.000 para el envío gratis". Prioricé la función real (única fuente
  de verdad del dinero, CLAUDE.md) sobre el número del prompt; lo dejo
  anotado para que quien revise no lo lea como un bug mío.
- **`slider.tsx` (Radix) no se tocó ni se reemplazó**: sigue siendo la
  primitiva correcta para `/admin`. Este slice no la usa por directiva
  explícita del brief, no porque esté mal.

## Verificado a mano

- **Desktop (1440px)**, vía Chrome MCP:
  - `EtaDemo`: arrastré el slider con teclado (click + flechas) de 2 a 6
    pedidos → "Multiplicador de demanda aplicado: ×1.5" y ETA 15→23 min
    (`scaleUpInt(15, 1.5) = 23`, coincide con `create_order`). El thumb mide
    24px visualmente (zoom verificado) y el foco por teclado muestra el
    anillo del sistema alrededor de toda la fila del control.
  - `EventsDemo`: forcé `document.visibilityState`/`hasFocus()` a `visible`
    con un shim de test (el propio entorno de verificación mantiene todas las
    pestañas en `hidden`/sin foco — confirmado con `document.hasFocus()` en
    dos pestañas distintas, así que **mi lógica de pausa-en-oculto es
    correcta**: fue ella la que detuvo el timer en el primer intento). Con
    visibilidad forzada, la escena corrió las 5 filas con sus tildes a
    cadencia de 700ms y el botón "Ver de nuevo" la repite.
  - `DeliveryQuote`: subtotal $4.000 → "Te faltan $1.000"; $10.000 → envío
    $1.800 y "Te faltan $5.000 para el envío gratis"; $16.700 (inicial) →
    "Envío gratis" (ver discrepancia arriba); toggle a "Están todos en la
    calle" → minutos 25→40 y aparece la nota de flota ocupada.
  - `WhatsIncluded`: cuatro columnas visibles lado a lado, subtítulos
    `display`, separadores de 1px, sin tildes ni tarjetas.
  - Árbol de accesibilidad (`read_page filter=interactive`) confirma nombres
    accesibles correctos: `textbox "Pedidos activos en la cocina" type=range`,
    `textbox "Tu pedido" type=range`, `radio "Hay un repartidor libre"`,
    `radio "Están todos en la calle"`, `button "Ver de nuevo"`.
- **Mobile**: el entorno de verificación de este sandbox **no puede
  redimensionar la ventana real del browser** (queda fija en ~1440px; ya lo
  había documentado el scratch de Slice C, `scratch-slice-c-test/page.tsx`,
  y lo confirmé de nuevo — `resize_window` no cambia `window.innerWidth`, y
  `window.open` con tamaño propio queda bloqueado como popup). A diferencia
  de Slice C, mis componentes no tienen árboles Desktop/Mobile separados en
  JS — son CSS puro (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, etc.), así
  que el truco de "contenedor de 390px + ocultar con JS" de esa scratch page
  no aplica (una media query mira el viewport real, no el contenedor). No
  pude ejercer el layout mobile en vivo; confié en los mismos breakpoints
  Tailwind (`sm:`/`lg:`) ya usados sin problemas en el resto de esta carta
  (`included.tsx` de la ronda anterior tenía exactamente
  `sm:columns-2 lg:columns-3`) y en que ninguno de mis tres componentes tiene
  lógica condicionada a `window.innerWidth` — toda la responsividad es CSS,
  así que el riesgo de un bug oculto solo en mobile es bajo. Dejo esto
  anotado para que el reviewer o el test-engineer lo mire con un viewport
  real si tienen uno disponible.
- `npx tsc --noEmit -p .` — 0 errores en todo el repo.
- `npx eslint` sobre los 6 archivos — 0 errores, 0 warnings.
- `npx vitest run` (suite completa) — 996 passed, 314 skipped (sin Docker),
  **1 failed**: `tests/lib/landing-source-scan.test.ts` → "split-text.tsx es
  el ÚNICO archivo... con 'use client'". Es exactamente lo que
  `01-tasks.md` anticipa ("el test... pasa de allowlist de un archivo a esta
  lista, y sigue fallando ante cualquier archivo no declarado"): con los 5
  slices en paralelo agregando sus propias islas cliente
  (`delivery-quote.tsx`, `eta-demo.tsx`, `events-demo.tsx`, más las de B/C/E:
  `hero-ticket.tsx`, `landing-bar-progress.tsx`, `order-journey.tsx`,
  `pricing-calculator.tsx`, `versus-race.tsx`), la allowlist vieja (un solo
  archivo) queda obsoleta. Es responsabilidad del `test-engineer` actualizarla
  a la lista completa del brief — no toqué `tests/**`.

## Qué quedó afuera / follow-ups

- La duplicación de `RANGE_INPUT_CLASS` entre `eta-demo.tsx` y
  `delivery-quote.tsx`: si en algún momento la landing necesita un tercer
  slider, vale la pena promoverlo a `src/views/shared/surfaces.tsx` como
  primitiva nueva (documentado ahí, no acá, cuando corresponda).
- No agregué ningún primitivo nuevo a `views/shared/surfaces.tsx` — todo se
  compuso con lo existente (`SectionHeading`) más HTML semántico propio
  (`<dl>`, `<ol>`, `role="radiogroup"`).
- El layout mobile de las tres secciones no se pudo ejercer en vivo (ver
  arriba); sí revisé el código fuente de las clases responsivas a mano.

## Correcciones

Ronda de correcciones sobre `03-review.md` (bloqueante 1) y `03-tests.md`
(hallazgo no bloqueante sobre `landing-num-in`). Archivos tocados:
`eta-demo.tsx`, `delivery-quote.tsx`, `included.tsx`.

- **Bloqueante 1 — `landing-num-in` viajaba en el HTML servido.** En
  `eta-demo.tsx` y `delivery-quote.tsx` la clase se aplicaba sin ningún gate,
  así que el ETA, el subtotal y los tres resultados de la cotización de envío
  "entraban" animados apenas cargaba la página, sin que nadie tocara el
  slider ni el radiogroup — exactamente el bug que `hero-flow.tsx` ya evitaba
  con `hasPlayed`/`animated`. Agregué un flag `hasChanged` (arranca en
  `false`, igual que `hasPlayed`) que sube a `true` **solo** dentro del
  `onChange` real del slider (`eta-demo.tsx`) o de los dos disparadores reales
  del cambio — slider y `selectAvailability` — en `delivery-quote.tsx`, nunca
  en un efecto. `animated = hasChanged && !reducedMotion`, y tanto la clase
  `landing-num-in` como el `key` que fuerza el remount para replayar la
  animación quedan condicionados a `animated`: antes de la primera
  interacción el `key` es un string estático (`'eta-static'`,
  `'subtotal-static'`, etc.), así que no hay remount ni animación posibles
  aunque el valor cambiara por otra vía.
  - Sumé la lectura de `prefers-reduced-motion` con `useSyncExternalStore`
    (duplicada en los dos archivos, mismo criterio que `events-demo.tsx` y
    que otras constantes trilicadas del repo) — antes ninguno de los dos
    componentes la leía, así que con reduced motion activado igual iban a
    animar. Ahora nunca lo hacen.
  - Verificado: `curl -s http://localhost:3000/ | grep -o "landing-num-in" | wc -l` → `0`.
- **`aria-live` en los resultados.** `EtaDemo` (ETA + línea de multiplicador)
  y `DeliveryQuote` (envío + mínimo faltante + minutos) cambian de valor lejos
  del control que los dispara y no se anunciaban a un lector de pantalla. Cada
  demo ahora envuelve su bloque de resultado completo en **una** región
  `aria-live="polite" aria-atomic="true"` (una por demo, no una por número,
  para que los valores relacionados se anuncien como una sola unidad).
- **`WhatsIncluded`: desbalance de columnas (hallazgo mayor 5).** "Para tu
  cliente" trae 9 ítems contra 2/3/2 de las otras tres columnas, así que en
  `lg:` tres de las cuatro quedaban con más de la mitad del alto vacío. Cambié
  la grilla de `lg:grid-cols-4` a `lg:grid-cols-[2fr_1fr_1fr_1fr]` y el primer
  grupo pasa a fluir en `lg:columns-2` dentro de su propio ancho (con
  `lg:break-inside-avoid` en cada `<li>` para que ningún ítem se parta entre
  columnas). El texto de los 16 ítems y su agrupación por quién los usa no
  cambiaron.
- Verificación: `npx tsc --noEmit -p .` limpio; `npx eslint` sobre los tres
  archivos limpio; el `curl` de arriba en `0`; revisión visual del layout no
  se pudo completar en Chrome vía MCP en este entorno (el tab del navegador
  automatizado no obtuvo permiso sobre `localhost` — mismo tipo de limitación
  de entorno que reportaron slices anteriores), así que la corrección de
  `WhatsIncluded` se verificó por código y por el HTML servido (`grid-cols-`,
  `columns-2` y `break-inside-avoid` presentes en las clases renderizadas),
  no con una captura real a 1440px.
