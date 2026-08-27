'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ClipboardList, ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/cart'
import type { StoreWithBranding } from '@/models/types'

/**
 * Encabezado pegajoso y delgado de la vitrina: marca del local (nunca la de
 * la plataforma), acceso a "Mis pedidos" y el carrito con contador.
 *
 * La altura queda fija en 3.75rem (`size-11` + `py-2`) a propósito: sumada a
 * la del riel de categorías —también 3.75rem, ver `catalog-list.tsx`— da
 * exactamente `--sticky-offset` (7.5rem, `globals.css`), que es lo que
 * `[data-scroll-anchor]` usa para que las dos barras pegajosas no tapen la
 * sección a la que acaba de llevar un chip.
 */
export function StoreChrome({ store, children }: { store: StoreWithBranding; children: React.ReactNode }) {
  const { itemCount, hydrated } = useCart()
  const cartLabel = hydrated && itemCount > 0 ? `Carrito, ${itemCount} ${itemCount === 1 ? 'ítem' : 'ítems'}` : 'Carrito'

  return (
    <>
      <header className="border-border bg-background sticky top-0 z-40 flex items-center justify-between border-b px-4 py-2 sm:px-6">
        <Link href={`/${store.slug}`} className="flex min-w-0 items-center" aria-label={store.name}>
          {store.branding.logo_url ? (
            // Alto fijo, ancho contenido: el logo puede llegar con cualquier
            // proporción y `fill` + `object-contain` lo respeta sin recortar.
            <span className="relative block h-7 w-28 sm:h-8 sm:w-32">
              <Image src={store.branding.logo_url} alt="" fill sizes="128px" className="object-contain object-left" />
            </span>
          ) : (
            // Sin logo, el nombre ES la marca acá: caja mixta y peso de
            // título, no una etiqueta chica — "el nombre de una hamburguesa
            // es un nombre, no una sigla" (globals.css, `.display`).
            <span className="display text-foreground min-w-0 truncate text-base font-semibold">{store.name}</span>
          )}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/mis-pedidos"
            className="text-foreground hover:bg-muted flex size-11 items-center justify-center rounded-lg transition-colors duration-(--dur-fast)"
            aria-label="Mis pedidos"
          >
            <ClipboardList className="size-5" aria-hidden />
          </Link>
          <Link
            href={`/${store.slug}/carrito`}
            className="text-foreground hover:bg-muted relative flex size-11 items-center justify-center rounded-lg transition-colors duration-(--dur-fast)"
            aria-label={cartLabel}
          >
            <ShoppingBag className="size-5" aria-hidden />
            {hydrated && itemCount > 0 ? (
              // `key={itemCount}` remonta el badge en cada cambio: es lo que
              // hace que `animate-bump` (globals.css) vuelva a jugar desde
              // cero cada vez, que es el "el contador late" del contrato de
              // dirección — el único otro momento animado, junto con la barra
              // de carrito entrando (eso lo resuelve la ficha de producto,
              // otro slice).
              <span
                key={itemCount}
                className="bg-primary text-primary-foreground tabular animate-bump absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold"
              >
                {itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  )
}
