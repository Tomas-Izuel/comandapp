# Slice B — Producto y prueba

Agente: `frontend-react-craftsman`. Dueño exclusivo de `src/views/landing/included.tsx`,
`screens.tsx`, `delivery.tsx` y `edge.tsx`. No se tocó ningún otro archivo.

## Qué se construyó

### `included.tsx` → `WhatsIncluded()`

Lista densa de 16 ítems con `columns-1 sm:columns-2 lg:columns-3` (columnas CSS reales,
no un grid de tarjetas): cada `<li>` es un tilde (`Check`, `lucide-react`, color
`text-(--brand-ink)`) + texto, separado por `border-b`, sin caja ni sombra por ítem.
Es la forma explícita que pide `01-tasks.md` para evitar la plantilla
icono+título+texto que el piso de calidad prohíbe como estructura de sección.
`break-inside-avoid` en cada `<li>` evita que el tilde y el texto se corten entre
columnas.

Los 16 ítems salen literal de `PRODUCT.md` ("Capabilities and Constraints") y del
propio Slice B de `01-tasks.md` — no se agregó ni una capacidad que no esté confirmada
ahí. Se separaron "pago online" y "pago al retirar" en dos líneas porque son dos
hechos distintos (cada tienda decide si habilita el segundo).

### `screens.tsx` → `ThreeScreens()`

