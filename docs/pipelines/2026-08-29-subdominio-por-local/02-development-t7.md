# T7 — Coherencia host ↔ pedido en el seguimiento

**Lane**: frontend · **Agente**: frontend-react-craftsman · **Estado**: hecho.

## Archivo tocado

- `src/app/pedido/[token]/page.tsx` — único archivo, como pedía el brief. No
  toqué `src/lib/cart.tsx`, `src/lib/urls.ts`, `next.config.ts` ni ningún otro
  archivo del run (T4/T5/T6 en vuelo en paralelo).

## Qué cambió

Consumí `parseStoreHost` y `storeUrl` de `src/lib/urls.ts` (T4, ya "hecho",
API sin cambios respecto del contrato documentado en
`02-development-t4.md`). No necesité ningún ajuste de esa API.

1. **`generateMetadata`** nuevo: resuelve el pedido por token y setea
   `metadataBase: new URL(storeUrl(order.storeSlug, '/'))`. Es el origen
   EFECTIVO del pedido (subdominio de la tienda dueña en modo `subdomain`,
   apex en modo `path`) — deliberadamente **no** depende del host que sirvió
   el request, para que la metadata no cambie según por dónde haya entrado
   alguien a un link viejo. Si el token no existe, devuelve `{}` (sin filtrar
   nada distinto de lo que ya hace la página).

2. **Redirect de coherencia host↔pedido**, en el componente de la página,
   **después** de la guarda `if (!order) return <EmptyState .../>`:
   ```ts
   const requestSlug = parseStoreHost((await headers()).get('host'))
   if (requestSlug && requestSlug !== order.storeSlug) {
     permanentRedirect(storeUrl(order.storeSlug, `/pedido/${token}`))
   }
   ```
   `headers()` es async en Next 16 (verificado con Context7 contra
   `/vercel/next.js/v16.1.6`, igual que ya lo había verificado T4) y solo se
   puede usar en Server Component — esta page ya lo es. `permanentRedirect`
   acepta URL relativa o absoluta (verificado en el mismo doc y en
   `node_modules/next/dist/client/components/redirect.js`: el string se
   guarda tal cual en el digest del error, sin validar formato, y viaja como
   `Location` — mismo patrón que ya usan `emailRedirectTo`/`back_urls` en
   otras partes del repo con URLs absolutas del apex).

## Por qué el orden importa (criterio de aceptación 5)

El `if (!order)` sigue siendo la primera rama de la página, sin excepción.
El chequeo de host (`parseStoreHost` + comparación de slug + el eventual
`permanentRedirect`) corre **después**, solo quiere sentido y solo se ejecuta
cuando el pedido existe. Si el redirect dependiera de si el pedido existe o
no, el host se convertiría en un oráculo de existencia del `public_token`
(un 308 vs. un 200 filtraría el dato sin necesidad de leer el body) — el
`public_token` es la única credencial de este pedido, así que esto es un
requisito de seguridad y no un detalle de orden de código. Lo dejé anotado
como comentario en el propio archivo para que nadie lo reordene "por
prolijidad" en el futuro.

## Cobertura de los 7 criterios de aceptación de `01-tasks.md` §T7

1. **`la-birra.comandapp.ar/pedido/<token de La Birra>` → 200, sin redirect.**
   `parseStoreHost` devuelve `'la-birra'`, que coincide con
   `order.storeSlug` → `requestSlug !== order.storeSlug` es falso, no hay
   redirect.
2. **`otra.comandapp.ar/pedido/<token de La Birra>` → redirect permanente a
   `https://la-birra.comandapp.ar/pedido/<token>`.** `parseStoreHost` devuelve
   `'otra'`, distinto de `'la-birra'` → `permanentRedirect(storeUrl('la-birra',
   '/pedido/<token>'))`, que en modo `subdomain` arma exactamente esa URL.
3. **`comandapp.ar/pedido/<token>` → 200, sin redirect.** `parseStoreHost`
   devuelve `null` para el apex (mismo hostname que `apexOrigin().hostname`)
   → `requestSlug` falsy, no entra al `if`.
4. **`localhost:3000/pedido/<token>` → 200, sin redirect. Comportamiento
   igual a hoy.** `parseStoreHost` pela el puerto y compara contra el
   hostname del apex derivado de `NEXT_PUBLIC_SITE_URL`; en local ese apex es
   `localhost` (T4 lo documenta), así que también da `null`. Cero diferencia
   de comportamiento respecto de antes de este cambio.
