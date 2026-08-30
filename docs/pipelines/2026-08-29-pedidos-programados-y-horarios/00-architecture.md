# Pedidos programados y horarios de apertura — arquitectura

Rama: `feat/pedidos-programados-y-horarios`. Planner: feature-planner.
**Versión 2, post-grilling con el dueño del producto (2026-08-29).** Donde el
grilling contradijo la recomendación original, acá queda la decisión tomada Y
el motivo — este documento existe para no reabrir esto en tres semanas.

---

## 1. Problema y contexto

Dos features que son una sola con dos caras, más el alcance que sumó el grilling:

1. **Horarios de apertura por tienda.** Horarios distintos por día, varios
   rangos por día (el corte del mediodía existe), rangos que cruzan la
   medianoche (lun–jue 18:00–23:30, vie–dom 18:00–02:00 — la norma de una
   hamburguesería, no un caso borde). **Y overrides por fecha** (Q13/Q14):
   cerrar un feriado o abrir un día que el patrón dice cerrado.
2. **Pedidos programados.** "Para ahora" (default) o una hora futura. El
   programado no entra al KDS hasta el *fire time*
   (`hora pactada − cocción − delivery`), pero se ve y se cancela desde
   `/admin`. Con la tienda cerrada por horario, la vitrina deja programar.
   Sumado en el grilling: **tope de programados por noche** (Q3/Q12), **delivery
   programable detrás de un interruptor** (Q2), **"pausar pedidos" cancela los
   programados de la noche** (Q4/Q9), y **el aviso `order_cancelled` se cablea
   para toda cancelación** (Q7 — alcance por encima del pedido original,
   aceptado a conciencia).

Restricciones vinculantes: MVC estricto (Postgres solo en `models/`), centavos,
el precio y la validez los pone el servidor (`createOrderSchema` `.strict()`),
invariantes en Postgres (`private.enforce_order_rules`), grants por columna,
mobile-first, todo horario en `stores.timezone` — nunca la zona del proceso.

### 1.1 Lo que existe hoy (mapa real, verificado contra el código)

- **`stores.timezone`** existe (`init_schema:91`, IANA libre, default Buenos
  Aires). No hay horarios: `accepting_orders` es el único interruptor del dueño
  y `canTakeOrders()` (`src/lib/store-availability.ts`) lo compone con "¿tiene
  medio de pago?". **Cinco llamadores**: `app/[store]/page.tsx:52`,
  `checkout/page.tsx:17`, `carrito/page.tsx:9`,
  `views/storefront/product-detail.tsx:65` y `store-hero.tsx:36` (recibe el
  valor ya resuelto). El toggle vive en el formulario de Ajustes
  (`views/admin/ajustes/settings-form.tsx:610` → `updateStoreSettings`).
- **`src/lib/dates.ts`**: puro, sin `server-only`, con `zoneOffsetMs` (dos
  pasadas, aguanta DST), `zonedDay`, `zonedDayStart`, `zonedDayRange`. La caja
  de herramientas exacta que la evaluación de horarios necesita.
- **El pedido** congela `base_prep_minutes`, `demand_multiplier`,
  `eta_minutes`, `eta_at` al crearse; `refreshFrozenEta()` recalcula al
  aprobarse el pago (`order.model.ts:1039`). Los precios se congelan en
  `order_items.unit_price_cents` (`order.model.ts:535`) y al leer no se vuelve
  a tocar `products` — **un slot lejano bloquea un precio viejo** (motivo del
  horizonte corto, §7.5).
- **El KDS** tiene un solo origen de datos: `fetchActiveOrdersAction` →
  `getActiveOrders(storeId)` (filtra `ACTIVE_STATUSES`). Realtime solo dispara
  un re-poll con debounce y descarta el payload; hay `setInterval` de 30 s de
  respaldo. **Filtrar esa query filtra el tablero entero.**
- **`/admin/pedidos` es 100 % solo lectura hoy**: sin acciones, sin paginación,
  `limit: 200`, filtro de fechas por querystring (default 7 días), filtro de
  estado client-side, agrupado por día calendario del local. Acota por
  `created_at` — **un programado para dentro de 3 días aparecería bajo HOY**:
  la bandeja de programados ordena y agrupa por `scheduled_for`, no por
  `created_at`.
- **`advance_auto_orders`** (pg_cron, 2 min): `confirmed → preparing` opt-in y
  `preparing → ready` cuando `eta_at <= now()`.
- **`expire_pending_orders`** (una sola definición, `rpc.sql:255`): 45 min,
  solo `payment_method='online' AND payment_status='pending' AND
  status='pending'` y sin pago aprobado registrado.
- **Mercado Pago**: la preferencia vence a los **30 minutos fijos** de creada
  (`CHECKOUT_EXPIRES_MINUTES = 30`, `checkout.controller.ts:46`), sin relación
  con la fecha programada; `resolveCheckoutUrl` regenera si venció.
- **`create_order`** (vigente: la de `20260828130000_delivery.sql`) enumera
  las columnas del INSERT a mano. `ORDER_WITH_ITEMS_SELECT` usa `*`; el mapeo
  `toOrder` sí se toca.
- **El multiplicador de demanda vive en DOS lados**: `estimateEta` en TS
  (`order.model.ts:385`, cuenta `COOKING_STATUSES`) y su espejo en Postgres
  **`private.active_order_count`** (`functions.sql:126`), que enumera
  `('confirmed','preparing')` a mano. Los dos deben excluir programados en
  espera (§5.3 — hueco de la v1 de este documento, corregido).
