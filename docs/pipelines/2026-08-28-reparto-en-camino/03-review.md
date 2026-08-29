# Review — Envío propio (delivery)

**Verdict: CHANGES REQUESTED**

## Alcance revisado

Diff de la feature de delivery (working tree, sin commitear), acotado a los archivos que
pidió el orquestador:

- `supabase/migrations/20260828130000_delivery.sql` (839 líneas)
- `src/lib/delivery.ts`, `src/models/{types,courier.model,dispatch.model,order.model,store.model,platform.model}.ts`,
  `src/models/schemas/{order,store,courier,platform}.schema.ts`, `src/models/mappers/store.mapper.ts`
- `src/controllers/{checkout,kitchen,courier,staff,admin}.{controller,actions}.ts`
- `src/services/payments/mercadopago.adapter.ts`, `src/services/notifications/**`, `src/emails/store-courier-invite.tsx`
- `src/app/repartidor/**`, `src/app/admin/(app)/repartidores/**`, `src/app/admin/acceso/confirm/route.ts`,
  `src/app/api/orders/route.ts`, `src/app/admin/(app)/page.tsx`
- `src/views/courier/**`, `src/views/admin/{kds,repartidores,ajustes,pedidos}/**`, slices de `src/views/storefront/**`
  relevantes a delivery, `src/views/shared/order-status.tsx`, `src/lib/customer.ts`

El resto del working tree (visual identity, `auto_advance`, `maps`/`instagram`/links, `preview-mode`, etc.) es
preexistente y no se auditó salvo donde se cruza directamente con delivery (el cron de auto-listo, porque
`dispatchReadyNotification` depende de él).

No se tocó ningún archivo. No se escribieron ni editaron tests.

## Hallazgos

### 1. [MAJOR] El nombre del repartidor en el KDS desaparece a los ~500ms de asignarlo

`src/models/order.model.ts:154` — `toOrder()` hardcodea `courierName: null`. El único select que sí trae el nombre
es `ORDER_WITH_ITEMS_AND_STORE_SELECT` (línea 227, con el embed `courier:store_members!orders_courier_id_fkey`),
usado por el seguimiento público y el webhook. Pero **el KDS nunca usa ese select**: `getActiveOrders` y
`getOrderHistory` (las únicas fuentes de `initialOrders`, del polling y del refetch por Realtime del tablero) usan
`ORDER_WITH_ITEMS_SELECT` (línea 222), que no trae el embed. O sea que para el KDS, `order.courierName` es **siempre
`null`** viniendo del servidor.

El chip de `order-card.tsx:239-244` (`{order.deliveryMethod === 'delivery' && order.courierName ? ...}`) solo se
llena por el parche optimista de `onAssigned` (`order-card.tsx:342`, alimentado por el nombre que trajo
`fetchStoreCouriersAction` al abrir el `<Select>`) — un valor que vive solo en el estado de React de esa pestaña.

Escenario de falla real: el encargado asigna "Martín" a un pedido. `assignCourierAction` hace
`UPDATE orders SET courier_id = ...`, que es en sí mismo un evento en la tabla `orders` de esa tienda. El listener
de Realtime del propio tablero (`board.tsx:437-438`) lo capta y agenda un poll a los `REALTIME_DEBOUNCE_MS = 500`
(`board.tsx:46`); ese poll llama `fetchActiveOrdersAction` → `getActiveOrders` → `courierName: null` para TODOS los
pedidos, y `poll()` hace `setOrders(next)` completo (`board.tsx:411`), pisando el parche optimista. Resultado: el
chip "Bike + Martín" que se acababa de mostrar desaparece solo, medio segundo después, y no vuelve a aparecer hasta
que alguien vuelva a abrir el `<Select>` de esa tarjeta puntual. Con el polling de 30s corriendo siempre
(`POLL_INTERVAL_MS`, `board.tsx:39`) esto pasa incluso sin Realtime. Un encargado que mira el tablero en otra
pestaña, o que recarga la página, no tiene forma de saber a quién está asignado un pedido sin abrir el selector de
cada tarjeta una por una.

Nota: además, `<Select value={String(order.courierId)}>` en `assign-courier.tsx:106` tampoco resuelve la etiqueta
sola: Radix necesita que el `<SelectItem>` correspondiente esté montado (`couriers` solo se carga `onOpenChange`),
así que hasta que alguien abre ese control en esa sesión, el trigger tampoco muestra el nombre — confirma que el
chip es hoy el ÚNICO lugar donde este dato podría mostrarse de un vistazo, y está roto.

