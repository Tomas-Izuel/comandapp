'use client'

import { buildThemeCss, themeClass } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { PhotoFrame, CategoryChip } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import type { Branding } from '@/models/schemas/branding.schema'

/**
 * Reusa el mismo `buildThemeCss` que pinta la vitrina real, así que el color,
 * la tipografía y el radio elegidos acá son EXACTAMENTE los que va a ver el
 * cliente, no una aproximación.
 *
 * La geometría (portada a sangre, riel de categorías, fila de producto) es
 * una RÉPLICA MÍNIMA de `src/views/storefront/`, no una importación de esas
 * vistas: ese slice compone `StoreChrome`/`CatalogList`, que arrastran
 * data fetching y routing propios del storefront real, y traerlos acá
 * acoplaría este formulario a decisiones de otro slice. Sí se reutilizan las
 * PRIMITIVAS de `src/views/shared/surfaces` (`PhotoFrame`, `CategoryChip`) y
 * `money` (`Price`): esas son el vocabulario común declarado en el brief, y
 * son las mismas piezas con las que el storefront real arma esta franja.
 */
export function BrandPreview({ branding, storeName }: { branding: Branding; storeName: string }) {
  let css = ''
  try {
    css = buildThemeCss(branding, '[data-brand-preview]')
  } catch {
    return <p className="text-muted-foreground text-sm">Completá los colores para ver la vista previa.</p>
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border" aria-hidden>
      {/* Decorativo: repite en vivo lo que el formulario de al lado ya dice
          con texto, así que se saca del árbol de accesibilidad en vez de
          generar una región que anuncia cada tecleo del dueño. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div
        data-brand-preview
        className={cn('bg-background text-foreground', themeClass(branding))}
        style={{ fontFamily: `var(--font-${branding.font_body})` }}
      >
        <PhotoFrame ratio="hero">
          {branding.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.hero_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="bg-primary h-full w-full" />
          )}
        </PhotoFrame>

        <div className="px-4 pt-3 pb-2">
          <p
            className="display text-xl leading-tight"
            style={{ fontFamily: `var(--font-${branding.font_heading})` }}
          >
            {storeName || 'Tu local'}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">Abierto · 15 min · Retiro y delivery</p>
        </div>

        <div className="border-border flex gap-2 border-y px-4 py-2">
          <CategoryChip active tabIndex={-1}>
            Hamburguesas
          </CategoryChip>
          <CategoryChip tabIndex={-1}>Bebidas</CategoryChip>
        </div>

        <div className="flex gap-3 px-4 py-3">
          <PhotoFrame ratio="square" fallbackLabel="Hamburguesa clásica" className="w-20 shrink-0 rounded-(--radius)" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Hamburguesa clásica</p>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">Con cheddar, panceta y salsa de la casa.</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Price cents={780000} className="text-sm font-semibold" />
              <span className="bg-primary text-primary-foreground rounded-(--radius) px-3 py-1.5 text-xs font-medium">
                Agregar
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