- **Repartidores**: no existe concepto de turno; solo `is_active`.
- Rate limiting: `order:idempotency` (dedupe), `order:phone` (5/10min,
  bloquea), `order:store` (300/10min, solo loguea).
- El trigger `private.enforce_order_rules` (vigente: delivery.sql) duplica
  `ALLOWED_TRANSITIONS`, fija inmutables y exige pago aprobado para confirmar
  online. Test de paridad en `tests/db/`.
- MCP de Supabase: no consulté el proyecto linkeado; el diseño va contra las
  migraciones (fuente de verdad declarada). Asumo paridad migraciones ↔ hosted.

---

## 2. Pushback y decisiones donde la recomendación perdió

El registro honesto — qué se objetó, qué se decidió y por qué:

1. **Tope de programados: recomendé "sin tope en el MVP"; el dueño decidió
   tope POR NOCHE, configurable (Q3+Q12).** Motivo de la decisión: la
   avalancha de las 21:00 del viernes es el riesgo real del feature y un tope
   grueso por noche (no por franja) lo acota con una sola columna y un solo
   conteo. Consecuencia arquitectónica asumida: **la lista de slots deja de
   ser derivable solo en el browser** — la disponibilidad necesita un conteo
   del servidor (§7.3.1), y el chequeo definitivo va **dentro de
   `create_order`, en la misma transacción**, porque dos clientes agarrando el
   último lugar es una carrera que un `if` en el servidor pierde.
2. **Lead mínimo: recomendé `max(60, prep + delivery + 10)`; el dueño decidió
   60 minutos PLANOS (Q11), viendo la aritmética.** Un carrito pesado con
   delivery que necesita 70 min produce `fire_at` en el pasado. **Eso es
   comportamiento esperado, no un bug**: un `fire_at` pasado significa que el
   pedido aparece en el KDS en el próximo poll — "ya vas tarde, arrancá" — que
   es exactamente la recuperación correcta. El CHECK
   `fire_at <= scheduled_for` se sigue cumpliendo (el fire queda antes de la
   promesa, solo que también antes de ahora). **A quien encuentre esto en seis
   meses: no lo "arregles"** clampeando el fire a `now()` ni subiendo el lead —
   la simplicidad del piso fijo fue una decisión de producto informada.
3. **Horizonte: recomendé 7 días; quedó en 3 (Q5+Q10).** Motivo verificado:
   los precios se congelan al crear el pedido (§1.1) y un slot lejano bloquea
   un precio viejo; además, con la pausa destructiva (Q4) más ventana es más
   exposición a que una pausa te cancele el pedido.
4. **Overrides por fecha: los dejé fuera del MVP; ENTRAN (Q13+Q14).** El
   feriado es un caso real inmediato, y la tabla hermana ya estaba prevista
   como extensión natural — el costo marginal es el calendario en Ajustes y la
   cancelación al cerrar una fecha con programados adentro.
5. **"Pausar pedidos" cambia de naturaleza y hay que decirlo fuerte (Q4+Q9).**
   Hoy `accepting_orders` es un toggle reversible y gratis. Pasa a ser un
   apagado **destructivo**: cancela los programados de la noche en curso que
   todavía no dispararon, con plata de por medio si estaban pagos. Es
   irreversible (los pedidos cancelados no vuelven) y con costo (reembolsos
   manuales). Por eso el flip a "pausado" deja de ser un guardado más del
   formulario y pasa por un diálogo de confirmación con el conteo real: "Esto
   cancela 6 pedidos programados de esta noche. 4 están pagados ($47.800). El
   reembolso lo gestionás vos desde Mercado Pago."
6. **`order_cancelled` para TODA cancelación (Q7) es alcance por encima del
   pedido original, aceptado a conciencia.** Verificado: la plantilla ya
   existe (`notifier.port.ts:10`), el adapter de WhatsApp ya tiene el texto
   (`whatsapp-link.adapter.ts:14`, documentada como lista y sin disparar), y
   `updateOrderStatusAction` (`kitchen.actions.ts:51-73`) hoy solo notifica en
   `ready` y `on_the_way`. Sin esto, la pausa destructiva cancelaría pedidos
   pagos sin avisarle a nadie — inaceptable; y cablearlo solo para programados
   dejaría dos clases de cancelación.
7. **Reembolso manual (Q8), confirmado.** Sin auto-refund por API en el MVP;
   el monto y la advertencia van en el diálogo.
8. **Sin "última orden" derivada (Q1).** Se toman pedidos hasta el minuto
   exacto de cierre; la consecuencia (un pedido de las 23:29 sale 23:54) se
   muestra como **advertencia calculada en el editor de horarios** con el
   `prep_minutes` más alto real de la carta de ESE local — texto genérico no
   sirve, el número tiene que ser del local.
9. Lo que sobrevivió intacto del plan original: modelo de tabla por rango, la
   codificación `opens + duration`, la lib compartida pura, **sin estado nuevo
   y sin cron de liberación** (`fire_at` + filtro), pago-ahora, y
   `expire_pending_orders` sin cambios.

---

## 3. Investigación

(Sin cambios respecto de la v1; resumen del informe con fuentes.)

### 3.1 Horarios de apertura

- **Fila/objeto por período** `(día, inicio, fin)` con N períodos por día es
  unánime (Toast, Square `BusinessHoursPeriod`, Google Business Profile
  `TimePeriod`, Yelp, Schema.org, OSM). Nadie serio usa JSON opaco por día.
