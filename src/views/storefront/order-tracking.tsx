'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MercadoPago } from '@/components/ui/mercadopago'
import { OrderSteps, PaymentNotice, STATUS_LABEL } from '@/views/shared/order-status'
import { TransferPanel } from '@/views/storefront/transfer-panel'
import { Panel } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { cn } from '@/lib/utils'
import { formatTime, minutesUntil } from '@/lib/dates'
import { formatScheduledLabel } from '@/views/storefront/schedule-lib'
import { clearResolvedOrderCart } from '@/lib/cart'
import { isTerminalStatus, type OrderStatus } from '@/models/schemas/order.schema'
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
 * La frase que resume el estado, para el lector de pantalla. Vive acá y no
 * en `OrderSteps` porque acá se conoce TODO el pedido (método, repartidor,
 * hora): la región `aria-live` anuncia una sola oración por transición, en
 * vez de volver a leer la tarjeta entera cada vez que baja un minuto.
 */
function statusSentence(order: OrderPublicView, timezone: string): string {
  const isDelivery = order.deliveryMethod === 'delivery'
  switch (order.status) {
    case 'pending':
      return order.paymentMethod === 'transfer'
        ? order.transferReceiptUploadedAt
          ? 'Estamos verificando tu transferencia.'
          : 'Esperando tu transferencia.'
        : 'Esperando la confirmación del pago.'
    case 'confirmed':
      return order.scheduledFor ? 'Pedido confirmado para el horario que elegiste.' : 'Pedido confirmado.'
    case 'preparing':
      return order.etaAt
        ? `Tu pedido está en preparación. ${isDelivery ? 'Llega' : 'Listo'} aproximadamente a las ${formatTime(order.etaAt, timezone)}.`
        : 'Tu pedido está en preparación.'
    case 'ready':
      return isDelivery
        ? 'Tu pedido está listo para salir.'
        : `Tu pedido está listo. En el mostrador decí el código ${order.shortCode}.`
    case 'on_the_way':
      return order.courierFirstName ? `${order.courierFirstName} está llevando tu pedido.` : 'Tu pedido está en camino.'
    case 'delivered':
      return 'Pedido entregado.'
    case 'cancelled':
      return 'Pedido cancelado.'
  }
}

/**
 * El marco del titular. `key={status}` remonta el contenido en cada
 * transición para que `hero-swap` corra CADA vez que cambia el estado, y solo
 * ahí: en la primera carga `animate` es `false` y la tarjeta ya está en su
 * lugar — esta pantalla se abre tres o cuatro veces mientras se espera, y una
 * entrada que se repite en cada visita envejece en la segunda.
 */
function HeroFrame({ status, animate, children }: { status: OrderStatus; animate: boolean; children: React.ReactNode }) {
  return (
    <div key={status} className={cn('flex flex-col gap-1.5', animate && 'hero-swap')}>
      {children}
    </div>
  )
}

function HeroTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('display text-foreground text-2xl font-semibold', className)}>{children}</p>
}

