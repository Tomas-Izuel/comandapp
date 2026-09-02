import type { MetadataRoute } from 'next'
import { apexUrl } from '@/lib/urls'

/**
 * Solo las tres rutas públicas y estáticas de la plataforma. El resto del
 * sitio es `/[store]/**`, `/pedido/[token]` y los paneles con auth: ninguno
 * de esos es contenido de plataforma que tenga sentido rankear acá (y
 * `/pedido` ni siquiera se quiere indexado, ver `robots.ts`).
 *
 * Sin `lastModified`: son páginas de texto legal/comercial versionadas en el
 * repo, no contenido con fecha de publicación real que valga declarar.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: apexUrl('/'), changeFrequency: 'monthly', priority: 1 },
    { url: apexUrl('/legal/terminos'), changeFrequency: 'yearly', priority: 0.3 },
    { url: apexUrl('/legal/privacidad'), changeFrequency: 'yearly', priority: 0.3 },
  ]
}
