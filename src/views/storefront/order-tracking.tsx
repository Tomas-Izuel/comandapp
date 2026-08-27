'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OrderSteps, PaymentNotice, STATUS_LABEL } from '@/views/shared/order-status'
import { Price } from '@/views/shared/money'
import { formatTime, minutesUntil } from '@/lib/dates'
import { clearResolvedOrderCart } from '@/lib/cart'
import { isTerminalStatus } from '@/models/schemas/order.schema'
import { resumePaymentAction } from '@/controllers/checkout.actions'
import type { OrderPublicView } from '@/models/types'

/**
 * Todas las tiendas del producto operan en Argentina (ver PRODUCT.md): sin el
 * `Store` completo a mano acá (solo llega `OrderPublicView`, que no lleva
 * `timezone`), este es el mejor default disponible. `OrderTrackingPage` pasa
 * la zona real cuando la tiene.
 */
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

/** 5s → 30s → 60s: un pedido abandonado con la pestaña abierta no tiene que pegarle al servidor para siempre. */
const POLL_BACKOFF_MS = [5000, 30000, 60000]

/**
 * Botón "Ir a pagar" (F-01): sin esto, un pago que falla o un cliente que
 * abandona la redirección a Mercado Pago no tenía ningún camino de vuelta.
 * Se monta en el slot `action` de `PaymentNotice`, que queda puramente
 * presentacional.
 */
function ResumePaymentButton({ token }: { token: string }) {
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await resumePaymentAction(token)
      if (!result.ok) {
        setError(result.error)
        return
      }
      window.location.href = result.data.checkoutUrl
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" className="h-11" onClick={handleClick} disabled={isPending}>
        {isPending ? 'Abriendo Mercado Pago…' : 'Ir a pagar'}
      </Button>
      {error ? <p className="text-destructive text-xs" role="alert">{error}</p> : null}
    </div>
  )
}

/**
 * Lo único que importa mientras la comida no llegó: cuánto falta. Va primero
 * y grande — el resto de la pantalla (pasos, plata, ítems) es detalle que se
 * consulta después. `etaAt` viene CONGELADO en el pedido (no se recalcula acá
 * ni se vuelve a pedir al servidor); esto solo hace la cuenta de "cuánto
 * falta desde ahora" y la refresca sola cada 30s para que el número baje
 * mientras el cliente tiene la pantalla abierta esperando.
 */
