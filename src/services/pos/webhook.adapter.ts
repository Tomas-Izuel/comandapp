import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto/secrets'
import { log } from '@/lib/log'
import { signHmacSha256 } from '@/services/crypto/hmac'
import type { PosAdapter, PosEvent } from './pos.port'

const DELIVERY_TIMEOUT_MS = 10_000
const CLAIM_LIMIT = 50
/** Después de esta cantidad de intentos, `settle_event_delivery` marca `dead_at`. */
const MAX_ATTEMPTS = 8
/** Cuánto queda "reservado" un destino mientras se está entregando, antes de que otra corrida pueda reclamarlo de nuevo. */
const LOCK_SECONDS = 120

/**
 * POST JSON firmado con HMAC-SHA256 al endpoint que configuró el local.
 * Genérico a propósito: no sabe nada del software del otro lado, solo firma
 * y entrega.
 *
 * Formato de la firma — es un contrato con quien implemente el otro lado,
 * documentado acá porque es lo único que va a leer:
 *
 *   x-burger-timestamp: segundos unix como string, ej. "1735689600" — la
 *     fecha del INTENTO DE ENTREGA (cuándo se firmó este request), no la del
 *     evento. Existe solo para la ventana anti-replay.
 *   x-burger-signature: sha256=<hex>
 *   x-burger-delivery-id: el `id` de `order_event_deliveries` — identifica
 *     este DESTINO (este endpoint, para este evento), estable entre
 *     reintentos, distinto para cada endpoint suscripto al mismo evento
 *
 *   firma = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 *   rawBody: { id, type, orderId, storeId, payload, createdAt }, donde
 *     `createdAt` es la fecha del HECHO de negocio (`order_events.created_at`
 *     — cuándo pasó lo que el evento describe, ej. cuándo el pedido quedó
 *     `ready`), no la del intento de entrega. Un endpoint caído media hora
 *     no puede correr esa fecha: por eso va en el body firmado, contenido
 *     del hecho, y no en un header junto al timestamp de entrega.
 *
 * El receptor reconstruye el mismo string —timestamp, un punto, el body
 * crudo tal cual llegó, sin re-serializar— y compara en tiempo constante.
 * Tiene que rechazar si `|now - timestamp| > 300s`: sin ventana, una firma
 * capturada una vez sirve para reproducir el evento contra el POS
 * indefinidamente (antes la firma era solo del body, sin timestamp).
 */
export const webhookAdapter: PosAdapter = {
  kind: 'webhook',
  async deliver(endpoint, event, deliveryId) {
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      orderId: event.orderId,
      storeId: event.storeId,
      payload: event.payload,
      createdAt: event.createdAt,
    })
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signHmacSha256(`${timestamp}.${body}`, endpoint.secret)

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-burger-signature': `sha256=${signature}`,
          'x-burger-timestamp': timestamp,
          'x-burger-event': event.type,
          'x-burger-delivery-id': deliveryId,
        },
        body,
        // Un endpoint lento (o caído) no puede colgar el cron del outbox:
        // se corta a los 10s pase lo que pase.
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })

      if (!response.ok) {
        return { ok: false, error: `El POS "${endpoint.id}" respondió ${response.status}` }
      }

      return { ok: true, externalRef: deliveryId }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Error desconocido entregando el evento al POS'
      return { ok: false, error }
    }
  },
}

/**
 * Descifra el secreto del endpoint antes de entregar. Envuelto en try/catch
 * porque un secreto corrupto o una `CREDENTIALS_ENCRYPTION_KEY` faltante no
 * puede tirar abajo el `Promise.all` de toda la tienda: se registra como una
 * entrega fallida más, como cualquier otro error de red.
 */
async function safeDeliver(
  endpoint: { id: number; url: string; secret: string },
  event: PosEvent,
  deliveryId: string,
): Promise<{ ok: boolean; externalRef?: string; error?: string }> {
  let secret: string
  try {
    secret = decryptSecret(endpoint.secret) ?? endpoint.secret
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo descifrar el secreto del POS'
    return { ok: false, error: message }
  }
  return webhookAdapter.deliver({ id: endpoint.id, url: endpoint.url, secret }, event, deliveryId)
}

