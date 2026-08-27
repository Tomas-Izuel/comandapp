'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useCart } from '@/lib/cart'
import type { MenuCategory } from '@/models/types'
import type { OrderPublicView } from '@/models/types'

/**
 * "Reiterar": no dibuja nada. Si la URL trae `?reorder=<token>` (lo pone el
 * botón "Reiterar" de /mis-pedidos), busca ese pedido, agrega al carrito lo
 * que sigue disponible en la carta ACTUAL y avisa qué quedó afuera. Nunca
 * confía en los precios del pedido viejo: solo usa `productId`/`optionIds`,
 * y el precio real sale de nuevo del catálogo vigente en el checkout.
 */
export function ReorderHandler({ categories }: { categories: MenuCategory[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { addLine } = useCart()
  const ranFor = React.useRef<string | null>(null)

  const token = searchParams.get('reorder')

  React.useEffect(() => {
    if (!token || ranFor.current === token) return
    ranFor.current = token

    async function run() {
      try {
        const res = await fetch(`/api/orders/${token}`)
        if (!res.ok) {
          toast.error('No encontramos ese pedido para reiterarlo')
          return
        }
        const { order }: { order: OrderPublicView } = await res.json()

        const productsById = new Map(categories.flatMap((c) => c.products).map((p) => [p.id, p]))

        let added = 0
        const missing: string[] = []

        for (const item of order.items) {
          const product = item.productId != null ? productsById.get(item.productId) : undefined
          if (!product || !product.isAvailable) {
            missing.push(item.nameSnapshot)
            continue
          }

          const optionsByGroup = new Map(product.optionGroups.map((g) => [g.id, g]))
          const currentOptionIds = new Set(product.optionGroups.flatMap((g) => g.options.filter((o) => o.isAvailable).map((o) => o.id)))
          const requestedOptionIds = item.options.map((o) => o.optionId).filter((id): id is number => id != null)
          const validOptionIds = requestedOptionIds.filter((id) => currentOptionIds.has(id))

          // Si alguna opción elegida ya no existe/está disponible, o el grupo
          // dejó de cumplir su mínimo, tratamos el ítem entero como "no se
          // pudo agregar tal cual estaba" en vez de adivinar un reemplazo.
          const groupsStillValid = product.optionGroups.every((group) => {
            if (!optionsByGroup.has(group.id)) return true
            const chosen = validOptionIds.filter((id) => group.options.some((o) => o.id === id))
            return chosen.length >= group.minSelect
          })

          if (validOptionIds.length !== requestedOptionIds.length || !groupsStillValid) {
            missing.push(item.nameSnapshot)
            continue
          }

          addLine({ productId: product.id, quantity: item.quantity, optionIds: validOptionIds, notes: item.notes })
          added += 1
        }

        const total = order.items.length
        if (added === total) {
          toast.success(
            total === 1
              ? 'Agregamos el ítem de tu pedido anterior'
              : `Agregamos los ${total} ítems de tu pedido anterior`,
          )
        } else if (added > 0) {
          toast.warning(`${added} de ${total} ítems se agregaron`, {
            description: `"${missing.join('", "')}" ya no ${missing.length > 1 ? 'están disponibles' : 'está disponible'}.`,
          })
        } else {
          toast.error('Ningún ítem de ese pedido sigue disponible')
        }
      } catch {
        toast.error('No pudimos reiterar el pedido')
      } finally {
        const next = new URLSearchParams(searchParams)
        next.delete('reorder')
        const qs = next.toString()
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      }
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return null
}
