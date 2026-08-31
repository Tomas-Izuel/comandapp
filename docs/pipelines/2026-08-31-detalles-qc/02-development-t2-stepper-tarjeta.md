# T2 — El "+" de la tarjeta se convierte en selector de cantidad

Agente: `frontend-react-craftsman`. Archivo tocado: `src/views/storefront/product-card.tsx` (único; no se crearon archivos nuevos, no hizo falta una variante nueva en `src/views/shared/`).

## Qué se implementó

En el camino sin opciones obligatorias (`needsOptions === false`), el botón "+"
de la tarjeta de producto ahora refleja y controla la cantidad de esa línea en
el carrito directamente, sin navegar a la ficha:

- `quantity === 0` → el control es el "+" circular de siempre (mismo tamaño,
  mismo lugar, mismo `aria-label` "Agregar X al carrito").
- `quantity >= 1` → aparece un stepper propio de tres piezas (menos / contador
  / más) apilado en **columna**, no en fila. Tocar "+" suma una unidad
  (`setQuantity(index, quantity + 1)`); tocar "−" resta una (`setQuantity(index,
  quantity - 1)`); al llegar a 0 `setQuantity` borra la línea sola (ver
  `lib/cart.tsx`) y el control vuelve a ser "+" en el siguiente render — no hace
  falta un branch especial para eso.
- Con opciones obligatorias (`needsOptions === true`) no cambió nada: el "+"
  sigue siendo el `<Link>` a la ficha, intacto.

El estado real es `useCart().lines`: no hay `useState` local para la cantidad.
Cada render busca la línea de este producto sin opciones con `lineKey({
productId, optionIds: [], notes: null })` — la misma clave que usa `addLine` —
y deriva `quantity` de ahí. Si el cliente vacía el carrito en `/carrito` y
vuelve a la carta, `lines` cambia, el `find` no encuentra la línea, `quantity`
vuelve a 0 y el control vuelve a ser "+" solo, sin ningún efecto ni
sincronización manual.

## Por qué el stepper es VERTICAL (la decisión de geometría)

El `Stepper` compartido de `src/views/shared/surfaces.tsx` **no se tocó** —
sigue usándose tal cual en `/carrito` (`cart-view.tsx`) y en la ficha
(`product-detail.tsx`), donde hay ancho de sobra. Para la tarjeta se armó una
variante **local**, dentro de `product-card.tsx`, porque medido en el
navegador el `Stepper` horizontal no entra en ninguna de las dos formas de la
tarjeta:

- **Ancho del `Stepper` horizontal**: 44 (menos) + 4 (gap) + 36 (`w-9` del
  contador) + 4 (gap) + 44 (más) = **132px**.
- **Variante `edge` (forma horizontal/cómoda)**: a 320px de viewport la celda
  mide 263px; después de la miniatura (72px) y los `gap-3`/`p-3` ya
  documentados en el comentario de cabecera del archivo, el texto se queda con
  ~99px. Poner un control de 132px de ancho en el lugar del botón de 44px deja
  ~3px para nombre y precio — no entra.
- **Variante `photo` (forma vertical/compacta)**: la foto es cuadrada y mide el
  ancho de la celda — 126px en la celda compacta más angosta ya medida en el
  archivo (320px de viewport). Un control de 132px de ancho, creciendo hacia la
  izquierda desde `right-2`, se sale por el borde izquierdo de una foto de
  126px.

La salida elegida: un stepper que crece en **ALTO**, no en ancho — menos
arriba, contador al medio, más abajo, en columna, con el mismo ancho de 44px
que el "+" siempre tuvo. Eso resuelve las dos formas a la vez:

- `edge`: la columna que le come al texto sigue siendo de 44px, idéntica a
  antes. Cero regresión sobre el problema que ya era justo (verificado en
  navegador: agregar "Brownie" con `MAX_QUICK_ADD_QUANTITY` intacto no truncó
  ni el nombre ni la descripción ni el precio a 320/375/500px de viewport).
- `photo`: anclado con el mismo `right-2 bottom-2` de siempre (así el "+" que
  el cliente ya tocó queda en el MISMO lugar exacto cuando se convierte en
  stepper — no hay que reubicar el pulgar), el stepper activo mide
  exactamente **108px de alto** (44 + gap 2 + contador 16 + gap 2 + 44, con
  `gap-0.5`). Verificado con el DOM real, forzando density=compact (factor de
  espaciado 1×, `--spacing: 0.25rem`) y `--catalog-cols: 2` sobre una tienda
  seed (`/la-birra`, que no tiene ninguna tienda compacta sembrada) con un
  panel de 126px de ancho exacto: la foto cuadrada renderiza a 124px de alto,
  el stepper ocupa sus 108px con **exactamente** 8px de margen arriba y 8px
  abajo (el mismo `right-2 bottom-2`) — encaja justo, sin recortarse contra el
  `overflow-hidden` del `Panel`. A partir de 161px (@390 según la tabla ya
  medida del archivo) sobra bastante margen.

