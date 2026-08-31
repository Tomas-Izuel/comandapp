import { compressImage } from '@/views/shared/image-compress'
import { MAX_RECEIPT_BYTES } from '@/models/schemas/order.schema'
import type { OrderPublicView } from '@/models/types'

/**
 * Fases del proceso, mismo criterio que `image-upload.ts`: no hay progreso
 * real por byte sin una dependencia nueva, así que se comunica por ETAPA en
 * vez de inventar un porcentaje.
 */
export type UploadReceiptPhase = 'compressing' | 'uploading'

export type UploadReceiptResult =
  | { ok: true; order: OrderPublicView }
  | { ok: false; error: string; status?: number }

/**
 * Sube el comprobante de transferencia a `/api/orders/<token>/comprobante`.
 *
 * Si es imagen, se comprime con la MISMA función que usa la foto de producto
 * (re-encodeada, JPEG genuino) antes de mandar. Si es PDF, va tal cual —no hay
 * canvas que valga sobre un PDF— con un tope duro de `MAX_RECEIPT_BYTES` (4 MB)
 * chequeado ACÁ, antes de mandar: es el pedido explícito del dueño ("mensaje
 * propio, no el 413 genérico de Vercel").
 *
 * Como el cliente tiene UNA sola oportunidad de subida (00-architecture.md
 * §5.7), esta función nunca reintenta sola ni cachea nada: cada llamada es un
 * intento real, y quien la invoca (`transfer-panel.tsx`) es responsable de no
 * volver a ofrecer el control una vez que `order.transferReceiptUploadedAt` no
 * es `null`.
 */
export async function uploadTransferReceipt(
  token: string,
  file: File,
  onPhase?: (phase: UploadReceiptPhase) => void,
): Promise<UploadReceiptResult> {
  const isPdf = file.type === 'application/pdf'
  const isImage = file.type.startsWith('image/')

  if (!isPdf && !isImage) {
    return { ok: false, error: 'Subí una foto o un PDF del comprobante.' }
  }

  let body: Blob = file
  let filename = file.name || 'comprobante'

  if (isImage) {
    onPhase?.('compressing')
    body = await compressImage(file)
    filename = 'comprobante.jpg'
  } else if (file.size > MAX_RECEIPT_BYTES) {
    return { ok: false, error: 'El PDF pesa más de 4 MB. Subí uno más liviano o una foto del comprobante.' }
  }

  if (body.size > MAX_RECEIPT_BYTES) {
    return { ok: false, error: 'El comprobante sigue pesando más de 4 MB después de comprimirlo. Probá con otra foto.' }
  }

  // F-11 (mismo criterio que `uploadProductImage`): sin señal, `fetch` tarda
  // minutos en fallar en vez de rebotar al toque.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'Estás sin conexión. Probá de nuevo cuando vuelva la señal.' }
  }

  const formData = new FormData()
  formData.append('file', body, filename)

  try {
    onPhase?.('uploading')
    const res = await fetch(`/api/orders/${token}/comprobante`, { method: 'POST', body: formData })
    const responseBody = await res.json()

    if (!res.ok) {
      return { ok: false, error: responseBody.error ?? 'No se pudo subir el comprobante', status: res.status }
    }
    return { ok: true, order: responseBody.order as OrderPublicView }
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor. Probá de nuevo.' }
  }
}
