'use client'

import * as React from 'react'
import Link from 'next/link'
import { Popover } from 'radix-ui'
import { Bike, Check, MapPin, MoreHorizontal, ShoppingBag } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Dock, iconButtonClass } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { useCart } from '@/lib/cart'
import { useCheckoutQuote } from './use-priced-cart'
import { useAddFeedback } from './use-add-feedback'
import { storeHref, useStoreBasePath } from './store-base-path'
import { cn } from '@/lib/utils'
import type { StoreWithBranding } from '@/models/types'
import { GoogleMaps } from '@/components/ui/maps'
import { WhatsApp } from '@/components/ui/whatsapp'
import { Instagram } from '@/components/ui/instagram'

/**
 * La barra flotante de la vitrina: el carrito (siempre) y los canales propios
 * del local. Un canal que el local no configuró simplemente no se dibuja —
 * "un botón muerto no es una barra, es una promesa rota".
 *
 * lucide-react no trae logos de marca (ni WhatsApp ni Instagram): por eso
 * WhatsApp usa `MessageCircle` (genérico, como ya resuelve el resto del
 * producto) e Instagram usa `InstagramMark`, un SVG propio en el mismo trazo
 * que lucide — la alternativa que la regla dura del proyecto deja explícita
 * ("lucide-react O SVG propio"), no un glifo/emoji de reemplazo.
 */
