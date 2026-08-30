import 'server-only'

import { formatCentsCompact } from '@/lib/money'
import type { Notifier, NotificationResult, NotificationVars, NotificationTemplate } from './notifier.port'
import { logNotification } from './log'

/**
 * Mensaje en español rioplatense por plantilla. Vive en este archivo (no en
 * el port) porque el adapter `cloud` no manda texto libre: usa una
 * plantilla pre-aprobada por Meta con variables posicionales, no esta
 * función.
 *
 * Las tres plantillas del puerto (`order_confirmed`, `order_ready`,
 * `order_cancelled`) arman texto acá — P-18: antes solo `order_ready` se
 * usaba porque el único `notify()` del repo la mandaba; ahora las tres
 * están listas para que quien confirma o cancela un pedido las dispare.
 *
 * Sobre el 🍔: la regla de CLAUDE.md contra emoji ("nada de emoji como
 * ícono") es sobre superficies de UI que dibujamos — acá no hay ícono que
 * reemplazar, es un mensaje de WhatsApp, y un emoji ahí es la voz coloquial
 * con la que cualquier local le escribe a un cliente. Se mantiene en
 * `order_confirmed`/`order_ready` (buenas noticias) y NO se agrega a
 * `order_cancelled`: un pedido cancelado no es ocasión para un emoji festivo.
 */
function buildMessage(template: NotificationTemplate, vars: NotificationVars): string {
  const { customerName, storeName, shortCode, trackingUrl, etaMinutes, refund, scheduledForLabel } = vars

  switch (template) {
    case 'order_confirmed': {
      // Un programado no tiene minutos que contar, tiene una hora que cumplir:
      // el mensaje cambia de "va a estar listo en X" a "para el {hora pactada}".
      if (scheduledForLabel) {
        return `¡Hola ${customerName}! Confirmamos tu pedido ${shortCode} en ${storeName} para el ${scheduledForLabel} 🍔. Seguilo acá: ${trackingUrl}`
      }
      const eta = etaMinutes ? ` Va a estar listo en unos ${etaMinutes} minutos.` : ''
      return `¡Hola ${customerName}! Confirmamos tu pedido ${shortCode} en ${storeName}, ya lo estamos preparando 🍔.${eta} Seguilo acá: ${trackingUrl}`
    }
    case 'order_ready':
      return `¡Hola ${customerName}! Tu pedido ${shortCode} en ${storeName} ya está listo para retirar 🍔. ${trackingUrl}`
    case 'order_on_the_way':
      // "En camino" es la contraparte de "listo": buena noticia, mismo tono.
      // Nunca se manda junto con `order_ready` para el mismo pedido —la guarda
      // vive en `kitchen.controller.ts`— así que acá no hace falta distinguir.
      return `¡Hola ${customerName}! Tu pedido ${shortCode} en ${storeName} salió, va en camino 🛵. Seguilo acá: ${trackingUrl}`
    case 'order_cancelled': {
      // La plata importa más que el tono acá: si había un pago aprobado, el
      // mensaje tiene que decir qué pasa con él en la misma línea, no dejar
      // que el cliente tenga que preguntar. Sin `refund` no hubo cobro (pago
      // en el local, o el pago online nunca se aprobó), así que no se
      // menciona plata — no hay nada que devolver.
      const refundNote = refund
        ? ` Ya iniciamos la devolución de ${formatCentsCompact(refund.amountCents, refund.currency)}: la vas a ver en tu medio de pago en los próximos días hábiles.`
        : ''
      return `Hola ${customerName}, tu pedido ${shortCode} en ${storeName} fue cancelado.${refundNote} Ante cualquier duda, respondé este mensaje. ${trackingUrl}`
    }
  }
}

/**
 * Adapter "día 1": no envía nada por su cuenta. Arma el mensaje y devuelve
 * un link de wa.me para que el mostrador lo toque a mano — así el producto
 * arranca antes de que Meta apruebe ninguna plantilla de Cloud API.
 */
export const whatsappLinkAdapter: Notifier = {
  kind: 'link',
  async notify({ storeId, orderId, toPhoneE164, template, vars }) {
    const message = buildMessage(template, vars)
    // wa.me quiere el número sin el "+" inicial.
    const numberWithoutPlus = toPhoneE164.replace(/^\+/, '')
    const actionUrl = `https://wa.me/${numberWithoutPlus}?text=${encodeURIComponent(message)}`

    const result: NotificationResult = { status: 'queued', actionUrl }
    await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
    return result
  },
}
