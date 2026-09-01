-- ---------------------------------------------------------------------------
-- Padrón de clientes por tienda.
--
-- El cliente no tiene cuenta: los datos son los que tipeó al pedir. La clave de
-- identidad es (store_id, phone_e164), porque el teléfono es lo único que
-- siempre está —`orders.customer_email` es nullable a propósito— y porque
-- `phoneSchema` ya lo normaliza a E.164 respetando el "15" de Córdoba.
--
-- Por qué una TABLA y no una vista que agregue `orders` al vuelo: la baja de
-- marketing, el token de baja y la nota del local NO son función de los
-- pedidos. Sin ellos el feature no se puede lanzar. Y el orden de la tabla es
-- por plata gastada, que un agregado no puede indexar.
--
-- Por qué la mantiene un TRIGGER y no `create_order`: el agregado también
-- cambia cuando se aprueba el pago, cuando se cancela y cuando se reembolsa, y
-- ninguno de esos caminos pasa por `create_order`. Serían cuatro call sites, y
-- `create_order` ya es la función que enumera columnas a mano. "El padrón es
-- una función de los pedidos" es invariante del dominio, no un permiso: va en
-- Postgres, donde cubre a `service_role` también.
-- ---------------------------------------------------------------------------

create table if not exists public.store_customers (
  id                     bigint generated always as identity primary key,
  store_id               bigint not null references public.stores(id) on delete cascade,
  phone_e164             text   not null,

  display_name           text   not null,
  email                  text,

  -- Agregados. Los mantiene private.recalc_store_customer().
  orders_count           int    not null default 0 check (orders_count >= 0),
  total_spent_cents      bigint not null default 0 check (total_spent_cents >= 0),
  cancelled_orders_count int    not null default 0 check (cancelled_orders_count >= 0),
  first_order_at         timestamptz,
  last_order_at          timestamptz,

  -- Estado que NO se deriva de `orders`. Es la razón de que esto sea una tabla.
  marketing_opt_out_at   timestamptz,
  unsubscribe_token      text   not null unique default private.random_token(24),
  notes                  text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (store_id, phone_e164)
);

comment on table public.store_customers is
  'Padrón de clientes por tienda. Materializado desde orders por trigger; el estado de marketing no se deriva de orders.';
comment on column public.store_customers.phone_e164 is
  'Clave de identidad junto a store_id. Normalizado por phoneSchema antes de llegar a orders.';
comment on column public.store_customers.total_spent_cents is
  'Centavos enteros. Solo plata que el local se quedó: ver private.order_is_customer_spend.';
comment on column public.store_customers.cancelled_orders_count is
  'Señal operativa (el que reserva y no aparece), no plata. Cuenta status = cancelled sin más condiciones.';
comment on column public.store_customers.unsubscribe_token is
  'Lo único que autoriza /baja/[token]. CSPRNG con rejection sampling, igual que orders.public_token: nunca random().';
comment on column public.store_customers.marketing_opt_out_at is
  'Baja de promociones. La fila NO se borra nunca: borrarla perdería la baja y la próxima compra recrearía la fila limpia.';

-- ---------------------------------------------------------------------------
-- Índices.
-- ---------------------------------------------------------------------------

create index if not exists store_customers_store_id_idx
  on public.store_customers (store_id);

-- El orden de la tabla del padrón: mayor plata gastada primero.
create index if not exists store_customers_store_spent_idx
  on public.store_customers (store_id, total_spent_cents desc);

-- Parcial por los dos predicados del segmento de campaña, que es la única
-- consulta que lo usa: "tiene mail" y "no se dio de baja". Índice chico, misma
-- doctrina que orders_active_idx.
create index if not exists store_customers_store_email_idx
  on public.store_customers (store_id, email)
  where email is not null and marketing_opt_out_at is null;

-- Lo que el trigger necesita para recalcular el agregado de UN teléfono sin
-- scanear el historial del local.
create index if not exists orders_store_customer_phone_idx
  on public.orders (store_id, customer_phone_e164);

drop trigger if exists store_customers_set_updated_at on public.store_customers;

create trigger store_customers_set_updated_at
  before update on public.store_customers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- El predicado de "plata gastada".