export function StoreDock({ store }: { store: StoreWithBranding }) {
  const { lines, itemCount, hydrated } = useCart()
  const quote = useCheckoutQuote(store.slug, lines)
  const hasItems = hydrated && itemCount > 0

  // El Drawer ahora solo se abre para "todos los canales" (ver el botón
  // `MoreHorizontal` más abajo): el caso "Pedir por" con varias apps pasó a
  // resolverse con el Popover de acá abajo, así que no hace falta un modo.
  const [sheetOpen, setSheetOpen] = React.useState(false)

  // Target del Portal del Popover de apps de delivery: un nodo propio,
  // DENTRO del árbol que renderiza este componente (o sea dentro de
  // `[data-store-theme]`) pero fuera del contenedor del dock, que tiene
  // `backdrop-blur-xl`. Un `backdrop-filter` crea containing block para los
  // descendientes `position: fixed` —que es como posiciona Radix Popper por
  // default—, así que portalar ADENTRO del dock rompe el cálculo de posición
  // del popover. Portalar al `<body>` (el default de Radix) tampoco sirve:
  // ahí quedaría fuera de `[data-store-theme]` y perdería `--primary`,
  // `--radius` y la tipografía del local, el mismo problema que ya tuvo
  // sonner (`STORE_THEME_SELECTOR` en `src/lib/theme.ts`). Portalar acá, a un
  // nodo hermano del dock y sin filtros propios, resuelve las dos cosas.
  const [portalContainer, setPortalContainer] = React.useState<HTMLDivElement | null>(null)

  const mapsHref = store.links.mapsUrl ?? (store.address ? mapsSearchUrl(store.address) : null)

  const whatsappRow: ChannelRow | null = store.whatsappPhoneE164
    ? { key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${store.whatsappPhoneE164.replace(/\D/g, '')}`, icon: WhatsApp }
    : null
  const mapsRow: ChannelRow | null = mapsHref ? { key: 'maps', label: 'Cómo llegar', href: mapsHref, icon: MapPin } : null
  const instagramRow: ChannelRow | null = store.links.instagramHandle
    ? { key: 'instagram', label: 'Instagram', href: `https://instagram.com/${store.links.instagramHandle}`, icon: InstagramMark }
    : null
  const rawDeliveryRows: (ChannelRow | null)[] = [
    store.links.rappiUrl ? { key: 'rappi', label: 'Rappi', href: store.links.rappiUrl, icon: Bike } : null,
    store.links.pedidosYaUrl ? { key: 'pedidos-ya', label: 'PedidosYa', href: store.links.pedidosYaUrl, icon: Bike } : null,
    store.links.uberEatsUrl ? { key: 'uber-eats', label: 'Uber Eats', href: store.links.uberEatsUrl, icon: Bike } : null,
  ]
  const deliveryRows = rawDeliveryRows.filter((row): row is ChannelRow => row !== null)

  const allRows = [whatsappRow, mapsRow, ...deliveryRows, instagramRow].filter((row): row is ChannelRow => row !== null)

  return (
    <>
      <Dock aria-label="Carrito y canales del local">
        <CartSlot store={store} lines={lines} itemCount={itemCount} hasItems={hasItems} hydrated={hydrated} quote={quote} />

        {hasItems ? (
          allRows.length > 0 ? (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Más formas de contactar al local"
              className={iconButtonClass('surface')}
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </button>
          ) : null
        ) : (
          <>
            {whatsappRow ? (
              <a
                href={whatsappRow.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Escribinos por WhatsApp, abre en otra pestaña"
                className={iconButtonClass('surface')}
              >
                <WhatsApp className="size-5" aria-hidden />
              </a>
            ) : null}
            {mapsRow ? (
              <a
                href={mapsRow.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Cómo llegar, abre en otra pestaña"
                className={iconButtonClass('surface')}
              >
                <GoogleMaps className="size-5" aria-hidden />
              </a>
            ) : null}
            {deliveryRows.length === 1 ? (
              // Una sola app: el botón va directo a ella. Abrir un menú de un
              // solo ítem es un paso de más.
              <a
                href={deliveryRows[0].href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Pedir por ${deliveryRows[0].label}, abre en otra pestaña`}
                className={iconButtonClass('surface')}
              >
                <Bike className="size-5" aria-hidden />
              </a>
            ) : deliveryRows.length > 1 ? (
              <Popover.Root>
                <Popover.Trigger aria-label="Pedir por, elegí una app" className={iconButtonClass('surface')}>
                  <Bike className="size-5" aria-hidden />
                </Popover.Trigger>
                {/* `container={portalContainer}` en vez de omitir el Portal:
                    sin portalar, este Content quedaría DENTRO del div del
                    dock que tiene `backdrop-blur-xl`, y Radix Popper posiciona
                    con `position: fixed` — un `backdrop-filter` crea
                    containing block para eso y el popover queda mal ubicado.
                    Portalar a `portalContainer` (un nodo hermano del dock,
                    sin filtros, pero igual dentro de `[data-store-theme]`)
                    evita ese problema sin perder la paleta del local. */}
                <Popover.Portal container={portalContainer}>
                  <Popover.Content
                    side="top"
                    align="center"
                    sideOffset={8}
                    collisionPadding={16}
                    className="bg-card border-border text-card-foreground shadow-pop z-50 w-56 rounded-lg border p-1.5 outline-none duration-(--dur-fast) ease-(--ease-out-expo) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      {deliveryRows.map((row) => (
                        <a
                          key={row.key}
                          href={row.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${row.label}, abre en otra pestaña`}
                          className="text-foreground hover:bg-muted flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-(--dur-fast)"
                        >
                          <row.icon className="size-5 shrink-0" aria-hidden />
                          {row.label}
                        </a>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
            {instagramRow ? (
              <a
                href={instagramRow.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram, abre en otra pestaña"
                className={iconButtonClass('surface')}
              >
                <Instagram className="size-5" />
              </a>
            ) : null}
          </>
        )}
      </Dock>

      {/* Target del Portal del Popover de arriba: ver el comentario en
          `portalContainer`. Vacío a propósito, no ocupa lugar en el layout. */}
      <div ref={setPortalContainer} />

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Más formas de contactarnos</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col px-4 pb-[calc(var(--space-4)+env(safe-area-inset-bottom,0px))]">
            {allRows.map((row) => (
              <a
                key={row.key}
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${row.label}, abre en otra pestaña`}
                onClick={() => setSheetOpen(false)}
                className="border-border text-foreground hover:bg-muted flex min-h-11 items-center gap-3 border-b py-3 text-sm font-medium transition-colors duration-(--dur-fast) last:border-b-0"
              >
                <span className="text-muted-foreground" aria-hidden>
                  <row.icon className="size-5" />
                </span>
                {row.label}
              </a>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

type ChannelRow = {
  key: string
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/**
 * El carrito, siempre presente. Vacío es un círculo; con ítems se expande a
 * pastilla con el total — que sale SIEMPRE del servidor (`useCheckoutQuote`),
 * nunca de una cuenta hecha acá. Mientras carga o si falla, se muestra la
 * cantidad de ítems: nunca un número inventado.
 *
 * El botón ES el aviso (`use-add-feedback.ts`): un toast arriba de todo no lo
 * ve nadie que esté mirando el pulgar. La pastilla detecta sola cuando el
 * conteo SUBE (nunca cuando baja: sacar algo no es una confirmación de nada)
 * y por un instante cambia ícono, texto y color antes de volver a "Ver
 * carrito" — sin depender de que product-card/product-detail (fuera de este
 * slice) le avisen por ningún canal propio.
 */
function CartSlot({
  store,
  itemCount,
  hasItems,
  hydrated,
  quote,
}: {
  store: StoreWithBranding
  lines: unknown[]
  itemCount: number
  hasItems: boolean
  hydrated: boolean
  quote: ReturnType<typeof useCheckoutQuote>
}) {
  // Hooks ANTES del `if (!hasItems)`: es el mismo componente en las dos
  // ramas (nunca se desmonta al pasar de círculo a pastilla), así que
  // saltear la regla de hooks acá rompería en cuanto el conteo tocara 0.
  const feedback = useAddFeedback()
  const basePath = useStoreBasePath()
  const cartHref = storeHref(basePath, '/carrito')
  const prevCountRef = React.useRef(itemCount)
  // El primer render en el cliente arranca en 0 (nada de `localStorage` en
  // el servidor) y recién después `useCart` hidrata el carrito guardado: ese
  // salto de 0 al conteo persistido NO es un "agregado" que acaba de pasar,
  // así que la primera vez que `hydrated` se prende solo sincroniza la
  // referencia, sin flashear.
  const wasHydratedRef = React.useRef(false)
  React.useEffect(() => {
    if (!hydrated) return
    if (!wasHydratedRef.current) {
      wasHydratedRef.current = true
      prevCountRef.current = itemCount
      return
    }
    if (itemCount > prevCountRef.current) feedback.flash()
    prevCountRef.current = itemCount
  }, [itemCount, hydrated, feedback])

  if (!hasItems) {
    return (
      <Link href={cartHref} aria-label="Carrito" className={iconButtonClass('primary')}>
        <ShoppingBag className="size-5" aria-hidden />
      </Link>
    )
  }

  const itemsLabel = `${itemCount} ${itemCount === 1 ? 'ítem' : 'ítems'}`
  const Icon = feedback.isAdded ? Check : ShoppingBag

  return (
    <Link
      href={cartHref}
      aria-label={`Ver carrito, ${itemsLabel}`}
      className={cn(
        // Alto ligado a `--dock-h` (globals.css) en vez de `h-11`: `h-11` sale
        // de la escala de espaciado, que la densidad del local multiplica
        // hasta ×1.22 — pero `--dock-h` NO escala con la densidad (a
        // propósito, ver el chasis del dock). Con `h-11` la pastilla podía
        // terminar más alta que el propio dock que la contiene y desbordar
        // el borde redondeado. Este cálculo siempre deja aire arriba y abajo
        // sea cual sea la densidad elegida.
        'flex h-[calc(var(--dock-h)-0.5rem)] min-w-0 items-center gap-2 rounded-pill pr-4 pl-3 transition-colors duration-(--dur-fast)',
        feedback.isAdded ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {/* `min-w-0` + `truncate` en la ETIQUETA, no en el precio: si algún día
          no entra todo (un total larguísimo, una tienda con nombre de canal
          eterno), lo que cede es "Ver carrito", nunca la cifra — el precio
          lleva `shrink-0` más abajo para que jamás se corte a media cifra.
          Antes el `<Link>` tenía `shrink-0` propio: eso obligaba a TODO el
          dock a desbordar el ancho de pantalla en vez de ceder acá. */}
      <span className="min-w-0 truncate text-sm font-semibold">{feedback.isAdded ? '¡Agregado!' : 'Ver carrito'}</span>
      {/* `key={itemCount}` reinicia `animate-bump` (globals.css) cada vez que
          cambia la cantidad — el momento autorizado del producto, igual que
          hoy resuelve el contador de `store-chrome.tsx`. `aria-live` avisa el
          cambio a quien usa lector de pantalla sin que tenga que reenfocar
          el link para enterarse de que el total se actualizó. */}
      <span key={itemCount} className="animate-bump shrink-0" aria-live="polite">
        {quote.status === 'ready' ? (
          <Price cents={quote.data.priced.totalCents} currency={store.currency} className="text-sm font-semibold" />
        ) : (
          <span className="tabular text-sm font-semibold whitespace-nowrap">{itemsLabel}</span>
        )}
      </span>
    </Link>
  )
}

/**
 * Instagram no tiene ícono en lucide-react (los logos de marca no se
 * mantienen ahí — mismo motivo por el que WhatsApp usa `MessageCircle`).
 * Mismo trazo que la librería: `viewBox` 24×24, stroke 2, cabos redondeados.
 */
function InstagramMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}
