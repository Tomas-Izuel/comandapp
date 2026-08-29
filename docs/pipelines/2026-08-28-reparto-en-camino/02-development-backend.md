# Slice backend — asignar repartidor, avanzar la entrega, aviso "salió tu pedido"

No encontré un `01-tasks.md` en un `docs/pipelines/` existente para este
slice — el runbook que recibí (prompt del orquestador) ya traía los
contratos y el reparto de archivos por escrito, así que trabajé directo
contra eso. Creé este directorio (`docs/pipelines/2026-08-28-reparto-en-camino/`)
solo para dejar el dev log donde `code-reviewer`/`test-engineer` lo esperan,
seteado en `CLAUDE.md`.

Contexto que ya estaba resuelto antes de este slice (T0, verificado): migración
de delivery aplicada, estado `on_the_way` en `ORDER_STATUSES`/
`ALLOWED_TRANSITIONS`/trigger, RPCs `courier_queue` / `courier_advance_order` /
`store_couriers` / `store_courier_availability`, CHECK de `notifications` con
`order_on_the_way`. Nada de eso se tocó.

## Archivos tocados

- `src/models/dispatch.model.ts` — implementado completo (antes stubs).
- `src/controllers/kitchen.controller.ts` — guarda en `dispatchReadyNotification`
  + nueva `dispatchOnTheWayNotification`.
- `src/controllers/kitchen.actions.ts` — `updateOrderStatusAction` dispara el
  aviso correcto según destino; dos acciones nuevas.
- `src/services/notifications/notifier.port.ts` — `NotificationTemplate` gana
  `'order_on_the_way'`.
- `src/services/notifications/whatsapp-link.adapter.ts` — mensaje para
  `order_on_the_way`.
- `src/services/notifications/whatsapp-cloud.adapter.ts` — **sin cambios**: su
  `if (template !== 'order_ready')` ya degrada cualquier plantilla nueva a
  `skipped` de forma genérica, así que `order_on_the_way` cae ahí solo.
- `src/services/notifications/index.ts` — sin cambios (solo reexporta tipos).

No toqué `src/views/**`, `src/models/order.model.ts`, `src/models/courier.model.ts`,
`src/services/notifications/email/**`, `src/emails/**`,
`src/controllers/checkout.controller.ts`, migraciones ni tests.

## Trabajo 1 — `dispatch.model.ts`

### `assignCourier(storeId, orderId, courierId)`

`createAdminClient()` + `.update({ courier_id }).eq('id', orderId).eq('store_id', storeId)`.
Dos cosas a notar:

- El `.eq('store_id', storeId)` no es cosmético: el trigger valida que el
  REPARTIDOR sea de la tienda, pero no impide que alguien pase un `orderId`
  de otra tienda al cliente admin. Ese filtro (más `.select('id').maybeSingle()`
  para detectar "no matcheó nada") cierra esa puerta. Sin fila devuelta →
  `DomainError('No se encontró el pedido en esta tienda', {status:404})`.
- El trigger `enforce_order_rules` rechaza un repartidor inactivo o de otra
  tienda con `raise exception ... using errcode = 'check_violation'`
  (SQLSTATE `23514`, confirmado contra Postgres estándar — `check_violation`
  = 23514, `serialization_failure` = 40001, `insufficient_privilege` = 42501,
  verifiqué que las tres RPC usan exactamente esos nombres). Se traduce a
  `DomainError('Ese repartidor no está disponible para esta tienda')` — nunca
  se muestra el texto crudo de Postgres.

### `getCourierQueue()`

RLS (`createClient()`) + `rpc('courier_queue')`. Mapeo de la fila cruda
(camelCase, tal cual la arma la RPC) a `CourierOrder`.

**Gap que reporto, no que arreglé** (no toco migraciones): la RPC no
selecciona `stores.address` aunque ya hace `join public.stores s`. Sin eso,
`navigationUrlFor(addressLine, storeAddress)` se llama con `storeAddress:
null` — el link de Maps sigue siendo válido, pero pierde la desambiguación
de ciudad que sí tiene el link que arma el checkout para el mismo tipo de
dirección. **SQL sugerido** (agregar una columna al SELECT de
`public.courier_queue`, sección 8 de `20260828130000_delivery.sql`):

