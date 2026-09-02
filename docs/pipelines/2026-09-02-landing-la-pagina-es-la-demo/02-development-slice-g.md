# Slice G (ronda 3) — Ajuste del recorrido: aire arriba + blink de paso

Feedback textual del dueño del producto: *"the 'El recorrido de un pedido' is
great, but add a little more spacing at the top because it almost
automatically goes to the second step, also animate like a blink when a new
step is reached."*

## Archivos tocados

- `src/views/landing/order-journey.tsx` — reescrito en las partes relevantes
  (todo el archivo, `screens.tsx` no necesitó cambios).
- `src/views/landing/screens.tsx` — sin cambios (revisado, el ajuste de aire
  se resolvió enteramente dentro de la isla cliente).

No toqué `globals.css` (uso `.landing-blink` tal cual la dejó el hilo
principal) ni ningún otro archivo fuera de mi lane.

## Causa raíz del salto casi inmediato a la segunda estación

Encontré DOS causas reales, no solo una, y ataqué las dos:

1. **Bug real en el observer de banda central (no solo el `rootMargin`).** La
   versión anterior leía `entries.filter(e => e.isIntersecting)` y de ahí
   elegía la "topmost" — pero el callback de `IntersectionObserver` entrega
   **solo los targets cuyo estado cambió** desde la última vuelta, no todos
   los que siguen intersectando. Resultado: apenas la segunda estación tocaba
   la banda central, era la **única** entrada de ese callback puntual y
   "ganaba" la comparación aunque la primera estación siguiera adentro de la
   banda (su entrada no venía porque no había cambiado de estado). Esa era la
   causa real del salto casi instantáneo.

   Arreglo: mantengo un `Set<number>` persistente (`inBandRef`) con los
   índices que están **ahora mismo** dentro de la banda, actualizado
   incrementalmente por cada `entry.isIntersecting` que llega (se agrega o se
   saca del set), y elijo `Math.min(...inBandRef.current)` — la estación más
   "arriba" de las que siguen realmente adentro. Con esto un objeto que sigue
   intersectando pero no generó una entrada nueva ya no se "pierde".

2. **Centinela de "intro" nuevo**: mientras el título de la sección todavía
   está en pantalla, la primera estación se sostiene sin importar qué diga la
   banda. Implementado con un `<div ref={introRef} aria-hidden className="h-px" />`
   sin altura real, pegado arriba de la primera estación (dentro de mi propio
   componente, no toqué `screens.tsx`: así evito acoplar por `id`/DOM query
   entre Server y Client Component). Un segundo `IntersectionObserver` con
   `rootMargin: '0px 0px -55% 0px'` (root recortado al 45% superior del
   viewport) decide `introVisibleRef`: mientras el centinela siga en esa franja
   superior, `recompute()` fuerza `onActiveChange(0)` sin mirar la banda. Solo
   cuando el centinela sale de esa franja (el lector ya scrolleó lo
   suficiente) la banda toma el control.

   Verificado en el browser (1920×935 real, ver sección de verificación): a
   los 20px de haber entrado la sección, la estación 0 sigue activa; recién
   entre +250px y +550px de scroll adicional pasa a la estación 1 — ya no es
   instantáneo.

3. **Banda más angosta y centrada**: `rootMargin` pasó de `-40% 0px -40% 0px`
   (20% de banda) a `-45% 0px -45% 0px` (10% de banda, centrada en el medio
   exacto del viewport), tal como sugería el brief. Con el bug de (1) ya
   arreglado esto es un afinamiento, no la causa principal.

## Aire (spacing)

- **Entre el título y la primera estación**: el wrapper de `OrderJourneyClient`
  pasó de `mt-2` (0.5rem — ínfimo) a `mt-8 lg:mt-14` (2rem / 3.5rem). Sumado al
  `pb-3` que ya trae `SectionHeading`, da un respiro real antes de que
  arranque el visor, verificado a ojo en el screenshot de 1920px (gap visible
  de ~70px entre el título y el marco del celular).
- **Entre estaciones (desktop)**: cada `<li>` del riel de texto ahora lleva
  `lg:min-h-[60vh]`, y el bloque de copy (`min-w-0 flex-1 pb-2 ...`) se le
  agregó `lg:flex lg:flex-col lg:justify-center` para que el texto quede
  centrado verticalmente dentro de ese alto en vez de pegado arriba. Como el
  `<li>` es `flex` (default `align-items: stretch`), la columna del ícono
  (`StepMark` + línea conectora) se estira automáticamente para llenar el
  mismo alto, así que la línea entre pasos también se alarga — no queda un
  hueco visual "vacío" sin conexión, es aire distribuido arriba y abajo del
  texto centrado, tal como pedía el brief ("sin dejar huecos visibles").
  Con el viewport real usado en la verificación (935px de alto), cada
  estación ocupa ~560px de alto de columna, dando un recorrido de scroll
  cómodo por estación sin llegar a sentirse eterno.
