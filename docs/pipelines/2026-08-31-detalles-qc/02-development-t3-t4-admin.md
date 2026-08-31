# T3 + T4 — KDS: ícono de WhatsApp y horario semanal más prolijo

Agente: `frontend-react-craftsman`. Slice de `01-tasks.md` (T3 y T4, ambos en
`views/admin/`). `npm run typecheck` y `npm run lint` en verde al cierre.

## T3 — Ícono real de WhatsApp en los botones del KDS

**Archivos**: `src/views/admin/kds/order-card.tsx`, `src/views/admin/kds/transfer-tray.tsx`.

Reemplacé `MessageCircle` (lucide, genérico) por `WhatsApp`
(`@/components/ui/whatsapp.tsx`, ya existente) en:

- `order-card.tsx:323` — botón "Avisar por WhatsApp" (aparece cuando el
  cambio de estado devolvió un `notification.actionUrl`).
- `transfer-tray.tsx:203` — botón "Escribirle por WhatsApp" del diálogo de
  confirmación de transferencia.

### Decisiones (documentadas también in-line, junto a cada uso)

- **Color**: se mantiene el verde de marca fijo del SVG (`#25D366`), no se
  neutraliza a `currentColor`. Es un logo, no texto — en un tablero que se
  mira de reojo, el color ayuda a ubicar ESTE botón entre el resto de
  outline/ghost, todos grises. Medí contraste del verde contra los dos fondos
  del admin: **~2:1 sobre el fondo claro** (`oklch(1 0 0)`) y **~6.6:1 sobre
  el oscuro** (`oklch(0.145 0 0)`). El número claro es bajo para texto, pero
  WCAG 1.4.11 (contraste no-textual) no aplica: el ícono acompaña un label
  visible ("Avisar por WhatsApp" / "Escribirle por WhatsApp") que ya lleva el
  significado completo, el ícono es refuerzo, no el único portador del dato.
  Mismo criterio y mismo verde fijo que ya usa la vitrina en `store-dock.tsx`
  y `transfer-panel.tsx` (ahí sin texto acompañante en el ícono del dock, pero
  no toqué esos archivos — son de otro slice).
- **Tamaño**: bajado un escalón frente a sus vecinos lucide en el mismo botón
  (`size-3.5` en vez de `size-4`, que es lo que usan `Banknote`/`Loader2` al
  lado). El logo es relleno (más "peso" óptico que un trazo de 2px) y a
  `size-4` se veía visiblemente más grande que el resto de los íconos del
  botón.
- **`aria-hidden`**: agregado en las dos instancias (ya estaba en
  `transfer-tray.tsx`, lo sumé en `order-card.tsx` para que las dos sean
  consistentes) — el texto del botón ya nombra la acción completa.

### Sobre el comentario "viejo" que pedía el brief

El brief decía que `order-card.tsx` tenía comentarios afirmando "WhatsApp usa
`MessageCircle` porque lucide no trae logos de marca" y pedía actualizarlos.
Verifiqué con grep en todo `src/`: ese comentario **solo existe en
`store-dock.tsx`** (líneas 25 y 326), no en `order-card.tsx` — ahí no había
ningún comentario de ese tipo que actualizar. No toqué `store-dock.tsx`
(explícitamente fuera de este slice). Dejo la aclaración acá para que quede
registrado que no fue un olvido: el archivo señalado no tenía el comentario
que se pedía corregir.

### `board.tsx:535` (toast de sonner) — NO tocado

El toast "Avisar por WhatsApp" de `board.tsx` (acción de un `sonner.toast`)
no admite ícono en su API de `action`, y ese archivo está fuera de mi
propiedad exclusiva en este slice. Queda igual, con el label sin ícono.
Si en el futuro se quiere resolver, la opción más simple sin tocar la firma de
sonner es envolver el label en un `<span>` con un ícono inline vía JSX (sonner
acepta `ReactNode` en `label`), pero no lo apliqué porque es archivo de otro
agente/slice.

## T4 — `DayBar` en `src/views/admin/ajustes/schedule-track.tsx`

