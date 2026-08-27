-- Storage: fotos de producto
--
-- Convención de path: {store_id}/{archivo}
-- Eso permite escribir policies por tienda leyendo el primer segmento.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública: el bucket es público, pero dejamos la policy explícita.
create policy product_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

-- Escritura: solo staff de la tienda dueña del primer segmento del path.
create policy product_images_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select private.is_store_member((storage.foldername(name))[1]::bigint))
  );

create policy product_images_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.is_store_member((storage.foldername(name))[1]::bigint))
  );

create policy product_images_staff_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.is_store_member((storage.foldername(name))[1]::bigint))
  );
