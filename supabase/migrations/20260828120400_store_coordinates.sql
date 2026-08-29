-- ---------------------------------------------------------------------------
-- Coordenadas del local
--
-- `stores.address` es texto libre y no sirve para ubicar nada: para mostrar un
-- punto en el mapa —y mas adelante para calcular distancia de delivery— hace
-- falta la coordenada real, guardada.
--
-- Se guarda la que el DUENO confirma arrastrando el pin, no la que devuelve el
-- geocodificador: en direcciones argentinas (calles repetidas entre
-- localidades, numeraciones que el geocoder no conoce, barrios cerrados) el
-- resultado automatico cae a cuadras de distancia con frecuencia. El geocoder
-- solo propone el punto de partida.
--
-- numeric y no double precision: son datos de entrada humanos, no el resultado
-- de un calculo. 6 decimales dan ~11 cm, mucho mas de lo que hace falta para
-- la puerta de un local, y `numeric` no arrastra el error binario del float.
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists latitude  numeric(9,6),
  add column if not exists longitude numeric(10,6);

comment on column public.stores.latitude is
  'Latitud confirmada por el dueno arrastrando el pin. NULL = todavia no la fijo.';
comment on column public.stores.longitude is
  'Longitud confirmada por el dueno arrastrando el pin. NULL = todavia no la fijo.';

-- Rango real del planeta. Un typo de un digito (por ejemplo -314.18 en vez de
-- -31.418) tiene que rebotar en la base, no dibujar un pin en el vacio.
alter table public.stores
  drop constraint if exists stores_latitude_range_check,
  add  constraint stores_latitude_range_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  drop constraint if exists stores_longitude_range_check,
  add  constraint stores_longitude_range_check
    check (longitude is null or (longitude >= -180 and longitude <= 180));

-- Las dos van juntas o no van: media coordenada no ubica nada, y un mapa que
-- recibe `lat` sin `lon` es un bug silencioso en la vista.
alter table public.stores
  drop constraint if exists stores_coordinates_both_or_neither_check,
  add  constraint stores_coordinates_both_or_neither_check
    check ((latitude is null) = (longitude is null));

-- Los grants de `stores` son POR COLUMNA (20260826120000_hardening.sql, seccion
-- 13): una columna nueva NO queda escribible sola.
grant update (latitude, longitude) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- `platform_stores` enumera columnas
--
-- `PlatformStoreRow` extiende `Store`, asi que las columnas nuevas pasan a ser
-- parte del tipo y la RPC tiene que devolverlas o TypeScript las da por
-- presentes y en runtime son `undefined`.
--
-- Esta version parte de 20260828120300 (links del dock) y le suma lat/lon: no
-- se revierte nada de lo anterior.
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
