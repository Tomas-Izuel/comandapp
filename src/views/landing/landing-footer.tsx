import Image from 'next/image'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { CONTACT, PRODUCT_NAME } from '@/lib/landing'

/**
 * Pie de la landing. NO reusa `SiteFooter`: ese lleva "¿Tenés un local?",
 * que acá es absurdo porque el lector de esta página YA ES el local. El
 * mismo isotipo horizontal de la barra fija (acá sobre fondo claro, sin
 * necesitar la placa que la barra le arma sobre navy), los dos links legales
 * y el mail — nada más, y nada de estructura nueva.
 */
export function LandingFooter() {
  return (
    <footer className="bg-background border-border border-t">
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col items-center gap-4 px-4 py-8 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
        {/* `width`/`height` reales del archivo (2850×826), no una caja
            recortada por `fill`: a ~48px de ancho el logo se leía como un
            ícono borroso, no como una marca. */}
        <Image
          src="/full-logo-horizontal.png"
          alt={PRODUCT_NAME}
          width={2850}
          height={826}
          loading="lazy"
          className="h-auto w-26 shrink-0"
        />

        <nav aria-label="Legal" className="flex items-center gap-1 text-sm">
          <Link
            href="/legal/terminos"
            className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center rounded-lg px-1 underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            Términos
          </Link>
          <span className="text-muted-foreground/50" aria-hidden>
            ·
          </span>
          <Link
            href="/legal/privacidad"
            className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center rounded-lg px-1 underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
          >
            Privacidad
          </Link>
        </nav>

        <a
          href={`mailto:${CONTACT.email}`}
          className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm underline-offset-4 transition-colors duration-(--dur-fast) hover:underline"
        >
          <Mail className="size-4" aria-hidden />
          {CONTACT.email}
        </a>
      </div>
    </footer>
  )
}
