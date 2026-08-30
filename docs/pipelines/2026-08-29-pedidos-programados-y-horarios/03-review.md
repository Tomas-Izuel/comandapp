# Code review — pedidos programados y horarios de apertura

**Rama**: `feat/pedidos-programados-y-horarios`
**Revisor**: code-reviewer
**Veredicto**: **CHANGES REQUESTED** (no pasa)

---

## Alcance revisado

`git diff main` (working tree, sin commits todavía) + untracked — 37 archivos
tracked (2152 inserciones), más 8 archivos nuevos (migración, `store-hours.ts`,
`store-hours.model.ts`, `schedule-lib.ts`, `schedule-picker.tsx`,
`schedule-editor.tsx`, `scheduled-tray.tsx`,
`cancel-scheduled-orders-dialog.tsx`).

Leí `00-architecture.md`, `01-tasks.md`, los cuatro `02-development-*.md`, la
migración completa a mano, y el diff íntegro de `src/`. Corrí `npm run
typecheck` / `npm run lint` / `npm test` (verdes salvo el test roto ya ruteado
a test-engineer). Repartí una segunda pasada a dos sub-agentes: uno para el
piso de diseño de `/admin` (T4) y otro para la vitrina (T3); este último,
además de revisar el diff, **aplicó la migración contra un Postgres real**
(Docker estaba disponible en esta sesión) para verificar en vivo dos de los
hallazgos de abajo en vez de conjeturarlos por lectura — el hallazgo B1 de
abajo es exactamente el tipo de cosa que solo se ve corriendo el comando real,
y no lo tenía en mi primera pasada por lectura. Los dos sub-agentes y mi propia
lectura llegan al mismo veredicto de forma independiente.

**Efecto colateral a avisar antes que nada**: verificar B1/B2 en vivo implicó
correr `npm run db:reset` varias veces contra el stack Docker local, y quedó
**a mitad de camino** por el propio bug de B1 (aplicó hasta
`20260829140000_reserve_subdomain_slugs` y ahí se cortó). El stack local hoy
**no** tiene `rate_limits`, `online_payment_flag` ni nada de este feature
aplicado. Hay que volver a correr `npm run db:reset` una vez resuelto B1 —
quien retome el entorno local, que no asuma que refleja `main`.

---

## Bloqueantes

### B1 — El archivo de migración choca de timestamp con uno ya commiteado en `main`

`supabase/migrations/20260829140000_scheduled_orders_and_hours.sql` usa
exactamente el mismo prefijo (`20260829140000`) que
`supabase/migrations/20260829140000_reserve_subdomain_slugs.sql`, que **ya
está en `main`**. Confirmado con `ls supabase/migrations/ | cut -c1-14 | sort |
uniq -c`: es la única colisión en las 27 migraciones del repo. El timestamp es
la clave primaria de `supabase_migrations.schema_migrations`.

**Verificado en vivo, no solo por lectura:**

```
$ npx supabase migration up --include-all
LegacyMigrationApplyError: ERROR: duplicate key value violates unique
constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20260829140000) already exists.

$ npx supabase db reset        # de cero, sin condición de carrera de por medio
...
Applying migration 20260829140000_reserve_subdomain_slugs.sql...
Applying migration 20260829140000_scheduled_orders_and_hours.sql...
LegacyMigrationApplyError: ERROR: duplicate key value violates unique
constraint "schema_migrations_pkey" (SQLSTATE 23505)
```

**`npm run db:reset` falla siempre, desde cero.** No es un caso borde: es el
comando que todo el equipo corre para levantar el entorno, y el que corre el
hosted project al hacer `db push`. Con el archivo tal cual está, nadie puede
aplicar esta migración — ni en local, ni en CI, ni en producción — hasta que
se renombre a un timestamp único y posterior al último existente (después de
`20260829160000`, p. ej. `20260829170000_scheduled_orders_and_hours.sql`). El
contenido SQL en sí (aplicado a mano con el timestamp corregido) es válido; el
arreglo es puramente mecánico, pero tal como está en el árbol hoy es un "no
pasa" automático — literalmente no se puede desplegar.

