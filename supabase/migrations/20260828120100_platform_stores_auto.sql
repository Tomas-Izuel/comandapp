-- ---------------------------------------------------------------------------
-- `platform_stores` enumera columnas, no hace `select s.*`
--
-- `PlatformStoreRow` extiende `Store`, asi que las dos columnas nuevas de
-- automatizacion pasaron a ser parte del tipo. Si la RPC no las devuelve,
-- TypeScript las da por presentes y en runtime son `undefined`: una mentira
-- silenciosa, que es exactamente la clase de bug que el mapper unico de
-- `store.mapper.ts` existe para evitar.
--
-- Identica a la version de 20260826120100_rpc.sql salvo por los dos campos.
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
