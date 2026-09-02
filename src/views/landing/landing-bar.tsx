import Image from 'next/image'
import Link from 'next/link'
import { WhatsApp } from '@/components/ui/whatsapp'
import { PRODUCT_NAME, whatsappHref } from '@/lib/landing'
import { ReadingProgressBar, SectionLabel } from '@/views/landing/landing-bar-progress'

/**
 * La barra que acompaña todo el scroll. Es la elevación "el marco trabaja"
 * (ver `00-architecture.md`): el CTA de WhatsApp está a un toque siempre, no
 * solo al final de la página. Esta ronda le suma dos señales de que el marco
 * SIGUE el scroll en vez de solo flotar encima: la línea de progreso de
 * lectura (`ReadingProgressBar`) y, desde `md:`, el rótulo de la sección
 * vigente (`SectionLabel`) — las dos en `landing-bar-progress.tsx` porque
 * comparten el mismo `IntersectionObserver` sobre `SECTIONS`.
 *
 * Vidrio claro (`bg-background/80` + `backdrop-blur`), no banda navy: el
 * navy queda reservado para el precio y el cierre — eran tres bandas oscuras
 * y era una de más. El logo va tal cual el archivo transparente, sin la
 * placa que hacía falta cuando el fondo era oscuro: sobre un fondo claro el
 * "Comand" en tinta oscura se lee solo. El filete de 1px abajo no es
 * decoración — una barra translúcida sin un borde que la separe del
 * contenido flota sin apoyarse en nada apenas el usuario scrollea; la línea
 * de progreso se dibuja ENCIMA de ese filete, no en su lugar.
 *
 * `header` sigue siendo Server Component: `relative` es lo único nuevo que
 * necesita, para anclar la línea de progreso (`absolute`) a su borde
 * inferior. Las dos islas cliente son las que miden scroll e intersección.
 */
export function LandingBar() {
  return (
    <header className="bg-background/80 border-border sticky top-0 z-50 border-b backdrop-blur-md relative">
      <div className="mx-auto flex max-w-(--content-max) items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link
          href="/"
          aria-label={`${PRODUCT_NAME}, ir al inicio`}
          className="flex h-11 shrink-0 items-center rounded-xl opacity-100 transition-opacity duration-(--dur-fast) hover:opacity-75"
        >
          {/*
           * `aspect-[2850/826]` es la proporción real del archivo (verificada
           * con `sips`: el PNG mide 2850×826, no los 1418×826 que se asumían
           * antes). Con esa proporción real mal declarada, `object-contain`
           * mandaba por el ANCHO de la caja y dejaba el logo con solo ~14px
           * de alto dentro de una caja de 28 — de ahí el ~50px de ancho
           * final que reportó la inspección. Ahora la caja se dimensiona por
           * ANCHO (`w-*`, con el alto libre por `aspect-*`), que es el eje
           * que de verdad limita a un wordmark horizontal así de apaisado.
           */}
          <span className="relative block aspect-[2850/826] w-26 md:w-32">
            <Image
              src="/full-logo-horizontal.png"
              alt=""
              fill
              sizes="(min-width: 768px) 128px, 104px"
              loading="eager"
              className="object-contain object-left"
            />
          </span>
        </Link>

        <SectionLabel />

        <a
          href={whatsappHref()}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hablar por WhatsApp, abre en otra pestaña"
          className="bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation inline-flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-semibold transition-[background-color,transform] duration-(--dur-fast) active:scale-[0.97]"
        >
          {/*
           * El SVG compartido trae `fill="#25D366"` fijo en el `<path>` (está
           * bien así sobre blanco, en el KDS y el panel). Acá vive sobre
           * `bg-primary`, que es el mismo verde: sin forzar el fill, el ícono
           * desaparece. `[&_path]:fill-current` gana porque un atributo de
           * presentación SVG tiene especificidad cero frente a cualquier
           * regla CSS, así que toma el `currentColor` del botón — navy sobre
           * verde da 7.93, pasa de sobra.
           */}
          <WhatsApp className="size-4 shrink-0 [&_path]:fill-current" aria-hidden />
          <span className="hidden sm:inline">Hablar por WhatsApp</span>
          <span className="sm:hidden">WhatsApp</span>
        </a>
      </div>
      <ReadingProgressBar />
    </header>
  )
}
