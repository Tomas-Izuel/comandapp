'use client'

import * as React from 'react'
import Link from 'next/link'
import { Bike } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'
import { Panel, StatusPill } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { STATUS_LABEL } from '@/views/shared/order-status'
import { getSavedOrders, type SavedOrderRef } from '@/lib/cart'
import { formatDateTime } from '@/lib/dates'
import { storeBasePath } from '@/lib/urls'
import type { OrderPublicView } from '@/models/types'
import type { OrderStatus } from '@/models/schemas/order.schema'

/**
 * Tono del pill por estado: "En camino" tiene que notarse en una lista de
 * pedidos viejos tanto como en el seguimiento — es el momento en que el
 * cliente más vuelve a mirar esta pantalla.
 */
function statusTone(status: OrderStatus): 'neutral' | 'live' | 'warning' | 'danger' | 'done' {
  if (status === 'cancelled') return 'danger'
  if (status === 'delivered') return 'done'
  if (status === 'on_the_way') return 'live'
  return 'neutral'
}

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
export function MyOrders({ host }: { host: string | null }) {
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
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="display text-foreground text-2xl font-semibold sm:text-3xl">Mis pedidos</h1>

      <div className="flex flex-col gap-3">
        {rows.map(({ ref, order }) => {
          // Sin Provider acá (fuera de `/[store]`), así que se resuelve por
          // fila con la misma función que usa el layout de la tienda: `''`
          // si ESTE host ya es el subdominio de `ref.storeSlug` ("Reiterar"
          // vuelve al home del mismo origen, `/?reorder=...`), `` /${slug} ``
          // en cualquier otro caso (apex, local, preview, u otra tienda).
          const basePath = storeBasePath(ref.storeSlug, host)
          const reorderHref = basePath === '' ? `/?reorder=${ref.token}` : `${basePath}?reorder=${ref.token}`
          return (
            <Panel key={ref.token} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-sm font-medium">
                    Pedido #{ref.shortCode} · {order?.storeName ?? ref.storeSlug}
                  </p>
                  <p className="text-muted-foreground text-xs">{formatDateTime(ref.createdAt, DEFAULT_TIMEZONE)}</p>
                  {/* Retiro vs. delivery, a simple vista: son dos experiencias
                      distintas después de pagar (ir a buscarlo vs. esperar en
                      casa) y la lista no lo distinguía. */}
                  <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    {order?.deliveryMethod === 'delivery' ? (
                      <>
                        <Bike className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          Delivery{order.deliveryAddress ? ` a ${order.deliveryAddress.line}` : ''}
                        </span>
                      </>
                    ) : order ? (
                      <span>Retiro en el local</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {order ? <Price cents={order.totalCents} currency={order.currency} className="tabular text-sm font-medium" /> : null}
                  {order ? (
                    <StatusPill tone={statusTone(order.status)}>{STATUS_LABEL[order.status]}</StatusPill>
                  ) : (
                    <p className="text-muted-foreground text-xs">No disponible</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2.5">
                {/* h-11: piso de 44px para todo lo tocable. `size="sm"` (36px)
                    no llega. */}
                <Button asChild size="sm" variant="outline" className="h-11 rounded-pill">
                  <Link href={`/pedido/${ref.token}`}>Ver seguimiento</Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="h-11 rounded-pill">
                  <Link href={reorderHref}>Reiterar</Link>
                </Button>
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