```sql
-- dentro del select de courier_queue, junto a "storeName":
s.address as "storeAddress",
```

y en TypeScript pasar `row.storeAddress` en vez de `null`. Lo dejo así
mientras tanto porque no es un bloqueante — el repartidor igual llega.

### `advanceAssignedOrder({ orderId, status, collected })`

RLS + `rpc('courier_advance_order', { p_order_id, p_status, p_collected })`.
Traducción de errores:
- `40001` (la RPC re-lee con `for update` y hace `update ... where status =
  v_order.status`; si otro poll/el mostrador pisó el estado en el medio, la
  segunda condición no matchea) → `DomainError` 409, mensaje pide refrescar.
- `42501` (pedido no asignado a este repartidor, o — en teoría, bloqueado ya
  por Zod — un `status` que la RPC no acepta) → `DomainError` genérico.
- Cualquier otro código → error interno (log + throw genérico), nunca se
  muestra al repartidor.

### `listCouriersForAssignment(storeId)` — no estaba en el contrato original, la agregué

Es el soporte de `fetchStoreCouriersAction` (Trabajo 2). Ver la decisión de
diseño ahí abajo — la lógica de Postgres vive acá porque "el acceso a
Postgres vive solo en `models/`" (regla dura de `CLAUDE.md`); no la puse en
el controller.

## Trabajo 2 — `kitchen.actions.ts`

- `assignCourierAction({ storeId, orderId, courierId })` — valida con
  `assignCourierSchema` (ya existía en `courier.schema.ts`, no lo toqué),
  `requireStoreMembership(storeId)` (cualquier staff, no exige dueño — asignar
  un repartidor YA INVITADO es operación de piso, no de gestión), delega a
  `assignCourier`.
- `fetchStoreCouriersAction(storeId): ActionResult<CourierRow[]>` —
  `requireStoreMembership(storeId)` + `listCouriersForAssignment`.

### Decisión: por qué no usa la RPC `store_couriers`

La RPC `store_couriers` (T0, ya existe) exige `is_store_owner` **en el
cuerpo**. Es la restricción correcta para lo que esa RPC sirve: gestión de
repartidores (invitar/dar de baja) en `courier.model.ts`, explícitamente
documentada ahí como "Todo lo de gestión es del DUEÑO". Pero el consumidor de
`fetchStoreCouriersAction` es el selector de asignación del KDS, que **cualquier
staff** opera — llamar esa RPC desde ahí le da un `42501` a un empleado que no
es dueño apenas abre el panel.

En vez de forzar la RPC (o peor, pedir que se relaje su chequeo de
`is_store_owner`, lo que debilitaría la gestión de repartidores para
cualquier staff), armé el dato con dos queries RLS:

1. `store_members` filtrado por `store_id` + `role = 'courier'` — la policy
   `store_members_read` (`is_store_member(store_id)`) deja ver esto a
   cualquier miembro de la tienda, courier incluido. Verificado contra la
   base local: `authenticated` tiene grant de tabla completo sobre
   `store_members`, la fila la filtra la RLS.
2. `orders` filtrado por `store_id` + `courier_id in (...)` + `status in
   ('ready','on_the_way')` — conteo de carga hecho en JS (no hay `group by`
   fácil vía PostgREST sin una vista/RPC nueva, y son a lo sumo unas pocas
   decenas de filas por tienda). Verificado contra la base:
   `authenticated` tiene `SELECT` de **todas** las columnas de `orders`
   (incluida `courier_id`), solo `UPDATE` está restringido a `status`.

**Lo que este camino NO puede traer**: `email` y `lastSignInAt` viven en
`auth.users`, fuera del alcance de PostgREST — ni con RLS ni sin ella, un
usuario `authenticated` no puede leer esa tabla directo. Solo una
`SECURITY DEFINER` como `store_couriers` puede, y esa es la que está
restringida al dueño. Para el selector del KDS estos dos campos no hacen
falta (se necesita nombre + si está activo + carga, no el padrón completo de
alta/gestión), así que quedan en `''` / `null` con un comentario explícito en
`listCouriersForAssignment`. Quien necesite el padrón completo (con email,
último login) sigue usando `listStoreCouriers`/`store_couriers` en la página
de gestión del dueño — no toqué ese camino.