---

### B2 — El tope por noche cuenta distinto en la transacción que en lo que decide qué mostrar

`create_order` (la RPC, dentro de la transacción) cuenta la ocupación de una
`scheduled_night` así:

```sql
select count(*)::int into v_taken
  from public.orders o
 where o.store_id        = v_store_id
   and o.scheduled_night = v_night
   and o.status         <> 'cancelled';          -- migración, línea ~462
```

Pero `countScheduledByNight` (`src/models/order.model.ts`) — lo que alimenta
`fullNights` en la cotización del checkout, o sea lo que decide qué noches el
selector de turnos **oculta** por estar llenas — cuenta:

```ts
.in('status', ['pending', 'confirmed'])
```

Son conteos distintos. Apenas un pedido programado de esa noche **dispara y
avanza** (`preparing`/`ready`/`on_the_way`/`delivered`), la RPC lo sigue
contando contra el tope (no está `cancelled`), pero la capa que decide
`fullNights` deja de contarlo. Resultado: la noche se muestra "con lugar" en
el browser mientras el servidor la sigue rechazando — no una foto
ocasionalmente vieja (eso está aceptado y documentado explícitamente en el
propio código, para la ventana de milisegundos entre pintar y confirmar), sino
una divergencia sistemática que **crece durante toda la noche** a medida que
los pedidos ya tomados se van cocinando y entregando.

**Verificado en vivo** (migración aplicada a mano con el timestamp corregido,
dado que el archivo no se puede aplicar tal cual por B1):

```sql
-- capacidad = 1 para la noche 2026-09-10; pedido A ya 'delivered'
select count(*) from orders
 where scheduled_night='2026-09-10' and status in ('pending','confirmed');
-- => 0   (esto es lo que ve fullNights: "la noche no está llena")

select create_order(..., 'scheduled_night','2026-09-10','night_capacity',1, ...);
-- => ERROR: scheduled_night_full: la noche esta completa (1 de 1)
```

Un cliente que reserva un turno tarde en la noche —después de que el primer
pedido de esa noche ya se entregó— ve el turno disponible en la grilla y
recibe "Esa noche ya está completa" al confirmar, **sistemáticamente**, no por
mala suerte. Esto rompe la promesa central de Q3 (tope por noche con
feedback anticipado en el browser) en el escenario exacto que el feature
existe para atender: la avalancha del viernes a las 21:00, cuando ya hay
pedidos entregándose y otros entrando.

No es una decisión de producto que le toque tomar a esta revisión cuál
semántica es la querida (¿el tope cuenta compromisos totales de la noche, o
solo lo que falta resolver?) — lo que sí es un hallazgo de revisión es que
**los dos lados tienen que decir lo mismo**, y hoy no lo dicen.

Archivos a reconciliar: `supabase/migrations/20260829140000_scheduled_orders_and_hours.sql`
(función `create_order`, cálculo de `v_taken`) vs. `countScheduledByNight` en
`src/models/order.model.ts` (y de paso confirmar que `getScheduledNightSummary`,
que sí usa `pending`/`confirmed`, es consistente con lo que se decida).

---

## Hallazgos mayores (no bloquean por sí solos, pero deben resolverse antes de dar el feature por cerrado)

### M1 — `set_store_hours_override` no valida solapamiento ni el máximo de rangos por fecha

`supabase/migrations/20260829140000_scheduled_orders_and_hours.sql:256-296`.

`set_store_hours` (semanal) sí valida solapamiento circular y el máximo (4 por
día, 28 en total) **dentro de la propia función PL/pgSQL**, antes de escribir.
`set_store_hours_override` no valida ninguna de las dos cosas — solo chequea
que una fecha abierta tenga al menos un rango. `01-tasks.md` (T0, ítem 4) pide
explícitamente que lleve "las mismas validaciones (sin solapamiento dentro de
la fecha)"; no está. El schema Zod (`storeHoursOverrideInputSchema`,
`src/models/schemas/store.schema.ts`) y el editor (`schedule-editor.tsx`) sí
validan las dos cosas del lado del cliente, pero eso es exactamente el patrón
que `CLAUDE.md` señala como riesgo repetidamente: la sesión de un staff
logueado alcanza para llamar la RPC directo con `supabase-js`, sin pasar por
el formulario, y la base tiene que ser la que realmente lo impide — no el
schema, que solo hace legible el mensaje.