/**
 * Cron del outbox: entrega los `order_events` no despachados a los
 * `pos_endpoints` activos de su tienda que escuchan ese tipo de evento.
 *
 * `claim_event_deliveries` hace tres cosas en una sola llamada, así que acá
 * no hace falta ni el fan-out por endpoint ni leer `pos_endpoints`:
 *   1. Crea las filas de `order_event_deliveries` que falten para los
 *      endpoints activos suscriptos al tipo de cada evento (perezoso: un
 *      endpoint dado de alta después igual recibe lo pendiente).
 *   2. Cierra (`order_events.delivered_at`) los eventos a los que ningún
 *      endpoint está suscripto, para que no ensucien la cola para siempre.
 *      Los tipos nuevos (`order.cancelled`, `order.payment_status_changed`,
 *      `order.refund_pending`) no están en el `events` por default de los
 *      endpoints existentes, así que hoy se auto-cierran para ellos — es
 *      correcto (un endpoint recibe lo que declara), no un bug.
 *   3. Hace el claim atómico de destinos con `for update skip locked` y ya
 *      aplica el backoff exponencial desde `last_attempt_at` (30s → techo
 *      30min): lo que devuelve ya es entregable, no hay que refiltrar acá.
 *
 * `settle_event_delivery` cierra un destino puntual; cuando a un evento no
 * le queda ningún destino pendiente, marca `order_events.delivered_at` sola.
 */
export async function dispatchPendingEvents(): Promise<{
  claimed: number
  delivered: number
  failed: number
  dead: number
}> {
  const admin = createAdminClient()

  const { data: deliveries, error } = await admin.rpc('claim_event_deliveries', {
    p_limit: CLAIM_LIMIT,
    p_max_attempts: MAX_ATTEMPTS,
    p_lock_seconds: LOCK_SECONDS,
  })

  if (error) {
    throw new Error(`No se pudieron reclamar destinos pendientes del outbox: ${error.message}`)
  }
  if (!deliveries || deliveries.length === 0) {
    return { claimed: 0, delivered: 0, failed: 0, dead: 0 }
  }

  const byStore = new Map<number, typeof deliveries>()
  for (const row of deliveries) {
    const list = byStore.get(row.store_id) ?? []
    list.push(row)
    byStore.set(row.store_id, list)
  }

  let delivered = 0
  let failed = 0
  let dead = 0

  // Por tienda en paralelo: un POS lento (o caído) de un local no puede
  // demorar la entrega de los demás. `allSettled` porque una excepción
  // inesperada en una tienda no puede tirar abajo el despacho de las otras.
  // Dentro de cada tienda, los destinos también se despachan en paralelo.
  const perStore = await Promise.allSettled(
    [...byStore.entries()].map(async ([storeId, storeDeliveries]) => {
      await Promise.all(
        storeDeliveries.map(async (row) => {
          const posEvent: PosEvent = {
            id: row.event_id,
            type: row.event_type,
            orderId: row.order_id,
            storeId: row.store_id,
            payload: (row.payload ?? {}) as Record<string, unknown>,
            createdAt: row.event_created_at,
          }
          const deliveryId = String(row.delivery_id)

          const result = await safeDeliver(
            { id: row.endpoint_id, url: row.endpoint_url, secret: row.endpoint_secret },
            posEvent,
            deliveryId,
          )

          if (result.ok) {
            const { error: settleError } = await admin.rpc('settle_event_delivery', {
              p_delivery_id: row.delivery_id,
              p_delivered: true,
            })
            if (settleError) {
              log.error('pos.outbox', 'No se pudo cerrar un destino entregado', settleError, {
                storeId,
                orderId: row.order_id,
                endpointId: row.endpoint_id,
              })
            }
            delivered++
            return
          }

          const { error: settleError } = await admin.rpc('settle_event_delivery', {
            p_delivery_id: row.delivery_id,
            p_delivered: false,
            p_error: result.error,
            p_max_attempts: MAX_ATTEMPTS,
          })
          if (settleError) {
            log.error('pos.outbox', 'No se pudo cerrar un destino fallido', settleError, {
              storeId,
              orderId: row.order_id,
              endpointId: row.endpoint_id,
            })
          }
          failed++

          // `settle_event_delivery` marca `dead_at` cuando este intento
          // agota el cupo; se replica la misma condición acá (mismo
          // p_max_attempts que se le pasó arriba) para poder contar y
          // alertar sin releer la fila.
          if (row.attempts + 1 >= MAX_ATTEMPTS) {
            dead++
            log.error('pos.outbox', 'Un destino del outbox agotó los reintentos y quedó muerto', undefined, {
              storeId,
              orderId: row.order_id,
              endpointId: row.endpoint_id,
            })
          }
        }),
      )
    }),
  )

  for (const result of perStore) {
    if (result.status === 'rejected') {
      log.error('pos.outbox', 'Falló el despacho completo de una tienda', result.reason)
    }
  }

  return { claimed: deliveries.length, delivered, failed, dead }
}
