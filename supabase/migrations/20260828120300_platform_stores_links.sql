-- ---------------------------------------------------------------------------
-- `platform_stores` tiene que devolver tambien los links del local
--
-- Misma trampa que documenta 20260828120100_platform_stores_auto.sql, otra
-- vez: la RPC enumera columnas en vez de hacer `select s.*`, y
-- `PlatformStoreRow` extiende `Store`. Como `Store` ahora tiene `links`, una
-- RPC que no las devuelve obliga al modelo a rellenar cinco `null` — y esos
-- null no dicen "el local no cargo el link", dicen "la RPC no lo trajo". Dos
-- cosas distintas que se ven iguales, que es la mentira silenciosa que el
-- mapper unico existe para evitar.
--
-- Identica a la version anterior salvo por las cinco columnas.
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

-- Postgres le da EXECUTE a PUBLIC por defecto a toda funcion nueva, y
-- `create or replace` no conserva los grants de la anterior de forma que se
-- pueda dar por sentada: se vuelven a declarar, igual que en el resto de las
-- RPC de este schema.
revoke execute on function public.platform_stores(bigint) from public, anon;
grant  execute on function public.platform_stores(bigint) to authenticated, service_role;
