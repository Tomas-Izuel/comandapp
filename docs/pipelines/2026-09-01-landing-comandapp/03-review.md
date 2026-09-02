# Review — Landing de ComandApp

**Verdict: APROBADO**

## Alcance revisado

```
 src/app/globals.css | 76 +++++++++++++++++
 src/app/page.tsx    | 101 ++++++++++++++++----
```
más los archivos nuevos (sin diff, `git status` los marca `??`):

```
src/app/robots.ts
src/app/sitemap.ts
src/lib/landing.ts
src/lib/seo.ts
src/views/landing/{closing,delivery,edge,faq,hero,included,landing-bar,
                    landing-footer,pricing,screens,versus}.tsx
tests/lib/{landing,landing-routes,landing-source-scan,seo}.test.ts
public/landing/{og.jpg,pantalla-*.png}
public/{full-logo-horizontal.png,full-logo-vertical.png,Logo.png,
        Background-full-logo.jpg,Background-simple-logo.jpg}
```

Confirmado con `git status --porcelain` que **ningún otro archivo del repo se
tocó**: `:root`, `src/app/layout.tsx`, `next.config.ts`, `src/app/[store]/**`,
`src/views/shared/**` y `SiteFooter` quedan exactamente como estaban.

## Verificaciones ejecutadas (no solo leídas)

- `npm run build`: `/` sale `○ (Static)`, junto con `/robots.txt` y
  `/sitemap.xml`. Cero rutas dinámicas nuevas.
- `npm test`: **103 archivos, 1305 tests, 4 skipped** (los de `tests/db/`, sin
  Docker) — coincide con lo que reporta `03-tests.md`.
- Contraste WCAG recalculado desde los `oklch()` reales de
  `[data-comandapp]` (no tomado de la palabra del comentario):
  - `primary` / `primary-foreground` (navy sobre verde) → **7.93** ✓
  - blanco sobre `primary` → **2.18** ✗ (por eso no se usa en ningún lado — confirmado por grep, cero `text-white` en la landing)
  - `background` / `--brand-ink` → **4.99** ✓
  - `accent` / `accent-foreground` (las tres bandas navy) → **16.10** ✓
  - Foco: `accent`/`--ring` → 3.23, `background`/`--ring` → 4.99 — el
    `outline-offset: 2px` hace que el anillo se dibuje siempre contra el
    fondo de página, no contra el botón, así que pasa el mínimo de 3:1 en
    todos los casos reales de esta página.
  - `grep` confirmó cero `text-*/<opacidad>` sobre texto real en toda
    `src/views/landing/**`; la única clase con opacidad sobre texto
    (`text-muted-foreground/50` en `landing-footer.tsx:35`) es el separador
    `·` decorativo con `aria-hidden`.
- `grep -in "\bIVA\b"` sobre los componentes: la palabra solo aparece en un
  comentario y en la condición `{PRICING.IVA_DISCLOSED ? ' + IVA' : ''}` de
  `pricing.tsx:54`. Con el flag en `false` no se renderiza. El test
  `landing-source-scan.test.ts` ya lo prueba sobre el HTML renderizado, no
  sobre el texto fuente — es el enfoque correcto y lo repliqué a mano.
- `grep -c "whatsappHref()"` sobre los cuatro CTA (`landing-bar`, `hero`,
  `pricing`, `closing`): los cuatro lo usan. Cero URLs de `wa.me` armadas a
  mano fuera de `src/lib/landing.ts`. `target="_blank"` + `rel="noopener
  noreferrer"` presentes en los cuatro.
- Cero `'use client'` en `src/views/landing/**`, `page.tsx`, `robots.ts`,
  `sitemap.ts`.
- Cada afirmación comercial de `included.tsx`, `faq.tsx`, `delivery.tsx` y
  `edge.tsx` la crucé contra el código real: catálogo/carrito/delivery/pago
  (`order.model.ts`, `store-availability.ts`), "mis pedidos" y repetir pedido
  (`views/storefront/reorder-handler.tsx`), panel de cocina, dashboard,
  **cupones y campañas** (`models/coupon.model.ts`, `campaign.model.ts` —
  confirmado por el merge reciente `feat/cupones-y-campanas`), **padrón de
  clientes** (`models/customer.model.ts` — merge `feat/clientes-y-cupones`),
  marca por local y subdominio. Todo lo que la página afirma que existe,
  existe. Cero métrica de uso, testimonio, logo de cliente o caso de éxito en
  ningún componente ni en el JSON-LD (`grep` de `aggregateRating`, `review`,
  `ratingValue`, `testimonio` → cero resultados fuera de los comentarios que
  explican por qué no están).
- Precio del `Offer` en `seo.ts`: `centsToDecimal(5_999_900).toFixed(2)` →
  `"59999.00"`, no centavos. Correcto.

## Hallazgos (ninguno bloqueante)

### Minor

1. **CTA de WhatsApp duplicado casi literal en cuatro archivos.**
   `src/views/landing/landing-bar.tsx:45-63`, `hero.tsx:71-86`,
   `pricing.tsx:66-75` y `closing.tsx:23-31` repiten la misma cadena de
   clases (`bg-primary text-primary-foreground hover:bg-primary/90
   touch-manipulation inline-flex ... rounded-pill ... active:scale-[0.97]`)
   más el mismo bloque de comentario explicando por qué
   `[&_path]:fill-current` gana sobre el `fill="#25D366"` del SVG — escrito
   dos veces casi palabra por palabra (Slice A y Slice C, dos agentes en
   paralelo que no se vieron entre sí). Funciona correctamente en los cuatro
   lugares, pero es exactamente el tipo de vocabulario divergente que un
   corte en slices paralelos produce: un tamaño de botón que cambie mañana
   (por ejemplo el radio o el `active:scale`) hay que tocarlo en cuatro
   archivos y confiar en que a nadie se le escape uno. Sugerencia: extraer un
   `WhatsAppCtaLink` en `src/views/landing/` que reciba `size`/`children` y
   sea la única fuente de esa clase. No bloquea porque hoy los cuatro son
   consistentes entre sí.