- **El rango overnight se anota en el día que ABRE** (unánime). Variantes:
  `end < start` implícito (Toast/Square/Schema.org), flag `is_overnight`
  (Yelp), `closeDay` explícito (Google — el más inambiguo).
- **"¿Abierto ahora?" siempre en el timezone del local** (Toast guarda
  `timeZoneId` junto al schedule; Google deprecó `open_now` precalculado a
  favor de evaluar en el cliente con el offset DEL LOCAL). Con "anotado en el
  día que abre" hay que chequear **dos días**: hoy y ayer-que-cruza.
- **Overrides por fecha existen en todos**: Toast `businessDate`, Google
  `specialHours`, Schema.org `validFrom/validThrough`.
- **Post-mortem**: Square no arrastra el día comercial y los bares llevan años
  con la venta de la 1 AM cayendo "mañana". Nuestro dashboard ya corta por
  `stores.timezone`; el concepto de **noche comercial** que introduce el tope
  (§7.3.1) se define explícitamente para no repetir ese bug.

### 3.2 Pedidos programados

- **Cobro al confirmar, no al preparar** (McDonald's, Starbucks, Square; Toast
  configurable pero ni guarda la tarjeta).
- **Fire time = prometida − prep** (textual en Toast y DoorDash; Uber Eats
  dispara ~25–45 min antes).
- **En espera = bandeja separada de la cola activa** (Toast "Future Checks",
  DoorDash "Scheduled", Square `PROPOSED`).
- **Validaciones**: ventana hacia adelante acotada, lead mínimo, hora dentro
  del schedule.
- **Post-mortem clave**: en Toast el auto-firing depende de un dispositivo del
  local — tablet offline = pedidos que no llegan a cocina. **El disparo va del
  lado del servidor**; nuestro diseño ni siquiera necesita disparo (§5.2).

Fuentes: developer.squareup.com, developers.google.com/my-business,
doc.toasttab.com (online ordering schedules; Scheduling Future Orders; Fire by
Prep Time), docs.developer.yelp.com, schema.org/OpeningHoursSpecification,
wiki.openstreetmap.org/wiki/Key:opening_hours, help.doordash.com,
help.uber.com, mcdonalds.com FAQ, about.starbucks.com.

---

## 4. Punto 1 — Modelo de datos de horarios

### 4.1 Decisión: tabla `store_hours` + tabla hermana `store_hours_overrides`

(La alternativa `jsonb` en `stores` quedó descartada por los motivos de la v1:
validación estructural fuera de Postgres o en trigger artesanal, y el grant por
columna en `stores` para algo que necesita reemplazo transaccional. La opción
tabla es además lo que hace toda la industria, §3.1.)

**Patrón semanal** — `store_hours`, fila por rango:

```
create table public.store_hours (
  id               bigint generated always as identity primary key,
  store_id         bigint not null references public.stores(id) on delete cascade,
  day_of_week      smallint not null check (day_of_week between 0 and 6),  -- 0=domingo (Date#getDay)
  opens_at_minute  smallint not null check (opens_at_minute between 0 and 1439),
  duration_minutes smallint not null check (duration_minutes between 15 and 1440),
  created_at       timestamptz not null default now()
);
```

Codificación `opens + duration` (no `opens/closes`): inambigua para el cruce de
medianoche por construcción, 24 h representable, solapamiento chequeable en
minutos absolutos de semana (módulo 10080). "Vie 18:00–02:00" = `(5, 1080,
480)` — **el rango pertenece al día que abre**, la convención unánime.
`closes` para mostrar se deriva: `(opens + duration) % 1440`.

**Overrides por fecha** (Q13/Q14) — `store_hours_overrides`, misma codificación:

```
create table public.store_hours_overrides (
  id               bigint generated always as identity primary key,
  store_id         bigint not null references public.stores(id) on delete cascade,
  date             date not null,                    -- día LOCAL de la tienda
  opens_at_minute  smallint check (opens_at_minute between 0 and 1439),
  duration_minutes smallint check (duration_minutes between 15 and 1440),
  created_at       timestamptz not null default now(),
  check ((opens_at_minute is null) = (duration_minutes is null))
);
```

Semántica: **si una fecha tiene filas de override, reemplazan el patrón
semanal ENTERO para esa fecha.** Una fila con `opens/duration` null = "cerrado
todo ese día" (y la RPC valida que sea la única fila de la fecha). Filas con
valores = los rangos vigentes esa fecha — sirve para cerrar un feriado Y para
abrir un día que el patrón dice cerrado. Un rango de override que cruza
medianoche pertenece a su `date` (día que abre), consistente con el semanal.
La evaluación mira overrides de hoy Y de ayer, igual que el patrón.

Con estas dos son **23 tablas**.

### 4.2 Lectura y escritura

- **Lectura**: los horarios y sus excepciones son el dato más público del
  local. RLS prendida, policy `for select using (true)` en ambas, `grant
  select` a `anon, authenticated` y `grant all` a `service_role` (trampa
  conocida: nadie hereda nada).
