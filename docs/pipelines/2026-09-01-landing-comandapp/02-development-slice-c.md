# Slice C — Cierre comercial

Agente: `frontend-react-craftsman`. Dueño exclusivo de:

- `src/views/landing/pricing.tsx` → `Pricing()`
- `src/views/landing/faq.tsx` → `Faq()` y `FAQ_ITEMS`
- `src/views/landing/closing.tsx` → `Closing()`
- `src/views/landing/landing-footer.tsx` → `LandingFooter()`

No se tocó ningún otro archivo. `src/app/page.tsx`, `src/lib/landing.ts`,
`src/lib/seo.ts`, `[data-comandapp]` en `globals.css` y `src/views/shared/**`
ya existían al terminar (los completaron los Slices A/B/D en paralelo) y se
consumieron tal cual, sin editarlos.

## Qué se construyó

### `Pricing`

Lee **todo** de `PRICING` (`src/lib/landing.ts`): `trialDays`, `monthlyCents`,
`monthlyMultiStoreCents`, `IVA_DISCLOSED`. Los dos importes se formatean con
`formatCentsCompact()` de `src/lib/money.ts` — cero `$` hardcodeado.

Descubrí releyendo el comentario de `[data-comandapp]` en `globals.css` que la
paleta reserva las bandas oscuras (`bg-accent`/`text-accent-foreground`) para
tres usos nombrados explícitamente: **"barra fija, cierre, precio"**. O sea
que `Pricing` tenía que ser una banda navy, no una sección clara — coincide
con lo que terminaron construyendo los Slices A y D (`LandingBar`,
`LandingHero`) para la barra fija y el precio adelantado del hero. Estructura:
sección `bg-accent` con el titular y un párrafo, y adentro un `Panel` blanco
elevado (el único lugar donde se usa el componente compartido `Panel` en este
slice) con tres bloques divididos por `border-t`: el trial, el precio mensual
grande (`text-(--brand-ink)`, `tabular`, `display`), y el precio por local
adicional. Un CTA secundario de WhatsApp debajo del panel, reusando
`whatsappHref()`.

**El disclaimer de IVA se resuelve con un condicional puro**:
`{PRICING.IVA_DISCLOSED ? ' + IVA' : ''}`. Hoy no renderiza nada; el día que
`IVA_DISCLOSED` pase a `true` en el contrato, el texto aparece solo sin tocar
este archivo.

### `Faq` / `FAQ_ITEMS`

`FAQ_ITEMS` es un array `readonly Faq[]` con `q`/`a` como strings planos —
nada de JSX adentro, porque `src/app/page.tsx` (Slice D) lo importa para
`buildFaqPageJsonLd()` en `src/lib/seo.ts`. Verificado que la firma coincide
exactamente (`readonly Faq[]` en ambos lados) y que el build pasa con esa
integración real, no supuesta.

Siete preguntas, las que pide `01-tasks.md`: quién se queda con la plata (cada
local cobra con SU cuenta de Mercado Pago), qué pasa con el software de
gestión que ya usa (sale por eventos, no se reemplaza), cuánto tarda en
arrancar (sin inventar un número de horas/días que no está confirmado en
ningún lado — se contesta en términos de qué no hace falta: instalar nada,
esperar a un desarrollador), si el cliente instala algo o crea cuenta (no a
las dos), si puede cobrar en el local (sí, es una decisión por tienda), si se
queda con sus clientes y datos (sí, vía el padrón de clientes — feature real
del Slice B), y qué pasa sin fotos (el fallback de `PhotoFrame`: nombre
grande sobre el color de marca, nunca un hueco gris).

Acordeón con `<details>`/`<summary>` nativos, todos cerrados de entrada (sin
atributo `open` en ninguno). Cero JavaScript: ni el toggle ni el ícono
dependen de estado de React. El chevron (`ChevronDown` de lucide) gira con el
selector `group-open:rotate-180` **sin `transition`**, a propósito: es un
cambio de estado instantáneo, no una animación — la única animación
autorizada de esta página es el `:active` de los botones de WhatsApp.

### `Closing`

Banda navy final (mismo par `bg-accent`/`text-accent-foreground` que
`Pricing` y `LandingBar`), con el titular, un CTA grande de WhatsApp
(`whatsappHref()`, `target="_blank" rel="noopener noreferrer"` para
consistencia con el resto de los links salientes) y el mail de respaldo
(`CONTACT.email`) como `mailto:`.

### `LandingFooter`

**No reusa `SiteFooter`** (ese lleva "¿Tenés un local?", absurdo acá porque
el lector YA es el local). Reusa el mismo isotipo horizontal
(`/full-logo-horizontal.png`) que `LandingBar` monta en su propia placa clara
sobre navy — acá no hace falta la placa porque el pie ya es `bg-background`
claro. Legal (`/legal/terminos`, `/legal/privacidad`) y el mail. Nada más.

## Decisiones no obvias

