import 'server-only'

import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import type { Notifier, NotificationResult } from './notifier.port'
import { logNotification } from './log'

const GRAPH_API_VERSION = 'v21.0'

/**
 * Adapter con la Cloud API de Meta. Solo hay una plantilla configurada
 * (`WHATSAPP_CLOUD_TEMPLATE`, default `pedido_listo`) porque todavía no se
 * aprobaron las otras.
 *
 * P-18: a diferencia del adapter `link` (texto libre), acá NO se puede
 * reusar esa plantilla para `order_confirmed`/`order_cancelled`. Meta aprueba
 * el TEXTO fijo de la plantilla, no lo que mandamos en `parameters` — la
 * plantilla que hoy existe dice literalmente "tu pedido está listo", así que
 * usarla para confirmar o cancelar mandaría al cliente un mensaje que dice
 * otra cosa. No es un bug de parámetros cruzados, es contenido falso. Hasta
 * que existan plantillas propias aprobadas por evento (pendiente: hace falta
 * declarar sus nombres en `src/lib/env.server.ts`, fuera de este slice), este
 * adapter solo entrega `order_ready` de verdad; los otros dos se degradan a
 * `skipped` con un error que dice por qué, en vez de mandar un mensaje falso.
 */
export const whatsappCloudAdapter: Notifier = {
  kind: 'cloud',
  async notify({ storeId, orderId, toPhoneE164, template, vars }) {
    const env = serverEnv()

    if (!env.WHATSAPP_CLOUD_PHONE_ID || !env.WHATSAPP_CLOUD_TOKEN) {
      // Que no salga un WhatsApp no puede romper un pedido ya pago: se
      // degrada a 'skipped' con un error accionable, nunca se lanza.
      const result: NotificationResult = {
        status: 'skipped',
        error: 'Faltan WHATSAPP_CLOUD_PHONE_ID / WHATSAPP_CLOUD_TOKEN: no se puede notificar por Cloud API.',
      }
      await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
      return result
    }

    if (template !== 'order_ready') {
      const result: NotificationResult = {
        status: 'skipped',
        error: `No hay plantilla de Meta aprobada para "${template}": Cloud API solo tiene configurada la de "pedido listo" (ver comentario de este archivo).`,
      }
      await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
      return result
    }

    const toDigits = toPhoneE164.replace(/^\+/, '')

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_CLOUD_PHONE_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_CLOUD_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toDigits,
            type: 'template',
            template: {
              name: env.WHATSAPP_CLOUD_TEMPLATE,
              language: { code: 'es_AR' },
              components: [
                {
                  type: 'body',
                  // El orden tiene que calzar EXACTO con las variables
                  // {{1}} {{2}} {{3}} que Meta aprobó para esta plantilla.
                  // Reordenar acá sin reordenar en Meta Business Manager
                  // manda el mensaje con las variables cruzadas, sin error.
                  parameters: [
                    { type: 'text', text: vars.customerName },
                    { type: 'text', text: vars.shortCode },
                    { type: 'text', text: vars.storeName },
                  ],
                },
              ],
            },
          }),
        },
      )

      // Nunca se loguea el body completo: puede traer datos del cliente.
      const body = (await response.json().catch(() => null)) as { error?: { message?: string }; messages?: { id: string }[] } | null

      if (!response.ok) {
        const errorMessage = `Meta devolvió ${response.status}: ${body?.error?.message ?? 'sin detalle'}`
        const result: NotificationResult = { status: 'failed', error: errorMessage }
        log.error('notifications.whatsapp.cloud', 'la Cloud API de WhatsApp rechazó el envío', undefined, {
          storeId,
          orderId,
          status: response.status,
        })
        await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
        return result
      }

      const result: NotificationResult = { status: 'sent', providerRef: body?.messages?.[0]?.id }
      await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
      return result
    } catch (err) {
      log.error('notifications.whatsapp.cloud', 'fallo de red llamando a la Cloud API de WhatsApp', err, {
        storeId,
        orderId,
      })
      const result: NotificationResult = {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Error desconocido llamando a la Cloud API de WhatsApp.',
      }
      await logNotification({ channel: 'whatsapp', storeId, orderId, toAddress: toPhoneE164, template, result })
      return result
    }
  },
}
