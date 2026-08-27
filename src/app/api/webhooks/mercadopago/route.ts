import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/services/payments'
import { confirmMercadoPagoPayment } from '@/controllers/checkout.controller'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'

/**
 * Webhook de Mercado Pago. Orden estricto, no negociable:
 *   1. `verifyWebhookSignature` — nadie toca la base sin esto.
 *   2. `fetchPayment` (adentro de `confirmMercadoPagoPayment`) — re-consulta a
 *      MP, nunca le creemos al body de la notificación.
 *   3. `markOrderPaid` — idempotente (dedupe por `provider_payment_id`).
 *
 * `store_id` viaja en el query string de la `notification_url` que armamos
 * en `createCheckout`: es la única forma de saber con qué credenciales
 * validar la firma antes de leer nada de la base.
 *
 * El código de respuesta le dice a MP si tiene sentido reintentar (P-05):
 * - Firma inválida / falta store_id: 401/400. MP no reintenta un request mal
 *   formado.
 * - `DomainError` al confirmar (tienda sin conectar Mercado Pago, pago en
 *   modo sandbox en producción, etc.): 200. Es una condición de negocio que
 *   NO se arregla sola — reintentar solo repite el mismo rechazo.
 * - Cualquier otro error (timeout contra la API de MP, Postgres caído, cold
 *   start): 5xx. Ahí SÍ hay que dejar que MP reintente, porque un pago ya
 *   aprobado en MP con un pedido que se queda `pending` para siempre es el
 *   peor caso del producto — antes un `catch` genérico devolvía 200 acá y el
 *   pago se perdía sin dejar rastro.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const storeId = Number(url.searchParams.get('store_id'))
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: 'Falta store_id' }, { status: 400 })
  }

  let body: { type?: string; data?: { id?: string | number } } | null = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const type = url.searchParams.get('type') ?? url.searchParams.get('topic') ?? body?.type ?? null
  // MP manda otros topics (merchant_order, etc.): los reconocemos sin procesar.
  if (type && type !== 'payment') {
    return NextResponse.json({ ok: true })
  }

  const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? body?.data?.id ?? null
  if (!dataId) {
    return NextResponse.json({ ok: true })
  }

  const provider = getPaymentProvider()
  const verified = await provider.verifyWebhookSignature({
    storeId,
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId: String(dataId),
  })
  if (!verified) {
    log.warn('webhook.mercadopago', 'firma inválida, se descarta la notificación', { storeId })
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  try {
    await confirmMercadoPagoPayment({ storeId, providerPaymentId: String(dataId) })
  } catch (err) {
    if (err instanceof DomainError) {
      log.warn('webhook.mercadopago', 'confirmación descartada por una condición de negocio', {
        storeId,
        reason: err.message,
      })
      return NextResponse.json({ ok: true })
    }

    log.error('webhook.mercadopago', 'no se pudo confirmar el pago, MP debería reintentar', err, { storeId })
    return NextResponse.json({ error: 'Error transitorio, reintentar' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