1. **Contraste: nada de opacidad sobre texto en las bandas oscuras.** Antes de
   escribir código leí `hero.tsx` (Slice A) y encontré el mismo criterio ya
   aplicado ahí con un comentario explícito: el par `accent`/`accent-foreground`
   ya viene resuelto, así que atenuar con opacidad para simular jerarquía
   secundaria rompe justo lo que el piso de calidad prohíbe. Apliqué el mismo
   criterio en `Closing` (descarté un `text-accent-foreground/90` que había
   puesto en un borrador) y en `Pricing`: toda la jerarquía tipográfica en las
   bandas navy sale de tamaño/peso, nunca de opacidad.
2. **`StatusPill tone="live"` (verde como texto) se descartó para el badge del
   trial en `Pricing`.** Esa variante compone `text-primary` sobre
   `bg-primary/12`, que en el storefront funciona porque el `--primary` de
   cada tienda pasa por `ensureContrast()` en tiempo de build del tema. La
   paleta de ComandApp es fija y ya viene con la advertencia medida en
   `00-architecture.md` ("verde como texto sobre fondo claro: 3.39, no pasa").
   Usar esa variante acá habría reproducido exactamente la trampa que el
   propio pipeline documentó. Terminé sin pill: texto plano
   (`text-foreground`/`text-muted-foreground`) dentro del `Panel` blanco.
3. **Ícono de WhatsApp: cambié de `MessageCircleMore` (lucide) al componente
   `WhatsApp` de `src/components/ui/whatsapp.tsx`** después de ver que
   `LandingBar` y `LandingHero` (Slices A) ya lo usaban en sus CTA. Sin eso,
   la página habría tenido dos glifos distintos para la misma acción según la
   sección. Mismo criterio para `transition-[background-color,transform]`
   (propiedades explícitas, nunca `transition-all`) y `target="_blank"
   rel="noopener noreferrer"` en los links salientes a `wa.me`: los copié de
   `hero.tsx`/`landing-bar.tsx` para que las tres CTA de la página se sientan
   como el mismo control.
4. **`touch-manipulation` en los dos CTA de WhatsApp propios.** Lo agregué
   después de ver que el Slice A lo sumó a sus propios CTA (`LandingBar`,
   `LandingHero`) mientras este slice estaba en curso — mismo criterio que el
   resto de las clases de botón, para que las cuatro CTA de la página se
   comporten igual al toque.
5. **Foco visible en `<summary>`.** El selector global de
   `:focus-visible` en `globals.css` cubre
   `a, button, input, select, textarea, [tabindex]` pero no `summary` (que es
   focuseable nativamente sin necesitar `tabindex`). Sin acción, el FAQ habría
   quedado con el outline azul por defecto del navegador en vez del anillo del
   sistema. Repetí el anillo (`outline-(--ring)`) directamente en el
   `className` del `summary` en vez de tocar `globals.css`, que no es mío.
5. **Logo del footer: imagen real, no wordmark de texto.** Mi primer borrador
   usaba un `<span className="display text-(--brand-ink)">ComandApp</span>`.
   Lo cambié a `next/image` con `/full-logo-horizontal.png` (el mismo activo
   que `LandingBar`) para que el mismo isotipo aparezca arriba y abajo de la
   página en vez de dos representaciones de marca distintas.
6. **Sin CTA propio en `Faq`.** El brief no lo pide y la barra fija (Slice A)
   ya mantiene el CTA a un toque durante todo el scroll, incluida esta
   sección — agregar uno acá habría sido ruido repetido.

## Lo que descarté

- Un pill de color para el trial en `Pricing` (ver decisión 2).
- Animar el chevron del FAQ con `transition-transform` (ver Faq arriba): el
  brief autoriza una sola animación en toda la página, la del botón.
- Reusar `SectionHeading` dentro de `Pricing`/`Closing`: esas dos secciones
  viven en la banda navy y `SectionHeading` da por sentado `text-foreground`
  (pensado para secciones claras). Escribí el `<h2>` a mano con
  `text-accent-foreground` en vez de forzar el primitivo compartido a un
  contexto de color que no contempla. `Faq` sí usa `SectionHeading` sin
  cambios, porque esa sección es clara.

## Verificación

- `npx tsc --noEmit` — limpio, cero errores en los cuatro archivos propios y
  en el proyecto completo (los otros tres slices ya estaban integrados al
  momento de correrlo).
- `npx eslint` sobre los cuatro archivos y sobre `src/views/landing` completo
  — limpio.
- `npm run build` — pasa completo. `/` sale marcada `○ (Static)`
  (prerenderizada), confirmando cero data fetching y cero hidratación en toda
  la landing, con los cuatro slices ya integrados.
- Contrastes verificados a mano contra los pares documentados en
  `00-architecture.md`: `text-accent-foreground` sobre `bg-accent`,
  `text-primary-foreground` sobre `bg-primary`, `text-(--brand-ink)` sobre el
  `Panel` blanco (más contraste todavía que sobre el hueso donde se midió
  4.99, porque `--card` es blanco puro).

## Spec para `test-engineer`

Comportamiento observable por rol/nombre accesible, sin depender de clases:

