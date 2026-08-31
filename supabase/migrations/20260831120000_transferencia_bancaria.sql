-- ---------------------------------------------------------------------------
-- Transferencia bancaria como TERCER medio de pago
--
-- Hasta acá `payment_method` era binario (`online | in_store`) y había nueve
-- lugares en el código que lo asumían. Este archivo agrega el tercer valor y
-- las invariantes que lo sostienen; el detalle del diseño y el pushback están
-- en `docs/pipelines/2026-08-30-transferencia-bancaria/00-architecture.md`.
--
-- Cinco piezas:
--   1. El vocabulario nuevo (`transfer`) en los tres CHECK que lo encierran.
--   2. `store_bank_accounts`: tabla propia, NO columnas en `stores`. El CBU
--      tiene que ser público; el CUIT declarado y el resultado del contraste
--      con el proveedor, no. Un grant de tabla no se puede "restar" por
--      columna (doc de REVOKE), y `stores` ya tiene `grant select` de tabla
--      para `anon`: cualquier columna nueva ahí sería pública sí o sí.
--   3. `stores.transfer_payment_enabled`: flag DERIVADO, calcado del de
--      `online_payment_enabled`, para que la vitrina conteste "¿puede cobrar
--      por transferencia?" sin leer la tabla de la cuenta.
--   4. Las cinco columnas del comprobante en `orders`, sin un solo grant nuevo.
--   5. El bucket privado `order-receipts`, sin una sola policy.
--
-- `private.order_is_billable` NO se toca a propósito: su primer predicado ya es
-- `payment_status = 'approved'`, así que una transferencia confirmada entra a la
-- facturación de `store_dashboard`, `platform_metrics` y `platform_stores` sin
-- cambiarle una línea.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. El vocabulario nuevo
--
-- Los tres CHECK se crearon inline en su `create table`, así que el nombre lo
-- puso Postgres. Se introspecciona en vez de adivinarlo: un `drop constraint
-- orders_payment_method_check` que no matchee el nombre real fallaría en
-- silencio con `if exists` y dejaría el CHECK viejo rechazando 'transfer'.
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.orders'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) like '%payment_method%'
     and pg_get_constraintdef(oid) like '%in_store%';

  if v_name is not null then
    execute format('alter table public.orders drop constraint %I', v_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'orders_payment_method_check'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method in ('online', 'in_store', 'transfer'));
  end if;
end $$;


-- `payments.provider` SÍ tenía CHECK, y no está en el `create table`: lo agregó
-- `20260826120000_hardening.sql` con el nombre `payments_provider_check` y el
-- valor único `in ('mercadopago')`.
--
-- Por eso acá va el MISMO drop-por-introspección que los otros dos, y no un
-- `if not exists` sobre el nombre. Un `if not exists (conname =
-- 'payments_provider_check')` encuentra el constraint viejo, se saltea el add, y
-- deja el CHECK de un solo valor en pie: el insert de `markPaidByTransfer`
-- revienta con `23514` en CADA confirmación de transferencia, el staff ve un
-- error interno, y el pedido queda `payment_status = 'approved'` SIN la fila de
-- `payments` que arma `payments_one_approved_per_order_idx` — o sea sin la
-- defensa real contra el doble cobro. Es exactamente el modo de falla que este
-- comentario existe para que no vuelva.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.payments'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) like '%provider%';

  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;

  alter table public.payments
    add constraint payments_provider_check
    check (provider in ('mercadopago', 'transfer'));
end $$;


