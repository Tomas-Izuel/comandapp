-- Pedidos programados y horarios de apertura
--
-- Decisiones tomadas en el grilling del 2026-08-29 con el dueño del producto.
-- El razonamiento completo está en
-- docs/pipelines/2026-08-29-pedidos-programados-y-horarios/00-architecture.md
--
-- LA REGLA QUE ORDENA TODO ESTE ARCHIVO: **el calendario NO se reimplementa en
-- Postgres.** Quién abre, cuándo, y qué instantes caen dentro de un rango, se
-- resuelve una sola vez en `src/lib/store-hours.ts` — módulo puro y sin
-- `server-only`, igual que `src/lib/delivery.ts`, para que la misma función que
-- pinta "cerrado" en el browser sea la que valida en el servidor. Todo lo que
-- acá necesita saber de calendario **lo recibe como parámetro** (`p_from`,
-- `p_to`, `night_start`, `night_end`). Dos implementaciones del mismo almanaque
-- es cómo el cliente ve "abierto" y el servidor contesta "cerrado".
--
-- Lo que SÍ vive acá es lo que no se puede hacer desde la app: la atomicidad
-- del reemplazo de la semana, el conteo de capacidad sin perder la carrera, y
-- las invariantes del pedido.


-- ---------------------------------------------------------------------------
-- 1. store_hours — el patrón semanal
--
-- Fila por RANGO, no por día: el corte del mediodía es un caso normal y un
-- jsonb opaco obligaría a validar la forma en un trigger artesanal o, peor,
-- solo en TypeScript.
--
-- `opens_at_minute + duration_minutes` en vez de `opens/closes`: el cruce de
-- medianoche es la norma en una hamburguesería (vie 18:00–02:00) y con
-- `closes < opens` implícito los bordes quedan ambiguos (¿`opens == closes` es
-- 0 h o 24 h?). Con duración es inambiguo por construcción y 24 h es
-- representable. El rango pertenece al día que ABRE — convención unánime de
-- Toast, Yelp, Schema.org y OSM.
--
-- `day_of_week`: 0 = domingo … 6 = sábado, la convención de `Date#getDay()`.
-- La lib compartida corre también en el browser y pelear contra la convención
-- de JS es invitar al off-by-one. Que la UI arranque la semana en lunes es
-- presentación.
-- ---------------------------------------------------------------------------

create table public.store_hours (
  id               bigint generated always as identity primary key,
  store_id         bigint   not null references public.stores(id) on delete cascade,
  day_of_week      smallint not null check (day_of_week between 0 and 6),
  opens_at_minute  smallint not null check (opens_at_minute between 0 and 1439),
  duration_minutes smallint not null check (duration_minutes between 15 and 1440),
  created_at       timestamptz not null default now()
);

-- Sin `updated_at`: las filas no se editan, se reemplazan enteras (§4.3).
create index store_hours_store_idx on public.store_hours (store_id);

comment on table public.store_hours is
  'Patrón semanal de apertura. Una fila por rango; el rango pertenece al día que abre, así que vie 18:00-02:00 es una fila del viernes con duration_minutes = 480.';

-- **Sin filas = siempre abierta.** Es la compatibilidad hacia atrás: ninguna
-- tienda existente tiene horarios y ninguna puede amanecer cerrada por un
-- deploy. El horario es opt-in, como el delivery.


-- ---------------------------------------------------------------------------
-- 2. store_hours_overrides — las excepciones por fecha
--
-- Sirve para las dos direcciones: cerrar un feriado que el patrón dice abierto,
-- y abrir un día que el patrón dice cerrado. Entró al alcance porque "pausar
-- pedidos" pasó a ser destructivo (§4 de este archivo): sin overrides, el dueño
-- que cierra el 1 de enero no tiene ninguna herramienta que no cancele pedidos.
--
-- Varios rangos por fecha ⇒ varias filas con el mismo (store_id, on_date). Una
-- fecha cerrada es exactamente una fila con `is_closed`.
-- ---------------------------------------------------------------------------

create table public.store_hours_overrides (
  id               bigint generated always as identity primary key,
  store_id         bigint   not null references public.stores(id) on delete cascade,
  on_date          date     not null,
  is_closed        boolean  not null default false,
  opens_at_minute  smallint check (opens_at_minute between 0 and 1439),
  duration_minutes smallint check (duration_minutes between 15 and 1440),
  created_at       timestamptz not null default now(),
  constraint store_hours_overrides_shape_check check (
    (is_closed     and opens_at_minute is null     and duration_minutes is null)
    or
    (not is_closed and opens_at_minute is not null and duration_minutes is not null)
  )
);

create index store_hours_overrides_store_date_idx
  on public.store_hours_overrides (store_id, on_date);

comment on table public.store_hours_overrides is
  'Excepciones por fecha sobre el patrón semanal. is_closed cierra la fecha; con rangos propios la abre con horario distinto. La fecha es la del día que ABRE, igual que store_hours.';


-- ---------------------------------------------------------------------------
-- 3. RLS y grants de las dos tablas nuevas
--
-- Los horarios son el dato MÁS público de un local: es lo que está pegado en la
-- puerta. Lectura para todos; escritura para nadie, ni siquiera el dueño —
-- pasa por RPC (§5).
--
-- Trampa conocida: sin el GRANT la tabla "no existe" para el Data API por más
-- perfectas que estén las RLS, y `service_role` tampoco hereda privilegios
-- sobre tablas que crea una migración.
-- ---------------------------------------------------------------------------

alter table public.store_hours           enable row level security;
alter table public.store_hours_overrides enable row level security;

