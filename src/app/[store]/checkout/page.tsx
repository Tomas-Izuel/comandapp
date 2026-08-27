import { getStoreForSlug } from '@/controllers/storefront.controller'
import { CheckoutForm } from '@/views/storefront/checkout-form'
import { ClosedNotice, EmptyState } from '@/views/shared/states'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function CheckoutPage(props: PageProps<'/[store]/checkout'>) {
  const { store: slug } = await props.params
  const store = await getStoreForSlug(slug)

  if (!store.acceptingOrders) {
    return (
      <>
        <ClosedNotice storeName={store.name} />
        <EmptyState
          className="flex-1"
          title="No se puede pedir ahora"
          description={`${store.name} no está tomando pedidos en este momento. Podés ver la carta y volver más tarde.`}
          action={
            <Button asChild size="lg" className="h-11">
              <Link href={`/${store.slug}`}>Volver a la carta</Link>
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
