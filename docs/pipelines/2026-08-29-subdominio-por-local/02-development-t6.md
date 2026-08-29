# T6 — Links internos de la vitrina relativos al host

**Lane**: frontend · **Agente**: frontend-react-craftsman · **Estado**: hecho.

Contrato consumido: `docs/pipelines/2026-08-29-subdominio-por-local/02-development-t4.md`
(T4, `src/lib/urls.ts`). No toqué ese archivo ni ningún otro fuera de mi
propiedad exclusiva. `next.config.ts` cambió en el árbol durante el trabajo
(T3, en vuelo en paralelo) — no es mío, no lo toqué.

## Archivos tocados

- `src/views/storefront/store-base-path.tsx` — **nuevo**. `StoreBasePathProvider`,
  `useStoreBasePath()`, `storeHref(basePath, path)`.
- `src/app/[store]/layout.tsx` — resuelve `basePath` una vez con `headers()` +
  `storeBasePath()` (T4) y provee el árbol con `StoreBasePathProvider`.
- `src/app/[store]/checkout/page.tsx` — resuelve su propio `basePath` (Server
  Component, no puede usar el hook) para el link "Volver a la carta" en el
  estado "no está tomando pedidos".
- `src/app/mis-pedidos/page.tsx` — pasa el header `Host` crudo a `MyOrders`
  (vive fuera de `/[store]`, sin provider).
- `src/views/storefront/store-chrome.tsx` — logo → home, `isCatalogRoute`
  recalculado contra `homeHref` en vez de `` `/${slug}` ``.
- `src/views/storefront/store-dock.tsx` — el link del carrito (círculo y
  pastilla) en `CartSlot`.
- `src/views/storefront/product-card.tsx` — los dos links a la ficha de
  producto (`renderQuickAdd('photo')` y el link principal de la tarjeta).
- `src/views/storefront/product-detail.tsx` — el botón "volver" → home.
- `src/views/storefront/cart-view.tsx` — "Ver la carta" (carrito vacío) y el
  `router.push` a checkout.
- `src/views/storefront/checkout-form.tsx` — "Ver la carta" (carrito vacío).
- `src/views/storefront/my-orders.tsx` — "Reiterar", por fila.

## Diseño: por qué el helper vive donde vive (y por qué NO en `checkout-form`/pages)