do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.store_pending_changes'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) like '%kind%'
     and pg_get_constraintdef(oid) like '%payment_credentials%';

  if v_name is not null then
    execute format('alter table public.store_pending_changes drop constraint %I', v_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'store_pending_changes_kind_check'
       and conrelid = 'public.store_pending_changes'::regclass
  ) then
    alter table public.store_pending_changes
      add constraint store_pending_changes_kind_check
      check (kind in ('payment_credentials', 'courier_payment_policy', 'bank_account'));
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. `store_bank_accounts` — 1:1 con `stores`
--
-- Parte pública (las cinco columnas que el cliente necesita para transferir) y
-- parte privada (el CUIT declarado y el resultado del contraste) en la misma
-- entidad. Es la única forma de tenerlas juntas sin filtrar la privada: los
-- grants son por COLUMNA, doctrina del repo.
--
-- No hay `status` ni `reviewed_by`: la plataforma no revisa nada. Una fila
-- existe si y solo si el DUEÑO la confirmó con el código de 6 dígitos.
-- ---------------------------------------------------------------------------

create table if not exists public.store_bank_accounts (
  store_id      bigint primary key references public.stores(id) on delete cascade,

  -- CBU o CVU: los dos son 22 dígitos y el mismo campo los cubre. Nullable
  -- porque el dueño del producto decidió que se pueda cargar cualquiera de los
  -- tres identificadores (CBU, CVU o alias). Consecuencia aceptada a
  -- conciencia: una cuenta cargada SOLO con alias no tiene checksum que
  -- validar, así que un error de tipeo no se puede detectar y el local se
  -- entera cuando un cliente le transfiere a otra cuenta.
  cbu           text,
  alias         text,

  -- Lo que el dueño DECLARA. Nunca lo que devolvió un proveedor de validación:
  -- ese nombre es un dato personal de un tercero y no se persiste (§3.5).
  holder_name   text not null,
  holder_tax_id text,

  -- Snapshot derivado del código de entidad (los 3 primeros dígitos del CBU).
  bank_name     text,

  is_active     boolean not null default true,

  -- TODO lo que sobrevive a la llamada al proveedor de validación: un veredicto,
  -- no un nombre. El contraste se hace CUIT contra CUIT, dígito a dígito.
  holder_match  text,
  checked_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.store_bank_accounts is
  'Cuenta bancaria del local para cobrar por transferencia. Grants POR COLUMNA: cbu/alias/holder_name/bank_name son públicos, holder_tax_id y holder_match no salen nunca al borde.';
comment on column public.store_bank_accounts.cbu is
  'CBU o CVU, 22 dígitos. Nullable: se admite cargar solo alias (decisión de producto, sin checksum posible en ese caso).';
comment on column public.store_bank_accounts.holder_name is
  'Titular DECLARADO por el dueño. Nunca el nombre que devuelva un proveedor de validación.';
comment on column public.store_bank_accounts.holder_match is
  'Veredicto del contraste automático de CUIT, si hubo. El nombre del titular que devolvió la API no se persiste.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_bank_accounts_cbu_check'
  ) then
    alter table public.store_bank_accounts
      add constraint store_bank_accounts_cbu_check
      check (cbu is null or cbu ~ '^[0-9]{22}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_bank_accounts_alias_check'
  ) then
    alter table public.store_bank_accounts
      add constraint store_bank_accounts_alias_check
      check (alias is null or alias ~ '^[A-Za-z0-9.-]{6,20}$');
  end if;

  -- La regla de D3: cualquiera de los tres identificadores sirve, pero alguno
  -- tiene que haber. Una fila sin CBU ni alias no le dice al cliente a dónde
  -- transferir, o sea que habilitaría un medio de pago imposible de usar.
  if not exists (
    select 1 from pg_constraint where conname = 'store_bank_accounts_has_identifier_check'
  ) then
    alter table public.store_bank_accounts
      add constraint store_bank_accounts_has_identifier_check
      check (cbu is not null or alias is not null);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_bank_accounts_holder_tax_id_check'
  ) then
    alter table public.store_bank_accounts
      add constraint store_bank_accounts_holder_tax_id_check
      check (holder_tax_id is null or holder_tax_id ~ '^[0-9]{11}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_bank_accounts_holder_match_check'
  ) then
    alter table public.store_bank_accounts
      add constraint store_bank_accounts_holder_match_check
      check (holder_match is null or holder_match in ('match', 'mismatch', 'unavailable'));
  end if;
