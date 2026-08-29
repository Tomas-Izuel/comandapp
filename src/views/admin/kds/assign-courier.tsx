'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Bike, Loader2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isConflict } from '@/lib/conflict'
import { assignCourierAction, fetchStoreCouriersAction } from '@/controllers/kitchen.actions'
import type { CourierRow, Order } from '@/models/types'

/** Valor del ítem "sin asignar" en el select: `''` no sirve, Radix lo trata como vacío/no seleccionado. */
const UNASSIGNED = 'none'

/**
 * Cómo se describe la carga de cada repartidor en el selector. Un solo lugar
 * para el criterio: "repartiendo" pesa más que "N pedidos", que pesa más que
 * "libre" — en ese orden es como el encargado decide a quién asignarle el
 * próximo pedido.
 */
function courierLoadLabel(courier: CourierRow): string {
  if (courier.onTheWayOrders > 0) return 'repartiendo'
  if (courier.assignedOrders > 0) return `${courier.assignedOrders} ${courier.assignedOrders === 1 ? 'pedido' : 'pedidos'}`
  return 'libre'
}

/**
 * Selector de repartidor para una comanda de delivery. Vive en el pie de
 * `OrderCard`, montado solo si `order.deliveryMethod === 'delivery'`.
 *
 * Reasignar es legal en `confirmed | preparing | ready`: el encargado asigna
 * cuando ve venir el pedido, no recién cuando suena la campana. En
 * `on_the_way` la comida ya está físicamente con alguien —no se reasigna ni
 * se desasigna hasta volver a `ready`— y en `delivered`/`cancelled` el pedido
 * está cerrado. En esos tres casos este componente no monta nada: el chip de
 * solo lectura de la fila de meta (en `order-card.tsx`) ya muestra a quién
 * quedó asignado.
 */
export function AssignCourier({
  order,
  storeId,
  disabled = false,
  onAssigned,
  onRefreshNeeded,
}: {
  order: Order
  storeId: number
  /** El tablero tiene otro cambio de estado en vuelo para esta tarjeta: no permitir reasignar en simultáneo. */
  disabled?: boolean
  onAssigned: (patch: { courierId: number | null; courierName: string | null }) => void
  /** Mismo camino que un 409 de cambio de estado: refresca en vez de reintentar contra una tarjeta vieja. */
  onRefreshNeeded: () => void
}) {
  const [couriers, setCouriers] = useState<CourierRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [pending, startTransition] = useTransition()

  const editable = order.status === 'confirmed' || order.status === 'preparing' || order.status === 'ready'
  if (!editable) return null

  /**
   * Se piden al ABRIR el control, no en el render del tablero: el tablero ya
   * repinta cada 30s por polling, y traer la lista de repartidores en cada
   * repintado sería una consulta por tienda que nadie pidió ver.
   */
  function loadCouriers() {
    if (couriers !== null || loading) return
    setLoading(true)
    setLoadError(false)
    void fetchStoreCouriersAction(storeId).then((result) => {
      setLoading(false)
      if (!result.ok) {
        setLoadError(true)
        return
      }
      // Un repartidor desactivado DESPUÉS de que se le asignó este pedido se
      // mantiene en la lista igual: si no, el select queda con un valor
      // seleccionado que no matchea ningún ítem y `SelectValue` se ve vacío,
      // aunque el pedido siga asignado de verdad.
      setCouriers(result.data.filter((c) => c.isActive || c.id === order.courierId))
    })
  }

  function handleValueChange(value: string) {
    const courierId = value === UNASSIGNED ? null : Number(value)
    const courierName = courierId != null ? (couriers?.find((c) => c.id === courierId)?.displayName ?? null) : null

    startTransition(async () => {
      const result = await assignCourierAction({ storeId, orderId: order.id, courierId })
      if (!result.ok) {
        if (isConflict(result)) {
          toast.error('El pedido cambió', { description: 'Otro operario lo actualizó primero. Refrescando…' })
          onRefreshNeeded()
          return
        }
        toast.error('No se pudo asignar el repartidor', { description: result.error })
        return
      }
      onAssigned({ courierId, courierName })
      toast.success(courierName ? `Asignado a ${courierName}` : 'Repartidor desasignado')
    })
  }

  return (
    <Select
      value={order.courierId != null ? String(order.courierId) : UNASSIGNED}
      onValueChange={handleValueChange}
      onOpenChange={(open) => {
        if (open) loadCouriers()
      }}
      disabled={disabled || pending}
    >
      <SelectTrigger className="h-11 w-full text-sm" aria-label="Repartidor asignado">
        {pending ? (
          <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Bike className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <SelectValue placeholder="Asignar repartidor" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Sin asignar</SelectItem>
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Cargando repartidores…
          </p>
        ) : loadError ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              loadCouriers()
            }}
            className="text-destructive w-full px-2 py-2 text-left text-sm font-medium"
          >
            No se pudo cargar. Tocá para reintentar.
          </button>
        ) : (
          couriers?.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.displayName} <span className="text-muted-foreground">— {courierLoadLabel(c)}</span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