- No toqué el `gap-10 xl:gap-12` entre `<li>` (ya suficiente dado el nuevo
  `min-h`), ni nada del layout mobile (scope explícito del pedido era la
  franja de desktop del recorrido; mobile no tenía el problema reportado
  porque ahí la navegación es por swipe/botones, no por scroll vertical
  continuo).

## Blink al cambiar de paso

- **Estado compartido nuevo en `OrderJourneyClient`**: `activationCounts:
  number[]` (uno por estación, todos en `0` al montar) más un `prevIndexRef`
  para no reprocesar llamadas redundantes (el observer de "intro" reafirma
  `0` en cada scroll mientras el título sigue en pantalla). `handleActiveChange`
  es el ÚNICO punto que sube `activationCounts[index]`, y lo hace solo cuando
  el índice realmente cambia — nunca en el montaje inicial (todos arrancan en
  `0`), así que la estación 0 activa en el HTML servido nunca parpadea.
- **Dónde se aplica**: en `DesktopJourney` (el `StepMark` del riel de texto) y
  en el indicador de posición del riel de mobile (`MobileJourney`). En ambos
  casos: `shouldBlink = state === 'current' && !reducedMotion &&
  (activationCounts[index] ?? 0) > 0`. Cuando es `true`, envuelvo el
  `StepMark` correspondiente en `<span key={`${station.id}-${activationCounts[index]}`}
  className="landing-blink inline-flex">` — el cambio de `key` fuerza a React
  a desmontar y remontar el `<span>` cada vez que la estación se reactiva
  (incluido volver atrás), así el `animation: ... 1 both` de `.landing-blink`
  vuelve a correr desde cero en cada activación real.
- **Nunca los cinco a la vez**: solo la estación con `state === 'current'`
  puede calificar (por definición hay como máximo una), así que la clase
  nunca se aplica a más de un `StepMark` por layout (desktop y mobile
  comparten el mismo `activeIndex`/`activationCounts`, pero solo el árbol que
  de verdad tiene `display` distinto de `none` según el breakpoint CSS es el
  que un usuario ve parpadear — el otro está montado pero oculto).
- **`prefers-reduced-motion`**: la clase directamente no se agrega
  (`!reducedMotion` en `shouldBlink`). Reutilicé el `reducedMotion` que ya
  existía en el componente (antes solo gobernaba el `behavior` de
  `scrollIntoView` en mobile) en vez de agregar un segundo listener de media
  query.
- **No toqué `.landing-blink`/`@keyframes landing-blink` en `globals.css`**:
  la instrucción explícita fue usarla tal cual. Nota para quien siga: esa
  keyframe anima `box-shadow`, no `transform`/`opacity` — vale la pena
  recordarlo si alguna vez se audita contra la regla general de "animar solo
  propiedades compositor-friendly", pero no es una decisión mía y no era mi
  lane tocarla.

## Verificación hecha

- `npx tsc --noEmit -p .` — limpio (todo el proyecto, no solo mis archivos).
- `npx eslint src/views/landing/screens.tsx src/views/landing/order-journey.tsx`
  — limpio.