- **`Pricing`** (sección `#precio`): un heading de nivel 2 "Lo que cuesta, sin
  letra chica"; texto visible con el valor exacto de `PRICING.trialDays`
  (`15`) y las cifras formateadas de `PRICING.monthlyCents` (`$ 59.999`) y
  `PRICING.monthlyMultiStoreCents` (`$ 50.000`) — si el contrato cambia, estos
  tres valores tienen que cambiar juntos en el texto renderizado. Un link con
  rol `link` y nombre accesible "Empezar por WhatsApp" cuyo `href` es
  exactamente `whatsappHref()` (mismo string que en cualquier otro CTA de la
  página). **Mientras `PRICING.IVA_DISCLOSED` sea `false`, el texto "IVA" no
  debe aparecer en ninguna parte de esta sección** (ni "+ IVA" ni "IVA
  incluido"); si se flipea a `true` en el contrato, debe aparecer " + IVA"
  pegado al precio mensual.
- **`Faq`**: un heading "Antes de que preguntes"; siete elementos `<details>`
  (rol implícito `group` con `<summary>` como disclosure), **todos sin el
  atributo `open` en el render inicial** — ninguna respuesta visible antes de
  interactuar. Cada `summary` tiene el texto exacto de `FAQ_ITEMS[i].q`, y el
  párrafo con `FAQ_ITEMS[i].a` solo debería considerarse "visible" en el
  sentido de accesibilidad una vez que el `<details>` correspondiente esté
  abierto (contenido nativo: siempre está en el DOM, pero `<details>` sin
  `open` lo colapsa). `FAQ_ITEMS` es la fuente de verdad — un test de
  integración con `page.tsx` puede confirmar que `buildFaqPageJsonLd` recibe
  exactamente este array (mismo `q`/`a`, mismo orden).
- **`Closing`**: un heading "Dejá de perder ventas por WhatsApp"; un link con
  nombre "Hablar por WhatsApp" con `href = whatsappHref()`,
  `target="_blank"` y `rel="noopener noreferrer"`; un link `mailto:` cuyo
  `href` es `mailto:` + `CONTACT.email` exacto (`hola@comandapp.ar` al momento
  de escribir esto, pero el test debería leer `CONTACT.email` del contrato en
  vez de hardcodear el string).
- **`LandingFooter`**: dos links de navegación con nombre "Términos" (href
  `/legal/terminos`) y "Privacidad" (href `/legal/privacidad`), y un link
  `mailto:` con el mismo `CONTACT.email`. La imagen del logo lleva
  `alt="ComandApp"` (el valor de `PRODUCT_NAME`).
- **Targets táctiles**: todos los links interactivos de estos cuatro
  componentes miden al menos 44px de alto (`h-11`/`h-12`/`h-14` o
  `min-h-11`) — verificable por `getBoundingClientRect()` en un test de
  render real, no por inspección de clase.
- **Sin JavaScript de cliente**: ninguno de los cuatro componentes es un
  Client Component (sin `'use client'`, sin `useState`/`useEffect`). Un test
  que falle si alguno de estos archivos empieza a requerir hidratación estaría
  cubriendo una regresión real del contrato de "landing estática".

## Cross-lane / follow-ups

- Nada pendiente de otro lane a partir de este slice: no se necesitó ningún
  controller, modelo ni cambio de schema — toda la sección es estática y lee
  únicamente de `src/lib/landing.ts` y `src/lib/money.ts`.
- No se agregó ningún primitivo nuevo a `src/views/shared/surfaces.tsx`: todo
  lo que hizo falta (`Panel`, `SectionHeading`) ya existía y alcanzó.
- Deuda declarada que sigue abierta desde `00-architecture.md`: el día que
  `PRICING.IVA_DISCLOSED` pase a `true`, solo hay que confirmar que el texto
  " + IVA" que aparece en `Pricing` sea el texto legal que en definitiva se
  quiera mostrar — hoy es un string fijo minimalista a propósito, no una
  oración legal completa.

## Arreglo posterior: ícono de WhatsApp invisible sobre bg-primary

`src/components/ui/whatsapp.tsx` (compartido, no editable) trae `fill="#25D366"` fijo en el `<path>`. Sobre fondo blanco es correcto (KDS, panel del local), pero en los dos CTA de este slice que viven sobre `bg-primary` (`#10C88A`) el ícono quedaba verde sobre verde e invisible, mientras el label se leía por ir en `text-primary-foreground` (navy). Corregido en `pricing.tsx` y `closing.tsx` forzando el color desde la clase — `className="size-N shrink-0 [&_path]:fill-current"` — para que el `path` tome `currentColor` y siga al mismo `text-primary-foreground` que el texto de al lado, en vez de tocar el componente compartido. Misma técnica que aplicó el Slice A en `landing-bar.tsx`/`hero.tsx`, así que las cuatro CTA de WhatsApp de la página resuelven el contraste de la misma forma. Verificado: `npx tsc --noEmit` y `npm run lint` limpios.
