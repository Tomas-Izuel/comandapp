import { Mail } from 'lucide-react'
import { WhatsApp } from '@/components/ui/whatsapp'
import { CONTACT, WHATSAPP_MESSAGE, whatsappHref } from '@/lib/landing'

/**
 * La última banda antes del pie: navy, con el CTA grande y el mail de
 * respaldo para quien prefiere escribir antes de hablar. Es la segunda de
 * las tres bandas oscuras que la paleta reserva ("barra fija, cierre,
 * precio"), así que reusa el mismo par de tokens que `Pricing` y la barra
 * fija del Slice A: `bg-accent` / `text-accent-foreground`, nunca blanco.
 *
 * Debajo del botón se muestra el mensaje EXACTO que `whatsappHref()` va a
 * abrir: nadie toca un botón a ciegas sin saber qué va a decir en su nombre.
 */
export function Closing() {
  return (
    <section className="bg-accent">
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
        <h2 className="display text-accent-foreground text-3xl font-semibold sm:text-5xl">
          Dejá de perder ventas por WhatsApp
        </h2>
        <p className="text-accent-foreground max-w-[42ch] text-base sm:text-lg">
          Mandanos un mensaje y te mostramos el producto andando en tu propio celular.
        </p>

        <a
          href={whatsappHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation inline-flex h-14 items-center gap-2.5 rounded-pill px-8 text-base font-semibold transition-[background-color,transform] duration-(--dur-fast) active:scale-[0.97]"
        >
          <WhatsApp className="size-5 shrink-0 [&_path]:fill-current" aria-hidden />
          Hablar por WhatsApp
        </a>

        {/* La burbuja de chat: rótulo discreto (etiqueta de ESTA burbuja, no
            un kicker de sección) + el texto real de `WHATSAPP_MESSAGE`, en la
            paleta de ComandApp para que se lea como parte del producto y no
            como un clon de la interfaz de WhatsApp. */}
        <div className="flex max-w-xs flex-col items-center gap-1.5">
          <p className="text-accent-foreground/70 text-xs">Esto es lo que se manda</p>
          <p className="bg-(--brand-raise) text-accent-foreground rounded-lg px-4 py-3 text-left text-sm shadow-flat">
            {WHATSAPP_MESSAGE}
          </p>
        </div>

        <a
          href={`mailto:${CONTACT.email}`}
          className="text-accent-foreground inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline"
        >
          <Mail className="size-4" aria-hidden />o escribinos a {CONTACT.email}
        </a>
      </div>
    </section>
  )
}
