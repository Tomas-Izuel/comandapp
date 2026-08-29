'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { StoreDock } from '@/views/storefront/store-dock'
import { SiteFooter } from '@/views/shared/site-footer'
import type { StoreWithBranding } from '@/models/types'

/**
 * Encabezado pegajoso y delgado de la vitrina: marca del local (nunca la de
 * la plataforma) y acceso a "Mis pedidos". El carrito se fue de acá — ahora
 * vive en `StoreDock`, al pie — porque tenerlo arriba Y abajo es ruido: dos
 * lugares para la misma acción no son dos oportunidades, son una duda.
 *
 * La altura es `--chrome-h` (3.75rem, `globals.css`) a propósito: sumada a
 * la del riel de categorías (`--rail-h`, `catalog-list.tsx`) da
 * `--sticky-offset`, que es lo que `[data-scroll-anchor]` usa para que las
 * dos barras pegajosas no tapen la sección a la que acaba de llevar un chip.
 */
export function StoreChrome({ store, children }: { store: StoreWithBranding; children: React.ReactNode }) {
  const pathname = usePathname()
  // El dock solo se dibuja en el catálogo: `/producto/[id]`, `/carrito` y
  // `/checkout` ya tienen su propia `ActionBar` fija al pie, y dos barras
  // apiladas es exactamente lo que el contrato de dirección no quiere.
  const isCatalogRoute = pathname === `/${store.slug}`

  return (
    <>
      <header className="border-border bg-background sticky top-0 z-40 flex h-(--chrome-h) items-center justify-between border-b px-4 sm:px-6">
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
        <Link
          href="/mis-pedidos"
          className="text-foreground hover:bg-muted flex size-11 items-center justify-center rounded-lg transition-colors duration-(--dur-fast)"
          aria-label="Mis pedidos"
        >
          <ClipboardList className="size-5" aria-hidden />
        </Link>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      {/* Solo en el catálogo: `/producto`, `/carrito` y `/checkout` ya tienen
          su propia `ActionBar` fija, y el pie de la plataforma ahí sería una
          segunda barra al pie compitiendo con la de la tarea en curso.
          `.dock-clearance` en el footer (no padding a mano) porque el dock es
          `fixed` y no reserva espacio: sin eso, al hacer scroll hasta el
          final, el dock tapa las últimas líneas del pie. */}
      {isCatalogRoute ? (
        <>
          <SiteFooter className="dock-clearance" />
          <StoreDock store={store} />
        </>
      ) : null}
    </>
  )
}