- **Escritura**: **cero grants de escritura a `authenticated`.** El reemplazo
  de la semana (o de una fecha) tiene que ser atómico — `delete` + N `insert`
  por PostgREST son dos requests y un crash en el medio deja al local cerrado
  para siempre. Dos RPC `SECURITY DEFINER`, llamadas con el cliente de
  **SESIÓN** (verifican `private.is_store_member` en el cuerpo, patrón
  `store_couriers` — con el admin client fallan siempre, a propósito):
  - `set_store_hours(p_store_id, p_ranges jsonb)` — valida forma (día 0–6,
    rangos en límites, ≤ 4 por día, ≤ 28 total), rechaza solapamiento
    circular, reemplaza la semana en una transacción.
  - `set_store_hours_override(p_store_id, p_date, p_ranges jsonb)` — `p_ranges`
    `null`/vacío borra el override (vuelve el patrón), `[{closed:true}]` cierra
    el día, o rangos con las mismas validaciones. La **cancelación de
    programados al cerrar una fecha NO vive acá**: la orquesta el controller
    (§7.8.2), para que el conteo, el diálogo y las notificaciones pasen por el
    mismo camino que la pausa.

**Semántica de "sin filas": siempre abierta.** Compatibilidad hacia atrás:
ninguna tienda existente puede amanecer cerrada por el deploy. Opt-in, como el
delivery.

### 4.3 Columnas nuevas en `stores` (Q2, Q3)

| Columna | Tipo | Default | Grant |
|---|---|---|---|
| `scheduled_delivery_enabled` | boolean not null | `false` | `grant update` a `authenticated` — es una preferencia del dueño, no política de caja |
| `scheduled_capacity_per_night` | int null, `check (> 0)` | `null` = sin tope | `grant update` a `authenticated` — ídem |

Siguen el patrón de `auto_start_orders`/`auto_ready_orders` (columna de
preferencia + grant explícito en la migración, porque los grants de `stores`
son por columna y una columna nueva NO queda escribible sola). No son como
`courier_collects_payment` (política de caja) ni `online_payment_enabled`
(derivada): las escribe el formulario de Ajustes con el cliente de sesión.

---

## 5. Puntos 2 y 4 — Evaluación del horario y entrada al KDS

### 5.1 Una sola lógica compartida: `src/lib/store-hours.ts`

Módulo **puro y sin `server-only`, a propósito** (precedente:
`src/lib/delivery.ts`): la misma función que pinta "cerrado" en el browser
valida en `createOrder`. Reutiliza `zoneOffsetMs`/`zonedDay` de
`src/lib/dates.ts`. Opera sobre `StoreHoursData = { weekly, overrides }`;
"¿abierto en T?" resuelve primero si la fecha local de T (y la de ayer) tiene
override, y evalúa los rangos vigentes de los dos días — el bug clásico del
cruce de medianoche (§3.1) muere acá, una sola vez.

Además define la **noche comercial** (Q3/Q4), el concepto nuevo del grilling:

- `commercialNightOf(data, instant, tz): 'YYYY-MM-DD'` — el día local en que
  ABRE el rango que contiene al instante (para un `scheduled_for` validado
  siempre existe); tienda siempre-abierta ⇒ el día calendario local.
- `currentCommercialNight(data, now, tz)` — si el local está abierto, la noche
  del rango en curso; si está cerrado, la del próximo rango que abre. Es lo
  que la pausa destructiva cancela (§7.8.1).

El sábado 01:30 de un rango "viernes 18:00–02:00" pertenece a la noche del
**viernes** — exactamente el bug de "día comercial" que Square no resolvió y
que acá queda definido de una vez para el tope, la pausa y la bandeja.

Firmas completas y constantes (`SCHEDULE_STEP_MINUTES = 15`,
`SCHEDULE_HORIZON_DAYS = 3`, `SCHEDULE_LEAD_MINUTES = 60`): en `01-tasks.md`.

### 5.2 Entrada al KDS: `fire_at` + filtro, sin estado nuevo y sin cron

(Decisión sostenida del plan original; el grilling no la tocó.)

Las dos opciones evaluadas:

