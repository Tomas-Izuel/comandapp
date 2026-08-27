import { ORDER_STATUSES, type OrderStatus } from '@/models/schemas/order.schema'
import { STATUS_LABEL } from '@/views/shared/order-status'

export function OrdersByStatusBreakdown({ counts }: { counts: Record<OrderStatus, number> }) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const max = Math.max(1, ...Object.values(counts))

  if (total === 0) {
    return <p className="text-muted-foreground text-sm">Sin pedidos en este período.</p>
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {ORDER_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <li key={status} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm">
          <span className="text-muted-foreground truncate">{STATUS_LABEL[status]}</span>
          <div className="bg-muted h-2 w-full rounded-full">
            <div
              className="bg-foreground/70 h-2 rounded-full"
              style={{ width: `${Math.max(3, (counts[status] / max) * 100)}%` }}
            />
          </div>
          <span className="tabular text-right font-medium">{counts[status]}</span>
        </li>
      ))}
    </ul>
  )
}
