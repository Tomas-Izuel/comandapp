import { notFound } from 'next/navigation'
import { getProductDetail } from '@/controllers/storefront.controller'
import { ProductDetailView } from '@/views/storefront/product-detail'

export default async function ProductPage(props: PageProps<'/[store]/producto/[id]'>) {
  const { store: slug, id } = await props.params
  const productId = Number(id)
  if (!Number.isInteger(productId) || productId <= 0) notFound()

  // `categoryName` no se usa acá: mostrarlo como texto arriba del nombre del
  // producto sería un kicker, y el contrato de dirección lo prohíbe sin
  // excepciones. El controller lo sigue devolviendo (lo pide otro consumidor
  // del mismo tipo `ProductDetailData`), así que queda sin usar de este lado
  // a propósito, no por descuido.
  const { store, product } = await getProductDetail(slug, productId)

  return <ProductDetailView store={store} product={product} />
}