**Verificado en vivo** (migración aplicada a mano, `owner` real vía
`is_store_member`/`auth.uid()`):

```sql
select set_store_hours_override(:store_id, '2026-09-05', false, '[
  {"opens_at_minute":600,"duration_minutes":120},
  {"opens_at_minute":660,"duration_minutes":60}
]'::jsonb);
-- éxito, sin error — quedan dos rangos que se superponen 660–720

select set_store_hours_override(:store_id, '2026-09-06', false, <6 rangos>);
-- éxito, sin error — 6 filas para una fecha; el límite documentado es 4
```

No es un problema de aislamiento entre tiendas ni de plata: el daño queda
adentro de los datos de la propia tienda que llamó (`isOpenAt`/
`findContainingRange` con rangos superpuestos simplemente usa el primero que
matchea, no revienta). Por eso es mayor y no bloqueante — pero es una brecha
real contra el propio estándar de seguridad del repo.

**Arreglo sugerido**: portar a `set_store_hours_override` el mismo bloque de
solapamiento que ya tiene `set_store_hours` (comparación lineal, sin el módulo
±10080 ya que una excepción no se repite — igual que ya hace el schema del
cliente) y un `raise` si `jsonb_array_length(p_ranges) > 4`.

---

### M2 — RLS de `store_hours`/`store_hours_overrides` bloquea al propio staff cuando la tienda está suspendida — riesgo de pérdida silenciosa de la configuración

`supabase/migrations/20260829140000_scheduled_orders_and_hours.sql:110-126`
(policies) vs. `src/controllers/admin.controller.ts` (`resolveAdminSession`,
que **no** bloquea el acceso a `/admin/ajustes` para una tienda con `status !=
'active'`).

Las dos policies de lectura son:

```sql
using (exists (select 1 from public.stores s where s.id = store_hours.store_id and s.status = 'active'))
```

Ninguna considera membresía — filtran únicamente por si la tienda está
`active`. `src/models/store-hours.model.ts` (`getStoreHoursData`) siempre lee
con el cliente de **sesión**, así que queda sujeto a esta RLS sin excepción, y
es el mismo camino que usa `/admin/ajustes/page.tsx` vía
`getStoreScheduleForAdmin`.

