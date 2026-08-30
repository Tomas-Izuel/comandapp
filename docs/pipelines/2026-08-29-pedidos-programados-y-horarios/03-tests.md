# Pedidos programados y horarios — informe de test-engineer

## Veredicto

**SUITE RED — 1 test rojo, 640 verdes, sobre 641 (0 salteados).**

El único rojo es un **bug real de producción** (RLS de `store_hours`/
`store_hours_overrides`), no un test mal escrito ni un problema de entorno.
`npm run typecheck` y `npm run lint` están limpios.

```
Test Files  1 failed | 52 passed (53)
     Tests  1 failed | 640 passed (641)
```

---

## Sorpresa de entorno: Docker SÍ estaba disponible (a mitad de la corrida)

El encargo decía "Docker no está disponible, así que toda `tests/db/` se
salteará sola". Al arrancar, `dbAvailable` daba `true` (el stack local ya
estaba arriba) pero la migración de este feature no estaba aplicada — ni ella
ni las dos que la siguen (`rate_limits`, `online_payment_flag`). La causa:
`supabase/migrations/20260829140000_scheduled_orders_and_hours.sql` tenía el
**mismo timestamp** que una migración ya aplicada
(`20260829140000_reserve_subdomain_slugs.sql`), así que Supabase la daba por
"ya corrida" sin ejecutar una sola línea suya — y como el runner de
migraciones corta ahí, tampoco corrían las dos migraciones posteriores.

No toqué migraciones ni el estado de la base (no me corresponde). Mientras
escribía este informe, otro hilo/agente renombró el archivo a
`20260829170000_scheduled_orders_and_hours.sql` y aplicó las tres migraciones
pendientes — lo verifiqué contra `supabase_migrations.schema_migrations` y
volví a correr todo. **Con eso resuelto, `tests/db/` corrió de punta a punta
contra Postgres real.** No queda nada pendiente por falta de Docker: todo lo
de abajo se ejecutó y se verificó.

---

## Qué cubrí

### `src/lib/store-hours.ts` — `tests/lib/store-hours.test.ts` (NUEVO, 47 tests, puro)

- `isOpenAt`: cruce de medianoche (vie 18:00 abierto inclusive, vie 17:59
  cerrado, sáb 01:59 abierto, sáb 02:00 cerrado exclusive), varios rangos el
  mismo día (corte del mediodía), overrides ganando en las dos direcciones
  (cierran un día abierto, abren uno cerrado), un override que cruza
  medianoche, **y el caso documentado por T1 pero no obvio**: `weekly` vacío
  ignora CUALQUIER override (pin explícito de esa decisión de diseño, no un
  descuido).
- `commercialNightOf` / `currentCommercialNight`: el sábado 01:30 de "viernes
  18–02" es noche del viernes; cerrado-ahora cae a la próxima apertura;
  siempre-abierta y "sin apertura en el horizonte" caen al día calendario.
- `nextOpening`: no mira hacia atrás, `null` fuera de `SCHEDULE_HORIZON_DAYS`.
- `scheduleSlots`: paso de 15 min exacto, lead respetado (con un `from` NO
  alineado a los 15, para que el redondeo hacia arriba se ejerza de verdad),
  nada más allá del horizonte, ningún slot fuera de un rango abierto,
  `excludeNights` saca la noche ENTERA, slots de los dos lados de la
  medianoche.
- `rangeCloseMinute`, `lastOrderWarning` (con el ejemplo exacto de la
  arquitectura: cierre 23:30 + 25 min ⇒ 23:55 — noté que el "23:54" de
  CLAUDE.md es para un pedido a las 23:29, un minuto antes del cierre, NO la
  semántica de esta función; el test usa el número que la función realmente
  produce).
- `storefrontGate`: precedencia completa `suspended > no_payment > paused >
  closed_by_hours > open`, incluida la carrera "paused Y closed_by_hours a la
  vez" (gana `paused`).
- **Independencia de `process.env.TZ`**: un mismo cálculo con el proceso en
  `UTC` y en la zona del local da lo mismo — el meta-test que blinda contra el
  bug "funciona en mi laptop, se rompe en Vercel".

### `createOrderSchema.scheduledFor` — `tests/models/order.schema.test.ts`

`.strict()` sigue vivo con `scheduledFor` presente; solo acepta ISO **UTC con
`Z`** (rechaza offset explícito y hora sin zona); ausente = comportamiento de
siempre.

### Schemas de horarios — `tests/models/store.schema.test.ts`

`storeHoursRangeSchema` (bordes 0/6, 0/1439, 15/1440), `storeHoursWeeklyInputSchema`
(4 por día, 28 en total, solapamiento lineal Y **circular** — probé
explícitamente el caso sábado→domingo que necesita el desplazamiento ±10080,
no solo un caso que ya se detecta sin él), `storeHoursOverrideInputSchema`
(forma cerrado/abierto), y `scheduledDeliveryEnabled`/`scheduledCapacityPerNight`
(0 rechazado — "sin tope" es `null`, no `0`).

### `createOrder` — `tests/models/order.model.test.ts`

