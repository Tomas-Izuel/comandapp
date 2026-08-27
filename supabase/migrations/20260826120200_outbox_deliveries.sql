-- Outbox: entrega por ENDPOINT, no por evento
--
-- El outbox marcaba entregado o fallido el evento entero. Si una tienda tiene
-- dos endpoints y uno se cae, el evento reintentaba completo y el POS que SI
-- habia respondido recibia el mismo pedido otra vez. Del otro lado eso es un
-- pedido duplicado en la cocina, que es plata.
--
-- Con una fila por (evento, endpoint) cada destino tiene su propio contador de
-- intentos, su propio backoff y su propia dead-letter. `order_events.delivered_at`
-- se sigue usando como "este evento ya no tiene nada pendiente", asi que la
-- retencion de `cleanup_old_records` no cambia.

create table public.order_event_deliveries (
  id              bigint generated always as identity primary key,
  event_id        bigint not null references public.order_events(id)  on delete cascade,
  endpoint_id     bigint not null references public.pos_endpoints(id) on delete cascade,
  -- Desnormalizado a proposito: la policy de staff y el agrupado por tienda del
  -- cron son mucho mas simples con la columna acá que con dos joins.
  store_id        bigint not null references public.stores(id) on delete cascade,

  attempts        int not null default 0,
  delivered_at    timestamptz,
  last_attempt_at timestamptz,
  last_error      text,
  locked_until    timestamptz,
  dead_at         timestamptz,
  created_at      timestamptz not null default now(),

  -- Un intento por destino y nada mas: es lo que hace idempotente el fan-out.
  unique (event_id, endpoint_id)
);

create index order_event_deliveries_pending_idx on public.order_event_deliveries (created_at)
  where delivered_at is null and dead_at is null;
create index order_event_deliveries_event_idx on public.order_event_deliveries (event_id);
create index order_event_deliveries_store_idx on public.order_event_deliveries (store_id, created_at)
  where delivered_at is null;

alter table public.order_event_deliveries enable row level security;

-- El staff lee el estado de entrega de su tienda: es lo que hace falta para
-- poder mostrar "hay N eventos sin entregar al POS" en el panel.
create policy order_event_deliveries_staff_read on public.order_event_deliveries
  for select to authenticated
  using ((select private.is_store_member(store_id)));

grant select on public.order_event_deliveries to authenticated;
revoke all  on public.order_event_deliveries from anon;

-- ---------------------------------------------------------------------------
-- Fan-out + claim en una sola llamada
--
-- El fan-out es perezoso (lo hace el cron, no un trigger) por dos motivos: un
-- endpoint que se da de alta despues igual recibe los eventos pendientes, y el
-- outbox no queda acoplado a `pos_endpoints` en el camino caliente del pedido.
--
-- Un evento al que ningun endpoint activo esta suscripto se marca entregado en
-- el momento: si no, se quedaria pendiente para siempre y ensuciaria la cola.
-- ---------------------------------------------------------------------------

-- El fan-out vive en su propia funcion y no dentro de la que hace el claim: una
-- funcion `returns table` declara sus columnas como variables de plpgsql, y esas
-- variables le hacen sombra a los nombres de columna en un `on conflict`. El
-- error que da ("column reference is ambiguous") solo aparece en runtime.
create or replace function private.fanout_event_deliveries()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Crear las filas de entrega que falten, para los endpoints activos que
  -- declaran interes en ese tipo de evento.
  insert into public.order_event_deliveries (event_id, endpoint_id, store_id)
  select e.id, p.id, e.store_id
    from public.order_events e
    join public.pos_endpoints p
      on p.store_id = e.store_id
     and p.is_active
     and e.type = any (p.events)
   where e.delivered_at is null
     and e.dead_at is null
  on conflict (event_id, endpoint_id) do nothing;

  -- Nadie escucha este evento: cerrarlo en vez de dejarlo dando vueltas.
  update public.order_events e
     set delivered_at = now(),
         last_error   = 'sin endpoints suscriptos'
   where e.delivered_at is null
     and e.dead_at is null
     and not exists (
       select 1 from public.order_event_deliveries d where d.event_id = e.id
     );
end;
$$;

revoke execute on function private.fanout_event_deliveries() from public, anon, authenticated;

