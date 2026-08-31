# T5 — Footer más sutil y mail propio

## Mail: `tomasizuel@gmail.com` → `hola@comandapp.ar`

Reemplazado en los cuatro lugares que tocaba este slice:

- `src/views/shared/site-footer.tsx` — constante `CONTACT_EMAIL`.
- `src/app/legal/terminos/page.tsx` — constante `CONTACT_EMAIL`.
- `src/app/legal/privacidad/page.tsx` — constante `CONTACT_EMAIL`.
- `src/lib/env.server.ts` — solo el `.default(...)` de `SUPPORT_EMAIL` (línea
  100). No se tocó nada más de ese archivo: sigue siendo una variable de
  entorno, el default es lo único que cambió.

`hola@comandapp.ar` es un `mailto:` de **contacto**, no el remitente de
Resend. `RESEND_FROM_EMAIL` no se tocó ni se mencionó en ningún archivo de
este slice.

**Grep de verificación** (`grep -rln "tomasizuel@gmail.com"` sobre todo el
repo, excluyendo `node_modules`, `.git` y `.next`): no queda ninguna aparición
en `src/`, `.env.example` no tenía ninguna. Apareció una sola mención fuera de
código vivo, en `docs/pipelines/2026-08-28-confirmacion-codigo-pagos/02-development-frontend.md`
— es el log de una corrida de pipeline anterior (historial, no código ni
config), así que se dejó sin tocar y queda anotada acá en vez de editada.

## Footer: bajado de peso

