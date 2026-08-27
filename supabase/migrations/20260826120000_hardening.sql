-- Hardening: lo que la app creia que Postgres impedia y no impedia.
--
-- La auditoria del 2026-08-26 encontro que las reglas de negocio del pedido
-- vivian SOLO en TypeScript mientras `authenticated` tenia grant de UPDATE
-- sobre la tabla entera. Con la publishable key y una sesion de staff, un
-- `PATCH /rest/v1/orders` saltea `canTransition`, la regla de "online impago no
-- confirma" y hasta reescribe `total_cents`. Verificado a mano contra el stack
-- local: devolvia 1 fila.
--
-- El modelo declarado es "RLS es la autorizacion real". Esta migracion lo hace
-- cierto: mueve las invariantes a grants por columna, CHECKs y triggers.

-- ---------------------------------------------------------------------------
-- 1. Token publico del pedido: CSPRNG, no random()
--
-- `random()` es xoroshiro128**, un PRNG deterministico que la doc de Postgres
-- marca explicitamente como no apto para criptografia. El `public_token` es la
-- UNICA credencial de un pedido, y los `short_code` (mismo generador) se cantan
-- en el mostrador: hay salidas publicas del PRNG. Los "~119 bits" del diseno
-- son de espacio, no de entropia.
--
-- pgcrypto ya estaba instalado y sin usar para esto.
-- ---------------------------------------------------------------------------

create or replace function private.random_token(len int default 24)
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  alpha_len constant int := 31;
  -- 248 = 8 * 31 es el multiplo de 31 mas grande que entra en un byte. Descartar
  -- los bytes >= 248 elimina el sesgo del modulo: sin eso los primeros 8
  -- caracteres del alfabeto saldrian mas seguido que los ultimos.
  cutoff   constant int := 248;
  out_text text := '';
  chunk    bytea;
  i        int;
  b        int;
begin
  if len < 1 then
    raise exception 'largo de token invalido: %', len;
  end if;

  while length(out_text) < len loop
    chunk := extensions.gen_random_bytes(len * 2);
    for i in 0 .. octet_length(chunk) - 1 loop
      exit when length(out_text) >= len;
      b := get_byte(chunk, i);
      if b < cutoff then
        out_text := out_text || substr(alphabet, 1 + (b % alpha_len), 1);
      end if;
    end loop;
  end loop;

  return out_text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. orders: short_code NOT NULL
--
-- El trigger `orders_assign_short_code` (BEFORE INSERT) ya lo garantiza, pero
-- la columna era nullable y eso obligaba a un `row.short_code ?? ''` en cada
-- mapper del modelo. Los BEFORE triggers corren antes del chequeo de NOT NULL,
-- asi que la constraint es segura.
-- ---------------------------------------------------------------------------

update public.orders
   set short_code = private.next_short_code(store_id)
 where short_code is null or btrim(short_code) = '';

alter table public.orders alter column short_code set not null;

-- ---------------------------------------------------------------------------
-- 3. orders: seguimiento del reembolso pendiente
--
-- Cancelar un pedido ya pago no reembolsaba nada ni dejaba rastro, y un pago
-- que llegaba tarde aprobaba un pedido cancelado. Estas columnas son la cola de
-- "plata que hay que devolver" que el backoffice tiene que poder mirar.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists needs_refund_at timestamptz,
  add column if not exists refund_reason   text,
  add column if not exists refunded_at     timestamptz;

create index orders_needs_refund_idx on public.orders (store_id, needs_refund_at)
  where needs_refund_at is not null and refunded_at is null;

-- Cola de conciliacion: pedidos online que quedaron esperando el webhook.
create index orders_pending_online_idx on public.orders (created_at)
  where payment_method = 'online' and payment_status = 'pending' and status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. payments: tienda, moneda, entorno y estados acotados
--
-- `store_id` es lo que permite verificar que el pago que confirma un webhook
-- pertenece a la tienda cuyas credenciales firmaron la notificacion. Sin eso,
-- el dueno de la tienda A podia pagar $1 con SU cuenta de Mercado Pago usando
-- como `external_reference` el token de un pedido de la tienda B y dejarlo
-- confirmado.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists store_id  bigint references public.stores(id) on delete cascade,
  add column if not exists currency  text,
  add column if not exists live_mode boolean;

update public.payments p
   set store_id = o.store_id
  from public.orders o
 where o.id = p.order_id and p.store_id is null;

alter table public.payments alter column store_id set not null;

