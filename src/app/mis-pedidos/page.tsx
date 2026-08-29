import { MyOrders } from '@/views/storefront/my-orders'
import { SiteFooter } from '@/views/shared/site-footer'

export const metadata = { title: 'Mis pedidos' }

export default function MyOrdersPage() {
  // `MyOrders` ya es `flex flex-1 flex-col`, así que ocupa el espacio
  // sobrante y el pie queda pegado abajo cuando hay poco contenido, o
  // después de la lista cuando hay pedidos de sobra para scrollear.
  return (
    <>
      <MyOrders />
      <SiteFooter />
    </>
  )
}
