-- ===========================================================================
-- Envio propio
--
-- Hasta acá todo pedido era retiro en el local, y eso estaba escrito como
-- decisión explícita en el schema (no hay dirección del cliente en ningún
-- lado) y en el código. Esta migración agrega:
--
--   1. Configuración de envío por tienda (costo, mínimo, minutos de viaje).
--   2. Un tercer rol en `store_members`: `courier`.
--   3. Columnas de entrega en `orders` (método, dirección, fee, repartidor).
--   4. Un estado nuevo en la máquina de cocina: `on_the_way`.
--   5. Cuatro RPC para que el repartidor opere SIN tener acceso a `orders`.
--
-- EL ORDEN DE LOS BLOQUES IMPORTA. En particular: primero se ensancha el CHECK
-- de `store_members.role`, después se endurece `private.is_store_member`, y
-- recién ahí puede existir un courier. Al revés hay una ventana en la que un
-- courier tiene acceso total a la tienda.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. stores: la configuración de envío
--
-- Todo `boolean`/`bigint`/`int`, ningún `numeric`. El driver entrega `numeric`
-- como string y obliga a un `Number()` en `toStore` Y otro en
-- `toPlatformStoreRow` — la trampa que el comentario de `demand_multiplier` ya
-- documenta dos veces. No se repite siete veces más.
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists delivery_enabled         boolean not null default false,
  add column if not exists delivery_fee_cents       bigint  not null default 0,
  add column if not exists delivery_free_from_cents bigint  not null default 0,
  add column if not exists delivery_min_order_cents bigint  not null default 0,
  add column if not exists delivery_minutes         int     not null default 30,
  add column if not exists delivery_busy_minutes    int     not null default 50,
  add column if not exists courier_collects_payment boolean not null default false;

alter table public.stores
  add constraint stores_delivery_fee_check          check (delivery_fee_cents       >= 0),
  add constraint stores_delivery_free_from_check    check (delivery_free_from_cents >= 0),
  add constraint stores_delivery_min_order_check    check (delivery_min_order_cents >= 0),
  add constraint stores_delivery_minutes_check      check (delivery_minutes      between 0 and 240),
  add constraint stores_delivery_busy_minutes_check check (delivery_busy_minutes between 0 and 240);

comment on column public.stores.delivery_free_from_cents is
  'Subtotal a partir del cual el envío es gratis. 0 = nunca gratis.';
comment on column public.stores.delivery_busy_minutes is
  'Minutos de viaje cuando TODOS los repartidores están en la calle.';
comment on column public.stores.courier_collects_payment is
  'Si el repartidor cobra en la puerta. En false, el portal no ve ni un centavo.';

-- No hay CHECK cruzado `busy >= minutes` a propósito: obligaría a un
-- `.superRefine()` sobre `storeSettingsInputSchema`, y normalizar en silencio
-- con `Math.max` sería pisarle un número que el dueño escribió con intención.
-- Queda como hint en el formulario.

-- PASO 2 DE LA CASCADA (20260826120000_hardening.sql §13): los grants sobre
-- `stores` son POR COLUMNA. Sin esto el dueño guarda Ajustes y le vuelve
-- `permission denied` que el formulario muestra como un error genérico.
grant update (
  delivery_enabled, delivery_fee_cents, delivery_free_from_cents,
  delivery_min_order_cents, delivery_minutes, delivery_busy_minutes,
  courier_collects_payment
) on public.stores to authenticated;


-- ---------------------------------------------------------------------------
-- 2. store_members: el rol `courier`
--
-- ORDEN: el CHECK se ensancha ANTES de endurecer `is_store_member` (§3), y
-- ningún courier puede existir hasta que las dos cosas estén hechas.
-- ---------------------------------------------------------------------------

alter table public.store_members
  add column if not exists display_name text,
  add column if not exists is_active    boolean not null default true,
  add column if not exists invited_at   timestamptz;

