'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'
import { Price } from '@/views/shared/money'
import { STATUS_LABEL } from '@/views/shared/order-status'
import { getSavedOrders, type SavedOrderRef } from '@/lib/cart'
import { formatDateTime } from '@/lib/dates'
import type { OrderPublicView } from '@/models/types'

/**
 * Todas las tiendas del producto operan en Argentina (ver PRODUCT.md). Esta
 * vista no tiene el `Store` de cada pedido a mano —solo `OrderPublicView`,
 * que no lleva `timezone`— así que no hay forma de formatear en la zona real
 * de CADA local sin agregar ese campo al contrato. Reportado: si algún local
 * opera en otra zona el día que existan varias, esto queda corrido.
 */
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

type Row = { ref: SavedOrderRef; order: OrderPublicView | null }

/**
 * Historial sin cuenta: vive enteramente de lo que `saveOrderRef` fue
 * guardando en localStorage. Sin eso no hay forma de recuperar nada — el
 * producto lo asume (ver PRODUCT.md: "no se resuelve pidiendo login").
 */
export function MyOrders() {
  const [refs, setRefs] = React.useState<SavedOrderRef[] | null>(null)
  const [orders, setOrders] = React.useState<Map<string, OrderPublicView>>(new Map())

  React.useEffect(() => {
    // localStorage es del cliente: arrancamos en null (igual que el SSR) y
    // recién leemos acá, después del primer render, para no desincronizar
    // del HTML hidratado.
    const saved = getSavedOrders()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRefs(saved)
    if (saved.length === 0) return

    fetch('/api/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: saved.map((r) => r.token) }),
    })
      .then((res) => res.json())
      .then((body: { orders?: OrderPublicView[] }) => {
        setOrders(new Map((body.orders ?? []).map((o) => [o.publicToken, o])))
      })
      .catch(() => {
        // Sin conexión: seguimos mostrando las referencias guardadas, sin detalle.
      })
  }, [])

  if (refs === null) return null

  if (refs.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        title="Todavía no hiciste ningún pedido"
        description="Cuando pidas en algún local, tus pedidos van a aparecer acá."
      />
    )
  }

  const rows: Row[] = refs.map((ref) => ({ ref, order: orders.get(ref.token) ?? null }))

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <h1 className="display text-3xl uppercase">Mis pedidos</h1>

      <div className="flex flex-col gap-px">
        {rows.map(({ ref, order }) => (
          <div key={ref.token} className="border-border flex flex-col gap-2 border-t py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium">
                  Pedido #{ref.shortCode} · {order?.storeName ?? ref.storeSlug}
                </p>
                <p className="text-muted-foreground text-xs">{formatDateTime(ref.createdAt, DEFAULT_TIMEZONE)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {order ? <Price cents={order.totalCents} currency={order.currency} className="tabular text-sm font-medium" /> : null}
                <p className="text-muted-foreground text-xs uppercase tracking-[0.08em]">
                  {order ? STATUS_LABEL[order.status] : 'No disponible'}
                </p>
              </div>
            </div>

            <div className="flex gap-2.5">
              <Button asChild size="sm" variant="outline" className="h-9">
                <Link href={`/pedido/${ref.token}`}>Ver seguimiento</Link>
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-9">
                <Link href={`/${ref.storeSlug}?reorder=${ref.token}`}>Reiterar</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
