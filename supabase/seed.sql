-- Datos de demo para desarrollo local.

-- El pago presencial va habilitado en la tienda de demo a propósito: es el
-- único camino de pago que se puede recorrer completo sin cargar credenciales
-- de Mercado Pago, así que sin esto el QC del ciclo de pedido queda bloqueado.
-- Links de demo del dock de la vitrina: valores plausibles, no reales, pero
-- tienen que pasar los CHECK de `stores_*_url_check` (mismo regex que
-- `store.schema.ts`). `maps_url` es una búsqueda de Google Maps por la
-- dirección de arriba, no un place_id inventado.
insert into public.stores (slug, name, description, phone_e164, whatsapp_phone_e164, address,
                           min_order_cents, demand_threshold_orders, demand_multiplier,
                           in_store_payment_enabled,
                           instagram_handle, maps_url, rappi_url, pedidos_ya_url, uber_eats_url)
values ('la-birra', 'La Birra Burgers', 'Smash burgers y papas de verdad.',
        '+5491122334455', '+5491122334455', 'Av. Corrientes 1234, CABA',
        500000, 5, 1.60,
        true,
        'labirra.ok',
        'https://www.google.com/maps/search/?api=1&query=Av.+Corrientes+1234%2C+CABA',
        'https://www.rappi.com.ar/restaurantes/la-birra-burgers',
        'https://www.pedidosya.com.ar/restaurantes/buenos-aires/la-birra-burgers',
        'https://www.ubereats.com/ar/store/la-birra-burgers')
on conflict (slug) do nothing;

-- Defaults del mundo visual nuevo (2026-08-28): el verde bajado en lightness
-- hasta 4.54:1 contra blanco, no el naranja de etiqueta de cerveza que
-- reemplazó. Mismos valores que el DEFAULT de la columna — ver
-- `branding.schema.ts` para el porqué completo del contraste.
insert into public.store_branding (store_id, color_primary, color_accent, radius_rem, font_heading, font_body)
select id, '#468511', '#8cc63f', 1.25, 'geist', 'geist'
from public.stores where slug = 'la-birra'
on conflict (store_id) do nothing;

with s as (select id from public.stores where slug = 'la-birra')
insert into public.categories (store_id, name, position)
select s.id, c.name, c.position
from s, (values ('Burgers', 1), ('Papas', 2), ('Bebidas', 3), ('Postres', 4)) as c(name, position)
on conflict do nothing;

with s as (select id from public.stores where slug = 'la-birra'),
     cat as (select c.id, c.name from public.categories c join s on c.store_id = s.id)
insert into public.products (store_id, category_id, name, description, price_cents, prep_minutes, position)
select s.id, cat.id, p.name, nullif(p.description, ''), p.price_cents, p.prep_minutes, p.position
from s
cross join (values
  ('Burgers', 'Clasica',        'Medallon de 150g, cheddar, lechuga, tomate y salsa de la casa.', 780000, 10, 1),
  ('Burgers', 'Doble Cheddar',  'Dos medallones smash, doble cheddar y cebolla caramelizada.',    980000, 14, 2),
  ('Burgers', 'Bacon Bomb',     'Medallon, bacon crocante, cheddar y barbacoa ahumada.',         1050000, 15, 3),
  ('Burgers', 'Veggie',         'Medallon de garbanzo y remolacha, palta y rucula.',              850000, 12, 4),
  ('Papas',   'Papas Clasicas', 'Baston grueso con sal marina.',                                  400000,  6, 1),
  ('Papas',   'Papas Cheddar',  'Con cheddar fundido y bacon.',                                   620000,  8, 2),
  ('Bebidas', 'Coca-Cola 500ml','',                                                               250000,  1, 1),
  ('Bebidas', 'Agua sin gas',   '',                                                               200000,  1, 2),
  ('Bebidas', 'IPA Artesanal',  'Pinta de 473ml.',                                                480000,  1, 3),
  ('Postres', 'Brownie',        'Con helado de crema americana.',                                 450000,  3, 1)
) as p(category, name, description, price_cents, prep_minutes, position)
join cat on cat.name = p.category;

-- Modificadores de la Clásica y la Doble
with p as (select id, name from public.products where name in ('Clasica', 'Doble Cheddar'))
insert into public.option_groups (product_id, name, min_select, max_select, position)
select p.id, g.name, g.min_select, g.max_select, g.position
from p, (values ('Punto de cocción', 1, 1, 1), ('Extras', 0, 4, 2)) as g(name, min_select, max_select, position);

insert into public.options (group_id, name, price_delta_cents, position)
select g.id, o.name, o.price_delta_cents, o.position
from public.option_groups g
join (values ('Jugosa', 0, 1), ('A punto', 0, 2), ('Bien cocida', 0, 3)) as o(name, price_delta_cents, position) on true
where g.name = 'Punto de cocción';

insert into public.options (group_id, name, price_delta_cents, position)
select g.id, o.name, o.price_delta_cents, o.position
from public.option_groups g
join (values ('Bacon', 120000, 1), ('Huevo frito', 90000, 2), ('Cheddar extra', 100000, 3), ('Sin cebolla', 0, 4)) as o(name, price_delta_cents, position) on true
where g.name = 'Extras';
