import { SectionHeading } from '@/views/shared/surfaces'
import { cn } from '@/lib/utils'

/**
 * Los mismos 16 hechos confirmados de la ronda anterior (PRODUCT.md,
 * "Capabilities and Constraints") — el TEXTO no cambia, son afirmaciones ya
 * verificadas contra el código. Lo que cambia es la agrupación: por QUIÉN los
 * usa, no una lista plana de tildes. Cuatro columnas densas con subtítulo,
 * sin ícono ni tarjeta: es una lista, no un checklist de features de landing.
 *
 * `03-review.md` (hallazgo 5) marcó el desbalance: "Para tu cliente" trae 9
 * ítems contra 2/3/2 de las otras tres, así que en `lg:` esas tres quedaban
 * con más de la mitad de la columna vacía. La proporción de la grilla pasa a
 * `2fr 1fr 1fr 1fr` y el primer grupo fluye en dos sub-columnas
 * (`lg:columns-2`) dentro de su propio ancho — sin tocar el texto de ningún
 * ítem ni reagrupar quién usa qué.
 */
type Group = { readonly title: string; readonly items: readonly string[] }

const GROUPS: readonly Group[] = [
  {
    title: 'Para tu cliente',
    items: [
      'Catálogo con categorías, productos y modificadores',
      'Carrito sin cuenta y sin instalar nada',
      'Retiro en el local',
      'Delivery con repartidores propios',
      'Pago online con la cuenta de Mercado Pago del local',
      'Pago al retirar, si el local lo habilita',
      'Seguimiento del pedido por link',
      '"Mis pedidos" desde el navegador',
      'Repetir un pedido anterior con un toque',
    ],
  },
  {
    title: 'Para el mostrador',
    items: ['Panel de cocina para el mostrador', 'ABM de catálogo con foto'],
  },
  {
    title: 'Para vos',
    items: ['Dashboard de ventas', 'Cupones y campañas', 'Padrón de clientes'],
  },
  {
    title: 'Para tu marca',
    items: ['La web con la marca del local: logo, colores, tipografía y portada', 'Subdominio propio para el local'],
  },
]

export function WhatsIncluded() {
  return (
    <section id="incluido" data-scroll-anchor data-landing-section className="border-border border-t">
      <div className="mx-auto w-full max-w-(--content-max) px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading>Lo que ya viene armado</SectionHeading>
        <p className="text-muted-foreground max-w-[60ch] text-sm sm:text-base">
          Un local que se pasa a ComandApp no arranca con una carta vacía y una promesa: esto es lo que hay, hoy.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          {GROUPS.map((group, index) => {
            const isPrimary = index === 0
            return (
              <div key={group.title} className={cn('flex flex-col', isPrimary && 'sm:col-span-2 lg:col-span-1')}>
                <h3 className="display text-foreground mb-2 text-sm font-semibold">{group.title}</h3>
                <ul
                  className={cn(
                    'divide-border flex flex-col divide-y',
                    isPrimary && 'lg:block lg:columns-2 lg:gap-x-8',
                  )}
                >
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className={cn(
                        'text-foreground py-2.5 text-sm first:pt-0 sm:text-[0.9rem]',
                        isPrimary && 'lg:break-inside-avoid',
                      )}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
