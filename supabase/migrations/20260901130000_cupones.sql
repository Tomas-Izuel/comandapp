-- ---------------------------------------------------------------------------
-- Cupones de descuento, con reserva de uso.
--
-- El código es COMPARTIDO: un cupón, un código, y si se filtra lo usa
-- cualquiera. Decisión del dueño del producto, tomada informada. La
-- consecuencia de diseño es que los topes —fechas, usos totales, usos por
-- teléfono, mínimo de subtotal y método de pago— son la ÚNICA defensa de plata,
-- así que se escriben como invariantes de base y no como validaciones de app.
--
-- Y el uso no se cuenta: se RESERVA. Se bloquea al crear el pedido, se confirma
-- cuando la comida sale, y se libera si el pedido muere sin que nunca hubiera
-- plata. Sin la reserva, cien pedidos simultáneos con un cupón de cincuenta
-- usos entran TODOS, porque en el momento de crearse ninguno está confirmado.
--
-- NOTA: los slugs reservados (`promos`, `ventas`, `sales`) ya entraron en
-- `20260901120000_clientes.sql` junto con `baja`. Acá NO se vuelve a tocar
-- `stores_slug_not_reserved_check`: un drop-and-add con una lista que no
-- incluyera `baja` lo borraría en silencio.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------

create table if not exists public.coupons (
  id                        bigint generated always as identity primary key,
  store_id                  bigint not null references public.stores(id) on delete cascade,

  name                      text   not null,
  code                      text   not null,

  discount_type             text   not null check (discount_type in ('percentage','fixed')),
  percent                   int,
  amount_off_cents          bigint,
  max_discount_cents        bigint,

  min_subtotal_cents        bigint not null default 0 check (min_subtotal_cents >= 0),

  starts_at                 timestamptz,
  ends_at                   timestamptz,

  max_redemptions           int    not null check (max_redemptions > 0),
  max_redemptions_per_phone int    default 1 check (max_redemptions_per_phone is null
                                                    or max_redemptions_per_phone > 0),

  -- DOS contadores, no uno. Una reserva ocupa cupo igual que un canje, pero el
  -- panel tiene que poder distinguir "12 canjes" de "12 pedidos en vuelo".
  -- Los mantiene private.sync_coupon_counters() RECALCULANDO desde el libro
  -- mayor; nadie los escribe a mano, en ningún camino.
  reserved_count            int    not null default 0 check (reserved_count >= 0),
  redeemed_count            int    not null default 0 check (redeemed_count >= 0),

  payment_methods           text[],

  status                    text   not null default 'draft'
                              check (status in ('draft','active','paused')),

  created_by                uuid   references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (store_id, code),
  -- Para la FK compuesta de coupon_redemptions: un cupón de otra tienda no
  -- entra ni por PostgREST. Mismo patrón que products_category_same_store_fkey.
  unique (store_id, id)
);

comment on table public.coupons is
  'Cupones de descuento por tienda. Código compartido: los topes son la única defensa de plata.';
comment on column public.coupons.max_redemptions is
  'NOT NULL a propósito: con código compartido, un cupón sin tope es un cheque en blanco. Si el dueño quiere "muchos", pone 1000.';
comment on column public.coupons.max_redemptions_per_phone is
  'Se llama _per_phone y no _per_customer porque cuenta contra el teléfono tipeado en el checkout, que es suplantable. Freno blando, no garantía.';
comment on column public.coupons.reserved_count is
  'Reservas vivas. Lo mantiene el trigger recalculando desde coupon_redemptions.';
comment on column public.coupons.redeemed_count is
  'Canjes concretados. MONÓTONO CRECIENTE: una confirmación nunca se deshace, y de eso depende la garantía de plata.';
comment on column public.coupons.status is
  'draft | active | paused. `expired` y `exhausted` NO se persisten: se derivan de ends_at y de los contadores, porque un estado guardado que un cron da vuelta miente entre ticks.';
comment on column public.coupons.payment_methods is
  'null = todos los métodos. El CHECK hace inrepresentable el array vacío, que significaría "ningún método" y sería plata muerta.';

do $$
begin
  -- El tipo y el valor no pueden contradecirse. Un tope de descuento sobre un
  -- monto fijo no significa nada, así que se prohíbe en vez de ignorarse.
  if not exists (select 1 from pg_constraint where conname = 'coupons_shape_check') then
    alter table public.coupons add constraint coupons_shape_check check (
      (discount_type = 'percentage'
         and percent between 1 and 100
         and amount_off_cents is null
         -- El SIGNO, no solo la presencia. `couponInputSchema` ya exige
         -- `.positive()` en el borde de Zod, pero `service_role` no pasa por
         -- Zod: una carga masiva o un segundo camino de escritura podría dejar
         -- un 0 o un negativo acá, y `create_order` hace
         -- `least(v_discount, max_discount_cents)` sin mirar el signo. El
         -- resultado negativo reventaría contra
         -- `coupon_redemptions.discount_cents >= 0` con un 23514 crudo, que es
         -- exactamente lo que los marcadores CPN0x existen para evitar.
         and (max_discount_cents is null or max_discount_cents > 0))
      or (discount_type = 'fixed'
         and amount_off_cents > 0
         and percent is null
         and max_discount_cents is null)
    );
  end if;

  -- LA defensa contra la carrera del último uso, y ni service_role la esquiva.
  -- Sobre la SUMA, porque una reserva ocupa cupo igual que un canje.
  if not exists (select 1 from pg_constraint where conname = 'coupons_within_cap_check') then
    alter table public.coupons add constraint coupons_within_cap_check
      check (reserved_count + redeemed_count <= max_redemptions);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'coupons_payment_methods_check') then
    -- ⚠️ `cardinality`, NO `array_length`. Para un array vacío
    -- `array_length(x, 1)` devuelve NULL —no 0— así que el `between` da NULL,
    -- todo el predicado da NULL, y un CHECK sólo rechaza cuando da FALSE: el
    -- array vacío ENTRABA. Y un array vacío significa "ningún método de pago
    -- sirve", o sea un cupón que no se puede usar nunca, en silencio.
    -- `cardinality` devuelve 0 y lo rechaza. Verificado a mano.
    alter table public.coupons add constraint coupons_payment_methods_check check (
      payment_methods is null
      or (cardinality(payment_methods) between 1 and 3
          and payment_methods <@ array['online','in_store','transfer']::text[])
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'coupons_window_check') then
    alter table public.coupons add constraint coupons_window_check
      check (ends_at is null or starts_at is null or ends_at > starts_at);
  end if;

  -- Corto y hablable en el mostrador: el dueño lo canta por teléfono.
  if not exists (select 1 from pg_constraint where conname = 'coupons_code_check') then
    alter table public.coupons add constraint coupons_code_check
      check (code ~ '^[A-Z0-9]{4,16}$');
  end if;
end;
$$;

create index if not exists coupons_store_idx on public.coupons (store_id);
-- Los cupones que la vitrina puede llegar a validar. Parcial porque un local
-- acumula borradores y pausados que nunca se consultan por código.
create index if not exists coupons_store_active_idx on public.coupons (store_id, code)
  where status = 'active';

drop trigger if exists coupons_set_updated_at on public.coupons;

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- coupon_redemptions — el libro mayor, con TRES estados
--
-- Una reserva liberada NO se borra: se marca. El libro mayor tiene que poder
-- contestar "acá hubo una reserva que no se concretó", porque es la única forma
-- de explicarle al dueño por qué el cupón dice 12 canjes y él contó 15 pedidos.
-- ---------------------------------------------------------------------------

create table if not exists public.coupon_redemptions (
  id                  bigint generated always as identity primary key,
  store_id            bigint not null,
  coupon_id           bigint not null,
  order_id            bigint not null references public.orders(id) on delete cascade,
  -- Denormalizado, y no `customer_id`, por dos razones: el tope por teléfono se
  -- cuenta acá adentro de la transacción de create_order, y en ese momento la
  -- fila de store_customers TODAVÍA NO EXISTE (su trigger es AFTER INSERT de
  -- orders). Y el padrón puede borrarse sin perder el libro mayor.
  customer_phone_e164 text   not null,
  discount_cents      bigint not null check (discount_cents >= 0),

  -- Nace 'reserved' SIEMPRE: nadie inserta un 'redeemed'.
  status              text   not null default 'reserved'
                        check (status in ('reserved','redeemed','released')),
  released_reason     text   check (released_reason is null
                                    or released_reason in ('expired','cancelled_unpaid')),

  created_at          timestamptz not null default now(),
  redeemed_at         timestamptz,
  released_at         timestamptz,

  -- "Un cupón por pedido" vive en un índice único, no en un `if`: no hay
  -- stacking porque la base no lo permite. Y es la segunda red contra un doble
  -- consumo del mismo pedido — si el bloque del cupón corriera dos veces, el
  -- segundo insert rebota con 23505.
  unique (order_id),

  constraint coupon_redemptions_coupon_same_store_fkey
    foreign key (store_id, coupon_id)
    references public.coupons (store_id, id) on delete restrict
);

comment on table public.coupon_redemptions is
  'Libro mayor de reservas y canjes. Una fila por pedido; lo que se mueve es su status. Fuente de verdad de los contadores de coupons.';
comment on column public.coupon_redemptions.status is
  'reserved (ocupa cupo) | redeemed (la comida salió) | released (el pedido murió sin que hubiera plata). Una liberada no se borra: queda marcada.';

create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_order_idx  on public.coupon_redemptions (order_id);
create index if not exists coupon_redemptions_store_idx  on public.coupon_redemptions (store_id);
-- Parciales: el tope por teléfono y el recálculo del contador cuentan SOLO lo
-- que ocupa cupo. Una reserva liberada no consumió la cuota de esa persona.
create index if not exists coupon_redemptions_coupon_phone_idx
  on public.coupon_redemptions (coupon_id, customer_phone_e164)
  where status in ('reserved','redeemed');
create index if not exists coupon_redemptions_live_idx
  on public.coupon_redemptions (coupon_id, status)
  where status in ('reserved','redeemed');

-- ---------------------------------------------------------------------------
-- El candado y el off-by-one.
--
-- El CHECK de la tabla no alcanza solo: sin lock, dos transacciones
-- concurrentes no ven la fila no-commiteada de la otra, cada trigger recalcula
-- 49, las dos pasan, y una revienta con un 23514 crudo DESPUÉS de haber hecho
-- todo el trabajo.
--
-- El lock vive acá, en el trigger, y no solo en create_order: así TODO camino
-- de inserción se serializa sobre la fila del cupón y la garantía deja de
-- depender de que el llamador se acuerde.
--
-- ⚠️ LA COMPARACIÓN ES ESTRICTAMENTE MENOR. Los contadores todavía NO incluyen
-- la fila que se está insertando, así que con `<=` el cupón admite
-- max_redemptions + 1 reservas y el CHECK de la tabla las rechaza con un error
-- crudo. Es el bug más fácil de escribir de todo el feature. El CHECK usa `<=`
-- porque ahí los contadores ya están actualizados; acá va `<`.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_coupon_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons;
begin
  select * into v_coupon
    from public.coupons
   where id = new.coupon_id
     for update;

  if not found then
    raise exception 'el cupon no existe' using errcode = 'CPN01';
  end if;

  if v_coupon.status <> 'active' then
    raise exception 'el cupon no esta activo' using errcode = 'CPN02';
  end if;

  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'el cupon todavia no empezo' using errcode = 'CPN03';
  end if;

  if v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
    raise exception 'el cupon vencio' using errcode = 'CPN04';
  end if;

  -- Estrictamente menor. Ver la nota de arriba.
  if v_coupon.reserved_count + v_coupon.redeemed_count >= v_coupon.max_redemptions then
    raise exception 'el cupon se agoto' using errcode = 'CPN05';
  end if;

  if v_coupon.max_redemptions_per_phone is not null then
    if (select count(*)
          from public.coupon_redemptions r
         where r.coupon_id = new.coupon_id
           and r.customer_phone_e164 = new.customer_phone_e164
           and r.status in ('reserved','redeemed')
       ) >= v_coupon.max_redemptions_per_phone then
      raise exception 'ese telefono ya uso este cupon' using errcode = 'CPN06';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.enforce_coupon_redemption() is
  'Toma el lock de la fila del cupón y valida estado, ventana y topes ANTES de insertar la reserva. La comparación del tope global es estrictamente menor: los contadores no incluyen todavía la fila que se inserta.';