-- El `or is_store_member` NO es cortesía: sin él, una tienda suspendida por la
-- plataforma le devuelve CERO filas a su propio dueño, y el editor de Ajustes
-- —que no bloquea el acceso por `status`— se renderiza vacío, indistinguible de
-- "nunca configuró horarios". Si el dueño guarda en ese estado, `set_store_hours`
-- (que chequea membresía, no `status`) reemplaza su semana real por el array
-- vacío del formulario, y al reactivarse la tienda el horario ya no existe.
-- Pérdida silenciosa de configuración, sin un solo error.
--
-- El `(select ...)` alrededor del helper es el patrón de RLS del repo: Postgres
-- lo cachea como InitPlan en vez de evaluarlo por fila.
-- DOS policies por tabla, no un OR adentro de una sola, y el motivo es de
-- privilegios: `private.is_store_member` tiene `grant execute` para
-- `authenticated` y NO para `anon` — los helpers viven en `private` justamente
-- para que el visitante anónimo no los alcance. Con el chequeo de membresía
-- dentro de una policy `to anon, authenticated`, TODA lectura anónima de los
-- horarios explota con `permission denied for function is_store_member`, y con
-- ella la vitrina entera y el selector de turnos del checkout.
--
-- Postgres filtra las policies por rol y después las combina con OR, así que
-- separarlas da el resultado buscado sin abrir `private` a `anon`: el visitante
-- solo evalúa la de la tienda activa; el miembro tiene además la suya.
create policy store_hours_public_read on public.store_hours
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_hours.store_id and s.status = 'active'
    )
  );

-- El staff tiene que poder leer SUS horarios aunque la plataforma haya
-- suspendido la tienda. Sin esto, el editor de Ajustes —que no bloquea por
-- `status`— se renderiza vacío, indistinguible de "nunca configuró horarios", y
-- si el dueño guarda ahí, `set_store_hours` (que chequea membresía, no `status`)
-- reemplaza su semana real por el array vacío del formulario. Pérdida
-- silenciosa de configuración, sin un solo error.
create policy store_hours_member_read on public.store_hours
  for select to authenticated
  using ((select private.is_store_member(store_hours.store_id)));

create policy store_hours_overrides_public_read on public.store_hours_overrides
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_hours_overrides.store_id and s.status = 'active'
    )
  );

create policy store_hours_overrides_member_read on public.store_hours_overrides
  for select to authenticated
  using ((select private.is_store_member(store_hours_overrides.store_id)));

grant select on public.store_hours           to anon, authenticated;
grant select on public.store_hours_overrides to anon, authenticated;
grant all    on public.store_hours           to service_role;
grant all    on public.store_hours_overrides to service_role;

-- NI UN GRANT DE ESCRITURA A `authenticated`, a propósito. El formulario de
-- Ajustes guarda la semana ENTERA de una vez; con grants de fila eso es
-- `delete` + N `insert` en dos requests de PostgREST, y un crash en el medio
-- deja al local "cerrado para siempre" hasta que alguien vuelva a guardar.


-- ---------------------------------------------------------------------------
-- 4. Columnas nuevas en `stores`
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists scheduled_delivery_enabled boolean not null default false,
  add column if not exists scheduled_capacity_per_night int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'stores_scheduled_capacity_check'
       and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_scheduled_capacity_check
      check (scheduled_capacity_per_night is null or scheduled_capacity_per_night > 0);
  end if;
end $$;

comment on column public.stores.scheduled_delivery_enabled is
  'Si se puede programar un pedido CON envío. Es política del dueño; la realidad (que haya un repartidor activo) se chequea aparte, mismo patrón que accepting_orders vs canCollectPayment.';
comment on column public.stores.scheduled_capacity_per_night is
  'Tope de pedidos programados por noche. NULL = sin tope. Es un amortiguador de volumen, no de ráfaga: no impide que los programados de la noche caigan todos juntos a las 21:00, ni cuenta los pedidos inmediatos, que todavía no existen cuando el cliente elige el slot.';

-- PASO DE LA CASCADA (20260826120000_hardening.sql §13): los grants sobre
-- `stores` son POR COLUMNA. Sin esto el dueño guarda Ajustes y le vuelve
-- `permission denied` que el formulario muestra como un error genérico.
grant update (
  scheduled_delivery_enabled, scheduled_capacity_per_night
) on public.stores to authenticated;


-- ---------------------------------------------------------------------------
-- 5. RPCs de escritura de horarios
--
-- `SECURITY DEFINER` + verificación de permiso EN EL CUERPO, y se llaman con el
-- cliente de SESIÓN, nunca con el admin client: `private.is_store_member` lee
-- `auth.uid()`, que con `service_role` no existe. Mismo patrón que
-- `store_couriers`.
--
-- Postgres le da EXECUTE a PUBLIC por defecto a toda función nueva, así que una
-- SECURITY DEFINER en `public` sin revoke es un endpoint abierto.
-- ---------------------------------------------------------------------------