Leí primero el brief de superficie completo
(`.impeccable/surfaces/src-views-admin-ajustes-schedule-editor-tsx.md`) y no
toqué `computeWeekAxis` ni `formatAxisHour` (firma y comportamiento intactos).
Agregué un helper nuevo, `hourTicks(axis): number[]`, y reescribí solo el
rectángulo decorativo de la pista dentro de `DayBar`. El `forwardRef` al
`<button>` real sigue intacto.

### Qué estaba flojo, y qué cambié

1. **"Pastillas sueltas flotando" con turnos cortos** — las barras eran
   `rounded-pill` (radio ~56px en una pista de 20-24px de alto, prácticamente
   una cápsula). Pasé a `rounded-[3px]`: sigue siendo un radio suave
   (consistente con el resto del sistema, que nunca usa esquinas 100%
   cuadradas), pero ya lee como "segmento de una línea de tiempo" y no como
   una píldora aislada.

2. **"Con un turno largo la pista desaparece"** — el contenedor no tenía
   borde, solo `bg-muted`; con una barra que cubre casi todo el eje, el marco
   de la pista se perdía contra la barra. Agregué `border border-border` al
   contenedor: ahora el límite de la pista se ve siempre, la llene o no la
   barra.

3. **Ninguna referencia de "qué hora es esta posición"** — agregué
   `hourTicks(axis)`, marcas de hora INTERNAS del eje (nunca los bordes, que
   ya los marca el borde de la pista) con paso adaptable al span
   (`tickStepHours`: 2h si el span es ≤10h, 3h si es ≤18h, 4h si es mayor —
   evita amontonar marcas en un turno corto y evita quedarse con solo dos en
   una semana de jornadas largas). Se dibujan como `bg-foreground/15 w-px`,
   ANTES que las barras de turno en el DOM a propósito: donde hay un turno, el
   turno tapa la marca, y no hace falta reforzar lo que la barra ya dice. Como
   las siete pistas reciben el mismo `axis` y calculan las mismas posiciones
   relativas, leídas una debajo de la otra forman una sola grilla compartida
   — es lo que hace que las siete filas se lean como una figura y no como
   siete gráficos sueltos, sin necesitar una fila de horas aparte arriba del
   grupo (ver más abajo por qué no construí esa fila).

4. **Día cerrado idéntico a "sin eje"** — con `ranges = []` y `axis` presente
   (el resto de la semana sí tiene horario), ahora la pista dibuja igual la
   grilla de marcas de hora pero ningún turno: se distingue de un vistazo de
   la semana totalmente vacía (`axis === null`, sin ninguna marca, rectángulo
   liso), que es un estado distinto ("no cargaste nada todavía" vs. "este día
   no abre"). No inventé un segundo tratamiento visual (hachurado, opacidad
   reducida, etc.) porque la diferencia grilla-sin-barra / liso-sin-grilla ya
   es legible y no compite con el texto (`summary`), que sigue siendo el dato
   accesible real.

5. **Marcador de medianoche perdido** — era `bg-border w-px` pintado sobre la
   barra o sobre la pista, y `border` es gris pálido en los dos temas: gris
   sobre `bg-primary` (oscuro en claro, claro en oscuro según el tema) se veía
   apenas, y gris sobre `bg-muted` era directamente gris sobre gris. Lo
   reemplacé por un marcador con `mix-blend-difference` y un relleno neutro
   (`oklch(0.65 0 0)`): el blend invierte lo que tenga debajo, así que el
   marcador queda visible sea que esté parado sobre un turno o sobre pista
   vacía, en tema claro o en oscuro. Agregué `isolate` al contenedor de la
   pista para que el blend se acote a ESE rectángulo y no componga contra lo
   que sea que quede detrás en el layout general de la página. Subí el ancho
   de 1px a 1.5px para que sea más fácil de ver sin volverse un elemento
   grueso.

6. **Turnos sub-pixel invisibles** — un turno de 30 min en un eje de 18h da
   ~2.3% de ancho, que en una pista de ~300-400px son unos pocos píxeles y en
   una angosta (mobile, pista completa ~328px) puede redondear a menos de 1px.
   Cambié el `width` inline de `${width}%` a `max(${width}%, 6px)` (función
   CSS `max()` mezclando `%` y `px`, soportada en los navegadores modernos):
   cualquier turno cargado se ve, aunque el ancho real quede levemente
   sobre-representado para turnos muy cortos — mejor un dato visible y algo
   impreciso que invisible.