drop trigger if exists coupon_redemptions_enforce on public.coupon_redemptions;

create trigger coupon_redemptions_enforce
  before insert on public.coupon_redemptions
  for each row execute function private.enforce_coupon_redemption();

-- ---------------------------------------------------------------------------
-- Los contadores se RECALCULAN desde el libro mayor, nunca se incrementan.
--
-- Mismo criterio y mismo comentario que sync_store_transfer_payment y
-- sync_store_customer: un recálculo no puede quedar desincronizado por un
-- camino que no previmos, y una deducción de new/old sí. Acá compra tres cosas:
-- el libro mayor es la única fuente de verdad, los contadores no pueden
-- driftear por construcción, y cualquier camino futuro que toque el libro mayor
-- mantiene los contadores solo.
-- ---------------------------------------------------------------------------

create or replace function private.sync_coupon_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon_id bigint := coalesce(new.coupon_id, old.coupon_id);
begin
  -- ⚠️ EL LOCK VA ANTES DEL RECÁLCULO, Y NO ES DEFENSA EN PROFUNDIDAD.
  --
  -- Bajo Read Committed, un `UPDATE ... FROM (subquery)` que se bloquea
  -- esperando la fila de `coupons` re-evalúa por EvalPlanQual **solo** la
  -- condición sobre la fila objetivo: la subquery contra `coupon_redemptions`
  -- ya quedó fijada con el snapshot de ANTES de bloquearse. O sea que el
  -- recálculo escribe un conteo viejo.
  --
  -- Escenario concreto: T1 (`create_order` con el cupón X) tiene el lock de esa
  -- fila vía `enforce_coupon_redemption` y no commiteó. T2 (la cocina cancela
  -- otro pedido del mismo cupón) entra acá, se bloquea, y su conteo quedó sin
  -- la reserva de T1. T1 commitea, T2 se destraba y **pisa los contadores sin
  -- la reserva de T1**. El conteo queda bajo, y el siguiente recálculo correcto
  -- puede toparse con `coupons_within_cap_check` y abortar una transición
  -- legítima de cocina con un 23514.
  --
  -- Con el lock tomado explícitamente antes, la sentencia siguiente arranca su
  -- snapshot recién después de la espera, así que ve todo lo commiteado
  -- mientras esperaba.
  perform 1 from public.coupons where id = v_coupon_id for update;

  update public.coupons c
     set reserved_count = agg.reserved,
         redeemed_count = agg.redeemed
    from (
      select count(*) filter (where r.status = 'reserved') as reserved,
             count(*) filter (where r.status = 'redeemed') as redeemed
        from public.coupon_redemptions r
       where r.coupon_id = v_coupon_id
    ) agg
   where c.id = v_coupon_id;

  return null;
end;
$$;

comment on function private.sync_coupon_counters() is
  'Recalcula reserved_count y redeemed_count desde coupon_redemptions. Nunca incrementa: el libro mayor es la fuente de verdad.';

drop trigger if exists coupon_redemptions_sync_counters on public.coupon_redemptions;

create trigger coupon_redemptions_sync_counters
  after insert or update of status or delete on public.coupon_redemptions
  for each row execute function private.sync_coupon_counters();

-- ---------------------------------------------------------------------------
-- La proyección del ciclo del pedido sobre el libro mayor.
--
-- "Se completa" = `delivered`. Es la confirmación de la COCINA, no del dinero:
-- un pedido in_store está impago hasta que alguien cobra, así que atar la
-- confirmación al pago dejaría la reserva abierta toda la cocción.
--
-- "No se completa" = `cancelled` AND `paid_at IS NULL`, o sea el pedido murió
-- sin que nunca hubiera plata. Una sola condición cubre los dos caminos porque
-- expire_pending_orders NO borra: hace `set status = 'cancelled'`. Por eso ese
-- cron y el de conciliación NO se tocan.
--
-- Deliberadamente NO va adentro de enforce_order_rules: ése es un BEFORE que
-- valida, éste un AFTER que proyecta, y mezclarlos haría que un fallo de
-- escritura del libro mayor aborte una transición legítima de la cocina.
--
-- ⚠️ Un error acá aborta la transición del pedido, así que nada externo en el
-- cuerpo: sin casts que puedan fallar, sin lecturas de otras tiendas.
-- ---------------------------------------------------------------------------

create or replace function private.sync_coupon_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' then
    update public.coupon_redemptions
       set status      = 'redeemed',
           redeemed_at = now()
     where order_id = new.id
       and status   = 'reserved';

  elsif new.status = 'cancelled' and new.paid_at is null then
    -- QUIÉN canceló, no solo QUE se canceló.
    --
    -- El CHECK declara dos motivos y hasta acá uno era inalcanzable: toda
    -- liberación quedaba `cancelled_unpaid`, así que un carrito abandonado que
    -- barrió el cron y una cancelación a mano del mostrador se leían idénticos
    -- en la traza. Es justo la pregunta que la lista de canjes existe para
    -- contestar: ¿la promoción se está abandonando sola, o el staff la está
    -- cancelando?
    --
    -- El discriminador es `auth.uid()`, que es null para `service_role`. Los
    -- únicos caminos del servidor que cancelan un pedido impago son
    -- `expire_pending_orders` (el barrido de abandonados) y la conciliación:
    -- los dos son "venció" en sentido de producto. El staff cancela con el
    -- cliente de SESIÓN —`orders` tiene `grant update (status)` para
    -- `authenticated`— así que ahí sí hay uid.
    --
    -- El límite, dicho con los ojos abiertos: si algún día aparece OTRO camino
    -- de servidor que cancele un pedido impago y no sea un vencimiento, va a
    -- quedar etiquetado `expired`. Se prefiere eso a la alternativa, que era
    -- que `expired` no existiera nunca. `expire_pending_orders` NO se toca.
    update public.coupon_redemptions
       set status          = 'released',
           released_reason = case when (select auth.uid()) is null
                                    then 'expired'
                                    else 'cancelled_unpaid'
                              end,
           released_at     = now()
     where order_id = new.id
       and status   = 'reserved';
  end if;

  return null;
end;
$$;

comment on function private.sync_coupon_reservation() is
  'Proyecta el ciclo del pedido sobre el libro mayor: delivered confirma la reserva, cancelled sin paid_at la libera. Un reembolso NO libera: ahí hubo plata.';

drop trigger if exists orders_sync_coupon_reservation on public.orders;

create trigger orders_sync_coupon_reservation
  after update of status on public.orders
  for each row execute function private.sync_coupon_reservation();

-- ---------------------------------------------------------------------------
-- Campañas
-- ---------------------------------------------------------------------------

create table if not exists public.coupon_campaigns (
  id                      bigint generated always as identity primary key,
  store_id                bigint not null references public.stores(id) on delete cascade,
  coupon_id               bigint not null references public.coupons(id) on delete restrict,

  -- La DEFINICIÓN del segmento, para que el dueño vea qué pidió y pueda
  -- repetirlo. La LISTA de destinatarios se congela aparte, en
  -- campaign_recipients: son dos cosas distintas a propósito.
  segment_kind            text   not null check (segment_kind in ('all','top_n','min_spent')),
  segment_top_n           int    check (segment_top_n is null or segment_top_n > 0),
  segment_min_spent_cents bigint check (segment_min_spent_cents is null
                                        or segment_min_spent_cents >= 0),

  subject                 text   not null,
  message                 text,

  status                  text   not null default 'queued'
                            check (status in ('queued','sending','sent','stopped','failed')),
  -- `stopped` = la OFERTA dejó de valer. Distinto de `failed`, que es que falló
  -- lo NUESTRO y conviene reintentar. Enum cerrado y no texto libre: es lo que
  -- la pantalla traduce a una frase, y un texto libre se mostraría crudo.
  -- `no_recipients` no es un motivo de cupón: es que al momento de drenar no
  -- quedaba nadie a quien mandarle (todos se dieron de baja, o perdieron su fila
  -- del padrón, entre el encolado y el envío). Existe para que ese caso no se
  -- reporte como `sent`: una campaña verde con `sent_count = 0` es la misma
  -- falla silenciosa-con-cara-de-éxito que ya se cerró en settle.
  stopped_reason          text   check (stopped_reason is null
                                        or stopped_reason in ('coupon_expired',
                                                              'coupon_exhausted',
                                                              'coupon_paused',
                                                              'no_recipients')),
  recipients_total        int    not null default 0 check (recipients_total >= 0),
  sent_count              int    not null default 0 check (sent_count >= 0),
  failed_count            int    not null default 0 check (failed_count >= 0),
  skipped_count           int    not null default 0 check (skipped_count >= 0),

  created_by              uuid   references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  finished_at             timestamptz,

  -- Para la FK compuesta de campaign_recipients. Mismo patrón que coupons.
  unique (store_id, id)
);

comment on table public.coupon_campaigns is
  'Envío de un cupón por mail a un segmento del padrón. El cupo diario de Resend es la cota real: una campaña grande tarda días.';

create table if not exists public.campaign_recipients (
  id              bigint generated always as identity primary key,
  -- Sin FK de una sola columna a propósito: abajo va la COMPUESTA
  -- (store_id, campaign_id), que da lo mismo más el aislamiento por tienda. Dos
  -- FK a la misma tabla vuelven AMBIGUO el embed `coupon_campaigns(...)` de
  -- PostgREST y la lectura empieza a devolver 300 — es la misma trampa que la
  -- migración de delivery documentó para orders/stores.
  campaign_id     bigint not null,
  store_id        bigint not null,
  -- ON DELETE SET NULL: si el padrón pierde la fila, el log del envío
  -- sobrevive. Lo que se mandó, se mandó.
  customer_id     bigint references public.store_customers(id) on delete set null,

  -- Congelado, tal como se manda.
  email           text   not null,
  -- PERSISTIDO, no calculado. De acá sale la clave de idempotencia de Resend, y
  -- tiene que ser estable entre reintentos: si el chunk se recalculara en vivo,
  -- un reintento con la membresía cambiada produce el mismo key con otro payload
  -- y Resend devuelve 409 invalid_idempotent_request.
  chunk_index     int    not null check (chunk_index >= 0),

  status          text   not null default 'queued'
                    check (status in ('queued','sent','failed','skipped')),
  attempts        int    not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error      text,
  provider_ref    text,
  sent_at         timestamptz,
  -- Cuándo se encoló. Es lo que la retención mira para purgar los `skipped`,
  -- que nunca llegan a tener `sent_at`.
  created_at      timestamptz not null default now(),

  -- Nadie recibe dos veces el mismo mail en la misma campaña, aunque dos filas
  -- del padrón compartan casilla.
  unique (campaign_id, email),

  -- Un destinatario de la campaña de otra tienda no entra ni por PostgREST.
  -- Mismo patrón que coupon_redemptions y products_category_same_store_fkey:
  -- el aislamiento por tienda no depende de que la RPC pase el store_id bien.
  constraint campaign_recipients_campaign_same_store_fkey
    foreign key (store_id, campaign_id)
    references public.coupon_campaigns (store_id, id) on delete cascade
);

