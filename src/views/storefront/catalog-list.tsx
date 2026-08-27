'use client'

import { useEffect, useRef, useState } from 'react'
import { CategoryChip, CategoryRail, SectionHeading } from '@/views/shared/surfaces'
import { ProductRow } from '@/views/storefront/product-row'
import type { MenuCategory, StoreWithBranding } from '@/models/types'

/**
 * Cuánto tapan el encabezado + el riel juntos, en px. Tiene que coincidir con
 * `--sticky-offset` de `globals.css` (7.5rem = 120px): es lo que le dice al
 * observer que una sección recién "entró" cuando su borde superior ya pasó
 * las dos barras pegajosas, no apenas toca el viewport.
 */
const STICKY_BARS_PX = 121

function chipId(categoryId: number) {
  return `categoria-chip-${categoryId}`
}
function sectionId(categoryId: number) {
  return `categoria-${categoryId}`
}

/**
 * El riel de categorías (pegajoso bajo el encabezado) más la lista completa,
 * agrupada por categoría. Hace scroll-spy: el chip de la sección visible
 * queda activo y se centra solo en el riel; tocar un chip lleva la sección
 * arriba sin quedar tapada (`[data-scroll-anchor]` + `--sticky-offset`,
 * `globals.css`).
 *
 * `getMenu` (el modelo) ya filtra categorías inactivas y productos sin stock
 * antes de que esto reciba `categories` — así que `ProductRow` nunca va a ver
 * un `isAvailable: false` real hoy. Esto igual sabe dibujar ese estado (ver
 * `product-row.tsx`): si el filtro del modelo cambia más adelante para
 * mostrar "agotado" en vez de ocultarlo, la vista ya está lista.
 */
export function CatalogList({ store, categories }: { store: StoreWithBranding; categories: MenuCategory[] }) {
  const [activeId, setActiveId] = useState<number | null>(categories[0]?.id ?? null)
  const containerRef = useRef<HTMLDivElement>(null)
  const visibleIdsRef = useRef(new Set<number>())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const sections = container.querySelectorAll<HTMLElement>('[data-scroll-anchor]')
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = Number(entry.target.getAttribute('data-category-id'))
          if (entry.isIntersecting) visibleIdsRef.current.add(id)
          else visibleIdsRef.current.delete(id)
        }
        // El primero en orden de la carta entre los visibles, no el último que
        // disparó el callback: con varias secciones cortas en pantalla a la
        // vez, el chip activo tiene que ser el de arriba.
        const topMost = categories.find((c) => visibleIdsRef.current.has(c.id))
        if (topMost) setActiveId(topMost.id)
      },
      { rootMargin: `-${STICKY_BARS_PX}px 0px -70% 0px`, threshold: 0 },
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [categories])

  useEffect(() => {
    if (activeId == null) return
    document
      .getElementById(chipId(activeId))
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId])

  if (categories.length === 0) return null

  return (
    <>
      <CategoryRail className="sticky top-[3.75rem] z-30">
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            id={chipId(category.id)}
            href={`#${sectionId(category.id)}`}
            active={activeId === category.id}
            onClick={(event) => {
              event.preventDefault()
              document.getElementById(sectionId(category.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              // `replaceState`, no `pushState`: deja la categoría linkeable
              // (compartir/recargar cae en la sección) sin ensuciar el
              // historial con una entrada por cada chip tocado.
              window.history.replaceState(null, '', `#${sectionId(category.id)}`)
            }}
          >
            {category.name}
          </CategoryChip>
        ))}
      </CategoryRail>

      <div ref={containerRef} className="mx-auto flex w-full max-w-(--content-max) flex-col pb-16">
        {categories.map((category) => (
          <section
            key={category.id}
            id={sectionId(category.id)}
            data-category-id={category.id}
            data-scroll-anchor
            className="flex flex-col"
          >
            <SectionHeading as="h2" className="px-5 sm:px-8">
              {category.name}
            </SectionHeading>
            <div className="flex flex-col">
              {category.products.map((product) => (
                <ProductRow key={product.id} product={product} storeSlug={store.slug} currency={store.currency} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
