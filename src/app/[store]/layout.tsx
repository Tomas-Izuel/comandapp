import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getStoreBySlug } from '@/models/store.model'
import { buildThemeCss, themeClass } from '@/lib/theme'
import { storeBasePath } from '@/lib/urls'
import { CartProvider } from '@/lib/cart'
import { StoreChrome } from '@/views/storefront/store-chrome'
import { StoreBasePathProvider } from '@/views/storefront/store-base-path'
import { PreviewBridge } from '@/views/storefront/preview-bridge'

/**
 * `generateMetadata`, este layout y `getStorefront` (para la page) llaman
 * los tres a `getStoreBySlug` — la misma función, sin alias intermedios
 * (A-08). Falta que `store.model.ts` la envuelva en `React.cache()` para que
 * la deduplicación entre los tres sea gratis (A-03); ese archivo no es de
 * este slice, así que queda reportado en la entrega.
 */
export async function generateMetadata(props: LayoutProps<'/[store]'>): Promise<Metadata> {
  const { store: slug } = await props.params
  const store = await getStoreBySlug(slug)
  if (!store) return { title: 'Local no encontrado' }
  return {
    title: store.name,
    description: store.description ?? `Pedí online en ${store.name}, pagá y seguí tu pedido sin escribirle a nadie.`,
    // El favicon subido por el local (F-08): antes se guardaba y nunca se
    // usaba en ningún lado. La URL ya pasa por `assetUrl` en el schema de
    // branding (http(s) estricto), así que es segura para un `<link>`.
    icons: store.branding.favicon_url ? { icon: store.branding.favicon_url } : undefined,
  }
}

/**
 * Inyecta el tema del local antes de que llegue un solo pixel de contenido:
 * `buildThemeCss` arma el <style> scopeado en `[data-store-theme]` y
 * `themeClass` decide si ese scope corre en variant `dark`. Sin JS, sin
 * flash — y a partir de acá todo shadcn se adapta solo.
 *
 * `headers()` no cambia la estrategia de render: este árbol ya es dinámico de
 * punta a punta (el cliente de Supabase con cookies, más abajo en
 * `getStoreBySlug`, ya lo exige). Se resuelve el `basePath` UNA VEZ acá —el
 * header `Host` no existe en el bundle del browser— y se provee al árbol
 * entero con `StoreBasePathProvider` (T6, `00-architecture.md` §2.1): sin
 * esto, todo `<Link>` interno de la vitrina quedaría hardcodeado a
 * `` `/${slug}` `` y duplicaría el path en un subdominio.
 */
export default async function StoreLayout(props: LayoutProps<'/[store]'>) {
  const { store: slug } = await props.params
  const store = await getStoreBySlug(slug)
  if (!store) notFound()

  const themeCss = buildThemeCss(store.branding)
  const themeCls = themeClass(store.branding)
  const host = (await headers()).get('host')
  const basePath = storeBasePath(store.slug, host)

  return (
    <div data-store-theme className={`${themeCls} bg-background text-foreground flex min-h-full flex-1 flex-col`}>
      {/* CSS ya validado por brandingSchema en el modelo */}
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <StoreBasePathProvider basePath={basePath}>
        <CartProvider storeSlug={store.slug}>
          <StoreChrome store={store}>{props.children}</StoreChrome>
        </CartProvider>
      </StoreBasePathProvider>
      {/* Después del <style> del tema real y de todo el árbol: a igual
          especificidad ([data-store-theme] en los dos), gana el que aparece
          último en el documento. Así `/admin/apariencia` puede previsualizar
          colores sin guardar nada — no hace nada fuera de `?preview=brand`. */}
      <PreviewBridge />
    </div>
  )
}
