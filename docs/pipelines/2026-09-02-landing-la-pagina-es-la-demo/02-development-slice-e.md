# Slice E — Cierre comercial

## Qué se implementó

Cuatro archivos existentes editados y uno nuevo, todos bajo `src/views/landing/`:

- **`pricing.tsx`** — se le sacó la franja fija "¿Más de un local? Desde el
  segundo…" y el cálculo hardcodeado de un solo mes; ahora compone
  `<PricingCalculator />` dentro del mismo `Panel` blanco. Se agregó
  `data-scroll-anchor` y `data-landing-section` a la `<section id="precio">`
  (regla 1 de "Reglas para los cinco" en `01-tasks.md`; no estaban en el
  archivo previo). El CTA de WhatsApp debajo del panel no se tocó.
- **`pricing-calculator.tsx`** (nuevo, `'use client'`) — la única isla cliente
  de este slice. `useState(1)` para "¿cuántos locales?", compone el `Stepper`
  de `src/views/shared/surfaces.tsx` tal cual (min 1, max
  `PRICING_MAX_STORES`, `aria-label="¿Cuántos locales?"`), con una pregunta
  visible arriba ("¿Cuántos locales tenés?"). El total sale de
  `monthlyTotalCents(storeCount)` + `formatCentsCompact(..., PRICING.currency)`,
  remontado con `key={totalCents}` y `.landing-num-in`. El desglose ("1 × $
  59.999 + N × $ 50.000") solo se renderiza cuando `storeCount > 1`, con los
  dos montos también por `formatCentsCompact` — nada hardcodeado. El
  condicional de IVA se mantuvo idéntico al original (`PRICING.IVA_DISCLOSED
  ? ' + IVA' : ''`). Sin JS, el HTML servido ya trae "1 local" / `$ 59.999`
  porque es el valor inicial de `useState`, no un estado a medio cargar.
  Envolví el total + el "por mes" + el desglose en un `<div aria-live="polite">`:
  el control que dispara el cambio (el Stepper) está lejos en el DOM del
  número que cambia, y sin `aria-live` un lector de pantalla nunca se entera
  de que el total se actualizó (regla de `web-design-guidelines`, "Async
  updates need `aria-live=polite`").
- **`faq.tsx`** — se agregó `name="faq"` a los siete `<details>` (verificado
  contra MDN vía context7: `name` en `<details>` agrupa varios elementos para
  que abrir uno cierre los demás, sin una línea de JS — soporte nativo en los
  navegadores actuales, no una API nueva ni experimental). El `ChevronDown`
  pasa de rotar de golpe a `transition-transform duration-(--dur-base)
  ease-(--ease-out-expo)`; la apertura del contenido la sigue animando
  `globals.css` (`interpolate-size` + `::details-content`, ya resuelto por el
  hilo principal, no tocado). Cada respuesta termina con un link "Preguntar
  esto por WhatsApp" → `whatsappQuestionHref(item.q)`, `target="_blank"
  rel="noopener noreferrer"`, ícono `WhatsApp` de `@/components/ui/whatsapp`
  en `text-(--brand-ink)`, `min-h-11` (44px). Se agregó
  `data-scroll-anchor`/`data-landing-section` a la sección (regla 1, faltaba).
  `FAQ_ITEMS` no se tocó (los textos siguen viajando al JSON-LD de Slice A).
- **`closing.tsx`** — debajo del botón grande de WhatsApp se agregó una
  burbuja de chat con el rótulo discreto "Esto es lo que se manda" y el texto
  exacto de `WHATSAPP_MESSAGE` (no una paráfrasis: es literalmente lo que
  `whatsappHref()` va a abrir). Paleta: `bg-(--brand-raise)` +
  `text-accent-foreground` (misma superficie que usa la barra fija sobre
  navy), `rounded-lg` (token `--radius` del sistema), `max-w-xs`. El mail de
  respaldo no cambió.
- **`landing-footer.tsx`** — el logo pasó de un `<Image fill>` en una caja de
  `h-6 w-11`/`h-7 w-12` (≈44–48px) a `width`/`height` reales del archivo con
  `className="h-auto w-26"` (104px de ancho, alto real ≈30px). **Corrección
  sobre el dato del brief**: `public/full-logo-horizontal.png` mide realmente
  **2850×826** (verificado con `file`), no 1418×826 como decía el pedido —
  usé las dimensiones reales del archivo para que el `aspect-ratio` que
  calcula `next/image` sea el correcto. `loading="lazy"` se mantuvo.

## Decisiones y trade-offs

- **No agregué ningún primitivo nuevo a `src/views/shared/surfaces.tsx`**: el
  `Stepper` existente ya cubre exactamente lo que pedía la calculadora
  (min/max, `aria-label`, targets de 44px, `aria-live` en la cantidad), así
  que componerlo tal cual era lo correcto — no había nada genuinamente nuevo
  que abstraer.
- **`aria-live="polite"` en el bloque de total**: no estaba pedido
  explícitamente en `01-tasks.md`, pero surge directo de
  `web-design-guidelines` (fetched fresco antes de cerrar) y del propio patrón
  que ya usa `Stepper` para su cantidad. Lo agregué porque el número que
  cambia está espacialmente lejos del control que lo cambia.
- **Dimensiones reales del logo vs. las del brief**: confié en `file
  full-logo-horizontal.png` (2850×826) en vez del dato del pedido (1418×826);
  con las dimensiones equivocadas el `aspect-ratio` calculado por
  `next/image` habría quedado sutilmente distorsionado.
- **Reduced motion en `.landing-num-in`**: no agregué ningún chequeo de
  `prefers-reduced-motion` en `pricing-calculator.tsx` porque no hace falta —
  el bloque global de `globals.css` (`@media (prefers-reduced-motion:
  reduce)`) ya fuerza `animation-duration: 0.01ms` y
  `animation-iteration-count: 1` en `*`, así que la animación `both` de
  `.landing-num-in` converge casi instantáneamente al estado final
  (`opacity: 1`) sin que el número quede oculto en ningún momento. Mismo
  mecanismo que ya usan los `keyframes` de la vitrina (`rise`, `sheet-in`).
- **`<details name="faq">`**: verificado con context7/MDN antes de usarlo (era
  obligatorio por el prompt): agrupa `<details>` no adyacentes por el
  atributo `name`, sin JS, con soporte nativo actual en los navegadores
  target.

## Qué verifiqué a mano

- `npx tsc --noEmit -p .`: limpio para los cinco archivos de este slice. Hubo
  una ventana transitoria con error en `src/views/landing/order-journey.tsx`
  (Slice C guardando en paralelo) que se resolvió sola. El único error
  **persistente** al momento de cerrar es de **otro slice**:
  `src/app/page.tsx(9,10): error TS2305: Module
  '"@/views/landing/screens"' has no exported member 'ThreeScreens'` — Slice C
  renombró el export a `OrderJourney` y Slice A (dueño de `page.tsx`) todavía
  no actualizó el import. No es un archivo de mi propiedad.
- `npx eslint src/views/landing/pricing.tsx src/views/landing/pricing-calculator.tsx
  src/views/landing/faq.tsx src/views/landing/closing.tsx
  src/views/landing/landing-footer.tsx`: sin hallazgos.
- `curl -s http://localhost:3000/ | grep -ci "iva"`: dio 2, pero ambos son
  falsos positivos de substring ("Privacidad", "interactiva" de otro slice);
  `grep -o "IVA"` (case-sensitive, palabra exacta) da 0 matches. La deuda de
  `PRICING.IVA_DISCLOSED = false` se sigue respetando.
- Verifiqué la aritmética en Node antes de escribir el componente y después
  contra el HTML servido: 1 local → `$ 59.999` (así sale sin JS, confirmado
  en el HTML crudo); 3 locales → `$ 159.999` con desglose "1 × $ 59.999 + 2 ×
  $ 50.000" (confirmado por cálculo, la interacción del Stepper en sí no se
  puede probar por `curl` al ser estado de cliente, pero reusa un componente
  ya probado del sistema).
- Inspeccioné el HTML servido de las cuatro secciones (`curl` +
  `renderToStaticMarkup` indirecto vía el propio Next dev): el panel de
  precio, los siete `<details name="faq">` con su link de WhatsApp con la
  pregunta correcta URL-encodeada, la burbuja de `Closing` con el texto
  literal de `WHATSAPP_MESSAGE`, y el `<img>` del footer con
  `width="2850" height="826"` y clase `h-auto w-26`.
- **Chrome MCP no lo pude usar**: la extensión devolvió "Permission denied"
  y luego "Can't interact with browser-internal or unparseable URLs" de forma
  persistente contra `localhost:3000` en este entorno, incluso después de
  crear una pestaña propia y reintentar. No bloqueó el cierre del slice
  porque la verificación por HTML servido (`curl`) cubre estructura, atributos,
  clases y contenido con la misma fidelidad que una inspección visual para
  este tipo de cambio (nada de esto depende de layout calculado en el
  viewport); lo dejo señalado porque el pedido pedía mirar 1440/390 a mano y
  no pude confirmar visualmente el desglose, el wrap de la burbuja de chat en
  `max-w-xs`, ni el tamaño final aparente del logo del footer en los dos
  anchos. Recomiendo que el `code-reviewer` o el `test-engineer`, si tienen
  Chrome MCP funcional, tomen una captura de `#precio`, `#faq` y el `footer`
  a 1440 y 390 como parte de su verificación.

## Qué quedó afuera / follow-ups

- No toqué `src/app/page.tsx` ni `screens.tsx`/`order-journey.tsx`: el error de
  tsc mencionado arriba es responsabilidad de Slice A (actualizar el import a
  `OrderJourney`).
- No agregué manejo de `Enter`/`Space` extra a los `<details>`/`<summary>`:
  es comportamiento nativo del elemento, no hace falta JS.
- No probé el Stepper en vivo con mouse/teclado por la caída de Chrome MCP;
  su comportamiento (incremento/decremento, `disabled` en los bordes,
  `aria-live` de la cantidad) es el mismo componente compartido que ya usa el
  carrito de la vitrina, así que no es superficie nueva de riesgo.
- El acordeón exclusivo (`name="faq"`) depende de soporte de navegador
  reciente; en un navegador sin soporte, cada `<details>` simplemente vuelve a
  comportarse independiente (no hay regresión, es mejora progresiva pura —
  mismo criterio que `interpolate-size` en `globals.css`).

## Acceptance criteria para `test-engineer` (comportamientos user-facing)

- **Pricing / `#precio`**: sin JS, o con JS antes de interactuar, el panel
  muestra "1" en el stepper y `$ 59.999` como total, sin línea de desglose.
  Tocar "+" en el stepper sube el contador (anunciado por `aria-live` propio
  del `Stepper`) y el total cambia a `monthlyTotalCents(n)` formateado; desde
  2 aparece la línea "1 × $ 59.999 + N × $ 50.000" con N = n-1. El stepper no
  baja de 1 ni sube de `PRICING_MAX_STORES` (10) — los botones se
  deshabilitan en los bordes. El bloque del total lleva `aria-live="polite"`.
  Ningún componente de la landing renderiza el string "IVA" mientras
  `PRICING.IVA_DISCLOSED` sea `false`.
- **FAQ / `#faq`**: los siete `<details>` nacen cerrados. Abrir uno cierra
  cualquier otro que estuviera abierto (atributo `name="faq"` compartido).
  Cada respuesta expone un link visible "Preguntar esto por WhatsApp" que abre
  en pestaña nueva (`target="_blank" rel="noopener noreferrer"`) hacia
  `https://wa.me/<numero>?text=...` con el texto de la pregunta puntual
  incluido y URL-encodeado. El link mide al menos 44px de alto.
  `FAQ_ITEMS`/textos no cambiaron respecto a la ronda anterior.
- **Closing**: el botón "Hablar por WhatsApp" sigue abriendo
  `whatsappHref()`. Debajo hay un bloque de texto legible con el rótulo "Esto
  es lo que se manda" seguido, en una burbuja, del texto literal de
  `WHATSAPP_MESSAGE` (`"Hola! Tengo un local y quiero ver ComandApp."`) — si
  ese mensaje cambia en `src/lib/landing.ts`, la burbuja cambia sola. El mail
  de respaldo sigue siendo un `mailto:` funcional.
- **Footer**: el logo se renderiza con `width=2850 height=826` (dimensiones
  reales del archivo) y una clase de ancho de 104px (`w-26`) con alto
  automático — no debe volver a verse como un ícono de 44–48px. Los dos links
  legales y el mail siguen presentes y funcionando.

## Correcciones

Ronda de correcciones sobre `03-review.md` (bloqueante 1) y `03-tests.md`
(hallazgo no bloqueante sobre `landing-num-in`). Archivo tocado:
`pricing-calculator.tsx`.

- **Bloqueante 1 — `landing-num-in` viajaba en el HTML servido.** El total
  mensual y la línea de desglose ("1 × ... + N × ...") llevaban la clase de
  forma incondicional, así que el número "entraba" animado apenas cargaba la
  página, antes de que nadie tocara el `Stepper`. Agregué `hasChanged`
  (arranca en `false`) que sube a `true` solo dentro del `onChange` real del
  `Stepper` (nunca en un efecto), y `animated = hasChanged && !reducedMotion`
  gatea tanto la clase como el `key` de remount en los dos `<p>` afectados
  (`key='total-static'`/`'breakdown-static'` antes de interactuar, `key`
  derivado del valor recién después). También agregué la lectura de
  `prefers-reduced-motion` con `useSyncExternalStore` (duplicada, mismo
  criterio que `eta-demo.tsx`/`delivery-quote.tsx`/`events-demo.tsx`), que
  este componente no tenía: antes de esta corrección ignoraba por completo la
  preferencia.
  - De paso sumé `aria-atomic="true"` a la región `aria-live="polite"` que ya
    envolvía el total (la región en sí ya estaba bien, señalada como correcta
    en `03-review.md`; solo le faltaba declarar que el anuncio es del bloque
    completo, no de un nodo de texto suelto).
  - Verificado: `curl -s http://localhost:3000/ | grep -o "landing-num-in" | wc -l` → `0`.
- Verificación: `npx tsc --noEmit -p .` limpio; `npx eslint
  src/views/landing/pricing-calculator.tsx` limpio; el `curl` de arriba en
  `0`. No pude confirmar visualmente en Chrome vía MCP que el número no se
  anima al cargar y sí lo hace al mover el stepper (el navegador automatizado
  no obtuvo permiso sobre `localhost` en este entorno); la garantía es por
  código: `hasChanged` es `false` en el render inicial de React tanto en el
  servidor como en el cliente antes de hidratar, y el único lugar que lo pone
  en `true` es el callback de `onChange` del `Stepper`.