end $$;

drop trigger if exists store_bank_accounts_set_updated_at on public.store_bank_accounts;

create trigger store_bank_accounts_set_updated_at
  before update on public.store_bank_accounts
  for each row execute function private.set_updated_at();

alter table public.store_bank_accounts enable row level security;

-- Grants por COLUMNA. `revoke all` primero: la tabla es nueva, pero dejarlo
-- explícito documenta que lo de abajo es una allowlist y no un agregado.
revoke all on public.store_bank_accounts from anon, authenticated;

grant select (store_id, cbu, alias, holder_name, bank_name)
  on public.store_bank_accounts to anon, authenticated;

-- Trampa documentada en CLAUDE.md: `service_role` bypassea RLS pero NO recibe
-- privilegios sobre las tablas que crea una migración. Sin esto, escribir la
-- cuenta falla con `42501 permission denied for table store_bank_accounts` y el
-- mensaje no menciona los grants en ningún lado.
grant select, insert, update, delete on public.store_bank_accounts to service_role;

-- Cero policies de INSERT/UPDATE/DELETE: toda escritura es `service_role`
-- detrás de `requireStoreMembership(storeId, { role: 'owner' })` + el código de
-- 6 dígitos. Quien escribe esto redirige la plata del local.
--
-- Tampoco hay policy de SELECT para el staff: `/admin/pagos` lee todas las
-- columnas con el admin client, igual que `getPaymentConnectionStatus`. Menos
-- superficie.
create policy store_bank_accounts_public_read on public.store_bank_accounts
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.stores s
       where s.id = store_bank_accounts.store_id
         and s.status = 'active'
    )
  );


-- ---------------------------------------------------------------------------
-- 3. `stores.transfer_payment_enabled` — flag derivado
--
-- Calcado de `private.sync_store_online_payment` y por el mismo motivo: la
-- vitrina necesita contestar "¿puede cobrar por transferencia?" sin leer la
-- tabla de la cuenta. La fuente de verdad sigue siendo `store_bank_accounts`.
--
-- Sin `grant update` para `authenticated`, igual que `status`, `slug` y
-- `online_payment_enabled`.
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists transfer_payment_enabled boolean not null default false;

comment on column public.stores.transfer_payment_enabled is
  'Derivado de store_bank_accounts (existe fila con is_active) por private.sync_store_transfer_payment(). No se escribe a mano.';

create or replace function private.sync_store_transfer_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id bigint := coalesce(new.store_id, old.store_id);
begin
  -- Se recalcula desde la tabla en vez de deducirlo de `new`/`old`: es una
  -- fila por tienda hoy, pero un `exists` no puede quedar desincronizado por un
  -- camino que no previmos, y una deducción sí.
  update public.stores s
     set transfer_payment_enabled = exists (
           select 1 from public.store_bank_accounts a
            where a.store_id = v_store_id
              and a.is_active
         )
   where s.id = v_store_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.sync_store_transfer_payment() is
  'Mantiene stores.transfer_payment_enabled en sync con store_bank_accounts.is_active.';

drop trigger if exists store_bank_accounts_sync_store on public.store_bank_accounts;

create trigger store_bank_accounts_sync_store
  after insert or update of is_active or delete on public.store_bank_accounts
  for each row execute function private.sync_store_transfer_payment();


