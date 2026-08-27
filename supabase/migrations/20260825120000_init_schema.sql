-- Burger Shop — schema inicial
-- Convenciones:
--   * identificadores en minúscula y snake_case
--   * dinero en centavos (bigint) para evitar errores de coma flotante
--   * timestamptz siempre
--   * bigint identity como PK; los IDs expuestos al público son tokens aparte

create extension if not exists pgcrypto with schema extensions;

-- Esquema privado para helpers security definer (no expuesto por PostgREST)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Token opaco para URLs públicas (base32 sin caracteres ambiguos)
create or replace function private.random_token(len int default 24)
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  out text := '';
  i int;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;


-- ---------------------------------------------------------------------------
-- plataforma (backoffice) — solo el dueno del SaaS
--
-- platform_admins NO tiene UI de alta: las filas se insertan por SQL a mano.
-- Todas las policies que la usan exigen ademas aal2 (TOTP verificado).
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.platform_audit_log (
  id             bigint generated always as identity primary key,
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_email    text,
  action         text   not null,
  target_type    text,
  target_id      text,
  payload        jsonb  not null default '{}'::jsonb,
  ip             inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

create index platform_audit_log_created_idx on public.platform_audit_log (created_at desc);
create index platform_audit_log_actor_idx   on public.platform_audit_log (actor_user_id, created_at desc);
create index platform_audit_log_target_idx  on public.platform_audit_log (target_type, target_id);

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------

create table public.stores (
  id                      bigint generated always as identity primary key,
  slug                    text not null unique,
  name                    text not null,
  description             text,
  phone_e164              text,
  whatsapp_phone_e164     text,
  address                 text,
  timezone                text not null default 'America/Argentina/Buenos_Aires',
  currency                text not null default 'ARS',

  -- status lo maneja la plataforma (backoffice); accepting_orders lo maneja el local.
  status                  text    not null default 'active' check (status in ('active', 'suspended')),
  accepting_orders        boolean not null default true,
  -- Si esta en false, el unico camino es pagar online por adelantado.
  in_store_payment_enabled boolean not null default false,
  min_order_cents         bigint  not null default 0 check (min_order_cents >= 0),

  -- multiplicador de demanda: si hay >= demand_threshold_orders pedidos activos,
  -- el tiempo estimado de preparación se multiplica por demand_multiplier
  demand_threshold_orders int     not null default 5  check (demand_threshold_orders >= 1),
  demand_multiplier       numeric(4,2) not null default 1.50 check (demand_multiplier >= 1 and demand_multiplier <= 10),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function private.set_updated_at();


-- ---------------------------------------------------------------------------
-- store_branding — kit de marca (1:1 con stores, opcional)
--
-- Se inyecta como variables CSS en el layout de /[store], pisando los tokens
-- que shadcn ya usa. Los CHECK de abajo son la ultima linea de defensa contra
-- inyeccion de CSS: la app valida con Zod antes, pero la base no confia.
-- ---------------------------------------------------------------------------

create table public.store_branding (
  store_id                 bigint primary key references public.stores(id) on delete cascade,

  logo_url                 text,
  logo_dark_url            text,
  favicon_url              text,
  hero_image_url           text,

  color_primary            text not null default '#f97316' check (color_primary            ~ '^#[0-9a-fA-F]{6}$'),
  color_primary_foreground text not null default '#ffffff' check (color_primary_foreground ~ '^#[0-9a-fA-F]{6}$'),
  color_accent             text not null default '#fb923c' check (color_accent             ~ '^#[0-9a-fA-F]{6}$'),
  color_background         text not null default '#ffffff' check (color_background         ~ '^#[0-9a-fA-F]{6}$'),
  color_foreground         text not null default '#0a0a0a' check (color_foreground         ~ '^#[0-9a-fA-F]{6}$'),

  radius_rem               numeric(3,2) not null default 0.65 check (radius_rem between 0 and 2),

  -- Listas curadas. Titulo admite caras de display condensadas (el programa de
  -- etiqueta las necesita); texto corrido NO, porque en un parrafo son ilegibles.
  font_heading             text not null default 'geist'
                             check (font_heading in ('geist','inter','plus-jakarta','space-grotesk','dm-sans','outfit',
                                                     'bricolage','archivo','oswald','bebas-neue','anton')),
  font_body                text not null default 'geist'
                             check (font_body    in ('geist','inter','plus-jakarta','space-grotesk','dm-sans','outfit')),

  theme_mode               text not null default 'light' check (theme_mode in ('light','dark','system')),

  updated_at               timestamptz not null default now()
);

create trigger store_branding_set_updated_at
  before update on public.store_branding
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------

create table public.store_members (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references public.stores(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  role       text   not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create index store_members_store_id_idx on public.store_members (store_id);
create index store_members_user_id_idx  on public.store_members (user_id);

-- ---------------------------------------------------------------------------
-- credenciales de pago (una fila por tienda) — solo service_role
-- ---------------------------------------------------------------------------

create table public.store_payment_credentials (
  store_id        bigint primary key references public.stores(id) on delete cascade,
  provider        text not null default 'mercadopago' check (provider in ('mercadopago')),
  access_token    text,
  public_key      text,
  webhook_secret  text,
  is_sandbox      boolean not null default true,
  connected_at    timestamptz,
  updated_at      timestamptz not null default now()
);

create trigger store_payment_credentials_set_updated_at
  before update on public.store_payment_credentials
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- catálogo
-- ---------------------------------------------------------------------------

create table public.categories (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references public.stores(id) on delete cascade,
  name       text   not null,
  position   int    not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_store_id_idx on public.categories (store_id);
create index categories_store_active_idx on public.categories (store_id, position) where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

create table public.products (
  id            bigint generated always as identity primary key,
  store_id      bigint not null references public.stores(id) on delete cascade,
  category_id   bigint references public.categories(id) on delete set null,
  name          text   not null,
  description   text,
  image_path    text,                       -- path dentro del bucket `product-images`
  price_cents   bigint not null check (price_cents >= 0),
  prep_minutes  int    not null default 10 check (prep_minutes between 0 and 240),
  is_available  boolean not null default true,
  position      int    not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index products_store_id_idx    on public.products (store_id);
create index products_category_id_idx on public.products (category_id);
create index products_store_available_idx on public.products (store_id, position) where is_available;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- modificadores: "Punto de cocción", "Extras", "Sin ingredientes"
create table public.option_groups (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products(id) on delete cascade,
  name        text   not null,
  min_select  int    not null default 0 check (min_select >= 0),
  max_select  int    not null default 1 check (max_select >= 1),
  position    int    not null default 0,
  created_at  timestamptz not null default now(),
  check (max_select >= min_select)
);

create index option_groups_product_id_idx on public.option_groups (product_id);

create table public.options (
  id                bigint generated always as identity primary key,
  group_id          bigint not null references public.option_groups(id) on delete cascade,
  name              text   not null,
  price_delta_cents bigint not null default 0,
  is_available      boolean not null default true,
  position          int    not null default 0
);

create index options_group_id_idx on public.options (group_id);