Grid de tres columnas (`grid-cols-1 lg:grid-cols-3`), cada una un `<figure>` con:
imagen (`next/image`, `width`/`height` explícitos del manifiesto — **no** `fill**,
porque cada captura tiene proporción intrínseca propia: dos retratos 720×1560 y una
apaisada 1920×1200, y forzarlas a un mismo `aspect-*` de `PhotoFrame` las recortaría),
seguida de `<figcaption>` con `who` como `<h3>`, `claim` como párrafo, y
`SCREENSHOT_CAPTION` como pie chico. El orden importa: la foto va primero y el
"quién" es el propio encabezado (no una etiqueta chica arriba de él), así que no se
reproduce el patrón kicker+título que el piso de calidad prohíbe sin excepción.

Capturas usadas: `pantalla-cliente.webp` (el que compra), `pantalla-cocina.webp` (el
mostrador), `pantalla-dueno.webp` (el dueño). `pantalla-seguimiento.webp` no es de
este slice y queda sin consumidor declarado — a verificar si algún otro slice la usa.

La sección lleva `bg-secondary/50` (no el navy de `--accent`, reservado por
`00-architecture.md` para la barra fija, el cierre y el precio) para que el único
tramo con evidencia visual real se lea como un momento aparte del texto que lo
rodea.

### `delivery.tsx` → `DeliverySection()`

Lista de 5 hechos (ícono en círculo `bg-primary/10 text-(--brand-ink)` + título +
descripción, en fila, sin caja) + la captura `pantalla-repartidor.webp` en la misma
composición `figure`/`figcaption` que `screens.tsx`, con su propio `SCREENSHOT_CAPTION`
— la regla del manifiesto ("toda captura lleva su epígrafe") es general, no solo para
las tres de `ThreeScreens`.

Los 5 hechos son exactamente los del brief: repartidores propios, tarifa plana sin
zonas, mínimo sobre el subtotal + envío gratis desde un monto, portal propio del
repartidor, y el ETA que se estira en vez de apagar el delivery
(`src/lib/delivery.ts`, `allCouriersBusy` nunca toca `available` — está descripto en
CLAUDE.md, "Delivery y repartidores").

No hay ningún monto real en esta sección (ni tarifa, ni mínimo, ni envío gratis
desde X pesos): son capacidades del producto, no datos de una tienda concreta, así
que poner un número habría sido inventar evidencia.

### `edge.tsx` → `WhatOnlyComandApp()`

Los dos diferenciadores de `PRODUCT.md` ("Positioning"), uno por columna
(`grid-cols-1 sm:grid-cols-2`), separados por un divisor de 1px (`sm:divide-x
sm:divide-border`) y no por tarjetas: son los dos hechos más importantes de la
página y encajonarlos los reduce a decoración. Cada bloque es un `<h3>` con un
ícono inline (`Timer`, `Webhook`) + un párrafo, sin fondo ni sombra propia.

No se inventó un tercer diferenciador. Se descartó agregar los "16 incluidos" o el
delivery como un tercer bloque: el brief es explícito en que son DOS.

## Decisiones no obvias

- **Ninguna captura usa `PhotoFrame`.** Esa primitiva fija la relación de aspecto
  para que la carta del storefront forme columna con fotos de celulares distintos;
  acá cada captura ya tiene una proporción intrínseca fija y conocida (del
  manifiesto), y forzarla a `square`/`wide`/`hero` la recortaría. Se usa
  `next/image` con `width`/`height` explícitos en un contenedor `rounded-(--radius)
  border overflow-hidden shadow-raise` en su lugar — mismo tratamiento visual
  (marco, borde, elevación) sin pisar la semántica de la primitiva.
- **`src` de las capturas es un string a `/landing/...`, no un `import` estático.**
  Un `import` de imagen falla el build si el archivo no existe todavía; un string
  a `public/` solo generaría un 404 en runtime si la imagen sigue faltando cuando
  se despliegue. El manifiesto avisa que las capturas las produce el hilo
  principal en paralelo, así que esto era necesario para no bloquear el slice.
- **Banda de fondo alternada.** `WhatsIncluded`, `DeliverySection` y
  `WhatOnlyComandApp` quedan en el fondo por defecto con un `border-t` como
  divisor; `ThreeScreens` lleva `bg-secondary/50` para diferenciarse como el
  tramo de prueba visual. Se evitó a propósito `bg-accent`/`text-accent-foreground`
  (el navy), reservado por la arquitectura para la barra fija, el cierre y el
  precio — usarlo acá hubiera competido con esas tres bandas por la misma señal.
- **`LucideIcon` como tipo para la tabla de datos de `delivery.tsx`.** Permite un
  array de `{icon, title, body}` tipado sin repetir la firma del componente a mano.
- **Los títulos de sección no llevan kicker.** Se verificó cada `SectionHeading`
  contra la regla dura: el título se sostiene solo, sin una etiqueta chica arriba.
  En `ThreeScreens`, el `who` de cada captura es el propio `<h3>` (no una etiqueta
  sobre un título más grande), así que tampoco reproduce el patrón dentro de cada
  tarjeta de captura.

## Contratos consumidos

- `src/lib/landing.ts`: `SCREENSHOT_CAPTION` y el tipo `Screenshot` (con sus campos
  `src`/`width`/`height`/`alt`/`who`/`claim`) en `screens.tsx` y `delivery.tsx`.
  No se tocó el archivo.
- `src/views/shared/surfaces.tsx`: `SectionHeading` en las cuatro secciones. No se
  agregó ninguna primitiva nueva a `surfaces.tsx` — no hizo falta.
- `[data-comandapp]` de `globals.css`: se leyeron los tokens (`--brand-ink`,
  `--content-max`, `--radius`, `bg-secondary`) tal como están, sin editarlos.

## Lo que se descartó

- Envolver cada ítem de `WhatsIncluded` en un `Panel` — sería exactamente la
  grilla de tarjetas que el brief prohíbe para esta sección.
- Agregar un tercer diferenciador en `edge.tsx` (por ejemplo, "sin bajar una app"
  o el delivery) — el brief pide los DOS de `PRODUCT.md`, ni uno más.
- Mencionar montos de delivery (tarifa, mínimo, envío gratis desde $X) en
  `delivery.tsx` — no hay una tienda real de referencia, y esta sección describe
  la capacidad del producto, no el precio de un local concreto.
- Usar `PhotoFrame` para las capturas (ver arriba).

## Problemas encontrados, fuera de este slice

- `npx tsc --noEmit` marca `src/app/page.tsx` con tres errores porque importa
  `@/views/landing/landing-bar`, `hero` y `versus` (Slice A), que todavía no
  existen en el árbol al momento de este slice. No es un problema de este slice;
  debería resolverse solo cuando el Slice A entregue esos archivos.
- Ningún consumidor declarado para `pantalla-seguimiento.webp` en el manifiesto de
  capturas — puede ser intencional (si Slice A la usa en `TodayVersus`) o puede ser
  una captura de sobra. A confirmar con el hilo principal.

## Verificación

- `npx tsc --noEmit`: sin errores propios de este slice (los tres reportados son de
  `src/app/page.tsx`, fuera de mi alcance).
- `npx eslint src/views/landing/included.tsx src/views/landing/screens.tsx
  src/views/landing/delivery.tsx src/views/landing/edge.tsx`: limpio.
- Hook de `impeccable` tras cada edición: sin hallazgos mecánicos en los cuatro
  archivos.
- Skills invocadas: `impeccable` (craft-floor.md, modo Persuade, vía
  `context.mjs --target src/views/landing/included.tsx`), `vercel-react-best-practices`,
  `frontend-design`, `web-design-guidelines`.

## Ronda de arreglos (post-integración, capturas reales)

El hilo principal entregó las capturas en `public/landing/` como `.png` (no
`.webp`) y actualizó las rutas en `screens.tsx` y `delivery.tsx`. Revisó el
render a 1440 y 390 y marcó dos defectos, los dos corregidos acá.

**1. `ThreeScreens` — grilla pareja con aspectos dispares.** Las tres columnas
iguales estiraban el celular (retrato, 720×1560) a lo alto y encogían el
tablero de cocina y el dashboard (apaisados, 1920×1200) hasta volverlos
ilegibles — justo las dos capturas donde hace falta distinguir una comanda o
una barra de un gráfico. Se rehizo como dos columnas de ancho DISTINTO
(`lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`, `items-start`): los retratos
angostos a la izquierda, los apaisados con el doble de ancho a la derecha, cada
columna apilando sus propias fotos con su propio epígrafe debajo. Sin una
grilla compartida forzando alturas iguales, los epígrafes ya no flotan a
alturas distintas — cada uno sigue directo a SU imagen.

Se sumó `pantalla-seguimiento.png` (720×1560, "Falta 18 min" + los pasos del
pedido) como cuarta captura, emparejada con `pantalla-cliente` en la columna de
celulares: completa el argumento de "nadie del local escribe un mensaje" con
la otra mitad de la historia (el cliente se entera solo de cuánto falta). El
nombre exportado sigue siendo `ThreeScreens` — lo fija el contrato de
`01-tasks.md` — aunque ahora muestre cuatro capturas; se dejó una nota en el
archivo para que no se lea como un descuido.

**2. `DeliverySection` — columna de texto flotando contra un celular gigante.**
Dos causas, las dos de mi layout: `items-center` centraba verticalmente la
lista de 5 hechos contra una imagen mucho más alta (dejaba el hueco arriba de
la lista), y la captura ocupaba `0.9fr` de `--content-max` en vez de un ancho
propio — a ese fr un retrato de 720×1560 se renderizaba a más de mil píxeles
de alto. Cambiado a `lg:grid-cols-[1fr_auto] lg:items-start` con la figura
acotada a `max-w-64` (16rem, tamaño de mockup de celular, no una fracción del
grid): ahora acompaña al texto en vez de dominarlo, y las dos columnas
arrancan alineadas arriba. De paso, el cuerpo de cada hecho quedó con
`max-w-[48ch]` para que la medida de línea no se estire sin sentido en la
columna ahora más ancha.

Verificación tras el arreglo: `npx tsc --noEmit` y `npx eslint
src/views/landing/{included,screens,delivery,edge}.tsx` limpios, sin tocar
ningún archivo fuera de los cuatro de este slice.

### Segunda pasada — el reparto en dos columnas dejaba un hueco

Las dos columnas de ancho distinto arreglaban la legibilidad pero generaban un
desbalance nuevo: dos retratos apilados (cliente + seguimiento, ~1860px de
alto a ese ancho) salen más altos que dos apaisados apilados (cocina + dueño,
~1150px), así que quedaba casi un cuarto de sección en blanco abajo a la
derecha. Se pasó a una grilla 2×2 real: mismas dos columnas (angosta/retrato,
ancha/apaisado ×2) pero CUATRO celdas con `items-center`, una fila por par —
comprador+cocina arriba, seguimiento+dueño abajo. `grid-auto-flow` en su
default ubica las cuatro solo con un único array ordenado
(`SCREENS`); el apaisado, más bajo, queda centrado contra el retrato de su
misma fila en vez de acumular el sobrante al final de toda la composición. En
mobile (una columna) el orden de ese mismo array es el recorrido natural:
compra → cocina lo ve → el cliente espera → el dueño factura.
`npx tsc --noEmit` y el mismo `eslint` de arriba, limpios otra vez.

## Para el test engineer

No hay estado, no hay Server Actions, no hay formularios: las cuatro secciones son
contenido estático puro, sin `'use client'` y sin datos que fetchear. Lo verificable
por superficie de usuario:

- `WhatsIncluded`: los 16 ítems de la lista son visibles y accesibles como texto
  (no dependen de hover ni de JS) — se puede buscar cada string literal en el DOM
  renderizado.
- `ThreeScreens`: las CUATRO `<figure>` (tras la ronda de arreglos: celular,
  seguimiento, cocina, dueño) tienen `alt` descriptivo y no vacío en cada
  `<img>`, y el texto `SCREENSHOT_CAPTION` (`"Captura real del producto · datos de
  demostración"`) aparece exactamente cuatro veces en la sección.
- `DeliverySection`: los 5 hechos de delivery son texto plano buscable; el
  `SCREENSHOT_CAPTION` aparece una vez más acá (además de las cuatro de
  `ThreeScreens`, total 5 en la página).
- `WhatOnlyComandApp`: los dos `<h3>` son buscables por su texto exacto
  ("El tiempo de espera se mueve con la cocina real", "El pedido sale por eventos
  hacia tu sistema"); no hay un tercer bloque.
- Ningún elemento de estas cuatro secciones requiere foco de teclado o rol ARIA
  especial: son `<section>`/`<figure>`/`<ul>`/`<li>` semánticos sin controles
  interactivos.
