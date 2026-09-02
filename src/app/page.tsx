import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@/lib/landing'
import { apexUrl } from '@/lib/urls'
import { buildFaqPageJsonLd, buildSoftwareApplicationJsonLd } from '@/lib/seo'
import { LandingBar } from '@/views/landing/landing-bar'
import { LandingHero } from '@/views/landing/hero'
import { TodayVersus } from '@/views/landing/versus'
// `OrderJourney` es el export nuevo de `screens.tsx` (Slice C): mientras ese
// slice no lo escriba, `tsc` va a marcar este import como faltante — es el
// único error esperado hasta que los cinco slices converjan.
import { OrderJourney } from '@/views/landing/screens'
import { WhatOnlyComandApp } from '@/views/landing/edge'
import { DeliverySection } from '@/views/landing/delivery'
import { WhatsIncluded } from '@/views/landing/included'
import { Pricing } from '@/views/landing/pricing'
import { Faq, FAQ_ITEMS } from '@/views/landing/faq'
import { Closing } from '@/views/landing/closing'
import { LandingFooter } from '@/views/landing/landing-footer'

const TITLE = `${PRODUCT_NAME} — pedidos online para tu hamburguesería`
const DESCRIPTION =
  'La web de pedidos con la marca de tu local: catálogo, pago con tu propia cuenta de Mercado Pago, ' +
  'delivery con tus repartidores y panel de cocina. 15 días de integración sin cargo.'

/**
 * `metadataBase` acá adentro, no en el root layout: la landing es la única
 * ruta que necesita `alternates.canonical` y OpenGraph con URL absoluta, y
 * `apexUrl('/')` es la misma función que arma cualquier otro link de
 * plataforma — así el origen de la preview de WhatsApp nunca puede divergir
 * de `NEXT_PUBLIC_SITE_URL`.
 *
 * La preview de WhatsApp es lo primero que ve el lector (llega por un link
 * mandado a mano), así que OpenGraph y Twitter card se tratan como parte del
 * primer viewport, no como metadata de relleno.
 */
export const metadata: Metadata = {
  metadataBase: new URL(apexUrl('/')),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: PRODUCT_NAME,
    locale: 'es_AR',
    type: 'website',
    images: [
      {
        url: '/landing/og.jpg',
        width: 1200,
        height: 630,
        alt: `${PRODUCT_NAME} — pedidos online para tu local`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/landing/og.jpg'],
  },
}

/**
 * Routing fino: compone las once secciones en el orden que fijó
 * `01-tasks.md` de la ronda "la página es la demo" y no dibuja nada propio.
 * `[data-comandapp]` es el scope de paleta de plataforma en `globals.css` —
 * no toca `:root`, que es el tema neutro de `/admin` y `/backoffice`.
 *
 * El orden ahora sigue el recorrido del pedido #A2A1: la carrera contra
 * WhatsApp, el recorrido de las cinco estaciones, las dos pruebas
 * interactivas, delivery, qué incluye, precio, FAQ y cierre.
 *
 * Cero llamada al servidor: todo el contenido es estático, así que
 * `npm run build` tiene que marcar esta ruta como prerenderizada.
 */
export default function LandingPage() {
  const softwareApplicationJsonLd = buildSoftwareApplicationJsonLd()
  const faqPageJsonLd = buildFaqPageJsonLd(FAQ_ITEMS)

  return (
    <div data-comandapp>
      <LandingBar />
      <LandingHero />
      <TodayVersus />
      <OrderJourney />
      <WhatOnlyComandApp />
      <DeliverySection />
      <WhatsIncluded />
      <Pricing />
      <Faq />
      <Closing />
      <LandingFooter />
      {/* JSON-LD: dos objetos, sin `aggregateRating` ni métrica de uso — no
          existen y sería marcado como structured data engañoso. Contenido
          propio (no texto de un tercero), así que no hay riesgo de inyección
          por usar `dangerouslySetInnerHTML` acá. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd) }} />
    </div>
  )
}
