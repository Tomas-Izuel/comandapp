import Image from 'next/image'
import { Clock, MapPin, Wallet } from 'lucide-react'
import { PhotoFrame } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { cn } from '@/lib/utils'
import type { StoreWithBranding } from '@/models/types'

/**
 * Primer viewport de la vitrina: portada del local a sangre, identidad
 * (logo + nombre) y una fila de datos honestos —abierto/cerrado, minutos
 * estimados, retiro, mínimo de pedido.
 *
 * CONTRASTE (F-08, resuelto). Antes `hero_image_url` no se renderizaba: el
 * comentario decía que `ensureContrast()` garantiza 4.5:1 solo contra
 * `bg-primary` SÓLIDO (`buildThemeCss`, `src/lib/theme.ts`), y una foto de un
 * local cualquiera detrás del texto puede tener cualquier luminosidad —la
 * garantía no sobrevive a texto puesto directo sobre píxeles arbitrarios, y
 * una opacidad sobre el texto no arregla nada (sigue habiendo foto detrás).
 * Ese problema es real y esto lo resuelve así: la foto ocupa su PROPIA banda
 * (`PhotoFrame`, sin texto adentro) y la identidad + los datos viven en una
 * banda SEPARADA, 100% opaca, `bg-primary`/`text-primary-foreground` — los
 * mismos tokens que `ensureContrast` ya corrigió a 4.5:1. Nada se superpone a
 * la foto, así que el contraste no depende de qué foto suba el local. Sin
 * foto, esa misma banda ES el hero entero (con más aire), que es "campo del
 * color de marca con el nombre en grande" tal como pide el brief.
 */
export function StoreHero({
  store,
  etaMinutes,
}: {
  store: StoreWithBranding
  /** null = sin dato (tienda cerrada, sin productos, o el cálculo falló). Nunca se inventa un número. */
  etaMinutes: number | null
}) {
  const heroImageUrl = store.branding.hero_image_url

  return (
    <div className="flex flex-col">
      {heroImageUrl ? (
        <PhotoFrame ratio="hero">
          <Image src={heroImageUrl} alt="" fill sizes="100vw" priority className="object-cover" />
        </PhotoFrame>
      ) : null}

      <div
        className={cn(
          'bg-primary text-primary-foreground flex flex-col gap-4 px-5 sm:px-8',
          heroImageUrl ? 'py-6 sm:py-8' : 'py-12 sm:py-16',
        )}
      >
        <div className="flex items-center gap-3">
          {store.branding.logo_url ? (
            <span className="relative block size-10 shrink-0 sm:size-12">
              <Image src={store.branding.logo_url} alt="" fill sizes="48px" className="object-contain" />
            </span>
          ) : null}
          {/* Único <h1> de la página: el nombre del local es el título
              primario de /[store] (mismo criterio que el resto de las
              rutas del storefront: cada una tiene el suyo). */}
          <h1 className="display text-3xl sm:text-4xl">{store.name}</h1>
        </div>

        <HeroFacts store={store} etaMinutes={etaMinutes} />
      </div>
    </div>
  )
}

function HeroFacts({ store, etaMinutes }: { store: StoreWithBranding; etaMinutes: number | null }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
      <li className="flex items-center gap-1.5">
        {/* El estado se dice con la palabra, el punto solo acompaña — un
            daltónico o alguien mirando la pantalla al sol tiene que leer lo
            mismo (mismo criterio que StatusPill, ver surfaces.tsx). */}
        <span className="bg-current size-1.5 shrink-0 rounded-full" aria-hidden />
        {store.acceptingOrders ? 'Abierto ahora' : 'Cerrado por ahora'}
      </li>
      {store.acceptingOrders && etaMinutes != null ? (
        <li className="text-primary-foreground-muted flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden />
          <span className="tabular">{etaMinutes}′</span> estimado
        </li>
      ) : null}
      {/* Hoy TODO pedido es retiro en el local (ver `checkout-form.tsx`): no
          existe todavía una columna de delivery en el schema de tienda, así
          que acá no se ofrece esa opción en vez de inventarla. */}
      <li className="text-primary-foreground-muted flex items-center gap-1.5">
        <MapPin className="size-4" aria-hidden />
        Retiro en el local{store.address ? ` · ${store.address}` : ''}
      </li>
      {store.minOrderCents > 0 ? (
        <li className="text-primary-foreground-muted flex items-center gap-1.5">
          <Wallet className="size-4" aria-hidden />
          Mínimo <Price cents={store.minOrderCents} currency={store.currency} />
        </li>
      ) : null}
    </ul>
  )
}
