'use client'

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, startTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Radio, RotateCw, Bell, BellOff, BellRing, UtensilsCrossed, CreditCard, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'
import { isConflict } from '@/lib/conflict'
import { fetchActiveOrdersAction, updateOrderStatusAction } from '@/controllers/kitchen.actions'
import { ALLOWED_TRANSITIONS, ORDER_STATUS_LABELS, type OrderStatus } from '@/models/schemas/order.schema'
import { PageFrame } from '@/views/admin/page-frame'
import { OrderCard } from './order-card'
import type { ActionResult, Order } from '@/models/types'

/**
 * Qué falta para poder vender, calculado en el server (`page.tsx`) y pasado
 * ya resuelto: el tablero no sabe consultar catálogo ni credenciales, solo
 * decide QUÉ mostrar con lo que le llega.
 */
export type OnboardingStatus = {
  missingCatalog: boolean
  missingPayment: boolean
}

const POLL_INTERVAL_MS = 30_000

/**
 * Ventana de coalescencia para los eventos de Realtime. En hora pico, diez
 * updates en dos segundos disparaban diez Server Actions serializadas por
 * Next (devolviendo cada una la lista completa): esto las junta en una sola.
 */
const REALTIME_DEBOUNCE_MS = 500

const SOUND_MUTED_KEY = 'burger-shop.kds-muted'

const BASE_COLUMNS: { status: Order['status']; label: string }[] = [
  { status: 'confirmed', label: ORDER_STATUS_LABELS.confirmed },
  { status: 'preparing', label: ORDER_STATUS_LABELS.preparing },
  { status: 'ready', label: ORDER_STATUS_LABELS.ready },
]

/**
 * `on_the_way` solo entra si el local reparte. Una columna que SIEMPRE está
 * vacía se come un cuarto del tablero, y el tablero es la pantalla donde la
 * posición de una comanda es la memoria del que fue interrumpido.
 */
const DELIVERY_COLUMN = { status: 'on_the_way' as const, label: ORDER_STATUS_LABELS.on_the_way }

/**
 * Si el pedido puede legalmente pasar a `target`, considerando no solo
 * `ALLOWED_TRANSITIONS` sino las dos condiciones extra de un delivery real: un
 * pedido de RETIRO nunca puede salir a repartir, y uno de DELIVERY sin
 * repartidor asignado tampoco — el trigger de Postgres rechaza esas dos cosas
 * con un 500 si se las dejamos ofrecer. Misma regla que `forwardTarget` en
 * `order-card.tsx`, duplicada a propósito: es la única lógica que comparten
 * los dos archivos y no vale la pena una dependencia compartida para 4 líneas.
 */
function canReachStatus(order: Order, target: OrderStatus): boolean {
  if (!ALLOWED_TRANSITIONS[order.status].includes(target)) return false
  if (target !== 'on_the_way') return true
  return order.deliveryMethod === 'delivery' && order.courierId != null
}

/** Lo que le importa a `OrderCard` del resultado de un cambio de estado. */
type StatusChangeResult = ActionResult<{ notification: { actionUrl?: string } | null }>

/**
 * Una columna del tablero, y su zona de drop.
 *
 * `legalDuringDrag` es la expresión en drag-and-drop de "la transición que la
 * máquina no permite no se ofrece": mientras se arrastra algo, la columna que
 * no acepta el estado destino se apaga (opacidad + sin anillo) y `disabled` le
 * dice a dnd-kit que no la cuente como blanco válido, así que ni el hover ni
 * el drop hacen nada ahí. Fuera de un arrastre no se toca nada.
 */
