'use client'

import { WhatsApp } from '@/components/ui/whatsapp'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { whatsappHref } from '@/lib/whatsapp'
import { describeDiscount, isCouponUsable } from '@/lib/coupon'
import { buildCustomerCouponMessage, buildCustomerWhatsappMessage } from '@/views/admin/clientes/whatsapp-message'
import type { Coupon, StoreCustomer } from '@/models/types'

/**
 * El botón de WhatsApp del padrón, con el tercer mensaje sumado (§5.5.1,
 * criterio de aceptación 0 de T4B): un menú con los cupones canjeables del
 * local, y el elegido entra en el texto precargado.
 *
 * **`status === 'active'` no es lo mismo que canjeable.** `page.tsx` filtra
 * por lo que el dueño prendió, pero `expired`/`exhausted` son estados
 * DERIVADOS (`couponState()` en `src/lib/coupon.ts`, a partir de `endsAt` y
 * de los contadores) que no viven en la base — así que acá, con los mismos
 * datos que ya llegan en la fila, se vuelve a filtrar por `isCouponUsable()`.
 * Sin este segundo filtro el dueño manda un código que el checkout va a
 * rechazar, y el cliente se entera en el peor momento (hallazgo 7 del review
 * de Entrega B).
 *
 * **Sin cupones usables, esto es el mismo botón de siempre** — un link
 * directo a `wa.me` con el mensaje por default, SIN menú. "El menú no se
 * ofrece si no hay ninguno: un menú vacío es peor que ningún menú"
 * (`src-views-admin-clientes-directory-table-tsx.md`). Se prefirió esto a
 * mostrar el cupón vencido/agotado deshabilitado con motivo: el motivo real
 * ("venció", "se agotó") ya lo cuenta la hoja de detalle del cupón, y acá
 * agregaría un ítem más para explicar algo que no se puede mandar de todos
 * modos.
 *
 * `href: null` (baja de promos, o sin teléfono) sigue mostrando el botón
 * apagado, igual que antes de este cambio: la baja es del cliente, no del
 * canal, y un botón que desaparece no explica nada.
 */
export function CouponWhatsappMenu({
  customer,
  storeName,
  storeSlug,
  activeCoupons,
  disabled,
}: {
  customer: StoreCustomer
  storeName: string
  storeSlug: string
  activeCoupons: Coupon[]
  /** `true` cuando el cliente se dio de baja de promos: el botón se apaga entero, sin menú. */
  disabled: boolean
}) {
  const defaultLabel = disabled
    ? `${customer.displayName} se dio de baja de promos`
    : `Escribirle a ${customer.displayName} por WhatsApp`

  if (disabled) {
    return (
      <Button type="button" variant="outline" size="icon" disabled aria-label={defaultLabel}>
        <WhatsApp className="size-4" aria-hidden />
      </Button>
    )
  }

  const defaultHref = whatsappHref(customer.phoneE164, buildCustomerWhatsappMessage(customer, storeName, storeSlug))
  const usableCoupons = activeCoupons.filter((c) => isCouponUsable(c))

  // Sin cupones usables: el link directo de siempre, ni un menú de un solo ítem.
  if (usableCoupons.length === 0) {
    return (
      <Button asChild variant="outline" size="icon">
        <a href={defaultHref} aria-label={defaultLabel} target="_blank" rel="noreferrer">
          <WhatsApp className="size-4" aria-hidden />
        </a>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={`Elegir mensaje de WhatsApp para ${customer.displayName}`}>
          <WhatsApp className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={defaultHref} target="_blank" rel="noreferrer">
            Mensaje simple
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Mandarle un cupón</DropdownMenuLabel>
        {usableCoupons.map((coupon) => (
          <DropdownMenuItem key={coupon.id} asChild>
            <a
              href={whatsappHref(customer.phoneE164, buildCustomerCouponMessage(customer, storeName, storeSlug, coupon))}
              target="_blank"
              rel="noreferrer"
              className="flex-col items-start!"
            >
              <span className="font-mono text-xs font-semibold">{coupon.code}</span>
              <span className="text-muted-foreground text-xs">{describeDiscount(coupon)}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
