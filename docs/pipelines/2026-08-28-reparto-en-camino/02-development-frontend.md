# Slice frontend — elección retiro vs delivery en el checkout del cliente

No encontré un `01-tasks.md` propio para este slice (el runbook llegó en el
prompt del orquestador, con el contrato ya fijado: `DeliveryQuote` en
`src/models/types.ts`, los cinco campos planos de `createOrderSchema`). Dejo
este log en `docs/pipelines/2026-08-28-reparto-en-camino/`, junto al
`02-development-backend.md` del agente de "reparto en camino" que ya estaba
ahí — mismo run, distinto lane (mi slice es checkout del cliente, el de
backend es asignar repartidor + `on_the_way`).

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/views/storefront/checkout-form.tsx` — bloque "Cómo lo recibís" nuevo
  (reemplaza "Dónde retirás"), línea de Envío + ETA con viaje en "Tu pedido",
  total condicional en el `ActionBar`, payload del `fetch` con los 5 campos
  nuevos, guardado de dirección tras éxito.
- `src/views/storefront/use-priced-cart.ts` — `PreviewOk` gana `delivery:
  DeliveryQuote`. Un solo request, sin tocar `usePricedLines` (el del
  carrito, que no cotiza envío).
- `src/views/storefront/store-hero.tsx` — la banda dice "Retiro y delivery" o
  "Retiro en el local" según `store.delivery.enabled`, y muestra el costo si
  hay uno configurado.
- `src/lib/customer.ts` — `SavedCustomer` gana 4 campos de dirección
  opcionales; `CUSTOMER_FORMAT_VERSION` pasa a 2 con lectura tolerante (ver
  decisión abajo).
- `src/views/storefront/cart-view.tsx` — revisado, **sin cambios**: el
  comentario de la línea 228 ("El envío... se confirman en el siguiente
  paso") ya era correcto y el carrito no cotiza envío, que es lo que se pidió
  verificar.
- `src/app/[store]/checkout/page.tsx` — revisado, **sin cambios**: no
  necesita props nuevas, todo lo de delivery llega por la respuesta de
  `useCheckoutQuote` en el cliente.

No toqué `src/models/**`, `src/controllers/**`,
`src/app/api/orders/route.ts`, `src/lib/cart.tsx`, `src/lib/delivery.ts`,
`order-tracking.tsx`, `src/views/shared/order-status.tsx`, ni migraciones.

## Contrato consumido

`GET /api/orders?storeSlug=&items=` devuelve (ya lo hacía) `{ store, priced,
eta, delivery }`. Le agregué el tipo `delivery: DeliveryQuote` a `PreviewOk`
en `use-priced-cart.ts` — el campo ya viajaba en runtime del lado del
backend, esto solo lo declara en TypeScript del lado del cliente. Todos los
campos de `DeliveryQuote` (`enabled`, `available`, `unavailableReason`,
`feeCents`, `freeFromCents`, `missingForFreeCents`, `minutesToAdd`,
`allCouriersBusy`, `totalWithDeliveryCents`) se leen tal cual — el browser no
suma plata ni reescribe `unavailableReason`.

**Único cálculo que hace el browser**: `eta.etaMinutes +
delivery.minutesToAdd` cuando el método es delivery, para mostrar "Listo en
X min" con el viaje incluido. Esto es TIEMPO, no plata — el campo
`minutesToAdd` está documentado en `types.ts` exactamente como "los minutos
que se suman al ETA si elige delivery", así que sumarlo en el cliente es lo
que el contrato pide, no una violación de "el servidor pone el precio". El
total en pesos siempre sale de `delivery.totalWithDeliveryCents`, ya sumado
por el servidor — nunca `priced.totalCents + delivery.feeCents` calculado acá.

## Decisiones de diseño / trade-offs

### 1. `effectiveDeliveryMethod` derivado, no un efecto con `setState`

Mi primer intento corrig_ el método a `'pickup'` con un
`useEffect` cuando `delivery` dejaba de estar disponible mientras estaba
elegido. El hook de `impeccable`/eslint (`react-hooks/set-state-in-effect`)
lo marcó como error: "calling setState synchronously within an effect can
trigger cascading renders". Lo reemplacé por un valor derivado en el cuerpo
del componente:

```ts
const effectiveDeliveryMethod: DeliveryMethod =
  deliveryMethod === 'delivery' && (!delivery || !delivery.enabled || !delivery.available) ? 'pickup' : deliveryMethod
```

`deliveryMethod` (el estado crudo) solo lo toca el `onValueChange` del
`RadioGroup`. Todo lo demás —el `value` que el propio radio muestra, el
payload del submit, el guardado de dirección, los tres bloques de UI que
muestran envío/total/ETA— lee `effectiveDeliveryMethod`. Si el envío se cae
mientras estaba elegido (refetch de la cotización, o la tienda lo deshabilitó),
la UI se corrige sola en el mismo render sin un round-trip de efecto.

### 2. `CUSTOMER_FORMAT_VERSION`: subí a 2, pero con lectura tolerante 1..2

El brief pedía "bumpeá `CUSTOMER_FORMAT_VERSION` y hacé que
`isSavedCustomer` tolere la ausencia de los campos nuevos, o la memoria de
nombre/teléfono de TODOS los clientes actuales se descarta". Noté que
`cart.tsx` (el patrón que se pide seguir) descarta TODO ante cualquier
desajuste de versión — igualdad estricta. Si hubiera copiado ese patrón al
pie de la letra, subir la versión a 2 habría descartado la memoria de
CUALQUIER cliente que ya tuviera guardado un registro v1 (nombre/teléfono),
exactamente lo que el brief dice que hay que evitar — porque el chequeo de
versión corta ANTES de llegar a `isSavedCustomer`, así que la tolerancia de
campos no alcanza a salvarlo.

Solución: `getSavedCustomer` acepta cualquier `version` entre 1 y
`CUSTOMER_FORMAT_VERSION` (rechaza solo una versión FUTURA que este build no
conozca), y confía en que `isSavedCustomer` — con los 4 campos nuevos
opcionales — valide igual un registro v1 (que directamente no tiene esas
claves) como una forma válida de v2. Ningún cliente existente pierde su
nombre/teléfono; los registros nuevos ya se escriben como v2.

### 3. `saveCustomer`: merge solo para la dirección, no para nombre/teléfono/email

Nombre/teléfono/email siguen el patrón exacto de antes: lo que llega en
`data` reemplaza lo guardado, sin merge (esos tres campos están SIEMPRE
visibles y editables, así que lo que hay en pantalla es lo que el cliente
quiere guardar, incluido vaciarlos a propósito).

La dirección de delivery es distinta a propósito: un pedido de **retiro** no
manda ningún campo de dirección (`effectiveDeliveryMethod === 'delivery'`
gatea el spread en el `saveCustomer({...})` del submit). Si `saveCustomer`
reemplazara sin merge, elegir retiro una sola vez borraría la dirección que
el cliente había dejado guardada para su próximo delivery. Por eso
`saveCustomer` combina cada campo de dirección con `getSavedCustomer()` antes
de escribir: `data.deliveryAddressLine ?? previous?.deliveryAddressLine`.

**Trade-off aceptado, documentado por si `code-reviewer` lo marca**: si un
cliente hace un pedido de delivery y esta vez deja "Piso/Depto" en blanco a
propósito (antes vivía en un piso, ahora entrega en planta baja), el merge lo
va a rellenar con el valor viejo en la PRÓXIMA precarga, porque no hay forma
de distinguir "no corresponde a este pedido" (retiro) de "corresponde pero
está vacío" (delivery, campo opcional dejado en blanco) una vez que ambos
llegan como `undefined`. Es un campo opcional de baja fricción (piso/entre
calles/referencias); no lo resolví porque hacerlo bien requeriría un tercer
estado ("explícitamente vacío" vs "no aplica") que no vale la complejidad para
un dato de esta importancia.

### 4. "Cómo lo recibís": tres estados, no dos

- `delivery` es `null` (la cotización todavía está en `loading`/`error`) o
  `!delivery.enabled` (el local no ofrece delivery): el bloque queda EXACTO a
  como estaba ("Dónde retirás", solo la dirección del local, sin radio). Este
  es el fallback intencional durante el primer render, antes de que
  `useCheckoutQuote` resuelva.
- `delivery.enabled && !delivery.available`: las dos opciones se dibujan, la
  de delivery deshabilitada (`RadioGroupItem disabled`, `aria-disabled` en el
  `Label`, `opacity-45` — mismo valor que usa `OptionRow` para disabled en
  `shared/surfaces.tsx`) con `delivery.unavailableReason` tal cual, sin
  reescribirlo.
- `delivery.enabled && delivery.available`: las dos opciones habilitadas: al
  elegir delivery se revelan los 4 campos de dirección.

`allCouriersBusy` es ortogonal a `available` — nunca deshabilita nada, solo
agrega un aviso (`role="status" aria-live="polite"`, tono warning tomado de
`--warning`/`--warning-foreground` con la MISMA opacidad `bg-warning/20` que
ya usa `StatusPill` en `surfaces.tsx`, no inventé un tono nuevo).

### 5. No agregué primitivas nuevas a `shared/surfaces.tsx`

Todo se compuso con lo que ya existía (`Panel`, `ActionBar`, `Price`,
`RadioGroup`/`RadioGroupItem`/`Label`/`Input`/`Textarea` de shadcn). El aviso
de "todos los repartidores en la calle" es un `<div>` de una sola línea con
un ícono `Info`; no lo extraje a `surfaces.tsx` porque es específico de este
flujo (no hay un segundo lugar en el producto que lo necesite hoy) — si
aparece un segundo consumidor, ahí sí vale la pena promoverlo.

## Comportamiento visible / flujos / a11y para `test-engineer`

Esto es lo que un test debería poder ejercitar a través de la interfaz, sin
tocar clases internas:

1. **Sin delivery habilitado** (`delivery.enabled === false`, o mientras la
   cotización carga): el bloque "Cómo lo recibís" muestra solo la dirección
   del local (o el texto de WhatsApp si no hay dirección cargada). No hay
   radio, no hay campos de dirección. Igual que el comportamiento actual
   antes de este cambio.
2. **Delivery habilitado y disponible**: aparece un `role="radiogroup"` con
   dos opciones — "Retiro en el local" (con la dirección del local o el
   texto de WhatsApp) y "Delivery" (con "Gratis" o el costo formateado). Cada
   opción es un solo target clickeable (el `<label>` entero, no solo el
   punto del radio) — Radix asocia el `<label>` con el input por anidamiento.
3. **Elegir "Delivery"** revela 4 campos: "Calle y número" (`required`,
   `aria-invalid`/`aria-describedby` cuando el servidor devuelve
   `field: 'deliveryAddressLine'`), "Piso / Depto" (opcional,
   `autoComplete="address-line2"`), "Entre calles" (opcional), "Referencias"
   (opcional, `<Textarea>`, `maxLength={300}`). El foco va a "Calle y número"
   si el servidor rechaza el pedido con ese campo.
4. **Delivery habilitado pero no disponible** (`!delivery.available`): la
   opción "Delivery" se ve pero está deshabilitada (`aria-disabled="true"` en
   el label, `disabled` en el radio real — no se puede seleccionar ni con
   teclado ni con mouse) y muestra `delivery.unavailableReason` tal cual lo
   manda el servidor.
5. **`allCouriersBusy` con delivery elegido y disponible**: aparece un aviso
   (`role="status"`, `aria-live="polite"`) "Todos los repartidores están en
   la calle. Tu envío puede demorar más de lo habitual." El botón de submit
   sigue habilitado — nunca se bloquea por esto.
6. **`missingForFreeCents > 0 && freeFromCents > 0`** con delivery elegido:
   aparece "Te faltan $X para el envío gratis."
7. **Bloque "Tu pedido"**: con método delivery, aparece la línea "Envío"
   (o "Gratis" si `feeCents === 0`) entre Subtotal y Total; el Total usa
   `delivery.totalWithDeliveryCents`; el ETA suma `delivery.minutesToAdd`.
   Con método retiro, no hay línea de Envío, Total usa `priced.totalCents`,
   ETA sin sumar nada. El total del `ActionBar` (pie fijo) sigue la misma
   regla.
8. **Envío del formulario**: el payload manda `deliveryMethod` siempre, y los
   4 campos de dirección solo si el método (ya corregido si hiciera falta)
   es `'delivery'` — nunca cuando es `'pickup'`, y como `undefined` (no
   `''`) cuando el campo opcional quedó vacío.
9. **Tras un pedido creado con éxito**: si el método fue delivery, la
   dirección queda en `localStorage` (`burger-shop.customer`, v2) y se
   precarga en el próximo checkout aunque esta vez se elija retiro por
   default. "Olvidar mis datos" limpia también los 4 campos de dirección del
   formulario (además de nombre/teléfono/email, como antes).
10. **`store-hero.tsx`**: la banda de datos de la vitrina dice "Retiro y
    delivery" cuando `store.delivery.enabled`, "Retiro en el local" si no; si
    hay costo configurado (`feeCents > 0`) se ve una tercera línea "Envío
    $X" con ícono de bici.

## Validación

- `npm run typecheck` — limpio en todos los archivos de este slice. Queda un
  error preexistente y ajeno: `src/app/admin/(app)/page.tsx` (falta
  `deliveryEnabled` en las props de un componente de otro lane admin —
  confirmé que no toco ese archivo ni ese componente).
- `npm run lint` — limpio en todos los archivos de este slice (0 errores, 0
  warnings). Los 6 warnings que quedan en el proyecto son preexistentes en
  `tests/` (variables `_omit`/`_table`/etc. sin usar), no de este slice.

## Pendientes / cross-lane

- Nada bloqueante. El único gap que reporto (no arreglé, no es mío): si en
  algún momento se quiere mostrar en el checkout una razón MÁS específica
  para "no llega al mínimo de delivery" separada de `unavailableReason`, los
  campos `minOrderCents`/`missingForMinimumCents` de `DeliveryQuote` ya viajan
  sin usar del lado del cliente — hoy confío en que `unavailableReason` ya
  cubre ese caso redactado, así que no dupliqué el mensaje.
