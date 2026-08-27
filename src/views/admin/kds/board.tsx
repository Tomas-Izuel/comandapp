'use client'

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, startTransition } from 'react'
import Link from 'next/link'
import { Radio, RotateCw, Bell, BellOff, BellRing, UtensilsCrossed, CreditCard, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'
import { fetchActiveOrdersAction, updateOrderStatusAction } from '@/controllers/kitchen.actions'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/models/schemas/order.schema'
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

const COLUMNS: { status: Order['status']; label: string }[] = [
  { status: 'confirmed', label: ORDER_STATUS_LABELS.confirmed },
  { status: 'preparing', label: ORDER_STATUS_LABELS.preparing },
  { status: 'ready', label: ORDER_STATUS_LABELS.ready },
]

/** Lo que le importa a `OrderCard` del resultado de un cambio de estado. */
type StatusChangeResult = ActionResult<{ notification: { actionUrl?: string } | null }>

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
 * Alto real del header del shell, medido en vez de hardcodeado.
 *
 * `top-[85px]`/`top-[110px]` se rompían apenas el email del staff hacía wrap
 * y el header crecía una línea. El shell no expone ese alto como variable, así
 * que se mide con `ResizeObserver`: se adapta solo, incluida la vez que
 * alguien vuelva a tocar el shell.
 */
function useAdminHeaderOffset(): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return height
}

export function KdsBoard({
  storeId,
  storeName,
  timezone,
  initialOrders,
  onboarding,
}: {
  storeId: number
  storeName: string
  timezone: string
  initialOrders: Order[]
  /** `null` cuando el local ya está armado para vender: el vacío es "al día", no onboarding. */
  onboarding: OnboardingStatus | null
}) {
  const [orders, setOrders] = useState(initialOrders)
  const [live, setLive] = useState(false)
  const [polling, setPolling] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null)
  const { muted, toggleMuted } = useNewOrderAlerts(orders, storeName)
  const { permission: notifPermission, request: requestNotifPermission } = useNotificationPermission()
  const headerOffset = useAdminHeaderOffset()

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
    if (next) setOrders(next)
  }, [storeId])

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

  const byStatus = useMemo(() => {
    const map = new Map<Order['status'], Order[]>()
    for (const column of COLUMNS) map.set(column.status, [])
    for (const order of optimisticOrders) map.get(order.status)?.push(order)
    return map
  }, [optimisticOrders])

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

    if (missing.length > 0) {
      return (
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
      )
    }

    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          title="Al día"
          description="No hay pedidos activos ahora mismo. Los nuevos van a aparecer acá solos."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="sticky z-30" style={{ top: headerOffset }}>
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

        <nav
          aria-label="Saltar a sección"
          className="border-border bg-background flex gap-1.5 overflow-x-auto border-b px-4 py-2 sm:hidden"
        >
          {COLUMNS.map((column) => (
            <a
              key={column.status}
              href={`#kds-${column.status}`}
              className="bg-muted text-muted-foreground flex h-11 shrink-0 items-center rounded-full px-3.5 text-xs font-medium"
            >
              {column.label} ({byStatus.get(column.status)?.length ?? 0})
            </a>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-3 sm:p-6">
        {COLUMNS.map((column) => {
          const columnOrders = byStatus.get(column.status) ?? []
          return (
            <section key={column.status} id={`kds-${column.status}`} className="scroll-mt-32">
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-[0.08em]">
                {column.label} <span className="tabular">({columnOrders.length})</span>
              </h2>
              <div className="flex flex-col gap-4">
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
                    />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
