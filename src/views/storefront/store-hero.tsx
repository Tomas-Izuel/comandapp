import Image from 'next/image'
import { Bike, Clock, MapPin, Wallet } from 'lucide-react'
import { PhotoFrame } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { cn } from '@/lib/utils'
import type { StoreWithBranding } from '@/models/types'

/**
 * Primer viewport de la vitrina: una tarjeta redondeada con margen lateral
 * —como la tarjeta de promo de la referencia—, no una banda a sangre.
 *
 * CONTRASTE (F-08). `ensureContrast()` garantiza 4.5:1 solo contra
 * `bg-primary` SÓLIDO (`buildThemeCss`, `src/lib/theme.ts`): una foto de un
 * local cualquiera detrás del texto puede tener cualquier luminosidad, y la
 * garantía no sobrevive a texto puesto directo sobre píxeles arbitrarios —
 * una opacidad sobre el texto tampoco lo arregla (sigue habiendo foto
 * detrás). Por eso la foto ocupa su PROPIA banda (`PhotoFrame`, sin texto
 * adentro) arriba, y la identidad + los datos viven en una banda SEPARADA,
 * 100% opaca, `bg-primary`/`text-primary-foreground` abajo — los mismos
 * tokens que `ensureContrast` ya corrigió. Nada se superpone a la foto, así
 * que el contraste no depende de qué foto suba el local. Ambas bandas
 * comparten el mismo marco redondeado (`overflow-hidden` en el contenedor),
 * así que se leen como UNA tarjeta, no dos apiladas. Sin foto, la banda de
 * identidad ES la tarjeta entera (con más aire), que es "campo del color de
 * marca con el nombre en grande" tal como pide el brief.
 */
export function StoreHero({
  store,
  etaMinutes,
  acceptingOrders,
}: {
  store: StoreWithBranding
  /** null = sin dato (tienda cerrada, sin productos, o el cálculo falló). Nunca se inventa un número. */
  etaMinutes: number | null
  /**
   * Ya resuelto por la page con `storefrontGate(...).kind === 'open'` — no
   * `store.acceptingOrders` crudo. "Abierto ahora" acá significa la cocina
   * está tomando pedidos PARA AHORA MISMO: una tienda `closed_by_hours`
   * (cerrada por horario, pero con programar habilitado) muestra "Cerrado
   * por ahora" igual que cualquier otro cierre, aunque la carta y el
   * carrito sigan andando — esa distinción vive en el checkout, no acá.
   * Recibirlo ya resuelto (en vez de recalcularlo acá con el `store`
   * entero) es lo que garantiza que el hero y el `ClosedNotice` de la page
   * nunca puedan decir cosas distintas.
   */
  acceptingOrders: boolean
}) {
  const heroImageUrl = store.branding.hero_image_url

  return (
    <div className="px-4 pt-4 sm:px-6">
      <div className="shadow-raise mx-auto w-full max-w-(--content-max) overflow-hidden rounded-(--radius)">
        {heroImageUrl ? (
          <PhotoFrame ratio="hero">
            <Image src={heroImageUrl} alt="" fill sizes="(min-width: 736px) 46rem, 100vw" priority className="object-cover" />
          </PhotoFrame>
        ) : null}

        <div
          className={cn(
            'bg-primary text-primary-foreground flex flex-col gap-4 px-5 sm:px-7',
            heroImageUrl ? 'py-5 sm:py-6' : 'py-11 sm:py-14',
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

          <HeroFacts store={store} etaMinutes={etaMinutes} acceptingOrders={acceptingOrders} />
        </div>
      </div>
    </div>
  )
}

function HeroFacts({
  store,
  etaMinutes,
  acceptingOrders,
}: {
  store: StoreWithBranding
  etaMinutes: number | null
  acceptingOrders: boolean
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      <li className="flex items-center gap-1.5 text-sm font-semibold">
        {/* El estado se dice con la palabra, el punto solo acompaña — un
            daltónico o alguien mirando la pantalla al sol tiene que leer lo
            mismo (mismo criterio que StatusPill, ver surfaces.tsx). */}
        <span className="bg-current size-1.5 shrink-0 rounded-full" aria-hidden />
        {acceptingOrders ? 'Abierto ahora' : 'Cerrado por ahora'}
      </li>
      {/*
       * Jerarquía secundaria por TAMAÑO Y PESO, no por color: con el primary
       * nuevo `--primary-foreground-muted` queda casi blanco (la fórmula lo
       * empuja hasta 4.5:1 contra un campo de lightness media, y eso deja
       * poco margen), así que un texto "atenuado" con ese token en realidad
       * casi no se distingue del texto principal. Por eso estos datos van en
       * `text-primary-foreground` de siempre —el mismo que ya pasó
       * `ensureContrast`— pero más chicos y sin el semibold del estado.
       */}
      <li className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
        {acceptingOrders && etaMinutes != null ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            <span className="tabular">{etaMinutes}′</span> estimado
          </span>
        ) : null}
        {/* El local puede ofrecer retiro y delivery, o solo retiro — la
            elección concreta del método vive en el checkout
            (`checkout-form.tsx`); acá solo se anticipa qué opciones tiene el
            local, no se pide nada todavía. */}
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" aria-hidden />
          {store.delivery.enabled ? 'Retiro y delivery' : 'Retiro en el local'}
          {store.address ? ` · ${store.address}` : ''}
        </span>
        {store.delivery.enabled && store.delivery.feeCents > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Bike className="size-3.5" aria-hidden />
            Envío <Price cents={store.delivery.feeCents} currency={store.currency} />
          </span>
        ) : null}
        {store.minOrderCents > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Wallet className="size-3.5" aria-hidden />
            Mínimo <Price cents={store.minOrderCents} currency={store.currency} />
          </span>
        ) : null}
      </li>
    </ul>
  )
}
