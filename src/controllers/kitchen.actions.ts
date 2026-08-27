'use server'

import { z } from 'zod'
import { toActionResult } from '@/lib/action-result'
import { log } from '@/lib/log'
import { serverEnv } from '@/lib/env.server'
import { requireStoreMembership } from '@/models/store.model'
import { updateOrderStatus, markPaidInStore, getActiveOrders, getOrderWithStoreById } from '@/models/order.model'
import { getNotifier, type NotificationResult } from '@/services/notifications'
import { getEmailSender } from '@/services/notifications/email'
import { orderStatusSchema, type OrderStatus } from '@/models/schemas/order.schema'
import type { ActionResult, Order, Store } from '@/models/types'
import type { EmailVars } from '@/services/notifications/email/email.port'

/**
 * Panel de cocina (KDS) e historial.
 *
 * Cocina y dinero son dos relojes: estas acciones SOLO tocan `status`
 * (cocina) o `payment_status` (dinero) según cuál se les pida, nunca las dos
 * a la vez ni infieren una de la otra.
 */

const positiveId = z.coerce.number().int().positive()

/**
 * `{ storeId, orderId, status }` y nada más.
 *
 * Antes esta acción recibía además `notifyOnReady`: destinatario, tienda,
 * ítems, montos y el link de tracking, tal cual los mandaba el BROWSER, sin
 * pasar por Zod. Un staff logueado podía usar la plataforma como relay
 * arbitrario de WhatsApp/mail — destino, contenido y "tienda" a elección
 * (S-04). Ahora, si el nuevo estado es "listo", las variables de la
 * notificación se arman leyendo el pedido ya persistido con
 * `getOrderWithStoreById`, del lado del servidor.
 */
const updateStatusInputSchema = z.object({
  storeId: positiveId,
  orderId: positiveId,
  status: orderStatusSchema,
})

/**
 * Cambia el estado de cocina. Si el nuevo estado es "listo", dispara el aviso
 * de WhatsApp —el único punto del panel que toca mensajería, y solo en esta
 * transición— y, si el pedido tiene email, el aviso por mail además (no en
 * vez de).
 *
 * La validación de que la transición sea legal (y de que un pedido online
 * impago no pueda confirmarse) vive en `updateOrderStatus` — acá solo se
 * traduce el resultado, nunca se redecide.
 */
export async function updateOrderStatusAction(p: {
  storeId: number
  orderId: number
  status: OrderStatus
}): Promise<ActionResult<{ notification: NotificationResult | null }>> {
  return toActionResult(
    async () => {
      const { storeId, orderId, status } = updateStatusInputSchema.parse(p)
      await requireStoreMembership(storeId)
      await updateOrderStatus(orderId, status)

      if (status !== 'ready') return { notification: null }

      const found = await getOrderWithStoreById(orderId)
      // No debería pasar —el update de arriba ya tocó esta fila—, pero antes
      // de mandar un WhatsApp o un mail a quien sea, mejor no notificar que
      // notificar con datos de otra tienda.
      if (!found || found.order.storeId !== storeId) {
        log.error('kitchen.updateOrderStatus', 'pedido no encontrado tras marcarlo "listo"', undefined, {
          storeId,
          orderId,
        })
        return { notification: null }
      }

      const { order, store } = found
      const site = serverEnv().NEXT_PUBLIC_SITE_URL
      const trackingUrl = `${site}/pedido/${order.publicToken}`

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

      return { notification }
    },
    'kitchen.updateOrderStatus',
    { storeId: p.storeId, orderId: p.orderId },
  )
}

/**
 * El resultado del envío nunca puede cambiar el resultado de la operación: un
 * mail que falla no puede bloquear ni revertir el cambio de estado a
 * "listo", que ya se persistió arriba. El sender ya devuelve
 * 'skipped'/'failed' en vez de tirar; el try/catch es la segunda red.
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

/** Refetch completo para el cliente Realtime: lo llama tanto el push de Supabase como el polling de respaldo. */
export async function fetchActiveOrdersAction(storeId: number): Promise<ActionResult<Order[]>> {
  return toActionResult(
    async () => {
      const store = positiveId.parse(storeId)
      await requireStoreMembership(store)
      return getActiveOrders(store)
    },
    'kitchen.fetchActiveOrders',
    { storeId },
  )
}

/** El mostrador cobró en efectivo/posnet: cierra el ciclo del dinero a mano. */
export async function markPaidInStoreAction(p: { storeId: number; orderId: number }): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const storeId = positiveId.parse(p.storeId)
      const orderId = positiveId.parse(p.orderId)
      await requireStoreMembership(storeId)
      // `payment_status` está revocado para `authenticated`: `markPaidInStore`
      // va con el cliente admin. La membresía ya se verificó arriba — el
      // modelo no la vuelve a chequear.
      await markPaidInStore(storeId, orderId)
    },
    'kitchen.markPaidInStore',
    { storeId: p.storeId, orderId: p.orderId },
  )
}
