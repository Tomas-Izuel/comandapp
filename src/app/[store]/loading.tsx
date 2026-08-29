import { Skeleton } from '@/components/ui/skeleton'
import { MenuSkeleton } from '@/views/shared/states'

/**
 * Sin esto, la page bloqueaba hasta que resolvían TODOS los `await` (F-02):
 * en 3G el usuario tocaba y no pasaba nada 1-3s, doble tap, sensación de roto.
 *
 * La geometría copia la real: tarjeta redondeada de portada (`StoreHero`),
 * buscador en pastilla, riel de categorías, y la grilla de la carta con la
 * misma tarjeta que `ProductCard` — `MenuSkeleton` ya la comparte, columnas y
 * forma (vertical u horizontal) incluidas, sin que esta page sepa la densidad
 * del local (no le llegan params). Un esqueleto que no coincide con el
 * contenido produce un salto de layout, que es peor que no mostrar nada.
 *
 * No sabe todavía si la tienda tiene `hero_image_url`: siempre dibuja la
 * banda de foto arriba de la tarjeta. Para una tienda sin portada esa banda
 * no está en el render final —la identidad ocupa su lugar—, así que hay un
 * desajuste posible en ese caso puntual. Aceptable: un esqueleto es una
 * aproximación, no una vista previa exacta.
 */
export default function StoreLoading() {
  return (
    <div className="flex flex-1 flex-col" role="status" aria-label="Cargando la carta">
      <div className="px-4 pt-4 sm:px-6">
        <div className="mx-auto w-full max-w-(--content-max) overflow-hidden rounded-(--radius)">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="bg-primary/40 flex flex-col gap-3 px-5 py-6 sm:px-7">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </div>
      <div className="px-4 pt-3 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-(--content-max)">
          <Skeleton className="h-12 w-full rounded-pill" />
        </div>
      </div>
      <div className="border-border border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-(--content-max) gap-2">
          <Skeleton className="h-12 w-24 rounded-pill" />
          <Skeleton className="h-12 w-28 rounded-pill" />
          <Skeleton className="h-12 w-20 rounded-pill" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--content-max)">
        <MenuSkeleton rows={6} className="dock-clearance px-5 pt-4 sm:px-8" />
      </div>
    </div>
  )
}