create index payments_store_created_idx on public.payments (store_id, created_at desc);

alter table public.payments
  add constraint payments_provider_check check (provider in ('mercadopago')),
  add constraint payments_status_check check (
    status in ('pending','approved','rejected','refunded','charged_back','mismatch','duplicate')
  );

-- Un pedido no puede tener dos pagos aprobados. Es la defensa de base contra el
-- doble cobro: cada reintento del checkout creaba una preferencia nueva, asi que
-- un cliente con dos pestanas podia pagar dos veces y nada lo frenaba. Ahora el
-- segundo insert rebota con 23505 y la app lo registra como 'duplicate'.
create unique index payments_one_approved_per_order_idx on public.payments (order_id)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- 5. order_events: outbox con claim, dead-letter y backoff real
--
-- El adapter calculaba el backoff contra `created_at` porque un comentario
-- afirmaba que no existia columna de ultimo intento. `last_attempt_at` existia
-- desde el dia uno y nunca se escribio.
-- ---------------------------------------------------------------------------

alter table public.order_events
  add column if not exists locked_until timestamptz,
  add column if not exists dead_at      timestamptz;

alter table public.order_events
  add constraint order_events_type_check check (
    type in ('order.created','order.status_changed','order.paid',
             'order.payment_status_changed','order.cancelled','order.refund_pending')
  );

-- El indice viejo era (store_id, created_at): no sirve a la cola global que
-- recorre el cron, que ordena por created_at sin filtrar tienda.
drop index if exists public.order_events_pending_idx;
create index order_events_pending_idx on public.order_events (created_at)
  where delivered_at is null and dead_at is null;

-- ---------------------------------------------------------------------------
-- 6. notifications: plantillas acotadas al puerto de notificaciones
-- ---------------------------------------------------------------------------

alter table public.notifications
  add constraint notifications_template_check check (
    template in ('order_confirmed','order_ready','order_cancelled','order_receipt')
  );

-- ---------------------------------------------------------------------------
-- 7. stores: slug con forma valida y sin secuestrar rutas
--
-- `stores.slug` era unico pero nada impedia registrar un local con slug
-- `admin`, `api` o `backoffice`. Hoy el segmento estatico de Next gana sobre
-- `[store]` y esa tienda queda inalcanzable; con la iteracion de subdominios ya
-- decidida pasa a ser secuestro de ruta.
-- ---------------------------------------------------------------------------

