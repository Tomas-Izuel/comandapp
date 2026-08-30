# T1 — Horarios y disponibilidad — dev log

Agente: senior-backend-engineer (slice T1). Implementa `src/lib/store-hours.ts`,
`src/models/store-hours.model.ts`, y extiende `store.schema.ts`, `store.model.ts`,
`catalog.model.ts`, `store.mapper.ts`, `admin.controller.ts`, `admin.actions.ts`,
`storefront.controller.ts`, según `01-tasks.md` (T1).

## Archivos tocados

**Nuevos:**
- `src/lib/store-hours.ts` — la lib pura del almanaque.
- `src/models/store-hours.model.ts` — lectura (cliente de sesión) + las tres RPC de escritura.

**Editados:**
- `src/models/schemas/store.schema.ts` — schemas de horarios/overrides + 2 campos nuevos en `storeSettingsInputSchema`.
- `src/models/store.model.ts` — `updateStoreSettings` escribe `scheduled_delivery_enabled`/`scheduled_capacity_per_night`.
- `src/models/catalog.model.ts` — `getMaxPrepMinutes(storeId)`.
- `src/models/mappers/store.mapper.ts` — `toStore()` puebla `scheduling`.
- `src/controllers/admin.controller.ts` — `getStoreScheduleForAdmin(storeId)`.
- `src/controllers/admin.actions.ts` — 6 acciones (ver abajo; 2 más de las 4 documentadas en el contrato).
- `src/controllers/storefront.controller.ts` — `getStorefront()` suma `schedule` al retorno.

## Contratos expuestos

### `src/lib/store-hours.ts` (puro, sin `server-only`, sin imports de Postgres)

```ts
SCHEDULE_STEP_MINUTES = 15
SCHEDULE_HORIZON_DAYS = 3
SCHEDULE_LEAD_MINUTES = 60

isOpenAt(data: StoreSchedule, instant: Date, timeZone: string): boolean
nextOpening(data: StoreSchedule, from: Date, timeZone: string): Date | null
scheduleSlots(data: StoreSchedule, from: Date, timeZone: string, opts: { leadMinutes: number; excludeNights?: string[] }): Date[]
commercialNightOf(data: StoreSchedule, instant: Date, timeZone: string): string
currentCommercialNight(data: StoreSchedule, now: Date, timeZone: string): string
rangeCloseMinute(range: Pick<StoreHoursRange,'opensAtMinute'|'durationMinutes'>): number
lastOrderWarning(data: StoreSchedule, maxPrepMinutes: number, timeZone: string): LastOrderWarning[]
storefrontGate(store: Pick<Store,'status'|'acceptingOrders'|'inStorePaymentEnabled'|'onlinePaymentEnabled'>, data: StoreSchedule, now: Date, timeZone: string): StorefrontGate
```

`LastOrderWarning = { dayOfWeek: number; closesAtLabel: string; lastOrderOutLabel: string }`
— una entrada por rango semanal (no un resumen único), pensada para que T4 la
muestre al lado de cada fila del editor. `timeZone` está en la firma porque
`01-tasks.md` la fija así, pero la aritmética es sobre minutos locales (ya
vienen así en `StoreHoursRange`) y no la usa — documentado en el código con
`void timeZone` para que el lint no se queje sin mentir sobre por qué está.

`storefrontGate` compone `canTakeOrders`/`canCollectPayment` de
`store-availability.ts` (no tocado) tal como pedía el contrato: si
`!canTakeOrders`, distingue `no_payment` de `paused` mirando `canCollectPayment`
por separado, porque `canTakeOrders` colapsa esas dos causas en un booleano y
la precedencia de `StorefrontGate` las necesita distinguibles.

**Decisión de implementación no explícita en el contrato:** `isOpenAt` y
`commercialNightOf` miran hoy y **2 días hacia atrás** (no solo "ayer"). Motivo:
`opens_at_minute` llega hasta 1439 y `duration_minutes` hasta 1440 (los CHECK
de la migración), así que un rango representable puede seguir "vivo" hasta
~48 h después de que arrancó su día. Mirar solo ayer alcanza para el caso real
(vie 18:00–02:00) pero no para ese extremo que la base permite. Costo: unas
pocas iteraciones más por llamada, sin downside de corrección.

