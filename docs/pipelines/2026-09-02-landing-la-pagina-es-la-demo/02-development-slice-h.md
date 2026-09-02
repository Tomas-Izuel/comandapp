# Slice H (ronda 4) — "el hero es un storyboard"

Pedido del dueño del producto: el hero se parecía demasiado a la sección
siguiente (`versus-race.tsx`, un tablero que acumula filas). Se reemplaza por
un storyboard de verdad: cinco cuadros —pide, paga, cocina, listo, reparto—
que entran por la derecha, se reproducen y salen por la izquierda, narrando el
pedido de DELIVERY `HERO_ORDER` (`#C64E`, $30.400) con un ticket que "viaja"
de cuadro en cuadro.

## Archivos tocados

- `src/views/landing/hero-flow.tsx` — reescrito por completo.
- `src/views/landing/hero.tsx` — sin cambios (ya renderizaba `<HeroFlow />`
  ocupando el ancho de la columna derecha; no hizo falta tocar el alto, la
  escena compone su propia altura vía la clase `h-44 sm:h-40` del escenario).
- `landing.ts`, `globals.css`, `layout.tsx`: no tocados, tal como pedía el
  brief (ya traían `HERO_ORDER`/`HERO_FLOW`/`HERO_FLOW_DURATION_MS` de una
  ronda anterior).

## Mecánica del storyboard

Los CINCO cuadros están siempre montados dentro del escenario (`position:
absolute inset-0`, mismo lugar), cada uno calcula `diff = índice - stepIndex`
y se posiciona con `transform: translate3d(diff * 40%, 0, 0)` + `opacity`
(100 en `diff===0`, 0 en cualquier otro valor), con `transition-[transform,opacity]
duration-(--dur-slow) ease-(--ease-out-expo)`. Como es una transición CSS
declarativa (no coreografiada a mano), un solo cambio de `stepIndex` hace que
el cuadro saliente se vaya a la izquierda (diff 0→-1) y el entrante llegue
desde la derecha (diff 1→0) en el mismo instante — es el storyboard pedido sin
tener que animar cada cuadro por separado.

El reloj es el mismo mecanismo de `versus-race.tsx` (rAF + tiempo acumulado en
un ref), con una lista de "beats" (`{ms, apply}`) ordenada que el `tick`
recorre con un `while`. Nuevo respecto de la ronda anterior: al hacer `play()`
se activa un `suppressTransition` de un frame (doble `requestAnimationFrame`)
para que el corte al cuadro 1 pinte sin transición — si no, los cinco cuadros
se ven reacomodarse de golpe en el instante del reset.

