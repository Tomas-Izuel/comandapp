import { Panel } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import type { PlatformMetrics } from '@/models/types'

/**
 * Deliberadamente NO es la plantilla hero-métrica (número grande + label
 * chico + stats de apoyo). Son cuatro lecturas del mismo peso tipográfico: el
 * orden de lectura ordena la importancia, no el tamaño de la fuente.
 */
export function PlatformMetricsList({ metrics }: { metrics: PlatformMetrics }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Tiendas activas', value: `${metrics.activeStores} de ${metrics.totalStores}` },
    { label: 'Pedidos hoy', value: metrics.ordersToday },
    { label: 'Pedidos últimos 30 días', value: metrics.ordersLast30 },
    { label: 'Facturación últimos 30 días', value: <Price cents={metrics.revenueLast30Cents} /> },
  ]

  return (
    <Panel elevated={false}>
      <dl className="divide-border divide-y">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 px-5 py-4">
            <dt className="text-muted-foreground text-sm">{row.label}</dt>
            <dd className="tabular text-xl font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
