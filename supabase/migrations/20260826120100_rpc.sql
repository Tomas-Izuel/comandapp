-- Funciones de dominio expuestas por RPC
--
-- Dos motivos para que esto viva en SQL y no en TypeScript:
--
--   1. ATOMICIDAD. `createOrder` insertaba la cabecera, despues un insert por
--      item y despues las opciones, con un `delete` compensatorio en el catch.
--      Si el delete fallaba quedaba un pedido sin items en el KDS, y el trigger
--      del outbox ya habia publicado `order.created` de un pedido que despues
--      no existia.
--
--   2. AGREGACION. El dashboard y las metricas de plataforma se traian los
--      pedidos crudos y sumaban en TS. PostgREST corta cualquier respuesta en
--      `max_rows` (1000 por defecto) SIN ERROR: con mas de ~33 pedidos por dia
--      la facturacion que ve el dueno estaba mal y nadie se enteraba.
--
-- Todas viven en `public` porque PostgREST solo expone los schemas configurados,
-- y todas son SECURITY DEFINER porque necesitan leer mas de lo que ve el
-- llamador. Eso las convierte en endpoints publicos: Postgres le da EXECUTE a
-- PUBLIC por defecto a toda funcion nueva, asi que cada una revoca y vuelve a
-- otorgar explicitamente, y las que atienden a un usuario logueado verifican el
-- permiso EN EL CUERPO. Una SECURITY DEFINER sin ese chequeo es una fuga de
-- datos entre tiendas.

-- ---------------------------------------------------------------------------
-- Que cuenta como venta
--
-- Un pedido online abandonado en `pending` no es plata: el cliente nunca pago.
-- Antes se sumaba igual (el filtro era "todo lo que no este cancelado"), y como
-- los pending nunca expiraban, la facturacion se inflaba sola.
-- ---------------------------------------------------------------------------

