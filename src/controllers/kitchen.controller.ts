import 'server-only'

import { log } from '@/lib/log'
import { storeUrl } from '@/lib/urls'
import { getOrderWithStoreById } from '@/models/order.model'
import { getNotifier, type NotificationResult } from '@/services/notifications'
import { getEmailSender } from '@/services/notifications/email'
import type { Order, Store } from '@/models/types'
import type { EmailVars } from '@/services/notifications/email/email.port'

/**
 * El aviso de "tu pedido está listo", en UN solo lugar.
 *
 * Hay dos caminos que llevan un pedido a `ready`: el botón del panel
 * (`updateOrderStatusAction`) y el barrido de auto-listo
 * (`/api/cron/auto-advance`). El evento de outbox para el POS sí sale solo,
 * por el trigger `private.log_order_status_change` — pero el WhatsApp y el
 * mail al CLIENTE no los manda ningún trigger, los manda esto.
 *
 * Vive acá y no en `kitchen.actions.ts` por dos razones: un `.actions.ts` solo
 * puede exportar funciones async marcadas como Server Actions, y —la que
 * importa— si el cron tuviera su propia copia de este envío, las dos se
 * desincronizarían tarde o temprano y el bug aparecería justo en el caso raro.
 * Mismo criterio que `dispatchPaymentSnapshot` con el webhook y la
 * conciliación.
 */
export async function dispatchReadyNotification(
  orderId: number,
  /**
   * Solo lo pasa el camino del panel, donde el `storeId` viene del browser y
   * hay que verificar que el pedido sea de ESA tienda antes de mandarle un
   * mensaje a nadie. El barrido no lo pasa porque sus IDs salieron de la base
   * en la misma transacción: no hay nada contra qué verificarlos.
   */
  expectedStoreId?: number,
): Promise<NotificationResult | null> {
  const found = await getOrderWithStoreById(orderId)

  if (!found || (expectedStoreId !== undefined && found.order.storeId !== expectedStoreId)) {
    log.error('kitchen.dispatchReadyNotification', 'pedido no encontrado tras marcarlo "listo"', undefined, {
      orderId,
      expectedStoreId,
    })
    return null
  }

  const { order, store } = found

  // Un pedido de DELIVERY que pasa a "listo" no le puede avisar nada al
  // cliente: "tu pedido está listo" significa "vení a buscarlo", y acá el
  // cliente saldría para el local mientras la moto sale para su casa. El
  // aviso correcto para delivery es `dispatchOnTheWayNotification`, disparado
  // en la transición a `on_the_way`. La guarda va acá y no en cada caller
  // porque los dos caminos a `ready` (el botón del KDS y el cron de
  // auto-listo) pasan por esta función.
  if (order.deliveryMethod === 'delivery') return null

  // Al SUBDOMINIO de la tienda de ESTE pedido, nunca al apex (§2.2).
  const trackingUrl = storeUrl(store.slug, `/pedido/${order.publicToken}`)

  const notification = await getNotifier().notify({
    storeId: order.storeId,
    orderId: order.id,
    toPhoneE164: order.customerPhoneE164,
    template: 'order_ready',
    vars: {
      customerName: order.customerName,
      storeName: store.name,
      shortCode: order.shortCode,
      trackingUrl,
      etaMinutes: order.etaMinutes ?? undefined,
    },
  })

  await sendReadyEmail(order, store, trackingUrl)

  return notification
}

/**
 * El aviso de "salió tu pedido", simétrico a `dispatchReadyNotification`.
 *
 * No hace falta la guarda inversa (retiro → no avisar): el trigger
 * `private.enforce_order_rules` ya rechaza que un pedido de retiro llegue a
 * `on_the_way` (exige `delivery_method = 'delivery'` y `courier_id` asignado),
 * así que `updateOrderStatus` tira antes de que esta función se llegue a
 * invocar para un retiro.
 *
 * Solo WhatsApp. `EmailTemplate` NO gana un caso nuevo a propósito: un mail
 * que dice "Martín está en camino" llega después de que golpearon la puerta,
 * cuando ya no sirve de nada.
 */
export async function dispatchOnTheWayNotification(
  orderId: number,
  /** Mismo motivo que en `dispatchReadyNotification`: solo lo pasa el camino del panel. */
  expectedStoreId?: number,
): Promise<NotificationResult | null> {
  const found = await getOrderWithStoreById(orderId)

  if (!found || (expectedStoreId !== undefined && found.order.storeId !== expectedStoreId)) {
    log.error('kitchen.dispatchOnTheWayNotification', 'pedido no encontrado tras marcarlo "en camino"', undefined, {
      orderId,
      expectedStoreId,
    })
    return null
  }

  const { order, store } = found
  const trackingUrl = storeUrl(store.slug, `/pedido/${order.publicToken}`)

  return getNotifier().notify({
    storeId: order.storeId,
    orderId: order.id,
    toPhoneE164: order.customerPhoneE164,
    template: 'order_on_the_way',
    vars: {
      customerName: order.customerName,
      storeName: store.name,
      shortCode: order.shortCode,
      trackingUrl,
      etaMinutes: order.etaMinutes ?? undefined,
    },
  })
}

/**
 * El resultado del envío nunca puede cambiar el resultado de la operación: un
 * mail que falla no puede bloquear ni revertir el cambio de estado a "listo",
 * que ya se persistió. El sender ya devuelve 'skipped'/'failed' en vez de
 * tirar; el try/catch es la segunda red.
 */
async function sendReadyEmail(order: Order, store: Store, trackingUrl: string): Promise<void> {
  if (!order.customerEmail) return

  const vars: EmailVars = {
    customerName: order.customerName,
    storeName: store.name,
    storeSlug: store.slug,
    storeAddress: store.address,
    shortCode: order.shortCode,
    trackingUrl,
    etaMinutes: order.etaMinutes ?? undefined,
    paymentMethod: order.paymentMethod,
    paymentPending: order.paymentStatus !== 'approved',
    currency: order.currency,
    items: order.items.map((item) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
      totalCents: item.totalCents,
      options: item.options.length > 0 ? item.options.map((o) => o.nameSnapshot) : undefined,
    })),
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
  }

  try {
    await getEmailSender().send({
      storeId: order.storeId,
      orderId: order.id,
      to: order.customerEmail,
      template: 'order_ready',
      vars,
    })
  } catch (err) {
    log.error('kitchen.sendReadyEmail', 'no se pudo mandar el aviso de "listo" por mail', err, { orderId: order.id })
  }
}