Diagnóstico del peso original: dos bloques con `gap-5` y `py-8` (mucho aire
vertical para un pie), una frase de captación ("¿Tenés un local y querés
vender online? Escribinos a") que interpela directamente al lector, el mail
en `text-foreground font-medium` con ícono de `Mail` — o sea con la misma
jerarquía visual que tendría un dato de contacto del propio local — y los
links legales en una fila aparte debajo. Todo eso compite con la marca del
local, que es exactamente lo que la regla del mundo visual prohíbe (marca
propia, nunca marketplace: la plataforma no se muestra en la cara del
cliente).

Criterio aplicado, no receta nueva — bajé la temperatura visual hasta que el
pie quedara al nivel de un dato de pie de página, no de una sección:

- **Se eliminó la frase de captación.** No se bajó de tono: se sacó. Un local
  ya está usando la plataforma; una frase que capta *nuevos* locales dentro
  del footer que ve *el cliente del local* no tiene audiencia ahí y es
  puro peso. Si el producto quiere ese mensaje, el lugar es el propio sitio
  de marketing de la plataforma, no el pie de la vitrina de un cliente.
- **Una sola fila** en vez de dos bloques apilados: nav legal a la izquierda,
  mail de contacto a la derecha, con `justify-between` y `flex-wrap` para que
  en un viewport angosto se parta en dos filas en vez de recortarse.
- **Mismo tratamiento tipográfico para las tres cosas**: `text-xs`,
  `text-muted-foreground`, sin negrita, sin ícono. El mail dejó de tener
  jerarquía propia (antes era `text-foreground font-medium` con ícono de
  `Mail` de `lucide-react`) — ahora es exactamente el mismo peso visual que
  "Privacidad" o "Términos". Se sacó el import de `Mail` porque ya no se usa
  ningún ícono en el componente.
- **`py-8` → `py-4`**: la mitad del aire vertical. `gap-5` entre bloques
  desapareció porque ahora es una sola fila (`gap-x-4 gap-y-1` para el caso en
  que envuelve).

Lo que **no** cambió porque el brief lo pedía explícitamente:
- Los links a `/legal/privacidad` y `/legal/terminos` siguen presentes y
  alcanzables, con el mismo `href`.
- Piso de 44px táctil: los tres elementos (dos `Link`, un `<a mailto:>`)
  mantienen `min-h-11` con `flex items-center`. El comentario del archivo se
  actualizó para explicar la fila en vez de mentir sobre "la línea propia
  para el mail dentro de un párrafo", que ya no existe — ahora explica por
  qué el mail va en su propia fila (junto al nav legal, alineado a la
  derecha) y no metido en una oración corrida.
- Sigue siendo Server Component sin estado (no se agregó ningún hook ni
  directiva `'use client'`).
- Cero colores fuera de tokens: todo el texto usa `text-muted-foreground` /
  `hover:text-foreground`, que `ensureContrast()` ya garantiza sobre
  cualquier `--primary` de marca (probé mentalmente con un naranja saturado y
  un azul oscuro: al ser variables de tema, no colores fijos, el contraste
  viaja con el tema del local sin tocar nada acá).
- Transición existente (`transition-colors duration-(--dur-fast)`) se
  mantuvo tal cual; no se agregó ningún nuevo momento de motion (la regla del
  repo reserva motion solo para agregar al carrito, y este componente no
  tiene ninguno).

## Verificación

- `npm run typecheck` — verde.
- `npm run lint` — verde en los archivos de este slice (quedan 2 warnings
  preexistentes en `tests/db/tmp-repro-t1-action.test.ts`, de otro slice, sin
  relación con este cambio).
- Hook de `impeccable` corrido automáticamente tras la edición de
  `site-footer.tsx`: "No deterministic design-quality issues found."
- Skill `web-design-guidelines` consultada contra el archivo final: nav
  semántico con `aria-label`, links reales (`<Link>` / `<a>`, no `div` con
  handler), foco visible heredado de los tokens globales (no se usó
  `outline-none` en ningún punto), sin animación fuera de `transform`/`color`
  existente. Sin hallazgos.

## Archivos tocados

- `src/views/shared/site-footer.tsx`
- `src/app/legal/terminos/page.tsx`
- `src/app/legal/privacidad/page.tsx`
- `src/lib/env.server.ts` (solo el default de `SUPPORT_EMAIL`)

## Follow-ups / nada pendiente

Ninguno para este slice. Si el dueño del producto quiere retomar la
captación de locales nuevos, es un mensaje que pertenece a otra superficie
(landing de la plataforma), no al footer de la vitrina de un cliente ya
onboardeado — queda anotado acá por si se vuelve a plantear.

## Revisión: el mail no puede quedar huérfano

La primera versión de este slice se pasó de sutil: sacó `hola@comandapp.ar`
del footer sin ninguna palabra alrededor. El dueño del producto pidió un
footer **más discreto**, no que desapareciera el único canal de captación de
locales nuevos que tiene el SaaS, y un mail suelto al pie tampoco le dice
nada al cliente del local sobre qué es esa dirección.

Lo que cambió respecto de la primera versión, todo dentro de
`site-footer.tsx` (ningún otro archivo tocado en esta pasada):

- **Volvió la etiqueta, corta**: `¿Tenés un local? hola@comandapp.ar`. Mismo
  tono `muted`, mismo `text-xs`, sin negrita y sin ícono — ocupa el mismo
  renglón que ocupaba el mail solo, no una segunda línea.
- **La etiqueta es texto plano AFUERA del `<a>`**, no parte del link. Dos
  motivos, los dos de UX: (1) si el `<a>` envolviera toda la frase, el
  subrayado de `hover` marcaría "¿Tenés un local? hola@comandapp.ar" entera
  como si fuera todo clickeable, cuando lo único accionable es la dirección;
  (2) el piso de 44px queda resuelto por el `<a>` solo (igual que cada link
  del nav de arriba), sin que un `<span>` no interactivo tenga que cargar con
  esa altura. El comentario del archivo, que databa de la versión sin
  etiqueta, se reescribió para explicar esta decisión en vez de describir una
  estructura que ya no existía.
- **Verificado el corte a 320px de ancho** con un harness aislado (HTML
  estático, mismas clases flex/gap/font-size que el componente real, servido
  por un `http.server` local para poder cargarlo en una pestaña de Chrome sin
  tocar el `next dev` de la app) en vez de reventar el viewport del navegador
  compartido con la sesión de otro agente: a 320px con el padding real
  (`px-4` = 16px por lado, o sea 288px de ancho útil), el nav legal
  (`Privacidad · Términos`, ~124px) y el bloque de mail
  (`¿Tenés un local? hola@comandapp.ar`, ~215px) no entran juntos en una fila
  (124 + 215 + 16px de `gap-x-4` > 288px), así que `flex-wrap` los separa en
  dos filas — nav arriba, mail abajo — y cada uno solo ocupa **una** línea
  propia (215px cabe sobradamente en los 288px disponibles): no queda ninguna
  palabra suelta en una tercera línea. Confirmado también con captura visual
  contra la app real corriendo (`/la-birra` con el tema verde de la tienda de
  prueba) a ancho de escritorio: fila única, mismo peso tipográfico entre el
  nav legal y el mail, sin protagonismo.
- `npm run typecheck` y `npm run lint` se corrieron de nuevo después del
  ajuste: los dos siguen en verde (mismos dos warnings preexistentes de
  `tests/db/tmp-repro-t1-action.test.ts`, ajenos a este archivo).
