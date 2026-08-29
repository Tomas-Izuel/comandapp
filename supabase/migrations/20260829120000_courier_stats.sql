-- Métricas por repartidor en el padrón del dueño
--
-- PASO 4 DE LA CASCADA (ver 20260828130000_delivery.sql §9): `store_couriers`
-- enumera columnas a mano, así que todo dato nuevo que el panel espera hay que
-- agregarlo acá. Sin esto el listado no crashea, muestra vacío — que es peor.
--
-- Las tres preguntas que el dueño hace al final del turno y que el padrón hoy
-- no contesta: cuánto repartió cada uno, cuánto tarda, y cuánta plata tiene en
-- el bolsillo. Las dos primeras son de gestión; la tercera es un arqueo de caja
-- y por eso se corta por el día del LOCAL, no por el del servidor.
--
-- Se calcula en la RPC y no en TypeScript por el mismo motivo que
-- `store_dashboard`: PostgREST corta en `max_rows` sin error, así que agregar
-- del lado de la app trunca en silencio apenas el local tenga historial.

-- El índice que ya existe (`orders_courier_open_idx`) es PARCIAL sobre los
-- pedidos abiertos: no sirve para nada de esto, que mira exactamente lo
-- contrario (los ya entregados). Este es su espejo.
create index if not exists orders_courier_delivered_idx
  on public.orders (courier_id, delivered_at desc)
  where courier_id is not null and delivered_at is not null;


create or replace function public.store_couriers(p_store_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_day_start timestamptz;
begin
  if not private.is_store_owner(p_store_id) then
    raise exception 'solo el dueno del local administra repartidores' using errcode = '42501';
  end if;

  -- "Hoy" es el día del LOCAL. Un turno de hamburguesería termina pasada la
  -- medianoche UTC: con `date_trunc('day', now())` a secas, la plata que el
  -- repartidor junta después de las 21 de Argentina cae en el día siguiente y
  -- el arqueo del cierre queda partido en dos.
  select date_trunc('day', now() at time zone s.timezone) at time zone s.timezone
    into v_day_start
    from public.stores s
   where s.id = p_store_id;

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
             where o.courier_id = m.id and o.status = 'on_the_way')            as "onTheWayOrders",
           st.deliveries_today      as "deliveriesToday",
           st.deliveries_30d        as "deliveries30d",
           st.avg_delivery_minutes  as "avgDeliveryMinutes",
           st.collected_today_cents as "collectedTodayCents",
           st.collected_30d_cents   as "collected30dCents"
      from public.store_members m
      join auth.users u on u.id = m.user_id
      -- Un solo barrido de los pedidos entregados de este repartidor, con
      -- `filter` para las ventanas. Cinco subconsultas correlacionadas serían
      -- cinco recorridos del mismo índice.
      left join lateral (
        select
          count(*) filter (where o.delivered_at >= v_day_start)::int                as deliveries_today,
          count(*) filter (where o.delivered_at >= now() - interval '30 days')::int as deliveries_30d,

          -- El viaje es `on_the_way -> delivered`, no `created -> delivered`:
          -- lo que se mide es al repartidor, no la demora de la cocina.
          -- Los pedidos sin `on_the_way_at` (los que el mostrador cerró a mano
          -- sin que nadie tocara el portal) quedan afuera del promedio en vez
          -- de contarse como cero minutos.
          round(avg(extract(epoch from (o.delivered_at - o.on_the_way_at)) / 60.0)
            filter (where o.on_the_way_at is not null
                      and o.delivered_at >= now() - interval '30 days'))::int       as avg_delivery_minutes,

          -- `payment_ref = 'courier'` lo escribe SOLO `courier_advance_order`
          -- cuando el repartidor marca entregado con cobro. Es plata que hoy
          -- está físicamente en su bolsillo: es el número del arqueo, no una
          -- métrica de ventas.
          coalesce(sum(o.total_cents) filter (
            where o.payment_ref = 'courier' and o.payment_status = 'approved'
              and o.delivered_at >= v_day_start), 0)::bigint                        as collected_today_cents,
          coalesce(sum(o.total_cents) filter (
            where o.payment_ref = 'courier' and o.payment_status = 'approved'
              and o.delivered_at >= now() - interval '30 days'), 0)::bigint         as collected_30d_cents
        from public.orders o
        where o.courier_id = m.id and o.delivered_at is not null
      ) st on true
     where m.store_id = p_store_id and m.role = 'courier'
  ) t;

  return v_out;
end;
$$;

-- `create or replace` conserva los privilegios, pero se repiten por la misma
-- razón que en el resto del repo: una `security definer` en `public` sin revoke
-- explícito es un endpoint abierto, y el archivo tiene que poder leerse solo.
revoke execute on function public.store_couriers(bigint) from public, anon;
grant  execute on function public.store_couriers(bigint) to authenticated, service_role;
