# T2 — Pedido programado (dominio) — dev log

Slice backend B del feature de pedidos programados y horarios. Implementado
por `senior-backend-engineer`, corriendo en paralelo con T1 (horarios).

## Archivos tocados (todos dentro de mi ownership exclusivo)

- `src/models/schemas/order.schema.ts` — `scheduledFor` en `createOrderSchema`.
- `src/models/order.model.ts` — el grueso del slice: validaciones de
  `createOrder`, ETA congelado de un programado, los cuatro consumidores del
  predicado `fire_at`, y las cuatro funciones nuevas de la bandeja/pausa.
- `src/controllers/checkout.controller.ts` — `fullNights` en la cotización,
  `scheduledForLabel` en comprobante y WhatsApp de confirmación.
- `src/controllers/kitchen.controller.ts` — `dispatchCancelledNotification`.
- `src/controllers/kitchen.actions.ts` — cablea `order_cancelled` en
  `updateOrderStatusAction` cuando el destino es `cancelled`.
- `src/app/api/orders/route.ts` — expone `fullNights` en `GET`.
- `src/services/notifications/email/email.port.ts` — `EmailVars.scheduledForLabel`.
- `src/services/notifications/notifier.port.ts` — `NotificationVars.scheduledForLabel`
  (fuera de mi lista de ownership textual, pero **expresamente autorizado**
  por `01-tasks.md`: *"src/services/notifications/** solo si la var nueva del
  WhatsApp lo exige"* — y lo exige, requisito #11).
- `src/services/notifications/whatsapp-link.adapter.ts` — `order_confirmed`
  con hora pactada cuando hay `scheduledForLabel`. `whatsapp-cloud.adapter.ts`
  NO se tocó: solo atiende `order_ready`, ignora el resto de las plantillas.
- `src/emails/order-receipt.tsx` — "Programado para …" en vez de "Listo en
  ~X min" cuando hay `scheduledForLabel`.
- `src/models/types.ts` — **una sola adición**, ver "Gap de contrato" abajo.

## Gap de contrato encontrado: `ScheduledNightSummary` faltaba en `types.ts`

`01-tasks.md` (sección "Contratos … los fija el hilo principal ANTES de
repartir") nombra `ScheduledNightSummary = { night, count, paidCount,
paidTotalCents }` como parte del contrato de `types.ts`, pero el archivo real
(ya con las adiciones de T0: `scheduledFor`/`fireAt`/`scheduledNight`,
`StoreScheduling`, `StoreHoursRange`, etc.) no lo tenía. Mi `order.model.ts`
lo necesita para tipar `getScheduledNightSummary`.

Decisión: lo agregué YO, con la forma EXACTA que el plan ya especificaba (cero
diseño nuevo, solo completar un olvido), justo después de `StoreSchedule`. Lo
marco acá para que el hilo principal lo audite — es la única vez que toqué
`types.ts` fuera de lo que ya estaba fijado.

## Contratos que expongo (para T1, T3, T4 y el hilo principal)

### `src/models/schemas/order.schema.ts`

```ts
createOrderSchema // gana:
scheduledFor: z.iso.datetime().optional()  // SOLO UTC con "Z" (verificado contra
                                            // la doc de Zod v4: sin `offset`, sin
                                            // `local`, rechaza timezone offsets)
```
`.strict()` intacto. `ALLOWED_TRANSITIONS` NO se tocó — no hay estado nuevo,
el test de paridad transiciones-TS-vs-trigger sigue siendo válido tal cual.

### `src/models/order.model.ts`

- `createOrder(input)` — MISMA firma. Nuevo: valida horario (con y sin
  `scheduledFor`), lead de 60 min planos, horizonte de 3 días, delivery
  programado (Q2), deriva `scheduled_night`, traduce el rechazo de capacidad
  de la RPC. Ver "Reglas de negocio implementadas" abajo.
- `getActiveOrders(storeId)` — MISMA firma, ahora excluye `fire_at > now()`.
- `estimateEta(store, baseMinutes, deliveryMinutes)` — MISMA firma, mismo
  filtro en el conteo de demanda.
- `refreshFrozenEta(orderId)` — MISMA firma, early-return si el pedido es
  programado.
- `getScheduledOrders(storeId): Promise<Order[]>` — NUEVA. Programados vivos
  (`scheduled_for` no null, `status in (pending,confirmed)`, `scheduled_for >=
  ahora - 1h`), ordenados por `scheduled_for` ascendente. Cliente de SESIÓN.
- `getScheduledNightSummary(storeId, night: string): Promise<ScheduledNightSummary>`
  — NUEVA. El preview del diálogo destructivo: cuenta `fire_at > now() AND
  status in (pending,confirmed) AND scheduled_night = night`, separa pagos
  (`payment_status = 'approved'`) y suma `total_cents`. Cliente de SESIÓN. Es
  una FOTO — el cliente de la RPC puede cancelar menos de lo que este preview
  mostró, y es el comportamiento esperado.
- `countScheduledByNight(storeId, nights: string[]): Promise<Record<string, number>>`
  — NUEVA. Conteo de vivos (`pending`+`confirmed`, cuenta también los
  `pending` a propósito: dejarlos afuera permite sobrevender con checkouts
  simultáneos sin pagar) por noche, para la capa UX del tope. Admin client
  (lo llama el checkout anónimo vía `checkout.controller.ts`).
- `cancelScheduledNight(storeId, night, opts?: { pause?: boolean }): Promise<CancelScheduledNightResult>`
  — NUEVA, **firma distinta a la del borrador de `01-tasks.md`** (ver más
  abajo, "Desviación deliberada"). Cliente de SESIÓN, llama la RPC
  `cancel_scheduled_orders`.

```ts
export type CancelScheduledNightResult = {
  cancelledIds: number[]
  cancelledCount: number
  paidCents: number
}
```

### `src/controllers/kitchen.controller.ts`

```ts
dispatchCancelledNotification(orderId: number, expectedStoreId?: number): Promise<NotificationResult | null>
```
Mismo patrón exacto que `dispatchReadyNotification`/`dispatchOnTheWayNotification`.
Solo WhatsApp (`order_cancelled`), con `refund` en las vars SOLO si
`order.paymentStatus === 'approved'`. T1 la importa para las cancelaciones
masivas (pausa destructiva, cierre de fecha): un id a la vez, después de que
`cancelScheduledNight` devuelve `cancelledIds`.

### `src/controllers/checkout.controller.ts`

```ts
export type PriceQuote = { store: Store; priced: PricedCart; eta: EtaEstimate; delivery: DeliveryQuote; fullNights: string[] }
```
`fullNights` es `[]` cuando `store.scheduling.capacityPerNight` es `null`
(sin tope configurado, no vale la pena consultar). Cuando hay tope, son las
noches candidatas del horizonte (`SCHEDULE_HORIZON_DAYS + 1` días calendario
del local desde hoy) cuyo conteo ya llegó al tope.

### `GET /api/orders`

La respuesta gana `fullNights: string[]` al mismo nivel que `store`/`priced`/
`eta`/`delivery`. El frontend (T3) los pasa como `excludeNights` a
`scheduleSlots()` para no ofrecer turnos de una noche llena.

## Desviación deliberada: `cancelScheduledNight` — firma y motivo

El borrador de `01-tasks.md` proponía:
```
cancelScheduledNight(storeId, night): Promise<{ cancelledIds: number[]; count: number; paidCount: number; paidTotalCents: number }>
```
La migración YA ESCRITA por el hilo principal (`cancel_scheduled_orders`,
`supabase/migrations/20260829140000_scheduled_orders_and_hours.sql`, sección
11) es la autoridad real de Postgres y devuelve otra cosa:

```sql
jsonb_build_object('cancelledIds', ..., 'cancelled', ..., 'paidCents', ...)
```

Es decir: **no hay `paidCount`** (contarlo exigiría una query más dentro de
la misma transacción, y nadie lo pidió ahí), y el campo se llama `paidCents`,
no `paidTotalCents`. Adapté mi función a lo que la RPC realmente devuelve —
`paidCount` ya lo tiene quien pintó el diálogo con `getScheduledNightSummary`
ANTES de confirmar, no hace falta repetirlo en el resultado de la ejecución.

Además, **la RPC acepta un tercer parámetro que el borrador del plan no
tenía en cuenta**: `p_pause boolean default false`. Cuando es `true`, la RPC
apaga `stores.accepting_orders` DENTRO DE LA MISMA TRANSACCIÓN que cancela —
es la atomicidad que `00-architecture.md §7.8.1` pedía lograr con DOS pasos
separados desde la app ("cerrar la puerta antes de barrer"; "si la RPC falla
después del toggle, la puerta quedó cerrada"). Con `p_pause` esa ventana de
falla parcial ya no existe del lado de Postgres, así que agregué
`opts?: { pause?: boolean }` a mi función.

**Esto es importante para T1**, que orquesta `pauseScheduledNightAction` en
`admin.actions.ts`: para el camino de "pausar pedidos" (§7.8.1) hay que llamar

```ts
await cancelScheduledNight(storeId, night, { pause: true })
```

y NO togglear `accepting_orders` aparte con otra escritura — hacerlo aparte
reintroduce exactamente la ventana de falla parcial que la RPC ya cerró. Para
el cierre de una fecha con programados adentro (Q14, que no toca
`accepting_orders`), se llama sin `opts` (`pause` default `false`). Dejé todo
esto documentado en el JSDoc de la función en `order.model.ts` — si T1 no vio
este dev log, lo va a ver ahí al importar.

## Reglas de negocio implementadas (spec para test-engineer)

Todo lo que sigue es `DomainError` salvo que se diga lo contrario — mensaje
de interfaz, 400.

1. **Sin `scheduledFor` (pedido para ahora) y la tienda está cerrada por
   horario** (`isOpenAt(schedule, now, store.timezone) === false`) → rechaza
   con *"La cocina está cerrada. Podés programar un pedido para cuando
   abra."* Esta guarda **no existía antes** — es la única regla nueva que
   toca el camino de un pedido inmediato, y por eso el ETA/precio de un
   inmediato sobre una tienda SIN horarios cargados (`weekly: []` →
   `isOpenAt` siempre `true`) se comporta EXACTAMENTE igual que hoy. Solo
   probable con datos reales de `store_hours` — necesita Postgres para el
   caso "hay horario cargado y ahora está cerrado".
2. **Con `scheduledFor`**, en este orden:
   - **Granularidad**: el instante tiene que ser un múltiplo exacto de 15
     minutos (segundos y milisegundos en cero, minutos módulo
     `SCHEDULE_STEP_MINUTES`). Cualquier otro valor → *"Elegí un horario de
     la lista de turnos disponibles"*.
   - **Lead mínimo**: `scheduledFor >= now + SCHEDULE_LEAD_MINUTES` (60,
     piso PLANO, sin fórmula). Si no → *"Programá tu pedido con al menos 60
     minutos de anticipación"*.
   - **Horizonte**: `scheduledFor <= now + SCHEDULE_HORIZON_DAYS` (3 días).
     Si no → *"Solo podés programar pedidos hasta 3 días por adelantado"*.
   - **Dentro de horario**: `isOpenAt(schedule, scheduledFor, tz)`, MISMA lib
     que usó el browser (overrides incluidos). Si no → *"Ese horario ya no
     está disponible. Elegí otro turno."*
   - **Delivery programado (Q2)**: si `deliveryMethod === 'delivery'`, exige
     `store.scheduling.deliveryEnabled === true` **y** al menos 1 repartidor
     activo (`getCourierAvailability(store.id).activeCouriers >= 1`). Sin la
     política → *"Este local no permite programar pedidos con envío"*. Sin
     repartidores → *"No hay repartidores disponibles para programar un
     envío"*. Si el repartidor se desactiva DESPUÉS de creado el pedido, no
     pasa nada — el pedido queda y se ve en la bandeja.
   - Deriva `scheduled_night = commercialNightOf(schedule, scheduledFor, tz)`
     y lo manda a la RPC junto con `night_capacity =
     store.scheduling.capacityPerNight` (puede ser `null` = sin tope).
3. **El tope por noche lo arbitra `create_order` en Postgres**, no el
   modelo. Si la RPC rechaza con el marcador `scheduled_night_full` (ver el
   SQLSTATE `BS429` de la migración), se traduce a `DomainError('Esa noche ya
   está completa. Elegí otro día.')` — nunca llega el mensaje crudo de
   Postgres al browser. **Solo probable contra Postgres real**: la carrera de
   dos `create_order` concurrentes por el último lugar de la noche (ver el
   catálogo de casos `tests/db/` que pide `00-architecture.md`/`01-tasks.md`
   para T0 — la carrera del advisory lock).
4. **Campos congelados de un pedido programado** (vs. uno inmediato):
   - `demand_multiplier`: `null` (no `1`, no el de la tienda — nada se midió).
   - `eta_minutes`: `null`.
   - `eta_at`: **`scheduledFor` tal cual**, la promesa ES el ETA.
   - `delivery_minutes`: `store.delivery.minutes` PLANO — nunca
     `deliveryMinutesFor(...)` con `busyMinutes`, porque la ocupación de la
     flota AHORA no describe la de la noche pactada.
   - `base_prep_minutes`: igual que siempre (`priced.basePrepMinutes`) —
     hace falta para que la RPC calcule `fire_at`.
   - `fire_at` y `scheduled_night`: los calcula/deriva la RPC/el modelo, el
     cliente nunca los manda (el schema ni los conoce — `.strict()` los
     rechazaría con 400 si alguien los mandara).
5. **`refreshFrozenEta` es un no-op para un pedido programado.** Un pago
   aprobado media hora (o cuatro) después de crear el pedido NO puede correr
   la promesa. Verificado con lectura de `scheduled_for` antes de recalcular
   nada.
6. **`estimateEta` y `getActiveOrders` excluyen `fire_at > now()`** del
   conteo/tablero — `.or('fire_at.is.null,fire_at.lte.<ahora ISO>')` sobre
   PostgREST. Es el espejo en TypeScript de `private.active_order_count` (T0,
   Postgres) — los DOS lados tienen que excluir, y ya excluyen.
7. **`getActiveOrders` ES el tablero del KDS entero** (carga inicial, poll de
   30s, refetch de Realtime): filtrar acá filtra todo, campana incluida. NO
   toqué ninguna vista del KDS — el filtro alcanza solo con este cambio de
   query.
8. **`getScheduledOrders` ordena por `scheduled_for`, nunca `created_at`.**
   Un programado para dentro de 3 días se creó HOY; ordenar/filtrar por
   creación lo escondería "bajo hoy" en cualquier vista que asuma
   reciente-es-próximo.
9. **`dispatchCancelledNotification` dispara `order_cancelled` (WhatsApp) en
   TODA cancelación** vía `updateOrderStatusAction` — programada o no, y sin
   mail (cero plantillas nuevas de mail). El `refund` de las vars solo viaja
   si había plata cobrada de verdad (`paymentStatus === 'approved'`); pago en
   el local o un online que nunca se aprobó no mencionan plata en el mensaje.
10. **Comprobante y WhatsApp de confirmación muestran la hora pactada**
    (`formatDateTime(order.scheduledFor, store.timezone)`) en vez de "Listo
    en ~X min", solo cuando `scheduledFor` no es `null`. Un pedido inmediato
    se ve EXACTAMENTE igual que antes de este slice (regresión cero,
    criterio #12 del task).

## Un comentario que el task pidió explícitamente

En `order.model.ts`, en el bloque del lead mínimo, dejé escrito en mayúsculas
y con el porqué completo: un `fire_at` en el pasado NO es un bug, es la
recuperación correcta ("ya vas tarde, arrancá"), y no hay que "arreglarlo"
clampeando a `now()` ni subiendo el piso con una fórmula de
prep+delivery — es una decisión de producto tomada viendo la aritmética
(2026-08-29), ya evaluada y descartada la alternativa. El mismo comentario
vive también en la migración de T0 y en `src/lib/store-hours.ts` de T1: las
tres copias dicen lo mismo a propósito, para que nadie lo toque desde
ninguno de los tres lados.

## Lo que necesita una base real (`tests/db/`)

Todo lo que sigue no se puede probar con mocks porque depende de invariantes
que viven en Postgres (T0), no en mi código:

- **La carrera del tope por noche**: dos `create_order` concurrentes
  pidiendo el último lugar de una `scheduled_night` con capacidad 1 →
  exactamente uno gana, el otro recibe `scheduled_night_full` traducido a
  `DomainError`.
- **`fire_at` calculado por la RPC**, incluyendo el caso donde queda en el
  pasado (lead de 60 min + carrito con prep+delivery > 60) — verificar que
  el CHECK `fire_at <= scheduled_for` sigue pasando y que el pedido aparece
  en `getActiveOrders` sin esperar ningún barrido.
- **`cancel_scheduled_orders` con `p_pause: true`**: verificar que
  `accepting_orders` se apaga en la MISMA transacción que la cancelación
  (o ninguna de las dos, si algo falla) — no hay forma de probar atomicidad
  de una transacción real contra un mock.
- **`private.active_order_count` y `advance_auto_orders`** excluyendo
  programados en espera — son funciones de Postgres, T0 las escribió, pero
  el efecto combinado con mi `estimateEta`/`getActiveOrders` (los dos lados
  del espejo dando el mismo número) solo se ve con datos reales.
- **RLS de `store_hours`/`store_hours_overrides`**: mi `getStoreScheduleForOrder`
  usa el admin client así que bypassea RLS, pero vale la pena un test que
  confirme que la policy `for select using (true)` sigue viva para el
  camino de sesión de T1 (`store-hours.model.ts`).

## Test existente que mi cambio rompe (para test-engineer, NO lo toqué)

`npm test` corre en rojo: **1 test** en `tests/models/order.model.test.ts`
("Mercado Pago conectado y pago en el local deshabilitado → el pedido online
se crea igual"). El mock del admin client de ese archivo solo reconoce las
tablas `stores`, `products` y `orders`; mi `createOrder` ahora SIEMPRE
consulta `store_hours`/`store_hours_overrides` (vía `getStoreScheduleForOrder`,
necesario para la guarda nueva del punto 1 de arriba, que aplica también a
pedidos inmediatos). El mock tira "tabla admin inesperada: store_hours".

Es una consecuencia esperada y necesaria del cambio de negocio, no un bug de
mi código — no lo arreglé porque no escribo tests. Además, el mock de
`estimateEta` en ese mismo archivo (`orders` → `select('id') → eq() → in()`)
va a necesitar soportar `.or(...)` encadenado después de `.in(...)` para las
otras pruebas que toquen ese camino, porque mi filtro de `fire_at` se agrega
ahí. Dejo las dos cosas para que test-engineer las actualice:

1. El admin mock necesita responder algo (aunque sea `{ data: [], error:
   null }`) para `store_hours` y `store_hours_overrides`.
2. El mock de `orders.select('id')` necesita exponer `.or()` después de
   `.in()` (puede ser un objeto con `.or: async () => ({count, error})`, o
   convertir la cadena entera en un builder que resuelva recién al final).

`npm run typecheck` y `npm run lint` están limpios en TODOS mis archivos
(verificado filtrando la salida por nombre de archivo). Los errores
restantes de `npm run typecheck` son de `src/models/platform.model.ts`
(falta mapear `scheduling` en otro mapper, no es mío) y de vistas de
frontend todavía en construcción (T3/T4) — ninguno de los dos es mío ni
bloquea mi slice.

## Deferrals / follow-ups

- `dispatchCancelledNotification` no distingue "cancelado por el staff desde
  el KDS" de "cancelado por una pausa masiva" en el mensaje — el texto de
  `order_cancelled` es el mismo para los dos casos (decisión ya tomada en
  `00-architecture.md`, Q7: alcance aceptado, no algo que yo haya decidido
  ahora).
- No agregué ninguna plantilla de mail para cancelación (a propósito, cero
  alcance nuevo de mail — Q7 es solo WhatsApp).
- No toqué `src/lib/store-hours.ts` ni `store-hours.model.ts` (T1): mis
  imports (`isOpenAt`, `commercialNightOf`, `SCHEDULE_STEP_MINUTES`,
  `SCHEDULE_HORIZON_DAYS`, `SCHEDULE_LEAD_MINUTES`) ya estaban resueltos por
  T1 al momento de correr mi typecheck final — coinciden con las firmas que
  `01-tasks.md` prometía, sin sorpresas.

## Arreglo post-review: B2 — el tope contaba distinto en los dos lados

`code-reviewer` encontró (`03-review.md` §B2, verificado en vivo contra
Postgres) que `countScheduledByNight` contaba `status in ('pending',
'confirmed')` mientras que `create_order` (la RPC, dentro de la transacción)
cuenta `status <> 'cancelled'`. La divergencia crece durante toda la noche:
apenas un pedido programado dispara y avanza (`preparing`/`ready`/
`on_the_way`/`delivered`), la RPC lo sigue contando contra el tope pero
`countScheduledByNight` dejaba de contarlo — la noche se mostraba "con lugar"
en el browser mientras `create_order` la seguía rechazando con
`scheduled_night_full`, sistemáticamente, justo en el escenario de la
avalancha del viernes que el tope existe para atender.

**Arreglo**: `countScheduledByNight` (`src/models/order.model.ts`) pasa de
`.in('status', ['pending', 'confirmed'])` a `.neq('status', 'cancelled')` —
ahora dice EXACTAMENTE lo mismo que el cálculo de `v_taken` en
`create_order` (`supabase/migrations/20260829170000_scheduled_orders_and_hours.sql`,
línea ~505; el archivo se renombró desde `20260829140000_...` por un choque
de timestamp con `main`, resuelto por el hilo principal — es la misma
función, sin otro cambio).

Dejé un comentario largo y explícito en la función (es contraintuitivo: un
pedido `delivered` sigue "ocupando" su lugar de esa noche, porque la cocina
ya lo hizo y bajar el conteo liberaría un lugar que no existe) para que nadie
lo "corrija" de nuevo a `pending`/`confirmed` pensando que son sinónimos de
"vivo".

**Revisé el otro consumidor con el mismo criterio viejo**:
`getScheduledNightSummary` también filtra `pending`/`confirmed`, pero es
CORRECTO tal cual está — esa función responde "¿qué va a cancelar
`cancel_scheduled_orders` si el dueño confirma la pausa?", y esa RPC cancela
únicamente `fire_at > now() AND status in ('pending','confirmed')` (un pedido
`delivered` no se cancela nunca). Son dos preguntas distintas con
respuestas distintas a propósito — agregué un comentario cruzado en las dos
funciones para que quede explícito y nadie intente "alinearlas" entre sí.
`getScheduledOrders` (la bandeja de `/admin/pedidos`) también filtra
`pending`/`confirmed`, y es correcto por el mismo motivo: es una lista de
"lo que falta resolver", no un conteo de ocupación.

Verificado: `npm run typecheck` y `npm run lint` limpios en
`src/models/order.model.ts` (el resto del repo tiene errores de T3/T4 en
construcción, ninguno mío). No escribí ni edité tests.
