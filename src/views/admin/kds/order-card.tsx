'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Banknote, Loader2, MessageCircle, Undo2, X } from 'lucide-react'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { PaymentNotice } from '@/views/shared/order-status'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatTime, minutesSince } from '@/lib/dates'
import { isConflict } from '@/lib/conflict'
import { markPaidInStoreAction } from '@/controllers/kitchen.actions'
import { ALLOWED_TRANSITIONS } from '@/models/schemas/order.schema'
import type { ActionResult, Order, OrderStatus } from '@/models/types'

/**
 * Orden "natural" de la cocina, solo para decidir si una transición legal es
 * un paso ADELANTE o un paso ATRÁS — la legalidad en sí la decide siempre
 * `ALLOWED_TRANSITIONS`, importado de `order.schema.ts`, nunca redeclarado acá.
 */
const KITCHEN_ORDER: readonly OrderStatus[] = ['confirmed', 'preparing', 'ready', 'delivered']

const FORWARD_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: 'Empezar a cocinar',
  ready: 'Marcar listo',
  delivered: 'Entregar',
}

const BACK_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Volver a confirmado',
  preparing: 'Volver a la plancha',
}

/** Lo que le importa a esta tarjeta del resultado de un cambio de estado. */
type StatusChangeResult = ActionResult<{ notification: { actionUrl?: string } | null }>

/**
 * Reloj propio por comanda: cada tarjeta lleva su cuenta de "hace X min" sin
 * depender de un tick central del tablero. Con la cantidad de pedidos activos
 * de un local (decenas, no miles) el costo de N intervalos es irrelevante.
 */
function useElapsedMinutes(iso: string): number {
  const [elapsed, setElapsed] = useState(() => minutesSince(iso))
  useEffect(() => {
    const id = setInterval(() => setElapsed(minutesSince(iso)), 30_000)
    return () => clearInterval(id)
  }, [iso])
  return elapsed
}