**Arreglé el mock roto** (el único rojo que el encargo pedía arreglar):
`buildAdminMock` ahora responde `store_hours`/`store_hours_overrides` (la
guarda nueva de horarios los consulta SIEMPRE, incluso en el camino
inmediato) y el `.or()` que `estimateEta` encadena después de `.in()`.

Sumé, todo contra el mock (no contra Postgres — esto es lógica de
`order.model.ts`, no invariante de base):

- Guarda "cerrada por horario" para un pedido **inmediato** (cerrada → rechaza;
  abierta → sigue igual; `weekly` vacío → sigue igual, compatibilidad).
- Las cuatro validaciones de `scheduledFor`, cada una con su **borde**: 45 min
  de lead rechaza, 60 exacto pasa; exactamente 3 días pasa, 3 días + 15 min
  rechaza; granularidad (segundos y minuto no-múltiplo-de-15); horario cerrado
  en el instante elegido.
- El marcador `scheduled_night_full` de la RPC se traduce a `DomainError` de
  interfaz, nunca crudo.
- Campos congelados exactos: `demand_multiplier`/`eta_minutes` null, `eta_at
  = scheduledFor`, `scheduled_night` derivado.
- Delivery programado (Q2): sin `scheduledDeliveryEnabled` rechaza sin
  siquiera consultar repartidores; con la política pero 0 activos rechaza; con
  ambos, `delivery_minutes` es el PLANO de la tienda aunque la flota esté
  100% ocupada (nunca `busyMinutes`).
- Regresión: un pedido inmediato manda `scheduled_for`/`scheduled_night`/
  `night_capacity` en `null` a la RPC.

### `tests/db/scheduled-orders-and-hours.test.ts` (NUEVO, 41 tests, contra Postgres real)

- `set_store_hours`: dueño puede, reemplazo es ATÓMICO (una segunda llamada
  borra la primera, no la suma), un miembro de OTRA tienda rebota, **falla
  para `service_role`** (`is_store_member()` lee `auth.uid()`, que con el rol
  de servicio no existe — reproducido con `set local role service_role`, no
  solo con el superusuario), solapamiento circular rechazado en la base
  (bypaseando Zod a propósito), más de 4 rangos por día rechazado.
- `set_store_hours_override` / `delete_store_hours_override`: forma
  cerrado/abierto, tenancy, el borrado devuelve el patrón semanal.
- Grants: `anon` lee `store_hours` de una tienda activa (**rojo real, ver
  abajo**); `anon` y un staff logueado NO pueden escribir ninguna de las dos
  tablas por la vía directa (todo pasa por RPC); grant por columna de
  `stores.scheduled_delivery_enabled`/`scheduled_capacity_per_night` para
  `authenticated`.
- `create_order`: `fire_at` calculado exacto (cocción + viaje + 5 de margen);
  un `fire_at` en el pasado se acepta (Q11, verificado contra Postgres real,
  no solo el mock); las 4 combinaciones del CHECK
  `orders_scheduled_coherence_check` (los tres null, los tres no-null válidos,
  las dos mezclas parciales, `fire_at` después de `scheduled_for`); los tres
  campos rebotan en un UPDATE (inmutabilidad) mientras que `status` sí puede
  cambiar.
- **LA CARRERA DEL TOPE**: 5 conexiones `psql` reales concurrentes (no un
  `for` secuencial — agregué `sqlConcurrentlySettled` a `tests/db/helpers.ts`,
  gemela de `sqlConcurrently` pero con `Promise.allSettled` para el caso donde
  ALGUNAS llamadas tienen que perder a propósito) contra la misma noche con
  capacidad 4: exactamente 4 pedidos creados, el quinto rebota con
  `scheduled_night_full`. Limpia sus propias filas al final (`orders` antes
  que `stores`, por el `ON DELETE RESTRICT`).
- `cancel_scheduled_orders`: cancela solo `fire_at > now()` de esa noche y esa
  tienda (deja intacto lo ya disparado, otra noche, y la tienda ajena),
  `paidCents` suma solo lo `approved`, `p_pause=true` apaga
  `accepting_orders` en la MISMA transacción, `p_pause=false` no la toca,
  tenancy.
- `private.active_order_count`: excluye un `confirmed` con `fire_at` futuro,
  cuenta el mismo pedido apenas dispara, cuenta normal lo inmediato, no cuenta
  `ready`/`on_the_way`.
- `advance_auto_orders`: no arranca un programado en espera, sí arranca uno
  cuyo `fire_at` ya venció.
- `expire_pending_orders`: sigue cancelando un programado online impago y
  viejo (libera el cupo de la noche).

No re-escribí el test de paridad de transiciones (`order-state-machine.test.ts`)
ni `reserved-slugs-parity.test.ts`: no tienen que cambiar (T0 no tocó estados
nuevos) y confirmé que **siguen verdes** corriendo la suite completa.

**Gap de cobertura que anoto en vez de esconder**: solo probé `service_role`
explícitamente contra `set_store_hours` (el representante del patrón). Las
otras RPC nuevas (`set_store_hours_override`, `delete_store_hours_override`,
`cancel_scheduled_orders`) tienen tenancy probada (dueño vs. miembro de otra
tienda) pero no un caso `service_role` dedicado — mismo código
(`is_store_member` + `auth.uid()`), así que el riesgo de que se comporten
distinto es bajo, pero no lo afirmo sin haberlo corrido.

