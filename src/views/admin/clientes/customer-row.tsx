'use client'

import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WhatsApp } from '@/components/ui/whatsapp'
import { Price } from '@/views/shared/money'
import { StatusPill } from '@/views/shared/surfaces'
import { whatsappHref } from '@/lib/whatsapp'
import { relativeLastOrderLabel } from './format'
import { buildCustomerWhatsappMessage } from './whatsapp-message'
import type { StoreCustomer } from '@/models/types'

/**
 * Botón de contacto (WhatsApp o mail), 44px. Con `href: null` —sin mail
 * cargado, o el cliente se dio de baja de promos— se muestra apagado en vez
 * de desaparecer: el dueño tiene que VER que ese canal no está disponible,
 * no adivinarlo por su ausencia (criterio de aceptación 4).
 */
function ContactIconButton({
  href,
  label,
  icon,
}: {
  href: string | null
  label: string
  icon: React.ReactNode
}) {
  if (!href) {
    return (
      <Button type="button" variant="outline" size="icon" disabled aria-label={label}>
        {icon}
      </Button>
    )
  }
  const isMail = href.startsWith('mailto:')
  return (
    <Button asChild variant="outline" size="icon">
      <a href={href} aria-label={label} target={isMail ? undefined : '_blank'} rel={isMail ? undefined : 'noreferrer'}>
        {icon}
      </a>
    </Button>
  )
}

/** El nombre y el teléfono, y —cuando corresponde— el aviso de cancelados. Es lo único que abre el detalle. */
function IdentityCell({ customer, onOpenDetail }: { customer: StoreCustomer; onOpenDetail: () => void }) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={onOpenDetail} className="block min-w-0 text-left">
        <p className="text-foreground truncate text-sm font-medium">{customer.displayName}</p>
        <p className="text-muted-foreground truncate text-xs">{customer.phoneE164}</p>
      </button>
      {/* Un cancelado es ruido; tres es un patrón (§5.5). */}
      {customer.cancelledOrdersCount >= 2 ? (
        <StatusPill tone="warning" className="mt-1">
          {customer.cancelledOrdersCount} cancelados
        </StatusPill>
      ) : null}
    </div>
  )
}

/** Los dos botones de contacto + el aviso de baja. Compartido entre mobile y `lg`. */
function ContactCell({
  customer,
  waHref,
  mailHref,
}: {
  customer: StoreCustomer
  waHref: string | null
  mailHref: string | null
}) {
  const optedOut = customer.marketingOptOutAt !== null
  return (
    <div className="flex items-center gap-2">
      {optedOut ? <StatusPill tone="neutral">Sin promos</StatusPill> : null}
      <ContactIconButton
        href={waHref}
        label={optedOut ? `${customer.displayName} se dio de baja de promos` : `Escribirle a ${customer.displayName} por WhatsApp`}
        icon={<WhatsApp className="size-4" aria-hidden />}
      />
      <ContactIconButton
        href={mailHref}
        label={
          optedOut
            ? `${customer.displayName} se dio de baja de promos`
            : customer.email
              ? `Mandarle un mail a ${customer.displayName}`
              : `${customer.displayName} no dejó mail`
        }
        icon={<Mail className="size-4" aria-hidden />}
      />
    </div>
  )
}

/**
 * Una fila del padrón. Mismo patrón que `catalogo/product-row.tsx`: un
 * `<button>` cubre solo nombre + teléfono (nunca un `<a>` u otro botón
 * anidado adentro, que rompería el modelo de contenido de HTML), y el resto
 * de la fila son celdas hermanas, no interactivas.
 *
 * Se renderiza DOS veces —una para mobile, otra para `lg:grid`— en vez de
 * reacomodar una sola grilla con `display:contents`: ese truco tiene bugs de
 * accesibilidad conocidos (Safari deja botones con `display:contents` sin
 * foco de teclado), y acá cada variante tiene un nombre accesible corto y
 * previsible. Como una sola está visible por vez (`hidden`/`lg:hidden`
 * saca la otra del árbol de accesibilidad), no hay controles duplicados
 * para el teclado ni el lector de pantalla en ningún viewport.
 */
export function CustomerRow({
  customer,
  storeName,
  storeSlug,
  currency,
  onOpenDetail,
}: {
  customer: StoreCustomer
  storeName: string
  storeSlug: string
  currency: string
  onOpenDetail: () => void
}) {
  const optedOut = customer.marketingOptOutAt !== null
  const waHref = optedOut ? null : whatsappHref(customer.phoneE164, buildCustomerWhatsappMessage(customer, storeName, storeSlug))
  const mailHref = optedOut || !customer.email ? null : `mailto:${customer.email}`

  return (
    <div className="py-3 lg:py-2.5">
      {/* Mobile: nombre + gastado arriba, el resto abajo (criterio de aceptación de mobile del brief). */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <IdentityCell customer={customer} onOpenDetail={onOpenDetail} />
          <Price cents={customer.totalSpentCents} currency={currency} exact className="text-foreground shrink-0 text-sm font-semibold" />
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className="tabular">{customer.ordersCount} pedidos</span>
          <span aria-hidden>·</span>
          <span className="tabular">
            Prom. <Price cents={customer.avgTicketCents} currency={currency} />
          </span>
          <span aria-hidden>·</span>
          <span className="tabular">{relativeLastOrderLabel(customer.daysSinceLastOrder)}</span>
        </p>
        <ContactCell customer={customer} waHref={waHref} mailHref={mailHref} />
      </div>

      {/* `lg`: las seis columnas de §5.5, ordenada por gastado desc (ya viene ordenada del controller). */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.4fr)_7rem_5rem_7rem_8rem_auto] lg:items-center lg:gap-4">
        <IdentityCell customer={customer} onOpenDetail={onOpenDetail} />
        <Price cents={customer.totalSpentCents} currency={currency} exact className="text-foreground text-sm font-medium" />
        <p className="text-muted-foreground tabular text-sm">{customer.ordersCount}</p>
        <p className="text-muted-foreground tabular text-sm">
          <Price cents={customer.avgTicketCents} currency={currency} />
        </p>
        <p className="text-muted-foreground tabular text-sm">{relativeLastOrderLabel(customer.daysSinceLastOrder)}</p>
        <ContactCell customer={customer} waHref={waHref} mailHref={mailHref} />
      </div>
    </div>
  )
}
