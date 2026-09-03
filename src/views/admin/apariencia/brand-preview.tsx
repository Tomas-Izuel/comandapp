'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PanelHeading } from '@/views/admin/page-frame'
import { PREVIEW_BRANDING_MESSAGE_TYPE, PREVIEW_QUERY_PARAM, PREVIEW_QUERY_VALUE } from '@/lib/preview-mode'
import type { Branding } from '@/models/schemas/branding.schema'

/**
 * La vista previa es la vitrina REAL, embebida en un <iframe> apuntando a
 * `/${storeSlug}?preview=brand` — no una réplica dibujada acá. Antes era una
 * maqueta a mano de `src/views/storefront/` (portada, riel de categorías, 4
 * filas de producto fijas) que había que mantener sincronizada con esa vista
 * cada vez que cambiaba, y ya se había desactualizado una vez en esta misma
 * sesión. El `<iframe>` no puede desactualizarse: es literalmente la página
 * que ve el cliente, con lo que ya tiene cargado el local (categorías,
 * productos, fotos) en vez de datos de muestra — y de paso queda interactiva
 * de verdad: se navega, se abre un producto, se eligen opciones, se agrega al
 * carrito. Lo único apagado es hacer el pedido (`checkout-form.tsx`, guiado
 * por `?preview=brand` vía `usePreviewMode()`).
 *
 * El color/tipografía/radio/densidad TODAVÍA NO GUARDADOS viajan por
 * `postMessage` (ver el bridge en `src/views/storefront/preview-bridge.tsx`,
 * que valida origen + tipo + `brandingSchema` antes de aplicar nada) en vez
 * de ir en la URL: as apenas cambia una tecla del dueño, sin recargar el
 * iframe ni perder su scroll o el producto que tenía abierto.
 */

/** Alto del "peek" cuando el preview está colapsado abajo de `lg`: hombro y
 *  cabecera nomás, lo justo para reconocer que ahí vive la vista previa. */
const PEEK_HEIGHT = 'h-56'
/** Alto expandido en mobile y alto fijo en desktop: suficiente para ver la
 *  carta scrolleando sin que el marco de teléfono se vuelva absurdo. */
const OPEN_HEIGHT = 'h-[36rem]'

export function BrandPreview({
  branding,
  storeSlug,
  storeName,
  className,
  reloadToken = 0,
}: {
  branding: Branding
  storeSlug: string
  storeName: string
  className?: string
  /**
   * Se incrementa en `branding-form.tsx` recién cuando `upsertBrandingAction`
   * devuelve `ok: true`. El `<iframe>` es la vitrina real: el logo, la
   * portada y el favicon los pinta el SERVIDOR al cargar esa página, y el
   * `postMessage` de branding de abajo solo cubre color/tipografía/radio/
   * densidad. Sin esto, borrar el logo y guardar no cambia nada acá adentro
   * — el iframe nunca se recarga — y el dueño concluye que el borrado no
   * funcionó (ver 00-architecture.md de este hotfix). Usarlo como parte de la
   * `key` remonta el iframe entero, que es lo único que fuerza un pedido
   * nuevo al servidor con el estado recién guardado.
   */
  reloadToken?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Rastrea a qué `reloadToken` corresponde el `loaded` actual. Cuando no
  // coinciden significa que se pidió una recarga después del último render:
  // ajustar `loaded` a `false` ACÁ (durante el render, no en un efecto — el
  // patrón que React docs llaman "adjusting state when a prop changes") es
  // lo que evita el cascading-render que dispararía un `useEffect` con este
  // mismo `setState`, y no reabre un loop porque en el próximo render ya
  // coinciden.
  const [loadedForToken, setLoadedForToken] = useState(reloadToken)
  if (loadedForToken !== reloadToken) {
    setLoadedForToken(reloadToken)
    setLoaded(false)
  }
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Recién después de `onLoad` el bridge del lado de adentro ya montó su
  // listener: un `postMessage` mandado antes se pierde sin error ni cola. Con
  // `loaded` como gate, este efecto se vuelve a disparar apenas el iframe
  // termina de cargar y manda el branding actual del form de una — así la
  // vista previa no empieza mostrando el branding GUARDADO (el que trae el
  // `<style>` del layout del lado del servidor) mientras el dueño ya tiene
  // cambios sin guardar en pantalla.
  //
  // Esto también cubre la recarga: la `key` de abajo remonta el `<iframe>`
  // en cuanto cambia `reloadToken`, pero `BrandPreview` en sí NO se remonta,
  // así que sin el ajuste de arriba `loaded` seguiría en `true` de la carga
  // vieja — este efecto le mandaría el branding al `contentWindow` que React
  // acaba de reemplazar, y el mensaje se pierde sin error porque del lado
  // nuevo todavía no hay nadie escuchando. `onLoad` del iframe nuevo vuelve a
  // poner `loaded` en `true` cuando el bridge ya montó.
  useEffect(() => {
    if (!loaded) return
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_BRANDING_MESSAGE_TYPE, branding },
      window.location.origin,
    )
  }, [branding, loaded])

  return (
    // Sticky en TODOS los tamaños: abajo de `lg` es la franja pegajosa
    // arriba (peek/expand); en `lg` es la columna al lado del form seguir
    // el scroll. El bug que este cambio resuelve es exactamente ESO: antes
    // `lg:static` apagaba la sticky justo donde el form es más largo, así
    // que la vista previa se perdía scroll abajo en vez de acompañar.
    <div
      className={cn(
        'bg-background sticky top-(--admin-header-h) z-30 -mt-1 border-b border-border pb-3 lg:z-auto lg:border-b-0 lg:pb-0',
        className,
      )}
    >
      <PanelHeading
        as="h3"
        title="Vista previa"
        className="mb-2"
        action={
          // Solo existe abajo de `lg`: ahí el preview vive como una franja
          // pegajosa que hay que poder expandir. En `lg` ya está entero al
          // costado del form, así que el botón sobra.
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:outline-none lg:hidden"
          >
            {expanded ? 'Ver menos' : 'Ver más'}
            <ChevronDown className={cn('size-4 transition-transform duration-(--dur-base)', expanded && 'rotate-180')} aria-hidden />
          </button>
        }
      />

      <div
        className={cn(
          'mx-auto w-full overflow-hidden rounded-[2rem] border-8 border-neutral-900 bg-neutral-900 shadow-lift transition-[height] duration-(--dur-base) ease-(--ease-out-quart)',
          expanded ? OPEN_HEIGHT : PEEK_HEIGHT,
          'lg:h-[38rem] lg:max-w-[22rem]',
        )}
      >
        <iframe
          key={reloadToken}
          ref={iframeRef}
          src={`/${storeSlug}?${PREVIEW_QUERY_PARAM}=${PREVIEW_QUERY_VALUE}`}
          title={`Vista previa de ${storeName || 'tu local'}`}
          onLoad={() => setLoaded(true)}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  )
}
