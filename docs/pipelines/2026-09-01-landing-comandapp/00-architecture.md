# Landing de ComandApp — arquitectura

Fecha: 2026-09-01 · Superficie: `/` (apex) · Modo: **Persuade**

## Problema

La raíz del proyecto era un placeholder de dos líneas. El SaaS no tiene ni un
canal de captación propio: el único es una etiqueta en el pie de la cara del
cliente (`SiteFooter`, "¿Tenés un local?"). Hace falta una página que se le
mande por link a un dueño de hamburguesería y explique qué hace ComandApp.

## Quién llega

Dueño o encargado, en el celular, abriendo un link que le llegó por WhatsApp.
Escéptico, con poco tiempo, ya le vendieron algo parecido. Segundo lector: el
mismo dueño reabriéndola en la computadora del local para mostrarle a un socio.

Éxito = toca "Hablar por WhatsApp".

## Decisiones tomadas en la ronda de `shape` (2026-09-01)

| Decisión | Valor | Quién |
|---|---|---|
| CTA | WhatsApp directo, `+54 9 299 620-1979`, mensaje prearmado | dueño del producto |
| Precio | 15 días de integración sin cargo · $59.999/mes por local · $50.000 c/u desde el segundo | dueño del producto |
| Prueba | Capturas reales del producto, etiquetadas como datos de demostración | dueño del producto |
| Alcance | Argumento + producto + precio + CTA + FAQ + delivery | dueño del producto |
| Estructura | **La hoja de venta** (ronda de composición, seed `b3d616d4`, build code-led) | dueño del producto |

### Por qué "la hoja de venta" y no las otras dos que salieron en el reparto

Compitieron **la objeción primero** (arrancar por las cinco preguntas duras) y
**la demo en la mano** (el primer viewport es un teléfono con el producto
andando). Las tres eran defendibles. La hoja de venta gana porque el lector
recibe el link sin contexto y decide en dos minutos: poner el precio arriba y
no esconder nada respeta ese modo de lectura mejor que una narrativa con
scroll.

Dos retadores del catálogo aguantaron el cruce y quedaron como alternos:
**el instructivo de armado** (pasos numerados con flecha al control exacto —
fusiona fortísimo en "cómo funciona", pero una landing entera como manual
sepulta el precio) y **la edición anotada** (cada afirmación con su nota al
margen — resuelve la falta de testimonios, pero dos columnas alrededor de un
riel se rompen justo en el celular).

### Las cuatro elevaciones, de los retadores descartados

Cada uno donó una disciplina antes de irse. Están en el build, no en el papel:

1. **El marco trabaja** (del panel de consola) — la barra con el CTA acompaña
   todo el scroll en vez de aparecer al final.
2. **El FAQ nace cerrado** (del teletexto) — ninguna respuesta ocupa la página
   antes de que la pregunten.
3. **Cada captura lleva su ticket de origen** (del bazar de sombras) — es lo
   que convierte "no hay evidencia" en honestidad visible.
4. **Una sola animación** (de la cubeta de tinta) — la respuesta física del
   botón al toque. Nada entra al hacer scroll.

## Identidad: el único lugar donde la plataforma se muestra

PRODUCT.md dice "marca propia, nunca marketplace" y "la plataforma no se
muestra en la cara del cliente". Esta página es la excepción declarada: no le
habla al comprador, le habla al local.

Colores muestreados del logo entregado (`public/full-logo-horizontal.png`),
no elegidos a ojo: navy `#0A1B33`, verde `#10C88A`, hueso `#F4F8F6`.

Viven en un scope propio, `[data-comandapp]` en `globals.css`. **No se toca
`:root`**: cualquier token movido arriba se le aparece a `/admin` y
`/backoffice`, que son neutro shadcn y no son de ComandApp.

### La trampa de contraste, medida

- **Blanco sobre el verde de marca: 2.18.** Reprueba WCAG por lejos. El campo
  verde lleva texto **navy** (7.93). Ése es el par de todo lo que se toca.
- **Verde como texto sobre fondo claro: 3.39.** Tampoco pasa. Por eso existe
  `--brand-ink` (`#0B7A55`, 4.99 sobre el hueso), el único verde tipográfico.

Es exactamente el caso para el que existe `ensureContrast()` en la vitrina,
solo que acá la marca es una sola y se resuelve en el token.

## Estático de verdad: cero JavaScript de cliente

El pedido era "static y SEO optimized". Se lleva hasta el final: **ningún
componente de la landing lleva `'use client'`**. La barra es `position: sticky`,
el FAQ es `<details>` nativo, el CTA es un `<a href="https://wa.me/…">`, y la
única animación es un `:active` en CSS. La página no hidrata nada.

Consecuencia buscada: entra completa en el primer viewport de un celular con
mala señal, que es el escenario real de lectura.

## Lo que NO se toca

`src/app/[store]/**`, `/admin`, `/backoffice`, `/repartidor`, `/legal`, los
tokens de `:root`, `src/views/shared/**`, `SiteFooter` (lleva "¿Tenés un
local?", que en esta página no tiene sentido), y el modelo de datos: la
landing no tiene una sola llamada al servidor.

## Anti-goals

Cero testimonios, cero métricas de uso, cero logos de clientes, cero "usado por
N locales", cero contadores. **No existen.** PRODUCT.md es explícito y es la
única forma de arruinar esta página.

Del piso de calidad del repo: nada de kicker/eyebrow arriba de un título, nada
de tarjetas anidadas, nada de emoji como íconos, y **la sección "qué incluye"
no puede ser una grilla de tarjetas ícono+título+texto** — va lista densa.

## Deuda declarada

`PRICING.IVA_DISCLOSED = false` en `src/lib/landing.ts`. No está definido si
los $59.999 son finales o + IVA. Mientras esté en `false` la página no dice
nada al respecto: no lo afirma ni lo niega. Es la única pregunta abierta del
brief.
