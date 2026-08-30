import { Suspense } from 'react'
import { headers } from 'next/headers'
import { estimateEta } from '@/models/order.model'
import { getStorefront } from '@/controllers/storefront.controller'
import { storefrontGate } from '@/lib/store-hours'
import { storeBasePath } from '@/lib/urls'
import { buildClosedSchedule } from '@/views/storefront/schedule-lib'
import { StoreHero } from '@/views/storefront/store-hero'
import { CatalogList } from '@/views/storefront/catalog-list'
import { ReorderHandler } from '@/views/storefront/reorder-handler'
import { ClosedNotice, EmptyState } from '@/views/shared/states'
import type { MenuCategory, StoreWithBranding } from '@/models/types'

/**
 * Minutos estimados del hero. NO es el ETA de un pedido puntual —eso pide un
 * carrito armado, `priceCart()` en `order.model.ts`— es una foto honesta de
 * "cuánto tarda hoy la cocina" antes de que el cliente elija nada: usa el
 * `prepMinutes` más alto entre los productos disponibles como base, el mismo
 * componente "base" de la fórmula de demanda (CLAUDE.md § Multiplicador de
 * demanda), y `estimateEta` (el modelo) aplica el multiplicador real según
 * cuántos pedidos hay activos ahora mismo. Sin esto sería el "20 minutos que
 * el local dice siempre igual" que CLAUDE.md explícitamente no quiere.
 *
 * Se llama al modelo directo desde acá en vez de sumar una función a
 * `storefront.controller.ts` porque ese archivo no es de este slice — queda
 * reportado como candidato a mover ahí (p. ej. como `store.etaMinutes`) para
 * quien sea dueño de ese archivo.
 */
async function getHeroEtaMinutes(store: StoreWithBranding, categories: MenuCategory[], canOrder: boolean): Promise<number | null> {
  if (!canOrder) return null

  const prepMinutes = categories
    .flatMap((category) => category.products)
    .filter((product) => product.isAvailable)
    .map((product) => product.prepMinutes)
  if (prepMinutes.length === 0) return null

  try {
    const eta = await estimateEta(store, Math.max(...prepMinutes))
    return eta.etaMinutes
  } catch {
    // Decorativo: si la query falla, el hero se queda sin el dato en vez de
    // romper la página completa por un cálculo que no es crítico.
    return null
  }
}

export default async function StorePage(props: PageProps<'/[store]'>) {
  const { store: slug } = await props.params
  const { store, categories, schedule } = await getStorefront(slug)
  // `getStorefront` ya trae el calendario (una sola query, junto con el
  // catálogo): pedirlo de nuevo acá era una lectura duplicada e innecesaria
  // en el home de cada tienda, la página de más tráfico del producto.
  // Se calcula UNA vez y se pasa a los que lo necesitan (el hero y el
  // `ClosedNotice` de más abajo): dos cálculos independientes del mismo
  // gate en la misma page son dos lugares donde podrían llegar a discrepar,
  // aunque hoy no lo hagan.
  const gate = storefrontGate(store, schedule, new Date(), store.timezone)
  // El hero muestra "Abierto ahora"/el ETA solo cuando la cocina ESTÁ
  // trabajando ahora mismo — `closed_by_hours` sigue sin poder pedir "para
  // ahora", aunque la carta y el carrito sigan andando (eso lo resuelve el
  // checkout, no el hero).
  const isOpenNow = gate.kind === 'open'
  const etaMinutes = await getHeroEtaMinutes(store, categories, isOpenNow)

  const host = (await headers()).get('host')
  const basePath = storeBasePath(store.slug, host)

  return (
    <>
      <Suspense fallback={null}>
        <ReorderHandler categories={categories} />
      </Suspense>
      <StoreHero store={store} etaMinutes={etaMinutes} acceptingOrders={isOpenNow} />
      {gate.kind === 'closed_by_hours' ? (
        <ClosedNotice
          storeName={store.name}
          schedule={buildClosedSchedule(gate.opensAt, store.timezone, `${basePath}/checkout`)}
        />
      ) : gate.kind !== 'open' ? (
        <ClosedNotice storeName={store.name} />
      ) : null}
      {categories.length === 0 ? (
        <EmptyState
          title="Todavía sin carta"
          description={`${store.name} está armando su menú. Volvé más tarde.`}
        />
      ) : (
        <CatalogList store={store} categories={categories} />
      )}
    </>
  )
}