**Verificación con una combinación IMPOSIBLE en producción, y por qué se
descartó**: un primer intento de simular "celda angosta" forzando
`--catalog-cols` sin también fijar `--spacing` (con la tienda seed en su
densidad `cozy`, factor 1.1×) dio botones de 48.4px reales y un stepper de
118.75px que SÍ se recortaba (el borde superior del "menos" quedaba ~2.5px por
encima del `Panel` y el `overflow-hidden` lo cortaba). Se investigó por qué:
en `src/lib/theme.ts`, `--catalog-cols` es `2` únicamente cuando
`branding.density === 'compact'`, y `compact` es la única densidad con factor
de espaciado `1` (`DENSITY_SCALE.compact = 1`) — cozy/roomy escalan `--spacing`
hacia arriba pero SIEMPRE quedan en una sola columna (`--catalog-cols: 1`).
O sea que "celda de 126px" y "botones más grandes que 44px" nunca coexisten en
una tienda real: esa combinación era un artefacto de la forma de simularlo, no
un caso real. Repetido fijando también `--spacing: 0.25rem` (density=compact
real) el resultado fue el fit exacto de 108px descripto arriba. **Moraleja
para quien retome esto**: al simular una celda angosta a mano (sin poder bajar
la ventana de Chrome de este entorno por debajo de ~500px), hay que fijar
`--spacing` junto con `--catalog-cols` — si no, el test mide una combinación
que la app nunca produce.

## Corrección post-revisión: el nombre de respaldo (sin foto) ya no compite con el stepper

Primera versión de este slice dejaba anotada como "cosmética aceptada" la
colisión entre el nombre de respaldo (`PhotoFrame fallbackLabel`) y el stepper
activo en la celda compacta más angosta, con productos sin foto. El
coordinador correctamente lo rechazó: `CLAUDE.md` es explícito —*"Sin foto no
es un hueco gris: es el nombre en grande sobre el color de la marca"*— y este
mismo archivo ya documenta que exactamente este defecto se corrigió una vez en
la forma horizontal ("Doble Cheddar" tapado por la pastilla de minutos).
Dejarlo reaparecer en la forma vertical era reabrir esa decisión, y el
argumento de "el nombre real está abajo" no sostiene porque, de sostener, el
nombre de respaldo no tendría razón de existir en ninguna tarjeta.

**Medí las tres salidas que propuso el coordinador antes de elegir:**

1. **Reservar la columna derecha en el nombre de respaldo** (la opción
   elegida). `PhotoFrame` no se puede editar, pero acepta `className`, que se
   mergea vía `cn()` (`twMerge` + `clsx`, `src/lib/utils.ts`) sobre el `<div>`
   EXTERIOR del componente — el que envuelve tanto la imagen real como el
   fallback. Agregarle `pr-13` (13 unidades de `--spacing`: exactamente
   `size-11` del botón + `right-2` de margen, o sea el mismo ancho que ya
   ocupa el control) reduce el content-box del contenedor; como
   `PhotoFallback` interno mide `h-full w-full` (porcentual, no absoluto), se
   ajusta solo a esa columna más angosta — el nombre queda centrado en la
   MITAD IZQUIERDA, nunca entra en el rango de X del stepper.
   - **Problema que apareció al medir, y cómo se resolvió**: el `<div>`
     exterior tiene `bg-muted` (gris neutro) como fondo propio; al reducir el
     content-box del fallback (que SÍ lleva el tinte de marca,
     `bg-primary/10`), la franja reservada quedaba mostrando el gris del
     exterior — literalmente el "hueco gris" que la regla prohíbe, solo que
     más angosto. Se resolvió pasando `bg-primary/10` en el MISMO `className`
     que agrega el `pr-13`: como `cn()` usa `twMerge`, la clase de fondo que
     llega después le gana a `bg-muted` en el `<div>` exterior, y la columna
     reservada queda con el mismo tinte de marca que el resto del fallback —
     cero gris expuesto.
   - **Por qué solo aplica con `isStepper` activo y sin foto**: `!product.imageUrl
     && isStepper && 'bg-primary/10 pr-13 @min-[14rem]:pr-0'`. Sin esta doble
     condición, CUALQUIER producto sin foto perdería columna de nombre todo el
     tiempo, incluso en reposo (regresión nueva) o en la forma horizontal
     (donde el control ya no vive sobre la foto — `@min-[14rem]:pr-0` cancela
     la reserva ahí, porque restarle 52px a una miniatura de 4.5rem/7rem sería
     mucho peor que el problema que se está arreglando).
   - **Por qué escala solo con la densidad real**: `pr-13` es
     `calc(var(--spacing) * 13)`, la MISMA variable que ya escala `size-11` y
     `right-2` del control. Si el día de mañana la densidad `compact` dejara
     de ser 1× la reserva se movería junto con el control, sin volver a medir.