El **ticket** (`#C64E · $ 30.400` → `#C64E · Entregado 22:24` al final) es un
chip flotante (NO el componente `Panel`, para no incurrir en "Panel dentro de
Panel": es un div propio con el mismo tratamiento visual de superficie) que se
remonta con `key={stepIndex}` en cada cambio de cuadro para disparar de nuevo
`landing-msg-in` (clase ya existente, reutilizada — no se agregó ningún
keyframe global nuevo para esto) y así leerse como que "viaja" con el pedido.

## Estado sin JS / reduced-motion

Igual que el resto de las demos de esta landing: TODO el estado por defecto de
React (`stepIndex = LAST_STEP`, `scene = FINAL_STATE`) es el cuadro 5
completo — moto en la puerta, ticket "Entregado 22:24", frase de cierre. Quien
no corre JS, o tiene `prefers-reduced-motion`, ve la escena terminada, nunca
un escenario vacío o a medio armar. `play()` solo se llama desde el
`IntersectionObserver` o el botón, nunca desde el cuerpo de un efecto.
Verificado con `curl` contra el SSR: el HTML servido trae `data-arrived="true"`,
"Entregado 22:24", la dirección y la frase de cierre, y CERO instancias de
`landing-msg-in`/`landing-row-in` (esas clases solo las agrega el JS durante
la reproducción).

## Los cinco cuadros

1. **Pide** — fila de producto (miniatura `PhotoFrame` sin foto, nombre,
   descripción, precio, botón "+" `iconButtonClass('primary')`) + un cursor
   (`MousePointer2`, absoluto, `transform`/`opacity` desde `translate-x-6
   translate-y-9 opacity-0` hasta `translate-x-0 translate-y-0 opacity-100`,
   ~900ms) que llega al botón, lo "aprieta" (`scale-90` 120ms) y revela el
   resumen del pedido (`itemsLine`, subtotal + envío = total, todo derivado de
   `HERO_ORDER` con `formatCentsCompact`, nunca a mano).
2. **Paga** — hoja de pago en texto plano: "Mercado Pago" (SOLO texto, sin
   logo ni colores de la marca del tercero — cumple la restricción del
   brief), total, fila "Tarjeta / ···· 4242", botón "Pagar" que el cursor
   toca y se convierte en `StatusPill tone="live" dot` "Pagado 21:47" + "→ a
   la cuenta del local" en `text-(--brand-ink)`.
3. **Cocina** — SVG propio de una sartén (trazo `currentColor` 2px, sin
   relleno) con un medallón (`<ellipse className="hero-medallion">`,
   `transform-box: fill-box` para pivotar desde su propio centro) que hace
   `hero-pan-flip` (rotateX/scaleY, 1.2s × 2) y tres líneas de vapor
   (`.hero-steam`, keyframe propio, loop mientras el cuadro está activo)
   MONTADAS solo cuando `data-active="true"` — se desmontan al salir del
   cuadro, verificado por DOM (`querySelectorAll('.hero-steam').length`
   pasa de 3 a 0 en cuanto el cuadro deja de ser el activo). La tarjeta de
   cocina pasa de "Confirmado 21:47" a "En preparación 21:48" a los 800ms de
   entrar al cuadro.
4. **Listo** — `StatusPill tone="done"` "Listo 22:05" + burbuja del cliente
   en la paleta de ComandApp (`bg-primary/12`, NO verde WhatsApp): "Tu pedido
   #C64E está listo · sale a repartir."
5. **Reparto** — ruta esquemática (SVG, `stroke-dasharray`/`stroke-dashoffset`
   que se dibuja en ~1,8s) desde "Local" hasta un `MapPin`, con una moto
   (`Motorbike` de `lucide-react` — existe en la versión instalada, se
   verificó con `grep` antes de usarla, así que no hizo falta un SVG propio)
   que la recorre con `offset-path`/`offset-distance` (con `@supports` y
   fallback a `transform: translate3d` para navegadores sin soporte). Al
   llegar, el pin hace `.landing-blink` (clase ya existente, mismo patrón que
   `order-journey.tsx`: se envuelve en un `<span key={contador}>` solo cuando
   el contador sube de 0, para que el ciclo se reproduzca UNA vez y no en el
   HTML servido). Cierre: "Nadie del local escribió un solo mensaje." en
   `text-(--brand-ink)`, debajo de la región del título (fuera del escenario
   `aria-hidden`, así que SÍ es accesible).

## Bug encontrado y corregido durante la verificación visual

El SVG de la ruta escalaba a `w-full` (el viewBox se estira con el
contenedor), pero la moto vive FUERA del `<svg>` como un `<span>` posicionado
con `offset-path`/`transform` en **píxeles fijos** (`M14 46 C 66 10, 128 10,
182 46`, `translate3d(146px, -6px, 0)`) — esas coordenadas no heredan el
`viewBox`, así que en cualquier ancho de contenedor que no fuera exactamente
200px la moto y la ruta dibujada quedaban desalineadas (más notorio en
mobile, donde la columna es angosta, y en pantallas anchas, donde la ruta se
estira pero la moto se queda corta). Se corrigió envolviendo el SVG + la moto
+ el pin en una caja de tamaño **fijo** `w-[200px] h-[60px]` (1 unidad de
SVG = 1px de CSS) centrada con `mx-auto`, para que la ruta dibujada y el
recorrido de la moto compartan siempre el mismo sistema de coordenadas,
independiente del ancho real de la tarjeta. Verificado con
`getComputedStyle` (`width: "200px"`, `height: "60px"` sin importar el
viewport) y con el HTML servido (`grep -c 'h-\[60px\] w-\[200px\]'` → 1).

## Verificación

- `npx tsc --noEmit -p .` — limpio.
- `npx eslint src/views/landing/hero-flow.tsx src/views/landing/hero.tsx` — limpio.
- `curl -s http://localhost:3000/`:
  - `>Pide<`, `>Paga<`, `>Cocina<`, `>En camino<` → 1 cada uno (el mapa de
    pasos de esta escena; `>Listo<` aparece además en otras secciones de la
    página no tocadas por este slice — `order-journey`/`versus-race` — así
    que su conteo total no es 1, tal como anticipaba el brief).
  - `Entregado 22:24` → 1, `Av. San Martín 1240, Mendoza` → 1 (el HTML servido
    ya es el cuadro final completo).
  - `landing-msg-in`/`landing-row-in` → 0 (esas clases solo las agrega el JS
    durante la reproducción, nunca están en el HTML servido).
  - `Nadie del local escribió un solo mensaje.` → 1.
  - Caja fija de la ruta (`h-[60px] w-[200px]`) → 1.
- Visual en Chrome (127.0.0.1:3000, el `tabs_create_mcp` propio; `localhost`
  no resolvía la primera vez, tal como avisaba el brief): confirmé cada uno
  de los cinco cuadros por separado —contenido, textos, StatusPill, ticket—
  combinando capturas reales y lectura del DOM/`getComputedStyle` (necesario
  porque el sandbox de automatización mantiene la pestaña con
  `document.hidden === true` a nivel de compositor, lo que dispara mi propio
  guard de "pestaña oculta, pausar" — comportamiento CORRECTO del componente,
  no un bug, pero hace que esperar tiempo real de pared no alcance para ver
  avanzar la escena de forma predecible — verificado en cambio inyectando un shim de `requestAnimationFrame`
  vía `setTimeout` en la pestaña de prueba y leyendo `[data-active="true"]` y
  sus `getComputedStyle` directamente). Confirmé puntualmente: cursor
  llegando al "+", hoja de pago con "Pagado 21:47" y sin logo de terceros,
  sartén con 3 `.hero-steam` montados y `animationName: "hero-pan-flip"`
  mientras el cuadro está activo (y 0 steam cuando no lo está), "Listo 22:05"
  con la burbuja del cliente, ruta+moto+pin+dirección con
  `offsetDistance`/`@supports` funcionando, ticket final "Entregado 22:24".
  Replay ("Ver de nuevo") y pausa ("Pausar"/"Seguir") funcionan. No se pudo
  redimensionar la ventana real a 390px (`resize_window` no tuvo efecto en
  este entorno — `window.innerWidth` siguió en 1440 después de invocarlo), así
  que mobile se revisó por código: el hero (`hero.tsx`) ya cae a una sola
  columna a todo el ancho por debajo de `lg` (sin cambios de mi parte), el
  escenario usa `h-44` en mobile (más alto que en desktop, `sm:h-40`, porque
  hay más wrap de texto), y la caja de la ruta ahora es de tamaño fijo
  (200×60px) y centrada, así que no se estira de forma inconsistente en
  ningún ancho — ése era justamente el bug que encontré y corregí.

## Qué quedó afuera

- No pude capturar un screenshot "limpio" (sin blend de transición) de los
  cuadros "paga" y "cocina" en un solo intento por la combinación de
  duración de cuadro (~2,6s) y la latencia de ida y vuelta de las
  herramientas de automatización; los confirmé por lectura de DOM/estilos
  computados en su lugar (ver arriba), que es una verificación más estricta
  que un screenshot para estos casos.
- El `resize_window` a 390px no tuvo efecto observable en este entorno (la
  ventana quedó en 1440×785 según `window.innerWidth`); mobile quedó
  verificado por código, no por captura visual directa, tal como preveía el
  brief para ese escenario.
- No toqué `hero.tsx` más allá de leerlo: la altura de la columna ya la
  resuelve la propia escena (`HeroFlow` compone su alto), no hizo falta un
  ajuste externo.

## Contratos consumidos (sin editar)

`HERO_ORDER`, `HERO_FLOW`, `HERO_FLOW_DURATION_MS`, `DEMO_SCENE_CAPTION` de
`src/lib/landing.ts`; `Panel`, `PhotoFrame`, `StatusPill`, `StepMark`,
`iconButtonClass` de `src/views/shared/surfaces.tsx`; `formatCentsCompact` de
`src/lib/money.ts`; las clases `.landing-msg-in`/`.landing-blink` y el token
`--dur-beat`/`--ease-out-expo`/`--dur-slow` de `globals.css`. No agregué
ninguna primitiva nueva a `src/views/shared/` — todo lo nuevo (el
`transform`/`opacity` del carrusel de cuadros, los keyframes `hero-*` del pan
y la moto) es exclusivo de esta escena y vive en un `<style>` inline dentro
de `hero-flow.tsx`, tal como pedía el brief ("el hilo principal no va a
agregar más keyframes globales para esto").

## Ronda 5 — reescritura a mano del hilo principal (2026-09-02)

Pedido del dueño del producto, textual: *"the mouse at the beginning is not
moving, i would like the item have a photo, the steps doesnt feel natural or
cool animated"*. Se reescribió `hero-flow.tsx` entero desde el hilo principal
(a pedido explícito: "improve the animation with fable model").

Qué cambió:

- **Cursor visible**: nace en la esquina opuesta del escenario y recorre
  ~200px en 900ms; el clic es `scale(.82)` del cursor + onda `landing-blink`
  en el botón. Antes arrancaba a 24px con opacidad 0: invisible.
- **Foto real** en la fila de producto (`public/landing/demo-doble-cheddar.jpg`,
  Unsplash License, foto `1568901346375-23c9450c58cd`, 720×598, 73KB).
  Es un **placeholder** hasta que el local piloto entregue las suyas; va en el
  mismo `PhotoFrame` que la vitrina.
- **Cuadros con salida y entrada distintas**: saliente `translateX(-14%)
  scale(.96) blur(2px)`, entrante desde `+16%` con 120ms de retraso. Gestos
  internos: la hoja de pago sube desde abajo, la tarjeta de cocina entra por
  la derecha, el aviso al cliente baja desde arriba, el tilde de "Pagado" y
  "Listo" se dibuja (stroke).
- **Sartén** de 96–112px con medallón que se da vuelta y tres hilos de vapor
  (solo con `data-cooking` en el cuadro activo).
- **Moto movida por el reloj**: `getPointAtLength` sobre el `<path>` real, con
  rotación tangente acotada a ±18°; la ruta recorrida se pinta en verde con
  `pathLength=1` + `stroke-dashoffset`, en sincronía exacta. La moto vive
  DENTRO del SVG, así que escala con el `viewBox` sin desalinearse.
- **Reloj por deltas acotados** (`MAX_FRAME_DELTA_MS = 64`): si el navegador
  congela los frames sin `visibilitychange` (ventana ocluida, captura), la
  escena sigue donde estaba en vez de saltar al final. Hallazgo real de la
  verificación: con reloj de pared, la pestaña automatizada saltaba del
  cuadro 1 al 5 en un solo tick.
- `HERO_ORDER.addressLine` pasó a Mendoza (pedido del dueño). Las capturas
  reales (`pantalla-*.png`) siguen mostrando Neuquén: son imágenes y no se
  regeneraron.

Verificación: `tsc`, `eslint` limpios; HTML servido con los 5 `short`, la
foto, "Entregado 22:24" y la dirección; cero `landing-*-in` en SSR. Visual con
Playwright headless (`chromium_headless_shell-1228`, 18 frames a 800ms) a 1440
y 390: la escena corre completa, cada cuadro se lee, sin overflow tras
corregir la columna del grid (`minmax(0, 1fr)`) y la fila del resumen
(`flex-wrap`). El Chrome MCP de este entorno congela `requestAnimationFrame`
entre capturas, así que no sirve para verificar motion: usar Playwright.
