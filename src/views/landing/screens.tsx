import { JOURNEY } from '@/lib/landing'
import { SectionHeading } from '@/views/shared/surfaces'
import { OrderJourneyClient } from '@/views/landing/order-journey'

/**
 * "El recorrido de un pedido": las cinco estaciones de `JOURNEY` —compra,
 * cocina, espera, reparto, caja— como UN solo recorrido, no una galería de
 * capturas sueltas. Reemplaza a la vieja `ThreeScreens` (grilla 2×2), que
 * mostraba la evidencia sin dejarla contar una historia.
 *
 * Server Component puro: cero estado, cero `'use client'` acá. Toda la
 * orquestación de scroll —sticky en desktop, scroll-snap en mobile,
 * `IntersectionObserver` para saber qué estación está activa— vive en la isla
 * cliente `order-journey.tsx`. Esta sección solo arma el esqueleto semántico
 * (el `id` que ancla la barra de progreso y el título) y le pasa el contrato
 * ya tipado.
 */
export function OrderJourney() {
  return (
    <section id="recorrido" data-scroll-anchor data-landing-section className="border-border border-t">
      <div className="mx-auto w-full max-w-(--content-max) px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading>El recorrido de un pedido</SectionHeading>
        <OrderJourneyClient stations={JOURNEY} />
      </div>
    </section>
  )
}