### Lo que evalué y descarté

- **Fila de horas compartida arriba/abajo del grupo de pistas** (una de las
  ideas legítimas del brief): no la construí. `schedule-editor.tsx` ya
  renderiza, arriba de las siete `DayBar` (línea ~437-441), un texto "Franja
  mostrada: HH:MM a HH:MM" derivado del mismo `axis` — es exactamente la
  referencia textual del eje compartido que una fila de horas agregaría, solo
  que sin las marcas intermedias. Sumado a que las marcas de hora ahora ya se
  repiten alineadas en las siete pistas (mismo `axis`, mismas posiciones), me
  pareció que una segunda pieza visual (un `WeekAxisScale` con labels tipo
  "08:00 12:00 16:00 20:00") sumaba redundancia visual sin resolver un vacío
  real, a cambio de tener que tocar el layout de `schedule-editor.tsx` (fuera
  de mi propiedad en este slice) para insertarla.

  Si más adelante se quiere esa fila igual: `hourTicks(axis)` (exportado
  desde este archivo) ya da las horas internas a etiquetar con
  `formatAxisHour`; haría falta un componente nuevo que replique el esqueleto
  de layout de `DayBar` (el mismo spacer de `w-[5.5rem]` en `@min-[26rem]` y
  el mismo `@container`) para que los labels alineen en X con las marcas de
  cada fila, y UNA línea en `schedule-editor.tsx` para insertarlo entre la
  línea 442 (cierre del `<p>` de "Franja mostrada") y la línea 444 (apertura
  del `<div className="flex flex-col gap-3">` con las siete `DayBar`). No lo
  apliqué: es un cambio de archivo ajeno y, como digo arriba, no me pareció
  que agregara valor suficiente sobre lo que ya hay.
- **Radio de marca (`--radius` del local) en las barras**: no aplica — el
  brief es explícito en que `/admin` no lleva tema del local y el color/radio
  de la barra sale de los tokens del panel. Usé un radio fijo en píxeles
  (`rounded-[3px]`) en vez de una fracción de `--radius` para que el aspecto
  de "barra de línea de tiempo" no dependa de cuán grande sea el radio de
  marca configurado en otras superficies — es un token de layout, no de
  identidad.

### Estados verificados a mano (lectura de código, sin Storybook/tests)

- Eje `null` (semana vacía): pista lisa, sin marcas, sin barras — igual que
  antes, ahora claramente distinta del día cerrado con eje presente.
- Día con dos turnos cortos: cada uno dibuja su propio segmento con radio de
  3px, separados, con piso de 6px de ancho — ya no se leen como puntos.
- Día con un turno que cubre casi todo el eje: el borde de la pista sigue
  visible alrededor de la barra.
- Viernes 19:00–02:00 (cruza medianoche): el eje se extiende a 26, el
  marcador de medianoche cae dentro de la barra y se ve por el blend en vez
  de perderse.
- Ancho de fila mobile (~328px, `@min-[26rem]` no se activa): la pista sigue
  a ancho completo bajo la etiqueta, sin cambios de layout — solo cambió el
  contenido decorativo de adentro.
- Foco de teclado: sin cambios en el `<button>` ni en `forwardRef`; el
  contrato de foco de `WeekEditor` no se tocó.

## Pendiente / cross-lane

- Nada de T3 ni T4 quedó bloqueado por otro lane. La única nota es la de
  `board.tsx` (T3, arriba) y la de `schedule-editor.tsx` (T4, arriba): ambas
  son sugerencias sin aplicar, no bugs.

## Skills invocadas

`impeccable` (craft-floor.md + operate.md + el brief de superficie de
horarios, leídos antes de tocar nada; el hook post-edit no marcó hallazgos
mecánicos en los tres archivos), `web-design-guidelines`, `frontend-design`
(tratamiento de las barras), `vercel-react-best-practices`. `context7` no
hizo falta: no se usó ninguna API nueva de librería (todo es CSS/Tailwind y
JSX plano).

## Revisión del coordinador — tres correcciones aplicadas

### 1. Comentarios viejos en `store-dock.tsx`

