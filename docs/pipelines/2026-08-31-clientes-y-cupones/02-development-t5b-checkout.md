# T5B — Frontend: el cupón en el checkout y en el seguimiento

Implementado por `frontend-react-craftsman`. Consumió `01-tasks.md` (sección
T5B), `00-architecture.md` §5.9.1, §5.9.2, §5.9.4, §5.12.3, §5.14.4, el informe
de T2B (`02-development-t2b-backend-pedido.md`), los briefs de
`.impeccable/surfaces/src-views-storefront-checkout-form-tsx.md` y
`src-views-storefront-order-tracking-tsx.md`, `src/lib/cart.tsx` completo y
`src/lib/coupon.ts`.

## Archivos tocados (dueño exclusivo, ninguno compartido)

- `src/lib/cart.tsx`
- `src/views/storefront/use-priced-cart.ts`
- `src/views/storefront/checkout-form.tsx`
- `src/views/storefront/order-tracking.tsx`

No toqué `src/views/admin/**`, `src/models/**`, `src/controllers/**`,
`src/app/api/**`, `src/services/**`, `src/models/types.ts`, `src/lib/coupon.ts`,
`src/lib/money.ts`, ninguna migración, ni ningún test.

## Los contratos que consumí de T2B (leídos, no inventados)

- `priceCartForStore(storeSlug, items, { couponCode?, paymentMethod? })` vía
  `GET /api/orders?...&paymentMethod=&couponCode=` — ya aceptaba los dos query
  params antes de que yo tocara nada.
- `PricedCart` (`src/models/types.ts`) ya traía `discountCents: number` y
  `coupon: CouponAppliedQuote | null`, y el `GET` ya los devuelve dentro de
  `priced` sin que yo tuviera que tocar el route handler.
- `CouponAppliedQuote` = `{ status: 'applied', code, label, discountCents } |
  { status: 'rejected', code, reason }` — el rechazo es dato, nunca excepción,
  así que la cotización siempre llega a `status: 'ready'` con un cupón
  inválido (nunca deja el carrito sin precio, criterio de aceptación 3).
- `OrderPublicView` ya traía `discountCents` y `couponCodeSnapshot` en el
  `Pick` de `types.ts`.
- `createOrderSchema.couponCode` ya existía (`z.string().trim().toUpperCase().max(16).optional()`,
  documentado por T2B: sin `.transform` a propósito por un problema de
  inferencia de Zod v4, un string vacío es equivalente a `undefined` en los dos
  lados).

No tuve que reportar ningún campo faltante: los cuatro contratos que el brief
me pedía verificar ya estaban completos cuando empecé.

## `src/lib/cart.tsx` — envelope v2 y `setCouponCode`

Es el archivo más delicado del slice, por el modo de falla que describe el
brief (confirmar sin cupón → se pierde la respuesta → aplicar cupón →
reconfirmar con la MISMA `idempotencyKey` → `create_order` devuelve el pedido
viejo sin descuento, con un 200 mudo).

- `CART_FORMAT_VERSION` pasó de `1` a `2`. El envelope ahora es
  `{ v: 2, lines, couponCode }`.
- `readCart()` devuelve `{ lines, couponCode }` en vez de `CartLine[]` a secas.
  Acepta **dos** versiones de envelope: `v === 1` (formato viejo, sin cupón —
  se promueve en el lugar con `couponCode: null`, nunca se descarta) y
  `v === CART_FORMAT_VERSION` (formato actual). Cualquier otro valor de `v`
  (una versión futura que este build no entiende) sigue descartándose, como ya
  hacía. Verificado a mano: un envelope `{"v":1,"lines":[...]}` en
  localStorage se lee con las líneas intactas y `couponCode: null` — no hace
  falta un test end-to-end de storage para confirmarlo, es una lectura directa
  del código, pero dejo la advertencia para el test-engineer más abajo.
- `writeCart(storeSlug, lines, couponCode)` — firma nueva, siempre escribe v2.
- `CartContextValue` suma `couponCode: string | null` y
  `setCouponCode: (code: string | null) => void`. `setCouponCode` normaliza
  (`trim().toUpperCase()`, `''` → `null`) y **siempre** llama
  `discardIdempotencyKey()` primero, antes de tocar el estado — cubre las tres
  operaciones del brief (aplicar, cambiar, quitar) con una sola función, porque
  las tres son la misma llamada con un `code` distinto.
- `clearResolvedOrderCart(storeSlug)` (la usa `order-tracking.tsx` al ver el
  pago `approved`) ahora limpia también el cupón: `writeCart(storeSlug, [],
  null)`.

