import { getStoreForSlug } from '@/controllers/storefront.controller'
import { CartView } from '@/views/storefront/cart-view'

export default async function CartPage(props: PageProps<'/[store]/carrito'>) {
  const { store: slug } = await props.params
  const store = await getStoreForSlug(slug)

  return <CartView storeSlug={store.slug} storeName={store.name} currency={store.currency} acceptingOrders={store.acceptingOrders} />
}