---

## Bug real encontrado y ruteado (NO LO ARREGLÉ)

### `anon` no puede leer `store_hours` / `store_hours_overrides` — regresión del dato "más público del local"

**Archivo**: `supabase/migrations/20260829170000_scheduled_orders_and_hours.sql`,
policies `store_hours_public_read` y `store_hours_overrides_public_read`
(aprox. líneas 120–138 en la versión que quedó aplicada).

**Lo que hacen hoy**:
```sql
create policy store_hours_public_read on public.store_hours
  for select to anon, authenticated
  using (
    exists (select 1 from public.stores s where s.id = store_hours.store_id and s.status = 'active')
    or (select private.is_store_member(store_hours.store_id))
  );
```
El `or is_store_member(...)` se agregó (en algún momento de esta sesión,
después de mi primera lectura del archivo) para que el DUEÑO de una tienda
**suspendida** siga viendo su propio horario en el editor de Ajustes — motivo
documentado en el propio comentario de la migración, y tiene sentido.

**El problema**: `private.is_store_member(bigint)` tiene, desde
`20260828130000_delivery.sql`:
```sql
revoke execute on function private.is_store_member(bigint) from public, anon, authenticated;
grant  execute on function private.is_store_member(bigint) to authenticated;
```
**Nunca se le dio `EXECUTE` a `anon`.** Postgres exige el privilegio de
ejecución para referenciar la función en la expresión de la policy —
independientemente de que el `OR` la vuelva irrelevante en tiempo de
ejecución para un rol sin sesión: el chequeo de permiso es sobre la
referencia a la función, no sobre si su resultado termina importando. El
resultado: **cualquier lectura de `store_hours`/`store_hours_overrides`
hecha por `anon` falla entera**, con `permission denied for function
is_store_member` — no solo para tiendas suspendidas, para CUALQUIER tienda,
activa incluida.

**Input**: `set local role anon; select count(*) from public.store_hours
where store_id = <tienda activa>;`
**Resultado observado**: `ERROR: permission denied for function is_store_member`.
**Resultado esperado**: la cuenta de filas (la tienda es pública, el
visitante no tiene sesión).

**Impacto real**: `src/models/store-hours.model.ts#getStoreHoursData` usa
`createClient()` (cliente de SESIÓN), y T3 lo llama **directo desde las
páginas de la vitrina** (`app/[store]/page.tsx`, `carrito`, `checkout`,
`producto/[id]`) para un visitante SIN loguear — o sea, exactamente como
`anon`. Con este bug, **la vitrina entera no puede leer el horario de ningún
local**, ni para mostrar "cerrado, abre a las…" ni para armar la lista de
turnos del checkout. Es un 500 (o un catch silencioso, según cómo se lea el
error más arriba) en el camino más público del feature.

**Reproducido y confirmado** con `docker exec ... psql` directo, sin pasar
por ningún mock: no es un falso positivo del test.

**Test que lo prueba**: `tests/db/scheduled-orders-and-hours.test.ts` →
`grants de store_hours / store_hours_overrides > anon SÍ puede leer los
horarios de una tienda activa`. Lo dejé en rojo a propósito: es exactamente
el caso de "un test que existe para fallar por una razón".

**Arreglo sugerido** (no lo aplico, no toco migraciones): otorgar `EXECUTE`
en `private.is_store_member(bigint)` también a `anon` — para ese rol
`auth.uid()` es siempre `null`, así que la función evalúa `false` de forma
inocua y el `OR` se resuelve solo por la primera rama (`status = 'active'`).
Alternativa más quirúrgica si se prefiere no tocar el grant de una función
usada en ~20 policies más: envolver la referencia en algo que no dispare la
verificación de permiso para `anon` (p. ej. una wrapper `security definer`
con su propio grant acotado a esta policy), aunque el grant directo es más
simple y el riesgo de otorgárselo a `anon` es nulo dado que la función ya
depende de `auth.uid()`.

---

## Archivos tocados

- `tests/lib/store-hours.test.ts` (nuevo)
- `tests/models/order.schema.test.ts` (sección `scheduledFor` agregada)
- `tests/models/store.schema.test.ts` (schemas de horarios + campos de
  programados agregados)
- `tests/models/order.model.test.ts` (mock arreglado + suite de
  `createOrder` para horarios/programados)
- `tests/db/scheduled-orders-and-hours.test.ts` (nuevo)
- `tests/db/helpers.ts` (agregué `sqlConcurrentlySettled` — misma
  concurrencia real de `sqlConcurrently`, pero con `Promise.allSettled` para
  la carrera del tope, donde ALGUNAS llamadas tienen que perder a propósito)

## Para commitear

Nada se commitea todavía: falta el veredicto de `code-reviewer` (`03-review.md`)
y que el bug de `is_store_member`/`anon` se arregle en la migración — recién
ahí el test de esa fila pasa a verde y `npm test` da limpio.