El coordinador verificó lo que yo no encontré: el comentario obsoleto SÍ
existe, en `src/views/storefront/store-dock.tsx` (no en `order-card.tsx`,
donde yo había buscado). Corregí los dos bloques, **solo el texto de los
comentarios, cero cambio de código**, con el archivo habilitado puntualmente
para esto:

- Cabecera de `StoreDock` (~línea 25): pasó de decir que WhatsApp usa
  `MessageCircle` porque lucide no trae logos de marca, a decir que la
  premisa vigente es "lucide-react O SVG propio" y que WhatsApp ya tiene el
  suyo (`@/components/ui/whatsapp.tsx`) mientras que Instagram sigue con
  `InstagramMark`.
- Comentario de `InstagramMark` (~línea 326): mismo ajuste, ahora dice que
  Instagram sigue sin ícono propio en lucide "mismo motivo por el que
  WhatsApp necesitó un SVG propio ... en vez de un ícono genérico" en lugar
  de nombrar `MessageCircle`.

No toqué nada del import (línea 17) ni del uso (línea 98) de `WhatsApp`, ni
ningún otro archivo de `storefront/`.

### 2. Radio de las barras de turno

`rounded-[3px]` era un valor arbitrario sin relación con la escala de radios
del proyecto. Revisé qué existe en `@theme` (`globals.css:55-69`):
`--radius-sm` es `calc(var(--radius) * 0.6)`, que con el `--radius` de
0.875rem del proyecto da ≈8.4px — casi la mitad de una barra de 20-24px de
alto, es decir la misma cápsula que `rounded-pill` que este cambio buscaba
sacar. No hay un escalón más chico en la escala.

Resolví con el mismo idioma que ya usa este repo para el mismo problema:
`button.tsx` clampea sus tamaños chicos con
`rounded-[min(var(--radius-md),10px)]` — un techo en píxeles anclado igual al
token. Apliqué el mismo patrón acá: `rounded-[min(var(--radius-sm),3px)]`. El
radio sigue derivado de la escala (si `--radius` bajara lo suficiente, la
barra lo seguiría) pero nunca pasa de 3px con el valor actual del proyecto.
Dejé el razonamiento completo en un comentario in-line junto al `className`.

### 3. `mix-blend-difference` sobre `--primary`

Calculé a mano el color resultante. Los cuatro tokens que puede tener DEBAJO
el marcador en esta pista — `--primary`, `--muted`, `--border`,
`--foreground` — son OKLCH con **croma 0** en los dos temas de `/admin`
(son grises puros; Operate no lleva tema de marca), y el relleno del
marcador también lo es (`oklch(0.65 0 0)`). Convertí OKLCH→sRGB para los
casos relevantes (para croma 0, R=G=B=L_ok³ antes de la codificación gamma,
así que alcanza con un canal):

- `--primary` claro (`oklch(0.205 0 0)`) ≈ rgb(23,23,23).
- `--primary` oscuro (`oklch(0.922 0 0)`) ≈ rgb(229,229,229).
- Relleno del marcador (`oklch(0.65 0 0)`) ≈ rgb(143,143,143).

`difference` resta canal a canal: con dos grises (R=G=B en los dos lados) el
resultado es necesariamente OTRO gris, nunca un matiz — no hay ninguna
asimetría entre canales de la que pueda salir un magenta o un verde. Números
concretos: sobre `--primary` claro, |143−23|=120 → rgb(120,120,120); sobre
`--primary` oscuro, |143−229|=86 → rgb(86,86,86). Los dos son grises medios
con contraste visible contra su fondo, en los dos temas. Conclusión: **sale
limpio, lo dejé como estaba**, y sumé la comprobación como comentario in-line
(con la advertencia de que si `/admin` alguna vez agrega un acento cromático
a estos tokens, hay que rehacer la cuenta — hoy es una garantía estructural
del palette, no una casualidad).

`npm run typecheck` y `npm run lint` siguen en verde después de las tres
correcciones.

## Segunda vuelta del coordinador — drift de Instagram en `store-dock.tsx`

El coordinador encontró un problema real y anterior a mi paso por el archivo,
que quedó a la vista justo al ordenar los comentarios de íconos de marca: el
canal de Instagram se dibujaba con **dos glifos distintos** según por dónde
entraba el usuario.

