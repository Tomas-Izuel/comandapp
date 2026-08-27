'use client'

import { useMemo, useState } from 'react'
import { StatusPill } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/dates'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/models/schemas/order.schema'
import type { Order, OrderStatus, PaymentStatus } from '@/models/types'

const TABS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  ...ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
]

/** Tono del estado de cocina en la tabla: no es el de `PaymentNotice` (eso es dinero), este es cocina. */
const STATUS_TONE: Record<OrderStatus, 'neutral' | 'live' | 'warning' | 'danger' | 'done'> = {
  pending: 'warning',
  confirmed: 'live',
  preparing: 'live',
  ready: 'live',
  delivered: 'done',
  cancelled: 'danger',
}

const PAYMENT_TONE: Record<PaymentStatus, 'neutral' | 'warning' | 'danger' | 'done'> = {
  pending: 'warning',
  approved: 'done',
  rejected: 'danger',
  refunded: 'danger',
}

/**
 * Historial denso: tabla, no tarjetas. Responde "¿qué pasó con el pedido de
 * las 9?" en una fila —código, hora, cliente, qué pidió, cocina, dinero,
 * total— sin tener que abrir nada.
 */
export function OrderHistoryList({ orders, timezone }: { orders: Order[]; timezone: string }) {
  const [tab, setTab] = useState<OrderStatus | 'all'>('all')

  const counts = useMemo(() => {
    const map = new Map<OrderStatus, number>()
    for (const order of orders) map.set(order.status, (map.get(order.status) ?? 0) + 1)
    return map
  }, [orders])

  const filtered = tab === 'all' ? orders : orders.filter((o) => o.status === tab)

  return (
    <div className="flex flex-col gap-4">
      {/* `Tabs` de shadcn en vez de un `<div>` de botones sueltos: roles y
          navegación por teclado de tablist vienen resueltos por Radix. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as OrderStatus | 'all')}>
        <TabsList
          variant="line"
          className="h-auto w-full justify-start gap-1.5 overflow-x-auto bg-transparent p-0 [scrollbar-width:none]"
        >
          {TABS.map((t) => {
            const count = t.value === 'all' ? orders.length : (counts.get(t.value) ?? 0)
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="bg-muted text-muted-foreground data-active:bg-primary data-active:text-primary-foreground h-11 shrink-0 rounded-full border-none px-3.5 text-xs font-medium whitespace-nowrap shadow-none data-active:shadow-none"
              >
                {t.label} <span className="tabular ml-1">({count})</span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyState title="Sin pedidos" description="No hay pedidos que coincidan con este filtro." />
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">Historial de pedidos del local, más reciente primero</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs font-medium uppercase tracking-[0.04em]">
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Código
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Hora
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Pidió
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Cocina
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Pago
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {filtered.map((order) => {
                const itemsSummary = order.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(', ')
                return (
                  <tr key={order.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{order.shortCode || `#${order.id}`}</td>
                    <td className="text-muted-foreground tabular px-3 py-2.5 whitespace-nowrap">
                      {formatDateTime(order.createdAt, timezone)}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2.5">{order.customerName}</td>
                    <td className="text-muted-foreground max-w-64 truncate px-3 py-2.5" title={itemsSummary}>
                      {itemsSummary}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusPill tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</StatusPill>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusPill tone={PAYMENT_TONE[order.paymentStatus]}>
                        {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                      </StatusPill>
                    </td>
                    <td className={cn('px-3 py-2.5 text-right font-semibold whitespace-nowrap')}>
                      <Price cents={order.totalCents} currency={order.currency} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
