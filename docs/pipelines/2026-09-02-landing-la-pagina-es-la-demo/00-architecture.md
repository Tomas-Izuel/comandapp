# Landing v2 — "la página es la demo"

Fecha: 2026-09-02 · Superficie: `/` (apex) · Modo: **Persuade** · Comando: `/impeccable shape`

## El pedido

Textual: *"upgrade the Landing page, it looks AI-Generated, i want more
animations or smoother stuff, clear paths, innovative components, ux/ui that
explain itself, no classic-ai-generated web page."*

## Diagnóstico (inspección del render, desktop 1440 y mobile 390)

La ronda anterior (`2026-09-01-landing-comandapp`) dejó una página correcta,
honesta y estática. Lo que la hace leer como "generada" no es un defecto puntual
sino el **esqueleto**: es la plantilla de landing SaaS ejecutada limpia.

| Sección | Lo que hay | Por qué se lee como plantilla |
|---|---|---|
| Hero | Titular partido por **caracteres** (React Bits SplitText), celular con 3 tarjetas flotantes | El split por letra es el efecto de stock #1 de 2025; además el H1 arranca en `opacity: 0` y en la inspección quedó renderizado como "Ve" a medio camino. En desktop la columna de texto termina a 360px y deja la mitad del viewport vacía |
| Hoy vs. ComandApp | Hilo de chat estático + lista de 4 costos | Es un buen argumento contado como texto: el lector tiene que *leer* que son siete mensajes, no lo *ve* pasar |
| Lo que ya viene armado | 16 tildes en 3 columnas | El checklist de features de toda landing |
| Así se ve, andando | 4 capturas en grilla 2×2 | Las capturas son la única evidencia real y están colgadas como galería, sin recorrido; el grid deja huecos enormes por la mezcla de aspectos |
| Las dos cosas que WhatsApp no puede dar | Dos párrafos con ícono | Los dos diferenciadores del producto están **descriptos**, y son justamente los dos que se pueden **demostrar** con la aritmética real |
| Delivery | Lista ícono-en-círculo + título + texto, y una captura | La estructura ícono+título+texto que el piso de calidad prohíbe como esqueleto, apenas disimulada en lista |
| Precio | Tarjeta centrada en banda navy | Correcta, pero el lector con dos locales tiene que hacer la cuenta |
| FAQ | `<details>` con chevron que salta | Abre de golpe, y cada respuesta es un punto muerto: no lleva a ningún lado |
| Cierre | Banda navy + botón | El botón no dice qué va a pasar al tocarlo |

Además: **cero motion salvo el H1**, por decisión de la ronda anterior. Ésa fue
la regla correcta para la vitrina (una carta que se revela de a poco es una
carta que tarda) y **la regla equivocada para una landing de Persuade**, donde
el lector no tiene apuro y sí tiene que convencerse.

## Tesis

**La página deja de describir ComandApp y deja mirar un pedido.**

Un solo pedido —el **#A2A1** de `pantalla-seguimiento.png`: Camila, 1× Bacon
Bomb + 1× Papas Cheddar, $16.700, hecho a las 21:20— cruza la página entera.
Cada sección es una **estación** de ese pedido, y donde el producto tiene una
regla que WhatsApp no puede dar, la sección la **ejecuta con la aritmética
real** en vez de contarla:

| Estación | Qué se ve pasar | Aritmética real que usa |
|---|---|---|
| La carrera | El mismo pedido por WhatsApp (7 mensajes, listo 21:58) y por ComandApp (0 mensajes, listo 21:41), corriendo en paralelo | `DEMO_THREAD`, `DEMO_ORDER.timeline`, `OrderSteps` de la vitrina |
| El recorrido | Las cinco capturas como estaciones: compra → cocina → espera → reparto → caja, con la captura activa fija mientras el texto avanza | `JOURNEY` |
| El tiempo se mueve con la cocina | Un control de "pedidos activos" que cambia el ETA en vivo cuando cruza el umbral | `etaMinutesFor()` → `scaleUpInt`, defaults del schema (5 pedidos, ×1.5) |
| El pedido sale por eventos | El log de `order_events` del #A2A1 llegando fila por fila al sistema del local | `DEMO_EVENTS` |
| Delivery | Un cotizador: subtotal → envío / mínimo / gratis, y flota libre u ocupada → minutos | `deliveryFeeFor`, `deliveryMinutesFor`, `buildDeliveryQuote` de `src/lib/delivery.ts` |
| Precio | "¿Cuántos locales?" → total mensual con el desglose | `monthlyTotalCents()` sobre `PRICING` |
| FAQ | Cada respuesta termina en "preguntar esto por WhatsApp" con el mensaje ya redactado | `whatsappQuestionHref()` |
| Cierre | El botón muestra el mensaje exacto que va a abrir | `WHATSAPP_MESSAGE` |