Si en algún momento el selector del KDS necesitara mostrar el email, la
arreglo correcta es una RPC nueva `store_couriers_for_staff` (o relajar
`store_couriers` a `is_store_member`, si se decide que ver el padrón completo
de repartidores no es sensible) — lo reporto en vez de decidirlo yo, porque
toca una migración.

## Trabajo 3 — el aviso

### Guarda en `dispatchReadyNotification`

```ts
if (order.deliveryMethod === 'delivery') return null
```

Puesta inmediatamente después de tener `order` (antes de armar `trackingUrl`
y de llamar al notifier). Cubre los DOS caminos a `ready` de una sola vez:
el botón del KDS (`updateOrderStatusAction`) y el cron `/api/cron/auto-advance`
(ninguno de los dos se tocó — ambos llaman a esta función, no reimplementan
el envío).

**Efecto secundario esperado, tal como anticipaba el brief**: el contador
`notified` de `/api/cron/auto-advance` baja para los locales con delivery,
porque ahora `dispatchReadyNotification` devuelve `null` para esos pedidos en
vez de mandar el WhatsApp/mail de "listo". Es el comportamiento correcto (el
aviso viejo era literalmente falso para delivery), pero si `test-engineer` o
`code-reviewer` corren el test existente de ese cron contando `notified` para
un local con delivery, el número esperado cambia.

### `dispatchOnTheWayNotification(orderId, expectedStoreId?)`

Simétrica a `dispatchReadyNotification` en estructura (mismo patrón de
`getOrderWithStoreById` + verificación de `expectedStoreId` + `trackingUrl`),
pero:
- Sin guarda inversa: un pedido de retiro no puede llegar nunca a
  `on_the_way` (el trigger lo bloquea — exige `delivery_method='delivery'` y
  `courier_id` no nulo), así que `updateOrderStatus` ya tira antes de que esta
  función se invoque para un retiro.
- Solo WhatsApp (`getNotifier().notify(...)`, plantilla `order_on_the_way`).
  **No hay contraparte de mail**: `EmailTemplate` no se tocó, a propósito —
  el brief es explícito en que un mail de "salió tu pedido" llega tarde para
  servir de algo.

`updateOrderStatusAction` llama a esta función cuando `status === 'on_the_way'`,
al mismo `storeId` verificado del browser, mismo criterio que con `ready`.

### Adapters

- `whatsappLinkAdapter`: nuevo caso en el switch de `buildMessage`, con el
  texto rioplatense pedido ("Tu pedido salió, va en camino") + emoji 🛵,
  siguiendo el mismo criterio del archivo (emoji en buenas noticias, no en
  `order_cancelled`).
- `whatsappCloudAdapter`: **no se tocó**. Su guarda `if (template !==
  'order_ready')` ya es genérica sobre el nombre de la plantilla, así que
  `order_on_the_way` cae en `skipped` con un mensaje que nombra la plantilla
  automáticamente. Lo confirmé leyendo el archivo, no hizo falta ningún
  cambio.
- `completeDeliveryAction` (de otro agente, `entregado`) no dispara nada acá:
  no hay ningún notifier ligado a la transición a `delivered` en este slice
  ni antes.

## Invariantes de negocio implementadas (para `test-engineer`)

Todo lo de acá abajo es lo que un test contra Postgres real puede probar que
un mock no puede:

1. **`assignCourier` rechaza un repartidor de otra tienda o inactivo** con
   `DomainError` — necesita el trigger real (`private.enforce_order_rules`)
   corriendo, no se puede mockear el `23514` de forma útil.
2. **`assignCourier` rechaza un `orderId` que no pertenece a `storeId`** con
   404 — esto SÍ se puede probar sin trigger (basta con dos tiendas y el
   filtro `.eq('store_id', ...)`), pero conviene un test contra la base para
   no confiar en que el mock de supabase-js refleje bien el filtro compuesto.
3. **`advanceAssignedOrder` con `status: 'on_the_way'` sobre un pedido no
   asignado al repartidor de la sesión** → `DomainError` (mapea `42501`).
   Necesita dos usuarios `courier` reales y JWTs distintos — no se puede
   simular con un solo cliente admin.