-- ---------------------------------------------------------------------------
-- 4. El comprobante: cinco columnas en `orders`, ningún grant nuevo
--
-- `orders` tiene `revoke update from authenticated` + `grant update (status)` y
-- nada más, así que estas columnas quedan fuera del alcance del browser del
-- staff sin agregar un solo revoke. Todo lo escribe `service_role`.
--
-- `size` y `sha256` se conservan cuando la imagen se borra: la huella queda,
-- el archivo no. Es lo que permite decir "sí, hubo un comprobante y era este"
-- después de la purga.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists transfer_receipt_path        text,
  add column if not exists transfer_receipt_uploaded_at timestamptz,
  add column if not exists transfer_receipt_mime        text,
  add column if not exists transfer_receipt_size        integer,
  add column if not exists transfer_receipt_sha256      text;

comment on column public.orders.transfer_receipt_path is
  'Path en el bucket privado order-receipts. Se nulea al purgar el archivo; uploaded_at/size/sha256 sobreviven.';
comment on column public.orders.transfer_receipt_uploaded_at is
  'Inmutable una vez no nula (private.enforce_order_rules). Es lo que sostiene "un comprobante por pedido" contra PostgREST.';

-- La bandeja del KDS: transferencias esperando confirmación. Parcial porque la
-- pantalla nunca pregunta por otra cosa y el índice completo sobre
-- (store_id, created_at) ya existe para el tablero.
create index if not exists orders_transfer_pending_idx
  on public.orders (store_id, created_at)
  where payment_method = 'transfer' and payment_status = 'pending';