Eso es lo que convierte "UX que se explica sola" y "componentes innovadores" en
algo concreto: **ningún componente nuevo es un widget decorativo; cada uno es
una regla del producto hecha tocable**, y el número que muestra es el que el
producto cobraría o prometería.

### Por qué esto y no las alternativas

- **Más animación sobre el esqueleto actual** (fade-and-rise por sección,
  parallax en la grilla, contadores): es exactamente lo que el lector llama
  "AI-generated". Descartado.
- **Rehacer la identidad visual** (nueva paleta, nueva tipografía): la paleta
  sale del logo entregado y el contraste está medido. El problema no es de
  identidad, es de composición y de motion. Descartado; se hereda el mundo.
- **La demo en la mano** (el hero es un teléfono con el producto corriendo de
  verdad, embebiendo la vitrina): la vitrina necesita una tienda real y
  Supabase; convierte la página estática en dinámica y acopla la landing al
  seed. Descartado; se usan las capturas reales como estaciones.
- **Pin-scroll con GSAP ScrollTrigger** para el recorrido: pinning en mobile
  —el dispositivo real de lectura— es la fuente clásica de jank y de scroll
  secuestrado. Descartado: el recorrido va con `position: sticky` (CSS) en
  desktop y `scroll-snap` nativo en mobile, con `IntersectionObserver` solo
  para saber qué estación está activa.

## Gramática de motion (reemplaza al bloque LANDING de `src/app/layout.tsx`)

1. **Ningún texto, título ni tarjeta entra al hacer scroll.** Es la firma de la
   landing genérica y está prohibido. El HTML servido es el estado final.
2. Lo único que se mueve son **estados del producto dramatizados**: un mensaje
   que llega, un paso que se cumple, un número que cambia, una captura que se
   intercambia. Nada flota, nada hace parallax, nada gira de fondo.
3. Cada demo se reproduce **una vez** cuando entra en pantalla
   (`IntersectionObserver`, umbral ~0.4) y tiene un control **"Ver de nuevo"**.
   El estado final persiste.
4. El titular del hero entra por **líneas enmascaradas** (GSAP SplitText
   `type: 'lines'`, `mask: 'lines'`), total ≤ 900 ms, y **si el JS no corre el
   titular se ve igual** dentro de ~1 s.
5. `prefers-reduced-motion`: toda demo renderiza su **estado final de entrada**,
   sin temporizadores; el botón de repetir no se muestra; el FAQ abre sin
   transición. Nada queda oculto.
6. Una sola familia de easing (`--ease-out-expo`), las duraciones del sistema,
   más `--dur-beat` (700 ms) como cadencia entre eventos de una escena.
7. Los keyframes nuevos (`landing-msg-in`, `landing-row-in`, `landing-num-in`,
   `landing-typing`) se aplican **solo a elementos que el JS agrega** durante la
   escena. Un elemento presente en el HTML servido nunca lleva esas clases.

## Presupuesto y estática

- **Sin dependencias nuevas.** GSAP ya está (`gsap`, `@gsap/react`) y se usa
  **solo** en el titular. Ni ScrollTrigger, ni Framer Motion, ni Lenis.
- La ruta sigue **prerenderizada** (`○ Static` en `npm run build`). Las islas
  cliente hidratan, no consultan.
- Islas cliente autorizadas, una por demo: `split-text.tsx`,
  `landing-bar-progress.tsx`, `hero-ticket.tsx`, `versus-race.tsx`,
  `order-journey.tsx`, `eta-demo.tsx`, `events-demo.tsx`, `delivery-quote.tsx`,
  `pricing-calculator.tsx`. El FAQ **sigue siendo `<details>` nativo**, sin JS.
  El test `landing-source-scan.test.ts` pasa de allowlist de un archivo a esta
  lista, y sigue fallando ante cualquier archivo no declarado.

## Lo que NO se toca

`src/app/[store]/**`, `/admin`, `/backoffice`, `/repartidor`, `/legal`, los
tokens de `:root`, `src/views/shared/**` (se **compone**: `Panel`, `StatusPill`,
`StepMark`, `Stepper`, `OrderSteps`), `SiteFooter`, el modelo de datos, la
paleta `[data-comandapp]`, el precio, el número de WhatsApp, los textos del FAQ
y la lista de "lo que ya viene armado" (todas afirmaciones ya verificadas
contra el código en la ronda anterior).

## Anti-goals (heredados y reforzados)

Cero testimonios, métricas de uso, logos de clientes, contadores de "N locales".
Toda escena dramatizada lleva `DEMO_SCENE_CAPTION`; toda captura lleva
`SCREENSHOT_CAPTION`. Nada de kicker/eyebrow, tarjetas anidadas, emoji como
ícono, grilla ícono+título+texto como esqueleto, texto con gradiente, glass
decorativo, sección numerada 01/02/03.

## Deuda que sigue abierta

`PRICING.IVA_DISCLOSED = false`: la calculadora tampoco menciona el IVA.
