-- Links del local en la vitrina + defaults de marca del mundo visual nuevo.
--
-- Dos cosas distintas en una migracion porque las dos salen de la misma
-- decision de producto (2026-08-28): la vitrina pasa a tener un dock flotante
-- al pie con los canales propios del local, y el kit de marca por defecto deja
-- de ser el naranja generico.

-- ---------------------------------------------------------------------------
-- 1. stores: los canales que el local publica en su vitrina
-- ---------------------------------------------------------------------------
--
-- WhatsApp y direccion NO se agregan: ya existen (`whatsapp_phone_e164`,
-- `address`). Lo que falta es Instagram, un link de mapa preciso, y las tres
-- apps de delivery por las que el local tambien vende.
--
-- Instagram se guarda como HANDLE, no como URL: la URL la arma la vista. Un
-- campo de URL libre para "Instagram" es un link a cualquier lado con el
-- logo de Instagram al lado, que es exactamente lo que no queremos publicar
-- desde la pagina del local.
--
-- Las tres apps de delivery SI son URL, porque cada local tiene su propia
-- ficha y no hay forma de derivarla. Pero el host esta acotado a la marca que
-- el boton dice: un boton que dice "Rappi" tiene que ir a Rappi. Esto es la
-- misma logica que `stores_slug_not_reserved_check` — la base garantiza que
-- no entre, el schema de Zod hace que el mensaje se entienda.

alter table public.stores
  add column if not exists instagram_handle text,
  add column if not exists maps_url         text,
  add column if not exists rappi_url        text,
  add column if not exists pedidos_ya_url   text,
  add column if not exists uber_eats_url    text;

alter table public.stores
  add constraint stores_instagram_handle_check
    check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),

  -- El mapa no se puede acotar a un host: Google Maps, Apple Maps y los
  -- acortadores propios de cada uno son todos legitimos. Lo que si se exige
  -- es https — sin eso `javascript:` y `data:` entran por PostgREST.
  add constraint stores_maps_url_check
    check (maps_url is null or (maps_url ~ '^https://' and length(maps_url) <= 500)),

  add constraint stores_rappi_url_check
    check (rappi_url is null or (
      rappi_url ~ '^https://([a-zA-Z0-9-]+\.)*rappi\.com(\.[a-z]{2})?(/|$)' and length(rappi_url) <= 500
    )),

  add constraint stores_pedidos_ya_url_check
    check (pedidos_ya_url is null or (
      pedidos_ya_url ~ '^https://([a-zA-Z0-9-]+\.)*pedidosya\.com(\.[a-z]{2})?(/|$)' and length(pedidos_ya_url) <= 500
    )),

  add constraint stores_uber_eats_url_check
    check (uber_eats_url is null or (
      uber_eats_url ~ '^https://([a-zA-Z0-9-]+\.)*ubereats\.com(/|$)' and length(uber_eats_url) <= 500
    ));

-- Los grants de `stores` son por COLUMNA (ver 20260826120000_hardening.sql):
-- una columna nueva NO queda escribible sola. Sin esto el dueño del local
-- guarda sus links y PostgREST responde `42501 permission denied`.
grant update (
  instagram_handle, maps_url, rappi_url, pedidos_ya_url, uber_eats_url
) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- 2. store_branding: nuevos defaults de plataforma
-- ---------------------------------------------------------------------------
--
-- Solo el DEFAULT. Las filas existentes conservan lo que el local eligio: un
-- update masivo acá le cambiaria la marca a un local que ya la configuro.
--
-- El verde no es el de la referencia tal cual (#8cc63f). Ese lima da 2.05:1
-- contra blanco, y en esta composicion el color de marca ES el color del
-- precio sobre la tarjeta blanca: a 2.05:1 el precio no se lee al sol, que es
-- justo donde se usa la app. #468511 es el mismo verde bajado en lightness
-- hasta 4.54:1 — pasa sin que `ensureContrast()` tenga que corregir nada, así
-- que el color que elige la plataforma es el color que se ve. El lima queda
-- como `color_accent`, donde vive en lavados claros con texto oscuro.
alter table public.store_branding
  alter column color_primary set default '#468511',
  alter column color_accent  set default '#8cc63f',
  alter column radius_rem    set default 1.25;
