'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bike, CalendarClock, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { PanelHeading } from '@/views/admin/page-frame'
import {
  CancelScheduledOrdersDialog,
  type AffectedOrders,
} from '@/views/admin/shared/cancel-scheduled-orders-dialog'
import { PAYMENT_TEXT_TONE } from '@/views/admin/pedidos/history-list'
import { updateOrderStatusAction } from '@/controllers/kitchen.actions'
import { isConflict } from '@/lib/conflict'
import { formatTime, todayInZone, zonedDay, zonedDayStart } from '@/lib/dates'
import { PAYMENT_STATUS_LABELS } from '@/models/schemas/order.schema'
import type { Order } from '@/models/types'

/**
 * Encabezado de grupo proyectado hacia ADELANTE — el espejo de
 * `formatDayHeading` de `history-list.tsx`, que mira hacia atrás ("Ayer").
 * Acá el horizonte es de 3 días (`SCHEDULE_HORIZON_DAYS`), así que nunca hay
 * más de 3-4 grupos y no hace falta el año ni fechas largas.
 */
function formatUpcomingDayHeading(day: string, timezone: string, today: string, tomorrow: string): string {
  if (day === today) return 'Hoy'
  if (day === tomorrow) return 'Mañana'
  const instant = zonedDayStart(day, timezone)
  const label = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(
    instant,
  )
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function affectedFor(order: Order): AffectedOrders {
  const paid = order.paymentStatus === 'approved'
  return { count: 1, paidCount: paid ? 1 : 0, paidTotalCents: paid ? order.totalCents : 0 }
}

/**
 * Bandeja de pedidos programados en `/admin/pedidos`. Vive ARRIBA del
 * historial de siempre (`OrderHistoryList`, que no cambia una línea) porque
 * responde una pregunta distinta: "¿qué tengo para las próximas noches?", no
 * "¿qué pasó hoy?".
 *
 * Agrupada y ordenada por `scheduledFor` — nunca por `createdAt`: un pedido
 * programado para dentro de 3 días se creó HOY, y el historial de abajo lo
 * acota por creación. Mezclarlos sería mostrar el dato equivocado con la
 * etiqueta correcta. `orders` llega ya ordenado por `scheduledFor` desde
 * `getScheduledOrders` (T2); acá solo se agrupa por día, sin reordenar.
 */
export function ScheduledOrdersTray({
  storeId,
  orders,
  timezone,
  currency,
}: {
  storeId: number
  orders: Order[]
  timezone: string
  currency: string
}) {
  const router = useRouter()
  const [items, setItems] = useState(orders)
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const wasConflictRef = useRef(false)

  const today = todayInZone(timezone)
  const tomorrow = zonedDay(new Date(zonedDayStart(today, timezone).getTime() + 24 * 60 * 60 * 1000), timezone)

  const groups = useMemo(() => {
    const result: { day: string; orders: Order[] }[] = []
    for (const order of items) {
      if (!order.scheduledFor) continue // no debería pasar (getScheduledOrders ya filtra), pero no reventamos la pantalla si pasa
      const day = zonedDay(order.scheduledFor, timezone)
      const current = result[result.length - 1]
      if (current && current.day === day) current.orders.push(order)
      else result.push({ day, orders: [order] })
    }
    return result
  }, [items, timezone])

  function handleCancelled(orderId: number, message = 'Pedido cancelado') {
    setItems((prev) => prev.filter((o) => o.id !== orderId))
    toast.success(message)
    router.refresh()
  }

  return (
    <section className="flex flex-col gap-3">
      <PanelHeading title="Programados" description="Lo que todavía no entró a cocina, ordenado por hora pactada." />

      {groups.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-8" />}
          title="No hay pedidos programados"
          description="Los pedidos para retirar o entregar más tarde van a aparecer acá, agrupados por día."
          className="bg-muted/40 rounded-lg py-10"
        />
      ) : (
        <div className="border-border divide-border flex flex-col divide-y overflow-hidden rounded-lg border">
          {groups.map((group) => (
            <Fragment key={group.day}>
              <div className="bg-muted/40 px-3 py-1.5 lg:px-4">
                <p className="text-foreground text-xs font-semibold">
                  {formatUpcomingDayHeading(group.day, timezone, today, tomorrow)}
                </p>
              </div>
              {group.orders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3 py-2.5 lg:px-4 lg:py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground font-semibold">{order.shortCode || `#${order.id}`}</span>
                      {order.deliveryMethod === 'delivery' ? (
                        <Bike className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      ) : null}
                      <span className="text-foreground truncate text-sm font-medium">{order.customerName}</span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Pactado{' '}
                      <span className="tabular text-foreground font-medium">
                        {order.scheduledFor ? formatTime(order.scheduledFor, timezone) : '—'}
                      </span>
                      {/* La hora de entrada a cocina es dato operativo, para el
                          encargado — nunca para el cliente. Tipografía atenuada
                          y a propósito distinta de la hora pactada. */}
                      {' · entra a cocina '}
                      <span className="tabular">{order.fireAt ? formatTime(order.fireAt, timezone) : '—'}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${PAYMENT_TEXT_TONE[order.paymentStatus]}`}>
                      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                      {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                    </span>
                    <span className="tabular text-sm font-medium">
                      <Price cents={order.totalCents} currency={currency} />
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Cancelar el pedido de ${order.customerName}`}
                      disabled={pendingId === order.id}
                      onClick={() => setCancelTarget(order)}
                    >
                      {pendingId === order.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <X className="text-destructive size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}

      <CancelScheduledOrdersDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        loading={false}
        affected={cancelTarget ? affectedFor(cancelTarget) : null}
        currency={currency}
        subject={
          cancelTarget && cancelTarget.scheduledFor
            ? `para ${cancelTarget.customerName}, el ${formatUpcomingDayHeading(
                zonedDay(cancelTarget.scheduledFor, timezone),
                timezone,
                today,
                tomorrow,
              ).toLowerCase()} a las ${formatTime(cancelTarget.scheduledFor, timezone)}`
            : ''
        }
        destructiveLabel="Cancelar pedido"
        onConfirm={async () => {
          if (!cancelTarget) return { ok: false, error: 'No hay ningún pedido seleccionado' }
          setPendingId(cancelTarget.id)
          const result = await updateOrderStatusAction({ storeId, orderId: cancelTarget.id, status: 'cancelled' })
          setPendingId(null)
          if (!result.ok) {
            // Un 409 no es un error del usuario: otro operario ya movió este
            // pedido primero. Mismo criterio que el tablero de cocina
            // (`order-card.tsx`): se trata como resuelto, no como fallo — el
            // dato que teníamos en pantalla quedó viejo, no hay nada para
            // reintentar.
            if (isConflict(result)) {
              wasConflictRef.current = true
              return { ok: true }
            }
            return { ok: false, error: result.error }
          }
          wasConflictRef.current = false
          return { ok: true }
        }}
        onConfirmed={() => {
          if (cancelTarget) {
            handleCancelled(
              cancelTarget.id,
              wasConflictRef.current ? 'Otro operario ya lo actualizó primero. Refrescando…' : 'Pedido cancelado',
            )
          }
          setCancelTarget(null)
        }}
      />
    </section>
  )
}