export function OrderCard({
  order,
  storeId,
  timezone,
  statusPending,
  onChangeStatus,
  onOrderChanged,
  onRefreshNeeded,
}: {
  order: Order
  storeId: number
  timezone: string
  /** El tablero centraliza el estado optimista: esta tarjeta solo sabe si SU cambio está en vuelo. */
  statusPending: boolean
  onChangeStatus: (order: Order, target: OrderStatus) => Promise<StatusChangeResult>
  onOrderChanged: (updated: Order) => void
  onRefreshNeeded: () => void
}) {
  const [markPaidPending, startMarkPaidTransition] = useTransition()
  const pending = statusPending || markPaidPending
  const [waLink, setWaLink] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const elapsed = useElapsedMinutes(order.confirmedAt ?? order.createdAt)

  const unpaidInStore = order.paymentMethod === 'in_store' && order.paymentStatus !== 'approved'
  const blockedByPayment = order.status === 'ready' && unpaidInStore
  // "Grita" sin depender del color: forma (ícono + franja completa arriba de
  // la tarjeta, no solo un chip), peso (texto más grande y más pesado) y
  // posición (una fila propia, siempre en el mismo lugar en toda tarjeta
  // vencida) además del tono. Un daltónico o una pantalla al sol tienen que
  // poder verlo igual.
  const urgent = order.status !== 'ready' && elapsed >= (order.etaMinutes ?? 15)

  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0)

  const legalTargets = ALLOWED_TRANSITIONS[order.status]
  const forwardTarget = legalTargets.find(
    (t) => t !== 'cancelled' && KITCHEN_ORDER.indexOf(t) > KITCHEN_ORDER.indexOf(order.status),
  )
  const backTarget = legalTargets.find(
    (t) => t !== 'cancelled' && KITCHEN_ORDER.indexOf(t) < KITCHEN_ORDER.indexOf(order.status),
  )
  const canCancel = legalTargets.includes('cancelled')

  /**
   * Un conflicto (409: otro operario cambió el pedido primero) no es un error
   * cualquiera — el tablero tiene que recargar para que quien tocó el botón
   * vea el estado real, no reintentar contra una tarjeta vieja.
   */
  function handleFailure(result: ActionResult<unknown>) {
    if (isConflict(result)) {
      toast.error('El pedido cambió', { description: 'Otro operario lo actualizó primero. Refrescando…' })
      onRefreshNeeded()
      return
    }
    toast.error('No se pudo actualizar el pedido', { description: result.ok ? undefined : result.error })
  }

  function changeStatus(target: OrderStatus) {
    void (async () => {
      const result = await onChangeStatus(order, target)
      if (!result.ok) {
        handleFailure(result)
        return
      }
      if (target === 'cancelled') setCancelOpen(false)
      if (result.data.notification?.actionUrl) setWaLink(result.data.notification.actionUrl)
    })()
  }

  function handleMarkPaid() {
    startMarkPaidTransition(async () => {
      const result = await markPaidInStoreAction({ storeId, orderId: order.id })
      if (!result.ok) {
        handleFailure(result)
        return
      }
      onOrderChanged({ ...order, paymentStatus: 'approved', paymentRef: 'in_store' })
      toast.success('Pedido marcado como pagado')
    })
  }

  return (
    <Panel className={cn('flex flex-col gap-0 overflow-hidden p-0', urgent && 'border-destructive/60')}>
      {urgent ? (
        <div className="bg-destructive/12 text-destructive flex items-center gap-1.5 border-b border-destructive/25 px-4 py-1.5 text-xs font-semibold">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Pasó el tiempo estimado
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <span className="text-xl leading-none font-bold">{order.shortCode || `#${order.id}`}</span>
        {urgent ? (
          <span suppressHydrationWarning className="tabular text-destructive shrink-0 text-sm font-bold">
            hace {elapsed} min
          </span>
        ) : (
          <StatusPill tone="neutral" className="shrink-0">
            <span suppressHydrationWarning className="tabular">
              hace {elapsed} min
            </span>
          </StatusPill>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs">
        <span className="min-w-0 truncate">{order.customerName}</span>
        <span className="tabular shrink-0">
          {itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}
        </span>
        {order.etaAt ? <span className="tabular shrink-0">Listo ~{formatTime(order.etaAt, timezone)}</span> : null}
      </div>

      <ul className="divide-border divide-y px-4 pt-2.5">
        {order.items.map((item) => (
          <li key={item.id} className="py-2 text-sm">
            <p>
              <span className="tabular font-medium">{item.quantity}×</span> {item.nameSnapshot}
            </p>
            {item.options.length > 0 ? (
              <p className="text-muted-foreground mt-0.5 text-xs">{item.options.map((o) => o.nameSnapshot).join(', ')}</p>
            ) : null}
            {item.notes ? <p className="text-muted-foreground mt-0.5 text-xs italic">{item.notes}</p> : null}
          </li>
        ))}
      </ul>

      <div className="border-border flex flex-col gap-2 border-t px-4 py-3.5">
        {order.paymentMethod === 'in_store' && !unpaidInStore ? (
          <StatusPill tone="done" className="self-start">
            Cobrado en el local
          </StatusPill>
        ) : (
          <PaymentNotice paymentStatus={order.paymentStatus} paymentMethod={order.paymentMethod} />
        )}

        {blockedByPayment ? (
          <>
            <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2.5 text-center text-sm font-semibold">
              Cobrá antes de entregar
            </p>
            <Button onClick={handleMarkPaid} disabled={pending} className="h-12 w-full gap-2 text-base">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
              Marcar como cobrado
            </Button>
          </>
        ) : (
          <>
            {waLink ? (
              <a href={waLink} target="_blank" rel="noreferrer" className="block">
                <Button variant="outline" className="h-12 w-full gap-2 text-base">
                  <MessageCircle className="size-4" />
                  Avisar por WhatsApp
                </Button>
              </a>
            ) : null}
            {unpaidInStore ? (
              <Button onClick={handleMarkPaid} disabled={pending} variant="outline" className="h-11 w-full gap-2">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
                Marcar como cobrado
              </Button>
            ) : null}
            {forwardTarget ? (
              <Button onClick={() => changeStatus(forwardTarget)} disabled={pending} className="h-12 w-full text-base">
                {pending ? <Loader2 className="size-4 animate-spin" /> : FORWARD_ACTION_LABEL[forwardTarget]}
              </Button>
            ) : null}
          </>
        )}

        {backTarget || canCancel ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            {backTarget ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => changeStatus(backTarget)}
                disabled={pending}
                className="text-muted-foreground h-11 gap-1.5 px-3"
              >
                <Undo2 className="size-3.5" />
                {BACK_ACTION_LABEL[backTarget]}
              </Button>
            ) : (
              <span />
            )}
            {canCancel ? (
              <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive h-11 gap-1.5 px-3">
                    <X className="size-3.5" />
                    Cancelar pedido
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>¿Cancelar el pedido {order.shortCode || `#${order.id}`}?</DialogTitle>
                    <DialogDescription>
                      Esta acción no se puede deshacer. El cliente va a ver el pedido como cancelado.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={pending}>
                      Volver
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => changeStatus('cancelled')}
                      disabled={pending}
                      className="gap-2"
                    >
                      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Cancelar pedido
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