Arreglo sugerido: sumar el mismo embed de `store_members` a `ORDER_WITH_ITEMS_SELECT` (o a una variante que use
`getActiveOrders`/`getOrderHistory`) y completar `courierName` en `toOrder()` igual que ya se hace en
`toOrderPublicView()`.

### 2. [MINOR] `refreshFrozenEta` no verifica el estado del pedido antes de escribir

`src/models/order.model.ts:1039-1091`. El `update` final (línea ~1078) no lleva `.eq('status', 'confirmed')` ni
ningún predicado de estado — a diferencia de `updateOrderStatus` y `markOrderPaid`, que sí usan
`.eq('status', from)` justamente para no pisar un cambio concurrente. `refreshFrozenEta` se llama de forma
`await`eada (no en background) inmediatamente después de que `markOrderPaid` deja el pedido en `confirmed`, así que
la ventana es corta, pero no nula: si el mostrador ya tiene el pedido en pantalla (Realtime/polling) y hace clic en
"Empezar a cocinar" antes de que termine el segundo round-trip de `refreshFrozenEta` (dos SELECT + un UPDATE), el
pedido puede pasar a `preparing` en el medio, y el `UPDATE` final de `refreshFrozenEta` igual escribe
`eta_minutes`/`eta_at`/`demand_multiplier`/`delivery_minutes` sobre un pedido que ya no está en el estado que se
leyó. No corrompe el estado de cocina (el trigger sigue siendo la autoridad de transición), pero sí puede dejar un
ETA recalculado con datos de un instante que ya pasó, mostrado al cliente como si fuera vigente. Sugerido: agregar
`.eq('status', 'confirmed')` al update y loguear (sin tirar) si no afecta filas, igual que el resto de los updates
de esta función.

### 3. [MINOR] La invitación y el reenvío de repartidor comparten idempotency key de Resend

