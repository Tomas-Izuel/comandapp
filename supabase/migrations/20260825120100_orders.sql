-- Pedidos, pagos, eventos (outbox) y notificaciones

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id                  bigint generated always as identity primary key,
  store_id            bigint not null references public.stores(id) on delete restrict,

  -- short_code: para cantar en el mostrador ("pedido A7K2"). Puede repetirse
  -- entre tiendas/días, NO sirve para autenticar.
  short_code          text,
  -- public_token: opaco e impredecible. Es lo que se guarda en localStorage
  -- del cliente y lo que viaja en la URL de seguimiento.
  public_token        text   not null unique default private.random_token(24),

  -- OJO: `status` es el ciclo de la COCINA y `payment_status` el del DINERO.
  -- Son dos relojes distintos: con pago en el local un pedido puede estar
  -- 'ready' y todavia impago. Mezclarlos rompe ese caso.
  status              text   not null default 'pending'
                        check (status in ('pending','confirmed','preparing','ready','delivered','cancelled')),

  customer_name       text   not null,
  customer_phone_e164 text   not null,
  -- Opcional a propósito: un campo más en el checkout es fricción en mobile.
  -- Si viene, habilita comprobante y aviso por mail; si no, solo WhatsApp.
  customer_email      text,

  -- Clave de idempotencia que genera el browser al confirmar el pedido.
  -- Sin esto, un doble tap en "Pagar" con mala señal mete DOS pedidos en la
  -- cocina y crea dos preferencias de pago. El índice único de abajo es lo que
  -- lo hace imposible; un chequeo en la app pierde la carrera.
  idempotency_key     text   not null,
  notes               text,

  currency            text   not null default 'ARS',
  subtotal_cents      bigint not null default 0 check (subtotal_cents >= 0),
  total_cents         bigint not null default 0 check (total_cents >= 0),

  -- ETA calculado al confirmar el pago (ya incluye el multiplicador de demanda)
  base_prep_minutes   int,
  demand_multiplier   numeric(4,2),
  eta_minutes         int,
  eta_at              timestamptz,

  payment_method      text   not null default 'online'
                        check (payment_method in ('online','in_store')),
  payment_status      text   not null default 'pending'
                        check (payment_status in ('pending','approved','rejected','refunded')),
  payment_provider    text   not null default 'mercadopago',
  preference_id       text,
  payment_ref         text,

  -- integración con el software de gestión del local (POS/OMS)
  external_ref        text,
  external_synced_at  timestamptz,

  confirmed_at        timestamptz,
  paid_at             timestamptz,
  ready_at            timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index orders_store_id_idx       on public.orders (store_id);
create unique index orders_idempotency_idx on public.orders (store_id, idempotency_key);
create index orders_store_created_idx  on public.orders (store_id, created_at desc);
create index orders_payment_ref_idx    on public.orders (payment_ref) where payment_ref is not null;
create index orders_preference_id_idx  on public.orders (preference_id) where preference_id is not null;
-- La cocina consulta constantemente los pedidos activos: índice parcial.
create index orders_active_idx on public.orders (store_id, created_at)
  where status in ('confirmed','preparing','ready');
create unique index orders_store_short_code_active_idx on public.orders (store_id, short_code)
  where status <> 'delivered' and status <> 'cancelled';

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items — snapshot del producto al momento de la compra
-- ---------------------------------------------------------------------------

create table public.order_items (
  id                bigint generated always as identity primary key,
  order_id          bigint not null references public.orders(id) on delete cascade,
  product_id        bigint references public.products(id) on delete set null,
  name_snapshot     text   not null,
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  quantity          int    not null check (quantity > 0),
  total_cents       bigint not null check (total_cents >= 0),
  prep_minutes      int    not null default 10,
  notes             text
);

create index order_items_order_id_idx   on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

create table public.order_item_options (
  id                bigint generated always as identity primary key,
  order_item_id     bigint not null references public.order_items(id) on delete cascade,
  option_id         bigint references public.options(id) on delete set null,
  name_snapshot     text   not null,
  group_snapshot    text,
  price_delta_cents bigint not null default 0
);

create index order_item_options_item_id_idx on public.order_item_options (order_item_id);
create index order_item_options_option_id_idx on public.order_item_options (option_id);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null references public.orders(id) on delete cascade,
  provider            text   not null default 'mercadopago',
  provider_payment_id text   not null,
  status              text   not null,
  amount_cents        bigint not null default 0,
  raw                 jsonb  not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index payments_order_id_idx on public.payments (order_id);

-- ---------------------------------------------------------------------------
-- order_events — audit log + outbox para integraciones externas
-- ---------------------------------------------------------------------------

create table public.order_events (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references public.orders(id) on delete cascade,
  store_id     bigint not null references public.stores(id) on delete cascade,
  type         text   not null,
  payload      jsonb  not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  -- outbox
  delivered_at    timestamptz,
  attempts        int    not null default 0,
  -- Sin esta marca el backoff tiene que aproximarse contra created_at, que da
  -- reintentos demasiado juntos apenas el endpoint del local se cae un rato.
  last_attempt_at timestamptz,
  last_error      text
);

create index order_events_order_id_idx on public.order_events (order_id);
-- Cola de pendientes de entrega al sistema externo.
create index order_events_pending_idx on public.order_events (store_id, created_at)
  where delivered_at is null;

-- ---------------------------------------------------------------------------
-- notifications (WhatsApp)
-- ---------------------------------------------------------------------------

create table public.notifications (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references public.orders(id) on delete cascade,
  channel      text   not null default 'whatsapp' check (channel in ('whatsapp','email','sms','none')),
  -- Destino genérico: un teléfono E.164 si el canal es whatsapp, una dirección
  -- de mail si es email. `channel` ya dice cuál es, así que una columna por
  -- canal sería redundante y quedaría siempre medio vacía.
  to_address   text   not null,
  template     text   not null,
  status       text   not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  provider_ref text,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index notifications_order_id_idx on public.notifications (order_id);

-- ---------------------------------------------------------------------------
-- pos_endpoints — punto de extensión para el software de gestión del local
-- ---------------------------------------------------------------------------

create table public.pos_endpoints (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references public.stores(id) on delete cascade,
  name       text   not null,
  url        text   not null,
  secret     text   not null,
  events     text[] not null default array['order.paid','order.status_changed'],
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index pos_endpoints_store_id_idx on public.pos_endpoints (store_id) where is_active;