alter table public.stores
  add constraint stores_slug_shape_check check (
    slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and length(slug) between 2 and 60
  ),
  add constraint stores_slug_not_reserved_check check (
    slug not in (
      'admin','api','app','assets','auth','backoffice','blog','carrito','checkout',
      'dashboard','docs','favicon','functions','graphql','health','help','images',
      'login','logout','manifest','mis-pedidos','new','nueva','pedido','pedidos',
      'public','realtime','rest','robots','settings','sitemap','static','status',
      'storage','support','www','_next'
    )
  ),
  add constraint stores_currency_shape_check check (currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- 8. store_branding: las URLs de assets no eran `text` libre por diseno
--
-- CLAUDE.md afirmaba que todo valor que entra al `<style>` pasa por
-- `brandingSchema`. En realidad la action escribia el input sin parsearlo y lo
-- que salvaba al `<style>` eran estos CHECK. Los colores y las fuentes ya
-- estaban acotados; las cuatro URLs aceptaban `javascript:` o `data:`. Hoy no se
-- renderizan, asi que el agujero era latente — y esta migracion lo cierra antes
-- de que alguien las ponga en un `url()` o en `<link rel="icon">`.
--
-- Ademas de exigir http(s), se rechazan los caracteres con los que se sale de
-- un `url(...)` en CSS: espacios, comillas, parentesis, angulares y backslash.
-- ---------------------------------------------------------------------------

alter table public.store_branding
  add constraint store_branding_logo_url_check check (
    logo_url is null or (logo_url ~ '^https?://' and logo_url !~ '[[:space:]"''()<>\\]')
  ),
  add constraint store_branding_logo_dark_url_check check (
    logo_dark_url is null or (logo_dark_url ~ '^https?://' and logo_dark_url !~ '[[:space:]"''()<>\\]')
  ),
  add constraint store_branding_favicon_url_check check (
    favicon_url is null or (favicon_url ~ '^https?://' and favicon_url !~ '[[:space:]"''()<>\\]')
  ),
  add constraint store_branding_hero_image_url_check check (
    hero_image_url is null or (hero_image_url ~ '^https?://' and hero_image_url !~ '[[:space:]"''()<>\\]')
  );

-- ---------------------------------------------------------------------------
-- 9. products: la categoria tiene que ser de la MISMA tienda
--
-- La policy de staff solo validaba `is_store_member(store_id)`, asi que un
-- `update products set category_id = <categoria de otra tienda>` pasaba
-- (verificado: 1 fila). El menu publico se arma embebiendo `products` por
-- `category_id`, asi que el producto aparecia en la vitrina del competidor con
-- su foto y su precio. `priceCart` lo rechazaba al comprar, pero era defacement.
--
-- FK compuesta con lista de columnas en ON DELETE SET NULL (Postgres 15+): sin
-- la lista, borrar una categoria intentaria anular tambien `store_id`, que es
-- NOT NULL, y el delete fallaria.
-- ---------------------------------------------------------------------------

update public.products p
   set category_id = null
 where p.category_id is not null
   and not exists (
     select 1 from public.categories c
      where c.id = p.category_id and c.store_id = p.store_id
   );

alter table public.categories add constraint categories_store_id_id_key unique (store_id, id);

alter table public.products drop constraint products_category_id_fkey;
alter table public.products
  add constraint products_category_same_store_fkey
  foreign key (store_id, category_id) references public.categories (store_id, id)
  on delete set null (category_id);

-- ---------------------------------------------------------------------------
-- 10. La maquina de estados del pedido, en Postgres
--
-- `ALLOWED_TRANSITIONS` vivia solo en TypeScript. El CHECK de la tabla validaba
-- que el estado EXISTA, no que se pueda LLEGAR ahi: `delivered -> pending` era
-- legal en la base. Ademas el webhook de Mercado Pago hacia un update sin
-- predicado de estado, asi que un pago que llegaba justo despues de que la
-- cocina cancelaba resucitaba un estado terminal.
--
-- Se valida para TODOS los roles, service_role incluido: que un pago tardio no
-- pueda revivir un pedido cancelado es una invariante del dominio, no un
-- permiso. El caso "pague y me cancelaron" se resuelve con `needs_refund_at`.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_order_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  -- El precio, la moneda y los identificadores de un pedido son su identidad.
  -- Si se pueden reescribir despues del insert, el historial contable de la
  -- tienda no vale nada: un `total_cents = 1` borra el rastro de la venta.
  if new.store_id        is distinct from old.store_id
  or new.public_token    is distinct from old.public_token
  or new.idempotency_key is distinct from old.idempotency_key
  or new.subtotal_cents  is distinct from old.subtotal_cents
  or new.total_cents     is distinct from old.total_cents
  or new.currency        is distinct from old.currency
  or new.payment_method  is distinct from old.payment_method
  or new.created_at      is distinct from old.created_at then
    raise exception
      'el pedido % tiene columnas inmutables: store_id, public_token, idempotency_key, subtotal_cents, total_cents, currency, payment_method, created_at',
      old.id
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    -- Misma tabla que ALLOWED_TRANSITIONS en src/models/schemas/order.schema.ts.
    -- Se permite UN paso atras dentro de la cocina porque un toque equivocado en
    -- hora pico esta garantizado; `delivered` y `cancelled` son terminales.
    allowed := case old.status
                 when 'pending'   then array['confirmed','cancelled']
                 when 'confirmed' then array['preparing','cancelled']
                 when 'preparing' then array['ready','confirmed','cancelled']
                 when 'ready'     then array['delivered','preparing','cancelled']
                 else array[]::text[]
               end;

    if not (new.status = any (allowed)) then
      raise exception 'transicion de estado ilegal en el pedido %: % -> %',
        old.id, old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- La comida no sale sin plata asegurada. El pago en el local si entra a la
    -- cocina impago, porque ahi el cobro es presencial.
    if new.status = 'confirmed'
       and new.payment_method = 'online'
       and new.payment_status <> 'approved' then
      raise exception 'el pedido % es online y todavia no esta pago: no puede pasar a confirmed', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- El nombre importa: con el mismo timing, Postgres dispara los triggers en
-- orden alfabetico, y este tiene que correr antes de `orders_set_updated_at` y
-- de `orders_stamp_status_times`.
create trigger orders_enforce_rules
  before update on public.orders
  for each row execute function private.enforce_order_rules();

-- ---------------------------------------------------------------------------
-- 11. confirmed_at para los pedidos que nacen confirmados
--
-- `stamp_order_status_times` era solo BEFORE UPDATE, y un pedido de pago en el
-- local nace 'confirmed' en el INSERT: nunca pasaba por un update a confirmed,
-- asi que su `confirmed_at` quedaba NULL para siempre. El dashboard lo excluia
-- de "preparacion real vs estimada" y el KDS caia a `created_at`.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_order_insert_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'confirmed' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  if new.payment_status = 'approved' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end;
$$;

create trigger orders_stamp_insert_times
  before insert on public.orders
  for each row execute function private.stamp_order_insert_times();

-- ---------------------------------------------------------------------------
-- 12. Eventos de outbox que faltaban
--
-- Un contracargo o un reembolso no generaba ningun evento: el POS del local se
-- enteraba de que un pedido se pago pero nunca de que la plata se fue.
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
    values (new.id, new.store_id,
            case when new.status = 'cancelled' then 'order.cancelled' else 'order.status_changed' end,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.payment_status = 'approved' and old.payment_status is distinct from 'approved' then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.paid',
            jsonb_build_object('payment_ref', new.payment_ref, 'total_cents', new.total_cents));
  end if;

  -- Salir de 'approved' es plata que se va: reembolso o contracargo.
  if old.payment_status = 'approved' and new.payment_status is distinct from 'approved' then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.payment_status_changed',
            jsonb_build_object('from', old.payment_status, 'to', new.payment_status,
                               'total_cents', new.total_cents));
  end if;

  if new.needs_refund_at is not null and old.needs_refund_at is null then
    insert into public.order_events (order_id, store_id, type, payload)
    values (new.id, new.store_id, 'order.refund_pending',
            jsonb_build_object('reason', new.refund_reason, 'total_cents', new.total_cents));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants por columna: el corazon del arreglo
