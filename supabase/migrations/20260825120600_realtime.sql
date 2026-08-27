-- Realtime para el panel de cocina
--
-- Sin esto el KDS solo se entera de un pedido nuevo cuando le toca el polling.
-- El polling se mantiene igual como red: si Realtime se cae, un panel de cocina
-- mudo pierde pedidos, y eso es plata.
--
-- Solo `orders`: los ítems se leen cuando llega el evento de la cabecera, así
-- que publicarlos también sería tráfico al pedo.

alter publication supabase_realtime add table public.orders;

-- Realtime respeta RLS, así que cada local solo recibe los eventos de sus
-- propios pedidos vía `orders_staff_read`. `anon` no recibe absolutamente nada.