comment on column public.campaign_recipients.status is
  'skipped existe para un caso concreto: el cliente se dio de baja ENTRE el encolado y el envío. El drenaje lo re-chequea antes de mandar.';

create index if not exists coupon_campaigns_store_idx     on public.coupon_campaigns (store_id);
create index if not exists coupon_campaigns_coupon_idx    on public.coupon_campaigns (coupon_id);
create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index if not exists campaign_recipients_customer_idx on public.campaign_recipients (customer_id);
-- La cola del cron. Parcial: los pendientes son una minoría del log histórico.
create index if not exists campaign_recipients_pending_idx
  on public.campaign_recipients (chunk_index, id)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- RLS y grants de las cuatro tablas nuevas.
--
-- Cero policies y cero columnas otorgadas. No hay UNA columna en `coupons` que
-- el browser deba poder escribir: cada una es plata (percent, amount_off_cents,
-- max_discount_cents, min_subtotal_cents) o alcance (starts_at, ends_at,
-- max_redemptions, payment_methods, status). Otorgar cualquiera abre un
-- PATCH /rest/v1/coupons que edita un descuento. Y coupon_redemptions es el
-- libro mayor: nadie lo escribe salvo la transacción del pedido.
--
-- El grant a service_role es explícito porque Supabase NO le da privilegios
-- sobre las tablas que crea una migración.
--
-- Consecuencia esperada: las cuatro aparecen en get_advisors como
-- rls_enabled_no_policy, en INFO. Es correcto. No se arregla.
-- ---------------------------------------------------------------------------

alter table public.coupons             enable row level security;
alter table public.coupon_redemptions  enable row level security;
alter table public.coupon_campaigns    enable row level security;
alter table public.campaign_recipients enable row level security;

revoke all on public.coupons             from anon, authenticated;
revoke all on public.coupon_redemptions  from anon, authenticated;
revoke all on public.coupon_campaigns    from anon, authenticated;
revoke all on public.campaign_recipients from anon, authenticated;

grant select, insert, update, delete on public.coupons             to service_role;
grant select, insert, update, delete on public.coupon_redemptions  to service_role;
grant select, insert, update, delete on public.coupon_campaigns    to service_role;
grant select, insert, update, delete on public.campaign_recipients to service_role;

-- ---------------------------------------------------------------------------
-- El descuento en el pedido.
--
-- Ningún grant nuevo: `orders` ya tiene `revoke update from authenticated` más
-- `grant update (status)` y nada más, así que estas dos columnas quedan fuera
-- del alcance del browser del staff sin agregar un solo revoke.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists discount_cents       bigint not null default 0,
  add column if not exists coupon_code_snapshot text;

comment on column public.orders.discount_cents is
  'Centavos enteros, nunca negativo. Congelado: es el descuento que se aplicó, no el que el cupón daría hoy.';
comment on column public.orders.coupon_code_snapshot is
  'El código tal como se canjeó. Doctrina de snapshot, igual que order_items.name_snapshot: el comprobante tiene que poder decir QUÉ cupón se usó aunque después se renombre.';

-- ---------------------------------------------------------------------------
-- El swap del CHECK del total.
--
-- Se dropea por INTROSPECCIÓN y no por nombre: un `if not exists` sobre un
-- nombre que no matchea el real se saltea el drop, deja el CHECK viejo en pie,
-- y el `add` del nuevo falla — o peor, los dos quedan y ningún pedido con
-- descuento entra nunca.
--
-- El CHECK viejo existía porque create_order enumera columnas a mano y
-- olvidarse de delivery_fee_cents REGALABA EL ENVÍO EN SILENCIO. El nuevo
-- conserva esa propiedad y la extiende: cubre tres términos en vez de dos, así
-- que un create_order que calcula un descuento y se olvida de pasarlo produce
-- `total <> subtotal - 0 + fee` y explota con 23514 en el primer pedido.
--
-- El segundo CHECK ataja lo que el primero no: un cupón de monto fijo más
-- grande que el carrito. Sin él, con un envío suficientemente caro el total
-- queda POSITIVO y el local termina pagándole al cliente por comer.
--
-- Entra sin backfill: toda fila existente tiene discount_cents = 0 por el
-- default, así que `total = subtotal - 0 + fee` es exactamente el CHECK viejo.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.orders'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) like '%subtotal_cents%delivery_fee_cents%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;

  if not exists (select 1 from pg_constraint
                  where conname = 'orders_total_is_subtotal_minus_discount_plus_delivery_check') then
    alter table public.orders
      add constraint orders_total_is_subtotal_minus_discount_plus_delivery_check
        check (total_cents = subtotal_cents - discount_cents + delivery_fee_cents);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'orders_discount_within_subtotal_check') then
    alter table public.orders
      add constraint orders_discount_within_subtotal_check
        check (discount_cents <= subtotal_cents);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- store_pending_changes: el cupón como cambio sensible.
--
-- El CHECK de `kind` se ensancha con drop-por-introspección, que es el patrón
-- que la migración de transferencia ya usó: un `if not exists` sobre el nombre
-- encuentra el constraint viejo, se saltea el add, y deja en pie la lista corta.
--
-- Y `subject_id` NO es una preferencia: es un bug encontrado leyendo el código.
-- El índice `store_pending_changes_live_idx` es (store_id, kind) y su propio
-- comentario dice que existe "para invalidarlo cuando se pide uno nuevo". Con
-- los tres kind que existían hay a lo sumo UNA cosa de cada clase por tienda,
-- así que invalidar el anterior es correcto. Con cupones NO: el dueño activa el
-- cupón A, después el B, y la invalidación por (store_id, 'coupon') le mata el
-- código de A SIN DECIRLE NADA — y el síntoma es "tipeé el código que me llegó
-- y no funciona", indistinguible de un bug del segundo factor.
--
-- ⚠️ El índice SE DROPEA Y SE RECREA. Un `create index if not exists` con el
-- mismo nombre y otra definición NO HACE NADA Y NO AVISA.
--
-- ⚠️ Y en la query de invalidación va `.is('subject_id', null)`, nunca
-- `.eq('subject_id', null)`.
-- ---------------------------------------------------------------------------

alter table public.store_pending_changes
  add column if not exists subject_id bigint;

comment on column public.store_pending_changes.subject_id is
  'A QUÉ entidad aplica el cambio (hoy: coupon_id). Null para los kind que tienen una sola instancia por tienda. Sin esto, activar un cupón invalida el código del anterior en silencio.';

do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.store_pending_changes'::regclass
       and contype  = 'c'
       -- Se matchea contra un valor que la lista vigente TIENE ('bank_account')
       -- en vez de contra la palabra "kind", que también aparecería en un
       -- constraint futuro sobre otra columna con ese nombre.
       and pg_get_constraintdef(oid) like '%bank_account%'
       and pg_get_constraintdef(oid) not like '%coupon%'
  loop
    execute format('alter table public.store_pending_changes drop constraint %I', r.conname);
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'store_pending_changes_kind_check') then
    alter table public.store_pending_changes
      add constraint store_pending_changes_kind_check
        -- Los tres primeros son los vigentes, LEÍDOS de la base y no deducidos
        -- de los nombres de las features: el cambio de credenciales es
        -- 'payment_credentials' y el del repartidor 'courier_payment_policy'.
        -- Escribirlos de memoria acá rechaza todos los kind que ya existen y
        -- rompe el cambio de Mercado Pago y el de cuenta bancaria.
        check (kind in ('payment_credentials', 'courier_payment_policy', 'bank_account', 'coupon'));
  end if;
end;
$$;

drop index if exists public.store_pending_changes_live_idx;

create index store_pending_changes_live_idx
  on public.store_pending_changes (store_id, kind, subject_id)
  where consumed_at is null;

-- ---------------------------------------------------------------------------
-- private.enforce_order_rules — REDEFINICIÓN COMPLETA.
--
-- `create or replace` reemplaza el cuerpo ENTERO: no hay forma de "agregarle"
-- dos columnas a la lista de inmutables. Todo lo que la versión vigente
-- validaba —transiciones legales, "online impago no confirma", el comprobante
-- de transferencia irreemplazable, las dos guardas de on_the_way, la validación
-- del repartidor y el sello de assigned_at— tiene que estar acá abajo otra vez,
-- palabra por palabra. Lo que se cae en esta transcripción no falla el build ni
-- rompe un test: deja de validarse, y nadie se enteraría.
--
-- Extraída de 20260831120000_transferencia_bancaria.sql, que es la definición
-- vigente. Lo único NUEVO son `discount_cents` y `coupon_code_snapshot` en la
-- lista de inmutables: el descuento aplicado es identidad contable del pedido
-- igual que el total, y un update que lo mueva convierte el CHECK del total en
-- una mentira consistente.
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
  --
  -- [CUPON] `discount_cents` y `coupon_code_snapshot` entran por lo mismo que
  -- `total_cents`: el CHECK `total = subtotal - discount + fee` sólo garantiza
  -- que los tres números sean CONSISTENTES entre sí. Sin esta guarda, un update
  -- que baje el subtotal y suba el descuento en la misma sentencia pasa el
  -- CHECK y le regala la diferencia al pedido. Y el snapshot del código es el
  -- rastro de QUÉ cupón se usó: movible, el libro mayor y el comprobante dejan
  -- de coincidir.
  if new.store_id             is distinct from old.store_id
  or new.public_token         is distinct from old.public_token
  or new.idempotency_key      is distinct from old.idempotency_key
  or new.subtotal_cents       is distinct from old.subtotal_cents
  or new.total_cents          is distinct from old.total_cents
  or new.discount_cents       is distinct from old.discount_cents
  or new.coupon_code_snapshot is distinct from old.coupon_code_snapshot
  or new.currency             is distinct from old.currency
  or new.payment_method       is distinct from old.payment_method
  or new.delivery_method      is distinct from old.delivery_method
  or new.delivery_fee_cents   is distinct from old.delivery_fee_cents
  or new.scheduled_for        is distinct from old.scheduled_for
  or new.fire_at              is distinct from old.fire_at
  or new.scheduled_night      is distinct from old.scheduled_night
  or new.created_at           is distinct from old.created_at then
    raise exception
      'el pedido % tiene columnas inmutables: store_id, public_token, idempotency_key, subtotal_cents, total_cents, discount_cents, coupon_code_snapshot, currency, payment_method, delivery_method, delivery_fee_cents, scheduled_for, fire_at, scheduled_night, created_at',
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
-- public.create_order — REDEFINICIÓN COMPLETA.
--
-- Extraída de 20260829170000_scheduled_orders_and_hours.sql, que es la
-- definición vigente. Y esta función es el caso más caro del repo para
-- reescribir de memoria: **enumera las columnas de `orders` una por una**, así
-- que una columna que se caiga en la transcripción no falla ni avisa — el
-- pedido entra con el default y la plata o el horario se pierden en silencio.
-- Por eso se transcribe la lista completa: 26 columnas antes de este cambio,
-- 28 después.
--
-- El CHECK `total = subtotal - discount + fee` es la red de ese olvido para los
-- tres términos de plata, y es exactamente por eso que existe.
--
-- LO NUEVO, y el orden importa:
--
--  a) El bloque del cupón va DESPUÉS del `return` temprano de idempotencia.
--     Es una condición del diseño: un reintento del mismo intento de compra
--     devuelve el pedido que ganó y consume CERO usos del cupón. Si el bloque
--     estuviera arriba, cada reintento con mala señal se comería un uso.
--
--  b) `for update` sobre la fila del cupón. Redundante con el trigger a
--     propósito: sin esto, el perdedor de la carrera por el último uso recibe
--     un `23514` crudo del CHECK después de haber hecho todo el trabajo. Con
--     esto, espera y recibe un CPN05 que la capa de modelos traduce a "este
--     cupón ya se agotó". El alcance es UN cupón, no la tienda: no serializa
--     la creación de pedidos del local en hora pico.
--
--  c) Se inserta una fila `status = 'reserved'` en `coupon_redemptions` y NO se
--     toca ningún contador. Los mantiene `private.sync_coupon_counters()`
--     recalculando desde el libro mayor. No hay un solo
--     `update coupons set ... + 1` en todo el feature.
--
--  d) `coalesce((p_order ->> 'discount_cents')::bigint, 0)`. Es lo que permite
--     un solo deploy: durante la ventana en la que la migración ya está y el
--     código viejo todavía llama sin la clave, `p_order ->> 'discount_cents'`
--     es null y sin el coalesce el cast tira y **todo pedido de la ventana
--     falla**.
--
--  e) Marcador de error estable por cada rechazo (CPN01..CPN10), mismo criterio
--     que `scheduled_night_full`/BS429: la capa de modelos matchea el SQLSTATE
--     y devuelve un DomainError con texto de interfaz, en vez de filtrarle al
--     cliente el texto de una constraint.
-- ---------------------------------------------------------------------------

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store_id     bigint := (p_order ->> 'store_id')::bigint;
  v_key          text   := p_order ->> 'idempotency_key';
  v_scheduled    timestamptz := (p_order ->> 'scheduled_for')::timestamptz;
  v_night        date   := (p_order ->> 'scheduled_night')::date;
  v_capacity     int    := (p_order ->> 'night_capacity')::int;
  v_fire_at      timestamptz;
  v_taken        int;
  v_order_id     bigint;
  v_item         jsonb;
  v_item_id      bigint;
  v_option       jsonb;

  -- [CUPON] Todo lo de abajo es nuevo.
  --
  -- El código se normaliza acá además de en TS: `coupons.code` es
  -- `^[A-Z0-9]{4,16}$`, así que un `descuento10` tipeado en minúscula no
  -- matchearía y el cliente vería "el cupón no existe" — indistinguible de un
  -- código inventado, y una llamada al local.
  v_code         text   := nullif(upper(trim(p_order ->> 'coupon_code')), '');
  v_coupon       public.coupons;
  v_subtotal     bigint := (p_order ->> 'subtotal_cents')::bigint;
  v_total        bigint := (p_order ->> 'total_cents')::bigint;
  v_fee          bigint := coalesce((p_order ->> 'delivery_fee_cents')::bigint, 0);
  v_method       text   := p_order ->> 'payment_method';
  v_phone        text   := p_order ->> 'customer_phone_e164';
  -- Lo que el llamador DICE que descontó. Ver (d) arriba: el coalesce es lo que
  -- sostiene la ventana de deploy.
  v_claimed      bigint := coalesce((p_order ->> 'discount_cents')::bigint, 0);
  -- Lo que la base CALCULA. Es el que se inserta.
  v_discount     bigint := 0;
  v_used         int;