create or replace function public.set_store_hours(p_store_id bigint, p_ranges jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  if jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'set_store_hours: p_ranges tiene que ser un array' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_ranges);
  if v_count > 28 then
    raise exception 'set_store_hours: demasiados rangos (%); el maximo es 28', v_count
      using errcode = 'check_violation';
  end if;

  -- Máximo 4 rangos por día. Un local con cinco cortes en un día está
  -- describiendo otra cosa, y el editor no lo ofrece.
  if exists (
    select 1
      from jsonb_array_elements(p_ranges) e
     group by (e ->> 'day_of_week')::int
    having count(*) > 4
  ) then
    raise exception 'set_store_hours: maximo 4 rangos por dia' using errcode = 'check_violation';
  end if;

  -- Solapamiento en la línea CIRCULAR de la semana. El desplazamiento de
  -- ±10080 minutos es lo que hace que "domingo 22:00-02:00" y "lunes 01:00" se
  -- vean como lo que son: el mismo tramo de tiempo.
  if exists (
    with r as (
      select (e ->> 'day_of_week')::int * 1440 + (e ->> 'opens_at_minute')::int as s,
             (e ->> 'duration_minutes')::int                                    as d,
             row_number() over ()                                               as rn
        from jsonb_array_elements(p_ranges) e
    )
    select 1
      from r a
      join r b on a.rn < b.rn
      join (values (0), (10080), (-10080)) as k(off) on true
     where a.s < b.s + k.off + b.d
       and b.s + k.off < a.s + a.d
  ) then
    raise exception 'set_store_hours: hay rangos que se superponen' using errcode = 'check_violation';
  end if;

  -- Reemplazo atómico: el motivo entero por el que esto es una RPC.
  delete from public.store_hours where store_id = p_store_id;

  insert into public.store_hours (store_id, day_of_week, opens_at_minute, duration_minutes)
  select p_store_id,
         (e ->> 'day_of_week')::smallint,
         (e ->> 'opens_at_minute')::smallint,
         (e ->> 'duration_minutes')::smallint
    from jsonb_array_elements(p_ranges) e;
end;
$$;

revoke execute on function public.set_store_hours(bigint, jsonb) from public, anon;
grant  execute on function public.set_store_hours(bigint, jsonb) to authenticated, service_role;