4. **`advanceAssignedOrder` en carrera** (dos requests casi simultáneos
   avanzando el mismo pedido) → uno gana, el otro recibe 409 (`40001`). Mismo
   patrón que el test de idempotencia de `createOrder`; hace falta Postgres
   real por el `for update` de la RPC.
5. **`listCouriersForAssignment` solo devuelve couriers de `storeId`** y
   cuenta bien `assignedOrders`/`onTheWayOrders` — probable con datos de
   fixture (dos tiendas, repartidores con 0/1/2 pedidos abiertos), no
   necesita nada exótico de Postgres pero sí RLS real (un cliente que no sea
   dueño, para confirmar que la policy `store_members_read` alcanza).
6. **La guarda de `dispatchReadyNotification` para delivery**: un pedido con
   `delivery_method='delivery'` que pasa a `ready` no debe generar ninguna
   fila en `notifications` (ni WhatsApp ni mail) — se puede probar con el
   notifier real stubbeado (falso adapter) y verificando que no se llamó.
   No necesita Postgres, es lógica pura de `kitchen.controller.ts`.
7. **`dispatchOnTheWayNotification` dispara con la plantilla correcta** y que
   el mensaje de `whatsappLinkAdapter` para `order_on_the_way` no menciona
   "listo para retirar" (evitar una regresión de copy-paste del template
   `order_ready`).

## Verificado contra la base local (no contra mocks)

- `select unnest(...)` confirmando que `check_violation`/`serialization_failure`/
  `insufficient_privilege` son nombres válidos de condición de Postgres (23514 /
  40001 / 42501 respectivamente — estándar, no específico de este proyecto).
- `\df public.courier_queue`, `\df public.courier_advance_order`,
  `\df public.store_couriers` — firmas exactas que usé para las llamadas RPC.
- `information_schema.column_privileges` sobre `orders` para `authenticated`:
  SELECT en las 91 columnas (incluida `courier_id`), UPDATE solo en `status`.
  Confirma por qué `assignCourier` necesita el cliente admin y por qué
  `listCouriersForAssignment` puede leer `courier_id` con RLS sin problema.
- `information_schema.table_privileges` sobre `store_members` para
  `authenticated`: grant de tabla completo (SELECT incluido), la fila la
  filtra la policy `store_members_read`.
- `pg_constraint` sobre `notifications`: `notifications_template_check` ya
  incluye `order_on_the_way` (T0, no lo toqué, solo confirmé).

## Verificación de build

- `npm run typecheck` — limpio para todo lo tocado en este slice. Queda **un
  error preexistente y fuera de este slice**:
  `src/app/admin/(app)/repartidores/page.tsx` importa
  `@/views/admin/repartidores/courier-manager`, que no existe todavía (es un
  archivo de otro agente en curso, `?? ` en `git status`, no lo toqué).
- `npm run lint` — limpio para todo lo tocado en este slice. Los warnings/error
  que quedan son todos de archivos de otras slices (`views/admin/kds/order-card.tsx`,
  `views/storefront/checkout-form.tsx`, y tests) — ninguno de `src/models`,
  `src/controllers` ni `src/services` de este slice.
- `npx vitest run tests/db/ tests/services/` — **128/128 pasan**, incluido
  `tests/db/order-state-machine.test.ts` (compara `ALLOWED_TRANSITIONS` contra
  el trigger — no lo toqué, sigue en verde).

## Pendientes / para el hilo principal

1. **Schema**: agregar `s.address as "storeAddress"` al SELECT de
   `public.courier_queue` (sección 8, `20260828130000_delivery.sql`) para que
   `navigationUrlFor` desambigüe ciudad igual que en el checkout. No
   bloqueante.
2. **Decisión de producto pendiente, no técnica**: si el selector del KDS
   alguna vez necesita mostrar el email/último-login del repartidor, hace
   falta una RPC nueva o relajar el chequeo de `store_couriers` — lo señalo,
   no lo decido.
3. El contador `notified` de `/api/cron/auto-advance` baja para locales con
   delivery (ver Trabajo 3) — es el comportamiento correcto, pero puede
   sorprender a un test existente que no contemplara delivery.