-- ---------------------------------------------------------------------------
-- 5. `private.enforce_order_rules` — redefinición completa
--
-- Copia de la vigente (20260829170000_scheduled_orders_and_hours.sql) con DOS
-- cambios, los dos marcados abajo con [TRANSFER]:
--
--   a) "impago no confirma" pasa de `= 'online'` a `<> 'in_store'`. El default
--      seguro es enumerar el método que SÍ puede entrar impago, no los que no:
--      así, el día que aparezca un cuarto medio de pago, el comportamiento por
--      defecto es "no entra sin plata" en vez de "entra". La lista de excepciones
--      se olvida de crecer; la de permitidos, no.
--   b) `transfer_receipt_uploaded_at` es inmutable una vez no nula. Es la
--      invariante de "un comprobante por pedido" y es LO ÚNICO que la sostiene
--      contra alguien que le pegue a PostgREST: el CAS de la aplicación se
--      puede saltear, esto no.
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
  --
  -- `delivery_method` y `delivery_fee_cents` entran acá por lo mismo: son
  -- identidad y plata. La DIRECCION queda mutable a propósito — "el cliente
  -- puso mal el número y el local lo corrige" es un caso real y una plata real.
  -- Igual el browser del staff no puede escribirla: `orders` tiene
  -- `revoke update from authenticated` + `grant update (status)` y nada más.
  if new.store_id           is distinct from old.store_id
  or new.public_token       is distinct from old.public_token
  or new.idempotency_key    is distinct from old.idempotency_key
  or new.subtotal_cents     is distinct from old.subtotal_cents
  or new.total_cents        is distinct from old.total_cents
  or new.currency           is distinct from old.currency
  or new.payment_method     is distinct from old.payment_method
  or new.delivery_method    is distinct from old.delivery_method
  or new.delivery_fee_cents is distinct from old.delivery_fee_cents
  or new.scheduled_for      is distinct from old.scheduled_for
  or new.fire_at            is distinct from old.fire_at
  or new.scheduled_night    is distinct from old.scheduled_night
  or new.created_at         is distinct from old.created_at then
    raise exception
      'el pedido % tiene columnas inmutables: store_id, public_token, idempotency_key, subtotal_cents, total_cents, currency, payment_method, delivery_method, delivery_fee_cents, scheduled_for, fire_at, scheduled_night, created_at',
      old.id
      using errcode = 'check_violation';
  end if;

  -- [TRANSFER] (b) Un comprobante por pedido, y la base es el árbitro.
  --
  -- El cliente tiene UNA oportunidad de subir: si se equivoca, el local le
  -- escribe por WhatsApp y resuelve a mano. Sin esta guarda, cualquiera con el
  -- `public_token` podría reescribir el comprobante todas las veces que
  -- quisiera pegándole a PostgREST, y la regla de negocio viviría solo en un
  -- `if` de TypeScript.
  --
  -- Nulear el PATH sí está permitido: eso es la purga del archivo, que corre
  -- después. Lo inmutable es el sello de tiempo, o sea el hecho de que hubo
  -- comprobante.
  if old.transfer_receipt_uploaded_at is not null
     and new.transfer_receipt_uploaded_at is distinct from old.transfer_receipt_uploaded_at then
    raise exception 'el pedido % ya tiene un comprobante: no se puede reemplazar', old.id
      using errcode = 'check_violation';
  end if;

  -- El repartidor asignado tiene que ser un repartidor ACTIVO de ESTA tienda.
  --
  -- La alternativa canónica del repo sería una FK compuesta
  -- (store_id, courier_id), como `products_category_same_store_fkey`. Se
  -- descartó: una segunda FK desde `orders` que incluya `store_id` arriesga
  -- volver ambiguo el embed `stores ( * )` de
  -- ORDER_WITH_ITEMS_AND_STORE_SELECT, del que dependen el seguimiento público
  -- entero y el webhook de Mercado Pago. Acá la invariante se cierra igual, y
  -- para todos los roles: service_role incluido, que es donde vive la acción.
  if new.courier_id is distinct from old.courier_id and new.courier_id is not null then
    if not exists (
      select 1 from public.store_members m
       where m.id       = new.courier_id
         and m.store_id = new.store_id
         and m.role     = 'courier'
         and m.is_active
    ) then
      raise exception 'el repartidor % no es un repartidor activo de la tienda del pedido %',
        new.courier_id, old.id
        using errcode = 'check_violation';
    end if;
    new.assigned_at := now();
  end if;

  if new.status is distinct from old.status then
    -- Se permite UN paso atras dentro de la cocina porque un toque equivocado en
    -- hora pico esta garantizado; `delivered` y `cancelled` son terminales.
    --
    -- `ready -> delivered` se mantiene: es el camino de todo pedido de retiro, y
    -- el de un delivery que el cliente termina pasando a buscar.
    allowed := case old.status
                 when 'pending'    then array['confirmed','cancelled']
                 when 'confirmed'  then array['preparing','cancelled']
                 when 'preparing'  then array['ready','confirmed','cancelled']
                 when 'ready'      then array['delivered','on_the_way','preparing','cancelled']
                 when 'on_the_way' then array['delivered','ready','cancelled']
                 else array[]::text[]
               end;

    if not (new.status = any (allowed)) then
      raise exception 'transicion de estado ilegal en el pedido %: % -> %',
        old.id, old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- La comida no sale sin plata asegurada.
    --
    -- [TRANSFER] (a) El predicado es `<> 'in_store'`, no `= 'online'`: el pago
    -- en el local es el ÚNICO que puede entrar a la cocina impago, porque ahí el
    -- cobro es presencial. Una transferencia sin confirmar es plata que todavía
    -- no está, así que no confirma — y el día que se agregue un cuarto medio de
    -- pago, el default va a ser el seguro sin que nadie se acuerde de tocar acá.
    if new.status = 'confirmed'
       and new.payment_method <> 'in_store'
       and new.payment_status <> 'approved' then
      raise exception 'el pedido % es de pago % y todavia no esta pago: no puede pasar a confirmed',
        old.id, new.payment_method
        using errcode = 'check_violation';
    end if;

    -- Un pedido no puede "salir a repartir" si no hay nada que repartir ni
    -- nadie que lo lleve.
    if new.status = 'on_the_way' then
      if new.delivery_method <> 'delivery' then
        raise exception 'el pedido % es de retiro en el local: no puede ir en camino', old.id
          using errcode = 'check_violation';
      end if;
      if new.courier_id is null then
        raise exception 'el pedido % no tiene repartidor asignado: no puede ir en camino', old.id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. `expire_pending_orders` — ahora barre también las transferencias