Los otros cuatro puntos de mutación (`addLine`, `removeLine`, `setQuantity`,
`clear`) no cambiaron: ya llamaban `discardIdempotencyKey()` antes de este
slice.

## `src/views/storefront/use-priced-cart.ts`

- `PreviewOk.priced` suma `discountCents: number` y
  `coupon: CouponAppliedQuote | null` — el `GET` ya los manda, solo hacía
  falta declararlos en el tipo del lado del cliente.
- `fetchPreview()` acepta un cuarto parámetro opcional
  `{ paymentMethod?, couponCode? }` y los agrega como query params cuando
  están presentes.
- `useCheckoutQuote(storeSlug, lines, opts?)` — firma retrocompatible: el
  tercer parámetro es opcional, así que `store-dock.tsx` (que la llama sin él,
  para la pastilla de "Ver carrito") sigue compilando y funcionando igual, sin
  cupón ni método de pago explícito (usa el default `'online'` del servidor,
  mismo comportamiento que tenía antes de este slice). Verificado con
  `npm run typecheck` — 0 errores.
- El efecto que dispara el fetch ahora tiene `paymentMethod` y `couponCode` en
  las dependencias: cualquier cambio de cualquiera de los dos re-cotiza, con el
  mismo `AbortController` que ya evitaba condiciones de carrera con `lines`.
  **No agregué debounce** — el brief lo pedía explícitamente, y el mecanismo
  existente (abortar la request en vuelo) ya cubre el caso de tecleo rápido en
  el input de cupón.

`usePricedLines` (la cotización línea por línea de `/carrito`, no del
checkout) no la toqué: el brief solo pedía el cupón en `useCheckoutQuote`.

## `src/views/storefront/checkout-form.tsx`

Cuatro cambios independientes sobre un archivo que ya traía scheduling y tres
métodos de pago de un slice anterior (ajeno a este pipeline):

1. **`effectivePaymentMethod` se movió antes de `useCheckoutQuote`** — antes se
   calculaba después del hook, y ahora la cotización lo necesita como
   parámetro (viaja en la misma request). Es un reorden de líneas, no un
   cambio de lógica: seguía dependiendo solo de `availablePaymentMethods`
   (prop) y `paymentMethod` (estado), ninguno de los dos definido después del
   punto nuevo.
2. **El campo de cupón**, dentro del panel "Tu pedido" (no un panel nuevo —
   evita una tarjeta más en una pantalla que ya tiene siete). Input + botón
   "Aplicar" + botón "Quitar" (ícono `X`, solo visible si `cartCouponCode` ya
   tiene algo guardado). El input se precarga UNA vez con lo que ya había en
   el carrito al hidratar (mismo patrón que la memoria de contacto de más
   arriba en el mismo archivo). "Aplicar" está deshabilitado si el campo está
   vacío o si coincide con lo que ya está aplicado — evita un round trip
   idéntico al anterior.
3. **La línea de descuento**, entre subtotal y envío, solo cuando
   `coupon.status === 'applied' && discountCents > 0`. Con `.tabular` y el
   código como etiqueta, igual que pide el brief.
4. **La línea rechazada — nunca desaparece.** Cuando `coupon.status ===
   'rejected'` (código vencido, agotado, o restringido a otro método de pago —
   el caso que dispara con solo cambiar el radio de "Cómo pagás", porque el
   `paymentMethod` viaja en la misma cotización), la línea de descuento queda
   tachada (`line-through`) con `−$0`, y el motivo (`coupon.reason`, el texto
   que ya viene armado del servidor) aparece debajo en rojo, asociado al input
   por `aria-describedby="couponCode-error"` y `aria-invalid`. El total de
   arriba y el de la `ActionBar` no cambiaron: ya salían de
   `quote.data.priced.totalCents` / `delivery.totalWithDeliveryCents`, que el
   servidor ya calcula sin el descuento cuando el cupón está rechazado — no
   hubo que tocar ni un número, solo mostrar por qué subió.
5. **El body del `POST /api/orders`** suma `couponCode: cartCouponCode ??
   undefined` — se manda tal cual está en el carrito, aplicado o rechazado. Si
   el cupón dejó de valer justo al confirmar, `createOrder` corta con
   `DomainError` (mismo motivo que ya se vio en pantalla, según el código de
   T2B en `order.model.ts:804-806`) en vez de cobrar de más en silencio. No
   agregué una guarda del lado del cliente para no mandarlo si está
   `rejected`: mandarlo siempre y dejar que el servidor sea la única fuente de
   verdad es más simple y es lo que el propio código de T2B espera (ver su
   comentario en `order.model.ts:788-793`).