function KdsColumn({
  status,
  label,
  count,
  dragging,
  legalDuringDrag,
  children,
}: {
  status: OrderStatus
  label: string
  count: number
  /** Hay un arrastre en curso (de cualquier tarjeta), para decidir si esta columna se resalta o se apaga. */
  dragging: boolean
  /** Si HAY un arrastre en curso, ¿esta columna acepta el pedido que se está moviendo? */
  legalDuringDrag: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: dragging && !legalDuringDrag })

  return (
    <section
      ref={setNodeRef}
      id={`kds-${status}`}
      className={cn(
        // `min-w-0`: un item de grid trae `min-width: auto`, o sea que no baja
        // de su contenido mínimo. Un nombre de producto largo en una tarjeta
        // inflaba la columna, la columna inflaba el grid y el grid desbordaba
        // el área de trabajo de costado.
        'min-w-0 scroll-mt-32 rounded-lg transition-colors duration-(--dur-fast)',
        dragging && !legalDuringDrag && 'opacity-40 saturate-50',
        dragging && legalDuringDrag && isOver && 'ring-primary bg-primary/5 ring-2',
        dragging && legalDuringDrag && !isOver && 'ring-primary/25 ring-2 ring-dashed',
      )}
    >
      <h2 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-[0.08em] lg:text-sm">
        {label} <span className="tabular">({count})</span>
      </h2>
      {children}
    </section>
  )
}

/** Vista chica de la tarjeta que sigue al puntero mientras se arrastra. La tarjeta real se atenúa en su lugar. */
function DragPreviewCard({ order }: { order: Order }) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0)
  return (
    <div className="bg-card border-border shadow-pop flex w-72 cursor-grabbing items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <span className="text-lg leading-none font-bold">{order.shortCode || `#${order.id}`}</span>
      <span className="text-muted-foreground truncate text-sm">
        {order.customerName} · {itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}
      </span>
    </div>
  )
}

async function fetchActiveOrders(storeId: number): Promise<Order[] | null> {
  const result = await fetchActiveOrdersAction(storeId)
  return result.ok ? result.data : null
}

/**
 * Beep corto por `AudioContext`. Sin librerías nuevas y sin depender de un
 * archivo de audio que alguien tendría que subir para cada tienda.
 */
function playChime() {
  try {
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.45)
    osc.onended = () => void ctx.close()
  } catch {
    // Sin gesto previo del usuario algunos navegadores bloquean el audio.
    // No es crítico: el título de la pestaña y la notificación siguen avisando.
  }
}

/**
 * Sonido + contador en `document.title` + Web Notification cuando entra un
 * pedido nuevo. PRODUCT.md: el dueño necesita "enterarse cuando entra un
 * pedido sin tener la pantalla abierta"; hoy aparecía mudo en "Confirmado".
 *
 * La preferencia de silencio se guarda en `localStorage`: un mostrador que
 * decide silenciarlo en hora pico no quiere reactivarlo en cada recarga.
 */
