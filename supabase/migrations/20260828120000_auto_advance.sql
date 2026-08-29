-- ---------------------------------------------------------------------------
-- Automatizacion de estados de cocina, opt-in por tienda
--
-- Dos preferencias del local, APAGADAS por defecto: un local que no opta se
-- comporta exactamente como hasta ahora.
--
--   auto_start_orders   confirmed -> preparing apenas se confirma
--   auto_ready_orders   preparing -> ready cuando se cumple el ETA congelado
--
-- No hay auto-entregado ni auto-cobrado: la automatizacion termina en 'ready'.
-- `ready -> delivered` sigue pidiendo una persona y, con pago en el local,
-- sigue exigiendo cobrar primero. El reloj del dinero no se automatiza.
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists auto_start_orders boolean not null default false,
  add column if not exists auto_ready_orders boolean not null default false;

comment on column public.stores.auto_start_orders is
  'El pedido pasa a preparing solo, sin que nadie toque el panel.';
comment on column public.stores.auto_ready_orders is
  'El pedido pasa a ready solo al cumplirse eta_at. Dispara el aviso al cliente.';

-- Los grants de `stores` son POR COLUMNA (ver 20260826120000_hardening.sql,
-- seccion 13): una columna nueva NO queda escribible sola. Sin esta linea el
-- dueno guarda el toggle y le vuelve `permission denied` sin que nada en el
-- formulario lo explique.
grant update (auto_start_orders, auto_ready_orders) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- El barrido
--
-- Una sola pasada para las dos automatizaciones. La alternativa era un trigger
-- para el auto-comenzar (instantaneo, y atrapa los cuatro caminos que llevan a
-- 'confirmed': webhook, conciliacion, alta con pago en el local y boton del
-- staff) mas un cron para el auto-listo. Se descarto: la unica ventaja del
-- trigger es la instantaneidad, y aca nadie la necesita —el sentido de la
-- funcion es que no hay nadie mirando— a cambio de dos mecanismos, dos modos
-- de falla y una mutacion de estado disparada desde adentro de otra
-- transaccion. El peor caso del barrido es dos minutos de demora.
--
-- Las dos transiciones son legales para `private.enforce_order_rules`, que
-- aplica tambien a service_role: un bug en un WHERE rebota en la base en vez
-- de corromper un pedido.
-- ---------------------------------------------------------------------------

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

revoke execute on function public.advance_auto_orders() from public, anon, authenticated;
grant  execute on function public.advance_auto_orders() to service_role;