2. **Cuatro assets de marca sin usar en `public/`.** `Logo.png` (13KB),
   `Background-full-logo.jpg` (295KB), `Background-simple-logo.jpg` (291KB) y
   `full-logo-vertical.png` (23KB) — ~620KB — no aparecen en ningún `grep` de
   `src/`. Solo se usa `full-logo-horizontal.png` (en `landing-bar.tsx` y
   `landing-footer.tsx`). Son PNG/JPG sueltos en la raíz de `public/`, con
   `PascalCase` que además desentona con el resto de `public/landing/` (todo
   en minúsculas). Si no hay un uso planeado inmediato, no deberían
   commitearse — es peso muerto en el bundle público.

### Nit

3. **Manifiesto de capturas vs. archivos reales.** `01-tasks.md` especifica
   `pantalla-*.webp`, pero el hilo principal entregó `.png` reales y los tres
   componentes que las consumen (`hero.tsx`, `screens.tsx`, `delivery.tsx`)
   usan `.png` de forma consistente entre sí. No hay ningún componente que
   busque un `.webp` inexistente — todo enlaza correctamente — pero vale
   dejar anotada la divergencia con el manifiesto para que no confunda a
   quien lo lea después.

4. **`ThreeScreens()` renderiza cuatro capturas, no tres.**
   `screens.tsx:30-32` lo señala explícitamente en un comentario ("el nombre
   exportado sigue siendo `ThreeScreens` porque así lo fija el contrato...").
   Es una decisión documentada y transparente, no un descuido, pero el
   nombre de la función queda desalineado con lo que hace para cualquiera
   que la lea sin el comentario.

5. **`id="precio"` y `id="faq"` sin `data-scroll-anchor`.** `pricing.tsx:20`
   y `faq.tsx:49` exponen anclas de sección, pero no llevan el atributo
   `[data-scroll-anchor]` que en `globals.css:379-381` aplica
   `scroll-margin-top` para que la barra `sticky` no tape el título al saltar
   ahí. Hoy nada dentro de la página linkea a esos anchors (no hay nav
   interno), así que no es un bug activo — pero si algún día se manda un link
   externo a `comandapp.ar/#precio` (un caso de uso natural para este tipo de
   ancla), el `LandingBar` sticky va a tapar parcialmente el encabezado.

6. **`.impeccable/questions/4b6da537.log`** quedó como archivo suelto sin
   trackear en el working tree. Es un artefacto de la herramienta, no parte
   del feature — no debería terminar en el commit.

7. **La promesa de integración "sin rehacer nada" / "sin cargar nada dos
   veces"** (`edge.tsx:31-36`, FAQ ítem 2 en `faq.tsx:16-18`) reproduce
   literalmente el posicionamiento ya aprobado en `PRODUCT.md` ("Positioning",
   punto 2), así que no es una afirmación nueva ni inventada por esta
   superficie. Vale la pena tenerlo presente igual: la implementación real es
   un outbox (`order_events` → POST firmado a `pos_endpoints`), que requiere
   que el sistema del local exponga un endpoint compatible o que se escriba
   un `PosAdapter` — no es un enchufe automático a cualquier POS existente.
   No pido cambiar el texto (ya es la voz de producto aprobada), solo lo
   marco porque es la frase que un dueño escéptico va a poner a prueba
   primero.

## Qué está bien

- La trampa de contraste del brief está resuelta con precisión quirúrgica:
  medí los mismos tres pares a mano desde los valores `oklch()` crudos y dan
  exactamente 7.93 / 2.18 / 4.99, los mismos números que documenta
  `00-architecture.md` y el comentario de `globals.css`. Cero texto blanco
  sobre verde, cero `text-primary` suelto fuera de íconos decorativos.
- El mecanismo de `IVA_DISCLOSED` es correcto y está probado de la forma
  correcta (`renderToStaticMarkup`, no grep de fuente) — evita el falso
  positivo que un grep ingenuo hubiera producido contra la propia línea que
  implementa la regla.
- Aislamiento de scope impecable: `[data-comandapp]` no toca `:root`, no se
  tocó `layout.tsx` ni ningún archivo de otra superficie, y el build lo
  confirma (`/[store]`, `/admin`, `/backoffice` siguen `ƒ` como siempre).
- Cien por ciento estático de verdad: sticky por CSS, acordeón por
  `<details>` nativo, CTA por `<a>`, sin un solo `'use client'`.
- Cada afirmación de venta es verificable contra el modelo real — no
  encontré ni una promesa que no exista en `src/models/` o `src/app/`.
- El uso de `preload` (no `priority`) en las imágenes es la API correcta de
  esta versión de Next 16, y el manejo del `sizes` para que el candidato de
  preload sea mínimo en mobile (donde la imagen del hero está oculta) es un
  detalle de performance bien pensado, no un accidente.
- Piso de calidad del repo respetado en las once secciones: cero kicker,
  cero `Panel` anidado, cero emoji como ícono, `WhatsIncluded` es una lista
  densa en columnas y no una grilla de tarjetas, `rounded-(--radius)` usado
  correctamente donde corresponde.

## Bloqueantes

Ninguno.
