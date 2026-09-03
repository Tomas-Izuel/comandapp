import { cn } from '@/lib/utils'
import { StatusPill, StepMark } from '@/views/shared/surfaces'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/models/schemas/order.schema'
import type { DeliveryMethod, OrderStatus, PaymentMethod, PaymentStatus } from '@/models/schemas/order.schema'

/**
 * Cocina y dinero son dos relojes. Con pago en el local un pedido puede estar
 * listo y todavía impago, así que estos componentes NUNCA infieren uno del otro.
 */

/** Retiro: exactamente el recorrido de siempre, sin el tramo de envío. */
const PICKUP_STEPS = [
  'confirmed',
  'preparing',
  'ready',
  'delivered',
] as const satisfies readonly OrderStatus[]

/** Delivery: un paso más — la comida sale de la cocina y viaja antes de llegar. */
const DELIVERY_STEPS = [
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
] as const satisfies readonly OrderStatus[]

/**
 * Re-exportado para no romper a los consumidores existentes: este mapa estaba
 * duplicado acá, en el modelo y en el tablero de cocina, con textos distintos
 * para el mismo estado. `ORDER_STATUS_LABELS` es ahora la única fuente.
 */
export { ORDER_STATUS_LABELS as STATUS_LABEL }

/**
 * Los pasos del pedido, como los muestra cualquier app de pedido: cumplido con
 * tilde, actual lleno, pendiente hueco.
 *
 * Vertical a propósito. La versión horizontal obliga a abreviar cada etiqueta
 * hasta que "En preparación" queda en "Prep."; en vertical entra el nombre
 * entero y, cuando existe, la hora en que pasó. Y el estado se lee sin color:
 * son tres formas distintas, no tres tonos del mismo círculo.
 */