2. **Mover el control en el caso sin foto**: descartada. El envoltorio del
   caso sin foto en horizontal ya cambia de alto (`7rem`) porque ahí SOBRA
   alto y falta ancho de texto — la relación inversa en vertical (foto
   cuadrada, ancho = alto = el de la celda) no tiene un lugar mejor para mover
   el control a: cualquier otra esquina de una foto cuadrada de 126px choca
   con la pastilla de minutos (arriba-izquierda) o con el propio nombre
   (centrado). Mover el control rompía la convención de la categoría entera
   (control siempre en la esquina inferior derecha de la foto) sin necesidad,
   habiendo una salida que no la toca.
3. **Cambiar el anclaje del stepper al crecer**: descartada por la misma razón
   que la geometría vertical ya elegida (ver la sección de arriba): en una
   foto de 126px cualquier anclaje alternativo (por ejemplo, centrado o
   flotante) tiene MENOS margen que el anclaje actual (`right-2 bottom-2`, que
   ya encaja exacto — 124px de foto − 108px de stepper = 16px, repartidos
   8+8). Cambiar el anclaje no le da más aire al nombre; solo mueve el
   problema a otra esquina.

**Verificado en navegador** (misma técnica que el resto del slice: forzar
`--spacing: 0.25rem` + `--catalog-cols: 2` sobre `/la-birra`, más un panel
angostado a 126px a mano, para reproducir la única combinación real donde
compacta ocurre):

- "Papas Clasicas" (sin foto, cantidad 1): el nombre se lee "Papas" /
  "Clasica" en la mitad izquierda de la foto, sin ningún carácter debajo del
  stepper. Antes de este ajuste, a la misma cantidad, el "1" del contador caía
  encima de la "s" final.
- "Coca-Cola 500ml" (sin foto, nombre de tres palabras que fuerza tres
  líneas): mismo resultado — las tres líneas quedan en la columna izquierda,
  cero superposición con el grupo `minus/contador/plus`.
- Fondo de la columna reservada: tinte de marca (`bg-primary/10`) igual que el
  resto del fallback, sin franja gris — confirmado visualmente.

**Verificación del pedido del coordinador — contador de dos dígitos (1 a 99)
contra la pastilla de minutos**: en el mismo panel de 126px, se incrementó
"Coca-Cola 500ml" de 1 a 49 (tope real `MAX_QUICK_ADD_QUANTITY = 50`, así que
99 no es alcanzable — 49 es el caso de dos dígitos más alto que existe) y se
midió el DOM en cada punto:

| Cantidad | Ancho del badge | Ancho del grupo (stepper) | Borde derecho de la pastilla "1′" | Borde izquierdo del stepper |
|---|---|---|---|---|
| 1  | 16.4px | 44px (fijo, lo dan los botones) | 77.1px | 93px |
| 13 | 22.7px | 44px | 77.1px | 93px |
| 49 | 22.7px | 44px | 77.1px | 93px |

El badge crece de 1 a 2 dígitos (16.4px → 22.7px) pero SIEMPRE queda centrado
dentro del ancho de 44px que ya definen los botones (`min-w-4`, sin ancho fijo
— crece con el contenido pero nunca supera a sus hermanos) — el grupo entero
nunca se ensancha más allá de la columna que el `pr-13` reserva, así que un
contador de dos dígitos no la desborda ni desplaza el stepper hacia la
izquierda. Y como la pastilla de minutos vive en `top-2 left-2` (columna
izquierda) y el stepper en `right-2 bottom-2` (columna derecha) con 16px de
aire horizontal entre ambas en el punto más angosto medido, ninguna cantidad
de 1 a 49 los acerca lo suficiente para tocarse. El caso "Agotado" no aplica:
`renderQuickAdd` devuelve `null` incondicionalmente cuando `isSoldOut`, así que
ningún control —ni "+" ni stepper, en ninguna cantidad— se dibuja jamás sobre
esa pastilla; es una garantía del código, no algo que dependa de geometría.

