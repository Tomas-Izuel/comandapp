import type { MetadataRoute } from 'next'
import { apexUrl } from '@/lib/urls'

/**
 * `apexUrl` es la misma función que arma cualquier link de plataforma
 * (magic link, `notification_url` de MP): así el origen de `robots.txt` y el
 * de `sitemap.xml` no pueden divergir del resto del sitio ni de
 * `NEXT_PUBLIC_SITE_URL`, que **siempre es el apex** (ver `src/lib/urls.ts`).
 *
 * No usa `headers()` ni ninguna API dinámica: el archivo tiene que poder
 * prerenderizarse en build, igual que la landing que describe.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // `/pedido` son URLs de UN pedido con un token de acceso en el path:
      // no son contenido para indexar, son una credencial.
      disallow: ['/admin', '/backoffice', '/repartidor', '/api', '/pedido'],
    },
    sitemap: apexUrl('/sitemap.xml'),
  }
}