--
-- Un grant de tabla es todo-o-nada sobre las columnas, y la policy de staff era
-- `FOR ALL`. Eso alcanzaba para reactivar una tienda suspendida por la
-- plataforma, cambiarle el slug a `admin`, o marcar un pedido online como
-- pagado. Las policies siguen decidiendo QUE FILAS; los grants deciden ahora
-- QUE COLUMNAS.
-- ---------------------------------------------------------------------------

-- --- stores ---------------------------------------------------------------
-- `status` y `slug` quedan afuera: son de la plataforma. El backoffice escribe
-- con service_role, que bypassea grants y RLS.
revoke insert, update, delete on public.stores from authenticated;

grant update (
  name, description, phone_e164, whatsapp_phone_e164, address,
  timezone, currency, accepting_orders, in_store_payment_enabled,
  min_order_cents, demand_threshold_orders, demand_multiplier
) on public.stores to authenticated;

drop policy stores_staff_all on public.stores;

create policy stores_staff_read on public.stores
  for select to authenticated
  using ((select private.is_store_member(id)));

create policy stores_staff_update on public.stores
  for update to authenticated
  using ((select private.is_store_member(id)))
  with check ((select private.is_store_member(id)));

-- --- orders ---------------------------------------------------------------
-- El staff solo mueve el pedido por la cocina. El ciclo del dinero
-- (`payment_status`, `payment_ref`) es del servidor: marcar cobrado en el
-- mostrador pasa por una Server Action con service_role, no por PostgREST.
revoke update on public.orders from authenticated;
grant  update (status) on public.orders to authenticated;

-- --- store_payment_credentials -------------------------------------------
-- Ya estaba revocada; se repite explicito porque es la tabla mas sensible del
-- sistema y conviene que la intencion quede en la migracion mas nueva tambien.
revoke all on public.store_payment_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Storage: sin listado anonimo del bucket de fotos
--
-- El bucket es publico, asi que sirve los archivos sin necesidad de policy de
-- SELECT. Tener la policy explicita para `anon` habilitaba de yapa
-- `POST /storage/v1/object/list/product-images`, que es enumeracion del
-- catalogo de archivos de cada local.
-- ---------------------------------------------------------------------------

drop policy product_images_public_read on storage.objects;

create policy product_images_authenticated_read on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images');

-- ---------------------------------------------------------------------------
-- 15. Codigo muerto que duplicaba la formula del ETA
--
-- `private.estimate_eta` y `private.active_order_count` no se llamaban desde
-- ningun lado y reimplementaban en SQL lo que `estimateEta` hace en TS. Dos
-- fuentes para la misma regla es una que se va a desincronizar.
-- ---------------------------------------------------------------------------

drop function if exists private.estimate_eta(bigint, int);
drop function if exists private.active_order_count(bigint);