5. **Token inexistente → `EmptyState`, sin filtrar por host.** Cubierto por
   el orden explicado arriba: el `if (!order)` retorna antes de tocar
   `headers()`/`parseStoreHost` para nada.
6. **El tema del local se sigue inyectando y el pie lo hereda.** No toqué esa
   parte del árbol (`buildThemeCss`/`themeClass`/`data-store-theme`/
   `SiteFooter` dentro del mismo div): sigue exactamente como estaba, después
   del bloque de redirect.
7. **`metadataBase` corresponde al origen efectivo del pedido.** Cubierto por
   `generateMetadata` (punto 1 arriba).

## Decisiones y trade-offs

- **No agregué manejo de error para `new URL(storeUrl(...))` en
  `generateMetadata`.** `storeUrl` siempre devuelve un string bien formado
  (`https://...`), documentado y verificado en T4 (`normalizePath` +
  `apexOrigin()` con `new URL` interno); no hay rama de esa función que
  devuelva algo no parseable, así que un `try/catch` ahí sería manejo de un
  caso que no existe.
- **No memoicé `getOrderStatus`** entre `generateMetadata` y la página (dos
  consultas por request cuando hay metadata que generar). Es el mismo patrón
  ya presente y documentado como pendiente en `src/app/[store]/layout.tsx`
  (comentario "A-03", tres llamadas a `getStoreBySlug` sin `React.cache()`);
  ese archivo no es mío para tocar y el modelo/controller tampoco, así que
  sumar acá el mismo patrón es consistente con lo ya aceptado en el repo, no
  una regresión nueva. Si se quiere resolver, es un cambio en
  `checkout.controller.ts` (envolver `getOrderStatus` en `React.cache()`) —
  cross-lane, no de este slice.
- **`permanentRedirect` con URL absoluta cross-origin**, no relativa. Es
  intencional: cuando el host no coincide, el destino correcto vive en OTRO
  origen (el subdominio de la tienda dueña), así que una ruta relativa no
  alcanzaría — verificado que Next no valida el formato del string pasado a
  `permanentRedirect`, solo lo propaga como `Location`.
- **No usé `redirect()` (307/302), usé `permanentRedirect` (308)** porque así
  lo pide el brief y porque semánticamente es correcto: la URL canónica de
  ESE pedido es siempre la del host de su propia tienda, no una condición
  transitoria.

## Qué NO hice (fuera de alcance, explícito)

- No toqué `OrderTracking`, el polling, ni `clearResolvedOrderCart` — eso es
  T5, como decía el brief.
- No toqué `src/lib/cart.tsx` ni `src/lib/urls.ts`.
- No agregué manejo especial para `?preview=brand` ni ningún otro query
  param — esta ruta no participa de ese mecanismo (es de `/[store]`, ver
  `00-architecture.md` §2.3).
- No escribí tests. `tests/**` es del `test-engineer`; los 7 criterios de
  arriba son literalmente su spec para esta ruta.

## Verificación

- `npm run typecheck` → limpio.
- `npm run lint` → limpio (los 6 warnings preexistentes son todos de
  `tests/**`, ajenos a este archivo).
- Repasé a mano los 4 casos de host contra la implementación real de
  `parseStoreHost`/`storeUrl` (no hay servidor levantado para probarlo en
  vivo: el flujo local de subdominios está fuera de alcance del plan — ver
  `00-architecture.md` §2.6 — así que esta verificación es estática hasta que
  T9 la corra en CI contra los datos de la tabla).

## Skills invocadas

`impeccable` (leí `reference/craft-floor.md` antes de editar — el cambio es
puramente lógico, sin tocar markup ni estilos, así que no hay hallazgo nuevo
de craft; el hook post-edición corrió y no reportó nada), `context7` (MCP,
`/vercel/next.js/v16.1.6`, para confirmar `permanentRedirect` y la async-ness
de `headers()`). No apliqué `vercel-react-best-practices` más allá de lo ya
descripto (el único punto de performance relevante —la doble consulta de
`getOrderStatus`— ya está documentado arriba como decisión, no como omisión).
`web-design-guidelines` no aporta nada nuevo: no hay markup ni copy nuevos
visibles al usuario en este slice (el único texto de usuario, el `EmptyState`,
no cambió).