- `store-dock.tsx:173` (botón directo del dock, carrito vacío) ya usaba
  `<Instagram>` de `@/components/ui/instagram.tsx` — el logo real, a color,
  con gradiente.
- `instagramRow` (línea 62, usado por el Popover de delivery — que en
  realidad no lo lista, ver abajo — y por la lista del `Drawer`, línea 201)
  declaraba `icon: InstagramMark`, una función local de este mismo archivo:
  un contorno gris de 24×24 en el mismo trazo que lucide.

O sea: mismo canal, mismo componente, dos íconos. WhatsApp no tenía este
problema porque su fila (línea 58) ya usaba `icon: WhatsApp`, el mismo
componente que el botón directo.

### Qué hice

1. **Unifiqué**: `instagramRow` pasa a `icon: Instagram` (línea 62). Antes de
   borrar `InstagramMark` corrí `grep -rn "InstagramMark" src/` y confirmé que
   sus únicos tres usos eran la declaración de la función, esta fila, y el
   comentario que la explicaba — ningún otro archivo la importaba. Borré la
   función completa (era privada a este archivo, nunca exportada).
2. **Repasé el contexto de renderizado antes de dar por buena la unificación**:
   la única fila donde `instagramRow.icon` se dibuja de verdad es la lista del
   `Drawer` (línea 201) — el Popover de delivery (línea 147-159) solo itera
   `deliveryRows` (Rappi/PedidosYa/Uber Eats), Instagram nunca entra ahí. En
   esa fila del `Drawer`, el ícono va envuelto en
   `<span className="text-muted-foreground" aria-hidden>`. El logo de
   Instagram no usa `currentColor` (son gradientes y un `fill="#fff"` fijos),
   así que ese wrapper no lo tiñe — se ve exactamente igual que en el botón
   del dock. Es el mismo comportamiento que ya tiene `WhatsApp` en esa misma
   lista (su verde fijo tampoco lo tiñe el wrapper), así que unificar no
   introduce un caso nuevo: reproduce un patrón ya aceptado en el archivo.
3. **Verifiqué en el navegador**, no solo leyendo código: local con
   `la-birra` (tiene `instagram_handle` en el seed), agregué un ítem al
   carrito para que el dock muestre el botón "···" y abra el `Drawer`.
   - Inspeccioné el DOM del link "Instagram" del `Drawer` con
     `document.querySelectorAll('a')` + `querySelector('svg')`: el `viewBox`
     es `"0 0 264.583 264.583"` y tiene `radialGradient`/`linearGradient` en
     sus `defs` — es el logo a color de `instagram.tsx`, no el contorno viejo
     (que era `viewBox="0 0 24 24"` sin gradientes).
   - Con capture visual (oculté momentáneamente el overlay de Next.js dev
     tools que tapaba la esquina, solo para el screenshot, sin tocar nada del
     build) confirmé el logo a color renderizado en la fila del `Drawer`,
     legible y del mismo tamaño que sus vecinos (`size-5`).
   - Alterné `.dark` en `<html>`/`<body>` con JS de página (mismo mecanismo
     de tema que usa `globals.css`, `@custom-variant dark (&:is(.dark *))`) y
     repetí el screenshot: el logo se ve idéntico en el fondo oscuro de la
     lista — esperable, porque es un SVG con sus propios `fill`/gradientes
     fijos, no depende de ningún token de color del tema. Mismo motivo por el
     que no hacía falta revisar el botón del dock (no lo toqué: ya usaba este
     componente antes de mi cambio).
4. **Reescribí el comentario de cabecera** (líneas ~25-31) una tercera vez,
   ahora sin afirmar un estado transitorio: dice que los dos canales ya tienen
   su SVG propio, que este archivo usa el MISMO componente en el botón directo
   y en la fila de "más canales", y nombra explícitamente el drift que existía
   antes para que quede registrado por qué importa la unificación (no solo
   "así se ve mejor").

### Alcance respetado

Solo `src/views/storefront/store-dock.tsx` tocado en esta vuelta (cambio de
`icon:` en la fila, borrado de `InstagramMark`, reescritura del comentario de
cabecera). No toqué `@/components/ui/instagram.tsx` ni ningún otro archivo de
`storefront/` — `product-card.tsx` sigue siendo de otro agente.

`npm run typecheck` y `npm run lint` en verde después de este cambio también.
