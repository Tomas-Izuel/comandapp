import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionHeading } from '@/views/shared/surfaces'
import { DEMO_ORDER, DEMO_THREAD, THREAD_COSTS } from '@/lib/landing'
import { VersusRace } from '@/views/landing/versus-race'

/**
 * "La carrera": el mismo pedido corriendo por los dos caminos a la vez —hoy
 * por WhatsApp, con ComandApp— en `VersusRace` (única isla cliente de esta
 * sección). El veredicto de acá abajo NO depende de que la escena haya
 * terminado de correr: son los dos números finales del guion (la última hora
 * de `DEMO_THREAD` y `DEMO_ORDER.timeline.ready`), así que se sirven siempre
 * — con JS, sin JS, o con `prefers-reduced-motion` el argumento de la
 * sección llega completo igual.
 *
 * Sin padding-top propio en el `<section>`: el que separa esta sección de la
 * franja del hero es el `pb` de esa franja (`hero.tsx`), no un padding
 * duplicado acá — la lección del pozo de la ronda anterior.
 */
export function TodayVersus() {
  const whatsappReadyAt = DEMO_THREAD[DEMO_THREAD.length - 1].at

  return (
    <section id="como-funciona" data-scroll-anchor data-landing-section className="px-4 pb-8 sm:px-6 sm:pb-10">
      <div className="mx-auto max-w-(--content-max)">
        <SectionHeading>El mismo pedido, dos maneras</SectionHeading>

        <VersusRace />

        <div className="border-border mt-6 flex flex-col gap-4 border-t pt-6 sm:mt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <p className="text-muted-foreground">
              Listo a las <span className="tabular text-foreground font-semibold">{whatsappReadyAt}</span> por
              WhatsApp
            </p>
            <p className="text-muted-foreground">
              Listo a las{' '}
              <span className="tabular text-(--brand-ink) font-semibold">{DEMO_ORDER.timeline.ready}</span> con
              ComandApp
            </p>
          </div>
          <p className="display text-(--brand-ink) text-base font-semibold sm:text-lg">
            Nadie del local escribe un solo mensaje.
          </p>
        </div>

        <ul className="mt-5 flex flex-col">
          {THREAD_COSTS.map((cost, index) => (
            <li
              key={cost}
              className={cn(
                'border-border flex items-start gap-2.5 border-t py-2.5 text-sm sm:text-base',
                index === 0 && 'border-t-0 pt-0',
              )}
            >
              <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="text-foreground">{cost}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
