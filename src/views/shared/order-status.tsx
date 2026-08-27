import { cn } from '@/lib/utils'
import { StatusPill, StepMark } from '@/views/shared/surfaces'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/models/schemas/order.schema'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/models/schemas/order.schema'

/**
 * Cocina y dinero son dos relojes. Con pago en el local un pedido puede estar
 * listo y todavía impago, así que estos componentes NUNCA infieren uno del otro.
 */

const KITCHEN_STEPS = [
  'confirmed',
  'preparing',
  'ready',
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
  timestamps,
  className,
}: {
  status: OrderStatus
  timestamps?: Partial<Record<OrderStatus, string>>
  className?: string
}) {
  if (status === 'cancelled') {
    return (
      <div className={className}>
        <StatusPill tone="danger">Pedido cancelado</StatusPill>
      </div>
    )
  }

  const currentIndex = KITCHEN_STEPS.findIndex((step) => step === status)

  return (
    <div className={className}>
      <ol className="flex flex-col" aria-label="Estado del pedido">
        {KITCHEN_STEPS.map((step, index) => {
          const state = currentIndex > index ? 'done' : currentIndex === index ? 'current' : 'todo'
          const isLast = index === KITCHEN_STEPS.length - 1
          return (
            <li key={step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepMark state={state} />
                {/* El tramo que une dos pasos se pinta cumplido solo cuando el
                    de ABAJO ya pasó: si se pintara desde el actual, la línea
                    prometería un paso que la cocina todavía no dio. */}
                {!isLast ? (
                  <span
                    className={cn(
                      'w-0.5 flex-1 rounded-full',
                      currentIndex > index ? 'bg-primary' : 'bg-border',
                    )}
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
                  {ORDER_STATUS_LABELS[step]}
                </span>
                {timestamps?.[step] ? (
                  <span className="tabular text-muted-foreground shrink-0 text-xs">{timestamps[step]}</span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {ORDER_STATUS_LABELS[status]}
      </p>
    </div>
  )
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
  action,
  className,
}: {
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  action?: React.ReactNode
  className?: string
}) {
  if (paymentStatus === 'approved') return null

  const text = paymentMethod === 'in_store' ? 'Pagás al retirar' : PAYMENT_STATUS_LABELS[paymentStatus]
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
