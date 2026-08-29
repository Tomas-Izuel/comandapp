-- ---------------------------------------------------------------------------
-- El scheduling se muda de Vercel Cron a Postgres
--
-- Vercel Cron NO puede correr estos barridos en el plan Hobby. De la doc,
-- textual: "Hobby accounts are limited to daily cron jobs. This cron expression
-- would run more than once per day", y el efecto no es que corran lento — el
-- DEPLOY FALLA. `vercel.json` declaraba tres expresiones sub-diarias, asi que
-- hoy el proyecto directamente no despliega en Hobby.
--
-- Bajar los tres a una vez por dia no era una opcion: rompe el producto.
--   auto-advance  la automatizacion de cocina deja de existir.
--   reconcile     es la UNICA red cuando se pierde el webhook de Mercado Pago.
--                 El cliente pago y la cocina se entera al otro dia.
--   outbox        el POS del local recibe los pedidos al otro dia.
--
-- pg_cron corre adentro de la base, no tiene limite de plan, y el proyecto vive
-- en la misma region que las funciones (sa-east-1 / gru1). Los endpoints NO
-- cambian: siguen siendo los mismos handlers `GET` con `CRON_SECRET`, asi que
-- volver a Vercel Cron el dia que se pase a Pro es borrar los schedules de aca
-- y devolver las entradas a `vercel.json`.
--
-- `cleanup` se queda en `vercel.json`: es diario, o sea legal en Hobby, y no
-- tiene ninguna urgencia que justifique moverlo.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
-- Ojo: pg_net crea SIEMPRE su propio schema `net` y ahi viven `http_get` /
-- `http_post`, sin importar el `with schema` que se le pase. Llamarlas como
-- `extensions.http_get` da 'function does not exist' (verificado).
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Configuracion: sale de Vault, no de la migracion
--
-- La URL del deploy y `CRON_SECRET` son distintas por entorno y una de las dos
-- es un secreto. Committearlas seria publicar la llave de los endpoints en el
-- repo. Van en Vault y esta migracion solo declara COMO se leen; cargarlas es
-- un paso operativo por entorno (ver README de deploy).
-- ---------------------------------------------------------------------------

create or replace function private.cron_secret_value(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  select decrypted_secret into v_value
    from vault.decrypted_secrets
   where name = p_name;

  -- Fallar fuerte y nombrando la clave que falta. La alternativa —devolver
  -- null— arma la URL 'null/api/cron/outbox', que sale como un 404 en
  -- `net._http_response` y no menciona Vault en ningun lado.
  if v_value is null or v_value = '' then
    raise exception 'Falta el secreto % en Vault. Los crons de Postgres no pueden invocar la app sin el.', p_name;
  end if;

  return v_value;
end;
$$;

revoke execute on function private.cron_secret_value(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- El invocador
--
-- `net.http_get` es ASINCRONO: encola el pedido y vuelve enseguida, asi que
-- esta funcion nunca ve el status code. Es aceptable y no es descuido: los tres
-- handlers son idempotentes y el proximo tick reintenta lo que haya quedado
-- pendiente —el outbox tiene `attempts`, la conciliacion re-lee el estado en
-- Mercado Pago—. Lo que se pierde es el diagnostico inmediato, y por eso se
-- guarda el id: la respuesta real queda en `net._http_response`, que es donde
-- hay que mirar cuando un barrido "no hizo nada".
-- ---------------------------------------------------------------------------

create or replace function private.invoke_app_cron(p_path text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_id bigint;
begin
  select net.http_get(
           url     => rtrim(private.cron_secret_value('app_base_url'), '/') || p_path,
           headers => jsonb_build_object(
             'Authorization', 'Bearer ' || private.cron_secret_value('cron_secret')
           ),
           -- Generoso a proposito: un barrido de outbox con varios endpoints
           -- POS lentos no tiene que quedar cortado a la mitad. El handler
           -- igual es idempotente si se corta.
           timeout_milliseconds => 60000
         )
    into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function private.invoke_app_cron(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Los schedules
--
-- Mismas frecuencias que tenia `vercel.json`. `cron.schedule` con nombre es un
-- upsert: correr esta migracion de nuevo reemplaza el job, no lo duplica.
--
-- Los nombres llevan prefijo `app-` para distinguirlos de cualquier job que
-- agregue Supabase o una extension.
-- ---------------------------------------------------------------------------

select cron.schedule('app-outbox',       '*/2 * * * *',  $job$ select private.invoke_app_cron('/api/cron/outbox'); $job$);
select cron.schedule('app-reconcile',    '*/10 * * * *', $job$ select private.invoke_app_cron('/api/cron/reconcile'); $job$);
select cron.schedule('app-auto-advance', '*/2 * * * *',  $job$ select private.invoke_app_cron('/api/cron/auto-advance'); $job$);

comment on function private.invoke_app_cron(text) is
  'Invoca un handler de /api/cron/* con CRON_SECRET. Lo llaman los jobs de pg_cron.';
