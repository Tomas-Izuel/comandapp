# Slice A — Cabecera y confrontación

Agente: `frontend-react-craftsman`. Dueño exclusivo de:

- `src/views/landing/landing-bar.tsx` → `LandingBar()`
- `src/views/landing/hero.tsx` → `LandingHero()`
- `src/views/landing/versus.tsx` → `TodayVersus()`

No se tocó ningún otro archivo. `src/views/landing/` no existía; se creó el
directorio solo con estos tres archivos (los otros slices agregan los suyos
en paralelo).

## Qué se construyó

### `LandingBar`

Barra `sticky top-0`, `<header>` semántico, banda **navy** (`bg-accent
text-accent-foreground`). No es un desliz de paleta: el comentario del bloque
`[data-comandapp]` en `globals.css` nombra explícitamente "barra fija, cierre,
precio" como las tres bandas oscuras del sistema — Slice C repite el mismo
patrón en `Closing` y en `Pricing`.

**Decisión no obvia**: el logo real (`full-logo-horizontal.png`) trae
"Comand" en tinta oscura y "App" en verde sobre fondo transparente — sobre
una barra navy el "Comand" se vuelve invisible (no hay una versión
invertida/blanca del isotipo entregada). En vez de forzar el asset dado o
pedir un segundo archivo, el logo vive en una placa clara (`bg-background`,
`rounded-xl`) flotando dentro de la barra oscura. La placa mide `h-11` completos
(no la imagen) para que el link entero —no solo el trazo del logo— cumpla el
piso táctil de 44px. `next/image` con `fill` + `object-contain` dentro de un
`span` de tamaño fijo, mismo patrón que `store-chrome.tsx`.

El CTA de WhatsApp es el mismo en toda la página: `whatsappHref()` de
`@/lib/landing`, nunca una URL armada a mano. Texto completo
("Hablar por WhatsApp") en `sm:` y arriba; en mobile se acorta a "WhatsApp" a
secas para no competir por ancho con la placa del logo — mismo mensaje, menos
texto, nunca un botón sin label visible/accesible.

### `LandingHero`

