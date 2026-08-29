import Link from 'next/link'
import { Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

const CONTACT_EMAIL = 'tomasizuel@gmail.com'

/**
 * Pie de página de la cara del cliente. Es lo único de la plataforma que el
 * cliente llega a ver, así que va discreto y al pie: texto chico, muted,
 * separado por un borde — nunca una sección de marketing que compita con la
 * marca del local.
 *
 * Server Component: no hay estado ni interacción, solo dos links y un
 * `mailto:`. Vive al final del árbol de cada página de la cara del cliente
 * (nunca dentro de `/producto`, `/carrito` ni `/checkout`, que tienen su
 * propia `ActionBar` fija al pie).
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-border border-t', className)}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-5 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-sm">¿Tenés un local y querés vender online? Escribinos a</p>
          {/* Línea propia en vez de un link metido en la oración: adentro de
              una frase, forzar el piso de 44px de alto rompe la tipografía;
              como fila aparte, el padding llega al piso sin agrandar el texto. */}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-foreground hover:text-primary -mx-1 flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-sm font-medium underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            <Mail className="size-4 shrink-0" aria-hidden />
            {CONTACT_EMAIL}
          </a>
        </div>

        <nav aria-label="Legal" className="flex items-center gap-1 text-sm">
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
      </div>
    </footer>
  )
}