### `src/models/store-hours.model.ts`

```ts
getStoreHoursData(storeId: number): Promise<StoreSchedule>
setStoreHours(storeId: number, ranges: StoreHoursRange[]): Promise<void>
setStoreHoursOverride(storeId: number, override: StoreHoursOverride | { date: string; remove: true }): Promise<void>
```

Las tres RPC se llaman con `createClient()` (cliente de sesión), nunca con el
admin client — `SECURITY DEFINER` + `private.is_store_member()` leyendo
`auth.uid()`, que con `service_role` no existe. Los errores de Postgres se
traducen a `DomainError` cuando el SQLSTATE es `42501` (permiso), `23514`
(`check_violation`: límites/solapamiento) o `22023`
(`invalid_parameter_value`: forma del payload) — el resto es un `Error` interno
genérico. Ojo: comparo contra el SQLSTATE **numérico** (`error.code`), no contra
el alias de texto que usa `raise ... using errcode = 'check_violation'` en la
migración — PostgREST devuelve el código, no el alias.

### `src/models/schemas/store.schema.ts`

- `storeHoursRangeSchema`, `storeHoursWeeklyInputSchema` (array completo, valida
  ≤4/día, ≤28 total, sin solapamiento circular — mismo algoritmo que la RPC,
  offsets ±10080).
- `storeHoursOverrideDateSchema`, `storeHoursOverrideInputSchema` (valida forma
  cerrado/abierto y solapamiento lineal dentro de la fecha).
- `storeSettingsInputSchema` gana `scheduledDeliveryEnabled` (bool, default
  `false`) y `scheduledCapacityPerNight` (int positivo o `null`, default
  `null`).

### `src/controllers/admin.controller.ts`

```ts
type StoreScheduleAdmin = { schedule: StoreSchedule; maxPrepMinutes: number }
getStoreScheduleForAdmin(storeId: number): Promise<StoreScheduleAdmin>
```

Decisión: **no** devuelve `lastOrderWarning` precomputado. La vista de T4 ya
tiene `store.timezone` desde `resolveAdminSession()`, así que compone
`lastOrderWarning(schedule, maxPrepMinutes, store.timezone)` ella misma
importando la función pura — evita pasarle `timezone` a este controller sin
necesidad real.

### `src/controllers/admin.actions.ts` — 6 acciones (4 del contrato + 2 wrappers)

```ts
saveStoreHoursAction(storeId: number, ranges: StoreHoursRange[]): Promise<ActionResult>
saveStoreHoursOverrideAction(storeId: number, override: StoreHoursOverride | { date: string; remove: true }): Promise<ActionResult>
deleteStoreHoursOverrideAction(storeId: number, date: string): Promise<ActionResult>   // NUEVA, no estaba en 01-tasks.md
previewScheduledNightAction(storeId: number, night?: string): Promise<ActionResult<ScheduledNightSummary>>
pauseScheduledNightAction(storeId: number, night?: string): Promise<ActionResult<CancelScheduledNightResult>>
```

`deleteStoreHoursOverrideAction` no está en el contrato de `01-tasks.md` (que
pliega el borrado dentro de `saveStoreHoursOverrideAction` con
`{date, remove:true}`), pero la vista de T4
(`src/views/admin/ajustes/schedule-editor.tsx`) ya la importaba con esa firma
al momento de integrar — la agregué como wrapper de una línea sobre la acción
existente en vez de bloquear la integración por un nombre. Documentado en el
JSDoc de la función.

