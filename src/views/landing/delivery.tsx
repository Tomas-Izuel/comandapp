import { DeliveryQuote } from '@/views/landing/delivery-quote'
import { SectionHeading } from '@/views/shared/surfaces'

/**
 * Los hechos del delivery, tal como está implementado (CLAUDE.md, "Delivery y
 * repartidores"): tarifa plana por tienda —no hay zonas ni distancia—, el
 * mínimo se mide sobre el subtotal, y la flota ocupada estira el ETA en vez
 * de apagar el envío. Ninguno es un adjetivo de venta: son restricciones
 * reales del modelo, dichas en la voz del que vende. Van como lista de
 * definiciones densa —término + una línea—, sin ícono en círculo: el ícono
 * ya no acompaña nada nuevo, es la MISMA idea que "grilla ícono+título+texto"
 * que el piso de calidad prohíbe como esqueleto de sección.
 */
const FACTS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: 'Repartidores propios del local',
    detail: 'No es un tercero que reparte para varios negocios a la vez: la flota es del local.',
  },
  {
    term: 'Tarifa plana, sin sorpresas',
    detail: 'Un solo costo de envío por tienda. No hay zonas ni cálculo por distancia.',
  },
  {
    term: 'Mínimo y envío gratis, a criterio del local',
    detail: 'El mínimo de pedido se mide sobre el subtotal, y el local puede regalar el envío a partir de un monto.',
  },
  {
    term: 'Portal propio para el repartidor',
    detail: 'Entra a su cola de entregas desde el celular, sin tocar el panel de cocina.',
  },
  {
    term: 'El tiempo se estira, el delivery no se apaga',
    detail: 'Si toda la flota está repartiendo, el tiempo estimado crece en vez de cerrar el envío.',
  },
]

/**
 * La captura del repartidor se fue al recorrido (`order-journey.tsx`, Slice
 * C): esta sección se queda con lo que se puede TOCAR — el cotizador — y con
 * los hechos del modelo de envío, sin evidencia visual duplicada.
 */
export function DeliverySection() {
  return (
    <section id="delivery" data-scroll-anchor data-landing-section className="border-border border-t">
      <div className="mx-auto w-full max-w-(--content-max) px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading>Delivery con flota propia</SectionHeading>
        <div className="mt-2 grid gap-10 lg:grid-cols-2 lg:items-start">
          <DeliveryQuote />
          <dl className="divide-border flex flex-col divide-y">
            {FACTS.map((fact) => (
              <div key={fact.term} className="flex flex-col gap-1 py-3 first:pt-0">
                <dt className="text-foreground text-sm font-semibold sm:text-base">{fact.term}</dt>
                <dd className="text-muted-foreground text-sm">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
