import { getStoreForSlug } from '@/controllers/storefront.controller'
import { getStoreHoursData } from '@/models/store-hours.model'
import { storefrontGate } from '@/lib/store-hours'
import { CartView } from '@/views/storefront/cart-view'

export default async function CartPage(props: PageProps<'/[store]/carrito'>) {
  const { store: slug } = await props.params
  const store = await getStoreForSlug(slug)
  const schedule = await getStoreHoursData(store.id)
  const gate = storefrontGate(store, schedule, new Date(), store.timezone)

  // `closed_by_hours` NO bloquea el carrito: es la única rama con salida
  // (programar), y esa decisión se resuelve en el checkout, no acá. Los
  // otros tres estados de la precedencia siguen bloqueando, idéntico a hoy.
  const blocked = gate.kind !== 'open' && gate.kind !== 'closed_by_hours'

  return <CartView storeSlug={store.slug} storeName={store.name} currency={store.currency} blocked={blocked} />
}