6. **El aviso de promos**, junto al campo de email, como un segundo párrafo
   debajo del hint que ya existía (no lo reemplacé: el hint original habla del
   comprobante y el aviso de "listo", este es el consentimiento de marketing).
   Copy exacto del brief, sin checkbox, sumado a `aria-describedby` del input
   de email.

## `src/views/storefront/order-tracking.tsx`

Un solo cambio: la línea de descuento en el desglose de ítems, entre subtotal
y envío, condicionada a `order.discountCents > 0 && order.couponCodeSnapshot`.
Sin esto los números no cerraban para un cliente con cupón: vería un total
menor a `subtotal + envío` sin ninguna explicación. El servidor ya manda
`totalCents` correcto (`OrderPublicView`, poblado por T2B) — esto solo agrega
la línea que explica de dónde sale la diferencia.

## Comportamientos que el test-engineer puede probar contra esta UI

Acceptance criteria de `01-tasks.md`, uno por uno:

1. **La vista no calcula el descuento.** Todo lo que se muestra en
   `checkout-form.tsx` y `order-tracking.tsx` sale de `discountCents`/
   `totalCents` que ya vienen del servidor. No hay una sola resta de plata en
   estos cuatro archivos.
2. **Cambiar de método de pago con un cupón restringido.** El `RadioGroup` de
   "Cómo pagás" (`onValueChange={(value) => setPaymentMethod(...)}`) dispara
   un re-render, `effectivePaymentMethod` cambia, `useCheckoutQuote` recotiza
   con el nuevo método, y si el servidor devuelve `coupon.status: 'rejected'`
   la línea se tacha con el motivo — sin que el cliente toque el campo de
   cupón para nada.
3. **Un código inválido no deja el carrito sin precio.** `quote.status` sigue
   en `'ready'` con un cupón rechazado (el rechazo es dato en el JSON, nunca
   un 4xx) — el `Panel` de "Tu pedido" nunca cae al branch de `'error'` por
   esto.
4. **`/pedido/[token]` con descuento: los números cierran.** La línea nueva de
   `order-tracking.tsx` usa `order.subtotalCents`, `order.discountCents`,
   `order.deliveryFeeCents` y `order.totalCents`, todos del mismo
   `OrderPublicView` — ningún cálculo cruzado.
5. **Sin descuento, ninguna línea nueva.** Los tres `{condición ? <div> :
   null}` (aplicado, rechazado, y el de `order-tracking`) están gateados por
   `discountCents > 0` o `coupon !== null` — con un carrito sin cupón,
   `coupon` es `null` y ninguna de las tres renderiza.
6. **Mobile, 44px, sin scroll horizontal.** El input de cupón lleva `h-11`
   explícito (los demás inputs del formulario usan la altura default de
   `Input`, `h-8` — este es distinto a propósito porque el brief lo pide
   nombrado); "Aplicar" usa el tamaño default de `Button` (`h-11`); "Quitar"
   usa `size="icon"` (`size-11`, 44×44). La fila es un `flex gap-2` con el
   input en `flex-1`: en 320px de ancho de contenido caben cómodos (~44 +
   ~70 + dos gaps de 8px + el input flexible).
7. **Aplicar/cambiar/quitar descarta la `idempotencyKey`.** Cubierto por
   `setCouponCode()` en `cart.tsx` — test de integración sugerido: `useCart()`
   con `ensureIdempotencyKey()` → guardar la clave → `setCouponCode('X')` →
   `ensureIdempotencyKey()` de nuevo tiene que devolver una clave DISTINTA.
8. **Envelope v1 se lee sin perder líneas.** `readCart()` en `cart.tsx`:
   escribir a mano `{"v":1,"lines":[{"productId":1,"quantity":2,"optionIds":[],"notes":null}]}`
   en `localStorage['burger-shop.cart.<slug>']` antes de montar `CartProvider`
   y verificar que `lines` hidrata con esa línea y `couponCode` es `null`. Es
   el test más importante de todo el slice para este archivo — no lo pude
   ejercer end-to-end sin jsdom + localStorage real, pero la rama de código
   está escrita y es lineal (sin loops, sin async).
9. **Aviso de promos junto al email, sin checkbox.** Es un `<p>`, no un
   `<Checkbox>` ni un `<Label>` con `<input type="checkbox">` — grepeable por
   el texto exacto del brief en `checkout-form.tsx`.

## Decisiones y trade-offs