comment on column public.store_members.is_active is
  'false = dado de baja. La fila NUNCA se borra: orders.courier_id apunta acá y '
  'quién llevó qué es parte de la contabilidad del local.';

alter table public.store_members drop constraint store_members_role_check;
alter table public.store_members
  add constraint store_members_role_check check (role in ('owner', 'staff', 'courier'));

-- Un repartidor tiene que tener nombre porque es lo que ve el CLIENTE en el
-- seguimiento ("Martín está llevando tu pedido"). El email nunca sale del panel.
alter table public.store_members
  add constraint store_members_courier_needs_name_check
  check (role <> 'courier' or (display_name is not null and btrim(display_name) <> ''));

create index store_members_store_courier_idx on public.store_members (store_id)
  where role = 'courier' and is_active;


-- ---------------------------------------------------------------------------
-- 3. is_store_member deja de significar "cualquier fila = acceso total"
--
-- Esta función autoriza ~20 policies (catálogo, pedidos, pagos, branding,
-- UPDATE de stores, los tres policies de Storage) más el cuerpo de
-- `store_dashboard`. NO miraba el rol: alcanzaba con existir en la tabla.
--
-- Sobre los datos existentes el filtro nuevo es una TAUTOLOGÍA — el CHECK
-- anterior era `in ('owner','staff')`, así que ninguna fila que exista al
-- correr esta migración cambia de resultado. Riesgo hoy: cero. Lo que compra:
-- que el próximo rol que alguien invente no herede la tienda entera por defecto.
-- ---------------------------------------------------------------------------

create or replace function private.is_store_member(p_store_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.store_members m
     where m.store_id = p_store_id
       and m.user_id  = (select auth.uid())
       -- El repartidor NO es staff. Ver el comentario del bloque.
       and m.role in ('owner', 'staff')
  );
$$;

revoke execute on function private.is_store_member(bigint) from public, anon, authenticated;
grant  execute on function private.is_store_member(bigint) to authenticated;

create or replace function private.is_store_courier(p_store_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.store_members m
     where m.store_id = p_store_id
       and m.user_id  = (select auth.uid())
       and m.role     = 'courier'
       and m.is_active
  );
$$;

