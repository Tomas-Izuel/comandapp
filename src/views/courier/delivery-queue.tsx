'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { WifiOff, PackageCheck } from 'lucide-react'
import { EmptyState } from '@/views/shared/states'
import { isConflict } from '@/lib/conflict'
import {
  fetchCourierQueueAction,
  startDeliveryAction,
  completeDeliveryAction,
} from '@/controllers/courier.actions'
import { ActiveOrderCard } from '@/views/courier/active-order-card'
import { QueueRow } from '@/views/courier/queue-row'
import type { CourierOrder } from '@/models/types'

/**
 * Cada cuánto se refresca la cola. Realtime NO le llega a este rol —
 * `orders` no tiene policy de SELECT para un repartidor (todo su acceso pasa
 * por RPC), así que el canal se suscribiría, diría `SUBSCRIBED`, y nunca
 * dispararía nada. Ver el comentario largo del brief de esta superficie.
 * Este polling es la ÚNICA red, no la de contención.
 */
const POLL_MS = 20_000

/** Un cambio de estado en curso, para deshabilitar el botón sin bloquear toda la tarjeta. */
type Pending = number | null

/**
 * La cola del repartidor: un pedido activo a pantalla completa, el resto como
 * memoria compacta. Polling con refetch inmediato al volver a la app —el
 * celular se bloquea en la moto, y sin esto el repartidor mira una pantalla
 * vieja hasta que se cumpla el intervalo completo.
 */
export function DeliveryQueue({ initialOrders }: { initialOrders: CourierOrder[] }) {
  const [orders, setOrders] = React.useState(initialOrders)
  const [offline, setOffline] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<Pending>(null)

  const refetch = React.useCallback(async () => {
    const result = await fetchCourierQueueAction()
    if (result.ok) {
      setOrders(result.data)
      setOffline(false)
    } else {
      // Sin conexión o el servidor no contestó: se mantiene la última cola
      // conocida en pantalla —perderla de golpe sería peor que mostrarla
      // vieja— y se avisa arriba, sin tapar la tarjeta activa.
      setOffline(true)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    async function tick() {
      if (!cancelled && document.visibilityState === 'visible') await refetch()
    }

    const interval = window.setInterval(() => void tick(), POLL_MS)

    // El celular se bloquea en la moto: al volver, se refresca antes de
    // esperar el resto del intervalo, o la pantalla queda vieja justo cuando
    // el repartidor la vuelve a mirar.
    function onVisible() {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetch])

  async function runAction(order: CourierOrder, run: () => Promise<Awaited<ReturnType<typeof startDeliveryAction>>>) {
    setPendingId(order.orderId)
    const result = await run()
    setPendingId(null)

    if (!result.ok) {
      if (isConflict(result)) {
        // El mostrador (u otro poll de este mismo repartidor) movió el pedido
        // primero: no es un error del repartidor, es "se actualizó solo" —
        // mismo criterio que el 409 del KDS.
        toast.error('El pedido cambió', { description: 'Se actualizó solo. Ya está al día.' })
      } else {
        toast.error('No se pudo actualizar', { description: result.error })
      }
      void refetch()
      return
    }

    void refetch()
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        {offline ? <OfflineNotice /> : null}
        <EmptyState
          icon={<PackageCheck className="size-8" strokeWidth={1.5} aria-hidden />}
          title="Sin pedidos por ahora"
          description="En cuanto el local te asigne uno, aparece acá solo. No hace falta que hagas nada."
        />
      </div>
    )
  }

  const [active, ...rest] = orders

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {offline ? <OfflineNotice /> : null}

      <ActiveOrderCard
        order={active}
        pending={pendingId === active.orderId}
        onStart={() => void runAction(active, () => startDeliveryAction(active.orderId))}
        onComplete={(collected) =>
          void runAction(active, () => completeDeliveryAction({ orderId: active.orderId, collected }))
        }
      />

      {rest.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground px-1 text-xs font-semibold tracking-[0.08em] uppercase">Después</p>
          <div className="flex flex-col gap-1.5">
            {rest.map((order) => (
              <QueueRow key={order.orderId} order={order} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OfflineNotice() {
  return (
    <p role="status" className="bg-warning/20 text-warning-foreground flex w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      Sin señal — reintentando cada {POLL_MS / 1000}s. Lo que ves es lo último que llegó.
    </p>
  )
}
