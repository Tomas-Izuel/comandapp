import { Panel } from '@/views/shared/surfaces'
import { cn } from '@/lib/utils'

/**
 * Fila de valores dentro de un único `Panel`, nunca una grilla de tarjetas
 * iguales ni la plantilla métrica-héroe (número gigante + label chico +
 * flechita). Acá los valores comparten peso tipográfico entre sí: ninguno es
 * "el" número de la página.
 *
 * `columns` es literal (2 o 3) a propósito: Tailwind v4 escanea clases
 * estáticas del código fuente, así que una clase armada con un template
 * (`sm:grid-cols-${n}`) no se emite.
 */
export function StatRow({
  items,
  columns,
  className,
}: {
  items: { label: string; value: string }[]
  columns: 2 | 3
  className?: string
}) {
  return (
    <Panel
      elevated={false}
      className={cn(
        'grid grid-cols-1 divide-y sm:divide-y-0 sm:divide-x',
        'divide-border',
        columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 px-4 py-3.5 lg:px-5 lg:py-4">
          <p className="text-muted-foreground text-xs font-medium lg:text-sm">{item.label}</p>
          <p className="tabular text-lg font-semibold lg:text-xl">{item.value}</p>
        </div>
      ))}
    </Panel>
  )
}