**`pauseScheduledNightAction` — desvío importante respecto de mi primer
borrador, corregido tras leer el JSDoc que T2 dejó en `cancelScheduledNight`
(`order.model.ts`):** mi primera versión togglaba `stores.accepting_orders`
con una escritura RLS separada ANTES de llamar a `cancelScheduledNight`, tal
como describía `00-architecture.md §7.8.1` en dos pasos. Pero la RPC
`cancel_scheduled_orders` (la que T0 ya escribió) acepta `p_pause` y hace el
toggle **dentro de la misma transacción** que la cancelación — es mejor que el
plan original (atómico de verdad, sin ventana de falla parcial). T2 expuso esto
como `cancelScheduledNight(storeId, night, { pause: boolean })` y dejó una nota
explícita pidiendo que quien pausa llame con `{ pause: true }` y **no** togglee
aparte. Corregí mi acción para hacer eso: `cancelScheduledNight(id, targetNight,
{ pause: isPause })`, sin ninguna escritura propia sobre `accepting_orders`. De
paso borré el helper `setAcceptingOrders` que había agregado en
`store.model.ts` para el primer enfoque — quedaba muerto y reintroducía
exactamente la ventana de falla parcial que la RPC atómica vino a cerrar.

`isPause = night === undefined`: sin `night` es "pausar pedidos" (calcula
`currentCommercialNight` y pasa `pause: true`); con `night` es cerrar una
fecha puntual del calendario de excepciones (pasa `pause: false`, porque esa
fecha ya se cerró con el override guardado antes, en otra acción).

Los tipos de retorno de `previewScheduledNightAction`/`pauseScheduledNightAction`
usan `Awaited<ReturnType<typeof getScheduledNightSummary>>` /
`Awaited<ReturnType<typeof cancelScheduledNight>>` en vez de nombrar un tipo
importado — a propósito: al momento de escribir esto, `types.ts` todavía no
tenía `ScheduledNightSummary` (lo agregó el hilo principal después, mientras yo
trabajaba) y el contrato documentado para `cancelScheduledNight` en
`01-tasks.md` no coincidía con lo que la RPC de verdad devuelve (T2 lo
documentó: sin `paidCount`, con `cancelledCount` en vez de `count`). Con
`ReturnType` mi código nunca dependió de adivinar ese shape — se ajusta solo a
lo que T2 termine exportando.

### `src/controllers/storefront.controller.ts`

`StorefrontData` gana `schedule: StoreSchedule`. **No** agrego un `gate`
precomputado: `storefrontGate()` es pura y depende de un `now` que solo tiene
sentido fijar en el momento exacto en que la page lo necesita, así que dejo que
quien arma la vitrina (`app/[store]/page.tsx`, de T3) la llame directo con
`store`, `schedule`, `new Date()` y `store.timezone`.

