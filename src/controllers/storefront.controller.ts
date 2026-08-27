import 'server-only'

import { notFound } from 'next/navigation'
import { getStoreBySlug } from '@/models/store.model'
import { getCategoryName, getMenu, getProductForStore } from '@/models/catalog.model'
import type { MenuCategory, MenuProduct, StoreWithBranding } from '@/models/types'

/**
 * Casos de uso de la vitrina pública: catálogo y ficha de producto. Sin
 * cuenta, sin RLS de staff — lo único que decide qué se ve es `getStoreBySlug`
 * (RLS pública: solo tiendas `active`) y los filtros de disponibilidad que ya
 * aplica `getMenu`.
 *
 * `getStoreForSlug` y `getStoreBrandingForTheme` salieron de acá (A-08): eran
 * alias puros de `getStoreBySlug` sin componer nada, y CLAUDE.md prohíbe la
 * indirección sin valor. `generateMetadata`, el layout y `/pedido/[token]`
 * ahora llaman a `getStoreBySlug` directo — es una lectura plana, no un caso
 * de uso que orqueste algo.
 */

async function requireStore(slug: string): Promise<StoreWithBranding> {
  const store = await getStoreBySlug(slug)
  if (!store) notFound()
  return store
}

/**
 * Alias fino que se queda por compatibilidad: `[store]/carrito/page.tsx` y
 * `[store]/checkout/page.tsx` (de otro slice de esta entrega, fuera de mi
 * propiedad acá) todavía la importan. `getStoreBySlug` ya quedó cacheada por
 * request (`store.model.ts`), así que mantenerla no cuesta una query
 * extra — pero sigue siendo indirección sin valor propio (A-08). Reportado:
 * lo ideal es que esas dos pages llamen al modelo directo, como ya hacen acá
 * el layout, `generateMetadata` y `/pedido/[token]`.
 */
export async function getStoreForSlug(slug: string): Promise<StoreWithBranding> {
  return requireStore(slug)
}

export type StorefrontData = { store: StoreWithBranding; categories: MenuCategory[] }

/**
 * Catálogo completo con precios, aunque la tienda no esté aceptando pedidos:
 * quien elige a las 4 de la tarde dónde va a cenar tiene que poder ver todo.
 * Lo que sí filtra `getMenu` es disponibilidad real (producto/categoría
 * inactivos), porque eso no es un estado temporal del local sino del ítem.
 */
export async function getStorefront(slug: string): Promise<StorefrontData> {
  const store = await requireStore(slug)
  const categories = await getMenu(store.id)
  return { store, categories }
}

export type ProductDetailData = {
  store: StoreWithBranding
  product: MenuProduct
  categoryName: string | null
}

/**
 * A diferencia de `getMenu`, esto NO filtra por disponibilidad: alguien puede
 * llegar por un link viejo a un producto que se dio de baja, y la ficha tiene
 * que poder explicarlo en vez de tirar 404.
 */
export async function getProductDetail(slug: string, productId: number): Promise<ProductDetailData> {
  const store = await requireStore(slug)
  const product = await getProductForStore(store.id, productId)
  if (!product) notFound()

  // Antes se cargaba el menú COMPLETO —categorías, productos, grupos de opciones
  // y opciones— para quedarse con una sola cadena de texto (A-03).
  const categoryName =
    product.categoryId != null ? await getCategoryName(store.id, product.categoryId) : null

  return { store, product, categoryName }
}