create or replace function public.set_store_hours_override(
  p_store_id  bigint,
  p_on_date   date,
  p_is_closed boolean,
  p_ranges    jsonb default '[]'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  if not p_is_closed and jsonb_array_length(coalesce(p_ranges, '[]'::jsonb)) = 0 then
    raise exception 'set_store_hours_override: una fecha abierta necesita al menos un rango'
      using errcode = 'check_violation';
  end if;

  -- Las mismas guardas que `set_store_hours`. Sin esto, el patrón semanal está
  -- validado y la excepción de fecha no, así que un override es la puerta de
  -- atrás para meter rangos solapados que la lib de calendario después tiene
  -- que desempatar sola.
  --
  -- Acá el solapamiento es LINEAL, no circular: todos los rangos parten de la
  -- misma fecha, y uno que cruza la medianoche simplemente pasa de 1440.
  if not p_is_closed then
    if jsonb_array_length(p_ranges) > 4 then
      raise exception 'set_store_hours_override: maximo 4 rangos por fecha'
        using errcode = 'check_violation';
    end if;

    if exists (
      with r as (
        select (e ->> 'opens_at_minute')::int  as s,
               (e ->> 'duration_minutes')::int as d,
               row_number() over ()            as rn
          from jsonb_array_elements(p_ranges) e
      )
      select 1
        from r a
        join r b on a.rn < b.rn
       where a.s < b.s + b.d
         and b.s < a.s + a.d
    ) then
      raise exception 'set_store_hours_override: hay rangos que se superponen'
        using errcode = 'check_violation';
    end if;
  end if;

  delete from public.store_hours_overrides
   where store_id = p_store_id and on_date = p_on_date;

  if p_is_closed then
    insert into public.store_hours_overrides (store_id, on_date, is_closed)
    values (p_store_id, p_on_date, true);
  else
    insert into public.store_hours_overrides
      (store_id, on_date, is_closed, opens_at_minute, duration_minutes)
    select p_store_id, p_on_date, false,
           (e ->> 'opens_at_minute')::smallint,
           (e ->> 'duration_minutes')::smallint
      from jsonb_array_elements(p_ranges) e;
  end if;
end;
$$;

revoke execute on function public.set_store_hours_override(bigint, date, boolean, jsonb) from public, anon;
grant  execute on function public.set_store_hours_override(bigint, date, boolean, jsonb) to authenticated, service_role;


create or replace function public.delete_store_hours_override(p_store_id bigint, p_on_date date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  delete from public.store_hours_overrides
   where store_id = p_store_id and on_date = p_on_date;
end;
$$;

revoke execute on function public.delete_store_hours_override(bigint, date) from public, anon;
grant  execute on function public.delete_store_hours_override(bigint, date) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. Columnas nuevas en `orders`
--
-- `fire_at` es el momento en que el pedido entra a la cocina:
--   scheduled_for − (base_prep_minutes + delivery_minutes + 5 de margen)
--
-- No hay estado nuevo, y ésa es la decisión de fondo. Un estado `scheduled`
-- tocaría ALLOWED_TRANSITIONS, el trigger, el test de paridad y los ocho
-- lugares que enumeran estados, para expresar lo que `confirmed + fire_at` ya
-- dice. El KDS filtra por el predicado y listo.
--
-- Tampoco es columna generada: `timestamptz − interval` es STABLE (depende del
-- GUC TimeZone), así que Postgres rechaza la expresión en un `generated
-- always`. La calcula `create_order` dentro de la transacción.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists scheduled_for  timestamptz,
  add column if not exists fire_at        timestamptz,
  add column if not exists scheduled_night date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'orders_scheduled_coherence_check'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_scheduled_coherence_check
      check (
        (scheduled_for is null and fire_at is null and scheduled_night is null)
        or
        (scheduled_for is not null and fire_at is not null and scheduled_night is not null
         and fire_at <= scheduled_for)
      );
  end if;
end $$;

comment on column public.orders.scheduled_for is
  'Hora pactada de retiro o de entrega en la puerta. NULL = pedido para ahora, o sea el comportamiento de siempre.';
comment on column public.orders.fire_at is
  'Momento en que el pedido entra al KDS. Puede quedar EN EL PASADO y no es un bug: con lead mínimo de 60 minutos planos, un carrito pesado con envío necesita más anticipación que eso, y el pedido aparece en el tablero en el próximo poll. Es la recuperación correcta ("ya vas tarde, arrancá"). No lo "arregles".';

comment on column public.orders.scheduled_night is
  'La NOCHE COMERCIAL a la que pertenece el pedido, no el día calendario. Un pedido para el sábado 01:30 de un local que abre viernes 18:00-02:00 pertenece a la noche del VIERNES. Lo deriva el servidor con la lib compartida (commercialNightOf) y se persiste porque es la unidad del tope por noche, del apagado destructivo y de la bandeja de Programados: con una ventana de timestamps las tres tendrían que recalcular el mismo almanaque.';

-- Para la bandeja de Programados de /admin/pedidos y para el conteo de
-- capacidad de `create_order`. Parcial: los programados son una minoría de las
-- filas y el índice se mantiene chico.
create index orders_scheduled_idx on public.orders (store_id, scheduled_for)
  where scheduled_for is not null;

-- El tope por noche y el apagado destructivo consultan por noche, no por
-- instante.
create index orders_scheduled_night_idx on public.orders (store_id, scheduled_night)
  where scheduled_night is not null;

-- `orders_active_idx` NO se toca. Sigue siendo (store_id, created_at) con
-- predicado sobre status, y el filtro nuevo del KDS
-- (`fire_at is null or fire_at <= now()`) es un OR que ningún índice sirve
-- bien. No importa: el conjunto activo de una cocina son decenas de filas, y
-- el predicado se aplica sobre eso.


-- ---------------------------------------------------------------------------
-- 7. create_order — redefinición
--
-- Cambios respecto de la versión de 20260828130000_delivery.sql:
--   · inserta `scheduled_for`
--   · calcula `fire_at` adentro de la transacción (una sola fuente)
--   · chequea el tope de programados por noche, sin perder la carrera
--
-- ESTA FUNCIÓN ENUMERA LAS COLUMNAS A MANO. Una columna nueva de `orders` que
-- no se agregue acá desaparece sin error.
--
-- El calendario llega como parámetro: `night_start` / `night_end` los calcula
-- el servidor con la lib compartida. Postgres no sabe qué es "una noche" y no
-- tiene por qué saberlo.
-- ---------------------------------------------------------------------------

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store_id     bigint := (p_order ->> 'store_id')::bigint;
  v_key          text   := p_order ->> 'idempotency_key';
  v_scheduled    timestamptz := (p_order ->> 'scheduled_for')::timestamptz;
  v_night        date   := (p_order ->> 'scheduled_night')::date;
  v_capacity     int    := (p_order ->> 'night_capacity')::int;
  v_fire_at      timestamptz;
  v_taken        int;
  v_order_id     bigint;
  v_item         jsonb;
  v_item_id      bigint;
  v_option       jsonb;
begin
  if v_store_id is null or v_key is null then
    raise exception 'create_order: faltan store_id o idempotency_key' using errcode = 'null_value_not_allowed';
  end if;

  select o.id into v_order_id
    from public.orders o
   where o.store_id = v_store_id and o.idempotency_key = v_key;
  if found then
    return v_order_id;
  end if;

  if v_scheduled is not null then
    -- El margen de 5 minutos es de plancha: el pedido entra al tablero un poco
    -- antes de que la cocina tenga que tocarlo.
    v_fire_at := v_scheduled
               - ((coalesce((p_order ->> 'base_prep_minutes')::int, 0)
                 + coalesce((p_order ->> 'delivery_minutes')::int, 0)
                 + 5) * interval '1 minute');

    if v_night is null then
      raise exception 'create_order: un pedido programado necesita scheduled_night'
        using errcode = 'null_value_not_allowed';
    end if;

    if v_capacity is not null then
      -- Lock por (tienda, noche) ANTES de contar. Dos clientes agarrando el
      -- último lugar del viernes es exactamente la carrera que un `if` en el
      -- servidor pierde: los dos leen 4 de 5 y los dos insertan.
      --
      -- Advisory lock y no `select ... from stores for update`: bloquear la
      -- fila de la tienda serializaría TODA la creación de pedidos del local,
      -- inmediatos incluidos, justo en hora pico. Acá la contención es solo
      -- entre dos programados para la misma noche.
      perform pg_advisory_xact_lock(
        hashtextextended(v_store_id::text || ':' || v_night::text, 0)
      );

      select count(*)::int into v_taken
        from public.orders o
       where o.store_id        = v_store_id
         and o.scheduled_night = v_night
         and o.status         <> 'cancelled';

      if v_taken >= v_capacity then
        -- El mensaje arranca con un marcador estable porque es lo que la capa
        -- de modelos matchea para traducirlo a un DomainError con texto de
        -- interfaz ("no quedan lugares para esa noche"). El SQLSTATE propio
        -- evita además confundirlo con cualquier otro check_violation.
        raise exception 'scheduled_night_full: la noche esta completa (% de %)', v_taken, v_capacity
          using errcode = 'BS429';
      end if;
    end if;
  end if;

  begin
    insert into public.orders (
      store_id, status, customer_name, customer_phone_e164, customer_email,
      idempotency_key, notes, currency, subtotal_cents, total_cents,
      base_prep_minutes, demand_multiplier, eta_minutes, eta_at,
      payment_method, payment_status,
      delivery_method, delivery_fee_cents, delivery_minutes,
      delivery_address_line, delivery_address_unit,
      delivery_address_between, delivery_address_notes,
      scheduled_for, fire_at, scheduled_night
    ) values (
      v_store_id,
      p_order ->> 'status',
      p_order ->> 'customer_name',
      p_order ->> 'customer_phone_e164',
      p_order ->> 'customer_email',
      v_key,
      p_order ->> 'notes',
      p_order ->> 'currency',
      (p_order ->> 'subtotal_cents')::bigint,
      (p_order ->> 'total_cents')::bigint,
      (p_order ->> 'base_prep_minutes')::int,
      (p_order ->> 'demand_multiplier')::numeric,
      (p_order ->> 'eta_minutes')::int,
      (p_order ->> 'eta_at')::timestamptz,
      p_order ->> 'payment_method',
      coalesce(p_order ->> 'payment_status', 'pending'),
      coalesce(p_order ->> 'delivery_method', 'pickup'),
      coalesce((p_order ->> 'delivery_fee_cents')::bigint, 0),
      (p_order ->> 'delivery_minutes')::int,
      p_order ->> 'delivery_address_line',
      p_order ->> 'delivery_address_unit',
      p_order ->> 'delivery_address_between',
      p_order ->> 'delivery_address_notes',
      v_scheduled,
      v_fire_at,
      v_night
    )
    returning id into v_order_id;
  exception when unique_violation then
    -- Dos requests con la misma clave llegaron juntos y los dos pasaron el
    -- select de arriba. El indice decidio; devolvemos el que gano.
    select o.id into v_order_id
      from public.orders o
     where o.store_id = v_store_id and o.idempotency_key = v_key;
    if found then
      return v_order_id;
    end if;
    -- No era la clave de idempotencia: puede ser una colision de short_code
    -- (`next_short_code` no es atomico). Que suba, para no confundir un bug con
    -- un reintento.
    raise;
  end;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items (
      order_id, product_id, name_snapshot, unit_price_cents,
      quantity, total_cents, prep_minutes, notes
    ) values (
      v_order_id,
      (v_item ->> 'product_id')::bigint,
      v_item ->> 'name_snapshot',
      (v_item ->> 'unit_price_cents')::bigint,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'total_cents')::bigint,
      (v_item ->> 'prep_minutes')::int,
      v_item ->> 'notes'
    )
    returning id into v_item_id;

    for v_option in
      select value from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb))
    loop
      insert into public.order_item_options (
        order_item_id, option_id, name_snapshot, group_snapshot, price_delta_cents
      ) values (
        v_item_id,
        (v_option ->> 'option_id')::bigint,
        v_option ->> 'name_snapshot',
        v_option ->> 'group_snapshot',
        coalesce((v_option ->> 'price_delta_cents')::bigint, 0)
      );
    end loop;
  end loop;

  return v_order_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. enforce_order_rules — redefinición
