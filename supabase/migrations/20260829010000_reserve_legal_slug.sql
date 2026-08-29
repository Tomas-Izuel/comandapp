-- ---------------------------------------------------------------------------
-- Slug reservado: `/legal`
--
-- Las políticas de la plataforma (privacidad y términos) viven en `/legal/*`.
-- Un local con slug `legal` quedaría inalcanzable hoy (el segmento estático de
-- Next gana sobre `[store]`) y sería secuestro de ruta con la iteración de
-- subdominios ya decidida.
--
-- La lista está a propósito duplicada en RESERVED_SLUGS de platform.schema.ts:
-- la base garantiza que no entre, el schema hace que el mensaje se entienda.
-- Si se agrega uno, va en los dos lados.
-- ---------------------------------------------------------------------------

alter table public.stores drop constraint stores_slug_not_reserved_check;
alter table public.stores
  add constraint stores_slug_not_reserved_check check (
    slug not in (
      'admin','api','app','assets','auth','backoffice','blog','carrito','checkout',
      'dashboard','docs','envios','favicon','functions','graphql','health','help',
      'images','legal','login','logout','manifest','mis-pedidos','new','nueva',
      'pedido','pedidos','public','realtime','repartidor','repartidores','rest',
      'robots','settings','sitemap','static','status','storage','support','www',
      '_next'
    )
  );
