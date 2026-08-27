import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env.server'
import { toApiError } from '@/lib/errors'
import { log } from '@/lib/log'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOrdersForReconciliation } from '@/models/order.model'
import { dispatchPaymentSnapshot } from '@/controllers/checkout.controller'
import { getPaymentProvider } from '@/services/payments'

/**
 * Conciliación de pagos (P-05) + expiración de abandonados (P-04).
 *
 * Vercel Cron invoca con GET (`vercel.json`, cada 10 min); `CRON_SECRET` se
 * compara en tiempo constante — un `!==` filtra, por cuánto tarda en
 * responder, en qué byte empezó a diferir el secreto recibido del esperado.
 */

const EXPIRE_PENDING_AFTER_MINUTES = 45
const RECONCILE_OLDER_THAN_MINUTES = 15

function isAuthorized(request: NextRequest): boolean {
  const { CRON_SECRET } = serverEnv()
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`)
  const received = Buffer.from(request.headers.get('authorization') ?? '')
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const summary = { reconciled: 0, expired: 0, failed: 0 }

    // 1) CONCILIAR ANTES DE EXPIRAR, a propósito. Si expirara primero, un
    //    pedido cuyo webhook se perdió pero que SÍ está pago se cancelaría
    //    antes de que llegáramos a enterarnos. `markOrderPaid` lo detecta
    //    igual más tarde (el pago que llega tarde cae en `needs_refund`, la
    //    plata no se pierde) pero le arruina la noche al cliente y al local
    //    por algo que mirar primero evita del todo.
    const provider = getPaymentProvider()
    const stuck = await listOrdersForReconciliation(RECONCILE_OLDER_THAN_MINUTES)

    for (const order of stuck) {
      try {
        const payments = await provider.findPaymentsByExternalReference(order.storeId, order.publicToken)
        const approved = payments.find((payment) => payment.status === 'approved')

        // Sin pago aprobado: sigue esperando, o de verdad lo abandonaron. En
        // los dos casos no hay nada que aplicar acá — el paso 2 lo cancela si
        // corresponde. No es un fallo, así que no suma a ningún contador.
        if (!approved) continue

        // MISMO camino que el webhook, a propósito: si la conciliación tuviera
        // su propia lógica de aplicación, las dos se desincronizarían tarde o
        // temprano, y el bug aparecería justo en el caso raro que este cron
        // existe para cubrir. Un segundo pago aprobado (doble cobro) ya lo
        // resuelve `markOrderPaid` por el índice único de la base → `duplicate`
        // → reembolso automático; no hace falta tratarlo aparte acá, alcanza
        // con aplicar el primero y dejar que los demás caigan por ese camino.
        await dispatchPaymentSnapshot(order.storeId, order.id, approved)
        summary.reconciled += 1
      } catch (err) {
        // Falla transitoria del proveedor (timeout, 5xx, rate limit): NO se
        // cuenta como conciliado. La corrida de dentro de 10 minutos lo vuelve
        // a agarrar — `listOrdersForReconciliation` no distingue "todavía no
        // se intentó" de "se intentó y falló".
        summary.failed += 1
        log.error('cron.reconcile', 'no se pudo reconciliar un pedido', err, {
          storeId: order.storeId,
          orderId: order.id,
        })
      }
    }

    // 2) Recién ahora, pedidos pending realmente abandonados: se cancelan.
    //    Regla de negocio en la base (P-04), el provider no participa acá.
    const admin = createAdminClient()
    const { data: expiredCount, error } = await admin.rpc('expire_pending_orders', {
      p_minutes: EXPIRE_PENDING_AFTER_MINUTES,
    })
    if (error) {
      log.error('cron.reconcile', 'no se pudieron expirar los pedidos abandonados', error)
    } else {
      summary.expired = expiredCount ?? 0
    }

    return NextResponse.json(summary)
  } catch (err) {
    const { body, status } = toApiError(err, 'cron.reconcile')
    return NextResponse.json(body, { status })
  }
}
