-- Vencimiento de la preferencia de pago, persistido
--
-- `attachPreference` recibia el `expiresAt` que devuelve Mercado Pago al crear la
-- preferencia y no tenia donde guardarlo, asi que para saber si el link todavia
-- sirve habia que volver a preguntarle a MP. Eso es una llamada de red en el
-- camino del boton "Ir a pagar" —justo cuando el cliente ya tuvo un problema— y
-- una llamada mas por cada corrida del cron de expiracion.
--
-- Con la columna, el caso comun ("vencio hace media hora") se resuelve leyendo
-- la fila. MP sigue siendo la fuente de verdad cuando la columna dice que
-- todavia esta viva y hay que ir a buscar el init_point igual.

alter table public.orders
  add column if not exists preference_expires_at timestamptz;

comment on column public.orders.preference_expires_at is
  'Cuando deja de servir el init_point de la preferencia. Lo devuelve Mercado Pago al crearla.';
