'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useDraggable } from '@dnd-kit/core'
import { AlertTriangle, Banknote, Bike, Bot, Landmark, Loader2, Undo2, X } from 'lucide-react'
import { WhatsApp } from '@/components/ui/whatsapp'
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
import { AssignCourier } from './assign-courier'

/**
 * Orden "natural" de la cocina, solo para decidir si una transición legal es
 * un paso ADELANTE o un paso ATRÁS — la legalidad en sí la decide siempre
 * `ALLOWED_TRANSITIONS`, importado de `order.schema.ts`, nunca redeclarado acá.
 *
 * `on_the_way` entra ACÁ entre `ready` y `delivered`, pero eso NO alcanza para
 * que `ready` calcule bien su botón de avance: `ready` es la única fila de
 * `ALLOWED_TRANSITIONS` con DOS objetivos "adelante" (`delivered` y
 * `on_the_way`), y cuál corresponde depende de si el pedido es delivery y si
 * ya tiene repartidor — algo que este array no sabe. Por eso `forwardTarget`
 * más abajo trata `ready` como caso especial y no delega en este orden para
 * ese estado puntual.
 */
const KITCHEN_ORDER: readonly OrderStatus[] = ['confirmed', 'preparing', 'ready', 'on_the_way', 'delivered']

const FORWARD_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: 'Empezar a cocinar',
  ready: 'Marcar listo',
  on_the_way: 'Salió a repartir',
  delivered: 'Entregar',
}

const BACK_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Volver a confirmado',
  preparing: 'Volver a la plancha',
  ready: 'Volver a listo',
}

/** Lo que le importa a esta tarjeta del resultado de un cambio de estado. */
type StatusChangeResult = ActionResult<{ notification: { actionUrl?: string } | null }>

/**
 * Reloj propio por comanda: cada tarjeta lleva su cuenta de "hace X min" sin
 * depender de un tick central del tablero. Con la cantidad de pedidos activos
 * de un local (decenas, no miles) el costo de N intervalos es irrelevante.
 */
