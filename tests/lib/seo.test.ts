import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRICING, type Faq } from '@/lib/landing'

/**
 * `src/lib/seo.ts` cuelga de `apexUrl` (`@/lib/urls`), que lee `clientEnv` al
 * IMPORTARSE — mismo problema que documenta `tests/lib/urls.test.ts`. Hay que
 * fijar el entorno antes de importar el módulo y resetear el registro entre
 * casos para que no dependa de qué test corrió antes en el mismo worker.
 */
vi.mock('server-only', () => ({}))

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  NEXT_PUBLIC_SITE_URL: 'https://comandapp.ar',
}

const ENV_KEYS = Object.keys(BASE_ENV)
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

async function loadSeo() {
  vi.resetModules()
  return import('@/lib/seo')
}

describe('buildSoftwareApplicationJsonLd — el precio del Offer', () => {
  it('emite el precio en UNIDADES DECIMALES, no en centavos: publicar 5999900 le diría a Google que sale $5.999.900 por mes', async () => {
    const { buildSoftwareApplicationJsonLd } = await loadSeo()
    const jsonLd = buildSoftwareApplicationJsonLd() as { offers: { price: string; priceCurrency: string } }

    // Valor exacto, no solo "es menor que los centavos": PRICING.monthlyCents
    // es 5_999_900 (=$59.999,00), así que el Offer tiene que decir "59999.00".
    expect(jsonLd.offers.price).toBe('59999.00')
    expect(jsonLd.offers.price).toBe((PRICING.monthlyCents / 100).toFixed(2))
    expect(jsonLd.offers.price).not.toBe(String(PRICING.monthlyCents))
  })

  it('la moneda del Offer es la que declara PRICING, no una hardcodeada aparte', async () => {
    const { buildSoftwareApplicationJsonLd } = await loadSeo()
    const jsonLd = buildSoftwareApplicationJsonLd() as { offers: { priceCurrency: string } }

    expect(jsonLd.offers.priceCurrency).toBe(PRICING.currency)
  })

  it('no inventa evidencia: ni aggregateRating, ni review, ni ratingValue en NINGÚN nivel del objeto', async () => {
    const { buildSoftwareApplicationJsonLd } = await loadSeo()
    const serialized = JSON.stringify(buildSoftwareApplicationJsonLd())

    // PRODUCT.md y 00-architecture.md prohíben testimonios/métricas de uso
    // explícitamente: no existen, y "structured data" que los inventa es
    // exactamente lo que un buscador marca como engañoso.
    expect(serialized).not.toMatch(/aggregateRating/i)
    expect(serialized).not.toMatch(/"review"/i)
    expect(serialized).not.toMatch(/ratingValue/i)
  })
})

describe('buildFaqPageJsonLd — una Question por FAQ_ITEMS, el texto sale de los datos', () => {
  const items: readonly Faq[] = [
    { q: '¿Pregunta uno?', a: 'Respuesta uno.' },
    { q: '¿Pregunta dos?', a: 'Respuesta dos.' },
    { q: '¿Pregunta tres?', a: 'Respuesta tres.' },
  ]

  it('produce exactamente una Question por item, en el mismo orden, con acceptedAnswer completo', async () => {
    const { buildFaqPageJsonLd } = await loadSeo()
    const jsonLd = buildFaqPageJsonLd(items) as {
      '@type': string
      mainEntity: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[]
    }

    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.mainEntity).toHaveLength(items.length)
    jsonLd.mainEntity.forEach((entry, i) => {
      expect(entry['@type']).toBe('Question')
      expect(entry.name).toBe(items[i].q)
      expect(entry.acceptedAnswer['@type']).toBe('Answer')
      expect(entry.acceptedAnswer.text).toBe(items[i].a)
    })
  })

  it('no duplica el texto a mano: contra las FAQ_ITEMS reales de src/views/landing/faq.tsx, no una copia local', async () => {
    const { buildFaqPageJsonLd } = await loadSeo()
    const { FAQ_ITEMS } = await import('@/views/landing/faq')
    const jsonLd = buildFaqPageJsonLd(FAQ_ITEMS) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }

    expect(jsonLd.mainEntity).toHaveLength(FAQ_ITEMS.length)
    expect(jsonLd.mainEntity.map((e) => e.name)).toEqual(FAQ_ITEMS.map((f) => f.q))
    expect(jsonLd.mainEntity.map((e) => e.acceptedAnswer.text)).toEqual(FAQ_ITEMS.map((f) => f.a))
  })

  it('BORDE: con cero preguntas devuelve mainEntity vacío, no tira', async () => {
    const { buildFaqPageJsonLd } = await loadSeo()
    const jsonLd = buildFaqPageJsonLd([]) as { mainEntity: unknown[] }

    expect(jsonLd.mainEntity).toEqual([])
  })
})