--
-- Hasta acá el `where` filtraba `payment_method = 'online'`, así que una
-- transferencia abandonada quedaba `pending` PARA SIEMPRE, ocupando su
-- `short_code` y contando como pedido activo del local.
--
-- Dos ventanas distintas porque son dos abandonos distintos: el de online son
-- 45 minutos (el cliente cerró el checkout de Mercado Pago), el de transferencia
-- son 120 porque el cliente tiene que salir de la app, abrir el homebanking y
-- volver.
--
-- CON comprobante NO se cancela nunca sola: hay plata declarada y esa decisión
-- es de una persona. Queda en la bandeja del KDS.
--
-- `drop function` explícito: agregar un parámetro crea una SOBRECARGA, no
-- reemplaza la función, y pg_cron seguiría llamando a la vieja.
-- ---------------------------------------------------------------------------

drop function if exists public.expire_pending_orders(int);

create or replace function public.expire_pending_orders(
  p_minutes          int default 45,
  p_transfer_minutes int default 120
)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with expired as (
    update public.orders o
       set status = 'cancelled'
     where o.payment_status = 'pending'
       and o.status = 'pending'
       and (
         (o.payment_method = 'online'
          and o.created_at < now() - (p_minutes * interval '1 minute'))
         or
         (o.payment_method = 'transfer'
          and o.transfer_receipt_uploaded_at is null
          and o.created_at < now() - (p_transfer_minutes * interval '1 minute'))
       )
       -- Nunca cancelar algo que tenga un pago aprobado registrado: si el
       -- webhook fallo pero la plata entro, lo resuelve la conciliacion. Para
       -- transferencia es la misma red: la fila de `payments` que deja la
       -- confirmacion la protege del barrido sin una linea extra.
       and not exists (
         select 1 from public.payments p
          where p.order_id = o.id and p.status = 'approved'
       )
    returning o.id
  )
  select count(*)::int into v_count from expired;

  return v_count;
end;
$$;

revoke execute on function public.expire_pending_orders(int, int) from public, anon, authenticated;
grant  execute on function public.expire_pending_orders(int, int) to service_role;


-- ---------------------------------------------------------------------------
-- 7. `platform_stores()` — SEXTA reescritura completa
--
-- No hay `create or replace` parcial de un SELECT: la función se copia entera y
-- se le suma la columna. Sin esto `transfer_payment_enabled` DESAPARECE sin
-- error del backoffice, que es exactamente la trampa que CLAUDE.md documenta.
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
             s.in_store_payment_enabled, s.online_payment_enabled,
             s.transfer_payment_enabled, s.min_order_cents,
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


-- ---------------------------------------------------------------------------
-- 8. Bucket `order-receipts` — PRIVADO, y sin una sola policy
--
-- Es el primer bucket privado del proyecto: `product-images` es público porque
-- una foto de hamburguesa es material de venta. Un comprobante de transferencia
-- es un documento bancario de una persona, con su nombre y a veces su CUIT.
--
-- CERO policies a propósito, y no es un olvido: el único camino de escritura y
-- de lectura es `service_role`, que bypassea RLS. El cliente sube por nuestro
-- route handler (que valida el `public_token`, el MIME por magic bytes y el
-- tamaño) y el staff mira por una signed URL de corta vida. Ni `anon` ni
-- `authenticated` tienen forma de tocar este bucket, ni siquiera adivinando el
-- path.
--
-- `allowed_mime_types` angosto a propósito: el browser del cliente siempre
-- produce JPEG (la compresión pasa por canvas) y el PDF es el único pasajero
-- crudo, porque el comprobante del homebanking suele ser PDF y el cliente tiene
-- una sola oportunidad de subir.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-receipts',
  'order-receipts',
  false,
  5242880,  -- 5 MB
  array['image/jpeg', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
