import { getOrderStatus } from '@/controllers/checkout.controller'
import { getStoreBySlug } from '@/models/store.model'
import { buildThemeCss, themeClass } from '@/lib/theme'
import { OrderTracking } from '@/views/storefront/order-tracking'
import { EmptyState } from '@/views/shared/states'
import { SiteFooter } from '@/views/shared/site-footer'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function OrderTrackingPage(props: PageProps<'/pedido/[token]'>) {
  const { token } = await props.params
  const order = await getOrderStatus(token)

  if (!order) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <EmptyState
          className="flex-1"
          title="No encontramos este pedido"
          description="Revisá el link que te compartieron — puede tener un error, o el pedido ya no está disponible."
          action={
            <Button asChild size="lg" className="h-11">
              <Link href="/mis-pedidos">Ver mis pedidos</Link>
            </Button>
          }
        />
        <SiteFooter />
      </div>
    )
  }

  // Mismo tema del local para que el seguimiento se sienta parte de la misma
  // web, aunque esta ruta viva afuera de /[store]. Si el local ya no está
  // disponible, el seguimiento igual se muestra, sin tema. Es una lectura
  // plana (sin orquestar nada más), así que llama al modelo directo en vez
  // de pasar por un alias del controller que no aportaba nada (A-08).
  const store = await getStoreBySlug(order.storeSlug)
  const themeCss = store ? buildThemeCss(store.branding) : null
  const themeCls = store ? themeClass(store.branding) : ''

  return (
    <div data-store-theme className={`${themeCls} bg-background text-foreground flex min-h-full flex-1 flex-col`}>
      {/* CSS ya validado por brandingSchema en el modelo */}
      {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      <OrderTracking token={token} initialOrder={order} timezone={store?.timezone} />
      {/* Adentro del div con `data-store-theme`: así el pie hereda el tema
          del local igual que el resto de esta página, aunque la ruta viva
          afuera de `/[store]`. */}
      <SiteFooter />
    </div>
  )
}