**Escenario de falla concreto**: la plataforma suspende una tienda
(`stores.status = 'suspended'`, un flujo real documentado en `CLAUDE.md`). El
dueño, que sigue teniendo sesión y acceso al panel (`resolveAdminSession` no
lo redirige — no hay chequeo de `status` ahí), entra a Ajustes. El editor de
horarios se renderiza **vacío** ("sin horarios cargados, tu local está
siempre abierto"), aunque tenga un patrón semanal real guardado — la RLS
devolvió cero filas, sin error, indistinguible de "nunca configuró nada". Si
en ese estado guarda el horario semanal, `set_store_hours` (que solo chequea
`is_store_member`, **no** `status`) reemplaza atómicamente su semana real por
el array vacío que el formulario tenía cargado. Cuando la plataforma
reactive la tienda, su horario desapareció sin que nadie lo haya decidido.

**Arreglo sugerido**: la policy de lectura debería aceptar también
`private.is_store_member(store_hours.store_id)` como condición alternativa
(OR con `status = 'active'`), o el controller de admin debería leer con
`createAdminClient()` detrás de `requireStoreMembership` (mismo patrón que ya
usa `getStoreScheduleForOrder` en el checkout) en vez de depender del cliente
de sesión para este camino específico.

---

### M3 — `computeLastOrderWarning` calcula mal "el cierre más tardío de la semana" en una combinación real de horarios

`src/views/admin/ajustes/schedule-editor.tsx:146-164`.

```ts
const close = r.dayOfWeek * 1440 + r.opensAtMinute + r.durationMinutes // lineal, sin módulo
if (close > latestClose) latestClose = close
```

`dayOfWeek` sigue la convención `Date#getDay()` (0 = domingo … 6 = sábado),
pero el editor **muestra** la semana lunes→domingo. La cuenta lineal trata a
domingo (día 0) como "el más temprano", aunque visualmente sea el ÚLTIMO día
de la semana que el dueño está mirando.

**Escenario de falla concreto**: un local abierto solo sábado 18:00–02:00
(`dayOfWeek=6`) y domingo 10:00–22:00 (`dayOfWeek=0`). Lineal sábado =
`6·1440+1080+480 = 10200`. Lineal domingo = `0·1440+600+720 = 1320`. El
algoritmo elige sábado como "el que cierra más tarde" y muestra **"Se aceptan
pedidos hasta las 02:00"** — pero el cierre real más tardío de esa semana
(domingo 22:00) es varias horas antes que eso. La decisión de producto (Q1)
exige explícitamente que "el número tiene que ser del local, texto genérico no
sirve" — acá el número está mal calculado en esta combinación.

**Arreglo sugerido**: usar `lastOrderWarning()` de `src/lib/store-hours.ts`
(T1), que devuelve una entrada por rango en vez de "el más tardío global" — o,
si se mantiene la versión propia, remapear `dayOfWeek` a un índice
lunes-primero (`(dayOfWeek + 6) % 7`) antes de comparar.

---

## Hallazgos menores (deuda anotada, no bloquean)

### m1 — Query duplicada de `store_hours` en la página de mayor tráfico del producto

`src/app/[store]/page.tsx` (~línea 51) vs. `src/controllers/storefront.controller.ts`
(`getStorefront`). `getStorefront(slug)` ya hace
`Promise.all([getMenu(store.id), getStoreHoursData(store.id)])` y devuelve
`{ store, categories, schedule }`. La page destructura solo `{ store,
categories }` — ignora el `schedule` que ya vino — y dos líneas después llama
`getStoreHoursData(store.id)` de nuevo. Lectura duplicada e innecesaria en el
home de cada tienda. Arreglo: usar el `schedule` que `getStorefront` ya trae.

### m2 — `candidateDays`/`nextOpening` no usan la técnica de dos pasadas de `dates.ts` para DST

`src/lib/store-hours.ts`, funciones `candidateDays` (línea 69) y
`nextOpening` (línea 131). Retroceden exactamente 24h (`DAY_MS`) por
iteración en vez de usar `zoneOffsetMs` (la técnica que `dates.ts` ya tiene y
que "aguanta DST"). En una zona CON cambio de horario, un día de transición
(23 o 25 horas reales) podría desalinear el candidato "ayer". Impacto real
hoy: cero — Argentina no tiene DST desde 2009 y es el único mercado del
producto. Vale la pena una nota o un test si el producto se expande.

### m3 — El "ahora" del selector de horario del checkout no se refresca

`src/views/storefront/checkout-form.tsx`, línea ~217. `now` se computa una
sola vez con `React.useMemo(() => new Date(), [])` y ancla el lead mínimo de
60 minutos para armar la grilla. En una sesión de checkout larga, el turno
más próximo mostrado puede quedar por debajo del lead real al confirmar. Es
autocurable — el servidor revalida con el reloj real y rechaza con el mismo
error de `scheduledFor` de siempre — así que no es bug de seguridad ni de
plata, solo una vuelta de más para el cliente en el peor caso.

### m4 — Cerrar una fecha con programados adentro no es atómico entre "cancelar" y "guardar el cierre"

`src/views/admin/ajustes/schedule-editor.tsx`, función `confirmClose`
(~línea 515). Llama primero `pauseScheduledNightAction(storeId, date)`
(cancela los pedidos) y recién después `saveStoreHoursOverrideAction(...,
{isClosed:true})`, como dos awaits secuenciales sin transacción que los una.
Si el segundo falla (red) después de que el primero canceló pedidos, la
fecha queda con los programados ya cancelados pero el calendario todavía la
muestra abierta según el patrón semanal, hasta que el dueño reintenta
"Guardar excepción". Ventana angosta, sin costo en plata ni seguridad.

### m5 — Rama muerta en el selector de horario: "No quedan turnos para este día" es inalcanzable

`src/views/storefront/schedule-picker.tsx:83-86` + `schedule-lib.ts`
(`buildScheduleGroups`). Un grupo solo existe en `groups` si tuvo al menos un
slot crudo; si `fullNights` lo vacía después, `isFull` queda `true` para esa
misma entrada. Como consecuencia, `slots.length === 0` y `!isFull` nunca
ocurren juntos — la rama que muestra un mensaje distinto para "sin turnos"
(vs. "noche llena") es código muerto con la construcción actual de datos. No
es un bug visible (el resultado real —la noche no aparece como chip— es
razonable), pero el dev log de T3 documenta ese mensaje como comportamiento
probado, y no es alcanzable tal como está cableado.

### n1 — Pregunta de producto, no bug: cualquier `staff` puede pausar pedidos (ahora destructivo) y editar horarios

`src/controllers/admin.actions.ts` usa `requireStoreMembership(id)` sin
`{role:'owner'}` para `saveStoreHoursAction`/`pauseScheduledNightAction`/etc.,
igual que `updateStoreSettings` ya hacía — consistente con la convención
existente (Ajustes es de cualquier staff; solo Pagos exige dueño, S-03). Pero
"pausar pedidos" pasó por el mismo cambio de naturaleza que motivó exigir
`{role:'owner'}` para pagos: de gratis-y-reversible a
irreversible-y-con-plata-de-por-medio. No lo marco bloqueante porque ninguna
decisión escrita en `00-architecture.md`/`01-tasks.md` lo exige, pero vale la
pena preguntárselo al dueño del producto antes de comitear.

---

## Lo que se verificó y está BIEN

- **`fire_at` en el pasado es el comportamiento documentado, no un bug** — el
  mismo comentario ("no lo arregles", con la fecha y el motivo) está en la
  migración, en `order.model.ts` y en `store-hours.ts`.
- **Los cuatro consumidores del predicado `fire_at`** (`getActiveOrders`,
  `estimateEta`, `private.active_order_count`, `advance_auto_orders`) están
  los cuatro actualizados — verificado leyendo el SQL/TS y aplicando la
  migración a Postgres real para confirmar que `active_order_count` compila y
  excluye correctamente.
- **La carrera del tope por noche** usa `pg_advisory_xact_lock` sobre
  `(store_id, night)` antes de contar, dentro de la misma transacción del
  insert — estructuralmente correcto, mismo patrón ya probado en el repo
  (`consume_rate_limit`). Dos clientes peleando el último lugar no pueden
  ganar los dos.
- **`platform_stores`/`platform.model.ts`** — el bloqueante que T1 reportó en
  su propio dev log ya está resuelto en el diff actual: `npm run typecheck`
  corre limpio en todo el repo.
- **RLS/grants de las tablas y RPCs nuevas**: `search_path=''` en las seis
  funciones `SECURITY DEFINER`, `revoke execute from public, anon` en todas,
  `grant select` a `anon, authenticated` en las dos tablas de horarios y
  ningún grant de escritura directa. Los grants por columna en `stores`
  (`scheduled_delivery_enabled`, `scheduled_capacity_per_night`) están.
- **La pausa destructiva** (Q4/Q9): el diálogo pide el conteo real, distingue
  pagados, dice "reembolso manual" con todas las letras, y no deja confirmar
  sin el conteo resuelto. `cancel_scheduled_orders` apaga `accepting_orders`
  y cancela en la MISMA transacción (`p_pause`) — mejor que el plan original
  de dos pasos. `order_cancelled` se dispara para toda cancelación, incluida
  la masiva, reusando un solo componente (`describeCancellationImpact`) en
  los tres lugares que cancelan.
- **La cascada de columnas enumeradas a mano** está completa: `create_order`,
  `enforce_order_rules`, `active_order_count`, `advance_auto_orders`,
  `store_dashboard` y `platform_stores` tocadas donde correspondía;
  `store_couriers` y `orders_active_idx` evaluadas y correctamente dejadas
  sin cambios.
- **Dinero, `.strict()`, `ALLOWED_TRANSITIONS`**: todo intacto. Centavos
  enteros en las columnas nuevas de `orders`. No hay estado nuevo — verificado
  que `scheduledFor` es la única clave nueva del schema y que el cliente no
  puede mandar `fireAt`/`scheduledNight`/precios.
- **El calendario no se reimplementa en Postgres**: la migración solo recibe
  `night`/`scheduled_night` como parámetros ya calculados; toda la
  aritmética de horario vive en `src/lib/store-hours.ts`, compartida entre
  browser y servidor. El cruce de medianoche y la noche comercial (sábado
  01:30 = noche del viernes) están bien resueltos.
- **Piso de diseño**: sin kicker/eyebrow nuevo, sin `Panel` anidado, sin
  emoji como ícono, targets ≥44px, `rounded-(--radius-md)` (v4 correcto) en
  todo el código nuevo, `views/**` sin imports de `@supabase/*` ni fetching.
  `/admin` prioriza densidad (Operate); la vitrina mantiene su composición de
  marca sin mezclarse con Operate.
- **Accesibilidad**: foco movido al encabezado de sección (`tabIndex={-1}` +
  anillo visible) cuando el servidor rechaza `scheduledFor`;
  `role="status"`/`role="alert"` donde corresponde; radios reales de Radix en
  el selector de horario.
- **Idioma**: copy en rioplatense correcto en todas las pantallas nuevas;
  comentarios explicando decisiones, no restating código.
- Los cuatro dev logs son honestos sobre sus desvíos (firma real de
  `cancel_scheduled_orders` vs. el borrador del plan, `ScheduledNightSummary`
  faltante en `types.ts`, nombres asumidos por T4) y en todos los casos
  verifiqué que la reconciliación real coincide con lo que reportan.

## Lo que no se revisó a fondo (fuera de alcance de esta pasada)

- Test de concurrencia real con N clientes en paralelo contra el mismo tope
  (más allá de la lectura del advisory lock).
- El test roto conocido (`tests/models/order.model.test.ts`, mock sin
  `store_hours`) — ya ruteado a test-engineer, no se repite acá.
- `/backoffice`, `/repartidor` y los baldes de rate limiting — fuera de
  alcance del feature y no encontré nada que los toque.

---

## Blockers (deben resolverse antes de comitear)

1. **B1** — Renombrar `supabase/migrations/20260829140000_scheduled_orders_and_hours.sql`
   a un timestamp único posterior a `20260829160000`. Sin esto la migración
   no se puede aplicar en ningún entorno.
2. **B2** — Reconciliar el conteo de `create_order` (`status <> 'cancelled'`)
   con `countScheduledByNight` (`status in ('pending','confirmed')`): decidir
   qué semántica es la querida para el tope por noche y alinear el lado que
   quede desactualizado.
3. **M1** — Agregar validación de solapamiento y máximo de rangos a
   `set_store_hours_override`, igual que ya tiene `set_store_hours`.
4. **M2** — Resolver el acceso de lectura de horarios para el staff de una
   tienda suspendida (policy RLS con OR de membresía, o lectura con admin
   client detrás de `requireStoreMembership`).
5. **M3** — Corregir `computeLastOrderWarning` en `schedule-editor.tsx` (o
   consumir `lastOrderWarning()` de T1 directamente).

Los hallazgos m1–m5 y n1 son deuda anotada — no bloquean, pero vale la pena
resolverlos en la misma pasada si el costo es bajo (en particular m1, que es
una línea).

**Nota operativa para el hilo principal**: una vez renombrado el archivo de
B1, hay que correr `npm run db:reset` de nuevo — el stack local de Docker
quedó parado a mitad de camino durante esta verificación (ver nota al
principio del documento).