## `useAddFeedback` — por qué se sacó de este camino

Antes, tocar "+" confirmaba con un flash "agregado ✓" (`useAddFeedback`,
`isAdded`) que revertía solo a los 1.6s. Con el stepper, la confirmación pasó
a ser la cantidad exacta mostrada (con su propio `animate-bump`), que es
información estrictamente mejor que un tilde transitorio: dice CUÁNTO se
agregó, no solo QUE se agregó, y queda ahí en vez de desaparecer. Se sacó el
import y el uso de `useAddFeedback` de `product-card.tsx`. El hook sigue vivo
y sin cambios — lo sigue usando `store-dock.tsx` con su propia instancia, así
que no queda código muerto.

## Motion

Un solo momento autorizado ("agregar al carrito"), aplicado en dos capas
separadas para que no se pisen entre sí:

- El envoltorio que agrupa "menos" + contador (el ÚNICO elemento nuevo que se
  monta al pasar de `quantity === 0` a `quantity === 1`) usa `animate-rise`
  (ya definido en `globals.css`, sin uso previo en el código — arranca desde
  `opacity:0, translateY(0.75rem)` y llega a un estado ya visible). Como este
  `<div>` no se vuelve a montar en incrementos posteriores (sigue viviendo
  mientras `isStepper` sea `true`), la animación se reproduce UNA sola vez.
- El "+" **nunca se desmonta**: es el mismo elemento JSX en la última posición
  del contenedor en las dos ramas (`quantity === 0` y `quantity >= 1`), con un
  `onClick` que decide adentro si crea la línea o incrementa la existente.
  React lo reconcilia por posición sin necesidad de `key`, así que no hay
  parpadeo ni pérdida de foco al transformarse — verificado interactuando en
  el navegador: el clic que crea la línea deja el foco en el mismo botón.
- El contador reusa `animate-bump` con `key={quantity}` en un `<span>` propio,
  igual patrón que ya usan `cart-view.tsx` (`key={result.line.quantity}`) y
  `store-dock.tsx` (`key={itemCount}`): se reproduce en CADA +1/-1 posterior,
  sin reiniciar el `rise` del envoltorio (que no está keyeado por cantidad).
- Con `prefers-reduced-motion`, los dos `animate-*` son primitivas ya
  existentes con `both` fill: el resultado final es idéntico, nada queda
  oculto por JS — no se agregó ningún keyframe nuevo a `globals.css`.

## `MAX_QUICK_ADD_QUANTITY` — por qué se hardcodea 50 (y no se inventa otra cosa)

`MAX_LINE_QUANTITY` de `src/lib/cart.tsx` no está exportado y ese archivo es de
otro slice (prohibido tocarlo). En vez de inventar un mecanismo para
descubrirlo en runtime, se buscó precedente: `product-detail.tsx` YA hardcodea
`<Stepper value={quantity} onChange={setQuantity} max={50} />` para la ficha,
sin comentario. Este slice replica el mismo número con un comentario explícito
que señala la duplicación y advierte que si el tope de `cart.tsx` cambia hay
que actualizar los dos lugares (tres, contando la ficha) — no es un número
mágico nuevo, es el mismo precedente ya aceptado en el repo, ahora anotado.
El botón "+" queda `disabled` (mismo tratamiento visual que el `Stepper`
compartido: `disabled:opacity-35 disabled:hover:bg-primary`) al llegar a 50;
`setQuantity` clampea igual del lado del carrito así que un desincronismo
entre los dos números nunca puede pasar de "el botón se deshabilita un
`+1` tarde o temprano", nunca de "se manda una cantidad inválida".

## Accesibilidad

- `role="group"` + `aria-label="Cantidad de {producto} en el carrito"` en el
  contenedor del control (igual criterio que el `Stepper` compartido), incluso
  cuando hoy solo hay un botón visible — así no hace falta agregarlo recién
  cuando aparece el stepper.
- `aria-label` en cada botón nombra el producto: "Agregar {X} al carrito"
  (cantidad 0), "Agregar otra unidad de {X}" (incrementando), "Quitar una
  unidad de {X}" (decrementando). Ningún botón depende de contexto visual para
  identificarse.
- `aria-live="polite"` en el `<span>` del contador — puesto en el nodo que NO
  se remonta con `key={quantity}` (el de adentro sí, con solo el dígito), para
  que el lector de pantalla observe mutaciones de contenido en un nodo estable
  en vez de perder la referencia en cada cambio.
