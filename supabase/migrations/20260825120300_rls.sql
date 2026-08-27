-- Row Level Security
--
-- Modelo de acceso:
--   anon           -> solo lectura del catálogo publicado. Cero acceso a pedidos.
--   authenticated  -> staff: acceso completo a los datos de SUS tiendas.
--   service_role   -> el servidor de Next.js. Crea pedidos, procesa webhooks y
--                     lee credenciales de pago. Bypassea RLS por diseño.
--
-- Los pedidos NUNCA son legibles por anon: el cliente los consulta con su
-- public_token a través de un route handler que corre con service_role.

alter table public.platform_admins           enable row level security;
alter table public.platform_audit_log        enable row level security;
alter table public.stores                    enable row level security;
alter table public.store_branding            enable row level security;
alter table public.store_members             enable row level security;
alter table public.store_payment_credentials enable row level security;
alter table public.categories                enable row level security;
alter table public.products                  enable row level security;
alter table public.option_groups             enable row level security;
alter table public.options                   enable row level security;
alter table public.orders                    enable row level security;
alter table public.order_items               enable row level security;
alter table public.order_item_options        enable row level security;
alter table public.payments                  enable row level security;
alter table public.order_events              enable row level security;
alter table public.notifications             enable row level security;
alter table public.pos_endpoints             enable row level security;

-- ---------------------------------------------------------------------------
-- catálogo público (lectura)
-- ---------------------------------------------------------------------------

create policy stores_public_read on public.stores
  for select to anon, authenticated
  using (status = 'active');

create policy store_branding_public_read on public.store_branding
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_branding.store_id and s.status = 'active'
    )
  );

create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.stores s
      where s.id = categories.store_id and s.status = 'active'
    )
  );

create policy products_public_read on public.products
  for select to anon, authenticated
  using (
    is_available
    and exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.status = 'active'
    )
  );

create policy option_groups_public_read on public.option_groups
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = option_groups.product_id and p.is_available
    )
  );

create policy options_public_read on public.options
  for select to anon, authenticated
  using (is_available);

-- ---------------------------------------------------------------------------
-- staff: administración del catálogo y de la tienda
-- ---------------------------------------------------------------------------

create policy stores_staff_all on public.stores
  for all to authenticated
  using ((select private.is_store_member(id)))
  with check ((select private.is_store_member(id)));

create policy store_members_read on public.store_members
  for select to authenticated
  using ((select private.is_store_member(store_id)));

create policy store_members_owner_manage on public.store_members
  for all to authenticated
  using ((select private.is_store_owner(store_id)))
  with check ((select private.is_store_owner(store_id)));

create policy store_branding_staff_all on public.store_branding
  for all to authenticated
  using ((select private.is_store_member(store_id)))
  with check ((select private.is_store_member(store_id)));

create policy categories_staff_all on public.categories
  for all to authenticated
  using ((select private.is_store_member(store_id)))
  with check ((select private.is_store_member(store_id)));

create policy products_staff_all on public.products
  for all to authenticated
  using ((select private.is_store_member(store_id)))
  with check ((select private.is_store_member(store_id)));

create policy option_groups_staff_all on public.option_groups
  for all to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = option_groups.product_id
        and (select private.is_store_member(p.store_id))
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = option_groups.product_id
        and (select private.is_store_member(p.store_id))
    )
  );

create policy options_staff_all on public.options
  for all to authenticated
  using (
    exists (
      select 1 from public.option_groups g
      join public.products p on p.id = g.product_id
      where g.id = options.group_id
        and (select private.is_store_member(p.store_id))
    )
  )
  with check (
    exists (
      select 1 from public.option_groups g
      join public.products p on p.id = g.product_id
      where g.id = options.group_id
        and (select private.is_store_member(p.store_id))
    )
  );

-- ---------------------------------------------------------------------------
-- staff: pedidos (lectura + cambios de estado). La creación es del servidor.
-- ---------------------------------------------------------------------------

create policy orders_staff_read on public.orders
  for select to authenticated
  using ((select private.is_store_member(store_id)));

create policy orders_staff_update on public.orders
  for update to authenticated
  using ((select private.is_store_member(store_id)))
  with check ((select private.is_store_member(store_id)));

create policy order_items_staff_read on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (select private.is_store_member(o.store_id))
    )
  );

create policy order_item_options_staff_read on public.order_item_options
  for select to authenticated
  using (
    exists (
      select 1 from public.order_items i
      join public.orders o on o.id = i.order_id
      where i.id = order_item_options.order_item_id
        and (select private.is_store_member(o.store_id))
    )
  );

create policy payments_staff_read on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (select private.is_store_member(o.store_id))
    )
  );

create policy order_events_staff_read on public.order_events
  for select to authenticated
  using ((select private.is_store_member(store_id)));

create policy notifications_staff_read on public.notifications
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = notifications.order_id
        and (select private.is_store_member(o.store_id))
    )
  );

create policy pos_endpoints_owner_all on public.pos_endpoints
  for all to authenticated
  using ((select private.is_store_owner(store_id)))
  with check ((select private.is_store_owner(store_id)));


-- ---------------------------------------------------------------------------
-- plataforma (backoffice)
--
-- private.is_platform_admin() ya exige aal2, asi que una sesion sin el segundo
-- factor verificado ve cero filas aunque el usuario sea admin.
-- ---------------------------------------------------------------------------

-- Solo lectura via API: las altas de admin se hacen por SQL, a mano.
create policy platform_admins_read on public.platform_admins
  for select to authenticated
  using ((select private.is_platform_admin()));

-- El log se escribe con service_role; el backoffice solo lo lee.
create policy platform_audit_log_read on public.platform_audit_log
  for select to authenticated
  using ((select private.is_platform_admin()));

-- La plataforma da de alta, suspende y reactiva tiendas.
create policy stores_platform_all on public.stores
  for all to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

create policy store_members_platform_all on public.store_members
  for all to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- store_payment_credentials: sin policies a proposito.
-- Solo service_role (que bypassea RLS) puede leerlas o escribirlas. Ni siquiera
-- un platform admin ve los tokens de Mercado Pago de los locales.

