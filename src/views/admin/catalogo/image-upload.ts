import { createClient } from '@/lib/supabase/client'
import { clientEnv } from '@/lib/env.client'
import { randomUuidV4 } from '@/lib/uuid'

const BUCKET = 'product-images'
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/** Mismo cómputo que `productImageUrl()` en catalog.model.ts, para el preview del browser. */
export function productImagePublicUrl(imagePath: string | null): string | null {
  if (!imagePath) return null
  return `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${imagePath}`
}

/**
 * Redimensiona a un máximo de 1600px de lado y recomprime a JPEG ~82%. Las
 * fotos de celular llegan pesadas (4-8MB de una cámara moderna) y el bucket
 * corta en 5MB — sin esto, la mitad de las fotos del mostrador rebotarían.
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  return blob ?? file
}

export type UploadProductImageResult = { ok: true; path: string } | { ok: false; error: string }

/**
 * Fases del proceso, para que la UI muestre progreso real y no un spinner
 * mudo. `storage-js` sube por `fetch` y no expone progreso a nivel de byte
 * (eso pide un cliente resumable tipo `tus-js-client`, una dependencia nueva
 * que este slice no puede instalar) — así que el progreso es por etapa, no
 * por porcentaje de bytes, y se lo decimos así al dueño en vez de inventar un
 * número que no existe.
 */
export type UploadPhase = 'compressing' | 'uploading'

/**
 * Sube a `{store_id}/{archivo}` con el cliente del browser autenticado: las
 * RLS de `storage.objects` leen ese primer segmento del path para decidir si
 * el staff logueado puede escribir ahí.
 */
export async function uploadProductImage(
  storeId: number,
  file: File,
  onPhase?: (phase: UploadPhase) => void,
): Promise<UploadProductImageResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'El archivo tiene que ser una imagen (JPG, PNG, WebP o AVIF)' }
  }

  // F-11: sin señal, `fetch` tarda minutos en fallar en vez de rebotar al toque.
  // Cortamos antes de gastar batería y datos comprimiendo algo que no va a salir.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'Estás sin conexión. La foto se sube cuando vuelva la señal.' }
  }

  try {
    onPhase?.('compressing')
    const compressed = await compressImage(file)
    if (compressed.size > 5 * 1024 * 1024) {
      return { ok: false, error: 'La foto sigue pesando más de 5MB después de comprimirla. Probá con otra.' }
    }

    const extension = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() ?? 'jpg')
    // `randomUuidV4` y no `crypto.randomUUID()`: el dueño del local sube las
    // fotos DESDE EL CELULAR, y si entra por IP de LAN (http://192.168.x.x)
    // el contexto no es seguro y `crypto.randomUUID` no existe.
    const path = `${storeId}/${randomUuidV4()}.${extension}`

    const supabase = createClient()
    onPhase?.('uploading')
    const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
      contentType: compressed.type || file.type,
      upsert: false,
      // T5: el objeto de origen tiene que declarar el mismo TTL que
      // `minimumCacheTTL` de next.config.ts (1 año). El path es un UUID v4
      // subido con upsert:false, así que el contenido de una URL nunca
      // cambia — cambiar la foto de un producto genera un path nuevo, nunca
      // pisa el viejo. Sin este header el objeto sale con el default de
      // Supabase Storage (`max-age=3600`); Next ya toma el mayor de los dos
      // TTL, pero declararlo acá evita que un CDN intermedio o un fetch
      // directo al storage (fuera de `/_next/image`) revalide cada hora.
      cacheControl: '31536000',
    })

    if (error) return { ok: false, error: `No se pudo subir la foto: ${error.message}` }
    return { ok: true, path }
  } catch {
    return { ok: false, error: 'No se pudo procesar la imagen. Probá con otro archivo.' }
  }
}

/** Best-effort: si falla el borrado del archivo viejo no rompe el guardado del producto. */
export async function deleteProductImage(path: string): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.storage.from(BUCKET).remove([path])
  } catch {
    // silenciado a propósito
  }
}
