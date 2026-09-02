import { centsToDecimal } from '@/lib/money'
import { PRICING, PRODUCT_NAME, type Faq } from '@/lib/landing'
import { apexUrl } from '@/lib/urls'

/**
 * JSON-LD de la landing. Dos objetos, inyectados como `<script
 * type="application/ld+json">` desde `page.tsx`.
 *
 * Nada de `aggregateRating` ni de cifras de uso acá: `PRODUCT.md` y
 * `00-architecture.md` de este pipeline lo prohíben explícitamente porque no
 * existen, y `structured data` inventada es justo el tipo de dato que un
 * buscador puede marcar como engañoso.
 */

/** Forma mínima de JSON-LD que usamos: no traemos `schema-dts` por dos objetos. */
type JsonLd = Record<string, unknown>

/**
 * `SoftwareApplication` con la oferta real. El precio sale de `PRICING`, que
 * lo guarda en centavos — `centsToDecimal` es el mismo helper que usa el
 * borde de Mercado Pago, así que el JSON-LD nunca inventa su propia cuenta.
 *
 * No se declara `aggregateRating`: no hay reseñas que citar.
 */
export function buildSoftwareApplicationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: PRODUCT_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: apexUrl('/'),
    offers: {
      '@type': 'Offer',
      price: centsToDecimal(PRICING.monthlyCents).toFixed(2),
      priceCurrency: PRICING.currency,
      url: apexUrl('/'),
      // La prueba de 15 días está descripta en `description`, no en un campo
      // de precio: no hay un tipo de Offer de schema.org para "gratis por N
      // días y después este precio" que no termine forzando el dato.
      description: `${PRICING.trialDays} días de integración sin cargo. Después, por local por mes.`,
    },
  }
}

/** `FAQPage` desde las mismas preguntas que renderiza `Faq` en el Slice C. */
export function buildFaqPageJsonLd(items: readonly Faq[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }
}