- **(a) Cron que libera** (estado nuevo `scheduled` o flag flippeado por
  barrido): un estado nuevo toca `ALLOWED_TRANSITIONS` + el trigger + el test
  de paridad + cada enumeración de estados (KDS, `ACTIVE_STATUSES`,
  `COOKING_STATUSES`, dashboards, cola del repartidor, tracking, etiquetas), y
  reabre las preguntas del dinero ("¿online impago no confirma aplica a
  `scheduled`?"). Hereda además la latencia y el modo de falla de un barrido —
  el post-mortem de Toast (§3.2) es exactamente un disparo que depende de algo
  que puede estar caído.
- **(b) Columna `fire_at`, el KDS filtra — DECIDIDA.** El programado vive en
  los estados de siempre (online pagado → `confirmed`; online impago →
  `pending` y expira a los 45 min; pago en el local → nace `confirmed`).
  `getActiveOrders` — único origen del tablero, Realtime incluido (§1.1) —
  suma `fire_at is null OR fire_at <= now()`. Al vencer el fire, el siguiente
  poll lo trae, llega como pedido nuevo y suena la campana. El "disparo" es un
  predicado evaluado en cada lectura: no puede fallar por un barrido caído,
  por construcción.

`fire_at = scheduled_for − (base_prep_minutes + coalesce(delivery_minutes,0) + 5) min`
(5 = margen de plancha, vive SOLO en `create_order`). **Lo calcula la RPC
dentro de la transacción**, no TypeScript. No es columna generada:
`timestamptz − interval` es `STABLE` (depende del GUC `TimeZone`) y Postgres lo
rechaza en `generated always`; en su lugar, CHECK de coherencia
`fire_at is null or (scheduled_for is not null and fire_at <= scheduled_for)`
más inmutabilidad en el trigger. **Con el lead plano de 60 min (Q11), un
carrito lento puede producir `fire_at` en el pasado y ESO ES CORRECTO** (§2.2):
el CHECK se cumple igual y el pedido entra al KDS en el próximo poll.

Se agrega también **`scheduled_night date`** (null si no es programado, CHECK
de paridad con `scheduled_for`): la noche comercial del pedido, calculada por
`createOrder` (TS, con la lib compartida — el dato viene del camino validado
del servidor, no del browser) y persistida para que el tope, la pausa y la
bandeja cuenten y agrupen con un `=` en vez de recomputar calendario en SQL.

### 5.3 Los consumidores del predicado son CUATRO (corrección de la v1)

La v1 de este documento decía tres; el grilling encontró el cuarto. Todo lugar
que hoy trata `confirmed` como "trabajo en curso" necesita excluir a los
programados en espera:

| # | Consumidor | Lado | Cambio |
|---|---|---|---|
| 1 | `getActiveOrders` (KDS entero) | TS | `fire_at is null OR fire_at <= now` |
| 2 | Conteo de demanda en `estimateEta` (`order.model.ts:385`) | TS | ídem — un programado parado 4 h en `confirmed` inflaría el ETA de todos los inmediatos |
| 3 | `advance_auto_orders` (rama auto-start) | SQL | `and (o.fire_at is null or o.fire_at <= now())` — sin esto, el auto-comenzar arranca la cocción 4 horas antes |
| 4 | **`private.active_order_count`** (`functions.sql:126`) | SQL | ídem — es el espejo en Postgres de `COOKING_STATUSES` y enumera `('confirmed','preparing')` a mano; sin tocarla, el multiplicador se infla desde la base aunque el conteo de TS lo excluya |

Quinto lugar relacionado, **verificado y sin cambio**: el índice parcial
`orders_active_idx` (`delivery.sql:217`) — cuyo comentario advierte
exactamente sobre este tipo de olvido — sigue sirviendo: es parcial por
`status`, y el predicado de `fire_at` es un filtro adicional sobre las filas
que ya trae. No se redefine; se deja anotado que se evaluó.

---

## 6. Punto 5 — El ETA congelado y el multiplicador de demanda

El multiplicador medido a las 17:00 no dice nada de la plancha de las 21:00.
Resolución campo por campo:

| Columna | Pedido inmediato (hoy) | Pedido programado |
|---|---|---|
| `base_prep_minutes` | prep real del carrito | **igual** — hace falta para `fire_at` |
| `demand_multiplier` | 1 o el de la tienda | **null** — no se midió nada con sentido |
| `eta_minutes` | minutos congelados | **null** — "en X minutos" no aplica |
| `eta_at` | `now + eta` | **`scheduled_for`** — la promesa ES el ETA |
| `delivery_minutes` | según flota AHORA (`busyMinutes`) | **`delivery.minutes` plano** — la ocupación de ahora no describe la de la noche |
| `scheduled_night` | null | noche comercial (§5.2) |

Encadenamientos que se cortan a mano:

- **`refreshFrozenEta` NO corre para programados** (early-return con
  `scheduled_for` no null): el pago aprobado no puede mover `eta_at` fuera de
  la promesa.
- **`estimateEta` y `active_order_count` excluyen en-espera** (§5.3).
- **`auto_ready_orders` funciona gratis**: `preparing → ready` cuando
  `eta_at <= now()`, y para un programado `eta_at = scheduled_for` — el
  auto-listo suena a la hora pactada. No se toca.
- **`store_dashboard`** pasa a medir "preparación real" desde
  `greatest(confirmed_at, coalesce(fire_at, confirmed_at))`: las horas de
  espera no son cocción.
- **El tracking del cliente** muestra "programado para las 21:30"
  (`eta_minutes` null es la señal), no una cuenta regresiva.
- **Q1 — sin "última orden" derivada**: se acepta hasta el minuto de cierre.
  La consecuencia se muestra donde se decide: el editor de horarios de Ajustes
  calcula, con el `prep_minutes` **más alto real de la carta de ese local**,
  la advertencia "Se aceptan pedidos hasta las 23:30. Tu producto más lento
  tarda 25 min, así que un pedido de las 23:29 sale 23:54."

---

## 7. Los puntos restantes, uno por uno

### 7.3 El servidor pone la validez (punto 3)

`createOrderSchema` gana **un** campo: `scheduledFor: z.iso.datetime().optional()`
(Zod v4, verificado: acepta solo UTC con `Z` — el browser manda el instante que
eligió de la lista de slots, nunca una hora de pared). `.strict()` queda.

`createOrder` valida en orden, todo `DomainError`:

1. **Tienda operable** (como hoy): `status='active'`, `accepting_orders`,
   medio de pago.
2. **Sin `scheduledFor`** (para ahora): nueva guarda `isOpenAt(data, now, tz)` —
   cerrada por horario ⇒ "La cocina está cerrada. Podés programar un pedido
   para cuando abra."
3. **Con `scheduledFor`**:
   - múltiplo exacto de 15 min (la lista de slots es canónica);
   - **lead: `scheduledFor ≥ now + 60 min`, piso plano** (Q11 — sin fórmula);
   - **horizonte: `scheduledFor ≤ now + 3 días`** (Q5/Q10);
   - dentro de un rango abierto: `isOpenAt(data, scheduledFor, tz)` con la
     MISMA lib que usó el browser (overrides incluidos);
   - **delivery programado** (Q2): exige `store.scheduled_delivery_enabled`
     **y ≥ 1 repartidor activo en ese momento** — mismo patrón
     política-vs-realidad que `accepting_orders` + `canCollectPayment`. Si el
     repartidor se desactiva DESPUÉS, no pasa nada especial: el pedido queda y
     se ve en la bandeja;
   - deriva `scheduled_night = commercialNightOf(...)` y lo pasa a la RPC.
4. **El tope por noche se decide en `create_order`, en la transacción** (§7.3.1).

El cliente manda **un instante**; `fire_at`, `scheduled_night`, minutos y
montos los deriva el servidor — mismo principio que los precios.

#### 7.3.1 Tope por noche (Q3+Q12): el conteo es del servidor y el árbitro es la transacción

Con `scheduled_capacity_per_night` seteado, **la lista de slots ya no se puede
derivar solo en el browser**: los horarios son públicos pero la ocupación no
está en el cliente. El flujo queda en dos capas:

- **Capa UX (aproximada, para no ofrecer lo que va a rebotar)**: la cotización
  del checkout (`GET /api/orders`, que el carrito ya llama) devuelve además
  `fullNights: string[]` — las noches comerciales del horizonte cuyo conteo de
  programados vivos (`status in ('pending','confirmed')`, agrupado por
  `scheduled_night`) ya alcanzó el tope. El browser **oculta TODOS los slots
  de esas noches** (decisión Q3: la noche llena se cierra entera, no por
  franja). Es una foto: puede quedar vieja entre que se pintó y se confirmó.
- **Capa de verdad (transaccional)**: `create_order`, con
  `scheduled_capacity_per_night` no null y pedido programado, toma un lock de la
  fila de la tienda (`select … from stores where id = … for update` —
  serializa las creaciones programadas de ESA tienda, que son de bajo volumen;
  las inmediatas no pasan por el lock), cuenta los vivos de esa
  `scheduled_night` y, si el tope está alcanzado, aborta con un error
  distinguible que la app traduce a
  `DomainError('Esa noche ya está completa. Elegí otro día.')`. Dos clientes
  peleando el último lugar: el segundo pierde en la base, no en un `if`.

El conteo incluye a los `pending` (impagos con checkout vivo): reservan lugar
hasta que pagan o `expire_pending_orders` los libera a los 45 min. Lo contrario
permitiría sobrevender la noche con N checkouts simultáneos sin pagar.

### 7.7 La cascada de columnas enumeradas (punto 7, corregida)

Columnas nuevas de `orders`: `scheduled_for`, `fire_at`, `scheduled_night`.

| Lugar | ¿Toca? | Qué |
|---|---|---|
| `create_order` (RPC) | **SÍ** | `scheduled_for` y `scheduled_night` al INSERT; `fire_at` lo calcula la función; tope por noche adentro (§7.3.1) |
| `private.enforce_order_rules` | **SÍ** | los TRES campos entran a la lista de inmutables (la promesa no se renegocia: se cancela y se rehace). Transiciones intactas |
| `private.active_order_count` | **SÍ** | predicado `fire_at` (§5.3 #4 — el hueco de la v1) |
| `advance_auto_orders` | **SÍ** | predicado `fire_at` en auto-start (§5.3 #3) |
| `store_dashboard` (RPC) | **SÍ** | métrica de preparación (§6) |
| `store_couriers` (RPC) | NO | métricas de entregas; no usa las columnas nuevas — verificado |
| `platform_stores` (RPC) | NO | métricas por tienda; ídem |
| `orders_active_idx` | NO | parcial por `status`; el filtro de `fire_at` es WHERE adicional — evaluado, no cambia |
| `ORDER_WITH_ITEMS_SELECT` | NO (es `*`) | pero `toOrder` mapea los tres campos |
| `database.types.ts` | **SÍ** | `npm run db:types` (hilo principal) |
| Test de paridad de transiciones | NO | no hay estado nuevo — tiene que seguir verde, y eso es una aserción del plan |

Índices nuevos: `(store_id, scheduled_for) where scheduled_for is not null and
status in ('pending','confirmed')` (bandeja, ordenada por la promesa) y
`(store_id, scheduled_night) where scheduled_night is not null` (tope y
cancelaciones por noche).

### 7.8 Tienda cerrada hoy: precedencia (punto 8) + la pausa destructiva

| # | Condición | Quién | Vitrina | ¿Programar? |
|---|---|---|---|---|
| 1 | `status != 'active'` | plataforma | no disponible (como hoy) | NO |
| 2 | `!canCollectPayment()` | la realidad | aviso actual | NO |
| 3 | `accepting_orders = false` | el dueño | "no está aceptando pedidos" | **NO** — es el kill-switch humano |
| 4 | `isOpenAt() = false` | el calendario (overrides incluidos) | "Cerrado — abre {próxima apertura}" + CTA programar | **SÍ** |

`canTakeOrders()` no cambia de firma ni de significado (5 llamadores, §1.1);
la evaluación de horario es una condición nueva que la vitrina compone después
vía `storefrontGate()` (unión discriminada
`open | closed_can_schedule | paused | no_payment | suspended`), porque es la
única con modo degradado en vez de binario.

#### 7.8.1 "Pausar pedidos" = apagado destructivo (Q4+Q9)

Flippear `accepting_orders` a `false` deja de ser un guardado más del
formulario de Ajustes:

1. La UI intercepta el flip y pide una **vista previa** al servidor: cuántos
   programados de la **noche comercial en curso** (`currentCommercialNight` —
   si está abierto, el rango en curso; si está cerrado, el próximo que abre)
   tienen `fire_at > now()`, cuántos están pagos y cuánta plata suman.
2. Diálogo de confirmación con los números reales: "Esto cancela 6 pedidos
   programados de esta noche. 4 están pagados ($47.800). El reembolso lo
   gestionás vos desde Mercado Pago." (Q8: reembolso manual, dicho acá.)
3. Confirmado: la acción apaga `accepting_orders` (cerrar la puerta primero) y
   llama la RPC transaccional `cancel_scheduled_orders(store_id, night)` —
   cancela `scheduled_night = noche AND fire_at > now() AND status in
   ('pending','confirmed')` y devuelve ids + conteos + total pago. Si la RPC
   falla después del toggle, la puerta quedó cerrada y los programados
   siguen: se reintenta desde la UI — nunca al revés (cancelar con la puerta
   abierta deja entrar más).
4. Por cada id cancelado sale **`order_cancelled`** (§7.9).

**Los que ya dispararon (`fire_at <= now()`) NO se tocan**: están en la
plancha; para eso está el botón del KDS, uno por uno. Los programados de
noches FUTURAS tampoco: la pausa es de esta noche; mientras siga pausado no
entran nuevos, y los futuros existentes disparan normalmente si el local
reabre. El preview es una foto y la RPC es la verdad: el diálogo puede decir 6
y cancelarse 5 porque uno disparó en el medio — correcto.

**Cambio de naturaleza, explícito**: `accepting_orders` era un toggle
reversible y gratis; pasa a ser irreversible (los cancelados no vuelven) y con
costo (reembolsos manuales). El copy de Ajustes lo tiene que decir antes del
diálogo, no después.

#### 7.8.2 Cerrar una fecha con programados adentro (Q14)

Mismo camino con otra noche: guardar un override "cerrado" (o rangos que dejan
`scheduled_for` existentes afuera — el MVP solo cancela en el caso "cerrado",
que es el real; afinar rangos con pedidos adentro queda advertido en la UI)
dispara el mismo preview + diálogo + `cancel_scheduled_orders(store_id, fecha)`
+ `order_cancelled` por pedido. La orquestación vive en el controller, no en
la RPC de horarios: un solo camino de cancelación masiva.

### 7.9 Notificaciones (punto 9 + Q7)

- **Comprobante (`order-receipt`) al confirmar: SÍ, como hoy.** Vars ganan
  `scheduledForLabel` opcional ("sábado 30/08, 21:30", `formatDateTime` en la
  zona del local); la plantilla muestra "Programado para …" en vez de "Listo
  en ~X min". Mismo trato en el WhatsApp de confirmación.
- **Al disparar (fire): NADA.** Evento interno del local.
- **`order_ready` / `order_on_the_way`: sin cambios.**
- **`order_cancelled` se cablea para TODA cancelación (Q7)** — programada o
  no, del KDS, de la bandeja, de la pausa o del cierre de fecha. La plantilla
  ya existe en el notifier y el adapter de WhatsApp ya tiene el texto; lo que
  falta es dispararla: un despacho central en `kitchen.controller.ts` (patrón
  `dispatchReadyNotification`) invocado por `updateOrderStatusAction` cuando el
  destino es `cancelled` y por las cancelaciones masivas. Solo WhatsApp: **cero
  plantillas de MAIL nuevas.** Alcance por encima del pedido original, aceptado
  a conciencia (§2.6).

### 7.10 Rate limiting (punto 10)

**Sin balde nuevo.** `order:phone` (5/10min) ya acota a la persona;
`order:store` los cuenta en el termómetro. El control de volumen específico de
programados ahora existe y es mejor que un 429: el **tope por noche** (§7.3.1),
que es gestión de capacidad con UI propia ("esa noche está completa"), no un
límite de requests.

### 7.11 Zona horaria y DST (punto 11)

**Se maneja, no se asume.** Todo son instantes UTC (`scheduled_for`, `fire_at`,
slots ISO); la hora de pared solo existe al proyectar para mostrar o evaluar
rangos, con la técnica de dos pasadas de `zoneOffsetMs` que ya aguanta DST. La
`scheduled_night` es un día local calculado con esa misma proyección. En una
zona CON DST, la hora repetida/omitida del cambio produce que un slot exista
una sola vez como instante — correcto por construcción. `stores.timezone`
sigue siendo IANA libre vía `Intl`.

---

## 8. Punto 6 — Pago

**Se paga AHORA, al confirmar** (patrón McDonald's/Starbucks/Square; Toast ni
guarda la tarjeta). Verificado en el grilling que sobrevive intacto: la
preferencia de MP vence a los 30 min fijos de creada, sin relación con la
fecha programada, y `resolveCheckoutUrl` regenera si venció.

```
online:    pending ──(paga en ≤45 min)──▶ confirmed ──(espera, invisible para
           │                              el KDS hasta fire_at)──▶ visible en KDS
           └─(no paga)─▶ expire_pending_orders lo cancela a los 45 min — SIN CAMBIOS
in_store:  nace confirmed + fire_at ──▶ ídem
```

La regla de los 45 minutos mide **abandono del checkout**, no la espera del
slot: un programado impago a los 45 min no está esperando su hora — abandonó el
pago, y cancelarlo **libera su lugar en el tope de la noche** (el conteo de
§7.3.1 solo mira vivos). `expire_pending_orders` no se toca, y eso es una
virtud del diseño.

Cancelación (admin, pausa u override): `pending|confirmed → cancelled` ya es
legal en los dos lados. Si estaba pago: **reembolso manual en Mercado Pago
(Q8)**, con el monto y la advertencia en el diálogo. El cliente se entera por
`order_cancelled` (Q7) y por el tracking.

---

## 9. Arquitectura recomendada — resumen de componentes

```
Postgres (hilo principal — la lista exacta está en 01-tasks.md, T0)
  store_hours + store_hours_overrides       tablas nuevas (23 en total), select público
  set_store_hours / set_store_hours_override RPCs definer, sesión, is_store_member
  cancel_scheduled_orders(store_id, night)  RPC definer, sesión: cancelación masiva transaccional
  stores.scheduled_delivery_enabled / .scheduled_capacity_per_night  + grants por columna
  orders.scheduled_for / fire_at / scheduled_night  + CHECKs + 2 índices parciales
  create_order        redefinida: inserta, calcula fire_at, tope por noche con lock
  enforce_order_rules redefinida: 3 columnas inmutables más; transiciones intactas
  advance_auto_orders redefinida: auto-start respeta fire_at
  active_order_count  redefinida: excluye en-espera        ← el hueco corregido
  store_dashboard     redefinida: prep desde greatest(confirmed_at, fire_at)

src/lib/store-hours.ts            NUEVO, puro: weekly+overrides, isOpenAt,
                                  slots, noche comercial, storefrontGate
src/models/store-hours.model.ts   NUEVO: lecturas + las 2 RPCs de horarios (sesión)
src/models/order.model.ts         createOrder (§7.3), getActiveOrders (filtro),
                                  estimateEta (filtro), refreshFrozenEta (skip),
                                  getScheduledOrders, resumen/conteos por noche,
                                  cancelScheduledNight (RPC)
src/controllers/…                 checkout: quote + fullNights; admin: horarios,
                                  overrides, preview + pausa destructiva;
                                  kitchen: despacho de order_cancelled
Vitrina (/[store])                gate con 5 estados; selector ahora/programar
                                  con slots (menos noches llenas); tracking con
                                  hora pactada
Admin (/admin, Operate)           Ajustes: editor semanal + calendario de
                                  overrides + advertencia Q1 + toggles Q2/Q3 +
                                  pausa con diálogo destructivo;
                                  Pedidos: bandeja Programados (por scheduled_for)
                                  + cancelar; KDS: SIN CAMBIOS de UI
```

### Cross-cutting

- **Seguridad / multi-tenant**: las tres RPC nuevas verifican membresía en el
  cuerpo y se llaman con sesión; `store_hours*` es lectura pública por diseño;
  `scheduledFor` se valida contra calendario, reloj y tope del servidor;
  `fire_at`/`scheduled_night` no viajan nunca desde el browser. Grants nuevos
  de escritura: solo las dos columnas de preferencia en `stores` (§4.3).
- **Fallas y rollback**: sin cron nuevo — el disparo es un predicado por
  lectura. Migración aditiva (2 tablas, 3 columnas nullable en `orders`, 2 en
  `stores`, redefiniciones): reversible; ninguna fila existente cambia de
  significado (`scheduled_for null` = hoy; sin filas de horario = siempre
  abierta). La pausa destructiva ordena toggle-antes-que-cancelación para que
  la falla parcial deje la puerta cerrada, nunca la puerta abierta con
  pedidos cancelados.
- **Cache/revalidación**: guardar horarios/overrides revalida los paths de la
  tienda como hoy Ajustes; la condición abierto/cerrado se resuelve con el
  reloj del cliente sobre datos públicos; `fullNights` viaja en la cotización
  (que ya es por request, sin cache).
- **Observabilidad**: programados medibles por columnas; las cancelaciones
  masivas devuelven ids y quedan en `order_events` por el trigger de outbox
  existente (cada transición inserta evento); `order:store` los cuenta.

---

## 10. Decisiones tomadas en el grilling del 2026-08-29

Ya no quedan preguntas abiertas. Registro final:

| # | Tema | Decisión |
|---|---|---|
| Q1 | Última orden | Se acepta hasta el minuto de cierre; advertencia en el editor calculada con el `prep_minutes` más alto real de la carta del local |
| Q2 | Delivery programado | Detrás de `stores.scheduled_delivery_enabled` (default false, grant por columna) + ≥1 repartidor activo al ofrecer slots; desactivación posterior no hace nada |
| Q3+Q12 | Tope | Por NOCHE comercial, `stores.scheduled_capacity_per_night` (null = sin tope, grant por columna); noche llena oculta todos sus slots; el chequeo definitivo dentro de `create_order`, transaccional |
| Q4+Q9 | Pausar pedidos | Destructivo: cancela los programados de la noche comercial en curso con `fire_at > now()`; diálogo con conteo y plata; los ya disparados y las noches futuras no se tocan |
| Q5+Q10 | Ventana | Slots de 15 min, horizonte 3 días (precio congelado + exposición a la pausa) |
| Q11 | Lead | 60 minutos planos; `fire_at` en el pasado es comportamiento esperado, no bug — no "arreglar" |
| Q13+Q14 | Overrides | `store_hours_overrides` entra al MVP; cerrar una fecha con programados los cancela con el mismo diálogo |
| Q7 | Cancelación | `order_cancelled` (WhatsApp, ya existente en el notifier) se cablea para TODA cancelación — alcance extra aceptado |
| Q8 | Reembolso | Manual en Mercado Pago; monto y advertencia en el diálogo |