--
-- Único cambio respecto de la versión de 20260828130000_delivery.sql:
-- `scheduled_for` y `fire_at` entran a la lista de columnas INMUTABLES. La
-- promesa no se renegocia: se cancela el pedido y se hace otro. Si se pudiera
-- mover `scheduled_for` después del insert, el cliente pagó por una hora y
-- retira en otra.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_order_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  -- El precio, la moneda y los identificadores de un pedido son su identidad.
  -- Si se pueden reescribir despues del insert, el historial contable de la
  -- tienda no vale nada: un `total_cents = 1` borra el rastro de la venta.
  --
  -- `delivery_method` y `delivery_fee_cents` entran acá por lo mismo: son
  -- identidad y plata. La DIRECCION queda mutable a propósito — "el cliente
  -- puso mal el número y el local lo corrige" es un caso real y una plata real.
  -- Igual el browser del staff no puede escribirla: `orders` tiene
  -- `revoke update from authenticated` + `grant update (status)` y nada más.
  if new.store_id           is distinct from old.store_id
  or new.public_token       is distinct from old.public_token
  or new.idempotency_key    is distinct from old.idempotency_key
  or new.subtotal_cents     is distinct from old.subtotal_cents
  or new.total_cents        is distinct from old.total_cents
  or new.currency           is distinct from old.currency
  or new.payment_method     is distinct from old.payment_method
  or new.delivery_method    is distinct from old.delivery_method
  or new.delivery_fee_cents is distinct from old.delivery_fee_cents
  or new.scheduled_for      is distinct from old.scheduled_for
  or new.fire_at            is distinct from old.fire_at
  or new.scheduled_night    is distinct from old.scheduled_night
  or new.created_at         is distinct from old.created_at then
    raise exception
      'el pedido % tiene columnas inmutables: store_id, public_token, idempotency_key, subtotal_cents, total_cents, currency, payment_method, delivery_method, delivery_fee_cents, scheduled_for, fire_at, scheduled_night, created_at',
      old.id
      using errcode = 'check_violation';
  end if;

  -- El repartidor asignado tiene que ser un repartidor ACTIVO de ESTA tienda.
  --
  -- La alternativa canónica del repo sería una FK compuesta
  -- (store_id, courier_id), como `products_category_same_store_fkey`. Se
  -- descartó: una segunda FK desde `orders` que incluya `store_id` arriesga
  -- volver ambiguo el embed `stores ( * )` de
  -- ORDER_WITH_ITEMS_AND_STORE_SELECT, del que dependen el seguimiento público
  -- entero y el webhook de Mercado Pago. Acá la invariante se cierra igual, y
  -- para todos los roles: service_role incluido, que es donde vive la acción.
  if new.courier_id is distinct from old.courier_id and new.courier_id is not null then
    if not exists (
      select 1 from public.store_members m
       where m.id       = new.courier_id
         and m.store_id = new.store_id
         and m.role     = 'courier'
         and m.is_active
    ) then
      raise exception 'el repartidor % no es un repartidor activo de la tienda del pedido %',
        new.courier_id, old.id
        using errcode = 'check_violation';
    end if;
    new.assigned_at := now();
  end if;

  if new.status is distinct from old.status then
    -- Se permite UN paso atras dentro de la cocina porque un toque equivocado en
    -- hora pico esta garantizado; `delivered` y `cancelled` son terminales.
    --
    -- `ready -> delivered` se mantiene: es el camino de todo pedido de retiro, y
    -- el de un delivery que el cliente termina pasando a buscar.
    allowed := case old.status
                 when 'pending'    then array['confirmed','cancelled']
                 when 'confirmed'  then array['preparing','cancelled']
                 when 'preparing'  then array['ready','confirmed','cancelled']
                 when 'ready'      then array['delivered','on_the_way','preparing','cancelled']
                 when 'on_the_way' then array['delivered','ready','cancelled']
                 else array[]::text[]
               end;

    if not (new.status = any (allowed)) then
      raise exception 'transicion de estado ilegal en el pedido %: % -> %',
        old.id, old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- La comida no sale sin plata asegurada. El pago en el local si entra a la
    -- cocina impago, porque ahi el cobro es presencial.
    if new.status = 'confirmed'
       and new.payment_method = 'online'
       and new.payment_status <> 'approved' then
      raise exception 'el pedido % es online y todavia no esta pago: no puede pasar a confirmed', old.id
        using errcode = 'check_violation';
    end if;

    -- Un pedido no puede "salir a repartir" si no hay nada que repartir ni
    -- nadie que lo lleve.
    if new.status = 'on_the_way' then
      if new.delivery_method <> 'delivery' then
        raise exception 'el pedido % es de retiro en el local: no puede ir en camino', old.id
          using errcode = 'check_violation';
      end if;
      if new.courier_id is null then
        raise exception 'el pedido % no tiene repartidor asignado: no puede ir en camino', old.id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Los consumidores del predicado `fire_at`