`src/services/notifications/email/courier-invite.tsx:55` — `{ idempotencyKey: `store-courier-invite/${p.courierId}` }`
es la misma clave que usa tanto `inviteCourier` (alta) como `resendCourierInvite` (botón explícito "Reenviar
invitación"), ambas via `sendCourierInviteEmail`. Dentro de la ventana de idempotencia de Resend (24hs), un click en
"Reenviar invitación" poco después de la invitación original no dispara un envío nuevo: Resend devuelve la
respuesta cacheada del primer request, sin mandar el mail de nuevo, y el código lo interpreta como `status: 'sent'`
(no hay `error`). El dueño ve "Invitación reenviada" pero el repartidor no recibe nada si, por ejemplo, el mail
original cayó en spam y quiere probar nuevamente el mismo día. Esto es un patrón heredado a propósito de
`owner-invite.tsx` (mismo esquema de key, `store-owner-invite/${storeId}`), así que no es exclusivo de este diff,
pero acá se replica en una función NUEVA con un botón de reenvío explícito cuyo caso de uso principal es justo ese
("no me llegó, reenviámelo"). Sugerido: variar la key en el reenvío (ej. sumar un timestamp o un contador), al menos
para `resendCourierInvite`/`resendOwnerInvite`.

### 4. [NIT] `getCourierAvailability` reimporta lo que ya está importado

`src/models/courier.model.ts:330-344`. Dentro de la función se hace
`const { createAdminClient } = await import('@/lib/supabase/admin')` y
`const { log } = await import('@/lib/log')`, cuando ambos símbolos ya están importados estáticamente arriba del
archivo (líneas 4-8) y se usan tal cual en el resto del módulo. No hay motivo de import circular (este archivo no
depende de nada que dependa de él). Es ruido y una inconsistencia de estilo frente al resto del archivo — probablemente
un resabio de cuando esta función era un stub. Sugerido: usar los imports de arriba directamente.

### 5. [NIT] `private.is_store_courier` queda sin ningún caller

`supabase/migrations/20260828130000_delivery.sql:131-149`. La función se define, se le hace `revoke`+`grant` como el
resto de helpers de `private`, pero no la invoca ninguna policy, trigger ni otra función RPC (ni acá ni en el resto
del repo). No es un riesgo de seguridad (vive en `private`, PostgREST no la expone), pero es código muerto en una
migración que por lo demás es muy prolija. O se usa en algún lado (¿pensada para una policy futura de
`store_members` scoped a courier?) o se retira.

## Lo que está bien resuelto

- **Aislamiento del repartidor**: confirmado a mano contra la migración. `is_store_member` se endurece exactamente
  como describe el plan (orden correcto: CHECK de `role` primero, función después), `orders` no tiene ni grant ni
  policy para `courier`, y las dos RPC (`courier_queue`, `courier_advance_order`) están bien acotadas —
  `courier_advance_order` valida `p_status in ('on_the_way','delivered')` en el cuerpo, así que ni un request armado
  a mano contra PostgREST puede pedir `cancelled`. `requireStoreMembership` (`store.model.ts:1238`) además rechaza
  explícitamente un `role === 'courier'` como defensa en profundidad, no solo dependiendo del efecto lateral de la
  RLS endurecida.
- **El agujero de Mercado Pago está cerrado de verdad**: `createCheckoutForOrder` (único punto que arma la
  preferencia, usado tanto por `submitOrder` como por `resumePaymentAction` vía `resolveCheckoutUrl`) agrega la línea
  "Envío" cuando `deliveryFeeCents > 0`, así que `itemsTotal === totalCents` y la guarda del adapter deja de ser una
  aproximación.
- **La máquina de estados coincide exacto entre TypeScript y Postgres**: `ALLOWED_TRANSITIONS` y el trigger
  `enforce_order_rules` tienen la misma tabla, en el mismo orden (`ready: [delivered, on_the_way, ...]`), y
  `forwardTarget` en `order-card.tsx` calcula el caso especial de `ready` explícitamente en vez de confiar en el
  `.find()` genérico — evita exactamente la trampa que el plan advertía (ofrecer "Salió a repartir" en un retiro).
  La lista de columnas inmutables del trigger conserva todas las originales y suma las dos nuevas (`delivery_method`,
  `delivery_fee_cents`).
- **`refreshFrozenEta` está en el camino feliz correcto**: se llama después del `update` que deja el pedido
  `confirmed` (nunca en `mismatch`/`needs_refund`/`duplicate`/`already_applied`), y es log-y-seguir. Ver hallazgo #2
  para el único matiz.
- **El CHECK `orders_total_is_subtotal_plus_delivery_check`**, los índices recreados (`orders_active_idx` con
  `on_the_way`, `orders_courier_open_idx` nuevo), y los slugs reservados (`repartidor`, `repartidores`, `envios`)
  están duplicados correctamente en `RESERVED_SLUGS` de `platform.schema.ts`.
- **El aviso al cliente**: `dispatchReadyNotification`/`dispatchOnTheWayNotification` viven en un solo lugar
  (`kitchen.controller.ts`) y los dos caminos a "listo" (botón del KDS y `/api/cron/auto-advance`, que sí revisé
  aunque esté fuera del scope nominal por ser un caller directo de esta guarda) pasan por la misma función, así que
  la guarda "delivery no recibe 'listo'" no se puede saltear por ninguno de los dos.
- **MVC**: no encontré ningún `page.tsx` importando `@supabase/*`, los `.actions.ts` revisados tienen `'use server'`
  en la primera línea y exportan solo funciones async, y las vistas de courier/repartidores no hacen fetching propio.
- **Piso de diseño**: sin kicker sobre títulos, sin `Panel` anidado en lo que revisé, `rounded-(--radius-md)` (v4)
  en los inputs nuevos del checkout y ajustes, targets de 44px en el checkout/KDS y de 56-64px en el portal del
  repartidor (`active-order-card.tsx`, `h-14`/`h-16`), sin emoji como ícono.

## Bloqueantes

Ninguno de severidad *blocker* (no hay violación de dinero, de autorización ni de MVC). El hallazgo #1 es
suficientemente concreto y user-facing (el encargado no puede saber quién tiene un pedido de delivery sin abrir el
selector uno por uno) como para pedir que se corrija antes de dar por cerrado el slice del KDS. Se pide:

- Arreglar el hallazgo #1 (courierName siempre null para el KDS).
- Evaluar el hallazgo #2 (guardar `.eq('status','confirmed')` en `refreshFrozenEta`) y el #3 (idempotency key del
  reenvío) — ninguno es bloqueante por sí solo, pero son baratos de corregir en la misma pasada.
- Los nits #4 y #5 quedan a criterio del equipo.

Quedo a la espera del re-diff para una segunda pasada.
