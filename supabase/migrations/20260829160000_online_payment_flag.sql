-- ---------------------------------------------------------------------------
-- Cobro online: un flag que el storefront PUEDE leer
--
-- Hasta acá, "¿esta tienda puede cobrar online?" solo se podía responder
-- leyendo `store_payment_credentials`, y esa tabla no tiene un solo grant para
-- `anon` ni `authenticated` a propósito (ahí vive el access token de Mercado
-- Pago, cifrado). O sea: la vitrina no tenía forma de saberlo, y le ofrecía
-- "Pagar ahora online" a cualquiera. El cliente armaba el pedido, tocaba
-- pagar, y recién ahí —después de dejar sus datos— se comía un 409
-- "Esta tienda todavía no conectó Mercado Pago" que no puede resolver.
--
-- La respuesta NO es que el storefront lea las credenciales con el cliente
-- admin: es un dato derivado y binario ("hay token o no hay token") que no
-- necesita arrastrar el secreto hasta el borde para contestarse. Vive como
-- columna en `stores`, que ya es pública para `anon` vía RLS, y la mantiene un
-- trigger sobre la tabla de credenciales. La fuente de verdad sigue siendo una
-- sola: el token.
--
-- Sin grant de UPDATE para `authenticated`, igual que `status` y `slug`: es
-- derivado, no configurable. Un dueño que lo pusiera en `true` por PostgREST
-- solo lograría que sus clientes elijan un medio de pago que va a fallar.
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists online_payment_enabled boolean not null default false;

comment on column public.stores.online_payment_enabled is
  'Derivado de store_payment_credentials.access_token por private.sync_store_online_payment(). No se escribe a mano.';


create or replace function private.sync_store_online_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.stores
       set online_payment_enabled = false
     where id = old.store_id;
    return old;
  end if;

  -- `''` cuenta como "sin conectar": un token vacío es tan inútil como un null
  -- y el formulario de `/admin/pagos` puede dejarlo así al limpiar el campo.
  update public.stores
     set online_payment_enabled = (new.access_token is not null and new.access_token <> '')
   where id = new.store_id;

  return new;
end;
$$;

comment on function private.sync_store_online_payment() is
  'Mantiene stores.online_payment_enabled en sync con el access token de Mercado Pago.';

drop trigger if exists store_payment_credentials_sync_store on public.store_payment_credentials;

create trigger store_payment_credentials_sync_store
  after insert or update of access_token or delete on public.store_payment_credentials
  for each row execute function private.sync_store_online_payment();


-- Backfill: las tiendas ya conectadas tienen que quedar en `true` sin que
-- nadie vuelva a guardar el formulario de pagos.
update public.stores s
   set online_payment_enabled = true
  from public.store_payment_credentials c
 where c.store_id = s.id
   and c.access_token is not null
   and c.access_token <> ''
   and s.online_payment_enabled is distinct from true;


-- ---------------------------------------------------------------------------
-- `platform_stores()` — quinta reescritura completa (ver la nota de
-- 20260828130000_delivery.sql §10: no hay `create or replace` parcial de un
-- SELECT, así que la función se copia entera y se le suma la columna).
--
-- El backoffice necesita este dato más que nadie: una tienda activa que no
-- conectó Mercado Pago y no habilitó pago al retirar no puede vender NADA, y
-- hasta acá eso solo se notaba porque no entraban pedidos.
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
