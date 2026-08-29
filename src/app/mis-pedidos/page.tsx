import { headers } from 'next/headers'
import { MyOrders } from '@/views/storefront/my-orders'
import { SiteFooter } from '@/views/shared/site-footer'

export const metadata = { title: 'Mis pedidos' }

/**
 * Vive fuera de `/[store]`, así que no hay `StoreBasePathProvider`: cada fila
 * de la lista es de una tienda distinta (o de la misma, según el host), y esa
 * tienda no se conoce hasta que `MyOrders` lee `localStorage` en el cliente.
 * Por eso lo que baja de acá es el header `Host` crudo, no un `basePath` ya
 * resuelto — `MyOrders` resuelve uno por fila con `storeBasePath(slug, host)`
 * (T6, `00-architecture.md` §5.1: en un subdominio de tienda, "Reiterar" ya
 * está en el origen de esa tienda, así que el link es `/?reorder=...`; en
 * cualquier otro host es `` /${slug}?reorder=... `` como hoy).
 */
export default async function MyOrdersPage() {
  const host = (await headers()).get('host')
  // `MyOrders` ya es `flex flex-1 flex-col`, así que ocupa el espacio
  // sobrante y el pie queda pegado abajo cuando hay poco contenido, o
  // después de la lista cuando hay pedidos de sobra para scrollear.
  return (
    <>
      <MyOrders host={host} />
      <SiteFooter />
    </>
  )
}
