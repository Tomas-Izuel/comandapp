import { WhatsApp } from '@/components/ui/whatsapp'
import { Panel } from '@/views/shared/surfaces'
import { PRICING, whatsappHref } from '@/lib/landing'
import { PricingCalculator } from '@/views/landing/pricing-calculator'

/**
 * El precio, en la banda oscura que la paleta reserva para "barra fija,
 * cierre, precio" (ver el comentario de `[data-comandapp]` en globals.css).
 * Un dueño que recibe este link sin contexto decide leyendo el número, así
 * que va con su propia banda en vez de esperar al final de la página.
 *
 * La aritmética de "¿cuántos locales?" vive en `PricingCalculator`, la única
 * isla cliente de esta sección: acá no hay un segundo local hardcodeado ni
 * una franja de texto que obligue al lector a hacer la cuenta él mismo.
 */
export function Pricing() {
  return (
    <section id="precio" data-scroll-anchor data-landing-section className="bg-accent">
      <div className="mx-auto w-full max-w-(--content-max) px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-xl text-center">
          {/* Sin kicker: el título se sostiene solo. */}
          <h2 className="display text-accent-foreground text-3xl font-semibold sm:text-4xl">
            Lo que cuesta, sin letra chica
          </h2>
          <p className="text-accent-foreground mt-3 text-base sm:text-lg">
            Un precio por local. Nada de plan &ldquo;a consultar&rdquo;.
          </p>
        </div>

        {/* Panel blanco elevado sobre la banda navy: es la única cifra que
            tiene que leerse sin esfuerzo, así que se despega del fondo. */}
        <Panel className="mx-auto mt-10 max-w-xl overflow-hidden p-0">
          <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-6 text-center sm:px-10">
            <p className="text-foreground text-base font-semibold">
              {PRICING.trialDays} días con la integración ya hecha, sin pagar nada
            </p>
            <p className="text-muted-foreground max-w-[36ch] text-sm">
              Si no te sirve, te vas y no pagaste un peso.
            </p>
          </div>

          <PricingCalculator />
        </Panel>

        <div className="mt-8 flex justify-center">
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation inline-flex h-12 items-center gap-2 rounded-pill px-6 text-sm font-semibold transition-[background-color,transform] duration-(--dur-fast) active:scale-[0.97]"
          >
            <WhatsApp className="size-4 shrink-0 [&_path]:fill-current" aria-hidden />
            Empezar por WhatsApp
          </a>
        </div>
      </div>
    </section>
  )
}