revoke execute on function private.is_store_courier(bigint) from public, anon, authenticated;
grant  execute on function private.is_store_courier(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. orders: método de entrega, dirección, envío y repartidor
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists delivery_method          text   not null default 'pickup',
  add column if not exists delivery_fee_cents       bigint not null default 0,
  add column if not exists delivery_address_line    text,
  add column if not exists delivery_address_unit    text,
  add column if not exists delivery_address_between text,
  add column if not exists delivery_address_notes   text,
  add column if not exists delivery_minutes         int,
  add column if not exists courier_id               bigint references public.store_members(id) on delete set null,
  add column if not exists assigned_at              timestamptz,
  add column if not exists on_the_way_at            timestamptz;

comment on column public.orders.delivery_minutes is
  'Minutos de viaje CONGELADOS que se sumaron al ETA. null para retiro.';
comment on column public.orders.courier_id is
  'ON DELETE SET NULL: borrar un repartidor perdería el rastro de quién llevó '
  'qué. Por eso la UI desactiva (is_active) y nunca borra.';

alter table public.orders
  add constraint orders_delivery_method_check
    check (delivery_method in ('pickup', 'delivery')),
  add constraint orders_delivery_fee_check
    check (delivery_fee_cents >= 0),
  -- Un delivery sin calle y número no se puede entregar.
  add constraint orders_delivery_needs_address_check
    check (delivery_method = 'pickup'
           or (delivery_address_line is not null and btrim(delivery_address_line) <> '')),
  -- Un retiro no tiene envío ni repartidor.
  add constraint orders_pickup_has_no_delivery_check
    check (delivery_method = 'delivery'
           or (delivery_fee_cents = 0 and courier_id is null));

-- EL CHECK QUE MÁS TRABAJA DE ESTA MIGRACIÓN.
--
-- Entra sin backfill: antes de esta feature `total_cents = subtotal_cents` en
-- TODAS las filas.
--
-- `public.create_order` ENUMERA las columnas del INSERT. Sin esta constraint,
-- que alguien agregue delivery al checkout y se olvide de pasar
-- `delivery_fee_cents` a la RPC inserta un delivery convertido en retiro, con
-- el envío regalado, sin dirección y SIN NINGÚN ERROR. Con ella, es un 23514
-- en el primer pedido de prueba.
alter table public.orders
  add constraint orders_total_is_subtotal_plus_delivery_check
    check (total_cents = subtotal_cents + delivery_fee_cents);

-- El CHECK de estados: `on_the_way` entre `ready` y `delivered`.
alter table public.orders drop constraint orders_status_check;
alter table public.orders
  add constraint orders_status_check
    check (status in ('pending', 'confirmed', 'preparing', 'ready',
                      'on_the_way', 'delivered', 'cancelled'));

-- `orders_active_idx` tiene predicado POSITIVO: si no se recrea, el KDS se
-- queda sin índice apenas `on_the_way` entra en ACTIVE_STATUSES. Y no falla:
-- sigue funcionando con seq scan hasta que la tabla crece.
--
-- (`orders_store_short_code_active_idx` y `private.next_short_code` tienen
-- predicado NEGATIVO —`status <> 'delivered' and status <> 'cancelled'`— así
-- que cubren `on_the_way` solos. No se tocan.)
drop index public.orders_active_idx;
create index orders_active_idx on public.orders (store_id, created_at)
  where status in ('confirmed', 'preparing', 'ready', 'on_the_way');

-- La cola del repartidor y el conteo de "repartidores libres".
create index orders_courier_open_idx on public.orders (courier_id, assigned_at)
  where courier_id is not null and status in ('ready', 'on_the_way');

-- `courier_id` NO entra en el grant de columnas de `orders`: el browser del
-- staff solo puede escribir `status`. La asignación va con `createAdminClient()`
-- detrás de `requireStoreMembership`, igual que `markPaidInStore`.


-- ---------------------------------------------------------------------------
-- 5. La máquina de estados con `on_the_way`
--
-- La función se reemplaza ENTERA, no se parchea. Un `create or replace` que se
-- olvide de la lista de columnas inmutables la borra sin decir nada: el trigger
-- sigue existiendo y deja pasar un `total_cents = 1`.
--
-- Misma tabla que ALLOWED_TRANSITIONS en src/models/schemas/order.schema.ts.
-- Si cambia una, cambia la otra: hay un test en tests/db/ que las compara.
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
  or new.created_at         is distinct from old.created_at then
    raise exception
      'el pedido % tiene columnas inmutables: store_id, public_token, idempotency_key, subtotal_cents, total_cents, currency, payment_method, delivery_method, delivery_fee_cents, created_at',
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
-- 6. on_the_way_at
--
-- Vale la pena aunque hoy no se lea en ningún lado: sin esta columna "cuándo
-- salió el pedido" es irrecuperable, y `delivered_at - on_the_way_at` es la
-- métrica que el dueño va a pedir apenas tenga tres repartidores.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_order_status_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'confirmed'  then new.confirmed_at  := coalesce(new.confirmed_at, now());
      when 'ready'      then new.ready_at      := coalesce(new.ready_at, now());
      when 'on_the_way' then new.on_the_way_at := coalesce(new.on_the_way_at, now());
      when 'delivered'  then new.delivered_at  := coalesce(new.delivered_at, now());
      when 'cancelled'  then new.cancelled_at  := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;

  if new.payment_status = 'approved' and old.payment_status is distinct from 'approved' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;

  return new;
end;
$$;

-- NO SE TOCAN, y decirlo explícitamente es parte de la migración:
--
--   private.order_is_billable  — su regla es `status not in ('pending','cancelled')`,
--     así que `on_the_way` ya cae del lado facturable. Es `immutable` y de ella
--     dependen store_dashboard, platform_metrics y platform_stores: un
--     `drop ... cascade` para "actualizarla" rompe las tres.
--   public.advance_auto_orders — el auto-listo sigue aplicando a un delivery:
--     que la cocina terminó es cierto igual. Lo que cambia es el AVISO al
--     cliente, y eso vive en TypeScript (dispatchReadyNotification).
--   public.expire_pending_orders — solo toca `status = 'pending'`.


-- ---------------------------------------------------------------------------
-- 7. create_order: el pedido nace con su método de entrega
--
-- La RPC ENUMERA las columnas del INSERT. Todo campo nuevo va acá o se pierde
-- en silencio — de ahí el CHECK del total en §4.
-- ---------------------------------------------------------------------------

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store_id bigint := (p_order ->> 'store_id')::bigint;
  v_key      text   := p_order ->> 'idempotency_key';
  v_order_id bigint;
  v_item     jsonb;
  v_item_id  bigint;
  v_option   jsonb;
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

  begin
    insert into public.orders (
      store_id, status, customer_name, customer_phone_e164, customer_email,
      idempotency_key, notes, currency, subtotal_cents, total_cents,
      base_prep_minutes, demand_multiplier, eta_minutes, eta_at,
      payment_method, payment_status,
      delivery_method, delivery_fee_cents, delivery_minutes,
      delivery_address_line, delivery_address_unit,
      delivery_address_between, delivery_address_notes
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
      p_order ->> 'delivery_address_notes'
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

revoke execute on function public.create_order(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order(jsonb, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 8. Las RPC del repartidor
--
-- EL REPARTIDOR NO TIENE NI UN GRANT NI UNA POLICY SOBRE `orders`. Ni SELECT.
--
-- El motivo es concreto: `grant update (status) on orders to authenticated` es
-- CIEGO AL ROL. Una policy que dejara al courier tocar sus pedidos le
-- habilitaría todo ALLOWED_TRANSITIONS[status], incluido `ready -> cancelled`.
-- Un repartidor cancelando pedidos es inaceptable, y frenarlo con RLS pediría
-- meter lógica de actor dentro de `enforce_order_rules`, que aplica a
-- service_role a propósito y no tiene por qué saber quién la llama.
--
-- Con RPC, el conjunto de transiciones del repartidor está enumerado en SQL y
-- tiene dos elementos.
--
-- Corolario, y es la trampa más engañosa de esta feature: REALTIME NO LE LLEGA
-- AL REPARTIDOR. La publicación es solo `public.orders` y Realtime respeta RLS,
-- así que el canal se suscribe, dice SUBSCRIBED y no dispara nunca. El portal
-- va con polling.
-- ---------------------------------------------------------------------------

create or replace function public.courier_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- SECURITY DEFINER en `public` = endpoint invocable por cualquier
  -- `authenticated`. El filtro es la propia identidad: solo salen pedidos cuyo
  -- courier_id apunta a una membresía ACTIVA de este usuario.
  select coalesce(jsonb_agg(t order by t."assignedAt"), '[]'::jsonb) into v_out
  from (
    select o.id                       as "orderId",
           o.short_code               as "shortCode",
           o.status,
           s.name                     as "storeName",
           o.customer_name            as "customerName",
           o.customer_phone_e164      as "customerPhoneE164",
           o.delivery_address_line    as "addressLine",
           o.delivery_address_unit    as "addressUnit",
           o.delivery_address_between as "addressBetween",
           o.delivery_address_notes   as "addressNotes",
           -- `assigned_at` lo sella el trigger en el UPDATE de asignación, que
           -- es el único camino de la app. El coalesce cubre el caso raro de un
           -- pedido nacido ya asignado: sin él la cola ordenaría por null y el
           -- repartidor vería el orden cambiar entre polls.
           coalesce(o.assigned_at, o.created_at) as "assignedAt",
           -- El desglose a cobrar SOLO existe si el local activó el cobro en la
           -- puerta Y el pedido es de pago en el local Y todavía no está pago.
           -- En cualquier otro caso los montos NO SALEN DE POSTGRES: no hay bug
           -- de TypeScript que pueda mostrar un número que la base nunca mandó.
           case when s.courier_collects_payment
                 and o.payment_method = 'in_store'
                 and o.payment_status <> 'approved'
                then jsonb_build_object(
                       'subtotalCents',    o.subtotal_cents,
                       'deliveryFeeCents', o.delivery_fee_cents,
                       'totalCents',       o.total_cents,
                       'currency',         o.currency)
                else null
           end                        as "collect"
      from public.orders o
      join public.stores s        on s.id = o.store_id
      join public.store_members m on m.id = o.courier_id
     where m.user_id = (select auth.uid())
       and m.role    = 'courier'
       and m.is_active
       and o.status in ('ready', 'on_the_way')
  ) t;

  return v_out;
end;
$$;

revoke execute on function public.courier_queue() from public, anon;
grant  execute on function public.courier_queue() to authenticated, service_role;


create or replace function public.courier_advance_order(
  p_order_id  bigint,
  p_status    text,
  p_collected boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order    public.orders%rowtype;
  v_collects boolean;
begin
  if p_status not in ('on_the_way', 'delivered') then
    raise exception 'el repartidor solo puede marcar en camino o entregado'
      using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.store_members m on m.id = o.courier_id
   where o.id      = p_order_id
     and m.user_id = (select auth.uid())
     and m.role    = 'courier'
     and m.is_active
   for update;

  if not found then
    raise exception 'este pedido no esta asignado a vos' using errcode = '42501';
  end if;

  -- Mismo criterio que `updateOrderStatus`: predicado de estado en el UPDATE
  -- para que una carrera devuelva cero filas en vez de pisar el cambio del
  -- mostrador. La legalidad de la transicion la sigue decidiendo
  -- `enforce_order_rules`; esta RPC solo acota qué destinos se pueden PEDIR.
  update public.orders
     set status = p_status
   where id = p_order_id and status = v_order.status;

  if not found then
    raise exception 'el pedido cambio de estado' using errcode = '40001';
  end if;

  if p_collected and p_status = 'delivered' then
    select s.courier_collects_payment into v_collects
      from public.stores s where s.id = v_order.store_id;

    -- El cobro se acepta solo si el local lo habilitó, el pedido es in_store y
    -- estaba pendiente. Si no, se ignora en silencio: no hay nada que cobrar.
    update public.orders
       set payment_status = 'approved',
           payment_ref    = 'courier'
     where id = p_order_id
       and v_collects
       and payment_method = 'in_store'
       and payment_status = 'pending';
  end if;
end;
$$;

revoke execute on function public.courier_advance_order(bigint, text, boolean) from public, anon;
grant  execute on function public.courier_advance_order(bigint, text, boolean) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. Gestión de repartidores (dueño) y disponibilidad (servidor)
--
-- `store_couriers` necesita `auth.users.last_sign_in_at` para distinguir
-- "invitado, sin entrar" de "activo", y eso solo lo puede leer una
-- SECURITY DEFINER — mismo caso que `owner_email` en `platform_stores`.
-- ---------------------------------------------------------------------------

create or replace function public.store_couriers(p_store_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not private.is_store_owner(p_store_id) then
    raise exception 'solo el dueno del local administra repartidores' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t order by t."displayName"), '[]'::jsonb) into v_out
  from (
    select m.id,
           m.user_id      as "userId",
           m.display_name as "displayName",
           u.email        as "email",
           m.is_active    as "isActive",
           m.invited_at   as "invitedAt",
           u.last_sign_in_at as "lastSignInAt",
           (select count(*)::int from public.orders o
             where o.courier_id = m.id and o.status in ('ready','on_the_way')) as "assignedOrders",
           (select count(*)::int from public.orders o
             where o.courier_id = m.id and o.status = 'on_the_way')            as "onTheWayOrders"
      from public.store_members m
      join auth.users u on u.id = m.user_id
     where m.store_id = p_store_id and m.role = 'courier'
  ) t;

  return v_out;
end;
$$;

revoke execute on function public.store_couriers(bigint) from public, anon;
grant  execute on function public.store_couriers(bigint) to authenticated, service_role;


create or replace function public.store_courier_availability(p_store_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- "libre" = repartidor activo SIN ningún pedido en `on_the_way`. Es
  -- literalmente la definición de producto de "todos están repartiendo".
  select jsonb_build_object(
    'activeCouriers', count(*)::int,
    'freeCouriers',   count(*) filter (
      where not exists (
        select 1 from public.orders o
         where o.courier_id = m.id and o.status = 'on_the_way'))::int)
    from public.store_members m
   where m.store_id = p_store_id and m.role = 'courier' and m.is_active;
$$;

-- Sin grant a `authenticated`: la llama el servidor en el camino de cotización
-- con el cliente admin, nunca el browser.
revoke execute on function public.store_courier_availability(bigint) from public, anon, authenticated;
grant  execute on function public.store_courier_availability(bigint) to service_role;


-- ---------------------------------------------------------------------------
-- 10. platform_stores: PASO 3 DE LA CASCADA
--
-- Enumera columnas una por una, no usa `select s.*`. Sin las siete nuevas, el
-- backoffice no crashea: muestra vacío para algo que TypeScript da por presente.
-- Es la razón documentada de las migraciones de auto_advance, links y
-- coordinates — esta es la cuarta vez.
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
             s.in_store_payment_enabled, s.min_order_cents,
             s.demand_threshold_orders, s.demand_multiplier,
             s.auto_start_orders, s.auto_ready_orders,
             s.instagram_handle, s.maps_url,
             s.rappi_url, s.pedidos_ya_url, s.uber_eats_url,
             s.latitude, s.longitude,
             s.delivery_enabled, s.delivery_fee_cents, s.delivery_free_from_cents,
             s.delivery_min_order_cents, s.delivery_minutes, s.delivery_busy_minutes,
             s.courier_collects_payment,
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


-- ---------------------------------------------------------------------------
-- 11. La plantilla del aviso "salió tu pedido"
--
-- Un pedido de delivery que pasa a `ready` NO le avisa nada al cliente: "tu
-- pedido está listo" significa "vení a buscarlo" y es falso. El aviso se corre
-- a `on_the_way`, y la guarda vive en `dispatchReadyNotification` (TypeScript),
-- que cubre de una los dos caminos a `ready`: el botón del KDS y el cron de
-- auto-listo.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_template_check;
alter table public.notifications
  add constraint notifications_template_check
    check (template in ('order_confirmed', 'order_ready', 'order_cancelled',
                        'order_receipt', 'order_on_the_way'));


-- ---------------------------------------------------------------------------
-- 12. Slugs reservados: `/repartidor`
--
-- El portal vive en `/repartidor`. Hoy un local con ese slug quedaría
-- inalcanzable (el segmento estático de Next gana sobre `[store]`); con la
-- iteración de subdominios ya decidida pasa a ser secuestro de ruta.
--
-- La lista está a propósito duplicada en RESERVED_SLUGS de platform.schema.ts:
-- la base garantiza que no entre, el schema hace que el mensaje se entienda.
-- Si se agrega uno, va en los dos lados.
-- ---------------------------------------------------------------------------

alter table public.stores drop constraint stores_slug_not_reserved_check;
alter table public.stores
  add constraint stores_slug_not_reserved_check check (
    slug not in (
      'admin','api','app','assets','auth','backoffice','blog','carrito','checkout',
      'dashboard','docs','envios','favicon','functions','graphql','health','help',
      'images','login','logout','manifest','mis-pedidos','new','nueva','pedido',
      'pedidos','public','realtime','repartidor','repartidores','rest','robots',
      'settings','sitemap','static','status','storage','support','www','_next'
    )
  );