/** Exportado: `transfer-tray.tsx` lo reusa para "hace X min" en sus filas. Mismo reloj, mismo criterio de costo. */
export function useElapsedMinutes(iso: string): number {
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
  dragEnabled = false,
  movedBySystem = false,
  justReturned = false,
}: {
  order: Order
  storeId: number
  timezone: string
  /** El tablero centraliza el estado optimista: esta tarjeta solo sabe si SU cambio está en vuelo. */
  statusPending: boolean
  onChangeStatus: (order: Order, target: OrderStatus) => Promise<StatusChangeResult>
  onOrderChanged: (updated: Order) => void
  onRefreshNeeded: () => void
  /** Solo `≥lg`: el tablero decide (media query) si el arrastre está habilitado. */
  dragEnabled?: boolean
  /** La movió una automatización de la tienda (`auto_start_orders`/`auto_ready_orders`), no un operario. */
  movedBySystem?: boolean
  /** El servidor rechazó el último drop: la tarjeta vuelve a su columna animada, no de un salto. */
  justReturned?: boolean
}) {
  const [markPaidPending, startMarkPaidTransition] = useTransition()
  const pending = statusPending || markPaidPending
  const [waLink, setWaLink] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const elapsed = useElapsedMinutes(order.confirmedAt ?? order.createdAt)

  /**
   * `disabled` en vez de no montar el hook: las reglas de hooks piden llamarlo
   * siempre, y alternar `disabled` es la forma que ofrece dnd-kit de prender y
   * apagar el arrastre según el breakpoint sin desmontar la tarjeta.
   */
  // Sin `attributes`: dnd-kit los usa para anunciar `role="button" tabIndex={0}`
  // pensado para el arrastre por TECLADO. Acá el camino de teclado son los
  // botones de abajo (solo `PointerSensor` está configurado en el tablero), así
  // que sumar esos atributos dejaría un foco fantasma que Enter/Space no hacen
  // nada — peor que no ofrecer el atajo.
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: order.id,
    data: { status: order.status },
    disabled: !dragEnabled || pending,
  })

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
  // `ready` es la única fila con dos objetivos "adelante" (`delivered` y
  // `on_the_way`) y el `.find()` genérico no sabe cuál corresponde: un pedido
  // de RETIRO nunca puede salir a repartir, y uno de DELIVERY sin repartidor
  // asignado tampoco (el trigger de Postgres lo rechaza con 500 si se lo
  // dejamos ofrecer). Por eso este único estado se calcula aparte; todo el
  // resto sigue el orden genérico de `KITCHEN_ORDER`.
  const forwardTarget: OrderStatus | undefined =
    order.status === 'ready' && order.deliveryMethod === 'delivery'
      ? order.courierId != null
        ? 'on_the_way'
        : undefined
      : legalTargets.find(
          (t) => t !== 'cancelled' && KITCHEN_ORDER.indexOf(t) > KITCHEN_ORDER.indexOf(order.status),
        )
  const backTarget = legalTargets.find(
    (t) => t !== 'cancelled' && KITCHEN_ORDER.indexOf(t) < KITCHEN_ORDER.indexOf(order.status),
  )
  const canCancel = legalTargets.includes('cancelled')
  /** El pedido que más importa de todo el tablero: listo, es delivery, y nadie lo va a llevar. */
  const needsCourier = order.status === 'ready' && order.deliveryMethod === 'delivery' && order.courierId == null

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
    <Panel
      ref={setNodeRef}
      style={dragEnabled ? { touchAction: 'none' } : undefined}
      {...(dragEnabled ? listeners : null)}
      className={cn(
        'flex flex-col gap-0 overflow-hidden p-0 transition-opacity duration-(--dur-fast)',
        urgent && 'border-destructive/60',
        isDragging && 'opacity-40',
        justReturned && 'animate-in fade-in-0 zoom-in-95 duration-(--dur-base)',
        dragEnabled && 'lg:cursor-grab lg:active:cursor-grabbing',
      )}
    >
      {urgent ? (
        <div className="bg-destructive/12 text-destructive flex items-center gap-1.5 border-b border-destructive/25 px-4 py-1.5 text-xs font-semibold lg:text-sm">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Pasó el tiempo estimado
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <span className="text-xl leading-none font-bold lg:text-2xl">{order.shortCode || `#${order.id}`}</span>
        {urgent ? (
          <span suppressHydrationWarning className="tabular text-destructive shrink-0 text-sm font-bold lg:text-base">
            hace {elapsed} min
          </span>
        ) : (
          <StatusPill tone="neutral" className="shrink-0">
            <span suppressHydrationWarning className="tabular lg:text-sm">
              hace {elapsed} min
            </span>
          </StatusPill>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2 text-xs">
        <span className="min-w-0 truncate">{order.customerName}</span>
        <span className="tabular shrink-0">
          {itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}
        </span>
        {order.etaAt ? <span className="tabular shrink-0">Listo ~{formatTime(order.etaAt, timezone)}</span> : null}
        {movedBySystem ? (
          <span className="border-border bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 font-medium">
            <Bot className="size-3" aria-hidden />
            Lo movió el sistema
          </span>
        ) : null}
        {order.deliveryMethod === 'delivery' && order.courierName ? (
          <span className="border-border bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 font-medium">
            <Bike className="size-3" aria-hidden />
            {order.courierName}
          </span>
        ) : null}
        {/*
          Un pedido por transferencia que llegó acá ya está `confirmed` y
          `approved` — el trigger no deja llegar uno impago (T4/00-architecture
          §5.5). Este chip no avisa un problema de pago: avisa de qué medio
          vino la plata, porque en el mostrador importa saber que NO hay que
          buscar efectivo ni tarjeta en la caja para este pedido.
        */}
        {order.paymentMethod === 'transfer' ? (
          <span className="border-border bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 font-medium">
            <Landmark className="size-3" aria-hidden />
            Transferencia
          </span>
        ) : null}
      </div>

      {/*
        Delivery vs. retiro se distingue de un vistazo por la PRESENCIA de este
        bloque, no por un color: un pedido de retiro no muestra nada acá. El
        piso (`unit`) va en su propia línea y con más peso — es lo que hace
        perder diez minutos en la puerta si no se lee antes de salir.
      */}
      {order.deliveryMethod === 'delivery' && order.deliveryAddress ? (
        <div className="bg-muted/50 mx-4 mt-2.5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm">
          <Bike className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">{order.deliveryAddress.line}</p>
            {order.deliveryAddress.unit ? (
              <p className="text-primary text-sm font-bold">{order.deliveryAddress.unit}</p>
            ) : null}
            {order.deliveryAddress.between ? (
              <p className="text-muted-foreground text-xs">Entre {order.deliveryAddress.between}</p>
            ) : null}
            {order.deliveryAddress.notes ? (
              <p className="text-muted-foreground text-xs italic">{order.deliveryAddress.notes}</p>
            ) : null}
          </div>
        </div>
      ) : null}

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
                  {/*
                    Ícono real del logo (antes `MessageCircle` genérico de
                    lucide): el componente propio ya existe y lo usa la
                    vitrina, así que acá no había motivo para seguir con el
                    genérico.

                    El verde de marca (#25D366, fijo en el SVG) se mantiene a
                    propósito en vez de neutralizarlo a `currentColor`: es un
                    logo, no texto, y en un tablero de cocina que se mira de
                    reojo el color ayuda a encontrar ESTE botón entre los
                    demás outline/ghost, todos grises. Contraste medido:
                    ~2:1 sobre el fondo claro del admin y ~6.6:1 sobre el
                    oscuro — bajo para texto, pero el ícono no es el único
                    portador del dato (el label "Avisar por WhatsApp" ya lo
                    dice), así que 1.4.11 no lo exige acá.

                    Tamaño bajado un escalón frente al resto de los íconos de
                    este botón (`size-3.5`, no `size-4` como Banknote/Loader2):
                    un logo relleno pesa ópticamente más que un trazo de 2px
                    de lucide, y a size-4 se veía más grande que sus vecinos.
                  */}
                  <WhatsApp className="size-3.5" aria-hidden />
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
            {needsCourier ? (
              // El pedido que más importa del tablero: listo, es delivery, y
              // nadie lo va a llevar. Sin botón de avance a propósito — el
              // trigger de Postgres lo rechazaría — así que lo que hay que
              // VER acá es que falta asignar, no un botón deshabilitado mudo.
              <p className="bg-warning/20 text-warning-foreground rounded-lg px-3 py-2.5 text-center text-sm font-semibold">
                Asigná un repartidor para salir a repartir
              </p>
            ) : null}
            {forwardTarget ? (
              <Button onClick={() => changeStatus(forwardTarget)} disabled={pending} className="h-12 w-full text-base">
                {pending ? <Loader2 className="size-4 animate-spin" /> : FORWARD_ACTION_LABEL[forwardTarget]}
              </Button>
            ) : null}
          </>
        )}

        {order.deliveryMethod === 'delivery' ? (
          <AssignCourier
            order={order}
            storeId={storeId}
            disabled={pending}
            onAssigned={(patch) => onOrderChanged({ ...order, courierId: patch.courierId, courierName: patch.courierName })}
            onRefreshNeeded={onRefreshNeeded}
          />
        ) : null}

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
