import Link from 'next/link'
import { cn } from '@/lib/utils'

const CONTACT_EMAIL = 'hola@comandapp.ar'

/**
 * Pie de página de la cara del cliente. Es lo único de la plataforma que el
 * cliente llega a ver, así que va discreto y al pie: una sola fila, todo en
 * tono `muted`, sin ícono — nunca una sección que compita con la marca del
 * local (marca propia, nunca marketplace). Sigue llevando una captación para
 * el próximo local (es el único canal del SaaS para eso), pero reducida a
 * una etiqueta corta con el mismo peso que un link legal, no a una oración
 * que le habla directo al lector.
 *
 * Server Component: no hay estado ni interacción, solo tres links y un
 * `mailto:`. Vive al final del árbol de cada página de la cara del cliente
 * (nunca dentro de `/producto`, `/carrito` ni `/checkout`, que tienen su
 * propia `ActionBar` fija al pie).
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-border border-t', className)}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-6">
        <nav aria-label="Legal" className="flex items-center gap-1 text-xs">
          <Link
            href="/legal/privacidad"
            className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center rounded-lg px-1 underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            Privacidad
          </Link>
          <span className="text-muted-foreground/50" aria-hidden>
            ·
          </span>
          <Link
            href="/legal/terminos"
            className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center rounded-lg px-1 underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            Términos
          </Link>
        </nav>

        {/* La etiqueta ("¿Tenés un local?") queda como texto plano AFUERA del
            <a>: adentro, el subrayado de hover se comería la frase entera en
            vez de marcar solo lo que se puede tocar, y un <span> no
            interactivo no necesita cargar con el piso de 44px. El target
            táctil lo resuelve el mailto solo, igual que cada link del nav de
            arriba — la etiqueta se apoya en su altura sin sumar una propia. */}
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <span>¿Tenés un local?</span>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="hover:text-foreground -mx-1 flex min-h-11 items-center rounded-lg px-1 underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </footer>
  )
}