--
-- Son CUATRO, no tres. Un programado que espera su hora está en `confirmed`,
-- así que cualquier cosa que cuente o barra "pedidos activos" lo agarra sin
-- querer:
--
--   1. getActiveOrders (TypeScript) — el tablero del KDS. Slice T2.
--   2. estimateEta     (TypeScript) — el conteo de demanda. Slice T2.
--   3. private.active_order_count   — ACÁ. Es el espejo en Postgres de
--      COOKING_STATUSES, y sin esto un programado infla el multiplicador de
--      demanda de todos los pedidos inmediatos de la noche DESDE LA BASE,
--      aunque el conteo de TypeScript lo excluya.
--   4. advance_auto_orders          — ACÁ. El auto-comenzar arrancaría la
--      cocción a las 17:00 para una entrega a las 21:00.
-- ---------------------------------------------------------------------------

create or replace function private.active_order_count(p_store_id bigint)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.orders o
  where o.store_id = p_store_id
    and o.status in ('confirmed', 'preparing')
    -- Un programado que todavía no disparó no es carga de cocina: está parado
    -- esperando su hora, y contarlo sube el ETA de todos los demás.
    and (o.fire_at is null or o.fire_at <= now());
$$;

revoke execute on function private.active_order_count(bigint) from public, anon, authenticated;


create or replace function public.advance_auto_orders()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_readied bigint[];
  v_started int;
begin
  -- AUTO-LISTO ANTES DE AUTO-COMENZAR, a proposito, y es el orden que importa.
  -- Al reves, un pedido parado en 'confirmed' con el ETA ya vencido (porque el
  -- barrido estuvo caido, o porque el local recien prendio el toggle) pasaria
  -- a 'preparing' y de ahi a 'ready' en la MISMA corrida: el cliente recibiria
  -- "tu pedido esta listo" por comida que nunca se empezo a cocinar. Corriendo
  -- listo primero, el conjunto que se evalua es el que ya estaba en la plancha.
  --
  -- El auto-listo NO necesita filtro de fire_at: un programado tiene
  -- `eta_at = scheduled_for`, así que el auto-listo suena exactamente a la hora
  -- pactada, que es lo que se quiere. Y solo puede agarrarlo si ya está en
  -- 'preparing', o sea si ya disparó.
  with readied as (
    update public.orders o
       set status = 'ready'
      from public.stores s
     where s.id = o.store_id
       and s.auto_ready_orders
       -- Solo desde 'preparing', nunca desde 'confirmed': asi "Listo" sigue
       -- significando que alguien lo arranco, salvo que el local haya prendido
       -- las dos automatizaciones, que ya es una decision explicita suya.
       and o.status = 'preparing'
       and o.eta_at is not null
       and o.eta_at <= now()
       -- Una tienda suspendida por la plataforma no le manda avisos a nadie en
       -- nombre del local. El staff igual puede mover el tablero a mano.
       and s.status = 'active'
    returning o.id
  )
  select coalesce(array_agg(id), '{}'::bigint[]) into v_readied from readied;

  with started as (
    update public.orders o
       set status = 'preparing'
      from public.stores s
     where s.id = o.store_id
       and s.auto_start_orders
       and o.status = 'confirmed'
       and s.status = 'active'
       -- CONSUMIDOR 4 DEL PREDICADO. Sin esto, el auto-comenzar arranca la
       -- cocción de un pedido de las 21:00 apenas entra, a las 17:00.
       and (o.fire_at is null or o.fire_at <= now())
    returning o.id
  )
  select count(*)::int into v_started from started;

  -- `readied` devuelve IDS y no un conteo a proposito: el aviso al cliente
  -- ("tu pedido esta listo") NO lo manda ningun trigger — lo manda el
  -- controller, por WhatsApp y por mail. El cron necesita saber a cuales
  -- avisarle. El evento de outbox para el POS si sale solo, por
  -- `private.log_order_status_change`.
  return jsonb_build_object('started', v_started, 'readied', to_jsonb(v_readied));