- **Navegador real (Chrome MCP, pestaña propia, cerrada al final)**, ventana
  efectiva de 1920×935 (el `resize_window` a 1440×900 no tomó efecto en este
  entorno — igual que Slice C reportó problemas de entorno con el
  redimensionado; documentado, no es un defecto del componente. 1920px sigue
  siendo terreno `lg:`/`xl:` así que el layout y el comportamiento verificados
  son los mismos que a 1440):
  - Scrolleando de a pasos (`scrollTo` + captura, para forzar un repintado
    real — en este entorno el `IntersectionObserver` no dispara si se hacen
    varios `scrollTo` seguidos sin ninguna captura/repintado de por medio;
    ver nota de entorno abajo) confirmé: la estación 0 sigue activa a los
    +20px de entrar la sección, sigue activa a los +250px, y recién entre
    +250px y +550px pasa a la estación 1 — ya no es instantáneo. La
    transición 1→2→3→4 avanza de forma pareja, sin huecos raros, y al llegar
    al final del recorrido la sección siguiente ("Las dos cosas que WhatsApp
    no puede dar") empieza sin un salto de layout.
  - Blink: en una carga fresca, sin scrollear, `document.querySelectorAll('.landing-blink')`
    da `0` (SSR correcto, sin parpadeo). Tras forzar la transición a la
    estación 1, da `2` (el `StepMark` de escritorio con `who === "El
    mostrador"` + el indicador oculto de mobile) — nunca las cinco. Volviendo
    a la estación 0, vuelve a dar `2`, ahora sobre "El que compra" — confirma
    que también parpadea al volver atrás.
  - **Nota de entorno (ya documentada por Slice C, la reconfirmo)**: en esta
    pestaña automatizada, una secuencia de `window.scrollTo` ejecutada por JS
    sin ninguna captura de pantalla intermedia **no dispara el
    `IntersectionObserver`** — ni siquiera el callback inicial garantizado
    por spec, verificado con un observer aislado de prueba. Intercalar un
    `computer:screenshot` entre cada `scrollTo` "despierta" el compositor y
    el observer responde de inmediato y correctamente. No es un bug del
    componente (un scroll real de usuario, con la pestaña compuesta
    normalmente, no tiene este problema — así se comportó consistentemente
    en todas las pruebas que intercalaron capturas).
- **Mobile (390)**: no se pudo forzar el ancho de ventana a 390 en este
  entorno (el `resize_window` no tomó efecto de forma confiable en ninguna
  prueba de esta sesión). Revisé por código: el único cambio que alcanza al
  layout mobile es el `mt-8 lg:mt-14` del wrapper compartido (antes `mt-2`),
  que solo agrega aire arriba del riel — sin regresión — y el blink en el
  indicador de posición, gateado igual que en desktop. Ninguna clase
  `lg:min-h-[60vh]` ni `lg:flex lg:flex-col lg:justify-center` aplica por
  debajo de `lg:`, así que el riel horizontal, el swipe y los botones
  anterior/siguiente quedan exactamente como los dejó Slice C.

## Qué quedó igual (sin tocar, a propósito)

- El visor sticky, el crossfade celular↔escritorio, el riel de mobile con
  scroll-snap, las capturas y los textos: todo tal cual lo dejó Slice C.
- No agregué ningún primitivo nuevo a `src/views/shared/surfaces.tsx`.

## Correcciones (ronda post-review, 2026-09-02)

Atendí el hallazgo 2 [BLOQUEANTE] de `03-review.md` sobre `order-journey.tsx`:
usaba `priority: true`, la API de `next/image` deprecada en Next 16 (vigente:
`preload`, confirmado en
`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`),
y lo hacía en DOS `<Image>` distintos apuntando al mismo asset
(`pantalla-cliente.png`): el árbol desktop (`FrameStack` dentro de `Visor`,
oculto por `hidden lg:grid` a nivel del padre pero siempre montado) y el árbol
mobile (`MobileStationCard`, oculto por `lg:hidden`, también siempre
montado). Confirmado con `curl` antes del fix: dos `<link rel="preload"
as="image">` para el mismo href, con `imageSizes` distintos, compitiendo por
ancho de banda en la primera pantalla.

**Decisión, documentada también como comentario en el propio archivo (arriba
de `FrameStack`)**: en vez de dejar una sola precarga (la sugerencia "más
simple" de la review), saqué la precarga por completo de la sección. Motivo:
`OrderJourney` es la TERCERA sección de la página (`page.tsx`: hero → carrera
→ recorrido) — el `<h1>` del hero es el LCP real, no la primera foto del
recorrido, que está bien por debajo del fold. Precargar acá encima competía
con el LCP real por la conexión mala de un celular (CLAUDE.md, Estilo: "el
90% de los pedidos entra desde un celular, muchas veces... con mala señal"),
así que la primera captura del recorrido pasa a `loading="lazy"` igual que
las demás — el navegador la trae recién cuando se acerca al viewport. Quité
también la lógica `isFirst`/`priority` que decidía cuál imagen eager-cargar
por grupo de aspecto (ya no hace falta: todas van `loading="lazy"`), y el prop
`priority` de `MobileStationCard` (ahora solo recibe `station`).

Verificación:
- `npx tsc --noEmit -p .` limpio.
- `npx eslint src/views/landing/order-journey.tsx` limpio.
- `curl -s http://localhost:3000/ | grep -c 'rel="preload"'` → 1 (el único
  preload restante es el logo del header, de otro slice, no de este archivo);
  `grep -o '<link rel="preload"[^>]*pantalla-cliente[^>]*>' | wc -l` → 0. Cero
  duplicados, cero precarga del asset de este archivo.

No pude reproducir el recorrido en Chrome en esta sesión — la extensión
denegó permiso sobre `localhost` (`Permission denied for this action on this
domain`), sin ruta para otorgarlo desde el agente. El comportamiento del
crossfade celular↔escritorio y el blink al cambiar de estación no dependen
de esta sección del código (motion, IntersectionObserver, `reducedMotion`
vía inicializador perezoso) — solo cambié qué tan agresivo es el
`fetchPriority` de las imágenes — así que no debería haber efecto visual,
pero recomiendo a quien retome confirmar con una carga real: la primera
estación tiene que verse sin demora perceptible incluso con `loading="lazy"`,
dado que en desktop queda dentro del `sticky` que aparece apenas se hace
scroll un poco.