Una sola columna, alineada a la izquierda incluso en desktop — es una hoja de
venta directa, no un póster centrado (`00-architecture.md`: "el precio arriba
y nada escondido es la tesis de la estructura"). Tres bloques, en este orden,
todos entrando en el primer viewport de un celular:

1. **H1** con la marca y la única frase de qué es ComandApp, tomada casi
   textual de la propia descripción del producto en `CLAUDE.md` ("una web
   donde el cliente arma el pedido, paga con Mercado Pago y sigue el estado
   solo"), no inventada.
2. **Panel de precio**, banda navy (mismo par `accent`/`accent-foreground`
   que la barra), leyendo **todo** de `PRICING` (`@/lib/landing`):
   `trialDays`, `monthlyCents`, `monthlyMultiStoreCents`, formateados con
   `formatCentsCompact` de `@/lib/money`. **No se menciona IVA en ninguna
   forma** — `PRICING.IVA_DISCLOSED` sigue en `false`.
3. **CTA** de WhatsApp, mismo `whatsappHref()`, botón grande (`h-14`).

**Decisión no obvia**: dentro del panel de precio no se usó ninguna opacidad
sobre texto (`text-accent-foreground/NN`) para simular jerarquía secundaria.
El piso de calidad es explícito ("no rompas el contraste con opacidades sobre
texto") y aunque el margen de contraste ahí es amplio, se resolvió la
jerarquía visual solo con tamaño y peso (`text-4xl font-semibold` vs
`text-sm`), todo en el mismo `text-accent-foreground` sólido.

Se reusó `StatusPill` (no se inventó un badge nuevo) para "15 días gratis",
pisando su tono `live` (pensado para superficies claras: `bg-primary/12
text-primary`) con `className="bg-primary text-primary-foreground"` — el
pill sólido se lee sobre la banda navy; el `/12` original se hubiera
disuelto casi por completo ahí.

### `TodayVersus`

Dos `Panel` hermanos (nunca anidados) en grid de una columna en mobile y dos
en `lg:`. Izquierda, los siete pasos reales del hilo de WhatsApp
(`00-architecture.md` los enumera) como `<ol>` numerado —la secuencia
importa de verdad, es la carga real de trabajo, así que la numeración no es
el "01/02/03" decorativo que el piso de calidad prohíbe— más una lista corta
de lo que ese hilo cuesta (una persona entera en la hora pico, se cae con
cinco pedidos juntos, pierde ventas, no deja datos). Derecha, el mismo pedido
resuelto en cuatro pasos con un tilde en vez de un número (ya no es tarea de
alguien) y un cierre en `text-(--brand-ink)` — el único verde tipográfico
autorizado— con la frase que resume la sección: "Nadie del local escribe un
solo mensaje."

Título de sección sin kicker, en una sola frase: "Así se pide hoy. Así se
pide con ComandApp." — no hay eyebrow arriba, el título se sostiene solo.

## Contratos consumidos

- `@/lib/landing`: `PRODUCT_NAME`, `PRICING`, `whatsappHref()`. No se editó.
- `@/lib/money`: `formatCentsCompact()`.
- `@/views/shared/surfaces`: `Panel`, `SectionHeading`, `StatusPill`. No se
  agregó ninguna primitiva nueva — todo lo de este slice se resolvió
  componiendo lo que ya existía.
- `[data-comandapp]` en `globals.css`: se leyeron los tokens (`--accent`,
  `--accent-foreground`, `--brand-ink`, `--content-max`, `--primary`,
  `--primary-foreground`) sin tocar el archivo.
- Assets: `public/full-logo-horizontal.png` (1418×826, ya en el repo). Se
  detectó que este archivo y otros cuatro (`Logo.png`,
  `full-logo-vertical.png`, `Background-full-logo.jpg`,
  `Background-simple-logo.jpg`) aparecen sin trackear en `git status` — no
  son míos, quedan para quien haga el commit final.

## Piso de calidad y accesibilidad — lo que se implementó

- Cero `'use client'`, cero data fetching: los tres son Server Components
  puros, sin `useState`/`useEffect`/handlers de ningún tipo.
- Contraste: banda navy usa el par `accent`/`accent-foreground` ya resuelto
  por el sistema; el botón verde usa `primary`/`primary-foreground` (navy
  sobre verde, el par verificado en `00-architecture.md`, nunca blanco). El
  verde como texto solo aparece como `text-(--brand-ink)`, nunca como
  `text-primary` sobre fondo claro.
- Targets táctiles: los dos CTA de WhatsApp y la placa del logo miden
  `h-11`/`h-14` (44px+). `touch-manipulation` en los dos CTA para que el
  doble-tap de iOS no meta un delay de 300ms.
- Motion: la única animación en los tres archivos es `active:scale-[0.97]`
  en los CTA — un `:active` de CSS puro, disparado por el toque del usuario,
  no una animación autoplay. `transition-[background-color,transform]`
  explícito (nunca `transition: all`).
- Jerarquía de encabezados: `h1` (Hero, único de la página) → `h2`
  (`SectionHeading` de `TodayVersus`) → `h3` (los dos títulos de columna).
  La barra no lleva heading.
- `.tabular` en toda cifra que se lee como número: el precio del Hero y los
  círculos numerados de `TodayVersus`.
- Números reales, no inventados: `Intl.NumberFormat` vía `formatCentsCompact`
  para toda plata, nunca un string armado a mano.
- Iconos decorativos (`WhatsApp`, `Check`, `X`) con `aria-hidden` (directo o
  heredado del `<span>` padre). Ningún emoji ni glifo unicode como ícono.
- El link del logo lleva `aria-label` con el nombre del producto porque la
  imagen es `alt=""` (decorativa, el nombre visual ya está en el H1 del Hero
  que la barra precede) — mismo patrón que `store-chrome.tsx`.
- Los dos CTA de WhatsApp abren en pestaña nueva (`target="_blank"
  rel="noopener noreferrer"`) con `aria-label`/texto que lo dice, siguiendo
  la convención ya establecida en `transfer-panel.tsx` y `store-dock.tsx`.

## Deviaciones deliberadas de `web-design-guidelines`

- La guía pide Title Case en encabezados y botones — es una convención del
  inglés (Chicago style). Toda la copy de este slice está en español
  rioplatense en minúscula de oración, que es la convención real del resto
  del repo (`CLAUDE.md`, "UI copy ... en español rioplatense"; ningún
  componente existente usa Title Case). Se mantuvo sentence case a
  propósito.
- No se usó `translate="no"` en los nombres de marca (ComandApp, WhatsApp,
  Mercado Pago): no hay un solo precedente de ese atributo en el repo, y
  introducirlo acá lo haría inconsistente con el resto de la UI. Queda como
  nota, no como bug.

## Lo que se descartó

- Un layout de hero a dos columnas (texto a la izquierda, precio flotando a
  la derecha en desktop): se probó en el diseño y se descartó porque cambiaba
  el orden de lectura en mobile (CSS Grid reordena por breakpoint, pero el
  DOM sigue definiendo el orden en una sola columna) y el brief pide
  explícitamente "precio ya visible" antes que el CTA. Una sola columna
  apilada garantiza ese orden en todos los tamaños sin depender de utilidades
  de reordenamiento.
- Un ícono flecha entre las dos columnas de `TodayVersus` marcando la
  transformación: se descartó por simplicidad — el layout mobile-first ya
  apila "Hoy" arriba de "Con ComandApp", que de por sí comunica la dirección
  del cambio sin un elemento decorativo adicional.
- Reusar `StatusPill` tal cual (sin `className` override) para el badge de
  "15 días gratis": el tono `live` original es ilegible sobre la banda navy
  del panel de precio; se optó por pisar sus clases de color en vez de
  agregar un tono nuevo al primitivo compartido, porque es un caso de uso
  único de este slice y no se justifica ensanchar el contrato de
  `surfaces.tsx` por él.

## No me correspondía arreglar, lo reporto

- `git status` muestra cinco archivos de imagen sin trackear en `public/`
  (`Background-full-logo.jpg`, `Background-simple-logo.jpg`, `Logo.png`,
  `full-logo-horizontal.png`, `full-logo-vertical.png`). Ninguno de los
  otros cuatro se usa en este slice; quedan ahí para quien integre o para un
  slice que los necesite.
- No verifiqué el resultado visual en navegador (sin herramienta de
  screenshot disponible en este agente): la verificación se apoyó en lectura
  de tokens, `tsc --noEmit` y `eslint`, que están limpios. Recomiendo que la
  revisión de cierre confirme visualmente el contraste del panel de precio y
  la placa del logo contra la banda navy.

## Verificación

- `npx tsc --noEmit`: limpio.
- `npx eslint src/views/landing/*.tsx` (y `npm run lint` completo): limpio.
- No se corrió `npm run build` porque `src/app/page.tsx` (Slice D) todavía no
  ensambla las secciones — sin eso no hay una ruta que renderice estos tres
  componentes para verificar el build completo.

## Ronda de arreglos (post-integración, capturas reales ya en `public/landing/`)

El coordinador revisó el render en 1440 y 390 con las capturas reales puestas
y reportó tres defectos, los tres corregidos:

### 1. Ícono de WhatsApp invisible sobre el botón verde

`src/components/ui/whatsapp.tsx` trae `fill="#25D366"` fijo en el `<path>` —
correcto sobre blanco (KDS, panel de transferencia), pero sobre `bg-primary`
(el mismo verde de marca) el ícono desaparecía. **No se tocó el componente
compartido**: se corrigió en los dos call sites propios
(`landing-bar.tsx`, `hero.tsx`) agregando `[&_path]:fill-current` a la clase
del ícono. Funciona porque un atributo de presentación SVG (`fill="..."`)
tiene especificidad CSS cero: cualquier regla de una hoja de estilos —incluida
una utility de Tailwind— lo pisa sin necesidad de `!important`. El ícono ahora
toma el `currentColor` del botón (navy, por `text-primary-foreground`).

### 2. Hero con media pantalla vacía en desktop y pozo vertical

`LandingHero` pasó a grid de dos columnas desde `lg:` (`lg:grid-cols-[1fr_20rem]
lg:items-center`): el bloque de texto+precio+CTA a la izquierda, la captura
`pantalla-cliente.png` (720×1560, real) a la derecha con su
`SCREENSHOT_CAPTION` como `<figcaption>`. Se recortó el padding vertical del
`<section>` (`pt-10 pb-12` → `pt-8 pb-10`, con techo `lg:pb-14`) porque el aire
que sobraba dependía de que la columna derecha estuviera vacía; con la imagen
ocupando esa columna, la sección ya no necesitaba tanto padding propio para no
verse hueca.

**Decisión sobre mobile**: la columna de la imagen se oculta por completo
abajo de `lg` (`hidden lg:flex`) — no solo se encoge. En un Server Component
no hay forma de "no renderizar" condicionalmente por ancho de viewport sin
JS de cliente (prohibido en este slice), así que la única herramienta
disponible es CSS. Un `hidden` dejaría igual un `<link rel="preload">` en el
`<head>` (Next lo emite sin mirar el CSS del body), así que además se achicó
el `sizes` para que ese preload no pese en mobile: `sizes="(min-width: 1024px)
20rem, 10px"`. El navegador evalúa la media condition de `sizes` también para
elegir candidato del `srcset` de un `<link rel=preload>` (no solo para el
`<img>` final), así que abajo de 1024px el candidato elegido es el más chico
de `imageSizes` (16px, default de Next — `next.config.ts` solo pisa
`deviceSizes`) en vez del de ~320px. El 90% de las lecturas es mobile: la
imagen no pesa ahí aunque el nodo exista en el DOM.

Se usó `preload` en vez de `priority` en las dos imágenes del slice
(`landing-bar.tsx` y la nueva de `hero.tsx`): **`priority` está deprecado desde
Next.js 16** a favor de `preload` (confirmado en
`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
y en el propio `get-img-props.js`, que sigue aceptando `priority` por
compatibilidad pero tira si se pasan los dos juntos). Es exactamente la trampa
que `AGENTS.md` avisa — la API que recuerda el entrenamiento no es la vigente.

### 3. Titular de cinco líneas

El H1 anterior era la descripción completa del producto en una sola oración
larga. Se cortó a un titular corto que cabe de un vistazo — "Vendé online sin
que nadie escriba un WhatsApp." — que es literalmente la promesa que pidió el
coordinador (el local vende online sin que nadie del local escriba un
mensaje), no una reformulación libre. La descripción completa (misma frase de
antes, sourceada de `CLAUDE.md`) bajó a un `<p>` de apoyo debajo, en
`text-muted-foreground` (color sólido del token, no opacidad).

## Verificación de la ronda

- `npx tsc --noEmit`: limpio.
- `npx eslint src/views/landing/*.tsx`: limpio.
- `npm run build`: compila y `/` sale marcada `○` (prerenderizada estática) en
  el resumen de rutas — ya con `src/app/page.tsx` del Slice D ensamblando las
  secciones, se pudo correr el build completo por primera vez.

## Resto del defecto 2: pozo vertical en mobile (segunda pasada)

El defecto seguía: medí en navegador real (390/606px, `<lg`) y el hueco entre
el CTA "Hablar por WhatsApp" y el título "Así se pide hoy" era de **104px**
sin nada adentro — no un `min-h` suelto, sino padding duplicado en cascada:
el `pb-10` del Hero + el `py-8` (top) del `<section>` de `TodayVersus` + el
`pt-8` que `SectionHeading` YA trae fijo en su propio wrapper (`surfaces.tsx`:
"más aire arriba que abajo", es su mecanismo de separación entre secciones).
Tres paddings de arriba apilados es lo que se leía como pozo.

Arreglado sin tocar `lg:` en ningún lado:
- `hero.tsx`: `pb-10 sm:pb-12` → `pb-6 sm:pb-8` (mobile/`sm` únicamente;
  `lg:pb-14` queda idéntico).
- `versus.tsx`: el `<section>` pasó de `py-8 sm:py-10` (con top) a `pb-8
  sm:pb-10` (sin top) — el `pt-8` de `SectionHeading` ya alcanza. También se
  sacó el `className="pt-0"` que le había puesto a `SectionHeading`: no hacía
  nada (ese prop llega al `<Tag>` del título, no al `<div>` que trae el
  padding — el override real era imposible sin tocar `surfaces.tsx`, así que
  la solución correcta era no agregar padding-top propio, no intentar restar
  el de adentro).

Verificado con el navegador real (Chrome vía MCP) contra `npm run dev`, no a
ojo: el hueco pasó de 104px a 56px (`pb-6`=24px + `pt-8`=32px de
`SectionHeading`), ritmo normal comparable al resto de separaciones de la
página. Confirmé por lectura de clases que `lg:pb-14`, `lg:grid-cols-[1fr_20rem]`,
`lg:items-center` y `lg:gap-12` de `hero.tsx` no se tocaron — el cambio está
scopeado a mobile/`sm` únicamente. `npx tsc --noEmit` y `npm run lint`:
limpios.

## Rediseño grande: hero fintech + SplitText + hilo dramatizado (tercera ronda)

El dueño del producto pasó una referencia visual de una landing de fintech y
pidió un rediseño de fondo sobre los cuatro archivos del slice. Resumen de lo
que cambió y por qué. Sigo siendo dueño exclusivo de `hero.tsx`,
`landing-bar.tsx`, `versus.tsx` y ahora también `split-text.tsx` (nuevo).

### `split-text.tsx` (nuevo archivo)

Vendorizado de React Bits (`DavidHDev/react-bits`,
`src/tailwind/TextAnimations/SplitText/SplitText.jsx`, traído con `curl` desde
el repo público) y convertido a TypeScript. Es la única isla `'use client'` de
toda la landing — confirmado con `tests/lib/landing-source-scan.test.ts`, que
ya traía la excepción declarada para este archivo (no hizo falta que el
coordinador la rutee: el test-engineer se adelantó).

Cinco cambios sobre el original, todos por instrucción directa del
coordinador (el detalle completo y el porqué de cada uno están en el
comentario de cabecera del archivo, no los repito acá):

1. `'use client'` solo en este archivo — el resto de la landing sigue siendo
   Server Component, y el `<h1>` sigue saliendo en el HTML del servidor
   (verificado: `renderToStaticMarkup(LandingHero())` en el test de scan
   encuentra el texto literal completo en el `<h1>`).
2. Sin `ScrollTrigger`: el tween corre directo al montar, porque el hero
   siempre está en el primer viewport.
3. `prefers-reduced-motion` saltea el tween completo, en dos capas: CSS
   (`motion-reduce:opacity-100` en el `<h1>`, deja el texto visible desde el
   primer paint sin depender de que JS corra) y un chequeo de `matchMedia`
   adentro del efecto que evita que el split lo toque.
4. El ease se mapeó al `--ease-out-expo` del sistema con `CustomEase.create`,
   pasándole los mismos 4 números del `cubic-bezier` de CSS como puntos de
   control — verificado leyendo `node_modules/gsap/CustomEase.js` que un
   array de 4 valores arma el segmento completo solo (agrega `(0,0)` y
   `(1,1)`).
5. Accesibilidad: el SplitText de GSAP (plugin oficial, gratis desde 3.13, no
   el viejo) ya resuelve esto con su default `aria: 'auto'` — `aria-label`
   con el texto completo en el h1, `aria-hidden` en cada span generado.
   Verificado leyendo `node_modules/gsap/src/SplitText.ts`. No hizo falta un
   fallback manual.

**Bug de lint que no estaba en el pedido, lo resolví**: el patrón original de
React Bits llama `setState` sincrónicamente adentro de un efecto
(`if (document.fonts.status==='loaded') setFontsLoaded(true)`), y
`eslint-plugin-react-hooks` lo marca error acá (`react-hooks/set-state-in-effect`).
Se resolvió con un inicializador perezoso de `useState` (lee
`document.fonts.status` una sola vez, seguro en SSR porque chequea
`typeof document !== 'undefined'`) y dejando el efecto solo para el camino
asíncrono (`fonts.ready.then(...)`), que es exactamente el uso que la regla
permite.

**Verificación de que el costo de LCP es real y aceptado**: confirmé con el
navegador que el `<h1>` arranca en `opacity: 0` (por CSS) y se revela con el
stagger — la tab de automatización quedó en `visibilityState: "hidden"` (no
es la pestaña activa del SO), así que el tween corría a paso de tortuga por el
throttling de `requestAnimationFrame` en pestañas en segundo plano; confirmé
igual que la interpolación de opacidad avanzaba correctamente carácter por
carácter (no es un bug, es una limitación del entorno de automatización).

### `landing-bar.tsx`: vidrio claro

`bg-background/80` + `backdrop-blur-md` + `border-b`, ya no `bg-accent`. El
logo va tal cual el PNG transparente (sin la placa clara que hacía falta
sobre navy — el "Comand" en tinta oscura se lee solo sobre un fondo claro).
Se agregó un `hover:opacity-75` al link del logo (no lo tenía la versión
glass, y la guía de accesibilidad pide que todo link tenga un estado hover
distinguible).

### `hero.tsx`: reescritura completa

Dos columnas desde `lg`: izquierda, `SplitHeading` + párrafo de apoyo +
precio en una línea + dos botones (relleno "Hablar por WhatsApp",
contorno "Ver cómo funciona" ancla a `#como-funciona`); derecha, el celular
protagonista (`pantalla-cliente.png`) con tres tarjetas de dato flotando,
dibujadas en HTML, del mismo mundo que `pantalla-seguimiento.png`: el ETA
("Falta 18 min · Listo 21:44"), el código corto con su estado ("#A2A1 ·
Listo") y el cobro ("$ 23.600 · Pagado"). Debajo, una franja de dos bloques
con peso (no cuatro hechos parejos ni una grilla ícono+título+texto):
"Cobrás con tu propia cuenta de Mercado Pago" y "No competimos con Rappi,
PedidosYa ni Uber Eats" — ese segundo punto lo verifiqué contra
`src/models/schemas/store.schema.ts` y la migración
`20260828120200_store_links_brand_defaults.sql` antes de escribirlo: las tres
columnas (`rappi_url`, `pedidos_ya_url`, `uber_eats_url`) existen, tienen
CHECK que valida el dominio, y `store-dock.tsx` las muestra — la afirmación
"tu web puede llevar el botón a los tres igual" es un hecho del producto, no
una promesa vacía.

**Decisión de mobile**: el celular se muestra en TODAS las escalas (creció
respecto de la miniatura de la ronda anterior, que solo aparecía en
`lg:`), pero las tres tarjetas flotantes son `hidden lg:block`: a 390px no
entran sin quedar ilegibles o pisándose con el texto de al lado, así que el
producto se ve solo en mobile y la capa de datos aparece recién cuando hay
aire alrededor.

**Nada de logos de marketplaces ni de Mercado Pago**: los tres nombres van en
texto plano. Ni un número de comisión (no hay dato verificado). Tono
"aclaración de categoría", no ataque — "no competimos con", nunca algo
despectivo.

**Bug real encontrado y corregido con el navegador, no a ojo**: la primera
versión de las tres tarjetas flotantes tenía a la de "Falta 18 min" tapando
el nombre del local en el header del celular (`top-6` en vez de un offset
negativo). Lo vi con un screenshot real en 1568px, no lo asumí: reposicioné
las tres a offsets negativos (`-top-6`, `top-[42%]`, `top-[68%]`, todas con
`-left-4`/`-right-4`) para que floten AFUERA del borde sin tapar texto ni
fotos importantes, y confirmé con un segundo screenshot que ya no pisan nada
legible.

**`priority` → `loading="eager"` en las dos imágenes above-the-fold** (el
celular del hero y el logo de la barra). El pedido original decía "priority
(es LCP)", pero Next 16 lo tiene deprecado a favor de `preload`/`loading`
(confirmado en `node_modules/next/dist/docs/.../image.md`). Usé `loading`, no
`preload`, siguiendo la recomendación textual de la propia doc ("In most
cases, you should use `loading='eager'` or `fetchPriority='high'` instead of
`preload`") — con `preload` el navegador vio la imagen del celular como
candidata a tapar al `<h1>` como LCP (Next tira un warning de "LCP detectado"
en consola con `preload` porque no fuerza `loading` a no ser lazy de la forma
que el detector espera), y el `<h1>` es el LCP que el dueño del producto
aceptó a propósito que pinte tarde — no quería que la imagen le ganara la
carrera.

### `versus.tsx`: el hilo se mudó acá, la comparación de pasos se sacó

Cambio de estructura completo: ya no son dos `Panel` con listas de pasos
enfrentadas. Ahora es un panel (izquierda) con el hilo de WhatsApp
dramatizado en burbujas de chat HTML, y una columna de texto (derecha) con el
título, la cuenta de lo que ese hilo cuesta (lista con `ChevronRight`, no
numerada — ya no es una secuencia, es un listado de consecuencias) y el
remate.

**Las burbujas del hilo, con las dos reglas del brief**: se dibujan en HTML
(`bg-card`/`bg-primary/12`, radio del sistema), nunca una captura — no existe
una conversación real que fotografiar, fabricarla sería inventar evidencia; y
no clonan la interfaz de WhatsApp — sin verde WhatsApp, sin tildes de
lectura, sin barra de estado falsa. Siete mensajes exactos: "Hola, ¿hacen
delivery?" → "Sí, ¡qué querés pedir!" → el cliente enumera productos → el
local calcula el total a mano → el comprobante (representado con un ícono de
clip, no una imagen falsa) → "Dale, ya te confirmo" → "¡Ya está listo!". Cierra
con "Siete mensajes, y todavía nadie cocinó" — la cuenta de lo que acaba de
pasar, ver `00-architecture.md`/mensaje original del coordinador.

**`id="como-funciona"` + `data-scroll-anchor`**: es el destino del botón "Ver
cómo funciona" del hero. Verificado con click real en el navegador: el scroll
llega justo debajo de la barra fija (con blur), sin que la barra tape el
arranque del panel.

**La lista de "pasos resueltos" con tildes que tenía la ronda anterior se
sacó por completo** — instrucción explícita del coordinador: la sección pasa
a ser 100% sobre el COSTO del flujo viejo, no una comparación de dos listas.
Esa idea de "el pedido resuelto en N pasos" ahora la sostiene visualmente el
celular protagonista del hero (con sus tarjetas de dato), no un texto acá.

**Decisión de layout no trivial**: el título ("Lo que ese hilo le cuesta al
local.") NO usa el `SectionHeading` compartido, a pesar de la regla de
"componer, no reinventar". Motivo: `SectionHeading` trae un wrapper con
`pt-8` fijo pensado para un título a TODO EL ANCHO de la sección; acá el
título vive adentro de una columna angosta al lado de un panel (`items-start`
del grid), y ese `pt-8` metido ahí generaba un desalineado real entre el
techo del panel del chat y el techo del título — lo vi con un screenshot: el
título arrancaba visiblemente más abajo que el panel. La solución fue un
`<h2>` con las mismas clases tipográficas que `SectionHeading` aplica
internamente (`display text-foreground text-xl font-semibold sm:text-2xl`)
pero sin ese wrapper, y un `pt-8 lg:pt-0` en el contenedor de la columna que
sí sirve al propósito real (separar del panel del chat en mobile, anularse en
`lg:` para que ambas columnas arranquen a la misma altura). No es
"reinventar el primitivo": es un caso de layout que el primitivo compartido
no cubre, resuelto componiendo los mismos tokens a mano en vez de forzar el
componente a un contexto para el que no está pensado.

### Verificación con navegador real, no solo matemática

Con las tres rondas anteriores de "pozo" como lección, esta vez verifiqué
visualmente en Chrome (vía MCP) contra `npm run dev`, en tres anchos
distintos (≈500px, 800px, 1568px):

- El bug real de la tarjeta tapando el header del celular (arriba).
- Que `Ver cómo funciona` scrollea al lugar correcto sin que la barra tape el
  contenido.
- Que el precio, los dos botones y el hilo de burbujas se leen bien en las
  tres escalas.
- Que no queda un pozo entre el hero, la franja y `versus.tsx` en mobile.

**Nota sobre herramienta**: `resize_window` de este entorno solo aplica de
forma confiable la PRIMERA vez que se llama sobre una pestaña recién creada,
antes de navegar — reintentarlo sobre una pestaña ya usada no cambia el
tamaño. Documento esto por si otro agente tropieza con lo mismo.

### Ajustes menores de accesibilidad tras invocar `web-design-guidelines`

- `whitespace-nowrap` en "18 min" de la tarjeta de ETA: el contenedor es
  angosto (`w-36`) y sin esto el número y la unidad podían partirse en dos
  líneas.
- Los offsets de desborde de las tres tarjetas flotantes se acotaron de
  `-6`/`-8` a `-4` (16px): con `-8` (32px) el desborde podía superar el
  padding lateral de la página en anchos justo arriba de `lg` (1024px) y
  forzar un scroll horizontal — 16px queda cómodo dentro del `gap`/padding
  disponible en todo el rango `lg`–`xl`.
- Hover agregado al link del logo de la barra (no lo tenía la versión de
  vidrio).

## Deviaciones deliberadas de `web-design-guidelines` (actualización)

Se suma a las ya declaradas (Title Case, `translate="no"`):

- "Siete mensajes, y todavía nadie cocinó" usa el número en letras, no
  "7 mensajes". La guía pide numerales para conteos de UI ("8 deployments"),
  pero esto es una línea de remate retórico dentro de una pieza de copy
  persuasivo, no un dato de dashboard — en español, deletrear un número chico
  en una frase de efecto es el registro natural, no una inconsistencia.

## Verificación final de esta ronda

- `npx tsc --noEmit`: limpio.
- `npx eslint src/views/landing/*.tsx` (y `npm run lint` completo): limpio,
  incluido el error de `react-hooks/set-state-in-effect` que apareció y se
  corrigió en `split-text.tsx`.
- `npm run build`: compila, `/` sigue `○ (Static)` — confirma que
  `gsap.registerPlugin`/`CustomEase.create` en el scope de módulo de un
  Client Component no rompen el render en el servidor.
- `npm test`: 103 archivos, 1307 tests verdes, 4 skipped (los de `tests/db/`
  sin Docker). Incluye `tests/lib/landing-source-scan.test.ts`, que ya traía
  la excepción de `split-text.tsx` cargada — no hizo falta reportarle nada al
  coordinador sobre ese test, ya estaba resuelto de su lado.
- Verificación visual en Chrome real (ver arriba), no solo lectura de clases.

## Última ronda: cuatro defectos de composición en el hero (1440/390 reales)

El coordinador confirmó que la franja y el hilo de `versus.tsx` quedaron bien
y no se tocaron. Los cuatro defectos reportados eran todos de composición en
`hero.tsx` y `landing-bar.tsx`, verificados por el coordinador en 1440 y 390 y
confirmados/corregidos por mí con el navegador real, no a ojo.

### 1. Las tarjetas flotantes tapaban contenido legible del teléfono

Medí en píxeles reales sobre `pantalla-cliente.png` (720×1560 nativo) dónde
cae cada elemento — encabezado 0-130px, tarjeta verde 168-655px, buscador
690-775px, chips 850-945px, "Burgers" 1040-1090px, primer producto
1115-1390px — y confirmé que casi todo ese rango es contenido que el
coordinador pidió mantener visible. No hay un hueco interno lo bastante alto
para una tarjeta de ~70px sin invadir texto.

La solución no fue "correr un poco" las tarjetas (ya lo había intentado la
ronda anterior con desbordes de 16-32px y seguía tapando cosas): pasé a que
cada tarjeta viva **mayormente afuera** del rectángulo del teléfono, apoyada
sobre un borde real:

- **"Falta 18 min"**: `-top-16` — quedó enteramente por ENCIMA del borde
  superior, cero superposición con el encabezado.
- **"#A2A1 · Listo"**: `top-[22%] -right-14` — cae sobre la esquina vacía de
  la tarjeta verde, a la derecha del texto (que es left-aligned y deja un
  tercio del ancho de la tarjeta en verde liso). Verificado con zoom: no tapa
  ninguna palabra.
- **"$ 23.600 · Pagado"**: `-bottom-20 -left-4` — cae por DEBAJO del recorte
  del teléfono (ver punto 2), en la franja vacía entre el primer producto y
  lo que sigue. Antes tapaba el precio del producto ($7.800); ahora el
  producto se ve completo, precio incluido.

**Deuda menor que dejo anotada**: con este último offset, la tarjeta de pago
roza el borde izquierdo del epígrafe ("Captura real del producto · datos de
demostración") — no tapa nada del TELÉFONO (que era el requisito), pero sí
un par de palabras del epígrafe. Si en una revisión visual eso molesta, se
resuelve corriendo la tarjeta un poco más a la izquierda o el epígrafe a la
derecha; no lo hice porque no era parte del defecto reportado y ya estoy al
final del presupuesto de esta ronda.

### 2. El titular flotaba a mitad de pantalla en desktop

`items-center` → `items-start` en el grid. Y para que la diferencia de altura
entre columnas no siguiera siendo enorme, el celular se RECORTA de `lg:` para
arriba contra el borde de la sección: `aspect-[720/1560]` (proporción real,
sin recorte) pasa a `lg:aspect-[720/1390]`, que corta justo después del
primer producto completo. Implementado con `fill` + `object-cover
object-top` sobre un contenedor `absolute inset-0 overflow-hidden` — el
contenedor DE AFUERA (el que define el aspect-ratio) no tiene
`overflow-hidden`, así que las tarjetas flotantes, que son hermanas del div
recortado y no hijas suyas, pueden seguir desbordando sin que el propio
recorte se las coma.

Confirmé con el navegador en 1440 real: el titular ahora arranca a la misma
altura que el encabezado del teléfono, no hay franja vacía arriba.

### 3. El logo se veía diminuto en desktop

Causa exacta: la caja tenía `h-7 w-28` (ratio 4:1) contra una imagen real de
1418×826 (ratio ≈1.72:1). Con `object-contain`, la altura mandaba: el logo
renderizaba ~48px de ancho flotando en una caja de 112px, y a `lg:` con
`h-8 w-32` el problema era todavía peor (~55px reales en una caja de 128px).

Arreglado con `aspect-[1418/826]` en la caja y ancho en `auto` (`h-7 sm:h-8
lg:h-9 xl:h-10`, sin `w-*` explícito): la caja mide EXACTAMENTE lo que el
logo ocupa a cada altura, sin aire de sobra y sin aritmética a mano que se
desalinee si cambia el alto de nuevo. `sizes` del `Image` actualizado a los
anchos reales resultantes (48/55/62/69px). Confirmado con zoom en el
navegador: el wordmark "ComandApp" se lee con el peso que corresponde a un
logo de header, no un ícono perdido.

### 4. El separador de la línea de precio colgaba como viñeta en mobile

La estructura anterior era un `<p>` con `flex flex-wrap` y dos `<span>`
(precio, y "· N días gratis..."): cuando el segundo no entraba, envolvía
ENTERO a una línea nueva empezando con "· ", que se lee como una viñeta
suelta. Se sacó el separador y el flex-wrap: ahora son dos `<p>` apilados
(`flex flex-col`), precio arriba, "N días gratis con la integración hecha"
abajo, sin puntuación al empezar la segunda línea en ningún ancho. Confirmado
en el navegador a 500px: la línea de días ya no cuelga.

### Verificación final

- `npx tsc --noEmit`: limpio.
- `npm run lint`: limpio.
- `npm run build`: compila, `/` sigue `○ (Static)`.
- `npm test`: 103 archivos, 1307 tests verdes, 4 skipped (sin Docker).
- Verificación visual en Chrome real (1440 y ~500px), con zooms puntuales
  sobre cada una de las tres tarjetas flotantes y sobre el logo, no solo
  lectura de clases — la misma disciplina que las rondas anteriores.

## Agregado en la misma ronda: grilla + washes de color en el fondo del hero

Pedido del dueño del producto, capa puramente decorativa. Implementado en
`hero.tsx` como un componente local `HeroBackdrop`, sin tocar `globals.css`
(es del coordinador) y sin que el efecto salga de la sección del hero.

**Cómo quedó armado** (todo CSS, cero JS, cero imagen):

- Dos `repeating-linear-gradient` (0deg y 90deg) para la grilla, con línea
  cada `64px`, color `color-mix(in oklch, var(--border) 45%, transparent)`.
- Dos `radial-gradient` para los washes: uno con `--primary` (verde de marca)
  centrado arriba a la izquierda (18% 12%, donde vive el titular), otro con
  `--accent` (navy) centrado a la derecha (88% 60%, bajo el teléfono) — al
  6% cada uno vía `color-mix`. Ningún hex hardcodeado; todo deriva de los
  tokens de `[data-comandapp]`.
- `mask-image` radial (`85% 65% at 32% 28%`, `black 35%` → `transparent 90%`)
  sobre TODA la capa (grilla + washes juntos): apaga el conjunto antes de los
  cuatro bordes de la sección en vez de cortarlo en seco, y de paso lo apaga
  bastante antes de llegar al techo — la zona que queda detrás de la barra
  fija al scrollear ya sale casi transparente, así que no hay grilla sucia
  pasando por debajo del `backdrop-blur`. Verificado con scroll real en el
  navegador, en mobile y desktop.
- Capa `absolute inset-0 -z-10 pointer-events-none aria-hidden`, sección en
  `relative isolate`. Sin animación.

**Contraste, medido de verdad, no estimado**: tomé un screenshot real a
1440px, usé `sharp` para leer el RGB efectivo del fondo en los puntos más
teñidos (el centro de cada wash, una intersección de línea de grilla sobre
el wash verde, y la zona de padding superior cerca del wash) y calculé el
ratio WCAG contra el color resuelto de `h1` (rgb 11,27,50) y de
`.text-muted-foreground` (rgb 86,99,121). Peor caso encontrado:
**muted-foreground 5.52:1** (sobre el wash navy) y **h1 15.69:1** — los dos
por encima de 4.5:1 con margen. Tiene sentido: `--primary` y `--accent` son
ambos MÁS OSCUROS que el hueso de fondo, así que mezclarlos a 6% solo oscurece
un poco la zona, lo cual ayuda al contraste de un texto oscuro en vez de
bajarlo. No hizo falta aclarar ningún wash.

**Sin scroll horizontal**: confirmado en el navegador a 500px y 1440px
(`scrollWidth` ≤ `innerWidth` en los dos casos).

**Deuda resuelta de la ronda anterior**: la tarjeta de pago (`-bottom-20`)
rozaba el epígrafe de la captura. Con más contenido delante volví a tocar el
hero igual, así que la subí a `-bottom-24` — despeja tanto el teléfono
recortado como el epígrafe, confirmado con el mismo scroll de verificación.

**Nada reportado como candidato a token reutilizable**: el patrón (grilla +
dos washes con `mask-image` radial) es específico de esta sección de venta;
no vi otro lugar en el producto donde algo así aplicara hoy.

### Verificación final (los cinco defectos juntos)

- `npx tsc --noEmit`: limpio.
- `npm run lint`: limpio.
- `npm run build`: compila, `/` sigue `○ (Static)`.
- `npm test`: 103 archivos, 1307 tests verdes, 4 skipped (sin Docker).
