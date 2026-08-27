import { clientEnv } from '@/lib/env.client'

/**
 * URL pública de un archivo del bucket de fotos de producto.
 *
 * Vive acá, y no en `catalog.model.ts`, porque el cálculo lo necesitan las dos
 * orillas: el modelo (servidor) al armar el menú, y el campo de imagen del
 * panel (cliente) al mostrar el preview de lo que se acaba de subir. El modelo
 * tiene `import 'server-only'`, así que un componente cliente no puede
 * importarlo: la consecuencia era la misma función copiada en dos lugares, con
 * un comentario reconociéndolo.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` tiene el mismo valor en las dos orillas, así que la
 * URL que se calcula en el cliente y la que se calcula en el servidor coinciden
 * — que es justo lo que hace falta para que `next/image` no vea dos hosts
 * distintos para la misma foto.
 */

export const PRODUCT_IMAGES_BUCKET = 'product-images'

export function productImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${path}`
}

/**
 * Path dentro del bucket para la foto de un producto.
 *
 * El primer segmento es el `store_id` y no es cosmético: las policies de Storage
 * leen ese segmento para decidir quién puede escribir (`is_store_member` sobre
 * `(storage.foldername(name))[1]`). Cambiar la convención rompe la autorización.
 */
export function productImagePath(storeId: number, fileName: string): string {
  return `${storeId}/${fileName}`
}
