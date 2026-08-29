-- ---------------------------------------------------------------------------
-- Rate limiting: contador compartido, atomico y multi-tenant
--
-- Los tres throttles que habia vivian en un `Map` de memoria de Node. El propio
-- codigo lo admitia ("es un parche", "mitigacion de desarrollo"): se pierden en
-- cada cold start y cada instancia de Vercel cuenta por su cuenta, asi que el
-- limite real era el limite por instancia multiplicado por la cantidad de
-- instancias, que es un numero que nadie controla.
--
-- Por que Postgres y no Redis: el repo ya tiene EXACTAMENTE este patron
-- funcionando en `store_pending_changes.attempts` + `claim_store_pending_change`,
-- con el comentario que explica por que el contador no puede vivir en memoria.
-- Upstash seria un vendor mas, dos secretos mas y una decision de fail-open por
-- llamada, para limitar caminos que corren decenas de veces por hora. La
-- respuesta cambiaria si hubiera que limitar el catalogo —lectura caliente—, y
-- por eso el catalogo queda del lado del WAF y no de esta tabla.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  bucket       text        not null,
  -- HMAC en hex, NUNCA el valor crudo. Los sujetos son email, telefono e IP:
  -- datos personales que no tienen por que quedar en claro en una tabla
  -- operativa que se consulta para depurar. El hash se calcula en la app, con
  -- una clave de entorno; aca solo entra el resultado.
  subject      text        not null,
  window_start timestamptz not null,
  count        int         not null default 0 check (count >= 0),

  -- PK compuesta: es la clave del upsert atomico de `consume_rate_limit`, y de
  -- paso es el unico indice que hace falta para leer.
  primary key (bucket, subject, window_start)
);

comment on table public.rate_limits is
  'Baldes de rate limiting. `subject` es un HMAC en hex, nunca el valor crudo.';

-- Solo para que el barrido diario no haga seq scan. La PK no sirve para esto:
-- empieza por `bucket`, y el borrado filtra unicamente por `window_start`.
create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Privilegios
--
-- Esta tabla no la toca NUNCA un browser. RLS prendida y SIN NINGUNA POLICY es
-- la postura correcta: sin policy, RLS niega todo, asi que aunque un GRANT se
-- filtre por error la tabla sigue devolviendo cero filas.
--
-- El `grant` a service_role es explicito y no confia en `alter default
-- privileges`: el bug que documenta `20260825120500_grants.sql` —service_role
-- TAMPOCO recibe privilegios sobre las tablas que crea una migracion— costo un
-- bloqueante entero. Bypassear RLS no sirve de nada si el GRANT no existe.
-- ---------------------------------------------------------------------------

alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- ---------------------------------------------------------------------------
-- consume_rate_limit
--
-- Existe por lo mismo que `claim_store_pending_change`: PostgREST no sabe
-- escribir `count = count + 1`. Hacerlo en la app seria leer, sumar y escribir,
-- y ese patron pierde la carrera exactamente en el caso que el contador tiene
-- que frenar — N requests simultaneas leen el mismo valor, todas escriben el
-- mismo +1, y el limite se vuelve infinito.
--
-- El incremento va en UNA sola sentencia (`insert ... on conflict do update`),
-- que Postgres resuelve tomando el lock de la fila: N llamadas concurrentes
-- dejan `count = N` exacto, sin transaccion explicita y sin `for update`.
--
-- `window_start` se calcula ADENTRO de la funcion, no lo manda el llamador: si
-- viniera de afuera, cualquiera que pueda invocarla elige una ventana nueva por
-- request y el limite deja de existir.
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_subject        text,
  p_window_seconds int,
  p_limit          int
)
returns table (allowed boolean, count int, retry_after_seconds int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        int;
begin
  if p_window_seconds <= 0 or p_limit < 0 then
    raise exception 'Parametros invalidos: la ventana debe ser positiva y el limite no negativo';
  end if;

  -- Ventanas fijas alineadas al epoch, no deslizantes. Una ventana deslizante
  -- necesitaria guardar cada evento en vez de un contador, y a cambio de mas
  -- precision daria una tabla que crece con el trafico. Para "cuantos mails en
  -- la ultima hora" el redondeo no cambia la decision.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as r (bucket, subject, window_start, count)
       values (p_bucket, p_subject, v_window_start, 1)
  on conflict (bucket, subject, window_start)
    do update set count = r.count + 1
    returning r.count into v_count;

  return query
    select v_count <= p_limit,
           v_count,
           -- Cuanto falta para que la ventana rote. Es lo que va en el header
           -- `Retry-After`: un 429 sin eso obliga a adivinar, y lo que hace un
           -- cliente que adivina es reintentar en loop.
           greatest(0, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds)) - now()))::int);
end;
$$;

revoke execute on function public.consume_rate_limit(text, text, int, int) from public, anon, authenticated;
grant  execute on function public.consume_rate_limit(text, text, int, int) to service_role;

comment on function public.consume_rate_limit(text, text, int, int) is
  'Incrementa un balde y dice si la llamada entra. `p_subject` es un HMAC, no el valor crudo.';

-- ---------------------------------------------------------------------------
-- Retencion
--
-- Se suma al barrido que ya existe en vez de agregar un cron nuevo. Un dia de
-- retencion alcanza de sobra: la ventana mas larga que usa la app es de horas,
-- y estas filas no son auditoria — nadie las va a leer despues.
--
-- Se re-declara la funcion COMPLETA porque `create or replace` reemplaza el
-- cuerpo entero: mantener los tres borrados anteriores no es opcional, y la
-- firma no cambia para no romper a quien ya la llama.
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
  v_limits  int;
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

  with gone as (
    delete from public.rate_limits l
     where l.window_start < now() - interval '1 day'
    returning l.bucket
  )
  select count(*)::int into v_limits from gone;

  return jsonb_build_object(
    'orderEvents',    v_events,
    'auditEntries',   v_audit,
    'pendingChanges', v_pending,
    'rateLimits',     v_limits
  );
end;
$$;

revoke execute on function public.cleanup_old_records(int, int) from public, anon, authenticated;
grant  execute on function public.cleanup_old_records(int, int) to service_role;
