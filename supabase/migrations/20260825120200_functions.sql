-- Funciones de dominio y triggers

-- ---------------------------------------------------------------------------
-- Membresía (usada por todas las policies de staff)
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
      and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_store_member(bigint) from public, anon, authenticated;
grant  execute on function private.is_store_member(bigint) to authenticated;

create or replace function private.is_store_owner(p_store_id bigint)
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
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke execute on function private.is_store_owner(bigint) from public, anon, authenticated;
grant  execute on function private.is_store_owner(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- Plataforma: admin del SaaS
--
-- Exige DOS cosas: estar en platform_admins y tener aal2 (TOTP verificado en
-- esta sesion). Poner el aal2 aca -- y no en la pantalla de login -- es lo que
-- cierra el atajo de pedir un magic link para saltear el segundo factor.
-- ---------------------------------------------------------------------------

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from public.platform_admins a
      where a.user_id = (select auth.uid())
    );
$$;

revoke execute on function private.is_platform_admin() from public, anon, authenticated;
grant  execute on function private.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Codigo corto de mostrador: 4 caracteres, unico entre los pedidos activos
-- ---------------------------------------------------------------------------

create or replace function private.next_short_code(p_store_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
  attempt   int := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := upper(private.random_token(4));

    if not exists (
      select 1 from public.orders o
      where o.store_id = p_store_id
        and o.short_code = candidate
        and o.status not in ('delivered', 'cancelled')
    ) then
      return candidate;
    end if;

    -- Con ~923k combinaciones esto no debería pasar nunca; el fallback
    -- garantiza que jamás entremos en un bucle infinito.
    if attempt >= 20 then
      return upper(private.random_token(6));
    end if;
  end loop;
end;
$$;

revoke execute on function private.next_short_code(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Multiplicador de demanda
--
-- Cuenta los pedidos activos de la tienda (pagados y todavía no entregados).
-- Si llegan al umbral configurado, el tiempo base de preparación se multiplica.
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
    and o.status in ('confirmed', 'preparing');
$$;

revoke execute on function private.active_order_count(bigint) from public, anon, authenticated;

create or replace function private.estimate_eta(
  p_store_id     bigint,
  p_base_minutes int
)
returns table (
  base_minutes  int,
  multiplier    numeric,
  eta_minutes   int,
  active_orders int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s      public.stores%rowtype;
  active int;
  mult   numeric;
begin
  select * into s from public.stores where id = p_store_id;
  if not found then
    raise exception 'store % not found', p_store_id;
  end if;

  active := private.active_order_count(p_store_id);
  mult   := case when active >= s.demand_threshold_orders then s.demand_multiplier else 1.0 end;

  return query select
    p_base_minutes,
    mult,
    ceil(p_base_minutes * mult)::int,
    active;
end;
$$;

revoke execute on function private.estimate_eta(bigint, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bitácora automática de cambios de estado (alimenta el outbox)
-- ---------------------------------------------------------------------------

create or replace function private.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.created',
            jsonb_build_object('status', new.status, 'total_cents', new.total_cents));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.payment_status = 'approved' and old.payment_status is distinct from 'approved' then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.paid',
            jsonb_build_object('payment_ref', new.payment_ref, 'total_cents', new.total_cents));
  end if;

  return new;
end;
$$;

create trigger orders_log_created
  after insert on public.orders
  for each row execute function private.log_order_status_change();

create trigger orders_log_status_change
  after update on public.orders
  for each row execute function private.log_order_status_change();

-- Marcas de tiempo por estado, para no depender de que la app las setee.
create or replace function private.stamp_order_status_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'ready'     then new.ready_at     := coalesce(new.ready_at, now());
      when 'delivered' then new.delivered_at := coalesce(new.delivered_at, now());
      when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;

  if new.payment_status = 'approved' and old.payment_status is distinct from 'approved' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;

  return new;
end;
$$;

create trigger orders_stamp_status_times
  before update on public.orders
  for each row execute function private.stamp_order_status_times();

-- Asigna el código de mostrador si la app no lo provee.
create or replace function private.assign_short_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.short_code is null or btrim(new.short_code) = '' then
    new.short_code := private.next_short_code(new.store_id);
  end if;
  return new;
end;
$$;

create trigger orders_assign_short_code
  before insert on public.orders
  for each row execute function private.assign_short_code();
