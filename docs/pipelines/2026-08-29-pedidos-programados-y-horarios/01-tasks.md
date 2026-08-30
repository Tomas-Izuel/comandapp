# Pedidos programados y horarios — corte en tareas

**Versión 2, post-grilling (2026-08-29).** Referencia de decisiones:
`00-architecture.md` §10 (las 14 decisiones) y §2 (dónde perdió la
recomendación y por qué).

Regla del reparto: **ningún archivo tiene dos dueños.** Importar lo del otro
está bien; editarlo, no. Los "no tocar" son vinculantes.

Orden: **T0 primero (hilo principal). T1 y T2 en paralelo** (no comparten
archivos). **T3 y T4 en paralelo, después de que T1/T2 fijen sus exports**
(los contratos ya están acá; la integración la verifica el hilo principal).
`code-reviewer` y `test-engineer` al final, en paralelo.

---

## Contratos (los fija el hilo principal ANTES de repartir)

### `src/models/types.ts` (escribe el hilo principal, nadie más lo toca)

- `StoreHoursRange = { dayOfWeek: number /* 0=domingo…6=sábado, convención Date#getDay */; opensAtMinute: number /* 0–1439 */; durationMinutes: number /* 15–1440 */ }`
- `StoreHoursOverride = { date: string /* YYYY-MM-DD local */; closed: boolean; ranges: Array<Pick<StoreHoursRange, 'opensAtMinute' | 'durationMinutes'>> }`
  — `closed: true` ⇒ `ranges` vacío; con filas ⇒ reemplazan el patrón para esa fecha.
- `StoreHoursData = { weekly: StoreHoursRange[]; overrides: StoreHoursOverride[] }`
- `Store` gana: `scheduledDeliveryEnabled: boolean` y
  `scheduledSlotCapacity: number | null`.
- `Order` gana: `scheduledFor: string | null` (ISO), `fireAt: string | null`
  (ISO) y `scheduledNight: string | null` (YYYY-MM-DD local).
- `OrderPublicView` gana: `scheduledFor: string | null`.
- `ScheduledNightSummary = { night: string; count: number; paidCount: number; paidTotalCents: number }`
  — lo que consume el diálogo destructivo.

### `src/lib/store-hours.ts` (dueño: T1; consumidores: T2, T3, T4)

Módulo **puro, sin `server-only`**, cero imports de `@supabase/*` o modelos.
Reutiliza `src/lib/dates.ts` (importar, no copiar). Exports:

- `SCHEDULE_STEP_MINUTES = 15`, `SCHEDULE_HORIZON_DAYS = 3`,
  `SCHEDULE_LEAD_MINUTES = 60` (Q5/Q10/Q11 — el lead es un **piso plano**, sin
  fórmula con prep/delivery; ver el comentario obligatorio en T2.2).
- `isOpenAt(data: StoreHoursData, instant: Date, timeZone: string): boolean`
  — `weekly` vacío y sin override aplicable ⇒ `true` (sin horarios = siempre
  abierta). Resuelve el override de la fecha local del instante Y la de ayer
  (cruce de medianoche); si una fecha tiene override, reemplaza el patrón
  entero de esa fecha.
- `nextOpening(data, from: Date, timeZone): Date | null` — próxima apertura
  dentro de `SCHEDULE_HORIZON_DAYS`; `null` si siempre-abierta o sin apertura
  en la ventana.
- `scheduleSlots(data, from: Date, timeZone, opts: { leadMinutes: number; excludeNights?: string[] }): Date[]`
  — instantes UTC cada 15 min dentro de rangos abiertos, desde
  `from + leadMinutes` redondeado al múltiplo de 15 siguiente, hasta el
  horizonte; excluye por completo los slots cuya noche comercial esté en
  `excludeNights` (Q3: la noche llena se cierra entera).
- `commercialNightOf(data, instant: Date, timeZone): string` — el día local en
  que ABRE el rango que contiene al instante; siempre-abierta ⇒ día calendario
  local. (El sábado 01:30 de "vie 18:00–02:00" es noche del **viernes**.)
- `currentCommercialNight(data, now: Date, timeZone): string` — si está
  abierto, la noche del rango en curso; si está cerrado, la del próximo que
  abre. Es lo que cancela la pausa (Q4).