function useNewOrderAlerts(orders: Order[], storeName: string) {
  const [muted, setMuted] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const knownIds = useRef<Set<number> | null>(null)
  const baseTitle = useRef<string | null>(null)

  useEffect(() => {
    // localStorage es del cliente: arrancamos en `false` (igual que el SSR) y
    // recién leemos acá, después del primer render, para no desincronizar
    // del HTML hidratado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(localStorage.getItem(SOUND_MUTED_KEY) === '1')
  }, [])

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      localStorage.setItem(SOUND_MUTED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  useEffect(() => {
    const ids = new Set(orders.map((o) => o.id))
    if (knownIds.current === null) {
      // Primera carga: lo que ya estaba en el tablero no es "nuevo".
      knownIds.current = ids
      return
    }
    const arrived = orders.filter((o) => !knownIds.current!.has(o.id))
    knownIds.current = ids
    if (arrived.length === 0) return

    setUnseen((n) => n + arrived.length)
    if (muted) return

    playChime()
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const first = arrived[0]
      new Notification(`Pedido nuevo en ${storeName}`, {
        body:
          arrived.length === 1
            ? `${first.shortCode || `#${first.id}`} · ${first.customerName}`
            : `${arrived.length} pedidos nuevos`,
        tag: 'kds-new-order',
      })
    }
  }, [orders, muted, storeName])

  useEffect(() => {
    function onVisible() {
      if (!document.hidden) setUnseen(0)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    baseTitle.current ??= document.title
    document.title = unseen > 0 ? `(${unseen}) ${baseTitle.current}` : baseTitle.current
  }, [unseen])

  useEffect(() => {
    return () => {
      if (baseTitle.current !== null) document.title = baseTitle.current
    }
  }, [])

  return { muted, toggleMuted }
}

/** Estado del permiso de Web Notifications, para ofrecer el botón solo cuando tiene sentido. */
function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')

  useEffect(() => {
    // `Notification` no existe en el server: arrancamos en 'unsupported' (igual
    // que el SSR) y recién acá leemos el permiso real del navegador.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])

  const request = useCallback(() => {
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission().then(setPermission)
  }, [])

  return { permission, request }
}

/**
 * El drag-and-drop entre columnas solo corre `≥lg`: abajo el gesto pelea con
 * el scroll del pulgar y no hay tres columnas contra las cuales soltar. Se
 * arranca en `false` (igual que el SSR) y se confirma acá, después del primer
 * render, para no desincronizar del HTML hidratado.
 */
function useIsLgUp(): boolean {
  const [isLgUp, setIsLgUp] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 64rem)')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLgUp(query.matches)
    const onChange = (e: MediaQueryListEvent) => setIsLgUp(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isLgUp
}

export function KdsBoard({
  storeId,
  storeName,
  timezone,
  initialOrders,
  onboarding,
  autoStartOrders,
  autoReadyOrders,
  deliveryEnabled,
}: {
  storeId: number
  storeName: string
  timezone: string
  initialOrders: Order[]
  /** `null` cuando el local ya está armado para vender: el vacío es "al día", no onboarding. */
  onboarding: OnboardingStatus | null
  /** El pedido pasa a `preparing` solo, apenas se confirma. Para marcar la tarjeta "la movió el sistema". */
  autoStartOrders: boolean
  /** El pedido pasa a `ready` solo al cumplirse el ETA. Idem. */
  autoReadyOrders: boolean
  /** `store.delivery.enabled`. Sin esto no hay columna "En camino" que mostrar. */
  deliveryEnabled: boolean
}) {
  // Memoizada por referencia: si no, cada render arma un array nuevo y
  // `byStatus` (que la usa) pierde el memo por completo aunque nada haya
  // cambiado realmente.
  const COLUMNS = useMemo(
    () => (deliveryEnabled ? [...BASE_COLUMNS, DELIVERY_COLUMN] : BASE_COLUMNS),
    [deliveryEnabled],
  )

  const [orders, setOrders] = useState(initialOrders)
  const [live, setLive] = useState(false)
  const [polling, setPolling] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const { muted, toggleMuted } = useNewOrderAlerts(orders, storeName)
  const { permission: notifPermission, request: requestNotifPermission } = useNotificationPermission()
  const isLgUp = useIsLgUp()

  /**
   * Qué pedido llegó a su estado actual por una automatización de la tienda y
   * no por un toque de un operario. No hay una columna para esto en `orders`
   * —el modelo no la tiene, y esta tanda no toca schema— así que se infiere en
   * el cliente: se guarda el ESTADO en el que se lo vio avanzar solo, y el
   * badge se muestra mientras el pedido siga en exactamente ese estado. En
   * cuanto alguien lo mueve (para cualquier lado), deja de coincidir y el
   * badge desaparece sin que haga falta limpiarlo a mano.
   *
   * Límite conocido, reportado: si otro operario mueve el pedido desde OTRO
   * dispositivo mientras la automatización de ese paso está activa, esta
   * tarjeta no tiene forma de distinguir "lo movió esa persona" de "lo movió
   * el sistema" — ambos llegan igual, como una fila que cambió sin pasar por
   * el `changeOrderStatus` de ESTE cliente. Resolverlo bien pide una columna
   * como `orders.status_changed_by` que hoy no existe.
   */
  const [autoMoved, setAutoMoved] = useState<Map<number, OrderStatus>>(new Map())
  const ordersRef = useRef(orders)
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  /** El pedido que se está arrastrando ahora mismo, para apagar las columnas ilegales y pintar el `DragOverlay`. */
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  /** Un drop rechazado por el servidor: la tarjeta anima la vuelta en vez de saltar. */
  const [justReturnedId, setJustReturnedId] = useState<number | null>(null)

  const sensors = useSensors(
    // Distancia mínima antes de considerarlo arrastre: sin esto, un click
    // sobre "Marcar listo" o "Cancelar pedido" se interpretaría como el
    // arranque de un drag y el botón nunca recibiría el click.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  /**
   * Espejo optimista de `orders`: un cambio de estado se ve en el toque, no
   * después del round-trip. Si el server no confirma (no se llama a
   * `setOrders`), React lo revierte solo en cuanto termina la transición —
   * no hay que deshacer nada a mano.
   */
  const [optimisticOrders, setOptimisticStatus] = useOptimistic(
    orders,
    (state, patch: { orderId: number; status: OrderStatus }) =>
      state.map((o) => (o.id === patch.orderId ? { ...o, status: patch.status } : o)),
  )

  const poll = useCallback(async () => {
    setPolling(true)
    const next = await fetchActiveOrders(storeId)
    setPolling(false)
    if (!next) return

    // Detecta transiciones que este cliente no inició (no pasaron por
    // `changeOrderStatus`) y que coinciden con lo que la automatización de la
    // tienda haría: confirmed→preparing con `autoStartOrders`, o
    // preparing→ready con `autoReadyOrders`. Ver el comentario de `autoMoved`
    // más arriba sobre el límite de esta inferencia.
    const prevById = new Map(ordersRef.current.map((o) => [o.id, o.status]))
    const detected: [number, OrderStatus][] = []
    for (const order of next) {
      const prevStatus = prevById.get(order.id)
      if (!prevStatus || prevStatus === order.status) continue
      const wasAuto =
        (prevStatus === 'confirmed' && order.status === 'preparing' && autoStartOrders) ||
        (prevStatus === 'preparing' && order.status === 'ready' && autoReadyOrders)
      if (wasAuto) detected.push([order.id, order.status])
    }
    if (detected.length > 0) {
      setAutoMoved((prev) => {
        const map = new Map(prev)
        for (const [id, status] of detected) map.set(id, status)
        return map
      })
    }

    setOrders(next)
  }, [storeId, autoStartOrders, autoReadyOrders])

  /** Recarga inmediata: la usa el 409 de una tarjeta, que no puede esperar el debounce. */
  const refetch = useCallback(() => {
    void poll()
  }, [poll])

  useEffect(() => {
    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    async function safePoll() {
      if (!cancelled) await poll()
    }

    function scheduleDebouncedPoll() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void safePoll(), REALTIME_DEBOUNCE_MS)
    }

    const supabase = createClient()
    const channel = supabase
      .channel(`kds-orders-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
        scheduleDebouncedPoll,
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    // El polling corre siempre, sea o no que Realtime esté conectado: es la
    // red de contención. Un panel de cocina que se queda mudo pierde pedidos.
    const interval = setInterval(() => void safePoll(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [storeId, poll])

  /**
   * Único punto que llama a `updateOrderStatusAction`. Aplica el estado
   * optimista y, cuando el server confirma, lo vuelca al estado real; si
   * rechaza, no toca `orders` y el optimista se revierte solo.
   */
  const changeOrderStatus = useCallback(
    (order: Order, target: OrderStatus): Promise<StatusChangeResult> =>
      new Promise((resolve) => {
        setPendingOrderId(order.id)
        startTransition(async () => {
          setOptimisticStatus({ orderId: order.id, status: target })
          const result = await updateOrderStatusAction({ storeId, orderId: order.id, status: target })
          if (result.ok) {
            setOrders((prev) =>
              target === 'confirmed' || target === 'preparing' || target === 'ready'
                ? prev.map((o) => (o.id === order.id ? { ...o, status: target } : o))
                : prev.filter((o) => o.id !== order.id),
            )
          }
          setPendingOrderId(null)
          resolve(result)
        })
      }),
    [storeId, setOptimisticStatus],
  )

  /** El cobro en el local no es optimista a propósito: es el ciclo del dinero, se confirma antes de mostrarlo. */
  function handleOrderChanged(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
  }

  function handleDragStart(event: DragStartEvent) {
    const order = optimisticOrders.find((o) => o.id === event.active.id)
    setActiveOrder(order ?? null)
  }

  /**
   * El drop reusa `changeOrderStatus`: mismo camino optimista, mismo 409 vía
   * `isConflict`, ninguna regla de legalidad duplicada. La columna donde se
   * soltó ya venía deshabilitada si la transición era ilegal (ver
   * `KdsColumn`), así que el chequeo de acá es una red de contención, no la
   * autoridad — igual que el CHECK de Postgres es la autoridad real.
   */
  function handleDragEnd(event: DragEndEvent) {
    const order = activeOrder
    setActiveOrder(null)
    if (!order) return
    const { over } = event
    if (!over) return
    const target = over.id as OrderStatus
    if (target === order.status || !canReachStatus(order, target)) return

    void (async () => {
      const result = await changeOrderStatus(order, target)
      if (!result.ok) {
        if (isConflict(result)) {
          toast.error('El pedido cambió', { description: 'Otro operario lo actualizó primero. Refrescando…' })
          refetch()
        } else {
          toast.error('No se pudo mover el pedido', { description: result.error })
        }
        // La tarjeta ya volvió a su columna sola (el optimista se revierte
        // solo); esto solo dispara la animación de "vuelta", no de un salto.
        setJustReturnedId(order.id)
        setTimeout(() => setJustReturnedId((id) => (id === order.id ? null : id)), 400)
        return
      }
      if (result.data.notification?.actionUrl) {
        const url = result.data.notification.actionUrl
        toast.success('Pedido actualizado', {
          action: { label: 'Avisar por WhatsApp', onClick: () => window.open(url, '_blank', 'noreferrer') },
        })
      }
    })()
  }

  const byStatus = useMemo(() => {
    const map = new Map<Order['status'], Order[]>()
    for (const column of COLUMNS) map.set(column.status, [])
    for (const order of optimisticOrders) map.get(order.status)?.push(order)
    return map
  }, [optimisticOrders, COLUMNS])

  if (optimisticOrders.length === 0) {
    const missing = onboarding
      ? [
          onboarding.missingCatalog
            ? { key: 'catalogo', label: 'Cargá al menos un producto', href: '/admin/catalogo', icon: UtensilsCrossed }
            : null,
          onboarding.missingPayment
            ? {
                key: 'pagos',
                label: 'Conectá Mercado Pago o habilitá pago al retirar',
                href: '/admin/pagos',
                icon: CreditCard,
              }
            : null,
        ].filter((s): s is { key: string; label: string; href: string; icon: typeof UtensilsCrossed } => s !== null)
      : []

    return (
      <PageFrame title="Cocina" width="board">
        {missing.length > 0 ? (
          <div className="mx-auto max-w-md py-4">
            <EmptyState
              title="Preparate para vender"
              description="Todavía falta esto para que un cliente pueda pedir y pagar:"
              action={
                <div className="flex w-full flex-col gap-2">
                  {missing.map((step) => (
                    <Button key={step.key} asChild variant="outline" className="h-12 w-full justify-between px-4">
                      <Link href={step.href}>
                        <span className="flex items-center gap-2">
                          <step.icon className="size-4" aria-hidden />
                          {step.label}
                        </span>
                        <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  ))}
                </div>
              }
            />
          </div>
        ) : (
          <div className="mx-auto max-w-md">
            <EmptyState
              title="Al día"
              description="No hay pedidos activos ahora mismo. Los nuevos van a aparecer acá solos."
            />
          </div>
        )}
      </PageFrame>
    )
  }

  // `canReachStatus`, no `ALLOWED_TRANSITIONS[activeOrder.status]` a secas: la
  // columna "En camino" tiene que apagarse igual para un pedido de RETIRO o
  // uno de delivery SIN repartidor, aunque el estado de origen la permita.
  const legalDuringDrag = activeOrder
    ? COLUMNS.map((c) => c.status).filter((s) => canReachStatus(activeOrder, s))
    : []

  /** Anuncios de `@dnd-kit` en español rioplatense, con el código de la comanda y el nombre de la columna, no IDs internos. */
  const orderLabel = (id: number) => {
    const found = optimisticOrders.find((o) => o.id === id)
    return found?.shortCode || `#${id}`
  }
  const columnLabel = (id: string | number) => COLUMNS.find((c) => c.status === id)?.label ?? String(id)
  const announcements: Announcements = {
    onDragStart({ active }) {
      return `Se levantó el pedido ${orderLabel(Number(active.id))}.`
    },
    onDragOver({ active, over }) {
      if (!over) return `El pedido ${orderLabel(Number(active.id))} no está sobre ninguna columna.`
      return `El pedido ${orderLabel(Number(active.id))} está sobre ${columnLabel(over.id)}.`
    },
    onDragEnd({ active, over }) {
      if (!over) return `Se soltó el pedido ${orderLabel(Number(active.id))} sin moverlo de columna.`
      return `Se soltó el pedido ${orderLabel(Number(active.id))} en ${columnLabel(over.id)}.`
    },
    onDragCancel({ active }) {
      return `Se canceló el arrastre del pedido ${orderLabel(Number(active.id))}.`
    },
  }

  return (
    <PageFrame
      title="Cocina"
      width="board"
      bleed={
        <div className="sticky top-(--admin-header-h) z-30">
          <div className="border-border bg-muted/40 text-muted-foreground flex items-center justify-between gap-2 border-b px-4 py-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em]">
            <span className="flex items-center gap-1.5">
              {polling ? (
                <RotateCw className="size-3 animate-spin" aria-hidden />
              ) : (
                <Radio className={cn('size-3', live ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              )}
              {live ? 'En vivo' : `Actualizando cada ${POLL_INTERVAL_MS / 1000}s`}
            </span>
            <span className="flex items-center gap-1">
              {notifPermission === 'default' ? (
                <button
                  type="button"
                  onClick={requestNotifPermission}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-[0.6875rem] normal-case tracking-normal"
                >
                  <BellRing className="size-3.5" aria-hidden />
                  Activar avisos
                </button>
              ) : null}
              <button
                type="button"
                onClick={toggleMuted}
                aria-pressed={muted}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-11 items-center justify-center rounded-lg"
              >
                {muted ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
                <span className="sr-only">
                  {muted ? 'Sonido de pedido nuevo silenciado, tocá para activarlo' : 'Silenciar sonido de pedido nuevo'}
                </span>
              </button>
            </span>
          </div>

          {/* Nav de anclas: reemplaza a las columnas lado a lado por debajo de
              `lg`, donde el tablero es de una sola columna apilada. */}
          <nav
            aria-label="Saltar a sección"
            className="border-border bg-background flex gap-1.5 overflow-x-auto border-b px-4 py-2 lg:hidden"
          >
            {COLUMNS.map((column) => (
              <a
                key={column.status}
                href={`#kds-${column.status}`}
                className="bg-muted text-muted-foreground flex h-11 shrink-0 items-center rounded-pill px-3.5 text-xs font-medium"
              >
                {column.label} ({byStatus.get(column.status)?.length ?? 0})
              </a>
            ))}
          </nav>
        </div>
      }
    >
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{ announcements }}
      >
        {/*
          1 columna hasta `lg` (una tarjeta con ítems, opciones y dos botones
          de 48px no entra en 3 columnas de ~210px) y 3 desde `lg`, que es
          también donde arranca el drag: abajo del breakpoint no hay contra
          qué soltar y el gesto compite con el scroll del pulgar.
        */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          {COLUMNS.map((column) => {
            const columnOrders = byStatus.get(column.status) ?? []
            return (
              <KdsColumn
                key={column.status}
                status={column.status}
                label={column.label}
                count={columnOrders.length}
                dragging={activeOrder !== null}
                legalDuringDrag={legalDuringDrag.includes(column.status)}
              >
                {/* Tope de ancho en `2xl`: sin esto, 3 columnas en un monitor de
                    27" se inflan a ~600px con botones full-width igual de anchos. */}
                <div className="flex flex-col gap-4 2xl:max-w-[26rem]">
                  {columnOrders.length === 0 ? (
                    <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                      Nada acá por ahora
                    </p>
                  ) : (
                    columnOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        storeId={storeId}
                        timezone={timezone}
                        statusPending={pendingOrderId === order.id}
                        onChangeStatus={changeOrderStatus}
                        onOrderChanged={handleOrderChanged}
                        onRefreshNeeded={refetch}
                        dragEnabled={isLgUp}
                        movedBySystem={autoMoved.get(order.id) === order.status}
                        justReturned={justReturnedId === order.id}
                      />
                    ))
                  )}
                </div>
              </KdsColumn>
            )
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {activeOrder ? <DragPreviewCard order={activeOrder} /> : null}
        </DragOverlay>
      </DndContext>
    </PageFrame>
  )
}