--
-- Reusa private.order_is_billable y le agrega DOS exclusiones, porque ese
-- predicado tiene dos huecos que en el dashboard son un error de redondeo y acá
-- cambian quién aparece primero en la tabla:
--
--   1. Un pedido `in_store` REEMBOLSADO sigue dando true, porque la segunda
--      cláusula de order_is_billable no mira payment_status. Un cliente al que
--      se le devolvió todo figuraría como el que más gastó.
--   2. Un pedido online pagado y después CANCELADO por la cocina sigue dando
--      true, porque payment_status queda en 'approved' hasta que alguien
--      reembolsa. No es plata que el local se quedó por comida que entregó.
--
-- No se corrige order_is_billable: eso movería, en el mismo deploy, la
-- facturación que muestran store_dashboard, platform_metrics y platform_stores.
-- Es otro cambio, con su propia conversación.
--
-- Existe como función y no inline para que el trigger y el backfill no puedan
-- divergir: es un predicado de dinero escrito en dos lugares.
-- ---------------------------------------------------------------------------

create or replace function private.order_is_customer_spend(
  p_payment_status text,
  p_payment_method text,
  p_status         text,
  p_refunded_at    timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.order_is_billable(p_payment_status, p_payment_method, p_status)
     and p_status         <> 'cancelled'
     and p_payment_status <> 'refunded'
     and p_refunded_at is null;
$$;

comment on function private.order_is_customer_spend(text, text, text, timestamptz) is
  'Plata que el local efectivamente se quedó, por un pedido que entregó o va a entregar. order_is_billable más las dos exclusiones que ese predicado no cubre.';

-- ---------------------------------------------------------------------------
-- El recálculo.
--
-- Recalcula el agregado COMPLETO para un (store_id, phone) leyendo orders, en
-- vez de deducirlo de new/old. Mismo criterio que sync_store_transfer_payment:
-- un recálculo no puede quedar desincronizado por un camino que no previmos, y
-- una deducción sí. Acá vale más todavía, porque los caminos que mueven un
-- pedido son muchos: webhook de MP, markPaidInStore, markPaidByTransfer, el
-- KDS, courier_advance_order, el cron de conciliación y el de expiración.
--
-- Costo: los pedidos de UN teléfono en UNA tienda son un puñado de filas, y
-- orders_store_customer_phone_idx las alcanza. No es un agregado de la tienda.
-- ---------------------------------------------------------------------------

create or replace function private.recalc_store_customer(
  p_store_id bigint,
  p_phone    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_store_id is null or coalesce(p_phone, '') = '' then
    return;
  end if;

  insert into public.store_customers as sc (
    store_id, phone_e164, display_name, email,
    orders_count, total_spent_cents, cancelled_orders_count,
    first_order_at, last_order_at
  )
  select
    p_store_id,
    p_phone,
    -- El nombre del pedido FACTURABLE más reciente. La gente corrige cómo se
    -- escribe su nombre, así que gana el más nuevo — pero solo entre los
    -- pedidos que contaron: si no, un pedido abandonado sin pagar, que puede
    -- traer cualquier cosa tipeada, le pisa el nombre al cliente que sí compró.
    --
    -- El fallback al nombre sin filtrar NO es redundante: un cliente con CERO
    -- pedidos facturables tiene fila a propósito (el que pidió y canceló es un
    -- cliente, y aparece al final de la tabla). Con el filtro solo, ese nombre
    -- quedaría vacío y la fila se vería en blanco en el padrón.
    coalesce(
      (array_agg(o.customer_name order by o.created_at desc)
         filter (where private.order_is_customer_spend(
           o.payment_status, o.payment_method, o.status, o.refunded_at)))[1],
      (array_agg(o.customer_name order by o.created_at desc))[1],
      ''
    ),
    -- El último mail NO NULO. Un pedido posterior sin mail no lo borra: el
    -- campo es opcional y dejarlo vacío una vez no es darse de baja.
    (array_agg(o.customer_email order by o.created_at desc)
       filter (where o.customer_email is not null))[1],
    count(*) filter (where private.order_is_customer_spend(
      o.payment_status, o.payment_method, o.status, o.refunded_at)),
    coalesce(sum(o.total_cents) filter (where private.order_is_customer_spend(
      o.payment_status, o.payment_method, o.status, o.refunded_at)), 0),
    count(*) filter (where o.status = 'cancelled'),
    -- Fechas de COMPRA, no de intento: un pedido cancelado no mueve la última
    -- compra, que es la señal de churn que dispara la reactivación.
    min(o.created_at) filter (where private.order_is_customer_spend(
      o.payment_status, o.payment_method, o.status, o.refunded_at)),
    max(o.created_at) filter (where private.order_is_customer_spend(
      o.payment_status, o.payment_method, o.status, o.refunded_at))
  from public.orders o
  where o.store_id = p_store_id
    and o.customer_phone_e164 = p_phone
  having count(*) > 0
  on conflict (store_id, phone_e164) do update
    set display_name           = excluded.display_name,
        email                  = coalesce(excluded.email, sc.email),
        orders_count           = excluded.orders_count,
        total_spent_cents      = excluded.total_spent_cents,
        cancelled_orders_count = excluded.cancelled_orders_count,
        first_order_at         = excluded.first_order_at,
        last_order_at          = excluded.last_order_at;
end;
$$;

comment on function private.recalc_store_customer(bigint, text) is
  'Recalcula el agregado del padrón para un (store_id, phone) desde orders. Idempotente: se puede volver a correr.';

-- SECURITY DEFINER no es opcional acá. El trigger dispara con `status`, y
-- `authenticated` TIENE grant update (status) sobre orders: el KDS del staff
-- cambia estados con el cliente de sesión. Sin definer, ese update fallaría con
-- 42501 al intentar escribir store_customers, y el síntoma sería que la cocina
-- no puede mover un pedido.
create or replace function private.sync_store_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un error acá aborta la transacción del PEDIDO, así que no hay nada que
  -- pueda tirar: sin casts, sin división, sin lecturas de otras tiendas.
  perform private.recalc_store_customer(new.store_id, new.customer_phone_e164);

  -- El teléfono es la clave de identidad. Hoy ningún camino de la app lo
  -- cambia, pero si alguno lo hiciera, no recalcular el viejo dejaría el padrón
  -- partido en dos filas y una de ellas mintiendo para siempre.
  if tg_op = 'UPDATE'
     and old.customer_phone_e164 is distinct from new.customer_phone_e164 then
    perform private.recalc_store_customer(old.store_id, old.customer_phone_e164);
  end if;

  return new;
end;
$$;

comment on function private.sync_store_customer() is
  'Mantiene store_customers en sync con orders. SECURITY DEFINER porque el KDS del staff dispara este trigger con la sesión de authenticated.';

drop trigger if exists orders_sync_store_customer on public.orders;

create trigger orders_sync_store_customer
  after insert or update of
    payment_status, status, customer_name, customer_email,
    customer_phone_e164, refunded_at
  on public.orders
  for each row execute function private.sync_store_customer();

-- ---------------------------------------------------------------------------
-- RLS y grants.
--
-- Cero policies y cero columnas otorgadas, y no es pereza: es la respuesta a
-- "¿esto lo tendría que poder hacer el browser del staff?". No hay una sola
-- columna acá que el browser deba escribir, y las lecturas van por RPC, igual
-- que la cuenta bancaria en /admin/pagos.
--
-- El grant a service_role es explícito porque Supabase NO le da privilegios
-- sobre las tablas que crea una migración: sin esto el primer insert falla con
-- 42501 sin mencionar los grants en ningún lado.
--
-- Consecuencia esperada: la tabla aparece en get_advisors como
-- rls_enabled_no_policy, en INFO. Es correcto. No se arregla.
-- ---------------------------------------------------------------------------

alter table public.store_customers enable row level security;

revoke all on public.store_customers from anon, authenticated;
grant select, insert, update, delete on public.store_customers to service_role;

-- ---------------------------------------------------------------------------
-- La lectura del padrón.
--
-- Va por RPC y no por PostgREST por el motivo de siempre en este repo:
-- PostgREST corta en max_rows (1000) SIN ERROR, y el padrón está ordenado por
-- plata, así que la truncada esconde exactamente la cola que interesa. Es el
-- mismo motivo por el que existen store_dashboard y platform_stores.
--
-- OJO: verifica is_store_owner() leyendo auth.uid(), así que se llama con el
-- cliente de SESIÓN, nunca con el admin client. Con service_role no hay
-- auth.uid() y falla siempre. Idéntico a store_couriers.
--
-- El nombre NO es store_customers: PostgREST expondría /rest/v1/store_customers
-- y /rest/v1/rpc/store_customers, y este repo ya tiene un par confuso
-- documentado (store_couriers vs. store_courier_availability).
-- ---------------------------------------------------------------------------

create or replace function public.store_customer_directory(p_store_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not private.is_store_owner(p_store_id) then
    raise exception 'solo el dueno del local ve el padron de clientes' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'customers', coalesce(jsonb_agg(c.payload order by c.total_spent_cents desc, c.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'customers',  count(*),
      -- "Con email" es literal: tiene mail cargado. La baja se muestra por fila
      -- y el alcance real de una campaña lo calcula campaign_segment_preview,
      -- que descuenta los dados de baja aparte.
      'withEmail',  count(*) filter (where c.email is not null),
      'inactive30', count(*) filter (where c.days_since is not null and c.days_since >= 30)
    )
  )
  into v_out
  from (
    select
      sc.id,
      sc.total_spent_cents,
      sc.email,
      case
        when sc.last_order_at is null then null
        else floor(extract(epoch from (now() - sc.last_order_at)) / 86400)::int
      end as days_since,
      jsonb_build_object(
        'id',                   sc.id,
        'storeId',              sc.store_id,
        'phoneE164',            sc.phone_e164,
        'displayName',          sc.display_name,
        'email',                sc.email,
        'ordersCount',          sc.orders_count,
        'totalSpentCents',      sc.total_spent_cents,
        -- Derivado, no columna: guardarlo es invitar al drift a cambio de nada.
        -- División entera en centavos; con cero pedidos es 0, no un error.
        'avgTicketCents',       case when sc.orders_count > 0
                                     then sc.total_spent_cents / sc.orders_count
                                     else 0 end,
        'cancelledOrdersCount', sc.cancelled_orders_count,
        'firstOrderAt',         sc.first_order_at,
        'lastOrderAt',          sc.last_order_at,
        'daysSinceLastOrder',   case
                                  when sc.last_order_at is null then null
                                  else floor(extract(epoch from (now() - sc.last_order_at)) / 86400)::int
                                end,
        'marketingOptOutAt',    sc.marketing_opt_out_at,
        'notes',                sc.notes
      ) as payload
    from public.store_customers sc
    where sc.store_id = p_store_id
  ) c;

  return coalesce(v_out, jsonb_build_object(
    'customers', '[]'::jsonb,
    'totals', jsonb_build_object('customers', 0, 'withEmail', 0, 'inactive30', 0)
  ));
end;
$$;

comment on function public.store_customer_directory(bigint) is
  'Padrón de la tienda, ordenado por plata gastada. Se llama con el cliente de SESIÓN: verifica is_store_owner con auth.uid().';

revoke execute on function public.store_customer_directory(bigint) from public, anon;
grant  execute on function public.store_customer_directory(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Slugs reservados.
--
-- `baja` es un PATH: /baja/[token] es ruta de nivel raíz, así que un local con
-- ese slug queda inalcanzable en path-based y es secuestro de ruta con
-- subdominios. `promos`, `ventas` y `sales` son HOSTNAMES e identidades de
-- mail: promos.comandapp.ar es el remitente de campaña y ventas@comandapp.ar la
-- vía comercial. Mismo criterio que mail, bounces y track, que ya están.
--
-- `clientes` y `cupones` no hacen falta: viven bajo /admin/, ya reservado.
--
-- La lista está espejada en RESERVED_SLUGS de platform.schema.ts y hay test de
-- paridad. Si se agrega uno, va en los dos lados.
-- ---------------------------------------------------------------------------

alter table public.stores drop constraint if exists stores_slug_not_reserved_check;

alter table public.stores
  add constraint stores_slug_not_reserved_check check (
    slug not in (
      -- Rutas de la app y del stack (la lista original).
      'admin','api','app','assets','auth','backoffice','blog','carrito','checkout',
      'dashboard','docs','envios','favicon','functions','graphql','health','help',
      'images','legal','login','logout','manifest','mis-pedidos','new','nueva',
      'pedido','pedidos','public','realtime','repartidor','repartidores','rest',
      'robots','settings','sitemap','static','status','storage','support','www',
      '_next',

      -- Baja de promociones: ruta pública de nivel raíz.
      'baja',

      -- Correo e infraestructura de entrega. Los mas urgentes: el magic link es
      -- la unica puerta a /admin y Resend necesita registros en esta zona.
      'mail','email','smtp','imap','pop','mx','webmail','autoconfig','autodiscover',
      'bounces','track','link','links','send',

      -- Remitente de campañas y vía comercial.
      'promos','ventas','sales',

      -- DNS y red.
      'ns','ns1','ns2','dns','ftp','vpn','gateway','proxy',

      -- Entornos.
      'staging','stage','dev','test','qa','demo','beta','preview','sandbox','local',
      'internal',

      -- CDN y assets.
      'cdn','img','media','files','download','downloads','web','www2',

      -- Identidad y pagos.
      'id','sso','oauth','callback','account','accounts','cuenta','pay','pago','pagos',
      'billing','facturacion','webhook','webhooks',

      -- Observabilidad.
      'metrics','monitor','logs','grafana','ci','git',

      -- Marca y proveedores.
      'comandapp','vercel','supabase','resend','mercadopago','mp',

      -- Superficie de cliente.
      'm','mobile','soporte','ayuda','contacto'
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- Idempotente a propósito: hoy son pocas filas y corre instantáneo, pero es lo
-- que permite volver a correrlo si un bug del trigger deja el padrón torcido.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select distinct o.store_id, o.customer_phone_e164
      from public.orders o
     where coalesce(o.customer_phone_e164, '') <> ''
  loop
    perform private.recalc_store_customer(r.store_id, r.customer_phone_e164);
  end loop;
end;
$$;
