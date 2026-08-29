'use server'

import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toActionResult } from '@/lib/action-result'
import { log } from '@/lib/log'
import { dispatchOnTheWayNotification } from '@/controllers/kitchen.controller'
import { advanceAssignedOrder, getCourierQueue } from '@/models/dispatch.model'
import { courierAdvanceSchema } from '@/models/schemas/courier.schema'
import type { ActionResult, CourierOrder } from '@/models/types'

/**
 * Refetch de la cola para el polling de `delivery-queue.tsx`. Mismo patrón que
 * `fetchActiveOrdersAction` del KDS: un Server Action, no una route handler,
 * porque el cliente ya sabe llamar Server Actions y no hay que exponer un
 * endpoint HTTP nuevo para esto.
 *
 * Realtime no le llega a este rol (`orders` no expone SELECT a un repartidor
 * por RLS — todo su acceso es por RPC), así que esto es el ÚNICO camino de
 * refresco: no hay canal de WebSocket de respaldo como en el KDS.
 */
export async function fetchCourierQueueAction(): Promise<ActionResult<CourierOrder[]>> {
  return toActionResult(() => getCourierQueue(), 'courier.fetchQueue')
}

/**
 * El repartidor salió del local con el pedido.
 *
 * Acá se dispara el aviso al cliente, y no es un extra: un pedido de delivery
 * NO recibe el "tu pedido está listo" (`dispatchReadyNotification` lo corta,
 * porque para un envío ese mensaje significa "vení a buscarlo" y es falso).
 * Este es el camino REAL por el que un pedido pasa a `on_the_way` — el del
 * panel existe, pero el que toca el botón es el repartidor. Sin esta llamada,
 * un cliente de delivery no recibe un solo mensaje en todo el pedido.
 *
 * `expectedStoreId` no se pasa: ese parámetro existe para validar un id que
 * vino del browser, y acá la RPC ya verificó que el pedido esté asignado a
 * este repartidor antes de moverlo.
 *
 * Va con `after()` y log-y-seguir: que no salga un WhatsApp no puede hacer que
 * el repartidor vea un error sobre un pedido que ya salió.
 */
export async function startDeliveryAction(orderId: number): Promise<ActionResult> {
  return toActionResult(async () => {
    const parsed = courierAdvanceSchema.parse({ orderId, status: 'on_the_way', collected: false })
    await advanceAssignedOrder(parsed)

    after(async () => {
      try {
        await dispatchOnTheWayNotification(parsed.orderId)
      } catch (err) {
        log.error('courier.startDelivery', 'no se pudo avisar que el pedido salió', err, {
          orderId: parsed.orderId,
        })
      }
    })
  }, 'courier.startDelivery')
}

/**
 * Entregado. `collected` solo se honra si el local activó el cobro en la
 * puerta Y el pedido lo tenía pendiente — si no, la RPC lo ignora (ver
 * `courierAdvanceSchema` y `dispatch.model.ts`), así que acá no hace falta
 * repetir esa condición: se manda tal cual la confirmó la tarjeta.
 */
export async function completeDeliveryAction(input: {
  orderId: number
  collected: boolean
}): Promise<ActionResult> {
  return toActionResult(async () => {
    const parsed = courierAdvanceSchema.parse({
      orderId: input.orderId,
      status: 'delivered',
      collected: input.collected,
    })
    await advanceAssignedOrder(parsed)
  }, 'courier.completeDelivery')
}

export async function courierSignOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}
