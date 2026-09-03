const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82
/** WebP soporta alfa y comprime mucho mejor que PNG; por eso el logo con
 *  transparencia no cae directo a PNG salvo que el browser no sepa producir WebP. */
const ALPHA_QUALITY = 0.9

/**
 * Solo estos tipos de origen PUEDEN traer canal alfa. Un JPEG nunca lo tiene
 * (no existe en el formato), así que ahí ni vale la pena escanear los píxeles:
 * sigue el camino de siempre sin tocar nada.
 */
const TYPES_WITH_POSSIBLE_ALPHA = new Set(['image/png', 'image/webp', 'image/avif', 'image/gif'])

/**
 * Redimensiona a un máximo de 1600px de lado y recomprime la imagen.
 *
 * Extraída de `views/admin/catalogo/image-upload.ts` (que la tenía local) para
 * que el comprobante de transferencia del cliente (`views/storefront/receipt-upload.ts`)
 * la reuse tal cual — escribir una segunda función igual es exactamente lo que
 * `CLAUDE.md` prohíbe, y acá además importa la propiedad de seguridad: al
 * re-encodear los píxeles en el browser, la salida es SIEMPRE una imagen
 * genuina producida acá —nunca el archivo original—, sea cual sea el formato
 * elegido. Eso es lo que mantiene cualquier subida por debajo del límite de
 * 4,5 MB de Vercel y lo que hace que el sniff de magic bytes del servidor sea
 * una segunda red, no la única defensa.
 *
 * Por default se re-encodea a JPEG 82%: no tiene canal alfa, pero para una
 * foto de producto sin transparencia comprime mejor que cualquier alternativa.
 * La excepción es un archivo de origen que REALMENTE use ese canal —un logo
 * con fondo transparente, típicamente—: forzarlo a JPEG pintaba de negro los
 * píxeles transparentes, porque JPEG no tiene dónde guardar el alfa (bug
 * verificado contra la base: el logo de una tienda había quedado guardado
 * como `.jpg`). Ahí se re-encodea a WebP —con alfa y buena compresión— y, si
 * el browser no lo sabe producir en `toBlob`, se cae a PNG.
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

  const hasAlpha = TYPES_WITH_POSSIBLE_ALPHA.has(file.type) && scanForAlpha(ctx, width, height)

  if (hasAlpha) {
    const webp = await toBlobStrict(canvas, 'image/webp', ALPHA_QUALITY)
    if (webp) return webp
    const png = await toBlobStrict(canvas, 'image/png')
    if (png) return png
    return file
  }

  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  return jpeg ?? file
}

/**
 * Escaneo completo a propósito, no un muestreo: un logo con un borde
 * transparente de dos píxeles tiene que contar igual que uno mitad
 * transparente. El canvas nunca queda "tainted" acá porque la fuente siempre
 * es un `File` local (nunca una URL cross-origin), así que `getImageData`
 * nunca tira `SecurityError`.
 */
function scanForAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

/**
 * `canvas.toBlob` con el tipo pedido, pero verificando el tipo REAL del blob
 * devuelto: un Safari viejo no tira error ni devuelve `null` cuando no sabe
 * codificar WebP, devuelve un PNG en silencio con `type: 'image/png'`. Sin
 * este chequeo, esa respuesta se aceptaría como si fuera el WebP pedido.
 */
function toBlobStrict(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality)
  })
}
