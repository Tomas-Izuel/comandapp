'use client'

import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Price } from '@/views/shared/money'
import { StatusPill } from '@/views/shared/surfaces'
import { CouponWhatsappMenu } from '@/views/admin/clientes/cupones/coupon-whatsapp-menu'
import { relativeLastOrderLabel } from './format'
import type { Coupon, StoreCustomer } from '@/models/types'

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
/**
 * Las seis columnas del padrón, en UN solo lugar.
 *
 * Estaba escrita dos veces —acá y en el encabezado de `customer-directory.tsx`—
 * y por eso pudo desincronizarse sin que nada avisara. Se exporta para que el
 * encabezado la consuma: si son el mismo string, no pueden diferir.
 *
 * ⚠️ **La última columna es FIJA y no `auto`.** Con `auto` cada fila resolvía su
 * propia grilla según lo que hubiera en la celda de contacto, las columnas `fr`
 * absorbían la diferencia, y los encabezados quedaban corridos ~44px de sus
 * valores. Una tabla cuyos encabezados no corresponden a sus celdas es peor que
 * una sin encabezados: promete una lectura por columna que no se puede hacer.
 *
 * `6rem` son los dos botones de 44px más el `gap-2`. Por eso el aviso de baja
 * NO vive en esa celda (ver `IdentityCell`): un pill de ancho variable ahí
 * vuelve a hacer que el ancho dependa del dato de cada fila.
 */
export const CUSTOMER_GRID_COLS = 'lg:grid-cols-[minmax(0,1.4fr)_7rem_5rem_7rem_8rem_6rem]'

function IdentityCell({ customer, onOpenDetail }: { customer: StoreCustomer; onOpenDetail: () => void }) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={onOpenDetail} className="block min-w-0 text-left">
        <p className="text-foreground truncate text-sm font-medium">{customer.displayName}</p>
        <p className="text-muted-foreground truncate text-xs">{customer.phoneE164}</p>
      </button>
      {/*
        Los avisos de la fila viven ACÁ y no en la celda de contacto, y no es
        cosmético: la columna de contacto es de ancho fijo para que la tabla
        alinee, así que cualquier cosa de ancho variable adentro rompe eso otra
        vez. Además la baja es una propiedad de la PERSONA, no del canal: al
        lado del nombre es donde se lee.
      */}
      {customer.cancelledOrdersCount >= 2 || customer.marketingOptOutAt !== null ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* Un cancelado es ruido; tres es un patrón (§5.5). */}
          {customer.cancelledOrdersCount >= 2 ? (
            <StatusPill tone="warning">{customer.cancelledOrdersCount} cancelados</StatusPill>
          ) : null}
          {customer.marketingOptOutAt !== null ? <StatusPill tone="neutral">Sin promos</StatusPill> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Los dos botones de contacto, y NADA más. Compartido entre mobile y `lg`.
 *
 * El aviso de baja se movió a `IdentityCell`: acá hacía que el ancho de la
 * celda dependiera del dato de la fila, y con eso la tabla no podía alinear.
 */
function ContactCell({
  customer,
  storeName,
  storeSlug,
  activeCoupons,
  mailHref,
}: {
  customer: StoreCustomer
  storeName: string
  storeSlug: string
  activeCoupons: Coupon[]
  mailHref: string | null
}) {
  const optedOut = customer.marketingOptOutAt !== null
  return (
    <div className="flex items-center gap-2">
      <CouponWhatsappMenu
        customer={customer}
        storeName={storeName}
        storeSlug={storeSlug}
        activeCoupons={activeCoupons}
        disabled={optedOut}
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
  activeCoupons = [],
  onOpenDetail,
}: {
  customer: StoreCustomer
  storeName: string
  storeSlug: string
  currency: string
  /**
   * Los cupones `active` del local, para el tercer mensaje de WhatsApp
   * (§5.5.1, T4B). `page.tsx` y `customer-directory.tsx` (T2A) ya arman y
   * pasan esta prop de punta a punta (`getCouponsForStore` → filtro por
   * `status` → prop). El default `[]` queda como red: si algún día se
   * renderiza `CustomerRow` sin pasarla, el botón de WhatsApp se comporta
   * igual que antes de este cambio (el menú no se ofrece sin cupones).
   */
  activeCoupons?: Coupon[]
  onOpenDetail: () => void
}) {
  const optedOut = customer.marketingOptOutAt !== null
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
        <ContactCell customer={customer} storeName={storeName} storeSlug={storeSlug} activeCoupons={activeCoupons} mailHref={mailHref} />
      </div>

      {/* `lg`: las seis columnas de §5.5, ordenada por gastado desc (ya viene ordenada del controller). */}
      <div className={`hidden lg:grid ${CUSTOMER_GRID_COLS} lg:items-center lg:gap-4`}>
        <IdentityCell customer={customer} onOpenDetail={onOpenDetail} />
        <Price cents={customer.totalSpentCents} currency={currency} exact className="text-foreground text-sm font-medium" />
        <p className="text-muted-foreground tabular text-sm">{customer.ordersCount}</p>
        <p className="text-muted-foreground tabular text-sm">
          <Price cents={customer.avgTicketCents} currency={currency} />
        </p>
        <p className="text-muted-foreground tabular text-sm">{relativeLastOrderLabel(customer.daysSinceLastOrder)}</p>
        <ContactCell customer={customer} storeName={storeName} storeSlug={storeSlug} activeCoupons={activeCoupons} mailHref={mailHref} />
      </div>
    </div>
  )
}
