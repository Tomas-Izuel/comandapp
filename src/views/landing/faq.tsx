import { ChevronDown } from 'lucide-react'
import { SectionHeading, Panel } from '@/views/shared/surfaces'
import { WhatsApp } from '@/components/ui/whatsapp'
import { whatsappQuestionHref, type Faq as FaqItem } from '@/lib/landing'

/**
 * Las preguntas que un dueño de hamburguesería hace de verdad, no las que
 * quedan lindas. `q`/`a` como strings planos porque el Slice D las serializa
 * tal cual en el JSON-LD de `FAQPage` — nada de JSX acá adentro.
 */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: '¿Quién se queda con la plata de mis pedidos?',
    a: 'Nadie más que vos. Cada local cobra con SU PROPIA cuenta de Mercado Pago: la plata entra directo ahí, nunca pasa por ComandApp. Nosotros no tocamos un peso de tu venta.',
  },
  {
    q: '¿Y el sistema de gestión que ya uso en el local?',
    a: 'Seguís usándolo. Cada pedido sale como un evento hacia tu software, sea cual sea, sin que tengas que cargar nada dos veces ni cambiar cómo trabajás en la cocina.',
  },
  {
    q: '¿Cuánto tarda en arrancar?',
    a: 'Cargamos tu carta, tus fotos y tu marca (logo, colores, tipografía) y arrancás vos. No hay instalación de tu lado ni tenés que esperar a que un desarrollador te libere nada.',
  },
  {
    q: '¿El cliente tiene que instalar algo o crear una cuenta?',
    a: 'No a las dos. El cliente pide desde el navegador, sin bajar una app y sin registrarse. Sigue su pedido con un link y puede repetirlo la próxima vez sin haber creado nada.',
  },
  {
    q: '¿Puedo seguir cobrando en el mostrador?',
    a: 'Sí. Vos decidís si el local acepta pago al retirar además del pago online. Las dos formas conviven: un pedido puede estar listo y cobrarse recién cuando el cliente llega a buscarlo.',
  },
  {
    q: '¿Me quedo con mis clientes y sus datos?',
    a: 'Sí, son tuyos. Tenés el padrón completo de quién te compró, cuándo y qué pidió, para armar promociones o simplemente saber quién vuelve. No es un dato que le pertenezca a una plataforma de terceros.',
  },
  {
    q: '¿Qué pasa si no tengo fotos de todos los productos?',
    a: 'No queda un cuadro gris. Un producto sin foto se muestra con su nombre bien grande sobre tu color de marca, así que la carta se sigue viendo completa. Subís la foto cuando la tengas.',
  },
] as const

/**
 * `<details>`/`<summary>` nativos: el acordeón entero funciona sin una línea
 * de JavaScript de cliente. Nacen TODOS cerrados —decisión de dirección, no
 * ausencia de una— para que ninguna respuesta ocupe la página antes de que el
 * lector la pregunte.
 */
export function Faq() {
  return (
    <section id="faq" data-scroll-anchor data-landing-section className="bg-background">
      <div className="mx-auto w-full max-w-(--content-max) px-4 py-16 sm:px-6 sm:py-20">
        <SectionHeading as="h2">Antes de que preguntes</SectionHeading>

        <Panel elevated={false} className="mt-2 divide-y divide-border overflow-hidden p-0">
          {FAQ_ITEMS.map((item) => (
            // `name="faq"` hace el acordeón exclusivo con HTML nativo, sin una
            // línea de JS: abrir uno cierra el que estaba abierto.
            <details key={item.q} name="faq" className="group px-5 py-1 open:pb-5 sm:px-8">
              {/* `list-none` saca el triángulo en Firefox; el pseudo-elemento
                  de WebKit necesita su propio selector porque no responde a
                  `list-style`. El chevron ahora gira con transición: la
                  apertura de contenido la anima `globals.css`
                  (`interpolate-size` + `::details-content`), así que el
                  chevron no puede ser lo único que salta de golpe. */}
              {/* `summary` no está en el selector global de foco (ese cubre
                  a/button/input/select/textarea/[tabindex]), así que el
                  anillo se repite acá para que no dependa del azul por
                  defecto del navegador. */}
              <summary className="[&::-webkit-details-marker]:hidden outline-none focus-visible:outline-2 focus-visible:outline-(--ring) focus-visible:outline-offset-2 flex min-h-14 list-none items-center justify-between gap-4 rounded-lg py-4">
                <span className="text-foreground pr-2 text-base font-medium">{item.q}</span>
                <ChevronDown
                  className="text-muted-foreground group-open:rotate-180 size-5 shrink-0 transition-transform duration-(--dur-base) ease-(--ease-out-expo)"
                  aria-hidden
                />
              </summary>
              <p className="text-muted-foreground max-w-[65ch] pb-3 text-sm leading-relaxed">{item.a}</p>
              {/* Ninguna respuesta es un punto muerto: siempre hay a dónde ir
                  después de leerla. El mensaje llega ya redactado con la
                  pregunta puntual, no con el genérico de "quiero ver
                  ComandApp". */}
              <a
                href={whatsappQuestionHref(item.q)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--brand-ink) -mx-1 mb-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium underline-offset-4 hover:underline"
              >
                <WhatsApp className="size-4 shrink-0 [&_path]:fill-current" aria-hidden />
                Preguntar esto por WhatsApp
              </a>
            </details>
          ))}
        </Panel>
      </div>
    </section>
  )
}