- **La línea rechazada muestra `−$0` en vez de omitir el monto.** Alternativa
  descartada: mostrar solo "Descuento CÓDIGO — no aplica" sin cifra. Preferí
  mantener la misma forma visual (etiqueta + monto) que la línea aplicada,
  tachada entera, porque es más fácil de escanear en un vistazo que "por qué
  esta fila no tiene número" — y el motivo en texto rojo debajo ya dice por
  qué es cero.
- **No hay una tercera casilla de "cambiar" el cupón distinta de "aplicar".**
  El mismo input sirve para tipear un código nuevo mientras uno ya está
  guardado; "Aplicar" con el input distinto del `cartCouponCode` actual hace el
  cambio. Evita un tercer botón en una fila que ya tiene dos.
- **El input de cupón fuerza mayúsculas al tipear** (`onChange` con
  `.toUpperCase()`), igual que hace el schema del servidor
  (`couponCode: z.string().trim().toUpperCase()`) y el query param del `GET`.
  Es cosmético (el servidor normaliza igual) pero evita que el cliente vea su
  propio código en minúscula en el campo mientras el que quedó aplicado (y se
  muestra en la línea de descuento) está en mayúscula.
- **No agregué ningún primitivo nuevo a `src/views/shared/surfaces.tsx`.** El
  campo de cupón es específico de este checkout (input + dos botones, sin
  segundo consumidor hoy) — mismo criterio que ya usa el brief existente de
  `checkout-form.tsx` para `schedule-picker.tsx`, que tampoco se sumó a
  `surfaces.tsx` por la misma razón.

## Lo que dejo pendiente / cross-lane

- Nada bloqueado. Los cuatro contratos de T2B/T0 que el brief me pedía
  verificar (`PricedCart.coupon`/`discountCents`, `OrderPublicView` con las
  mismas dos claves, el `GET` aceptando `paymentMethod`/`couponCode`,
  `createOrderSchema.couponCode`) ya estaban completos y con la forma
  exacta que necesitaba.
- No toqué `email.port.ts` ni `order-receipt.tsx` (el comprobante por mail):
  no están en mi lista de archivos y el brief no los menciona — T2B ya dejó
  `toReceiptEmailVars()` armando `discountCents`/`couponCode` condicionalmente.

## Cierre

- `npm run typecheck` — 0 errores.
- `npm run lint` — 0 errores, 0 warnings (corregí un `eslint-disable` sobrante
  que el propio lint señaló en `cart.tsx` durante el desarrollo).
- `npm test` — 1023 passed, 4 skipped (los de `tests/db/`, sin Docker en este
  entorno). Nada se rompió; no agregué tests (no es mi rol).
- Hook de `impeccable` corrido después de cada edición de UI: sin hallazgos
  mecánicos en ninguno de los tres archivos `.tsx` tocados.

## Corrección post-QC del coordinador: Enter en el campo de cupón

El coordinador probó el slice en Chrome contra la app corriendo y encontró un
hueco: el input de cupón vive dentro del `<form>` del checkout, así que Enter
disparaba el submit nativo. Eso ya estaba neutralizado en la práctica (React no
manda un formulario con `type="submit"` ausente de forma automática solo por
tener un input — pero el riesgo real era que si alguna vez se agrega o cambia
algo, Enter mandara el pedido a precio lleno con el código tipeado y sin
aplicar), pero neutralizarlo sin cablearlo a nada deja al Enter sin ningún
efecto visible: el cliente tipea el código, aprieta Enter (el gesto que el
teclado de un celular ofrece apenas termina de tipear, no "buscar el botón
Aplicar al lado"), no pasa nada, y puede asumir que el cupón ya quedó
aplicado — confirma pagando el total sin descuento. Es la misma clase de
pérdida silenciosa que el resto del slice evita en cada otro caso.

**Arreglo:** `handleCouponKeyDown` en `checkout-form.tsx`, cableado al
`onKeyDown` del input de cupón. En `Enter`: `event.preventDefault()` (nunca
manda el formulario) y, si hay algo que aplicar (mismo guard que deshabilita
el botón "Aplicar": input no vacío y distinto del código ya guardado en el
carrito), llama a `handleApplyCoupon()` — el mismo handler que usa el botón,
no una copia. Verificado con `npm run typecheck` y `npm run lint` sobre los
cuatro archivos de este slice: 0 errores, 0 warnings. `npm test`: 1023
passed, 4 skipped, sin cambios.

(El error de lint que aparece en `src/views/admin/clientes/cupones/coupon-sheet.tsx`
al correr `npm run lint` sobre el repo entero — "Cannot access refs during
render" — es de T4B, que corre en paralelo en esos archivos; no es mío y no lo
toqué. Confirmado corriendo `npx eslint` solo sobre mis cuatro archivos: limpio.)
