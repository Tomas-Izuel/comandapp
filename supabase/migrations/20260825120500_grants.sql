-- GRANTs para el Data API (PostgREST)
--
-- Supabase NO expone automáticamente las tablas nuevas al Data API. Sin estos
-- grants el catálogo devuelve vacío aunque las RLS estén perfectas: RLS decide
-- qué FILAS ves, el grant decide si la TABLA existe para vos.
--
-- Regla: `anon` solo lee el catálogo. Nada de pedidos, nada de plataforma.

grant usage on schema public to anon, authenticated;

-- --- catálogo público: lectura para todos --------------------------------
grant select on public.stores          to anon, authenticated;
grant select on public.store_branding  to anon, authenticated;
grant select on public.categories      to anon, authenticated;
grant select on public.products        to anon, authenticated;
grant select on public.option_groups   to anon, authenticated;
grant select on public.options         to anon, authenticated;

-- --- staff del local: administra su tienda --------------------------------
grant insert, update, delete on public.stores         to authenticated;
grant insert, update, delete on public.store_branding to authenticated;
grant insert, update, delete on public.categories     to authenticated;
grant insert, update, delete on public.products       to authenticated;
grant insert, update, delete on public.option_groups  to authenticated;
grant insert, update, delete on public.options        to authenticated;
grant select, insert, update, delete on public.store_members to authenticated;
grant select, insert, update, delete on public.pos_endpoints to authenticated;

-- Pedidos: el staff lee y cambia estados. Crear pedidos es del servidor.
grant select, update on public.orders             to authenticated;
grant select          on public.order_items       to authenticated;
grant select          on public.order_item_options to authenticated;
grant select          on public.payments          to authenticated;
grant select          on public.order_events      to authenticated;
grant select          on public.notifications     to authenticated;

-- --- service_role: el servidor de Next.js -----------------------------------
--
-- OJO: Supabase NO le da privilegios a `service_role` sobre las tablas que crea
-- una migración. Bypassear RLS no sirve de nada si el GRANT no existe: sin este
-- bloque, crear un pedido y el webhook de Mercado Pago fallan con 42501.
-- Verificado a mano: `permission denied for table orders`.

grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Y que valga también para lo que se cree en migraciones futuras.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- --- plataforma (backoffice) ----------------------------------------------
grant select on public.platform_admins    to authenticated;
grant select on public.platform_audit_log to authenticated;

-- Nada de esto le abre la puerta a `anon` sobre pedidos: no hay grant y
-- tampoco hay policy. Doble candado.
revoke all on public.orders             from anon;
revoke all on public.order_items        from anon;
revoke all on public.order_item_options from anon;
revoke all on public.payments           from anon;
revoke all on public.order_events       from anon;
revoke all on public.notifications      from anon;
revoke all on public.store_payment_credentials from anon, authenticated;
revoke all on public.platform_admins    from anon;
revoke all on public.platform_audit_log from anon;