**No toqué** `getStoreForSlug` (alias que usan `carrito/page.tsx` y
`checkout/page.tsx`) ni `getProductDetail`: si esas pages necesitan el
calendario, pueden importar `getStoreHoursData` directo de
`store-hours.model.ts` — es una lectura plana permitida por CLAUDE.md ("una
page puede llamar a un modelo directamente para una lectura plana"), y sumar
acá un wrapper que solo reenvía sería indirección sin valor.

## Reglas de negocio implementadas (spec para el test-engineer)

1. **`isOpenAt`**: `weekly` vacío ⇒ siempre abierta (sin excepción, ni con
   overrides cargados — un local sin patrón no tiene nada que "override-ar").
   Un rango se ancla al día que ABRE; se evalúan hoy y hasta 2 días atrás para
   cubrir cruces de medianoche y el caso extremo representable por el schema
   (opens_at_minute=1439 + duration=1440). Los overrides de una fecha
   REEMPLAZAN el patrón entero de esa fecha (cerrado, o solo sus rangos
   propios) — nunca se combinan con el patrón semanal de ese día.
2. **`commercialNightOf`**: el día que abre el rango que contiene al instante;
   si no hay ningún rango conteniéndolo (cerrado en ese instante) o si es
   siempre-abierta, cae al día calendario local.
3. **`currentCommercialNight`**: abierto ahora ⇒ noche del rango en curso;
   cerrado ⇒ noche del próximo que abre; sin apertura futura en el horizonte ⇒
   día calendario local (caso borde, no debería pasar en un local con horario
   real, pero no debe tirar).
4. **`nextOpening`**: NO mira hacia atrás (a diferencia de `isOpenAt`) — un
   rango que ya empezó no es una apertura "próxima". `null` si siempre-abierta
   o si no hay ninguna apertura dentro de `SCHEDULE_HORIZON_DAYS` (3 días)
   desde `from`.
5. **`scheduleSlots`**: instantes cada 15 min, desde `from + leadMinutes`
   redondeado hacia ARRIBA al :00/:15/:30/:45 **local** (no en ms crudos de
   UTC — importa si algún local usara una zona con offset no múltiplo de 15,
   caso hoy inexistente pero cubierto), filtrados por `isOpenAt` y por
   `excludeNights` (saca TODOS los slots de esa noche, no slot por slot).
6. **`storefrontGate`**: precedencia `suspended > no_payment > paused >
   closed_by_hours > open`. Solo `closed_by_hours` deja programar (dato que
   consume T3, no lo devuelve este tipo — es el `kind` el que la UI lee).
7. **Schemas de horarios**: rechazan solapamiento (circular en la semana, lineal
   dentro de una fecha), límites de cantidad (4/día, 28/semana, 4/fecha), y la
   forma cerrado⇄abierto de un override, con mensajes en castellano — ANTES de
   que la RPC (la autoridad real) los rechace también.
8. **`pauseScheduledNightAction`**: pausa = puerta + cancelación ATÓMICAS via
   `cancel_scheduled_orders(..., p_pause=true)` (una sola transacción, no dos
   pasos); despacha `dispatchCancelledNotification` por cada id cancelado,
   sin que una falla de envío revierta nada. Cierre de fecha puntual: mismo
   camino, sin tocar `accepting_orders`.
9. **`getMaxPrepMinutes`**: máximo de TODA la carta (activos e inactivos) — la
   advertencia describe la cocina, no el catálogo de este minuto.

## Necesita base real (`tests/db/`)

- Las 3 RPC de horarios: tenancy (`is_store_member` rechaza a un no-miembro),
  reemplazo atómico de la semana, solapamiento rechazado en la base (no solo
  en Zod), forma cerrado/abierto del override.
- `anon` puede leer `store_hours`/`store_hours_overrides` de una tienda activa
  y no puede escribir ninguna de las dos por ningún camino directo.
- Grant de columna: `authenticated` puede escribir
  `scheduled_delivery_enabled`/`scheduled_capacity_per_night` en `stores` vía
  RLS (verificar con el cliente de sesión, no el admin).
- `cancel_scheduled_orders` con `p_pause=true`: verificar que el toggle de
  `accepting_orders` y la cancelación quedan en la MISMA transacción (un fallo
  simulado a mitad de camino no debe dejar un estado a medias) — esto es
  responsabilidad de T0/T2 documentarlo pero afecta directamente a
  `pauseScheduledNightAction`.

Todo lo demás (`isOpenAt`, `nextOpening`, `scheduleSlots`, `commercialNightOf`,
`storefrontGate`, los schemas) es lógica pura, sin I/O — se prueba con
`vitest` normal, sin Docker. Corrí ambos con `TZ=UTC` y con
`TZ=America/Argentina/Buenos_Aires` a mano contra un par de casos del criterio
#1 (vie 18:00–02:00) y dieron igual, pero no escribí tests (no es mi rol).

## Problemas de schema/contrato encontrados y NO arreglados (reporte al hilo principal)

1. **`platform.model.ts` no compila** (`npm run typecheck` falla ahí,
   repo-wide): `toPlatformStoreRow()` construye un `Store`-shape sin el campo
   `scheduling`, que `types.ts` ya exige desde que se agregó `Store.scheduling`.
   La causa de fondo es que la RPC `platform_stores` (T0) **no** devuelve
   `scheduled_delivery_enabled`/`scheduled_capacity_per_night` —
   `00-architecture.md §7.7` lo marca explícitamente como "NO toca" esas
   columnas. No es mi archivo (no está en la lista de T1) y no toco RPCs, así
   que lo dejo reportado: para cerrar esto hay que (a) sumar esas dos columnas
   al `jsonb_build_object` de `platform_stores`, y (b) que quien sea dueño de
   `platform.model.ts` sume `schedulingEnabled`/`scheduledCapacityPerNight` (o
   los nombres que corresponda) a `PlatformStoreRpcRow` y a
   `toPlatformStoreRow()`. Sin esto el build entero queda roto por
   `tsc --noEmit`, así que es bloqueante para el cierre del pipeline.
2. **Contrato de `01-tasks.md` para `cancel_scheduled_orders`/
   `cancelScheduledNight` no coincidía con la migración ya escrita** — T2 ya lo
   documentó extensamente en su propio JSDoc (`order.model.ts`), lo señalo acá
   solo para que quede registrado desde el lado de T1 también: mi
   `pauseScheduledNightAction` depende de esa reconciliación y quedó escrita
   contra lo que T2 terminó exportando, no contra el borrador del plan.
3. **`deleteStoreHoursOverrideAction`** no estaba en el contrato de
   `01-tasks.md` pero la vista de T4 la esperaba con esa firma exacta — la
   agregué como wrapper (ver arriba). Si el hilo principal prefiere que
   `01-tasks.md` quede como única fuente de verdad, esto debería anotarse ahí
   para la próxima vez.

## Deferido / fuera de alcance de este slice

- No se tocó `src/lib/store-availability.ts`, `src/lib/dates.ts`, `types.ts`,
  `order.model.ts`, `order.schema.ts`, `checkout.controller.ts`,
  `kitchen.controller.ts`, `kitchen.actions.ts`, ni nada de `views/**`/`app/**`
  — son de otros slices, solo se importó de ellos.
- `getProductDetail`/`getStoreForSlug` no ganaron `schedule`: si T3 lo necesita
  ahí, puede importar `getStoreHoursData` directo (lectura plana permitida) o
  pedir que se sume acá en una iteración siguiente.

---

## Post-review: arreglos de m2, m1 y m4 (03-review.md)

El coordinador pidió atender estos tres hallazgos del `code-reviewer` sobre
mi slice. Los tres están resueltos con las piezas existentes, sin tocar SQL.

### m2 — `candidateDays`/`nextOpening` no aguantaban DST (el que más importaba)

Las dos funciones retrocedían/avanzaban exactamente `DAY_MS` (24h en ms) sobre
un instante y volvían a preguntarle la fecha a `zonedDay()`. En una zona SIN
cambio de horario (Argentina) esto es inobservable; en una CON cambio de
horario, un día de transición (23 o 25 h reales) desalinea el candidato —
`nextOpening` podía saltear el día de transición entero o repetir el
anterior, y lo mismo para `candidateDays` (usado por `isOpenAt`/
`commercialNightOf`).

Arreglo: agregué `addCalendarDays(day, delta)` — aritmética PURA de fecha
sobre el string `YYYY-MM-DD` (mismo truco que `dayOfWeekOf`, sin ninguna
conversión de zona), y la usé para avanzar/retroceder el día en las dos
funciones. El instante real de cada día candidato se sigue resolviendo con
`zonedDayStart(day, timeZone)` — la función de `dates.ts` que SÍ hace el
cálculo de offset con la técnica de dos pasadas —, pero ahora se llama DE
NUEVO en cada vuelta a partir de un string de fecha correcto, en vez de
acumularse sobre un instante que puede haber ido a la deriva. No pude
importar `zoneOffsetMs` directo porque no está exportada de `dates.ts` (y
`dates.ts` no es mío para tocar); esta solución evita necesitarla del todo,
porque el paso de un día a otro deja de ser aritmética de instante.

Verificado: `npm run typecheck`, `npm run lint` limpios, y con Docker arriba
`tests/lib/store-hours.test.ts` (47 tests, del test-engineer) sigue en verde
sin ningún cambio de mi parte a los tests.

### m1 — Query duplicada de `store_hours` en la vitrina

`src/app/[store]/page.tsx` (de T3, pero el fix es de una línea y el
coordinador lo pidió acá): destructuraba solo `{ store, categories }` de
`getStorefront(slug)` y volvía a llamar `getStoreHoursData(store.id)` dos
líneas después, aunque `getStorefront` ya trae `schedule` desde que lo agregué
al contrato. Cambié la destructuración a `{ store, categories, schedule }` y
saqué el import/llamada duplicada. Una sola query de `store_hours` por render
del home, en vez de dos.

### m4 — Cerrar una fecha con programados no era atómico

`schedule-editor.tsx` (`confirmClose`) llamaba `pauseScheduledNightAction`
(cancela) y RECIÉN DESPUÉS `saveStoreHoursOverrideAction(...,
{isClosed:true})` (guarda el cierre), dos awaits secuenciales sin nada que
los una. Si el segundo fallaba, quedaban pedidos YA cancelados con la fecha
todavía "abierta" según el patrón semanal — el peor estado a medio camino,
porque un cliente nuevo podía seguir programando ahí.

**No es atómico de verdad** (dos RPC distintas, sin transacción
compartida) — arreglar eso necesitaría una tercera RPC en Postgres, y **no lo
escribí**: es un cambio de schema, se reporta más abajo para el hilo
principal. Lo que SÍ resolví con las piezas existentes es el ORDEN:
agregué `closeStoreHoursDateAction(storeId, date)` en `admin.actions.ts` que
guarda el override cerrado PRIMERO y recién después llama
`cancelScheduledNight(id, date, { pause: false })` + despacha
`dispatchCancelledNotification` por cada id. Con este orden, una falla en el
paso de cancelar deja la fecha correctamente cerrada (nadie más puede
programar ahí) con algunos programados viejos pendientes de cancelar — se
reintenta sin pérdida de datos, mismo patrón que ya documentaba
`pauseScheduledNightAction` para "la puerta cerrada con programados vivos".
Actualicé `schedule-editor.tsx` para llamar esta única acción en vez de las
dos por separado (cambio en un archivo que no es mío, pero mínimo y en la
línea que el reviewer señaló).

## Nuevo hallazgo de schema, encontrado al verificar con Docker arriba (REPORTE, no arreglado)

**`store_hours_public_read`/`store_hours_overrides_public_read` rompen la
lectura de `anon` con `permission denied for function is_store_member`.**

La migración renombrada (`20260829170000_scheduled_orders_and_hours.sql`)
agregó `or (select private.is_store_member(store_hours.store_id))` a la
policy `for select to anon, authenticated` de las dos tablas (el fix de M2
mayor del review, para que un dueño con la tienda suspendida siga viendo su
propio horario). Pero `private.is_store_member(bigint)` tiene
`revoke execute ... from public, anon, authenticated; grant execute ... to
authenticated` (`20260828130000_delivery.sql:128-129` y
`20260825120200_functions.sql:22-23`) — nunca tuvo EXECUTE para `anon`. Como
la policy es UNA sola compartida por los dos roles, Postgres exige el
privilegio de ejecución en tiempo de planificación para CUALQUIER rol que la
use, así que un `select` anónimo sobre `store_hours` falla entero, aunque la
rama que de verdad necesita evaluarse para `anon` sea solo `status =
'active'`.

Confirmado corriendo la suite con la base real (`npm test`, Docker arriba):
`tests/db/scheduled-orders-and-hours.test.ts` → "anon SÍ puede leer los
horarios de una tienda activa" falla con exactamente ese error.

**No lo arreglo yo** (es la migración, del hilo principal). SQL sugerido —
la opción más chica y segura, dentro del mismo archivo ya tocado por esa
migración:

```sql
grant execute on function private.is_store_member(bigint) to anon;
```

Es seguro: para una sesión `anon`, `is_store_member` lee `auth.uid()`, que es
`null` sin sesión, así que siempre devuelve `false` — no hay ninguna fila que
un `anon` no debería ver que esto exponga. Alternativa más quirúrgica, si se
prefiere no ampliar los privilegios de una función que gatea acceso de staff
en otras tablas: partir la policy en dos, una `to anon using (status =
'active')` y otra `to authenticated using (status = 'active' or
is_store_member(...))`. Cualquiera de las dos cierra el test que hoy está
rojo.

## Verificación final

`npm run typecheck` y `npm run lint` limpios sobre TODO el repo (no solo mis
archivos). `npm test` con Docker arriba: 640/641 en verde; el único rojo es
el hallazgo de grants reportado arriba, no relacionado con ningún cambio de
código de esta ronda.