create or replace function public.claim_event_deliveries(
  p_limit        int default 50,
  p_max_attempts int default 8,
  p_lock_seconds int default 120
)
returns table (
  delivery_id     bigint,
  event_id        bigint,
  store_id        bigint,
  order_id        bigint,
  endpoint_id     bigint,
  endpoint_url    text,
  endpoint_secret text,
  event_type      text,
  payload         jsonb,
  attempts        int,
  -- Cuando paso el evento, no cuando lo intentamos entregar. El POS del local
  -- necesita las dos: `x-burger-timestamp` es la fecha del intento (y sirve
  -- contra replay), esta es la del hecho.
  event_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.fanout_event_deliveries();

  -- Claim atomico. El backoff exponencial (30s → 30min, contado desde el
  --    ultimo intento) se aplica ACA: lo que sale de esta funcion es entregable.
  return query
  with claimed as (
    update public.order_event_deliveries d
       set locked_until = now() + (p_lock_seconds * interval '1 second')
     where d.id in (
       select c.id
         from public.order_event_deliveries c
        where c.delivered_at is null
          and c.dead_at is null
          and c.attempts < p_max_attempts
          and (c.locked_until is null or c.locked_until < now())
          and (
            c.last_attempt_at is null
            or c.last_attempt_at < now() - (least(power(2, c.attempts)::numeric * 30, 1800) * interval '1 second')
          )
        order by c.created_at
        limit p_limit
        for update skip locked
     )
    returning d.*
  )
  select c.id, c.event_id, c.store_id, e.order_id, c.endpoint_id,
         p.url, p.secret, e.type, e.payload, c.attempts, e.created_at
    from claimed c
    join public.order_events   e on e.id = c.event_id
    join public.pos_endpoints  p on p.id = c.endpoint_id
   order by c.created_at;
end;
$$;

revoke execute on function public.claim_event_deliveries(int, int, int) from public, anon, authenticated;
grant  execute on function public.claim_event_deliveries(int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Cerrar el intento de UN destino
--
-- Cuando el evento no tiene mas destinos pendientes, se marca entregado: es lo
-- que mantiene `order_events.delivered_at` como la vista de "ya esta" y lo que
-- permite que la purga por retencion siga funcionando sin cambios.
-- ---------------------------------------------------------------------------

create or replace function public.settle_event_delivery(
  p_delivery_id  bigint,
  p_delivered    boolean,
  p_error        text default null,
  p_max_attempts int default 8
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
begin
  update public.order_event_deliveries d
     set attempts        = d.attempts + 1,
         last_attempt_at = now(),
         locked_until    = null,
         delivered_at    = case when p_delivered then now() else d.delivered_at end,
         last_error      = case when p_delivered then null else p_error end,
         dead_at         = case
                             when p_delivered then null
                             when d.attempts + 1 >= p_max_attempts then now()
                             else d.dead_at
                           end
   where d.id = p_delivery_id
  returning d.event_id into v_event_id;

  if v_event_id is null then
    return;
  end if;

  update public.order_events e
     set delivered_at = now()
   where e.id = v_event_id
     and e.delivered_at is null
     and not exists (
       select 1
         from public.order_event_deliveries d
        where d.event_id = v_event_id
          and d.delivered_at is null
          and d.dead_at is null
     );
end;
$$;

revoke execute on function public.settle_event_delivery(bigint, boolean, text, int) from public, anon, authenticated;
grant  execute on function public.settle_event_delivery(bigint, boolean, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Retencion: las filas de entrega se van con su evento por el cascade, pero la
-- purga tiene que poder mirar tambien las que quedaron muertas.
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
  v_dead   int;
begin
  select count(*)::int into v_dead
    from public.order_event_deliveries d
   where d.dead_at is not null;

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

  -- `deadDeliveries` no se borra: es la unica evidencia de lo que el POS del
  -- local nunca recibio. Se devuelve para poder alertar.
  return jsonb_build_object('orderEvents', v_events, 'auditEntries', v_audit, 'deadDeliveries', v_dead);
end;
$$;

revoke execute on function public.cleanup_old_records(int, int) from public, anon, authenticated;
grant  execute on function public.cleanup_old_records(int, int) to service_role;
