const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/**
 * Redimensiona a un máximo de 1600px de lado y recomprime a JPEG ~82%.
 *
 * Extraída de `views/admin/catalogo/image-upload.ts` (que la tenía local) para
 * que el comprobante de transferencia del cliente (`views/storefront/receipt-upload.ts`)
 * la reuse tal cual — escribir una segunda función igual es exactamente lo que
 * `CLAUDE.md` prohíbe, y acá además importa la propiedad de seguridad: al
 * re-encodear los píxeles, la salida es un JPEG genuino producido por el
 * browser, cualquiera haya sido la entrada. Eso es lo que mantiene cualquier
 * subida por debajo del límite de 4,5 MB de Vercel y lo que hace que el sniff
 * de magic bytes del servidor sea una segunda red, no la única defensa.
 */
export async function compressImage(file: File): Promise<Blob> {
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