- `rangeCloseMinute(range): number` — `(opens + duration) % 1440`, para mostrar.
- `lastOrderWarning(data, maxPrepMinutes: number, timeZone): …` — el insumo de
  la advertencia Q1 del editor ("pedidos hasta las 23:30 + prep 25 ⇒ sale
  23:54"); forma exacta a criterio de T1, consumida por T4.
- `storefrontGate(store: Pick<Store,'status'|'acceptingOrders'|'inStorePaymentEnabled'|'onlinePaymentEnabled'>, data, now, timeZone): StorefrontGate`
  con `type StorefrontGate = 'open' | 'closed_can_schedule' | 'paused' | 'no_payment' | 'suspended'`.
  Precedencia exacta: §7.8. Compone `canTakeOrders`/`canCollectPayment`
  **importándolos** de `src/lib/store-availability.ts` — ese archivo NO se toca.

### `src/models/store-hours.model.ts` (dueño: T1)

- `getStoreHoursData(storeId: number): Promise<StoreHoursData>` — cliente de
  servidor con RLS (las tablas tienen `select` público).
- `setStoreHours(storeId, ranges: StoreHoursRange[]): Promise<void>` — RPC
  `set_store_hours`, cliente de **SESIÓN** (verifica `auth.uid()` en el
  cuerpo; con admin client falla siempre, a propósito).
- `setStoreHoursOverride(storeId, override: StoreHoursOverride | { date: string; remove: true }): Promise<void>`
  — RPC `set_store_hours_override`, sesión.

### `src/models/order.model.ts` (dueño: T2) — firmas nuevas/cambiadas

- `createOrder(input)` — sin cambio de firma; validaciones §7.3 (lee horarios
  con una query propia del admin client — el checkout es anónimo — y calcula
  `scheduled_night` con la lib; el tope lo arbitra la RPC).
- `getActiveOrders(storeId)` — sin cambio de firma; suma
  `fire_at is null OR fire_at <= <now ISO>` (`.or(...)` de PostgREST).
- `getScheduledOrders(storeId): Promise<Order[]>` — NUEVA: programados vivos
  (`scheduled_for` no null, `status in ('pending','confirmed')`,
  `scheduled_for >= ahora − 1h`), **ordenados por `scheduled_for`** — no por
  `created_at`: la vista Pedidos acota por `created_at` y un programado a 3
  días caería "bajo hoy" (hecho verificado en el grilling).
- `getScheduledNightSummary(storeId, night: string): Promise<ScheduledNightSummary>`
  — el preview del diálogo destructivo (cuenta solo `fire_at > now`).
- `countScheduledByNight(storeId, nights: string[]): Promise<Record<string, number>>`
  — el insumo de `fullNights` en la cotización.
- `cancelScheduledNight(storeId, night: string): Promise<{ cancelledIds: number[]; count: number; paidCount: number; paidTotalCents: number }>`
  — llama la RPC `cancel_scheduled_orders` con el cliente de **SESIÓN**.

### `src/controllers/kitchen.controller.ts` (dueño: T2)

- `dispatchCancelledNotification(orderId, expectedStoreId?)` — patrón exacto de
  `dispatchReadyNotification`; solo WhatsApp (`order_cancelled`, ya existente
  en `notifier.port.ts:10` y con texto en el adapter); cero mails nuevos.

### Server Actions nuevas (dueño: T1, en `admin.actions.ts`)

- `saveStoreHoursAction(storeId, ranges)` / `saveStoreHoursOverrideAction(storeId, override)`
  — validan con los schemas de `store.schema.ts`, llaman al modelo, revalidan
  paths (patrón `updateStoreSettingsAction`). La de override, cuando la fecha
  se CIERRA, **no cancela sola**: devuelve el resultado y la UI ya pasó por el
  preview + `pauseScheduledNightAction` (un solo camino de cancelación).
- `previewScheduledNightAction(storeId, night?: string): Promise<ActionResult<ScheduledNightSummary>>`
  — sin `night` usa `currentCommercialNight` (pausa); con `night` es el cierre
  de fecha. Importa el resumen desde `order.model.ts` (import, no edición).
- `pauseScheduledNightAction(storeId, night?: string): Promise<ActionResult<…>>`
  — orquesta en este orden (§7.8.1): (1) si es pausa, apaga `accepting_orders`
  PRIMERO (la puerta se cierra antes de barrer); (2) `cancelScheduledNight`;
  (3) por cada id, `dispatchCancelledNotification` (import de T2). Falla
  parcial: puerta cerrada y programados vivos ⇒ la UI reintenta; nunca al revés.

La cancelación individual desde la bandeja **reusa** `updateOrderStatusAction`
(`kitchen.actions.ts`, dueño T2) con `status: 'cancelled'`.

---

## T0 — Schema y contratos · **hilo principal** (lane: `schema`)

Ningún agente escribe migraciones. Una migración
(`supabase/migrations/<ts>_scheduled_orders_and_store_hours.sql`) con,
exactamente:

1. **`store_hours`** (DDL §4.1): `id identity pk`, `store_id → stores on
   delete cascade`, `day_of_week smallint check 0–6`, `opens_at_minute
   smallint check 0–1439`, `duration_minutes smallint check 15–1440`,
   `created_at`. Índice `(store_id)`. RLS prendida, policy
   `for select using (true)`. Grants: `select` a `anon, authenticated`; `all`
   a `service_role`.
2. **`store_hours_overrides`** (DDL §4.1): ídem más `date date not null`,
   `opens_at_minute`/`duration_minutes` **nullables** con
   `check ((opens_at_minute is null) = (duration_minutes is null))` (nulls =
   cerrado ese día). Índice `(store_id, date)`. Misma RLS y grants que
   `store_hours`. **Son 23 tablas.**
3. **RPC `set_store_hours(p_store_id, p_ranges jsonb)`** — definer,
   `search_path = ''`, revoke `public, anon`, grant `authenticated,
   service_role`; `private.is_store_member` en el cuerpo; valida (día 0–6,
   límites, ≤ 4 por día, ≤ 28 total, sin solapamiento en minutos absolutos de
   semana módulo 10080); reemplaza la semana en una transacción. Mensajes
   entendibles.
4. **RPC `set_store_hours_override(p_store_id, p_date, p_ranges jsonb)`** —
   mismo esqueleto; `p_ranges` null/`[]` borra el override, `[{"closed":true}]`
   deja solo la fila-cerrado, o rangos con las mismas validaciones (sin
   solapamiento dentro de la fecha). **No cancela pedidos** (§7.8.2: la
   orquestación es del controller).
5. **RPC `cancel_scheduled_orders(p_store_id, p_night date) returns jsonb`** —
   definer, sesión (`is_store_member` en el cuerpo), revoke/grant como las
   otras. Cancela `scheduled_night = p_night and fire_at > now() and status in
   ('pending','confirmed')` del store, en una transacción; devuelve
   `{cancelled_ids, count, paid_count, paid_total_cents}` (pagos =
   `payment_status = 'approved'`). Las transiciones que ejecuta ya son legales
   para el trigger.
6. **`stores`**: `scheduled_delivery_enabled boolean not null default false` y
   `scheduled_capacity_per_night int check (scheduled_capacity_per_night > 0)` (null =
   sin tope). **`grant update (scheduled_delivery_enabled,
   scheduled_capacity_per_night) on public.stores to authenticated`** — los grants
   de `stores` son por columna y una columna nueva no queda escribible sola
   (patrón `auto_advance`).
7. **`orders`**: `scheduled_for timestamptz`, `fire_at timestamptz`,
   `scheduled_night date`. CHECKs:
   `fire_at is null or (scheduled_for is not null and fire_at <= scheduled_for)`
   y `(scheduled_for is null) = (scheduled_night is null)`. Índices parciales:
   `(store_id, scheduled_for) where scheduled_for is not null and status in ('pending','confirmed')`
   y `(store_id, scheduled_night) where scheduled_night is not null`.
8. **`create_order` redefinida** (la vigente es la de delivery — redefinir, no
   editar la vieja): suma `scheduled_for` y `scheduled_night` al INSERT
   enumerado; calcula adentro
   `fire_at = scheduled_for − make_interval(mins => coalesce(base_prep,0) + coalesce(delivery_minutes,0) + 5)`
   (5 = margen de plancha, vive SOLO acá; **no clampear a `now()`** — con el
   lead plano de 60 min un `fire_at` pasado es comportamiento esperado, Q11,
   comentario obligatorio); **tope por noche (Q3)**: si es programado y
   `scheduled_capacity_per_night` no es null ⇒ `select … from stores where id = …
   for update` (serializa programados de esa tienda; los inmediatos no pasan
   por el lock), cuenta vivos de esa `scheduled_night` y si
   `count >= capacity` hace `raise exception` con un marcador distinguible
   (p.ej. mensaje que empiece con `scheduled_night_full`) que T2 traduce a
   `DomainError`. No acepta `fire_at` ni tope del payload.
9. **`private.enforce_order_rules` redefinida** (ídem): `scheduled_for`,
   `fire_at` y `scheduled_night` entran a los **inmutables**. Transiciones
   intactas — copiar la tabla vigente tal cual (el test de paridad sigue verde).
10. **`advance_auto_orders` redefinida**: auto-start suma
    `and (o.fire_at is null or o.fire_at <= now())`. Auto-ready no se toca.
11. **`private.active_order_count` redefinida** (`functions.sql:126` — el
    espejo en Postgres de `COOKING_STATUSES`, el hueco de la v1): suma
    `and (o.fire_at is null or o.fire_at <= now())`.
12. **`store_dashboard` redefinida**: "preparación real" desde
    `greatest(confirmed_at, coalesce(fire_at, confirmed_at))`.
13. `orders_active_idx`: **verificado, no se toca** (parcial por `status`; el
    filtro de `fire_at` es WHERE adicional). Dejar el comentario actualizado.
14. Después: `npm run db:reset`, `npm run db:types`, y las adiciones de
    contrato a `src/models/types.ts`.

**Solo probable contra base real** (marcar para `tests/db/`): tenancy,
solapamiento y reemplazo atómico de las dos RPC de horarios; `anon` lee y no
escribe las dos tablas; `create_order` calcula `fire_at` exacto y acepta un
`fire_at` resultante en el pasado; **la carrera del tope** (dos `create_order`
concurrentes por el último lugar de la noche ⇒ exactamente uno gana);
`cancel_scheduled_orders` no toca disparados (`fire_at <= now()`) ni noches
ajenas ni otras tiendas; CHECKs de coherencia rebotan escrituras directas;
inmutabilidad de los tres campos; `advance_auto_orders` no arranca un pedido
en espera y sí uno con `fire_at` vencido; `active_order_count` excluye
en-espera; `expire_pending_orders` sigue cancelando un programado impago a los
45 min (y eso libera el cupo de la noche); paridad de transiciones intacta.

---

## T1 — Horarios y disponibilidad · lane: `backend` (senior-backend-engineer A)

**Dueño exclusivo de:**
- `src/lib/store-hours.ts` (nuevo)
- `src/models/store-hours.model.ts` (nuevo)
- `src/models/schemas/store.schema.ts` (schemas de horarios/overrides + los dos
  campos nuevos en el input de Ajustes)
- `src/models/store.model.ts` (`updateStoreSettings` suma las dos columnas Q2/Q3)
- `src/models/catalog.model.ts` (`getMaxPrepMinutes(storeId)` para la
  advertencia Q1)
- `src/controllers/admin.controller.ts` (lecturas: horarios+overrides, max prep)
- `src/controllers/admin.actions.ts` (las 4 actions del contrato)
- `src/controllers/storefront.controller.ts` (horarios a la vitrina)

**No puede tocar:** `src/lib/store-availability.ts`, `src/lib/dates.ts`,
`src/models/types.ts`, `order.model.ts`, `order.schema.ts`,
`kitchen.controller.ts`, `kitchen.actions.ts`, `checkout.controller.ts`, nada
de `src/views/**`, `src/app/**`, `supabase/**`.

**Criterios de aceptación (spec del test-engineer):**
1. `isOpenAt` con `[{5,1080,480}]` (vie 18:00–02:00, tz Buenos Aires): abierto
   vie 18:00 y sáb 01:59 **hora local**; cerrado sáb 02:00 y vie 17:59. Dos
   rangos el mismo día evalúan bien. `weekly` vacío ⇒ `true`.
2. Overrides: una fecha con override-cerrado da cerrado aunque el patrón diga
   abierto; una con rangos propios reemplaza el patrón ENTERO de esa fecha; un
   override de AYER que cruza medianoche afecta la madrugada de hoy; borrar el
   override devuelve el patrón.
3. `commercialNightOf`: sáb 01:30 dentro de "vie 18:00–02:00" ⇒ noche del
   viernes. `currentCommercialNight` cerrado-ahora ⇒ la del próximo rango.
4. `scheduleSlots`: ningún slot fuera de rango (overrides incluidos); primer
   slot ≥ `from + lead` redondeado a :00/:15/:30/:45; ninguno más allá de
   **3 días**; `excludeNights` elimina TODOS los slots de esa noche; un rango
   que cruza medianoche genera slots de los dos lados de las 00:00.
5. `storefrontGate`: precedencia suspendida > sin pago > pausada >
   cerrada-por-horario > abierta; solo `closed_can_schedule` habilita programar.
6. `pauseScheduledNightAction` respeta el orden puerta-primero (§7.8.1) y
   despacha `order_cancelled` por cada id devuelto; una falla del despacho no
   revierte la cancelación (patrón de notificaciones del repo).
7. Los schemas rechazan solapamientos/duplicados con mensaje en castellano
   ANTES de la base (la base es la autoridad; el schema hace el error legible).
8. Resultados idénticos con `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires` en
   el runner.

**Skills obligatorias:** `supabase` (RPC con cliente de sesión),
`supabase-postgres-best-practices`, `vercel-react-best-practices`, `context7`
(supabase-js, Zod v4).

**Deja rastro en** `02-development-horarios.md`.

---

## T2 — Pedido programado (dominio) · lane: `backend` (senior-backend-engineer B)

**Dueño exclusivo de:**
- `src/models/schemas/order.schema.ts`
- `src/models/order.model.ts`
- `src/controllers/checkout.controller.ts`
- `src/controllers/kitchen.controller.ts` (`dispatchCancelledNotification`)
- `src/controllers/kitchen.actions.ts` (despachar en destino `cancelled`)
- `src/app/api/orders/route.ts` (la cotización devuelve `fullNights` y lo que
  el selector necesita — Q3 hizo que los slots dejen de ser derivables solo en
  el browser)
- `src/services/notifications/email/email.port.ts` (+`scheduledForLabel`)
- `src/services/notifications/**` solo si la var nueva del WhatsApp lo exige
- `src/emails/order-receipt.tsx` ("Programado para …")

**No puede tocar:** `src/lib/store-hours.ts` (lo importa),
`store-hours.model.ts`, `store.model.ts`, `store.schema.ts`,
`catalog.model.ts`, `admin.controller.ts`, `admin.actions.ts`,
`storefront.controller.ts`, `types.ts`, `src/views/**`, `src/app/**` (salvo
`api/orders/route.ts`), `supabase/**`, otras plantillas de mail.

**Criterios de aceptación:**
1. `createOrderSchema` gana `scheduledFor: z.iso.datetime().optional()`
   (Zod v4, solo UTC-Z). `.strict()` intacto: claves extra siguen siendo 400
   con nombre.
2. `createOrder` valida (§7.3), todo `DomainError`: sin `scheduledFor` y
   cerrada por horario ⇒ rechaza invitando a programar; con `scheduledFor`:
   múltiplo de 15; **lead 60 min planos** (Q11 — **comentario obligatorio y
   fuerte**: un carrito con prep+delivery > 60 produce `fire_at` en el pasado
   y entra al KDS en el próximo poll — "ya vas tarde, arrancá"; NO clampear,
   NO cambiar el piso por fórmula, decisión de producto del 2026-08-29);
   horizonte **3 días**; `isOpenAt` con overrides, misma lib que el browser;
   delivery programado ⇒ `scheduledDeliveryEnabled` **y** ≥1 repartidor activo
   (Q2); deriva `scheduled_night` con `commercialNightOf` y lo pasa a la RPC.
3. El marcador `scheduled_night_full` de la RPC se traduce a
   `DomainError('Esa noche ya está completa. Elegí otro día.')` — nunca llega
   crudo al browser.
4. Campos congelados exactamente como la tabla de §6 (`demand_multiplier`
   null, `eta_minutes` null, `eta_at = scheduled_for`,
   `delivery_minutes = delivery.minutes` plano — nunca `busyMinutes`).
5. `refreshFrozenEta` early-return si `scheduled_for` no es null (un pago
   aprobado NO mueve `eta_at`).
6. `estimateEta` excluye `fire_at > now` del conteo de demanda (el espejo SQL
   `active_order_count` lo cubre T0 — los DOS lados, §5.3).
7. `getActiveOrders` no devuelve `fire_at > now` y sí apenas vence — el KDS
   entero cuelga de esta query; ES el criterio del feature.
8. `getScheduledOrders` ordenado por `scheduled_for`; `toOrder` mapea
   `scheduledFor`/`fireAt`/`scheduledNight`.
9. La cotización expone `fullNights` (vía `countScheduledByNight` contra el
   tope de la tienda) solo cuando hay tope configurado.
10. `dispatchCancelledNotification`: WhatsApp `order_cancelled` para TODA
    cancelación vía `updateOrderStatusAction`; sin mail; una falla de envío no
    revierte nada. (Las masivas lo invocan desde T1 por import.)
11. Comprobante y WhatsApp de confirmación muestran la hora pactada
    (`formatDateTime`, zona del local). Cero plantillas de mail nuevas.
12. Un pedido inmediato se comporta EXACTAMENTE igual que hoy (regresión cero).

**Skills obligatorias:** `supabase`, `supabase-postgres-best-practices`,
`vercel-react-best-practices`, `context7` (Zod v4, supabase-js, react-email).

**Deja rastro en** `02-development-pedido-programado.md`.

---

## T3 — Vitrina · lane: `frontend` (frontend-react-craftsman A)

**Dueño exclusivo de:**
- `src/app/[store]/**` (page, carrito, checkout, producto)
- `src/views/storefront/**`
- `src/views/shared/states.tsx` (variante de `ClosedNotice`: próxima apertura
  + CTA programar)
- `src/app/pedido/[token]/**`

**No puede tocar:** `src/views/shared/surfaces.tsx` ni el resto de
`views/shared`, `src/models/**`, `src/controllers/**` (los importa),
`src/lib/**`, `src/app/api/**`, `src/app/admin/**`, `src/views/admin/**`.

**Qué tiene que poder hacer el usuario (el tratamiento visual lo decide
`impeccable shape`):**
1. **Cerrada por horario** (`storefrontGate() === 'closed_can_schedule'`): ver
   que está cerrado y cuándo abre (`nextOpening`), recorrer la carta, armar
   carrito, y llegar al checkout solo en modo programado. `paused` /
   `no_payment` / `suspended` se ven EXACTAMENTE como hoy.
2. **Checkout**: "Para ahora" (default, solo si abierta) o "Programar" con
   slots de `scheduleSlots` sobre los horarios que la page trae + las
   `fullNights` de la cotización (`excludeNights`) — una noche llena no ofrece
   NINGÚN slot. La opción programado+delivery solo aparece con
   `scheduledDeliveryEnabled` y repartidores activos en la quote (Q2). El slot
   viaja como `scheduledFor` (ISO) en el POST existente.
3. **Errores del servidor** ("esa noche ya está completa", slot inválido, lead
   corto) se muestran como los demás errores del checkout — la foto de
   `fullNights` puede quedar vieja y el rebote transaccional es el camino
   normal, no un caso raro.
4. **Tracking**: hora pactada formateada en la zona del local
   (`formatDateTime` de `src/lib/dates.ts`); `etaMinutes === null` es la señal.
5. Targets ≥ 44 px en el selector de slots; sin kicker; motion solo el momento
   autorizado.

**Skills obligatorias, con rutas:** `impeccable` — ANTES
`.claude/skills/impeccable/reference/craft-floor.md` y el brief
`.impeccable/surfaces/src-app-store-page-tsx.md`; `web-design-guidelines`
antes de cerrar; `frontend-design`; `vercel-react-best-practices`; `context7`.
NO rerruear identidad (`context.mjs`/`concept-seed.mjs` prohibidos).

**Depende de:** contratos de T1 (lib/gate) y T2 (schema del POST, quote).

**Deja rastro en** `02-development-vitrina.md`.

---

## T4 — Admin (Operate) · lane: `frontend` (frontend-react-craftsman B)

**Dueño exclusivo de:**
- `src/app/admin/(app)/ajustes/**`
- `src/app/admin/(app)/pedidos/**`
- `src/views/admin/ajustes/**` (incluye `settings-form.tsx`, donde vive el
  toggle de `acceptingOrders` hoy — línea 610)
- `src/views/admin/pedidos/**`

**No puede tocar:** `src/views/admin/kds/**` (el KDS NO cambia de UI: el
filtro es del modelo), `src/app/admin/(app)/page.tsx`, `views/shared/**`,
`views/storefront/**`, `src/controllers/**`, `src/models/**` (importa
`getScheduledOrders` desde la page — lectura plana permitida, como ya hace
`pedidos/page.tsx` con `getOrderHistory`).

**Qué tiene que poder hacer el usuario:**
1. **Ajustes — editor de horarios**: por día 0, 1 o 2+ rangos (hasta 4),
   cruces de medianoche expresados naturalmente ("18:00 a 02:00"); estado
   "sin horarios = siempre abierta"; guardar la semana entera
   (`saveStoreHoursAction`); **advertencia Q1 calculada con el prep más alto
   real del local** (`lastOrderWarning` + `getMaxPrepMinutes` vía el
   controller): "Se aceptan pedidos hasta las 23:30. Tu producto más lento
   tarda 25 min, así que un pedido de las 23:29 sale 23:54." Texto genérico
   no cumple el criterio.
2. **Ajustes — calendario de overrides** (Q13): cerrar una fecha, darle rangos
   propios, o quitar el override. Cerrar una fecha con programados adentro
   pasa por el MISMO diálogo destructivo del punto 4 (preview con `night` =
   esa fecha) antes de ejecutar.
3. **Ajustes — programados**: toggle de delivery programado y campo de tope
   por noche (null = sin tope) — viajan por el guardado normal de Ajustes
   (Q2/Q3, columnas con grant).
4. **Pausar pedidos = diálogo destructivo (Q4)**: flippear `acceptingOrders` a
   off NO guarda directo — llama `previewScheduledNightAction`, muestra el
   conteo real ("Esto cancela 6 pedidos programados de esta noche. 4 están
   pagados ($47.800). El reembolso lo gestionás vos desde Mercado Pago.") y
   recién confirmado ejecuta `pauseScheduledNightAction`. Cero programados ⇒
   el flip guarda como siempre, sin fricción. Volver a prender: guardado
   normal. El copy deja claro que la pausa ahora tiene costo (era reversible y
   gratis; ya no).
5. **Pedidos — bandeja "Programados"**: agrupada y ordenada por
   `scheduled_for` (NUNCA `created_at` — verificado que el historial acota por
   creación y un programado a 3 días caería "bajo hoy"), con hora pactada,
   hora de entrada a cocina (`fireAt`, incluso si ya pasó) y estado de pago;
   cancelar uno con `updateOrderStatusAction('cancelled')` con confirmación
   que advierte el reembolso manual si estaba pago (Q8). El historial
   existente no cambia.
6. Operate: densidad, retomar el hilo tras interrupción; nada de la
   composición de la vitrina.

**Skills obligatorias, con rutas:** `impeccable` — ANTES
`.claude/skills/impeccable/reference/craft-floor.md` **y**
`.claude/skills/impeccable/reference/operate.md`, más el brief
`.impeccable/surfaces/src-app-admin-app-page-tsx.md`; `web-design-guidelines`;
`vercel-react-best-practices`; `context7` (react-hook-form).

**Depende de:** T1 (actions y lib) y T2 (`getScheduledOrders`).

**Deja rastro en** `02-development-admin.md`.

---

## Cierre (hilo principal)

- Integración: `npm run typecheck && npm run lint && npm test && npm run build`.
- `code-reviewer` → `03-review.md`; `test-engineer` → `03-tests.md` (incluye
  los casos `tests/db/` de T0 — la carrera del tope, RLS, RPCs, trigger,
  CHECKs y crons solo se prueban contra base real).
- Nada se commitea sin las dos puertas verdes.

## Fuera de alcance (todas las tareas)

Auto-refund por API (Q8: manual); tope por franja horaria (el tope es por
noche, Q3); "última orden" derivada (Q1: advertencia, no regla); cancelación
automática al AFINAR rangos de un override (solo al cerrar la fecha — la UI
advierte); mail de cancelación (Q7 es solo WhatsApp); menús por franja;
turnos de repartidor (no existe el concepto — solo `is_active`); cambios en
`/repartidor`, `/backoffice`, el KDS, `expire_pending_orders`, los baldes de
rate limiting y `vercel.json`.