function EtaHero({ order, timezone }: { order: OrderPublicView; timezone: string }) {
  // Arranca en el minuto congelado (mismo valor en server y en el primer
  // render del cliente, sin usar el reloj): recién en el efecto se calcula
  // "cuánto falta desde AHORA", que si se calculara en el render inicial
  // podría no coincidir entre servidor y cliente y disparar un warning de
  // hidratación por una diferencia de un minuto.
  const [remainingMinutes, setRemainingMinutes] = React.useState(order.etaMinutes)

  React.useEffect(() => {
    if (!order.etaAt || isTerminalStatus(order.status)) return
    const etaAt = order.etaAt
    function tick() {
      setRemainingMinutes(minutesUntil(etaAt))
    }
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [order.etaAt, order.status])

  if (order.status === 'cancelled') {
    return (
      <div className="flex flex-col gap-1">
        <p className="display text-3xl uppercase">Pedido cancelado</p>
        {order.paymentStatus === 'approved' ? (
          <p className="text-muted-foreground text-sm">Ya habías pagado — te reembolsamos automáticamente.</p>
        ) : null}
      </div>
    )
  }

  if (order.status === 'delivered') {
    return (
      <div className="flex flex-col gap-1">
        <p className="display text-3xl uppercase">Pedido entregado</p>
        <p className="text-muted-foreground text-sm">Buen provecho.</p>
      </div>
    )
  }

  if (!order.etaAt) {
    // Pago online todavía no confirmado: el ETA se recalcula recién al
    // aprobarse (ver CLAUDE.md, "Multiplicador de demanda"), así que hasta
    // entonces no hay un número honesto que mostrar.
    return (
      <div className="flex flex-col gap-1">
        <p className="display text-2xl uppercase">Esperando la confirmación del pago</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-sm">Falta</p>
      <p className="display tabular text-6xl leading-none font-semibold whitespace-nowrap">
        {remainingMinutes !== null && remainingMinutes > 0 ? (
          <>
            {remainingMinutes}
            <span className="text-muted-foreground ml-2 text-xl font-normal">min</span>
          </>
        ) : (
          'Ya casi'
        )}
      </p>
      <p className="text-muted-foreground text-xs">Listo aprox. a las {formatTime(order.etaAt, timezone)}</p>
    </div>
  )
}

/**
 * Seguimiento del pedido. Poll con backoff mientras el pedido siga en curso,
 * pausado cuando la pestaña no está visible; se detiene solo en un estado
 * terminal para no seguir pegándole al servidor.
 */
export function OrderTracking({
  token,
  initialOrder,
  timezone = DEFAULT_TIMEZONE,
}: {
  token: string
  initialOrder: OrderPublicView
  timezone?: string
}) {
  const [order, setOrder] = React.useState(initialOrder)

  React.useEffect(() => {
    if (isTerminalStatus(order.status)) return

    let cancelled = false
    let attempt = 0
    let timeoutId: number | undefined

    async function tick() {
      // Pausado en segundo plano: la pestaña oculta no necesita el dato al
      // segundo, y es exactamente el caso del carrito/pedido abandonado.
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch(`/api/orders/${token}`)
          if (res.ok) {
            const body: { order: OrderPublicView } = await res.json()
            if (!cancelled) setOrder(body.order)
          }
        } catch {
          // Sin señal por un momento: se reintenta en el próximo tick.
        }
        attempt += 1
      }
      if (!cancelled) scheduleNext()
    }

    function scheduleNext() {
      const delay = POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)]
      timeoutId = window.setTimeout(tick, delay)
    }

    function handleVisibility() {
      // Al volver a foco no hace falta esperar el resto del backoff: se
      // consulta ya para que el estado no se sienta viejo.
      if (document.visibilityState === 'visible' && timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
        void tick()
      }
    }

    scheduleNext()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [token, order.status])

  React.useEffect(() => {
    // El carrito se vacía recién acá, nunca antes de redirigir a Mercado
    // Pago (decisión de producto: la idempotencyKey ya protege contra
    // duplicados, así que dejarlo intacto es lo único que permite reintentar
    // si la navegación a MP falla).
    if (order.paymentStatus === 'approved') clearResolvedOrderCart(order.storeSlug)
  }, [order.paymentStatus, order.storeSlug])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Copiamos el link del pedido')
    } catch {
      toast.error('No pudimos copiar el link')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
      <h1 className="text-muted-foreground text-xs font-normal">
        Pedido #{order.shortCode} en {order.storeName} · hecho a las {formatTime(order.createdAt, timezone)}
      </h1>

      {/* `aria-live` porque el estado cambia solo (poll/Realtime): sin esto
          un cambio de "confirmado" a "listo" pasa en silencio para quien usa
          lector de pantalla. */}
      <div aria-live="polite" className="contents">
        <EtaHero order={order} timezone={timezone} />
      </div>

      <OrderSteps status={order.status} />

      <div aria-live="polite" className="contents">
        <PaymentNotice
          paymentStatus={order.paymentStatus}
          paymentMethod={order.paymentMethod}
          action={order.canResumePayment ? <ResumePaymentButton token={token} /> : null}
        />
      </div>

      <div className="flex flex-col gap-px">
        {order.items.map((item) => (
          <div key={item.id} className="border-border flex items-start justify-between gap-3 border-t py-3 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">
                {item.quantity} × {item.nameSnapshot}
              </span>
              {item.options.length > 0 ? (
                <span className="text-muted-foreground text-xs">{item.options.map((o) => o.nameSnapshot).join(', ')}</span>
              ) : null}
              {item.notes ? <span className="text-muted-foreground text-xs italic">“{item.notes}”</span> : null}
            </div>
            <Price cents={item.totalCents} currency={order.currency} className="tabular shrink-0" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <Price cents={order.subtotalCents} currency={order.currency} className="tabular" />
        </div>
        <div className="border-border flex items-baseline justify-between border-t pt-1.5 text-base font-medium">
          <span>Total</span>
          <Price cents={order.totalCents} currency={order.currency} exact className="tabular" />
        </div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.08em]">
          Retiro en el local · {STATUS_LABEL[order.status]}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={copyLink}>
          <Copy className="size-4" aria-hidden />
          Copiar link del pedido
        </Button>
        <Button asChild variant="ghost" className="h-11 flex-1">
          <Link href="/mis-pedidos">Ver mis pedidos</Link>
        </Button>
      </div>
    </div>
  )
}
