import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SiteFooter } from '@/views/shared/site-footer'

/**
 * Chasis de las páginas legales. Viven fuera de `/[store]` a propósito —son
 * de la plataforma, no de ningún local— así que no llevan tema de marca:
 * shadcn neutro, igual que `/admin` y `/backoffice`.
 *
 * Columna de lectura angosta (`--content-max`) porque esto es prosa, no
 * carta de productos: nada de tarjetas, nada de grillas.
 */
export default function LegalLayout({ children }: LayoutProps<'/legal'>) {
  return (
    <div className="bg-background text-foreground flex min-h-full flex-1 flex-col">
      <header className="border-border border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-(--content-max) items-center">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium transition-colors duration-(--dur-fast)"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            Volver al inicio
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-(--content-max) px-4 py-10 sm:px-6">{children}</div>
      </main>
      <SiteFooter />
    </div>
  )
}