end;
$$;

-- `create or replace function` conserva los privilegios, pero los repetimos
-- porque una SECURITY DEFINER en `public` sin revoke explícito es un endpoint
-- abierto y no queremos que eso dependa de recordar un detalle de Postgres.
revoke execute on function public.advance_auto_orders() from public, anon, authenticated;
grant  execute on function public.advance_auto_orders() to service_role;


-- ---------------------------------------------------------------------------
-- 10. store_dashboard — redefinición
--
-- Único cambio: la métrica de preparación medía desde `confirmed_at`. Un
-- programado se confirma a las 17:00 y se cocina a las 21:00, así que sumaba
-- cuatro horas de espera como si fueran cocción y ensuciaba el promedio de
-- toda la tienda. Pasa a medir desde `greatest(confirmed_at, fire_at)`, que
-- para un pedido inmediato (fire_at null) es exactamente `confirmed_at`:
-- GREATEST ignora los NULL.
-- ---------------------------------------------------------------------------

create or replace function public.store_dashboard(p_store_id bigint, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_since timestamptz;
  v_out   jsonb;
begin
  -- SECURITY DEFINER bypassea RLS y PostgREST expone esta funcion a cualquier
  -- `authenticated`: sin este chequeo, un dueno lee el dashboard del competidor
  -- pasando otro id.
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  if v_tz is null then
    raise exception 'la tienda % no existe', p_store_id using errcode = 'no_data_found';
  end if;

  v_since := (date_trunc('day', (now() at time zone v_tz)) - ((p_days - 1) * interval '1 day')) at time zone v_tz;

  with scoped as (
    select o.id, o.status, o.total_cents, o.eta_minutes, o.confirmed_at, o.ready_at,
           o.fire_at,
           (o.created_at at time zone v_tz)::date as local_day,
           private.order_is_billable(o.payment_status, o.payment_method, o.status) as billable
      from public.orders o
     where o.store_id = p_store_id
       and o.created_at >= v_since
  ),
  -- Serie completa de dias: sin esto el grafico saltea los dias sin ventas y la
  -- linea miente sobre la tendencia.
  days as (
    select d::date as local_day
      from generate_series(
             date_trunc('day', (v_since at time zone v_tz)),
             date_trunc('day', (now() at time zone v_tz)),
             interval '1 day'
           ) d
  ),
  sales as (
    select d.local_day,
           count(s.id)                     as orders,
           coalesce(sum(s.total_cents), 0) as revenue_cents
      from days d
      left join scoped s on s.local_day = d.local_day and s.billable
     group by d.local_day
  ),
  by_status as (
    select s.status, count(*)::int as n from scoped s group by s.status
  ),
  ticket as (
    select coalesce(round(avg(s.total_cents)), 0)::bigint as avg_cents
      from scoped s where s.billable
  ),
  prep as (
    -- greatest(confirmed_at, fire_at): para un pedido inmediato fire_at es NULL
    -- y GREATEST lo ignora, así que da confirmed_at y la métrica no cambia.
    select coalesce(round(avg(extract(epoch from (s.ready_at - greatest(s.confirmed_at, s.fire_at))) / 60)), 0)::int as real_min,
           coalesce(round(avg(s.eta_minutes)), 0)::int                                                               as est_min,
           count(*)::int                                                                                             as sample
      from scoped s
     where s.confirmed_at is not null and s.ready_at is not null and s.eta_minutes is not null
  ),
  top as (
    -- Se agrupa por producto cuando existe y por nombre cuando el producto se
    -- borro del catalogo: el snapshot es lo unico que queda de esa venta.
    select coalesce('p' || i.product_id::text, 's' || i.name_snapshot) as key,
           min(i.product_id)          as product_id,
           min(i.name_snapshot)       as name,
           sum(i.quantity)::int       as quantity,
           sum(i.total_cents)::bigint as revenue_cents
      from public.order_items i
      join scoped s on s.id = i.order_id
     where s.billable
     group by 1
     order by 4 desc
     limit 10
  )
  select jsonb_build_object(
    'salesByDay', coalesce((
       select jsonb_agg(jsonb_build_object(
                'date',         to_char(local_day, 'YYYY-MM-DD'),
                'orders',       orders,
                'revenueCents', revenue_cents) order by local_day)
         from sales), '[]'::jsonb),
    'topProducts', coalesce((
       select jsonb_agg(jsonb_build_object(
                'productId',    product_id,
                'name',         name,
                'quantity',     quantity,
                'revenueCents', revenue_cents) order by quantity desc)
         from top), '[]'::jsonb),
    'ordersByStatus', coalesce((select jsonb_object_agg(status, n) from by_status), '{}'::jsonb),
    'averageTicketCents', (select avg_cents from ticket),
    'prepAccuracy', jsonb_build_object(
        'avgRealMinutes',      (select real_min from prep),
        'avgEstimatedMinutes', (select est_min  from prep),
        'sampleSize',          (select sample   from prep))
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.store_dashboard(bigint, int) from public, anon;
grant  execute on function public.store_dashboard(bigint, int) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11. cancel_scheduled_orders — el apagado destructivo
--
-- La decisión de producto: "pausar pedidos" dejó de ser un toggle reversible y
-- gratis y pasó a ser un apagado que CANCELA los programados de la noche en
-- curso que todavía no dispararon. La misma función atiende el otro camino que
-- cancela: cerrar una fecha desde el calendario de excepciones.
--
-- Lo que NO toca: los que ya dispararon y están en la plancha. Para eso está el
-- botón del KDS, uno por uno y con criterio — cancelar comida ya hecha es una
-- decisión que se toma mirando el pedido.
--
-- La NOCHE llega como parámetro. Qué es "esta noche" lo resuelve el servidor
-- con la lib compartida: si el local está abierto es el rango en curso, y si
-- está cerrado es el próximo que abre. Postgres no sabe qué es una noche.
--
-- Devuelve los IDS y no un conteo, igual que `advance_auto_orders`: el aviso al
-- cliente lo manda el controller (ahora sí — `order_cancelled` existía en el
-- puerto de notificaciones desde el principio y nadie lo disparaba), y necesita
-- saber a quiénes.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_scheduled_orders(
  p_store_id bigint,
  p_night    date,
  p_pause    boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids   bigint[];
  v_paid  bigint;
begin
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  with victims as (
    update public.orders o
       set status = 'cancelled'
     where o.store_id        = p_store_id
       and o.scheduled_night = p_night
       -- Todavía no disparó: la cocina no lo tocó.
       and o.fire_at        >  now()
       -- Solo lo que es cancelable sin discusión. Si alguien lo arrancó a mano
       -- antes de tiempo, queda para el botón del KDS.
       and o.status in ('pending', 'confirmed')
    returning o.id, o.total_cents, o.payment_status
  )
  select coalesce(array_agg(id), '{}'::bigint[]),
         coalesce(sum(total_cents) filter (where payment_status = 'approved'), 0)
    into v_ids, v_paid
    from victims;

  -- Pausa y cancelación en la MISMA transacción: si se hicieran en dos pasos,
  -- una falla en el medio deja la tienda pausada con pedidos vivos, o al revés.
  if p_pause then
    update public.stores set accepting_orders = false where id = p_store_id;
  end if;

  -- `paidCents` es lo que el local tiene que devolver A MANO por Mercado Pago:
  -- no hay auto-refund y el diálogo de confirmación lo dice con todas las
  -- letras antes de ejecutar.
  return jsonb_build_object(
    'cancelledIds', to_jsonb(v_ids),
    'cancelled',    coalesce(array_length(v_ids, 1), 0),
    'paidCents',    v_paid
  );
end;
$$;

revoke execute on function public.cancel_scheduled_orders(bigint, date, boolean) from public, anon;
grant  execute on function public.cancel_scheduled_orders(bigint, date, boolean) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 12. platform_stores — redefinición (LA CASCADA, otra vez)
--
-- `platform_stores` enumera las columnas de `stores` A MANO, y su fila se mapea
-- a `Store` en `platform.model.ts`. Como `Store` ahora exige `scheduling`, sin
-- las dos columnas nuevas el mapper no compila — y si compilara sería peor: el
-- backoffice mostraría toda tienda como "sin delivery programado y sin tope",
-- sin un solo error.
--
-- Es la SÉPTIMA redefinición de esta función, y la base de esta versión es la
-- de `20260829160000_online_payment_flag.sql`, no la de `delivery.sql`. El
-- primer intento de este archivo se apoyó en la de delivery y habría REVERTIDO
-- `online_payment_enabled` fuera de la salida — la trampa exacta que documenta
-- CLAUDE.md: la vigente es siempre la de la migración más nueva, y editar una
-- definición vieja es un cambio que no se aplica (o peor, que deshace).
--
-- (`create_order` ya está arriba. `store_couriers` se revisó y NO las necesita:
-- devuelve el padrón de repartidores y sus métricas, nada de configuración de
-- la tienda.)
-- ---------------------------------------------------------------------------

create or replace function public.platform_stores(p_store_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_out
    from (
      select s.id, s.slug, s.name, s.description,
             s.phone_e164, s.whatsapp_phone_e164, s.address,
             s.timezone, s.currency, s.status, s.accepting_orders,
             s.in_store_payment_enabled, s.online_payment_enabled, s.min_order_cents,
             s.demand_threshold_orders, s.demand_multiplier,
             s.auto_start_orders, s.auto_ready_orders,
             s.instagram_handle, s.maps_url,
             s.rappi_url, s.pedidos_ya_url, s.uber_eats_url,
             s.latitude, s.longitude,
             s.delivery_enabled, s.delivery_fee_cents, s.delivery_free_from_cents,
             s.delivery_min_order_cents, s.delivery_minutes, s.delivery_busy_minutes,
             s.courier_collects_payment,
             s.scheduled_delivery_enabled, s.scheduled_capacity_per_night,
             s.created_at,
             (select u.email
                from public.store_members m
                join auth.users u on u.id = m.user_id
               where m.store_id = s.id and m.role = 'owner'
               order by m.created_at
               limit 1) as owner_email,
             coalesce(agg.orders, 0)::int         as orders_last_30,
             coalesce(agg.revenue, 0)::bigint     as revenue_last_30_cents
        from public.stores s
        left join lateral (
          select count(*) as orders, sum(o.total_cents) as revenue
            from public.orders o
           where o.store_id = s.id
             and o.created_at >= now() - interval '30 days'
             and private.order_is_billable(o.payment_status, o.payment_method, o.status)
        ) agg on true
       where p_store_id is null or s.id = p_store_id
    ) t;

  return v_out;
end;
$$;

revoke execute on function public.platform_stores(bigint) from public, anon;
grant  execute on function public.platform_stores(bigint) to authenticated, service_role;