- Los dos botones (menos/más) usan `iconButtonClass`, que ya da `size-11`
  (44px) — piso táctil sin excepción. El contador del medio (16px, no
  interactivo) no necesita el piso de 44px porque no se toca.
- Los controles siguen siendo hermanos del `<Link>` que cubre la tarjeta
  (`relative`/`absolute` + `z-10`, sin cambios respecto de antes), así que
  tocar cualquiera de los tres botones nunca dispara la navegación — verificado
  interactuando en el navegador contra `/la-birra`: incrementar, decrementar y
  llegar a 0 nunca navegó a la ficha.

## Verificado en navegador (Chrome vía MCP, contra `/la-birra` en dev)

- Forma horizontal (`edge`, celda ~268px sin forzar nada): tocar "+" en
  "Brownie" mostró el stepper vertical sin romper el layout del texto; +1 y +1
  llevaron el contador a 2 con `animate-bump`; "−" dos veces volvió a "+" y el
  total de "Ver carrito" volvió a su valor original ($10.500 → $15.000 →
  $10.500).
- Forma vertical (`photo`), forzando `--catalog-cols` y `--spacing` para
  simular density `compact` real: a ~140px de celda (por encima del mínimo) y
  a 126px exactos (el mínimo real documentado en el archivo) el stepper
  aparece completo, sin recortarse contra el `Panel`, sin superponerse con la
  pastilla de minutos de la esquina opuesta (corren en columnas distintas: la
  pastilla en la izquierda, el stepper en la derecha).
- `npm run typecheck` y `npm run lint`: los dos en verde, sin warnings nuevos.

## Qué NO se tocó

- `src/views/shared/surfaces.tsx` (`Stepper` compartido) — intacto, sigue
  usándose en `/carrito` y en la ficha.
- `src/views/shared/states.tsx` (`MenuSkeleton`) — intacto. No hizo falta
  reportar un desajuste: el esqueleto dibuja siempre el estado "sin línea en
  el carrito" (`size-11` circular en la esquina/borde), que es EXACTAMENTE lo
  que la tarjeta real muestra en su primer render — `lines` arranca en `[]`
  tanto en el servidor como en el cliente antes de que `useCart` hidrate desde
  `localStorage` (ver `CartProvider` en `lib/cart.tsx`), así que `quantity` es
  siempre 0 en el primer paint. El stepper solo aparece después de hidratar,
  si el carrito ya tenía esa línea — un crecimiento único y esperado, no un
  salto de layout contra el esqueleto.
- `src/lib/cart.tsx` — sin cambios, tal como pedía el slice.

## Acceptance criteria para `test-engineer` (mapeado a la petición del dueño del producto)

- **Con `needsOptions === false`** (sin grupos de opciones con `minSelect >
  0`): tocar el botón `Agregar {producto} al carrito` (cantidad 0) agrega una
  unidad al carrito Y el control se transforma en un grupo (`role="group"`,
  `aria-label` "Cantidad de {producto} en el carrito") con tres controles:
  botón `Quitar una unidad de {producto}`, un contador con `aria-live="polite"`
  mostrando `1`, y un botón `Agregar otra unidad de {producto}`.
- Tocar `Agregar otra unidad de {producto}` incrementa el contador visible en
  1 por click, hasta un máximo de 50 (a partir de ahí el botón queda
  `disabled`).
- Tocar `Quitar una unidad de {producto}` decrementa en 1; al llegar a 0 el
  grupo vuelve a mostrar solo el botón `Agregar {producto} al carrito`
  (cantidad 0) — la línea se eliminó del carrito.
- El estado del control refleja el carrito real: si se modifica la cantidad o
  se borra la línea desde `/carrito` (fuera de esta tarjeta) y se vuelve a la
  carta, la tarjeta del producto tiene que mostrar la cantidad actualizada sin
  ninguna acción adicional del usuario.
- Ninguno de los tres botones (agregar desde 0, incrementar, decrementar)
  navega a `/producto/{id}` — solo el nombre/foto/precio (el `<Link>`) navega.
- **Con `needsOptions === true`**: el control sigue siendo un `<Link
  aria-label="Ver opciones de {producto}">` a la ficha, sin importar cuántas
  unidades de ese producto ya haya en el carrito (no aplica el stepper en la
  tarjeta para este camino).
- Con `product.isAvailable === false` (agotado): no se renderiza ningún
  control de sumar (ni "+" ni stepper), en ninguna de las dos variantes.
