import { SectionHeading } from '@/views/shared/surfaces'
import { EtaDemo } from '@/views/landing/eta-demo'
import { EventsDemo } from '@/views/landing/events-demo'

/**
 * Los DOS diferenciadores de PRODUCT.md ("Positioning"), como dos pruebas
 * interactivas y no dos párrafos con ícono: la ronda anterior los describía,
 * y son justamente los dos que se pueden DEMOSTRAR con la aritmética real del
 * producto (`00-architecture.md`, tesis). Separados por un divisor de 1px,
 * nunca como tarjetas — son los dos hechos más importantes de la página.
 */
export function WhatOnlyComandApp() {
  return (
    <section id="diferencias" data-scroll-anchor data-landing-section className="border-border border-t">
      <div className="mx-auto w-full max-w-(--content-max) px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading>Las dos cosas que WhatsApp no puede dar</SectionHeading>
        <div className="sm:divide-border mt-2 grid grid-cols-1 gap-10 sm:grid-cols-2 sm:divide-x">
          <div className="sm:pr-10">
            <EtaDemo />
          </div>
          <div className="sm:pl-10">
            <EventsDemo />
          </div>
        </div>
      </div>
    </section>
  )
}