begin
  if v_store_id is null or v_key is null then
    raise exception 'create_order: faltan store_id o idempotency_key' using errcode = 'null_value_not_allowed';
  end if;

  select o.id into v_order_id
    from public.orders o
   where o.store_id = v_store_id and o.idempotency_key = v_key;
  if found then
    return v_order_id;
  end if;

  if v_scheduled is not null then
    -- El margen de 5 minutos es de plancha: el pedido entra al tablero un poco
    -- antes de que la cocina tenga que tocarlo.
    v_fire_at := v_scheduled
               - ((coalesce((p_order ->> 'base_prep_minutes')::int, 0)
                 + coalesce((p_order ->> 'delivery_minutes')::int, 0)
                 + 5) * interval '1 minute');

    if v_night is null then
      raise exception 'create_order: un pedido programado necesita scheduled_night'
        using errcode = 'null_value_not_allowed';
    end if;

    if v_capacity is not null then
      -- Lock por (tienda, noche) ANTES de contar. Dos clientes agarrando el
      -- último lugar del viernes es exactamente la carrera que un `if` en el
      -- servidor pierde: los dos leen 4 de 5 y los dos insertan.
      --
      -- Advisory lock y no `select ... from stores for update`: bloquear la
      -- fila de la tienda serializaría TODA la creación de pedidos del local,
      -- inmediatos incluidos, justo en hora pico. Acá la contención es solo
      -- entre dos programados para la misma noche.
      perform pg_advisory_xact_lock(
        hashtextextended(v_store_id::text || ':' || v_night::text, 0)
      );

      select count(*)::int into v_taken
        from public.orders o
       where o.store_id        = v_store_id
         and o.scheduled_night = v_night
         and o.status         <> 'cancelled';

      if v_taken >= v_capacity then
        -- El mensaje arranca con un marcador estable porque es lo que la capa
        -- de modelos matchea para traducirlo a un DomainError con texto de
        -- interfaz ("no quedan lugares para esa noche"). El SQLSTATE propio
        -- evita además confundirlo con cualquier otro check_violation.
        raise exception 'scheduled_night_full: la noche esta completa (% de %)', v_taken, v_capacity
          using errcode = 'BS429';
      end if;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- [CUPON] El consumo atómico. Después del return de idempotencia (a).
  -- -------------------------------------------------------------------------
  if v_code is not null then
    select * into v_coupon
      from public.coupons c
     where c.store_id = v_store_id
       and c.code     = v_code
       for update;

    if not found then
      raise exception 'coupon_not_found: no existe el cupon % en la tienda %', v_code, v_store_id
        using errcode = 'CPN01';
    end if;

    if v_coupon.status <> 'active' then
      raise exception 'coupon_inactive: el cupon % esta en estado %', v_code, v_coupon.status
        using errcode = 'CPN02';
    end if;

    if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
      raise exception 'coupon_not_started: el cupon % empieza el %', v_code, v_coupon.starts_at
        using errcode = 'CPN03';
    end if;

    if v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
      raise exception 'coupon_expired: el cupon % vencio el %', v_code, v_coupon.ends_at
        using errcode = 'CPN04';
    end if;

    -- El mínimo se evalúa sobre el SUBTOTAL, nunca sobre el total con envío.
    -- Mismo criterio que el mínimo de delivery, y por el mismo motivo: cobrar
    -- el envío para llegar al mínimo que habilita el descuento es circular.
    if v_subtotal < v_coupon.min_subtotal_cents then
      raise exception 'coupon_min_subtotal: el cupon % pide un minimo de %', v_code, v_coupon.min_subtotal_cents
        using errcode = 'CPN07';
    end if;

    -- null = todos los métodos. El CHECK de la tabla hace inrepresentable el
    -- array vacío, así que acá no hace falta distinguir "vacío" de "todos".
    if v_coupon.payment_methods is not null
       and not (v_method = any (v_coupon.payment_methods)) then
      raise exception 'coupon_payment_method: el cupon % no aplica a pago %', v_code, v_method
        using errcode = 'CPN08';
    end if;

    -- ⚠️ ESTRICTAMENTE MENOR. Los contadores no incluyen todavía la reserva
    -- que estamos por insertar. Con `<=` el cupón admite max_redemptions + 1 y
    -- el CHECK lo rechaza con un 23514 crudo. Está duplicado con el trigger a
    -- propósito (ver (b)): acá para dar el error legible, allá para que ningún
    -- camino futuro se saltee la garantía.
    if v_coupon.reserved_count + v_coupon.redeemed_count >= v_coupon.max_redemptions then
      raise exception 'coupon_exhausted: el cupon % ya se agoto', v_code
        using errcode = 'CPN05';
    end if;

    if v_coupon.max_redemptions_per_phone is not null then
      -- Cuenta SOLO lo que ocupa cupo: una reserva liberada no consumió la
      -- cuota de esa persona. Es el índice parcial
      -- coupon_redemptions_coupon_phone_idx.
      select count(*)::int into v_used
        from public.coupon_redemptions r
       where r.coupon_id           = v_coupon.id
         and r.customer_phone_e164 = v_phone
         and r.status in ('reserved','redeemed');

      if v_used >= v_coupon.max_redemptions_per_phone then
        raise exception 'coupon_phone_limit: el telefono ya uso el cupon % % veces', v_code, v_used
          using errcode = 'CPN06';
      end if;
    end if;

    -- Aritmética ENTERA, con floor. La misma fórmula vive en
    -- `percentOfCentsDown()` de src/lib/money.ts, escrita dos veces a propósito
    -- igual que ALLOWED_TRANSITIONS: la de TS muestra el número antes de
    -- comprar, ésta es la que cobra. Hay un test de paridad.
    --
    -- floor y NO ceil: redondear un ETA para arriba es honesto, redondear un
    -- descuento para arriba es plata del local.
    if v_coupon.discount_type = 'percentage' then
      v_discount := (v_subtotal * v_coupon.percent) / 100;   -- división entera = floor
      if v_coupon.max_discount_cents is not null then
        v_discount := least(v_discount, v_coupon.max_discount_cents);
      end if;
    else
      v_discount := v_coupon.amount_off_cents;
    end if;

    -- El clamp. Sin esto un cupón de monto fijo más grande que el carrito, con
    -- un envío suficientemente caro, deja el total POSITIVO y el local termina
    -- pagándole al cliente por comer. El CHECK
    -- orders_discount_within_subtotal_check es el backstop del mismo agujero.
    v_discount := least(v_discount, v_subtotal);

    -- (3.4) La red del CHECK, adentro de la función. Si el número que calculó
    -- TypeScript no coincide con el que acaba de calcular la base, es un bug
    -- NUESTRO y hay que enterarse acá, no descubrir después que lo atajó una
    -- constraint con un mensaje que nadie puede leer.
    if v_claimed <> v_discount then
      raise exception 'coupon_amount_mismatch: el llamador dice % y la base calcula %', v_claimed, v_discount
        using errcode = 'CPN09';
    end if;

    if v_total <> v_subtotal - v_discount + v_fee then
      raise exception 'coupon_total_mismatch: total % <> subtotal % - descuento % + envio %',
        v_total, v_subtotal, v_discount, v_fee
        using errcode = 'CPN09';
    end if;

  elsif v_claimed <> 0 then
    -- Descuento sin cupón. El CHECK del total NO lo ataja: si TS calculó
    -- `total = subtotal - descuento + envio` con un descuento inventado, los
    -- tres números son consistentes entre sí y la constraint pasa feliz
    -- mientras el local regala plata. La única defensa es que un descuento
    -- exija un cupón que lo justifique.
    raise exception 'coupon_missing: llego un descuento de % sin codigo de cupon', v_claimed
      using errcode = 'CPN10';
  end if;

  begin
    insert into public.orders (
      store_id, status, customer_name, customer_phone_e164, customer_email,
      idempotency_key, notes, currency, subtotal_cents, total_cents,
      discount_cents, coupon_code_snapshot,
      base_prep_minutes, demand_multiplier, eta_minutes, eta_at,
      payment_method, payment_status,
      delivery_method, delivery_fee_cents, delivery_minutes,
      delivery_address_line, delivery_address_unit,
      delivery_address_between, delivery_address_notes,
      scheduled_for, fire_at, scheduled_night
    ) values (
      v_store_id,
      p_order ->> 'status',
      p_order ->> 'customer_name',
      v_phone,
      p_order ->> 'customer_email',
      v_key,
      p_order ->> 'notes',
      p_order ->> 'currency',
      v_subtotal,
      v_total,
      v_discount,
      -- El código normalizado, no el que vino: es el que matchea `coupons.code`.
      -- Doctrina de snapshot (order_items.name_snapshot): el comprobante tiene
      -- que poder decir QUÉ cupón se usó aunque después se renombre o se borre.
      case when v_code is not null then v_code end,
      (p_order ->> 'base_prep_minutes')::int,
      (p_order ->> 'demand_multiplier')::numeric,
      (p_order ->> 'eta_minutes')::int,
      (p_order ->> 'eta_at')::timestamptz,
      v_method,
      coalesce(p_order ->> 'payment_status', 'pending'),
      coalesce(p_order ->> 'delivery_method', 'pickup'),
      v_fee,
      (p_order ->> 'delivery_minutes')::int,
      p_order ->> 'delivery_address_line',
      p_order ->> 'delivery_address_unit',
      p_order ->> 'delivery_address_between',
      p_order ->> 'delivery_address_notes',
      v_scheduled,
      v_fire_at,
      v_night
    )
    returning id into v_order_id;
  exception when unique_violation then
    -- Dos requests con la misma clave llegaron juntos y los dos pasaron el
    -- select de arriba. El indice decidio; devolvemos el que gano.
    --
    -- [CUPON] Y el uso del cupón se deshace solo: esta transacción no llegó a
    -- insertar la reserva, y si hubiera llegado, el rollback se la lleva. El
    -- contador vive en el libro mayor, no en un incremento.
    select o.id into v_order_id
      from public.orders o
     where o.store_id = v_store_id and o.idempotency_key = v_key;
    if found then
      return v_order_id;
    end if;
    -- No era la clave de idempotencia: puede ser una colision de short_code
    -- (`next_short_code` no es atomico). Que suba, para no confundir un bug con
    -- un reintento.
    raise;
  end;

  -- [CUPON] La reserva. Va DESPUÉS del insert del pedido porque
  -- coupon_redemptions.order_id es una FK. Nace 'reserved' y nadie toca los
  -- contadores: los recalcula private.sync_coupon_counters() desde acá.
  if v_code is not null then
    insert into public.coupon_redemptions (
      store_id, coupon_id, order_id, customer_phone_e164, discount_cents
    ) values (
      v_store_id, v_coupon.id, v_order_id, v_phone, v_discount
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items (
      order_id, product_id, name_snapshot, unit_price_cents,
      quantity, total_cents, prep_minutes, notes
    ) values (
      v_order_id,
      (v_item ->> 'product_id')::bigint,
      v_item ->> 'name_snapshot',
      (v_item ->> 'unit_price_cents')::bigint,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'total_cents')::bigint,
      (v_item ->> 'prep_minutes')::int,
      v_item ->> 'notes'
    )
    returning id into v_item_id;

    for v_option in
      select value from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb))
    loop
      insert into public.order_item_options (
        order_item_id, option_id, name_snapshot, group_snapshot, price_delta_cents
      ) values (
        v_item_id,
        (v_option ->> 'option_id')::bigint,
        v_option ->> 'name_snapshot',
        v_option ->> 'group_snapshot',
        coalesce((v_option ->> 'price_delta_cents')::bigint, 0)
      );
    end loop;
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function public.create_order(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order(jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- public.store_dashboard — REDEFINICIÓN COMPLETA + discountCents.
--
-- `total_cents` ya refleja el descuento, así que la facturación del dashboard
-- es correcta sin tocar nada. Lo que falta es el otro número: **cuánto regaló**.
-- Sin eso el dueño no puede contestar "¿me sirvió el cupón?", que es la única
-- razón por la que existen los cupones.
--
-- Se suma sobre los MISMOS pedidos billable de la ventana que ya usa la
-- facturación: si se sumara sobre todos, un cupón usado en pedidos que después
-- se cancelaron aparecería como plata regalada que nunca se regaló.
--
-- Extraída de 20260829170000_scheduled_orders_and_hours.sql. Enumera columnas
-- en el CTE `scoped`, así que vale la misma advertencia que create_order.
-- ---------------------------------------------------------------------------

create or replace function public.store_dashboard(p_store_id bigint, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_since timestamptz;
  v_out   jsonb;
begin
  -- SECURITY DEFINER bypassea RLS y PostgREST expone esta funcion a cualquier
  -- `authenticated`: sin este chequeo, un dueno lee el dashboard del competidor
  -- pasando otro id.
  if not private.is_store_member(p_store_id) then
    raise exception 'no tenes permiso sobre la tienda %', p_store_id using errcode = '42501';
  end if;

  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  if v_tz is null then
    raise exception 'la tienda % no existe', p_store_id using errcode = 'no_data_found';
  end if;

  v_since := (date_trunc('day', (now() at time zone v_tz)) - ((p_days - 1) * interval '1 day')) at time zone v_tz;

  with scoped as (
    select o.id, o.status, o.total_cents, o.discount_cents, o.eta_minutes,
           o.confirmed_at, o.ready_at,
           o.fire_at,
           (o.created_at at time zone v_tz)::date as local_day,
           private.order_is_billable(o.payment_status, o.payment_method, o.status) as billable
      from public.orders o
     where o.store_id = p_store_id
       and o.created_at >= v_since
  ),
  -- Serie completa de dias: sin esto el grafico saltea los dias sin ventas y la
  -- linea miente sobre la tendencia.
  days as (
    select d::date as local_day
      from generate_series(
             date_trunc('day', (v_since at time zone v_tz)),
             date_trunc('day', (now() at time zone v_tz)),
             interval '1 day'
           ) d
  ),
  sales as (
    select d.local_day,
           count(s.id)                     as orders,
           coalesce(sum(s.total_cents), 0) as revenue_cents
      from days d
      left join scoped s on s.local_day = d.local_day and s.billable
     group by d.local_day
  ),
  by_status as (
    select s.status, count(*)::int as n from scoped s group by s.status
  ),
  ticket as (
    select coalesce(round(avg(s.total_cents)), 0)::bigint as avg_cents
      from scoped s where s.billable
  ),
  -- [CUPON] Plata regalada en la ventana. Mismo filtro `billable` que la
  -- facturación, por lo dicho en la cabecera.
  discounts as (
    select coalesce(sum(s.discount_cents), 0)::bigint as total_cents
      from scoped s where s.billable
  ),
  prep as (
    -- greatest(confirmed_at, fire_at): para un pedido inmediato fire_at es NULL
    -- y GREATEST lo ignora, así que da confirmed_at y la métrica no cambia.
    select coalesce(round(avg(extract(epoch from (s.ready_at - greatest(s.confirmed_at, s.fire_at))) / 60)), 0)::int as real_min,
           coalesce(round(avg(s.eta_minutes)), 0)::int                                                               as est_min,
           count(*)::int                                                                                             as sample
      from scoped s
     where s.confirmed_at is not null and s.ready_at is not null and s.eta_minutes is not null
  ),
  top as (
    -- Se agrupa por producto cuando existe y por nombre cuando el producto se
    -- borro del catalogo: el snapshot es lo unico que queda de esa venta.
    select coalesce('p' || i.product_id::text, 's' || i.name_snapshot) as key,
           min(i.product_id)          as product_id,
           min(i.name_snapshot)       as name,
           sum(i.quantity)::int       as quantity,
           sum(i.total_cents)::bigint as revenue_cents
      from public.order_items i
      join scoped s on s.id = i.order_id
     where s.billable
     group by 1
     order by 4 desc
     limit 10
  )
  select jsonb_build_object(
    'salesByDay', coalesce((
       select jsonb_agg(jsonb_build_object(
                'date',         to_char(local_day, 'YYYY-MM-DD'),
                'orders',       orders,
                'revenueCents', revenue_cents) order by local_day)
         from sales), '[]'::jsonb),
    'topProducts', coalesce((
       select jsonb_agg(jsonb_build_object(
                'productId',    product_id,
                'name',         name,
                'quantity',     quantity,
                'revenueCents', revenue_cents) order by quantity desc)
         from top), '[]'::jsonb),
    'ordersByStatus', coalesce((select jsonb_object_agg(status, n) from by_status), '{}'::jsonb),
    'averageTicketCents', (select avg_cents from ticket),
    'discountCents', (select total_cents from discounts),
    'prepAccuracy', jsonb_build_object(
        'avgRealMinutes',      (select real_min from prep),
        'avgEstimatedMinutes', (select est_min  from prep),
        'sampleSize',          (select sample   from prep))
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.store_dashboard(bigint, int) from public, anon;
grant  execute on function public.store_dashboard(bigint, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.courier_queue — REDEFINICIÓN COMPLETA + discountCents.
--
-- `totalCents` ya es lo correcto: es exactamente lo que el repartidor tiene que
-- cobrar en la puerta. Lo que falta es que pueda EXPLICARLO. Con un cupón,
-- subtotal 5000 + envío 500 = 5500 pero el total es 4500, y el desglose que hoy
-- devuelve la RPC deja un agujero de 1000 sin nombre. El repartidor asume que
-- la pantalla está mal, cobra el subtotal, y ahí hay una discusión en la puerta
-- de la casa de un cliente.
--
-- Extraída de 20260828130000_delivery.sql.
-- ---------------------------------------------------------------------------

create or replace function public.courier_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- SECURITY DEFINER en `public` = endpoint invocable por cualquier
  -- `authenticated`. El filtro es la propia identidad: solo salen pedidos cuyo
  -- courier_id apunta a una membresía ACTIVA de este usuario.
  select coalesce(jsonb_agg(t order by t."assignedAt"), '[]'::jsonb) into v_out
  from (
    select o.id                       as "orderId",
           o.short_code               as "shortCode",
           o.status,
           s.name                     as "storeName",
           o.customer_name            as "customerName",
           o.customer_phone_e164      as "customerPhoneE164",
           o.delivery_address_line    as "addressLine",
           o.delivery_address_unit    as "addressUnit",
           o.delivery_address_between as "addressBetween",
           o.delivery_address_notes   as "addressNotes",
           -- `assigned_at` lo sella el trigger en el UPDATE de asignación, que
           -- es el único camino de la app. El coalesce cubre el caso raro de un
           -- pedido nacido ya asignado: sin él la cola ordenaría por null y el
           -- repartidor vería el orden cambiar entre polls.
           coalesce(o.assigned_at, o.created_at) as "assignedAt",
           -- El desglose a cobrar SOLO existe si el local activó el cobro en la
           -- puerta Y el pedido es de pago en el local Y todavía no está pago.
           -- En cualquier otro caso los montos NO SALEN DE POSTGRES: no hay bug
           -- de TypeScript que pueda mostrar un número que la base nunca mandó.
           case when s.courier_collects_payment
                 and o.payment_method = 'in_store'
                 and o.payment_status <> 'approved'
                then jsonb_build_object(
                       'subtotalCents',    o.subtotal_cents,
                       'discountCents',    o.discount_cents,
                       'deliveryFeeCents', o.delivery_fee_cents,
                       'totalCents',       o.total_cents,
                       'currency',         o.currency)
                else null
           end                        as "collect"
      from public.orders o
      join public.stores s        on s.id = o.store_id
      join public.store_members m on m.id = o.courier_id
     where m.user_id = (select auth.uid())
       and m.role    = 'courier'
       and m.is_active
       and o.status in ('ready', 'on_the_way')
  ) t;

  return v_out;
end;
$$;

revoke execute on function public.courier_queue() from public, anon;
grant  execute on function public.courier_queue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.store_couriers — VERIFICADA, NO SE TOCA.
--
-- El item pedía mirarla y no asumir. Mirada: sus dos métricas de plata
-- (`collected_today_cents`, `collected_30d_cents`) suman `o.total_cents`
-- filtrando por `payment_ref = 'courier'`. `total_cents` ya viene neto del
-- descuento, y lo que ese número mide es el ARQUEO: la plata que hoy está
-- físicamente en el bolsillo del repartidor. Con un cupón, el repartidor cobró
-- menos, y el arqueo tiene que decir menos. Sumar el descuento ahí haría que le
-- reclamen plata que nadie le dio.
--
-- Por eso no hay `create or replace` de esta función en esta migración.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- public.cleanup_old_records — REDEFINICIÓN COMPLETA, CINCO BORRADOS.
--
-- Los cuatro que ya tenía NO son opcionales: `create or replace` reemplaza el
-- cuerpo entero, así que uno que se caiga acá deja de purgarse para siempre y
-- la tabla crece sin que nada avise. Extraída de 20260829150000_rate_limits.sql
-- (la cuarta redefinición; las tres anteriores no mandan).
--
-- El quinto es `campaign_recipients`. Es log de entrega, no contabilidad.
--
-- LO QUE **NO** SE PURGA, y es una decisión, no un olvido:
--
--   · `store_customers` — es el registro comercial del local. Y borrar una fila
--     PIERDE LA BAJA: el cliente se dio de baja, la retención le borra la fila,
--     vuelve a comprar, el trigger la recrea sin `marketing_opt_out_at`, y le
--     llega la promo que había rechazado. Es lo peor que puede pasar en este
--     feature.
--   · `coupon_redemptions` — es el libro mayor de descuentos, filas `released`
--     incluidas. Contabilidad.
--   · `coupons` — un cupón vencido es el respaldo de los canjes que lo
--     referencian, y la FK es `on delete restrict` justamente por eso.
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
  v_events     int;
  v_audit      int;
  v_pending    int;
  v_limits     int;
  v_recipients int;
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

  -- [CUPON] Log de entrega de campañas. Se van los terminales viejos: un
  -- enviado hace tres meses y un salteado hace tres meses. Los `queued` y los
  -- `sending` NO se tocan por antigüedad de `created_at`: una campaña grande
  -- tarda días en drenar a 15 mails diarios, y borrarle la cola por vieja la
  -- decapitaría en silencio a mitad de camino.
  with gone as (
    delete from public.campaign_recipients r
     where (r.sent_at is not null and r.sent_at < now() - interval '90 days')
        or (r.status = 'skipped' and r.created_at < now() - interval '90 days')
    returning r.id
  )
  select count(*)::int into v_recipients from gone;

  return jsonb_build_object(
    'orderEvents',        v_events,
    'auditEntries',       v_audit,
    'pendingChanges',     v_pending,
    'rateLimits',         v_limits,
    'campaignRecipients', v_recipients
  );
end;
$$;

revoke execute on function public.cleanup_old_records(int, int) from public, anon, authenticated;
grant  execute on function public.cleanup_old_records(int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Las cinco RPC nuevas.
--
-- Todas en `public` porque PostgREST solo expone los schemas configurados, y
-- todas con `revoke execute from public, anon` + grant explícito: Postgres le da
-- EXECUTE a PUBLIC por defecto a toda función nueva, así que una
-- SECURITY DEFINER en `public` sin revoke es un endpoint abierto.
--
-- ⚠️ LA TRAMPA QUE EL REPO YA PISÓ CON store_couriers. Las dos de
-- `authenticated` (`campaign_segment_preview`, `coupon_detail`) verifican
-- `private.is_store_owner()` leyendo `auth.uid()`, así que se llaman con el
-- cliente de SESIÓN y con el admin client FALLAN SIEMPRE. Las tres de
-- `service_role` son al revés.
--
-- La normalización del mail vive en UNA expresión, `lower(trim(email))`, y se
-- usa idéntica en el preview y en el encolado. Si las dos difirieran, el dueño
-- vería "se manda a 14" y la campaña saldría a 12, sin que nada lo explique.
-- ---------------------------------------------------------------------------

-- Aproximación de `z.email()` en Postgres. No pretende ser la misma gramática:
-- pretende que ninguna dirección sintácticamente rota llegue al batch de
-- Resend, que es ATÓMICO — una sola dirección inválida hace fallar la llamada
-- entera y se lleva puestos los otros 14 mails del chunk.
create or replace function private.looks_like_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
     and p_email ~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$';
$$;

comment on function private.looks_like_email(text) is
  'Filtro sintáctico previo al batch de Resend, que es atómico. El drenaje vuelve a validar con Zod antes de mandar.';

-- ---------------------------------------------------------------------------
-- 1. campaign_segment_preview — los cuatro conteos, en un solo snapshot.
--
-- `daysNeeded`, `lastSendDate` y `fitsBeforeExpiry` NO salen de acá: los deriva
-- `campaignDaysNeeded()` de src/lib/coupon.ts a partir de `willSend`, porque la
-- misma cuenta la necesita la pantalla en vivo mientras el dueño mueve el
-- segmento, sin ir al servidor en cada tecla.
--
-- `willSend` cuenta direcciones DISTINTAS y sintácticamente válidas, no
-- clientes: `unique (campaign_id, email)` garantiza que dos filas del padrón
-- que comparten casilla reciban un solo mail, así que contar clientes
-- prometería más de lo que se manda.
-- ---------------------------------------------------------------------------

create or replace function public.campaign_segment_preview(
  p_store_id  bigint,
  p_kind      text,
  p_top_n     int    default null,
  p_min_spent bigint default null
)
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
    raise exception 'solo el dueno del local manda campanas' using errcode = '42501';
  end if;

  if p_kind not in ('all', 'top_n', 'min_spent') then
    raise exception 'segmento desconocido: %', p_kind using errcode = 'check_violation';
  end if;
  if p_kind = 'top_n' and coalesce(p_top_n, 0) <= 0 then
    raise exception 'el segmento top_n necesita un N positivo' using errcode = 'check_violation';
  end if;

  with base as (
    select c.id, c.email, c.marketing_opt_out_at, c.total_spent_cents
      from public.store_customers c
     where c.store_id = p_store_id
       and (p_kind <> 'min_spent' or c.total_spent_cents >= coalesce(p_min_spent, 0))
  ),
  -- El top_n se recorta acá y no en el WHERE porque un LIMIT no se puede
  -- condicionar por parámetro sin partir la query en dos.
  segment as (
    select x.*
      from (select b.*, row_number() over (order by b.total_spent_cents desc, b.id) as rn
              from base b) x
     where p_kind <> 'top_n' or x.rn <= p_top_n
  )
  select jsonb_build_object(
    'inSegment', (select count(*)::int from segment),
    'withEmail', (select count(*)::int from segment s where s.email is not null),
    -- Los dados de baja se cuentan DENTRO de los que tienen mail: la frase de la
    -- pantalla es "17 con email · 3 se dieron de baja · se manda a 14", y con la
    -- baja contada sobre el segmento entero esa resta no cerraría.
    'optedOut',  (select count(*)::int from segment s
                   where s.email is not null and s.marketing_opt_out_at is not null),
    'willSend',  (select count(distinct lower(trim(s.email)))::int from segment s
                   where s.email is not null
                     and s.marketing_opt_out_at is null
                     and private.looks_like_email(lower(trim(s.email))))
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.campaign_segment_preview(bigint, text, int, bigint) from public, anon;
grant  execute on function public.campaign_segment_preview(bigint, text, int, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. enqueue_campaign — crear la campaña y CONGELAR la lista, o nada.
--
-- Es una transacción o no es nada: una campaña con `recipients_total = 42` y 12
-- destinatarios en la tabla es una barra de progreso que nunca llega, y una
-- lista sin campaña es un mail que sale sin que nadie sepa de qué campaña era.
--
-- `chunk_index` se PERSISTE, no se calcula al drenar. De él sale la clave de
-- idempotencia de Resend y tiene que ser estable entre reintentos: si el chunk
-- se recalculara en vivo, un reintento con el padrón cambiado produce la misma
-- clave con otro payload y Resend responde 409 invalid_idempotent_request.
-- Verificado contra la API real en el feature de repartidores.
--
-- El ORDEN de los chunks es por plata gastada, descendente. No es cosmético:
-- una campaña de 142 personas tarda diez días, y si se corta —el cupón se
-- agota, el dueño lo pausa— los que ya recibieron son los mejores clientes del
-- local y no los primeros del abecedario.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_campaign(
  p_store_id   bigint,
  p_coupon_id  bigint,
  p_kind       text,
  p_top_n      int,
  p_min_spent  bigint,
  p_subject    text,
  p_message    text,
  p_created_by uuid,
  p_budget     int default 15
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign_id bigint;
  -- El chunk ES el presupuesto del día, acotado al tope del batch de Resend.
  -- Con 15/día un chunk de 100 nunca se podría mandar; así la unidad de
  -- reintento, la de presupuesto y la de idempotencia son la misma cosa.
  v_chunk       int := greatest(least(p_budget, 100), 1);
  v_total       int;
begin
  if p_kind not in ('all', 'top_n', 'min_spent') then
    raise exception 'segmento desconocido: %', p_kind using errcode = 'check_violation';
  end if;

  -- El cupón tiene que ser DE ESTA TIENDA. La FK de coupon_campaigns es de una
  -- sola columna, así que sin este chequeo una campaña podría apuntar al cupón
  -- de otro local.
  if not exists (select 1 from public.coupons c
                  where c.id = p_coupon_id and c.store_id = p_store_id) then
    raise exception 'el cupon % no es de la tienda %', p_coupon_id, p_store_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.coupon_campaigns (
    store_id, coupon_id, segment_kind, segment_top_n, segment_min_spent_cents,
    subject, message, created_by
  ) values (
    p_store_id, p_coupon_id, p_kind,
    case when p_kind = 'top_n'     then p_top_n    end,
    case when p_kind = 'min_spent' then p_min_spent end,
    p_subject, p_message, p_created_by
  )
  returning id into v_campaign_id;

  with base as (
    select c.id, c.email, c.marketing_opt_out_at, c.total_spent_cents
      from public.store_customers c
     where c.store_id = p_store_id
       and (p_kind <> 'min_spent' or c.total_spent_cents >= coalesce(p_min_spent, 0))
  ),
  segment as (
    select x.*
      from (select b.*, row_number() over (order by b.total_spent_cents desc, b.id) as rn
              from base b) x
     where p_kind <> 'top_n' or x.rn <= p_top_n
  ),
  -- Mismo predicado, palabra por palabra, que el `willSend` del preview.
  eligible as (
    select distinct on (lower(trim(s.email)))
           s.id, lower(trim(s.email)) as email, s.total_spent_cents
      from segment s
     where s.email is not null
       and s.marketing_opt_out_at is null
       and private.looks_like_email(lower(trim(s.email)))
     order by lower(trim(s.email)), s.total_spent_cents desc, s.id
  ),
  numbered as (
    select e.*, row_number() over (order by e.total_spent_cents desc, e.id) as rn
      from eligible e
  ),
  inserted as (
    insert into public.campaign_recipients (
      campaign_id, store_id, customer_id, email, chunk_index
    )
    select v_campaign_id, p_store_id, n.id, n.email, ((n.rn - 1) / v_chunk)::int
      from numbered n
    returning id
  )
  select count(*)::int into v_total from inserted;

  update public.coupon_campaigns
     set recipients_total = v_total
   where id = v_campaign_id;

  return v_campaign_id;
end;
$$;

revoke execute on function public.enqueue_campaign(bigint, bigint, text, int, bigint, text, text, uuid, int)
  from public, anon, authenticated;
grant  execute on function public.enqueue_campaign(bigint, bigint, text, int, bigint, text, text, uuid, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. claim_campaign_recipients — el drenaje. `for update skip locked`.
--
-- Mismo patrón que claim_event_deliveries, y por el mismo motivo: sin el claim
-- atómico, dos ticks solapados mandan el mismo mail dos veces. Acá es peor que
-- un POST duplicado a un POS — es una promoción repetida en la casilla de un
-- cliente.
--
-- EL PRESUPUESTO ES DIARIO Y LA VENTANA ES UTC, no la del local: la cuota que
-- se está racionando es la de Resend. Las fechas que ve el dueño se formatean
-- en la zona del local y el desfase de unas horas no mueve ningún conteo.
--
-- ⚠️ UN CLAIM = UN CHUNK COMPLETO, O NADA. Si el chunk no entra en lo que queda
-- del presupuesto, la función NO manda un pedazo: devuelve vacío y espera al
-- día siguiente. El motivo es la idempotencia de Resend — un batch parcial
-- reintentado con el resto del chunk viaja con la misma clave y otro payload, y
-- la API responde 409 invalid_idempotent_request. Verificado contra la API real
-- en el feature de repartidores.
--
-- La clave de idempotencia la arma el llamador con `(campaign_id, chunk_index,
-- hash del set de recipient_id)`. El chunk_index solo no alcanza: si un
-- destinatario del chunk se da de baja entre dos intentos, el payload cambia y
-- la clave tiene que cambiar con él.
--
-- Los tres estados del cupón que CORTAN la campaña se chequean por chunk, no
-- por destinatario: el chunk es la unidad de todo lo demás.
-- ---------------------------------------------------------------------------

create or replace function public.claim_campaign_recipients(
  p_budget        int default 15,
  p_max_attempts  int default 5,
  p_retry_seconds int default 900
)
returns table (
  recipient_id       bigint,
  campaign_id        bigint,
  store_id           bigint,
  chunk_index        int,
  email              text,
  customer_name      text,
  unsubscribe_token  text,
  store_name         text,
  store_slug         text,
  subject            text,
  message            text,
  coupon_code        text,
  discount_type      text,
  percent            int,
  amount_off_cents   bigint,
  max_discount_cents bigint,
  min_subtotal_cents bigint,
  coupon_ends_at     timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day_start  timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_sent_today int;
  v_remaining  int;
  v_campaign   public.coupon_campaigns;
  v_coupon     public.coupons;
  v_stop       text;
  v_chunk      int;
  v_chunk_size int;
begin
  select count(*)::int into v_sent_today
    from public.campaign_recipients r
   where r.sent_at >= v_day_start;

  v_remaining := p_budget - v_sent_today;

  -- ⚠️ LA LIMPIEZA VA ANTES DEL CHEQUEO DE PRESUPUESTO, A PROPÓSITO.
  --
  -- Ninguno de los dos `update` de acá gasta un mail: uno cierra
  -- destinatarios que agotaron los reintentos y el otro cierra la campaña que
  -- se quedó sin cola. Si vivieran después del `return` por presupuesto
  -- agotado, no correrían nunca en el mismo día en que hubo un envío — y el
  -- chunk ES el presupuesto (15), así que el primer envío exitoso del día lo
  -- agota de inmediato. El dueño vería una campaña "enviando" durante un día
  -- entero después de que en la práctica ya terminó.
  --
  -- Los que agotaron los reintentos dejan de bloquear su chunk. Sin esto un
  -- mail que Resend rechaza para siempre congela la campaña entera: el chunk
  -- nunca se vacía y los chunks siguientes nunca se reclaman.
  update public.campaign_recipients r
     set status = 'failed'
   where r.status = 'queued'
     and r.attempts >= p_max_attempts;

  -- Y el cierre de la campaña que ese update acaba de dejar sin cola.
  --
  -- Es el agujero que `settle_campaign_recipient` NO puede tapar, y vale
  -- escribir por qué: el paso a `failed` de la última fila ocurre ACÁ, en el
  -- claim, no en un settle. Después de eso no hay ningún settle más que
  -- disparar, así que la campaña se quedaba en `sending` para siempre —
  -- indistinguible de una que todavía está drenando, y con la barra de
  -- progreso congelada en el 60%.
  --
  -- Mismo criterio que el resto del feature: los contadores se RECALCULAN
  -- desde `campaign_recipients`, nunca se deducen de lo que acabamos de tocar.
  -- Mismo motivo que el lock de sync_coupon_counters: sin él, este recálculo
  -- puede escribir un conteo fijado antes de esperar el lock de la fila.
  perform 1 from public.coupon_campaigns cc
   where cc.status in ('queued', 'sending') for update;

  update public.coupon_campaigns cc
     set sent_count    = agg.sent,
         failed_count  = agg.failed,
         skipped_count = agg.skipped,
         status        = case
                           when agg.sent   > 0 then 'sent'
                           when agg.failed > 0 then 'failed'
                           -- Ni enviados ni fallados: nadie era elegible.
                           else 'stopped'
                        end,
         stopped_reason = case when agg.sent = 0 and agg.failed = 0 then 'no_recipients' end,
         finished_at   = now()
    from (
      select r.campaign_id,
             count(*) filter (where r.status = 'sent')::int    as sent,
             count(*) filter (where r.status = 'failed')::int  as failed,
             count(*) filter (where r.status = 'skipped')::int as skipped,
             count(*) filter (where r.status = 'queued')::int  as queued
        from public.campaign_recipients r
       group by r.campaign_id
    ) agg
   where cc.id = agg.campaign_id
     and cc.status in ('queued', 'sending')
     and agg.queued = 0;

  -- Recién ACÁ el presupuesto: la limpieza de arriba ya corrió, así que un día
  -- con el cupo agotado igual cierra lo que haya que cerrar.
  if v_remaining <= 0 then
    return;
  end if;

  -- La campaña más vieja que todavía tiene cola. `skip locked` para que dos
  -- ticks solapados trabajen en campañas distintas en vez de esperarse.
  select cc.* into v_campaign
    from public.coupon_campaigns cc
   where cc.status in ('queued', 'sending')
     and exists (select 1 from public.campaign_recipients r
                  where r.campaign_id = cc.id and r.status = 'queued')
   order by cc.created_at
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  select * into v_coupon from public.coupons c where c.id = v_campaign.coupon_id;

  -- El orden de los tres importa poco, pero `paused` va primero porque es el
  -- único que el dueño causó a propósito y el que más conviene nombrar.
  -- `status <> 'active'` y no `= 'paused'`: un cupón que volvió a `draft` es
  -- igual de inmandable, y el enum de stopped_reason no tiene una cuarta opción
  -- que lo distinga.
  v_stop := case
              when v_coupon.status <> 'active' then 'coupon_paused'
              when v_coupon.ends_at is not null and now() >= v_coupon.ends_at then 'coupon_expired'
              when v_coupon.reserved_count + v_coupon.redeemed_count >= v_coupon.max_redemptions
                then 'coupon_exhausted'
            end;

  if v_stop is not null then
    -- Cortar: lo que queda en cola no se manda nunca, y la campaña va a un
    -- estado TERMINAL propio. `stopped` y no `failed` porque piden dos acciones
    -- distintas del dueño: `failed` es que falló lo nuestro y conviene
    -- reintentar, `stopped` es que la oferta dejó de valer y no hay nada que
    -- reintentar.
    update public.campaign_recipients r
       set status = 'skipped'
     where r.campaign_id = v_campaign.id and r.status = 'queued';

    update public.coupon_campaigns cc
       set status         = 'stopped',
           stopped_reason = v_stop,
           finished_at    = now(),
           skipped_count  = (select count(*)::int from public.campaign_recipients r
                              where r.campaign_id = cc.id and r.status = 'skipped')
     where cc.id = v_campaign.id;

    return;
  end if;

  -- El re-chequeo de la baja, adentro de la misma transacción que reclama. Es
  -- lo que hace que darse de baja tenga efecto INMEDIATO en vez de las 48 horas
  -- que RFC 8058 permite.
  update public.campaign_recipients r
     set status = 'skipped'
    from public.store_customers c
   where r.campaign_id = v_campaign.id
     and r.status      = 'queued'
     and c.id          = r.customer_id
     and c.marketing_opt_out_at is not null;

  -- Y los que perdieron su fila del padrón: sin `unsubscribe_token` no hay
  -- header List-Unsubscribe, y un mail de promoción sin él no sale.
  update public.campaign_recipients r
     set status = 'skipped'
   where r.campaign_id = v_campaign.id
     and r.status      = 'queued'
     and (r.customer_id is null
          or not exists (select 1 from public.store_customers c where c.id = r.customer_id));

  -- El chunk más bajo cuya cola ENTERA ya cumplió la espera de reintento. Todas
  -- las filas de un chunk comparten `last_attempt_at` porque se reclaman juntas,
  -- así que mirar el máximo alcanza.
  select r.chunk_index into v_chunk
    from public.campaign_recipients r
   where r.campaign_id = v_campaign.id and r.status = 'queued'
   group by r.chunk_index
  having max(coalesce(r.last_attempt_at, '-infinity'::timestamptz))
           < now() - (p_retry_seconds * interval '1 second')
   order by r.chunk_index
   limit 1;

  if v_chunk is null then
    -- Sin chunk reclamable, y hay dos motivos posibles que NO son lo mismo:
    --
    --  a) La cola tiene filas pero todavía no cumplieron la espera de
    --     reintento. Se vuelve y el próximo tick la agarra.
    --  b) La cola quedó VACÍA justo ahora, porque el re-chequeo de la baja de
    --     unas líneas más arriba marcó `skipped` a todos los que quedaban.
    --
    -- El bloque de limpieza del principio de la función no puede cubrir (b):
    -- corre ANTES de ese re-chequeo, cuando las filas todavía estaban
    -- `queued`. Sin cerrar acá, una campaña cuyo segmento entero se dio de baja
    -- entre el encolado y el envío se queda en `queued` PARA SIEMPRE, y el
    -- dueño la ve "esperando" sin que nunca haya nada que esperar.
    update public.coupon_campaigns cc
       set sent_count     = agg.sent,
           failed_count   = agg.failed,
           skipped_count  = agg.skipped,
           status         = case
                              when agg.sent   > 0 then 'sent'
                              when agg.failed > 0 then 'failed'
                              else 'stopped'
                            end,
           stopped_reason = case when agg.sent = 0 and agg.failed = 0
                                   then 'no_recipients' end,
           finished_at    = now()
      from (
        select count(*) filter (where r.status = 'sent')::int    as sent,
               count(*) filter (where r.status = 'failed')::int  as failed,
               count(*) filter (where r.status = 'skipped')::int as skipped,
               count(*) filter (where r.status = 'queued')::int  as queued
          from public.campaign_recipients r
         where r.campaign_id = v_campaign.id
      ) agg
     where cc.id = v_campaign.id
       and cc.status in ('queued', 'sending')
       and agg.queued = 0;

    return;
  end if;

  select count(*)::int into v_chunk_size
    from public.campaign_recipients r
   where r.campaign_id = v_campaign.id and r.status = 'queued' and r.chunk_index = v_chunk;

  -- Todo el chunk, o nada. Ver la advertencia de la cabecera.
  if v_chunk_size > v_remaining then
    return;
  end if;

  update public.coupon_campaigns cc
     set status     = 'sending',
         started_at = coalesce(cc.started_at, now())
   where cc.id = v_campaign.id;

  return query
  with claimed as (
    update public.campaign_recipients r
       set attempts        = r.attempts + 1,
           last_attempt_at = now()
     where r.id in (
       select c.id
         from public.campaign_recipients c
        where c.campaign_id  = v_campaign.id
          and c.status       = 'queued'
          and c.chunk_index  = v_chunk
        order by c.id
        for update skip locked
     )
    returning r.*
  )
  select cl.id, cl.campaign_id, cl.store_id, cl.chunk_index, cl.email,
         cu.display_name, cu.unsubscribe_token,
         s.name, s.slug,
         v_campaign.subject, v_campaign.message,
         v_coupon.code, v_coupon.discount_type, v_coupon.percent,
         v_coupon.amount_off_cents, v_coupon.max_discount_cents,
         v_coupon.min_subtotal_cents, v_coupon.ends_at
    from claimed cl
    join public.store_customers cu on cu.id = cl.customer_id
    join public.stores s           on s.id  = cl.store_id
   order by cl.id;
end;
$$;

revoke execute on function public.claim_campaign_recipients(int, int, int) from public, anon, authenticated;
grant  execute on function public.claim_campaign_recipients(int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. settle_campaign_recipient — cerrar la fila y los contadores juntos.
--
-- Los contadores de la campaña se RECALCULAN desde campaign_recipients, no se
-- incrementan. Mismo criterio que sync_coupon_counters y sync_store_customer: un
-- recálculo no puede quedar desincronizado por un camino que no previmos, y un
-- `+1` sí. Acá compra además que un reintento que termina bien no deje el
-- failed_count inflado del intento anterior.
--
-- El cierre de la campaña vive acá y no en un cron aparte: "no queda nada en
-- cola" se sabe exactamente en el momento en que se cierra la última fila.
-- ---------------------------------------------------------------------------

create or replace function public.settle_campaign_recipient(
  p_recipient_id bigint,
  p_ok           boolean,
  p_provider_ref text default null,
  p_error        text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign_id bigint;
begin
  update public.campaign_recipients r
     set status       = case when p_ok then 'sent' else 'queued' end,
         sent_at      = case when p_ok then now() end,
         provider_ref = case when p_ok then p_provider_ref else r.provider_ref end,
         last_error   = case when p_ok then null else p_error end
   where r.id = p_recipient_id
  returning r.campaign_id into v_campaign_id;

  if v_campaign_id is null then
    return;
  end if;

  -- Mismo lock explícito que sync_coupon_counters, y por lo mismo: un
  -- `UPDATE ... FROM (subquery)` que espera el lock de la fila re-evalúa solo la
  -- condición sobre `coupon_campaigns`, no la subquery contra
  -- `campaign_recipients`, así que sin esto puede escribir un conteo viejo.
  perform 1 from public.coupon_campaigns where id = v_campaign_id for update;

  -- Un fallo NO cierra la fila: la deja en `queued` con el error anotado y el
  -- contador de intentos ya subido por el claim. La cierra `claim` cuando los
  -- intentos se agotan, que es el único lugar donde "ya no vale la pena" es una
  -- decisión y no un accidente.
  update public.coupon_campaigns cc
     set sent_count    = agg.sent,
         failed_count  = agg.failed,
         skipped_count = agg.skipped,
         -- ⚠️ Cola vacía NO significa "enviada". Si todos los destinatarios
         -- terminaron en `failed` (Resend rechazando, la key vencida, el
         -- dominio caído), `queued` llega a 0 igual y un `then 'sent'` a secas
         -- reportaría "campaña enviada" con sent_count = 0. El dueño vería una
         -- campaña verde que no le llegó a nadie, que es la peor forma de
         -- fallar: silenciosa y con cara de éxito.
         status        = case
                           when agg.queued > 0                  then cc.status
                           when agg.sent   > 0                  then 'sent'
                           when agg.failed > 0                  then 'failed'
                           -- Ni enviados ni fallados: TODOS `skipped`. Se
                           -- terminó sin mandar nada y sin que nada fallara,
                           -- porque nadie del chunk seguía siendo elegible (se
                           -- dieron de baja, o perdieron su fila del padrón,
                           -- entre el encolado y el envío).
                           --
                           -- Antes esto decía `sent`, y el resultado era una
                           -- campaña VERDE con `sent_count = 0`: el número real
                           -- se mostraba, pero el estado no transmitía que
                           -- nadie recibió nada. Es la misma falla
                           -- silenciosa-con-cara-de-éxito que este mismo `case`
                           -- ya cerró para los fallos.
                           else 'stopped'
                        end,
         stopped_reason = case
                            when agg.queued = 0 and agg.sent = 0 and agg.failed = 0
                              then 'no_recipients'
                            else cc.stopped_reason
                          end,
         finished_at   = case when agg.queued = 0 then now()     else cc.finished_at end
    from (
      select count(*) filter (where r.status = 'sent')::int    as sent,
             count(*) filter (where r.status = 'failed')::int  as failed,
             count(*) filter (where r.status = 'skipped')::int as skipped,
             count(*) filter (where r.status = 'queued')::int  as queued
        from public.campaign_recipients r
       where r.campaign_id = v_campaign_id
    ) agg
   where cc.id = v_campaign_id
     -- Una campaña ya cortada (`stopped`) no vuelve a `sent` porque llegó el
     -- settle tardío del último chunk que sí salió.
     and cc.status in ('queued', 'sending');
end;
$$;

revoke execute on function public.settle_campaign_recipient(bigint, boolean, text, text) from public, anon, authenticated;
grant  execute on function public.settle_campaign_recipient(bigint, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. coupon_detail — los tres agregados y los últimos canjes, en una llamada.
--
-- Las tres métricas cuentan SOLO `redeemed`, nunca `reserved`. "Facturación
-- generada" sobre un pedido reservado que todavía puede morir es un número
-- falso, y es el número con el que el dueño decide si repite la promoción. Los
-- reservados salen aparte, como conteo, donde se entiende qué son.
--
-- Se llama con el cliente de SESIÓN: verifica `is_store_owner()` leyendo
-- `auth.uid()`.
-- ---------------------------------------------------------------------------

create or replace function public.coupon_detail(p_store_id bigint, p_coupon_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out    jsonb;
  v_coupon public.coupons;
begin
  if not private.is_store_owner(p_store_id) then
    raise exception 'solo el dueno del local ve el detalle de un cupon' using errcode = '42501';
  end if;

  select * into v_coupon
    from public.coupons c
   where c.id = p_coupon_id and c.store_id = p_store_id;

  if not found then
    raise exception 'el cupon % no existe en la tienda %', p_coupon_id, p_store_id
      using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'id',                     v_coupon.id,
    'storeId',                v_coupon.store_id,
    'name',                   v_coupon.name,
    'code',                   v_coupon.code,
    'discountType',           v_coupon.discount_type,
    'percent',                v_coupon.percent,
    'amountOffCents',         v_coupon.amount_off_cents,
    'maxDiscountCents',       v_coupon.max_discount_cents,
    'minSubtotalCents',       v_coupon.min_subtotal_cents,
    'startsAt',               v_coupon.starts_at,
    'endsAt',                 v_coupon.ends_at,
    'maxRedemptions',         v_coupon.max_redemptions,
    'maxRedemptionsPerPhone', v_coupon.max_redemptions_per_phone,
    -- Los dos contadores por separado. El panel tiene que poder distinguir
    -- "12 canjes" de "12 pedidos en vuelo": lo segundo todavía puede volver.
    'reservedCount',          v_coupon.reserved_count,
    'redeemedCount',          v_coupon.redeemed_count,
    'paymentMethods',         v_coupon.payment_methods,
    'status',                 v_coupon.status,
    'createdAt',              v_coupon.created_at,
    'updatedAt',              v_coupon.updated_at,

    'stats', (
      select jsonb_build_object(
               'redemptions',     count(*)::int,
               'discountedCents', coalesce(sum(r.discount_cents), 0)::bigint,
               -- Facturación GENERADA: lo que el local cobró gracias al cupón.
               -- Doble filtro a propósito: `redeemed` en el libro mayor y
               -- facturable en el pedido. Un pedido entregado y después
               -- reembolsado no generó facturación, y el predicado de
               -- order_is_billable es el mismo que usa el dashboard.
               'revenueCents',    coalesce(sum(o.total_cents) filter (
                                    where private.order_is_billable(
                                            o.payment_status, o.payment_method, o.status)), 0)::bigint)
        from public.coupon_redemptions r
        join public.orders o on o.id = r.order_id
       where r.coupon_id = p_coupon_id and r.status = 'redeemed'
    ),

    'totalRedemptions', (select count(*)::int from public.coupon_redemptions r
                          where r.coupon_id = p_coupon_id and r.status = 'redeemed'),

    -- La traza al revés: desde el cupón, los pedidos que lo usaron. Es la mitad
    -- que faltaba de la trazabilidad bidireccional; la otra es
    -- `orders.coupon_code_snapshot`.
    --
    -- ⚠️ ACÁ NO SE FILTRA POR `redeemed`, y es la diferencia con `stats`.
    -- Las MÉTRICAS cuentan solo canjes confirmados (facturación sobre un pedido
    -- que todavía puede morir es un número falso). La LISTA es diagnóstico: el
    -- dueño necesita ver los que están en vuelo y los que se liberaron, con el
    -- motivo, porque es la única forma de entender por qué el cupo ocupado no
    -- coincide con los canjes. Filtrarla igual que las métricas dejaba los
    -- `released` invisibles y la columna "Usos" sin explicación posible.
    --
    -- Por eso viajan `status` y `releasedReason`: la fila los usa para el
    -- StatusPill. Los liberados NO van en el titular —son diagnóstico, no
    -- resultado— pero tienen que estar en la lista.
    'recentRedemptions', coalesce((
      select jsonb_agg(t order by t."createdAt" desc)
        from (
          select o.id                  as "orderId",
                 o.short_code          as "shortCode",
                 o.customer_name       as "customerName",
                 r.discount_cents      as "discountCents",
                 o.total_cents         as "orderTotalCents",
                 r.status              as "status",
                 r.released_reason     as "releasedReason",
                 r.created_at          as "createdAt"
            from public.coupon_redemptions r
            join public.orders o on o.id = r.order_id
           where r.coupon_id = p_coupon_id
           order by r.created_at desc
           limit 20
        ) t), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.coupon_detail(bigint, bigint) from public, anon;
grant  execute on function public.coupon_detail(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- El cron de campañas.
--
-- pg_cron y NO `vercel.json`: en Hobby una entrada más frecuente que diaria
-- hace FALLAR EL DEPLOY, no correr lento. Está documentado en CLAUDE.md y ya
-- resuelto para los otros tres schedules; éste sigue el mismo camino.
--
-- Cada 5 minutos y no cada 2 como el outbox: el presupuesto es de 15 mails al
-- día y un chunk es el día entero, así que el tick solo tiene trabajo real una
-- vez cada 24 horas. Los otros 287 ticks son un `count` y un `return`.
--
-- `cron.schedule` con nombre es idempotente: reemplaza el job si ya existe.
-- ---------------------------------------------------------------------------

select cron.schedule('app-campaigns', '*/5 * * * *',
  $job$ select private.invoke_app_cron('/api/cron/campaigns'); $job$);
