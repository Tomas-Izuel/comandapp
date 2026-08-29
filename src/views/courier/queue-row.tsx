import type { CourierOrder } from '@/models/types'

/**
 * Fila compacta de "lo que viene". Sin acciones a propósito: un solo pedido a
 * la vez es activo (`ActiveOrderCard`) — esto es memoria de lo que sigue, no
 * una segunda cola para tocar.
 */
export function QueueRow({ order }: { order: CourierOrder }) {
  return (
    <div className="bg-card border-border flex min-h-14 items-center gap-3 rounded-lg border px-3.5 py-2">
      <span className="tabular text-lg leading-none font-bold">{order.shortCode}</span>
      <span className="text-muted-foreground truncate text-sm">{order.address.line}</span>
    </div>
  )
}
