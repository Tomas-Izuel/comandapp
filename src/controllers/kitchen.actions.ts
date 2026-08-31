'use server'

import { z } from 'zod'
import { toActionResult } from '@/lib/action-result'
import { requireStoreMembership } from '@/models/store.model'
import { updateOrderStatus, markPaidInStore, getActiveOrders, getPendingTransferOrders } from '@/models/order.model'
import { assignCourier, listCouriersForAssignment } from '@/models/dispatch.model'
import {
  dispatchReadyNotification,
  dispatchOnTheWayNotification,
  dispatchCancelledNotification,
  confirmTransferPayment,
  getTransferReceipt,
} from '@/controllers/kitchen.controller'
import { type NotificationResult } from '@/services/notifications'
import { orderStatusSchema, type OrderStatus } from '@/models/schemas/order.schema'
import { assignCourierSchema } from '@/models/schemas/courier.schema'
import type { ActionResult, CourierOption, Order } from '@/models/types'

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

      // Se pasa `storeId` en los dos casos porque acá viene del browser y hay
      // que verificarlo antes de mandarle un mensaje a nadie. `dispatchReady...`
      // se auto-degrada a `null` para pedidos de delivery: la guarda vive ahí,
      // no acá, porque el cron de auto-listo pasa por el mismo camino.
      if (status === 'ready') {
        const notification = await dispatchReadyNotification(orderId, storeId)
        return { notification }
      }

      if (status === 'on_the_way') {
        const notification = await dispatchOnTheWayNotification(orderId, storeId)
        return { notification }
      }

      // Q7: TODA cancelación avisa, no solo la del KDS botón-a-botón. La
      // cancelación MASIVA (pausa destructiva, cierre de fecha) no pasa por
      // acá — llama `dispatchCancelledNotification` directo, un id a la vez.
      if (status === 'cancelled') {
        const notification = await dispatchCancelledNotification(orderId, storeId)
        return { notification }
      }

      return { notification: null }
    },
    'kitchen.updateOrderStatus',
    { storeId: p.storeId, orderId: p.orderId },
  )
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

/**
 * Asigna (o desasigna, con `courierId: null`) un repartidor a un pedido.
 *
 * `courier_id` no está en el `grant update` de `orders` para `authenticated`
 * —el browser del staff solo escribe `status`—, así que el modelo va con el
 * cliente admin detrás de esta verificación de membresía. La invariante "es
 * repartidor activo de ESTA tienda" la valida el trigger, no esta acción.
 */
export async function assignCourierAction(p: {
  storeId: number
  orderId: number
  courierId: number | null
}): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const input = assignCourierSchema.parse(p)
      await requireStoreMembership(input.storeId)
      await assignCourier(input.storeId, input.orderId, input.courierId)
    },
    'kitchen.assignCourier',
    { storeId: p.storeId, orderId: p.orderId },
  )
}

/**
 * Repartidores de la tienda para poblar el selector de asignación del KDS,
 * con su carga actual. Lo puede pedir cualquier staff, no solo el dueño — ver
 * el comentario de `listCouriersForAssignment` para por qué no usa la RPC
 * `store_couriers`.
 */
export async function fetchStoreCouriersAction(storeId: number): Promise<ActionResult<CourierOption[]>> {
  return toActionResult(
    async () => {
      const store = positiveId.parse(storeId)
      await requireStoreMembership(store)
      return listCouriersForAssignment(store)
    },
    'kitchen.fetchStoreCouriers',
    { storeId },
  )
}

// ---------------------------------------------------------------------------
// Transferencia bancaria — la bandeja de "Transferencias por confirmar" y su
// visor. Las tres acciones piden `requireStoreMembership(storeId)` a secas,
// SIN `{ role: 'owner' }`: el que confirma que la plata entró no es
// necesariamente el dueño, es quien está en el mostrador en ese momento —
// mismo criterio que `markPaidInStoreAction`.
// ---------------------------------------------------------------------------

/**
 * Confirma que la plata de una transferencia entró a la cuenta del local. NO
 * exige que exista comprobante (00-architecture.md §5.9): si el staff resolvió
 * el problema por WhatsApp, confirma igual.
 */
export async function confirmTransferPaymentAction(p: {
  storeId: number
  orderId: number
  reference?: string
}): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const storeId = positiveId.parse(p.storeId)
      const orderId = positiveId.parse(p.orderId)
      const { userId } = await requireStoreMembership(storeId)
      await confirmTransferPayment({ storeId, orderId, reference: p.reference ?? null, userId })
    },
    'kitchen.confirmTransferPayment',
    { storeId: p.storeId, orderId: p.orderId },
  )
}

/**
 * URL firmada (5 minutos) del comprobante, para el visor de la bandeja de
 * transferencias. `null` si el pedido no tiene uno — el botón de confirmar
 * pago tiene que seguir habilitado igual.
 */
export async function transferReceiptUrlAction(p: {
  storeId: number
  orderId: number
}): Promise<ActionResult<{ url: string; mime: string } | null>> {
  return toActionResult(
    async () => {
      const storeId = positiveId.parse(p.storeId)
      const orderId = positiveId.parse(p.orderId)
      await requireStoreMembership(storeId)
      return getTransferReceipt({ storeId, orderId })
    },
    'kitchen.transferReceiptUrl',
    { storeId: p.storeId, orderId: p.orderId },
  )
}

/** La bandeja de "Transferencias por confirmar" del KDS: pedidos `pending` de pago por transferencia. */
export async function fetchPendingTransfersAction(storeId: number): Promise<ActionResult<Order[]>> {
  return toActionResult(
    async () => {
      const store = positiveId.parse(storeId)
      await requireStoreMembership(store)
      return getPendingTransferOrders(store)
    },
    'kitchen.fetchPendingTransfers',
    { storeId },
  )
}
