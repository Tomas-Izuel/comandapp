import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getOrderStatus } from '@/controllers/checkout.controller'
import { getStoreBySlug } from '@/models/store.model'
import { buildThemeCss, themeClass } from '@/lib/theme'
import { parseStoreHost, storeUrl } from '@/lib/urls'
import { OrderTracking } from '@/views/storefront/order-tracking'
import { EmptyState } from '@/views/shared/states'
import { SiteFooter } from '@/views/shared/site-footer'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

/**
 * `metadataBase` es el origen EFECTIVO del pedido — el que arma `storeUrl`
 * para `order.storeSlug` — nunca el host que sirvió el request. Así una
 * imagen u og:url relativa se resuelve siempre contra el subdominio de la
 * tienda dueña (modo `subdomain`) o el apex (modo `path`), sin importar por
 * qué host haya entrado alguien a un link viejo.
 *
 * Repite la consulta que hace la page (mismo patrón no deduplicado que
 * `[store]/layout.tsx` ya documenta como pendiente — A-03 — no es de este
 * slice arreglarlo).
 */
export async function generateMetadata(props: PageProps<'/pedido/[token]'>): Promise<Metadata> {
  const { token } = await props.params
  const order = await getOrderStatus(token)
  if (!order) return {}
  return { metadataBase: new URL(storeUrl(order.storeSlug, '/')) }
}

export default async function OrderTrackingPage(props: PageProps<'/pedido/[token]'>) {
  const { token } = await props.params
  const order = await getOrderStatus(token)

  // El chequeo de host↔pedido va DESPUÉS de esta guarda, nunca antes: el
  // `public_token` es la única credencial del pedido, y un redirect que solo
  // ocurriera cuando el pedido existe (o no) sería un oráculo de existencia
  // filtrado por un 308 en vez de por el contenido de la página. Acá no hay
  // nada que corregir todavía — se responde igual que si el host coincidiera.
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

  // Coherencia host↔pedido (T7): esta ruta no se reescribe por host —a
  // propósito, para que el seguimiento quede en el mismo origen que el
  // carrito (§2.2 de 00-architecture.md)— así que sin esto
  // `otra-tienda.comandapp.ar/pedido/<token-de-la-birra>` serviría el tema y
  // el localStorage de "otra-tienda" mostrando un pedido ajeno.
  // `parseStoreHost` devuelve `null` para el apex, `localhost` y los hosts de
  // preview: ahí no hay nada que corregir, es el comportamiento de hoy. Solo
  // corrige cuando el host ES un subdominio de tienda y no coincide con la
  // tienda dueña del pedido.
  const requestSlug = parseStoreHost((await headers()).get('host'))
  if (requestSlug && requestSlug !== order.storeSlug) {
    permanentRedirect(storeUrl(order.storeSlug, `/pedido/${token}`))
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
