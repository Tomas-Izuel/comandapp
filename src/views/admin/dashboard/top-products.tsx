import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import type { TopProduct } from '@/models/types'

/**
 * Ranking, no grilla de tarjetas: cada fila es un producto, la barra
 * proporcional carga la magnitud (cantidad vendida) y el precio va como
 * etiqueta directa al lado — nunca un segundo eje.
 */
export function TopProducts({ products, currency }: { products: TopProduct[]; currency: string }) {
  if (products.length === 0) {
    return <EmptyState title="Sin ventas todavía" description="Los productos más pedidos van a aparecer acá." className="py-8" />
  }

  const max = Math.max(...products.map((p) => p.quantity))

  return (
    <ol className="flex flex-col gap-3">
      {products.map((product, index) => (
        <li
          key={product.productId ?? product.name}
          className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 lg:grid-cols-[1.75rem_1fr_auto]"
        >
          <span className="text-muted-foreground tabular text-right text-xs lg:text-sm">{index + 1}</span>
          <div className="min-w-0">
            <p className="truncate text-sm lg:text-base">{product.name}</p>
            <div className="bg-muted mt-1.5 h-1.5 w-full rounded-pill">
              <div
                className="bg-chart-1 h-1.5 rounded-pill"
                style={{ width: `${Math.max(4, (product.quantity / max) * 100)}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <p className="tabular text-sm font-medium lg:text-base">{product.quantity}×</p>
            <Price cents={product.revenueCents} currency={currency} className="text-muted-foreground text-xs lg:text-sm" />
          </div>
        </li>
      ))}
    </ol>
  )
}