export function OrderSteps({
  status,
  deliveryMethod,
  courierFirstName,
  timestamps,
  previousStatus,
  live = false,
  announce = true,
  className,
}: {
  status: OrderStatus
  deliveryMethod: DeliveryMethod
  /**
   * Solo importa mientras `status === 'on_the_way'`: ahí reemplaza el rótulo
   * genérico del paso por algo humano. Fuera de ese estado no se usa —una vez
   * entregado, el paso vuelve a leerse como historial ("En camino"), no como
   * "Fulano está llevando tu pedido" de algo que ya pasó.
   */
  courierFirstName?: string | null
  timestamps?: Partial<Record<OrderStatus, string>>
  /**
   * Opt-in al motion de TRANSICIÓN (el segundo momento autorizado del
   * producto, ver globals.css). Pasarlo —aunque sea `null`— prende el tramo
   * que se llena entre pasos; cuando además trae el estado anterior y difiere
   * del actual, los pasos que cambiaron de forma se estampan / aterrizan una
   * sola vez. Quien lo pasa es el dueño de saber qué estado había antes: este
   * componente no tiene memoria a propósito, así se puede seguir renderizando
   * del lado del servidor. Sin el prop, se comporta exactamente como antes.
   */
  previousStatus?: OrderStatus | null
  /**
   * Anillo que respira en el paso actual mientras el pedido sigue en curso:
   * "esto está vivo". Solo para superficies que se actualizan solas —el
   * seguimiento del cliente—, no para historiales ni demos.
   */
  live?: boolean
  /**
   * La región `aria-live` propia. En `false` para que un consumidor que ya
   * anuncia el cambio de estado con una frase entera no lo haga sonar dos
   * veces.
   */
  announce?: boolean
  className?: string
}) {
  if (status === 'cancelled') {
    return (
      <div className={className}>
        <StatusPill tone="danger">Pedido cancelado</StatusPill>
      </div>
    )
  }

  const steps = deliveryMethod === 'delivery' ? DELIVERY_STEPS : PICKUP_STEPS
  const currentIndex = steps.findIndex((step) => step === status)
  const animated = previousStatus !== undefined
  // `-1` cuando el anterior era `pending` (o no está en la lista): todos los
  // pasos venían huecos, así que el primero que se llena cuenta como cambio.
  const previousIndex =
    animated && previousStatus !== null && previousStatus !== status
      ? steps.findIndex((step) => step === previousStatus)
      : null

  /**
   * Con delivery, "Listo" ambiguo: para el cliente lee como "andá a
   * buscarlo", pero acá significa "salió de la cocina, todavía tiene que
   * viajar". Se corrige solo en esta variante — en retiro "Listo" es
   * exactamente correcto y no se toca.
   */
  function labelFor(step: OrderStatus): string {
    if (step === 'on_the_way' && status === 'on_the_way') {
      return courierFirstName ? `${courierFirstName} está llevando tu pedido` : 'Tu pedido está en camino'
    }
    if (deliveryMethod === 'delivery' && step === 'ready') return 'Listo para salir'
    return ORDER_STATUS_LABELS[step]
  }

  return (
    <div className={className}>
      <ol className="flex flex-col" aria-label="Estado del pedido">
        {steps.map((step, index) => {
          const state = stepState(currentIndex, index)
          const changed = previousIndex !== null && stepState(previousIndex, index) !== state
          const isLast = index === steps.length - 1
          return (
            <li key={step} className="flex gap-3">
              <div className="flex flex-col items-center">
                {/* `key={state}` remonta el marcador cuando cambia de forma:
                    así la animación corre en CADA transición y no solo la
                    primera vez que la clase aparece. El anillo vive en un
                    `::after` del wrapper —`StepMark` no se toca— para que el
                    punto en sí quede quieto mientras el anillo respira. */}
                <span
                  key={state}
                  className={cn(
                    'flex',
                    changed && state === 'done' && 'step-complete',
                    changed && state === 'current' && 'step-arrive',
                    live && state === 'current' && 'step-live',
                  )}
                >
                  <StepMark state={state} />
                </span>
                {/* El tramo que une dos pasos se pinta cumplido solo cuando el
                    de ABAJO ya pasó: si se pintara desde el actual, la línea
                    prometería un paso que la cocina todavía no dio. */}
                {!isLast ? (
                  <span
                    className={cn(
                      'w-0.5 flex-1 rounded-pill',
                      animated ? 'step-connector' : currentIndex > index ? 'bg-primary' : 'bg-border',
                    )}
                    data-done={animated ? currentIndex > index : undefined}
                    aria-hidden
                  />
                ) : null}
              </div>
              <div className={cn('flex min-w-0 flex-1 items-baseline justify-between gap-3', isLast ? 'pb-0' : 'pb-6')}>
                <span
                  className={cn(
                    'text-sm',
                    state === 'current' && 'text-foreground font-semibold',
                    state === 'done' && 'text-foreground',
                    state === 'todo' && 'text-muted-foreground',
                  )}
                >
                  {labelFor(step)}
                </span>
                {timestamps?.[step] ? (
                  <span className="tabular text-muted-foreground shrink-0 text-xs">{timestamps[step]}</span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      {announce ? (
        <p className="sr-only" aria-live="polite">
          {labelFor(status)}
        </p>
      ) : null}
    </div>
  )
}

function stepState(currentIndex: number, index: number): 'done' | 'current' | 'todo' {
  return currentIndex > index ? 'done' : currentIndex === index ? 'current' : 'todo'
}

/**
 * El texto del estado del dinero. Antes era un ternario binario
 * (`in_store` vs. el resto): con transferencia, "el resto" mostraba el label
 * genérico de `payment_status` ("Pago pendiente"), que no dice qué tiene que
 * HACER el cliente. Separado en una función para no anidar un tercer nivel de
 * ternario adentro del componente.
 */
function paymentNoticeText(
  paymentMethod: PaymentMethod,
  paymentStatus: PaymentStatus,
  transferReceiptUploadedAt: string | null,
): string {
  if (paymentMethod === 'in_store') return 'Pagás al retirar'
  if (paymentMethod === 'transfer') {
    return transferReceiptUploadedAt ? 'Estamos verificando tu transferencia' : 'Transferí para confirmar tu pedido'
  }
  return PAYMENT_STATUS_LABELS[paymentStatus]
}

/**
 * Estado del dinero. Solo se muestra cuando hay algo que decir.
 *
 * `action` es el slot para el botón "Ir a pagar" que el seguimiento cuelga
 * cuando el pedido sigue `pending` y es online: este componente se queda
 * puramente presentacional, la lógica de resumir el pago es del consumidor.
 */
export function PaymentNotice({
  paymentStatus,
  paymentMethod,
  transferReceiptUploadedAt = null,
  action,
  className,
}: {
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  /**
   * Solo cambia algo para `paymentMethod === 'transfer'`: distingue "todavía
   * no subiste nada" de "ya subiste, lo estamos revisando". El KDS (T5) no
   * lo pasa — no lo necesita, y el default `null` deja el texto de "transferí
   * para confirmar" que ya era razonable antes de este campo existir.
   */
  transferReceiptUploadedAt?: string | null
  action?: React.ReactNode
  className?: string
}) {
  if (paymentStatus === 'approved') return null

  const text = paymentNoticeText(paymentMethod, paymentStatus, transferReceiptUploadedAt)
  const isProblem = paymentStatus === 'rejected' || paymentStatus === 'refunded'

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <StatusPill tone={isProblem ? 'danger' : 'warning'} dot>
        {text}
      </StatusPill>
      {action}
    </div>
  )
}