function HeroNote({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-muted-foreground text-sm', className)}>{children}</p>
}

/**
 * Lo único que importa mientras la comida no llegó: qué está pasando y cuánto
 * falta. Va primero y grande, en su propia tarjeta — el resto de la pantalla
 * (pasos, plata, ítems) es detalle que se consulta después.
 *
 * Cada estado tiene su propio titular, atado al estado REAL del pedido. Antes
 * un pedido `ready` seguía mostrando la cuenta regresiva ("Falta 3 min") en
 * la tarjeta más grande mientras los pasos de abajo decían "Listo": el
 * cliente venía a saber exactamente eso y la pantalla se contradecía sola.
 *
 * `etaAt` viene CONGELADO en el pedido (no se recalcula acá ni se vuelve a
 * pedir al servidor); esto solo hace la cuenta de "cuánto falta desde ahora"
 * y la refresca sola cada 30s para que el número baje mientras el cliente
 * tiene la pantalla abierta esperando.
 *
 * Programados: la señal es la PRESENCIA de `order.scheduledFor`, no la
 * ausencia de `etaMinutes` — ese campo viene `null` desde la creación para
 * todo programado (no se midió ningún multiplicador de demanda con
 * sentido), pero `etaAt` SÍ está seteado desde el arranque (`etaAt =
 * scheduledFor`, congelado). Sin este branch el efecto de más arriba
 * dispara igual y un pedido programado para el sábado mostraría "4320 min"
 * en la tarjeta más grande de la pantalla.
 */
function EtaHero({
  order,
  timezone,
  previousStatus,
}: {
  order: OrderPublicView
  timezone: string
  /** `null` hasta la primera transición vista en esta pestaña: recién ahí el titular anima al cambiar. */
  previousStatus: OrderStatus | null
}) {
  const isDelivery = order.deliveryMethod === 'delivery'
  const isScheduled = order.scheduledFor !== null
  const animate = previousStatus !== null
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

  const etaTime = order.etaAt ? formatTime(order.etaAt, timezone) : null

  if (order.status === 'cancelled') {
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>Pedido cancelado</HeroTitle>
        {order.paymentStatus === 'approved' ? (
          // El reembolso de un pedido cancelado es MANUAL (el local lo
          // gestiona desde Mercado Pago) — antes decía "automáticamente",
          // que era falso incluso para un pedido inmediato y se vuelve más
          // notorio con la cancelación de un programado (pausa destructiva o
          // cierre de fecha). Mismo componente para toda cancelación, así
          // que el copy correcto acá cubre los dos casos.
          <HeroNote>Ya habías pagado — el local te contacta para el reembolso.</HeroNote>
        ) : null}
      </HeroFrame>
    )
  }

  if (order.status === 'delivered') {
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>Pedido entregado</HeroTitle>
        <HeroNote>Buen provecho.</HeroNote>
      </HeroFrame>
    )
  }

  // El tramo largo: confirmado pero la cocina todavía no lo tocó (recién
  // arranca cerca de `fireAt`, que acá no se expone — el cliente no necesita
  // saber CUÁNDO entra a cocina, solo que su hora sigue en pie). Una vez que
  // pasa a `preparing` esto converge solo con el resto del componente: el
  // efecto de arriba ya recalcula `minutesUntil(etaAt)` con `etaAt =
  // scheduledFor`, así que la cuenta regresiva de siempre vuelve a tener
  // sentido sin un branch extra.
  if (isScheduled && (order.status === 'pending' || order.status === 'confirmed')) {
    const reserveNote =
      order.paymentMethod === 'transfer'
        ? order.transferReceiptUploadedAt
          ? 'Ya recibimos tu comprobante — cuando el local lo confirme, tu horario queda reservado.'
          : 'Transferí para reservar tu horario.'
        : 'Confirmá el pago para reservar tu horario.'
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle className="text-3xl leading-tight">Programado para {formatScheduledLabel(order.scheduledFor!, timezone)}</HeroTitle>
        <HeroNote>
          {order.status === 'pending'
            ? reserveNote
            : 'Todavía no empezamos a prepararlo — arrancamos cerca de la hora que elegiste.'}
        </HeroNote>
      </HeroFrame>
    )
  }

  if (order.status === 'pending') {
    // Pago online todavía no confirmado: el ETA se recalcula recién al
    // aprobarse (ver CLAUDE.md, "Multiplicador de demanda"), así que hasta
    // entonces no hay un número honesto que mostrar. (Un pedido con pago en
    // el local nace `confirmed`, así que acá es siempre online o
    // transferencia.) La segunda línea existe para la pregunta que se hace
    // todo el que vuelve a abrir el link: "¿tengo que hacer algo?".
    if (order.paymentMethod === 'transfer') {
      return order.transferReceiptUploadedAt ? (
        <HeroFrame status={order.status} animate={animate}>
          <HeroTitle>Estamos verificando tu transferencia</HeroTitle>
          <HeroNote>El local revisa el comprobante y te confirma acá. No hace falta que hagas nada.</HeroNote>
        </HeroFrame>
      ) : (
        <HeroFrame status={order.status} animate={animate}>
          <HeroTitle>Esperando tu transferencia</HeroTitle>
          <HeroNote>Transferí y subí el comprobante más abajo — con eso el local confirma tu pedido.</HeroNote>
        </HeroFrame>
      )
    }
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>Esperando la confirmación del pago</HeroTitle>
        <HeroNote>
          {order.canResumePayment
            ? 'Si ya pagaste, en un momento se confirma solo. Si te quedó pendiente, más abajo podés ir a pagar.'
            : 'Si ya pagaste, en un momento se confirma solo.'}
        </HeroNote>
      </HeroFrame>
    )
  }

  if (order.status === 'ready') {
    if (isDelivery) {
      // "Listo" y "llega" no son lo mismo: en delivery el ETA ya incluye el
      // viaje del repartidor, así que prometer "listo" sería decir que puede
      // pasar a buscarlo cuando en realidad se lo llevan.
      return (
        <HeroFrame status={order.status} animate={animate}>
          <HeroTitle>Listo para salir</HeroTitle>
          <HeroNote>{etaTime ? `Sale en un momento — llega aprox. a las ${etaTime}.` : 'Sale en un momento.'}</HeroNote>
        </HeroFrame>
      )
    }
    // El `shortCode` existe para cantarlo en el mostrador, y ÉSTE es el
    // momento en que sirve: hasta acá vivía solo en la línea chica de arriba.
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>Tu pedido está listo</HeroTitle>
        <HeroNote>
          Pasá a buscarlo. En el mostrador decí el código{' '}
          <span className="tabular text-foreground font-semibold">{order.shortCode}</span>.
        </HeroNote>
        {order.readyAt ? <HeroNote className="text-xs">Listo desde las {formatTime(order.readyAt, timezone)}</HeroNote> : null}
      </HeroFrame>
    )
  }

  if (order.status === 'on_the_way') {
    const arrival = etaTime ? `llega aprox. a las ${etaTime}.` : null
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>Tu pedido está en camino</HeroTitle>
        {order.courierFirstName ? (
          <HeroNote>
            {order.courierFirstName} lo lleva{arrival ? ` — ${arrival}` : '.'}
          </HeroNote>
        ) : arrival ? (
          <HeroNote>{arrival.charAt(0).toUpperCase() + arrival.slice(1)}</HeroNote>
        ) : null}
      </HeroFrame>
    )
  }

  // `confirmed` o `preparing` sin ETA no debería pasar (el ETA se congela al
  // crear o al aprobarse el pago), pero si pasa el titular sigue siendo cierto.
  if (!etaTime) {
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle>{STATUS_LABEL[order.status]}</HeroTitle>
      </HeroFrame>
    )
  }

  // Ya pasó la hora prometida y la cocina sigue con el pedido: decirlo es
  // mejor que dejar "Listo aprox. a las 22:35" colgado a las 22:50.
  if (remainingMinutes === 0) {
    return (
      <HeroFrame status={order.status} animate={animate}>
        <HeroTitle className="text-3xl">Ya casi</HeroTitle>
        <HeroNote>Está tardando un poco más de lo previsto.</HeroNote>
      </HeroFrame>
    )
  }

  // El primer render de un programado en `preparing` llega con `etaMinutes`
  // null (nunca se midió) y el efecto lo corrige al instante: mientras tanto
  // el titular es el estado, no un número inventado.
  return (
    <HeroFrame status={order.status} animate={animate}>
      {remainingMinutes !== null ? (
        <p className="display tabular text-foreground text-6xl leading-none font-semibold whitespace-nowrap">
          {remainingMinutes}
          <span className="text-muted-foreground ml-2 text-xl font-normal">min</span>
        </p>
      ) : (
        <HeroTitle>{STATUS_LABEL[order.status]}</HeroTitle>
      )}
      <HeroNote>
        {isDelivery ? 'Llega' : 'Listo'} aprox. a las {etaTime}
      </HeroNote>
    </HeroFrame>
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
  whatsappPhoneE164 = null,
}: {
  token: string
  initialOrder: OrderPublicView
  timezone?: string
  /** El WhatsApp del LOCAL — el escape hatch de `TransferPanel` para "subí cualquier cosa". */
  whatsappPhoneE164?: string | null
}) {
  const [order, setOrder] = React.useState(initialOrder)

  // Memoria de la última transición VISTA en esta pestaña. Se ajusta durante
  // el render (no en un efecto) para que el frame que pinta el estado nuevo
  // ya lleve la animación: un efecto llegaría un frame tarde y el paso se
  // vería saltar antes de animarse. Arranca en `null` a propósito —abrir el
  // link no es una transición— y eso es lo que evita que la pantalla se anime
  // en cada una de las tres o cuatro visitas que hace quien espera.
  const [seenStatus, setSeenStatus] = React.useState(initialOrder.status)
  const [previousStatus, setPreviousStatus] = React.useState<OrderStatus | null>(null)
  if (order.status !== seenStatus) {
    setPreviousStatus(seenStatus)
    setSeenStatus(order.status)
  }

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

  // Las horas que la vista pública conoce, al lado del paso que marcan. Es lo
  // que deja retomar el hilo después de una interrupción: "¿esto avanzó
  // mientras no miraba?" se contesta leyendo, no adivinando. `paidAt` vale
  // como hora de confirmación SOLO cuando pagar ES confirmar (online y
  // transferencia); con pago en el local el cobro puede ser después de listo,
  // así que ahí no se muestra nada antes que mostrar una hora falsa.
  const stepTimestamps: Partial<Record<OrderStatus, string>> = {}
  if (order.paymentMethod !== 'in_store' && order.paidAt) stepTimestamps.confirmed = formatTime(order.paidAt, timezone)
  if (order.readyAt) stepTimestamps.ready = formatTime(order.readyAt, timezone)

  const inProgress = !isTerminalStatus(order.status)

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="sr-only">Seguimiento del pedido #{order.shortCode}</h1>
      <p className="text-muted-foreground text-xs">
        Pedido #{order.shortCode} en {order.storeName} · hecho a las {formatTime(order.createdAt, timezone)}
      </p>

      {/* Una sola región viva para el estado, y anuncia UNA frase por
          transición. Antes la tarjeta entera era `aria-live`, así que cada
          minuto que bajaba el contador se volvía a leer todo el hero. */}
      <p className="sr-only" role="status">
        {statusSentence(order, timezone)}
      </p>

      <Panel className="p-5">
        <EtaHero order={order} timezone={timezone} previousStatus={previousStatus} />
      </Panel>

      <Panel className="p-5">
        <OrderSteps
          status={order.status}
          deliveryMethod={order.deliveryMethod}
          courierFirstName={order.courierFirstName}
          timestamps={stepTimestamps}
          previousStatus={previousStatus}
          live={inProgress}
          announce={false}
        />
      </Panel>

      {/* Cocina y dinero son dos relojes: el aviso de pago queda por fuera de
          la tarjeta de pasos a propósito, para no sugerir que uno depende
          del otro. */}
      <div aria-live="polite" className="contents">
        <PaymentNotice
          paymentStatus={order.paymentStatus}
          paymentMethod={order.paymentMethod}
          transferReceiptUploadedAt={order.transferReceiptUploadedAt}
          action={order.canResumePayment ? <ResumePaymentButton token={token} /> : null}
        />
      </div>

      {/* Solo mientras el pedido sigue `pending`: apenas el staff confirma el
          pago, `status` pasa a `confirmed` a la vez que `paymentStatus` pasa a
          `approved`, así que este único chequeo cubre "ya confirmado" y
          "cancelado" a la vez — no hace falta mirar `paymentStatus` acá. */}
      {order.paymentMethod === 'transfer' && order.status === 'pending' ? (
        <TransferPanel order={order} token={token} whatsappPhoneE164={whatsappPhoneE164} onOrderChange={setOrder} />
      ) : null}

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
          {/* Solo si hubo cupón: mismo criterio que el checkout, entre subtotal
              y envío. El total ya lo trae calculado el servidor — acá no se
              resta nada, solo se explica de dónde salió (00-architecture.md
              §5.14.4): un total que no cierra con los ítems es lo que este
              cliente vería sin esta línea. */}
          {order.discountCents > 0 && order.couponCodeSnapshot ? (
            <div className="text-primary flex items-baseline justify-between">
              <span>Descuento {order.couponCodeSnapshot}</span>
              <span className="tabular">
                −<Price cents={order.discountCents} currency={order.currency} />
              </span>
            </div>
          ) : null}
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
