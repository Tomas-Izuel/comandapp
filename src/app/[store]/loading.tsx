import { Skeleton } from '@/components/ui/skeleton'
import { MenuSkeleton } from '@/views/shared/states'

/**
 * Sin esto, la page bloqueaba hasta que resolvían TODOS los `await` (F-02):
 * en 3G el usuario tocaba y no pasaba nada 1-3s, doble tap, sensación de roto.
 *
 * La geometría copia la real: banda de foto 16:9, dos renglones de identidad,
 * riel de categorías, y filas con la misma foto de 96px que `ProductRow` —
 * `MenuSkeleton` ya la comparte. Un esqueleto que no coincide con el
 * contenido produce un salto de layout, que es peor que no mostrar nada.
 *
 * No sabe todavía si la tienda tiene `hero_image_url`: siempre dibuja la
 * banda de foto. Para una tienda sin portada esa banda no está en el render
 * final —la identidad ocupa su lugar—, así que hay un desajuste posible en
 * ese caso puntual. Aceptable: un esqueleto es una aproximación, no una
 * vista previa exacta.
 */
export default function StoreLoading() {
  return (
    <div className="flex flex-1 flex-col" role="status" aria-label="Cargando la carta">
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="border-border border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-(--content-max) gap-2">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--content-max)">
        <MenuSkeleton rows={5} className="px-5 pt-6 pb-16 sm:px-8" />
      </div>
    </div>
  )
}