create or replace function private.order_is_billable(
  p_payment_status text,
  p_payment_method text,
  p_status         text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_payment_status = 'approved'
      or (p_payment_method = 'in_store' and p_status not in ('pending','cancelled'));
$$;

-- ---------------------------------------------------------------------------
-- create_order — cabecera + items + opciones en UNA transaccion
--
-- Recibe el carrito YA VALORIZADO por el servidor. El precio se sigue
-- calculando en `priceCart()` (TypeScript, contra la base, filtrando por
-- store_id): esta funcion es un escritor transaccional, no una frontera de
-- confianza, y no la llama nunca nada que venga del browser sin pasar por ahi.
--
-- Devuelve el id del pedido. Si la clave de idempotencia ya creo uno, devuelve
-- ESE: el indice unico `orders_idempotency_idx` es el arbitro de la carrera y el
-- select previo solo ahorra el insert en el caso normal.
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
      payment_method, payment_status
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
      coalesce(p_order ->> 'payment_status', 'pending')
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
-- Outbox: claim atomico
--
-- Sin lock, dos ejecuciones del cron leian los mismos 50 eventos y entregaban
-- duplicado al POS del local. Y el `limit 50 order by created_at` con el filtro
-- de backoff aplicado despues, en la app, provocaba starvation: si los 50 mas
-- viejos estaban todos esperando (un POS caido), los eventos nuevos de las otras
-- tiendas no se procesaban nunca.
--
-- `for update skip locked` resuelve la concurrencia y el filtro de backoff se
-- aplica ACA, asi que el limit devuelve 50 eventos realmente entregables.
-- ---------------------------------------------------------------------------

create or replace function public.claim_order_events(
  p_limit         int default 50,
  p_max_attempts  int default 8,
  p_lock_seconds  int default 120
)
returns setof public.order_events
language sql
volatile
security definer
set search_path = ''
as $$
  update public.order_events e
     set locked_until = now() + (p_lock_seconds * interval '1 second')
   where e.id in (
     select c.id
       from public.order_events c
      where c.delivered_at is null
        and c.dead_at is null
        and c.attempts < p_max_attempts
        and (c.locked_until is null or c.locked_until < now())
        -- Backoff exponencial desde el ULTIMO intento, con techo de 30 min.
        and (
          c.last_attempt_at is null
          or c.last_attempt_at < now() - (least(power(2, c.attempts)::numeric * 30, 1800) * interval '1 second')
        )
      order by c.created_at
      limit p_limit
      for update skip locked
   )
  returning e.*;
$$;

revoke execute on function public.claim_order_events(int, int, int) from public, anon, authenticated;
grant  execute on function public.claim_order_events(int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Outbox: cerrar el intento
--
-- Un evento que agota los reintentos desaparecia del select sin marca ni
-- alerta: no habia forma de saber que se perdio. `dead_at` es la dead-letter.
-- ---------------------------------------------------------------------------

create or replace function public.settle_order_event(
  p_event_id     bigint,
  p_delivered    boolean,
  p_error        text default null,
  p_max_attempts int default 8
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.order_events e
     set attempts        = e.attempts + 1,
         last_attempt_at = now(),
         locked_until    = null,
         delivered_at    = case when p_delivered then now() else e.delivered_at end,
         last_error      = case when p_delivered then null else p_error end,
         dead_at         = case
                             when p_delivered then null
                             when e.attempts + 1 >= p_max_attempts then now()
                             else e.dead_at
                           end
   where e.id = p_event_id;
$$;

revoke execute on function public.settle_order_event(bigint, boolean, text, int) from public, anon, authenticated;
grant  execute on function public.settle_order_event(bigint, boolean, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Pedidos online abandonados
--
-- El pedido se crea antes de pagar y la preferencia de Mercado Pago no vencia,
-- asi que un `pending` quedaba vivo para siempre: ocupaba `short_code`, inflaba
-- la facturacion y aparecia en el historial como si fuera una venta.
-- ---------------------------------------------------------------------------

create or replace function public.expire_pending_orders(p_minutes int default 45)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with expired as (
    update public.orders o
       set status = 'cancelled'
     where o.payment_method = 'online'
       and o.payment_status = 'pending'
       and o.status = 'pending'
       and o.created_at < now() - (p_minutes * interval '1 minute')
       -- Nunca cancelar algo que tenga un pago aprobado registrado: si el
       -- webhook fallo pero la plata entro, lo resuelve la conciliacion.
       and not exists (
         select 1 from public.payments p
          where p.order_id = o.id and p.status = 'approved'
       )
    returning o.id
  )
  select count(*)::int into v_count from expired;

  return v_count;
end;
$$;

revoke execute on function public.expire_pending_orders(int) from public, anon, authenticated;
grant  execute on function public.expire_pending_orders(int) to service_role;

-- ---------------------------------------------------------------------------
-- Retencion
--
-- `order_events` y `platform_audit_log` crecian sin limite, y ninguno de los dos
-- sirve para nada despues de unos meses.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_old_records(
  p_event_days int default 30,
  p_audit_days int default 365
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_events int;
  v_audit  int;
begin
  with gone as (
    delete from public.order_events e
     where e.delivered_at is not null
       and e.delivered_at < now() - (p_event_days * interval '1 day')
    returning e.id
  )
  select count(*)::int into v_events from gone;

  with gone as (
    delete from public.platform_audit_log a
     where a.created_at < now() - (p_audit_days * interval '1 day')
    returning a.id
  )
  select count(*)::int into v_audit from gone;

  return jsonb_build_object('orderEvents', v_events, 'auditEntries', v_audit);
end;
$$;

revoke execute on function public.cleanup_old_records(int, int) from public, anon, authenticated;
grant  execute on function public.cleanup_old_records(int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Dashboard del local
--
-- Agrega en Postgres y agrupa por dia EN LA ZONA DEL LOCAL. Un pedido de las
-- 22:30 de Buenos Aires es 01:30Z del dia siguiente: agrupar en UTC le movia el
-- pico del viernes a la noche —el unico horario que importa— al sabado.
--
-- `ordersByStatus` devuelve solo los estados presentes; el enum completo con
-- ceros lo arma TypeScript, para que ORDER_STATUSES siga siendo la unica fuente.
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
    select coalesce(round(avg(extract(epoch from (s.ready_at - s.confirmed_at)) / 60)), 0)::int as real_min,
           coalesce(round(avg(s.eta_minutes)), 0)::int                                          as est_min,
           count(*)::int                                                                        as sample
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
-- Metricas de plataforma
--
-- "Hoy" se calcula en la zona de CADA tienda: la plataforma no tiene una zona
-- propia y sumar en UTC le corre el dia a todos los locales por igual.
-- ---------------------------------------------------------------------------

create or replace function public.platform_metrics()
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

  select jsonb_build_object(
    'totalStores',        (select count(*)::int from public.stores),
    'activeStores',       (select count(*)::int from public.stores where status = 'active'),
    'ordersLast30',       (select count(*)::int from public.orders o
                            where o.created_at >= now() - interval '30 days'
                              and private.order_is_billable(o.payment_status, o.payment_method, o.status)),
    'revenueLast30Cents', (select coalesce(sum(o.total_cents), 0)::bigint from public.orders o
                            where o.created_at >= now() - interval '30 days'
                              and private.order_is_billable(o.payment_status, o.payment_method, o.status)),
    'ordersToday',        (select count(*)::int
                             from public.orders o
                             join public.stores s on s.id = o.store_id
                            where (o.created_at at time zone s.timezone)::date
                                  = (now() at time zone s.timezone)::date)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.platform_metrics() from public, anon;
grant  execute on function public.platform_metrics() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Listado de tiendas del backoffice
--
-- Antes se traian todas las tiendas y despues un `auth.admin.getUserById` POR
-- DUENO, en serie. El email del dueno sale de `auth.users`, que solo una funcion
-- SECURITY DEFINER puede leer: por eso el join vive aca y no en la app.
--
-- `p_store_id` opcional: el detalle de una tienda cargaba la plataforma completa
-- para quedarse con una fila.
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
             s.demand_threshold_orders, s.demand_multiplier, s.created_at,
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
