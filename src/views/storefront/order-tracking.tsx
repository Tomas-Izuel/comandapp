'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MercadoPago } from '@/components/ui/mercadopago'
import { OrderSteps, PaymentNotice, STATUS_LABEL } from '@/views/shared/order-status'
import { Panel } from '@/views/shared/surfaces'
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
      <Button type="button" className="h-11 gap-2 rounded-pill" onClick={handleClick} disabled={isPending}>
        <MercadoPago aria-hidden className="h-3.5 w-auto shrink-0" />
        {isPending ? 'Abriendo Mercado Pago…' : 'Ir a pagar'}
      </Button>
      {error ? <p className="text-destructive text-xs" role="alert">{error}</p> : null}
    </div>
  )
}

/**
 * Lo único que importa mientras la comida no llegó: cuánto falta. Va primero
 * y grande, en su propia tarjeta — el resto de la pantalla (pasos, plata,
 * ítems) es detalle que se consulta después. `etaAt` viene CONGELADO en el
 * pedido (no se recalcula acá ni se vuelve a pedir al servidor); esto solo
 * hace la cuenta de "cuánto falta desde ahora" y la refresca sola cada 30s
 * para que el número baje mientras el cliente tiene la pantalla abierta
 * esperando.
 */
function EtaHero({ order, timezone }: { order: OrderPublicView; timezone: string }) {
  const isDelivery = order.deliveryMethod === 'delivery'
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
        <p className="display text-2xl font-semibold">Pedido cancelado</p>
        {order.paymentStatus === 'approved' ? (
          <p className="text-muted-foreground text-sm">Ya habías pagado — te reembolsamos automáticamente.</p>
        ) : null}
      </div>
    )
  }

  if (order.status === 'delivered') {
    return (
      <div className="flex flex-col gap-1">
        <p className="display text-2xl font-semibold">Pedido entregado</p>
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
        <p className="display text-xl font-semibold">Esperando la confirmación del pago</p>
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
      {/* "Listo" y "llega" no son lo mismo: en delivery el ETA ya incluye el
          viaje del repartidor, así que prometer "listo" sería decir que puede
          pasar a buscarlo cuando en realidad se lo llevan. */}
      <p className="text-muted-foreground text-xs">
        {isDelivery ? 'Llega aprox. a las' : 'Listo aprox. a las'} {formatTime(order.etaAt, timezone)}
      </p>
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
    // `order.status` en las dependencias reinicia el backoff (`attempt` vuelve
    // a 0) en CADA transición, `on_the_way` incluida — y es la decisión
    // correcta ahí en particular: es el único tramo donde el cliente mira la
    // pantalla activamente esperando que el estado cambie a "Entregado" (o el
    // nombre del repartidor aparezca), así que se lo consulta cada 5s de
    // nuevo en vez de arrastrar el backoff largo que traía desde "Listo".
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
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <p className="text-muted-foreground text-xs">
        Pedido #{order.shortCode} en {order.storeName} · hecho a las {formatTime(order.createdAt, timezone)}
      </p>

      {/* `aria-live` porque el estado cambia solo (poll/Realtime): sin esto
          un cambio de "confirmado" a "listo" pasa en silencio para quien usa
          lector de pantalla. El número que más importa va en su propia
          tarjeta, arriba de todo. */}
      <Panel className="p-5" aria-live="polite">
        <EtaHero order={order} timezone={timezone} />
      </Panel>

      <Panel className="p-5">
        <OrderSteps
          status={order.status}
          deliveryMethod={order.deliveryMethod}
          courierFirstName={order.courierFirstName}
        />
      </Panel>

      {/* Cocina y dinero son dos relojes: el aviso de pago queda por fuera de
          la tarjeta de pasos a propósito, para no sugerir que uno depende
          del otro. */}
      <div aria-live="polite" className="contents">
        <PaymentNotice
          paymentStatus={order.paymentStatus}
          paymentMethod={order.paymentMethod}
          action={order.canResumePayment ? <ResumePaymentButton token={token} /> : null}
        />
      </div>

      <Panel className="flex flex-col p-5">
        <div className="flex flex-col gap-px">
          {order.items.map((item) => (
            <div key={item.id} className="border-border flex items-start justify-between gap-3 border-t py-3 text-sm first:border-t-0 first:pt-0">
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

        <div className="border-border mt-3 flex flex-col gap-1.5 border-t pt-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <Price cents={order.subtotalCents} currency={order.currency} className="tabular" />
          </div>
          {order.deliveryMethod === 'delivery' ? (
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Envío</span>
              {order.deliveryFeeCents > 0 ? (
                <Price cents={order.deliveryFeeCents} currency={order.currency} className="tabular" />
              ) : (
                // Plata que el local regaló: no mostrar la fila sería
                // desperdiciar el envío gratis en vez de hacerlo notar.
                <span className="text-primary font-medium">Envío gratis</span>
              )}
            </div>
          ) : null}
          <div className="flex items-baseline justify-between text-base font-medium">
            <span>Total</span>
            <Price cents={order.totalCents} currency={order.currency} exact className="tabular" />
          </div>
          <p className="text-muted-foreground text-xs">
            {order.deliveryMethod === 'delivery' && order.deliveryAddress
              ? `Enviamos a ${order.deliveryAddress.line}${order.deliveryAddress.unit ? `, ${order.deliveryAddress.unit}` : ''}`
              : `Retiro en el local · ${STATUS_LABEL[order.status]}`}
          </p>
        </div>
      </Panel>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1 rounded-pill" onClick={copyLink}>
          <Copy className="size-4" aria-hidden />
          Copiar link del pedido
        </Button>
        <Button asChild variant="ghost" className="h-11 flex-1 rounded-pill">
          <Link href="/mis-pedidos">Ver mis pedidos</Link>
        </Button>
      </div>
    </div>
  )
}
