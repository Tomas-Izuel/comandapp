'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { CategoryChip, CategoryRail, SearchField, SectionHeading } from '@/views/shared/surfaces'
import { EmptyState } from '@/views/shared/states'
import { ProductCard } from '@/views/storefront/product-card'
import type { MenuCategory, MenuProduct, StoreWithBranding } from '@/models/types'

/**
 * Cuánto tapan el encabezado + el riel juntos, en px. Tiene que coincidir con
 * `--sticky-offset` de `globals.css` (`--chrome-h` 3.75rem + `--rail-h`
 * 4.5rem = 8.25rem = 132px): es lo que le dice al observer que una sección
 * recién "entró" cuando su borde superior ya pasó las dos barras pegajosas,
 * no apenas toca el viewport. El buscador NO suma un tercer valor acá: vive
 * en flujo normal, arriba del riel, y no es pegajoso (ver el JSX).
 */
const STICKY_BARS_PX = 132

function chipId(categoryId: number) {
  return `categoria-chip-${categoryId}`
}
function sectionId(categoryId: number) {
  return `categoria-${categoryId}`
}

/** Sin distinguir mayúsculas ni acentos: "papas" tiene que encontrar "Papas Fritas". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function matchesQuery(product: MenuProduct, needle: string): boolean {
  return normalize(product.name).includes(needle) || (product.description != null && normalize(product.description).includes(needle))
}

/** La foto del primer producto CON foto de la categoría — identidad real del local, nunca un glifo. Sin ninguna foto, el chip va sin ícono. */
function firstCategoryPhoto(category: MenuCategory): string | null {
  return category.products.find((product) => product.imageUrl)?.imageUrl ?? null
}

/**
 * Buscador + riel de categorías (pegajoso bajo el encabezado) + la carta
 * completa agrupada por categoría. Hace scroll-spy: el chip de la sección
 * visible queda activo y se centra solo en el riel; tocar un chip lleva la
 * sección arriba sin quedar tapada (`[data-scroll-anchor]` +
 * `--sticky-offset`, `globals.css`).
 *
 * Mientras hay una búsqueda activa, el riel se OCULTA (no queda inerte al
 * lado de una lista que ya dejó de respetar las categorías): los resultados
 * cruzan categorías, así que un chip "activo" ahí sería una mentira sobre lo
 * que se está mostrando. El scroll-spy también se apaga en ese modo, porque
 * no hay secciones `[data-scroll-anchor]` que observar.
 *
 * `getMenu` (el modelo) ya filtra categorías inactivas y productos sin stock
 * antes de que esto reciba `categories` — así que `ProductCard` nunca ve hoy
 * un `isAvailable: false` real. Esto igual sabe dibujar ese estado (ver
 * `product-card.tsx`): si el filtro del modelo cambia más adelante para
 * mostrar "agotado" en vez de ocultarlo, la vista ya está lista.
 */
export function CatalogList({ store, categories }: { store: StoreWithBranding; categories: MenuCategory[] }) {
  const [activeId, setActiveId] = useState<number | null>(categories[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const visibleIdsRef = useRef(new Set<number>())

  const trimmedQuery = query.trim()
  const isSearching = trimmedQuery.length > 0

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const needle = normalize(trimmedQuery)
    return categories.flatMap((category) => category.products).filter((product) => matchesQuery(product, needle))
  }, [categories, isSearching, trimmedQuery])

  useEffect(() => {
    if (isSearching) return
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
  }, [categories, isSearching])

  useEffect(() => {
    if (isSearching || activeId == null) return
    document
      .getElementById(chipId(activeId))
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId, isSearching])

  if (categories.length === 0) return null

  return (
    <>
      <div className="px-4 pt-3 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-(--content-max)">
          <SearchField
            value={query}
            onValueChange={setQuery}
            label="Buscar en la carta"
            placeholder="Buscar en la carta…"
          />
        </div>
      </div>

      {!isSearching ? (
        <CategoryRail className="sticky top-(--chrome-h) z-30">
          {categories.map((category) => {
            const photoUrl = firstCategoryPhoto(category)
            return (
              <CategoryChip
                key={category.id}
                id={chipId(category.id)}
                href={`#${sectionId(category.id)}`}
                active={activeId === category.id}
                icon={photoUrl ? <Image src={photoUrl} alt="" fill sizes="36px" className="object-cover" /> : undefined}
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
            )
          })}
        </CategoryRail>
      ) : null}

      {isSearching ? (
        <div className="mx-auto flex w-full max-w-(--content-max) flex-col">
          {searchResults.length === 0 ? (
            <EmptyState
              title={`Sin resultados para "${trimmedQuery}"`}
              description="Probá con otra palabra, o volvé a ver la carta completa."
              action={
                <Button onClick={() => setQuery('')}>Ver la carta completa</Button>
              }
            />
          ) : (
            // La cantidad de columnas la decide la densidad del local
            // (`--catalog-cols`, ver theme.ts), nunca un `sm:grid-cols-N` fijo
            // que pisaría en silencio esa elección. A `sm:` se ELEVA al
            // cuadrado (2 compacta → 4, 1 cómoda/amplia → 1 sin cambio): más
            // ancho de pantalla en compacta significa más tarjetas chicas a la
            // vista, no tarjetas más grandes — es la misma idea que ya vale en
            // mobile, llevada a la ventana ancha. Cómoda/amplia se queda en
            // una sola columna siempre, tal cual la pidió el dueño, y con eso
            // ProductCard se acuesta solo a ese ancho (ver su comentario sobre
            // `@xs`).
            <div className="grid grid-cols-[repeat(var(--catalog-cols),minmax(0,1fr))] gap-3 px-5 pt-1 pb-8 sm:grid-cols-[repeat(calc(var(--catalog-cols)*var(--catalog-cols)),minmax(0,1fr))] sm:px-8">
              {searchResults.map((product) => (
                <ProductCard key={product.id} product={product} storeSlug={store.slug} currency={store.currency} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div ref={containerRef} className="mx-auto flex w-full max-w-(--content-max) flex-col pb-8">
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
              <div className="grid grid-cols-[repeat(var(--catalog-cols),minmax(0,1fr))] gap-3 px-5 sm:grid-cols-[repeat(calc(var(--catalog-cols)*var(--catalog-cols)),minmax(0,1fr))] sm:px-8">
                {category.products.map((product) => (
                  <ProductCard key={product.id} product={product} storeSlug={store.slug} currency={store.currency} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
