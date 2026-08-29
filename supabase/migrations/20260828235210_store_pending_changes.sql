-- Confirmacion por mail para los cambios que tocan plata
--
-- Cambiar el access token de Mercado Pago de un local redirige TODOS sus cobros
-- online a otra cuenta, y `stores.courier_collects_payment` decide si el
-- repartidor cobra en la puerta. Hasta ahora la unica guardia de los dos era
-- tener la sesion abierta: una tablet olvidada en el mostrador alcanzaba.
--
-- Esta tabla es el estado intermedio de "lo pediste, falta que lo confirmes con
-- el codigo que te mando al mail". El mail sale SIEMPRE a la direccion del
-- dueno en `auth.users`, nunca a una que venga en el request: eso es lo que
-- hace que una sesion robada no pueda redirigirse el codigo.

create table public.store_pending_changes (
  id           bigint generated always as identity primary key,
  store_id     bigint not null references public.stores(id) on delete cascade,

  -- Quien lo pidio. La confirmacion exige el MISMO usuario: si un local tiene
  -- dos duenos, el codigo le llego a uno solo y es ese el que confirma.
  requested_by uuid   not null references auth.users(id) on delete cascade,

  kind         text   not null
    check (kind in ('payment_credentials', 'courier_payment_policy')),

  -- El cambio pendiente. Los secretos entran YA cifrados con AES-256-GCM desde
  -- la app (`encryptSecret`): que la fila sea transitoria no es una excusa para
  -- dejar un token de cobro en claro, porque un pg_dump no distingue.
  payload      jsonb  not null,

  -- HMAC-SHA256 del codigo con CREDENTIALS_ENCRYPTION_KEY, nunca el codigo.
  -- HMAC y no un SHA pelado: sin la clave, un dump no permite ir del hash al
  -- codigo probando el millon de valores de 6 digitos.
  code_hash    text   not null,

  -- El limite de fuerza bruta vive ACA y no en memoria del proceso Node: el
  -- throttle en memoria del magic link (`admin.actions.ts`) se pierde en cada
  -- cold start y no lo comparten las instancias de Vercel. Un contador que se
  -- reinicia solo no es un limite.
  attempts     int    not null default 0 check (attempts >= 0),

  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- La consulta caliente es "el pendiente vivo de esta tienda para este tipo de
-- cambio", para invalidarlo cuando se pide uno nuevo. Parcial: las filas ya
-- consumidas son la mayoria y no se buscan nunca por este camino.
create index store_pending_changes_live_idx
  on public.store_pending_changes (store_id, kind)
  where consumed_at is null;

-- Indice en toda FK (convencion del repo): sin este, borrar un usuario obliga a
-- un seq scan de la tabla entera para validar el on delete cascade.
create index store_pending_changes_requested_by_idx
  on public.store_pending_changes (requested_by);

alter table public.store_pending_changes enable row level security;

-- Sin policies A PROPOSITO, igual que `store_payment_credentials`: la unica
-- forma de tocar esta tabla es `service_role` (que bypassea RLS) detras de un
-- `requireStoreMembership(id, { role: 'owner' })` explicito en el servidor.
--
-- Si el browser del staff pudiera leerla, `attempts` y `expires_at` serian
-- decorativos: con la publishable key se le pega a PostgREST directo y se lee
-- el `code_hash` de todos los locales.
revoke all on public.store_pending_changes from anon, authenticated;

-- `alter default privileges ... to service_role` de 20260825120500_grants.sql
-- ya deberia cubrir esta tabla, pero se repite explicito porque el modo de
-- falla es el bug bloqueante que documenta ese archivo: sin el grant,
-- `service_role` recibe 42501 permission denied aunque bypassee RLS, y el
-- sintoma no menciona los privilegios en ningun lado.
grant select, insert, update, delete on public.store_pending_changes to service_role;

-- ---------------------------------------------------------------------------
-- Retencion
--
-- Cada fila carga un token de Mercado Pago cifrado. Vencen a los 10 minutos,
-- asi que despues de un dia no queda nada que confirmar: lo unico que hacen es
-- acumular material cifrado esperando a que la clave se filtre.
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
  v_events  int;
  v_audit   int;
  v_pending int;
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

  with gone as (
    delete from public.store_pending_changes c
     where c.created_at < now() - interval '1 day'
    returning c.id
  )
  select count(*)::int into v_pending from gone;

  return jsonb_build_object(
    'orderEvents',    v_events,
    'auditEntries',   v_audit,
    'pendingChanges', v_pending
  );
end;
$$;

-- `create or replace` NO conserva los grants cuando cambia la firma, y aunque
-- aca la firma es la misma, Postgres le da EXECUTE a PUBLIC por defecto a toda
-- funcion. Una `security definer` en `public` sin revoke es un endpoint abierto.
revoke execute on function public.cleanup_old_records(int, int) from public, anon, authenticated;
grant  execute on function public.cleanup_old_records(int, int) to service_role;

-- ---------------------------------------------------------------------------
-- claim_store_pending_change
--
-- Existe por una sola razon: PostgREST no sabe escribir `attempts = attempts +
-- 1`. Solo asigna constantes, asi que el incremento en la app seria leer, sumar
-- y escribir — y ese patron pierde la carrera exactamente en el caso que el
-- contador tiene que frenar. Cinco requests en paralelo leen `attempts = 0`,
-- todos escriben `1`, y el limite de 5 intentos se vuelve infinito.
--
-- El codigo NO se compara aca: la funcion devuelve el `code_hash` y la
-- comparacion la hace Node con `timingSafeEqual`. El `=` de texto de Postgres
-- corta en el primer byte distinto.
--
-- Devuelve cero filas cuando la solicitud esta vencida, ya consumida o sin
-- intentos. Los tres casos son indistinguibles a proposito: distinguirlos le
-- dice a quien esta sondeando en que estado quedo la solicitud.
-- ---------------------------------------------------------------------------

create or replace function public.claim_store_pending_change(
  p_id       bigint,
  p_store_id bigint,
  p_user_id  uuid
)
returns table (kind text, payload jsonb, code_hash text, attempts int)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.store_pending_changes c
     set attempts = c.attempts + 1
   where c.id = p_id
     and c.store_id = p_store_id
     and c.requested_by = p_user_id
     and c.consumed_at is null
     and c.expires_at > now()
     and c.attempts < 5
  returning c.kind, c.payload, c.code_hash, c.attempts;
$$;

-- Postgres le da EXECUTE a PUBLIC por defecto a toda funcion nueva, asi que una
-- `security definer` en `public` sin este revoke es un endpoint abierto: con la
-- publishable key, cualquiera podria quemar los intentos de cualquier local.
revoke execute on function public.claim_store_pending_change(bigint, bigint, uuid)
  from public, anon, authenticated;
grant  execute on function public.claim_store_pending_change(bigint, bigint, uuid)
  to service_role;
