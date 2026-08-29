# T5 — Cerrar el vector de imágenes por configuración (parte de agente)

**Agente**: frontend-react-craftsman (rol asignado en el prompt: `senior-backend-engineer`,
pero la tarea repartida acá era puramente `src/views/admin/catalogo/image-upload.ts`,
sin backend real que tocar).

**Estado al arrancar**: el hilo principal ya había cerrado `next.config.ts` y está
commiteado (`search: ''` en los tres `remotePatterns`, hostname pinneado a
`xyjracoaufarsnhurhdc.supabase.co`, `minimumCacheTTL: 31536000`). Verificado leyendo el
archivo — no lo edité, es de solo lectura para este agente.

## Qué se hizo

**Archivo tocado**: `src/views/admin/catalogo/image-upload.ts` (único archivo de mi
propiedad).

Un solo cambio: agregado `cacheControl: '31536000'` al `upload()` de Storage
(`uploadProductImage`, línea ~86-95). Antes solo pasaba `contentType` y `upsert: false`.

Justificación (dejada como comentario en el propio archivo): el objeto de origen en
Storage sale hoy con el default de Supabase (`max-age=3600`, confirmado en
§3.2 de `00-architecture.md`), mientras que `next.config.ts` ya declara
`minimumCacheTTL: 31536000` en el optimizador. Next toma el mayor de los dos TTL, así
que el cambio no es estrictamente necesario para que `/_next/image` cachee un año — pero
sin él, cualquier acceso que no pase por `/_next/image` (un fetch directo al storage, un
CDN intermedio) revalida cada hora contra un contenido que por diseño nunca cambia. Es
la config del lado de origen diciendo la misma verdad que ya dice el optimizador.

Verifiqué (sin tocar nada, solo lectura) que el invariante que hace correcto este TTL
largo sigue siendo cierto en este mismo archivo:
- Línea 82: `path = ${storeId}/${randomUuidV4()}.${extension}` — path nuevo en cada
  subida, nunca reutilizado.
- Línea 88: `upsert: false` — un intento de pisar un path existente rebota en vez de
  sobrescribir en silencio.

O sea: **el contenido de una URL dada nunca cambia** y cambiar la foto de un producto
siempre genera una URL nueva. No encontré ninguna regresión de este invariante — no
hace falta reportarlo como bug, al contrario de lo que el brief me pedía chequear "por
si". `productImagePublicUrl()` (línea 10-13) tampoco agrega query string a la URL
pública, así que el matcher `search: ''` de `next.config.ts` no se rompe desde este
archivo.

## Hallazgo para reportar (NO corregido, `next.config.ts` es de solo lectura para mí)

**Falta `qualities: [75]` explícito en el bloque `images` de `next.config.ts`.**

El punto 3 de la sección T5 de `01-tasks.md` pide declararlo explícito, y el criterio de
aceptación 4 depende de eso ("`q` distinto de 75 no genera una variante nueva — Next lo
colapsa al valor permitido"). Leí el archivo completo: el bloque `images` solo tiene
`remotePatterns`, `deviceSizes` y `minimumCacheTTL` — no hay `qualities` en ningún lado
(`grep -n qualities next.config.ts` no devuelve nada).

Sin esa declaración, Next 16 usa su default de `qualities` (más de un valor permitido),
así que un `q` distinto de 75 en la URL de `/_next/image` puede seguir generando una
variante de cache nueva en vez de colapsar al único valor legítimo que usa la app. Es
exactamente el mismo vector que el resto de T5 cierra para `search`/`hostname`: una
query string que hoy se acepta sin necesidad y multiplica transformaciones facturables.

No lo corregí porque el archivo es propiedad exclusiva de otro dueño en el mapa de
`01-tasks.md` y el prompt de esta tarea es explícito: "`next.config.ts` es de solo
lectura para vos. NO lo edites. Si encontrás algo mal ahí, reportalo." Esto se reporta
acá para que el hilo principal (o quien tenga la propiedad de `next.config.ts`) agregue
`qualities: [75]` al mismo objeto `images`.

## Verificación

- `npm run typecheck`: limpio.
- `npm run lint`: limpio salvo los 6 warnings preexistentes en `tests/**` (no son de
  esta tarea, confirmado que no cambiaron).
- No corrí `next build` con curl real (el criterio 1-5 de aceptación de T5 depende
  también del `next.config.ts` ya cerrado, que no es de mi propiedad; no reejecuté esa
  verificación end-to-end porque no toqué ese archivo y no quiero levantar el stack de
  Supabase sin necesidad — está fuera de mi lane).

## Para el test engineer

No hay comportamiento nuevo de UI ni de usuario: este archivo no renderiza nada, es
lógica de subida desde un Client Component (`views/admin/catalogo/*.tsx`, que no toqué).
No hay acceptance criteria de interacción nuevos que testear acá — lo único observable
es el header `Cache-Control` (o el campo `cacheControl` del form-data) en la request de
subida a Storage, que es una preocupación de integración/contrato, no de UI. Si
`tests/` cubre este archivo, lo relevante a verificar es:
- `uploadProductImage` llama a `.upload(path, compressed, { contentType, upsert: false,
  cacheControl: '31536000' })` — los cuatro campos, no solo los dos que había antes.
- El resto del comportamiento de la función (compresión, validación de tamaño, offline,
  fases) no cambió.

## Fuera de alcance (no tocado, ya lo dice el brief)

`product-row.tsx`, `apariencia/image-field.tsx` (imágenes crudas sin `<Image>`), cuota
de Storage por tienda, archivos huérfanos, `WITH CHECK` faltante en
`product_images_staff_update`. Todo ya reportado en §7 de `00-architecture.md` por el
hilo principal; no se repite acá.
