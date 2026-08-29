import { headers } from 'next/headers'
import { getStoreForSlug } from '@/controllers/storefront.controller'
import { storeBasePath } from '@/lib/urls'
import { CheckoutForm } from '@/views/storefront/checkout-form'
import { ClosedNotice, EmptyState } from '@/views/shared/states'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function CheckoutPage(props: PageProps<'/[store]/checkout'>) {
  const { store: slug } = await props.params
  const store = await getStoreForSlug(slug)

  if (!store.acceptingOrders) {
    // Server Component: no hay `useStoreBasePath()` acá (es un hook de
    // Client Component). Mismo contrato que el layout — `storeBasePath()`
    // sobre el header `Host` — para no reinventar la derivación (T6).
    const host = (await headers()).get('host')
    const basePath = storeBasePath(store.slug, host)
    return (
      <>
        <ClosedNotice storeName={store.name} />
        <EmptyState
          className="flex-1"
          title="No se puede pedir ahora"
          description={`${store.name} no está tomando pedidos en este momento. Podés ver la carta y volver más tarde.`}
          action={
            <Button asChild size="lg" className="h-11">
              <Link href={basePath || '/'}>Volver a la carta</Link>
            </Button>
          }
        />
      </>
    )
  }

  return (
    <CheckoutForm
      storeSlug={store.slug}
      currency={store.currency}
      storeAddress={store.address}
      inStorePaymentEnabled={store.inStorePaymentEnabled}
    />
  )
}
