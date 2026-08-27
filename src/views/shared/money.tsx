import { formatCentsCompact, formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Precio. Siempre con numerales tabulares: en una lista de productos las cifras
 * tienen que formar columna, o el ojo no puede comparar.
 *
 * En ARS los centavos no existen en la práctica, así que por defecto no se
 * muestran. `exact` los fuerza para totales de pedido y comprobantes.
 */
export function Price({
  cents,
  currency = 'ARS',
  exact = false,
  className,
}: {
  cents: number
  currency?: string
  exact?: boolean
  className?: string
}) {
  const text = exact ? formatCents(cents, currency) : formatCentsCompact(cents, currency)
  return <span className={cn('tabular', className)}>{text}</span>
}