Verificado contra Next 16 vía Context7 (`/vercel/next.js/v16.1.6`, código del
compilador RSC): **un Server Component no puede llamar una función exportada
de un módulo `'use client'`.** El transform de "use client" reemplaza CADA
export del módulo —función, constante, lo que sea— por una referencia de
cliente que tira en runtime ("it's not possible to invoke a client function
from the server"), no solo los componentes usados como JSX. Esto decidió la
partición:

- `store-base-path.tsx` es `'use client'` porque el `Context.Provider` lo
  exige. `useStoreBasePath()` y `storeHref()` viven ahí porque **solo los
  consumen Client Components** (los 7 archivos de `views/storefront/`, todos
  `'use client'` ya de antes) — eso es legal: un Client Component importando
  otro módulo cliente y llamando su función es un import normal, sin proxy.
- Los Server Components (`layout.tsx`, `checkout/page.tsx`) **nunca** importan
  `storeHref`/`useStoreBasePath`. Resuelven su propio string con
  `storeBasePath()` de `@/lib/urls` (T4, módulo isomórfico sin `'use client'`)
  y lo usan directo (`basePath || '/'`) o lo bajan como **prop serializable**
  (un string) al `StoreBasePathProvider`. Nunca se pasa una función a través
  del límite servidor→cliente.
- `mis-pedidos/page.tsx` (fuera de `/[store]`, sin provider) baja el header
  `Host` **crudo** a `MyOrders`, que resuelve un `basePath` **por fila** con
  `storeBasePath(ref.storeSlug, host)` — cada pedido guardado puede ser de una
  tienda distinta, así que no hay un único basePath de página.

## Los 10 `href` que cambiaron (y los que NO)

Todos pasan ahora por `storeHref(basePath, path)`, que resuelve:
`path === '/' ? (basePath || '/') : `${basePath}${path}``.

| Archivo | Antes | Ahora |
|---|---|---|
| `store-chrome.tsx` (logo) | `` `/${store.slug}` `` | `storeHref(basePath, '/')` |
| `store-chrome.tsx` (`isCatalogRoute`) | `pathname === \`/${store.slug}\`` | `pathname === homeHref` |
| `store-dock.tsx` (carrito, círculo) | `` `/${store.slug}/carrito` `` | `storeHref(basePath, '/carrito')` |
| `store-dock.tsx` (carrito, pastilla) | ídem | ídem |
| `product-card.tsx` (quick-add con opciones) | `` `/${storeSlug}/producto/${id}` `` | `storeHref(basePath, \`/producto/${id}\`)` |
| `product-card.tsx` (link principal) | ídem | ídem |
| `product-detail.tsx` (botón volver) | `` `/${store.slug}` `` | `storeHref(basePath, '/')` |
| `cart-view.tsx` (carrito vacío) | `` `/${storeSlug}` `` | `storeHref(basePath, '/')` |
| `cart-view.tsx` (ir a checkout) | `` `/${storeSlug}/checkout` `` | `storeHref(basePath, '/checkout')` |
| `checkout-form.tsx` (carrito vacío) | `` `/${storeSlug}` `` | `storeHref(basePath, '/')` |
| `checkout/page.tsx` (local cerrado) | `` `/${store.slug}` `` | `basePath || '/'` (Server Component, sin el helper de cliente) |
| `my-orders.tsx` ("Reiterar") | `` `/${ref.storeSlug}?reorder=${ref.token}` `` | `basePath === '' ? \`/?reorder=${token}\` : \`${basePath}?reorder=${token}\`` |

**No cambiaron** (a propósito, y por qué):
- `store-chrome.tsx` → `<Link href="/mis-pedidos">`: esa ruta vive **fuera**
  de `/[store]` y nunca se reescribe (§5.1 de `00-architecture.md`) — nunca
  tuvo el slug adentro, no hay nada que arreglar.
- `my-orders.tsx` → `<Link href={\`/pedido/${ref.token}\`}>`: mismo caso,
  `/pedido/*` tampoco se reescribe. Coherencia host↔pedido es de **T7**, no de
  este slice.
- `brand-preview.tsx` (no es mío): el iframe de vista previa sigue apuntando al
  apex path-based, sin tocar.

## `isCatalogRoute`: el bug que el cambio de host destapaba

Verificado contra Next 16 vía Context7 (código de `usePathname`/
`fetch-server-response.ts`): `usePathname()` refleja el **`canonicalUrl`**, o
sea la URL visible en la barra del browser — la ORIGINAL, previa al rewrite,
nunca el destino interno. Con la comparación vieja (`pathname === \`/${store.slug}\``),
en un subdominio de tienda la URL del catálogo es `/` (no `` /${slug} ``), así
que `isCatalogRoute` daba `false` en el home real y el dock/footer del
catálogo dejaban de dibujarse. Lo arreglé comparando contra `homeHref`
(`storeHref(basePath, '/')`), que resuelve a la misma raíz en los dos modos.
Es un bug que el cambio de arquitectura destapa, no algo que T6 pidiera
explícitamente — lo arreglé porque sin esto el criterio de "cero cambios
visuales" se rompe apenas se navega por subdominio.

## `storeSlug` como prop "vestigial" en `ProductCard` y `CartView`

`catalog-list.tsx` (dueño: otro slice, `/[store]/page.tsx` probablemente) y
`/[store]/carrito/page.tsx` (tampoco mío) siguen pasando `storeSlug={store.slug}`
a `ProductCard`/`CartView` — no puedo tocar esos archivos. Dos casos distintos:

- **`ProductCard`**: `storeSlug` ya no se usa para nada (el link sale de
  `useStoreBasePath()`). Lo dejé en el TIPO de props pero **no lo destructuro**
  — TypeScript permite un tipo con más propiedades que las que se extraen del
  objeto, así que no queda una variable sin usar (cero ruido de lint) y el
  call site de `catalog-list.tsx` sigue tipando bien (sacarlo del tipo sería un
  error de propiedad excedente en un objeto literal JSX). Comentario en el
  archivo explica el motivo.
- **`CartView`**: `storeSlug` SÍ se sigue usando — lo consume
  `usePricedLines(storeSlug, lines)` para cotizar contra el servidor. No es
  vestigial, no necesitó tratamiento especial.
- **`CheckoutForm`**: mismo caso que `CartView`: `storeSlug` alimenta
  `useCheckoutQuote(storeSlug, ...)`, se mantiene.

## `mis-pedidos`: "por tienda" es un efecto del host, no algo que yo implementé

El mensaje de la orquestación marcaba como decisión de producto que "Mis
pedidos" pase a ser por tienda. Verificado contra `00-architecture.md` §5.1:
esto **no es lógica de filtrado que haya que escribir** — es una consecuencia
de que `/mis-pedidos` no se reescribe (T3) y de que `localStorage` es por
origen. En un subdominio de tienda, el cliente nunca escribió en
`localStorage` referencias de otro local (nunca visitó ese origen), así que
`getSavedOrders()` ya devuelve solo lo suyo sin que `MyOrders` tenga que
preguntar nada. Lo único que sí me tocaba de esto es el link de "Reiterar"
(ver tabla arriba) — el resto de la "vista por tienda" no tiene código porque
no lo necesita.

## Contratos respetados

- **Cero cambios visuales.** No toqué una clase, un componente de
  `shared/surfaces.tsx`, ni una estructura de markup — solo valores de `href`
  y una comparación de string. Confirmado con `git diff`: todos los diffs son
  imports nuevos, hooks nuevos, y el string que llega a `href=`/`onClick`.
- **No se tocó `src/lib/preview-mode.ts` ni `preview-bridge.tsx`.**
- **No se tocó `src/lib/urls.ts`** (T4) ni `next.config.ts` (T3, en vuelo en
  paralelo — lo vi cambiar en `git diff --stat`, no lo toqué).
- **El vocabulario nuevo es de presentación**: `useStoreBasePath`/`storeHref`
  no se agregaron a `src/models/types.ts`.
- **No se re-abrió la decisión de identidad visual**: no corrí `context.mjs`
  ni `concept-seed.mjs`, no hay seed nuevo.

## Verificación

- `npm run typecheck` → limpio.
- `npm run lint` → limpio en todo lo mío. Los 6 warnings preexistentes son de
  `tests/**` (otro slice — test-engineer), no tocados por mí.
- Barrido de fuente manual (`grep -rn '`/\${.*slug' src/views/storefront src/app/[store] src/app/mis-pedidos`):
  las únicas coincidencias que quedan son comentarios explicando el patrón
  prohibido, ninguna en código vivo.
- `web-design-guidelines` (Vercel Web Interface Guidelines, vía Skill):
  reviewé el diff contra las reglas de navegación/foco/hidratación. Todos los
  `<Link>` siguen siendo `<Link>` (nunca `<a>` a mano, nunca `onClick` con
  `window.location` salvo el ya existente de MP en `checkout-form.tsx`, que no
  toqué). Sin riesgo de mismatch de hidratación: `basePath` se resuelve una
  sola vez en el servidor (`headers()` en el layout / la page) y baja como
  prop `string` serializable — nunca se recalcula en el cliente con
  `window.location` ni nada no determinístico, así que el HTML del servidor y
  el primer render del cliente coinciden siempre.

## Spec para el `test-engineer` (criterios de aceptación de `01-tasks.md` §T6)

1. **Host `la-birra.comandapp.ar`**: todo `href` interno de la vitrina (catálogo,
   ficha, carrito, checkout) resuelve a `/`, `/carrito`, `/checkout`,
   `/producto/42` — sin el slug. Se prueba llamando `storeBasePath('la-birra', 'la-birra.comandapp.ar')`
   → `''`, y `storeHref('', path)` para cada path.
2. **Host `comandapp.ar` (apex, path-based)**: los mismos `href` son
   `/la-birra`, `/la-birra/carrito`, etc. — idénticos a los de hoy.
   `storeBasePath('la-birra', 'comandapp.ar')` → `/la-birra`.
3. **Host `localhost:3000`**: idéntico a 2. `storeBasePath('la-birra', 'localhost:3000')` → `/la-birra`
   (el apex derivado de `NEXT_PUBLIC_SITE_URL` en local es `localhost`, nunca
   matchea un subdominio).
4. **Host de preview (`*.vercel.app`)**: idéntico a 2, por el mismo mecanismo
   (el host de preview nunca termina en `.comandapp.ar`).
5. **Barrido de fuente**: ningún archivo de `src/views/storefront/**` ni de
   `src/app/[store]/**` construye un `href` con el slug interpolado a mano
   (regex tipo `` `\`/\${.*slug` `` sobre código vivo, no comentarios).
6. **Vista previa de marca** (`comandapp.ar/admin/apariencia`, iframe con
   `?preview=brand`): navegar del catálogo a un producto adentro del iframe
   sigue funcionando — el host ahí es el apex, así que `basePath` sale
   `` /${slug} `` igual que hoy.
7. **`/mis-pedidos` en host de tenant**: "Reiterar" apunta a
   `/?reorder=<token>`. En el apex/local/preview: `` /<storeSlug>?reorder=<token> ``.
   Se prueba con `storeBasePath(ref.storeSlug, host)` por fila.
8. **Sin error de hidratación**: `basePath` viaja como prop `string` desde el
   servidor (nunca se recalcula con `window.location` en el cliente), así que
   el primer render del cliente coincide con el HTML del servidor.
9. **`isCatalogRoute` en `store-chrome.tsx`**: en host de tenant, la URL del
   catálogo es `/` — el dock y el pie de página del catálogo (`StoreDock`,
   `SiteFooter` sin `dock-clearance`... con `dock-clearance`) tienen que seguir
   dibujándose ahí, y NO en `/producto/*`, `/carrito`, `/checkout` (que ya
   tienen su propia `ActionBar`). Antes de este fix, comparar contra
   `` /${slug} `` rompía esto en subdominio — vale la pena un test explícito
   para no reintroducirlo.
10. **Targets táctiles y `aria-label`**: ningún `<Link>` tocado perdió su
    `aria-label` ni su tamaño (`iconButtonClass`, `h-11`, etc.) — el diff solo
    cambia el valor de `href`, nunca `className` ni la estructura del elemento.

## Qué NO hice (fuera de alcance, explícito)

- No toqué `src/lib/urls.ts` (T4), `next.config.ts` (T3), `src/app/pedido/**`
  (T7), ni nada de `src/controllers/`, `src/models/`, `src/services/`,
  `tests/`.
- No toqué `catalog-list.tsx`, `/[store]/page.tsx`, `/[store]/carrito/page.tsx`,
  `/[store]/producto/[id]/page.tsx`, `preview-bridge.tsx` ni
  `brand-preview.tsx` — ninguno estaba en mi lista de propiedad exclusiva, y
  los que le pasan props a mis vistas (`storeSlug`) siguen siendo compatibles
  sin editarlos (ver la sección de "prop vestigial" arriba).
- No agregué ningún test. `tests/**` es de `test-engineer`.
- No hice ningún cambio visual: cero clases, cero composición, cero motion
  nuevo — es plomería de URLs, tal como pedía el brief.
