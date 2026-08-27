import Image from 'next/image'
import Link from 'next/link'
import { PhotoFrame, StatusPill } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { cn } from '@/lib/utils'
import type { MenuProduct } from '@/models/types'

/**
 * Una fila de producto en la carta, como la ejecuta cualquier app de pedido:
 * foto grande a la izquierda, nombre en caja mixta, descripción a dos
 * renglones, precio y minutos. Toda la fila es el target, no solo la foto.
 *
 * La foto mide `size-24`/`size-28` con `rounded-lg` a propósito: es la MISMA
 * geometría que `MenuSkeleton` (`src/views/shared/states.tsx`) dibuja durante
 * la carga. Si acá cambia el tamaño, el esqueleto deja de coincidir y aparece
 * un salto de layout cuando llega el contenido real.
 *
 * Sin foto, `PhotoFrame` ya resuelve "nombre en grande sobre el color de
 * marca" con `fallbackLabel` — no hace falta un componente aparte
 * (`NoPhotoMark` salió de acá, lo reemplaza esto).
 */
export function ProductRow({
  product,
  storeSlug,
  currency,
}: {
  product: MenuProduct
  storeSlug: string
  currency: string
}) {
  const isSoldOut = !product.isAvailable

  return (
    <Link
      href={`/${storeSlug}/producto/${product.id}`}
      className="hover:bg-muted flex items-center gap-4 px-5 py-3 transition-colors duration-(--dur-fast) sm:px-8"
    >
      <PhotoFrame
        ratio="square"
        className="size-24 shrink-0 rounded-lg sm:size-28"
        fallbackLabel={product.name}
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            fill
            // La columna de foto mide 96px en mobile, 112px desde sm — sin esto
            // next/image sirve la variante de viewport completo para un marco chico.
            sizes="(min-width: 640px) 112px, 96px"
            className={cn('object-cover', isSoldOut && 'grayscale')}
          />
        ) : undefined}
      </PhotoFrame>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3
            className={cn(
              'display text-lg font-semibold sm:text-xl',
              isSoldOut ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {product.name}
          </h3>
          {/* Agotado se dice con texto, no solo con el gris de la foto: el
              "no se puede pedir" real lo aplica el botón de agregar en la
              ficha de producto (otro slice), esto solo lo declara acá. */}
          {isSoldOut ? (
            <StatusPill tone="neutral" className="shrink-0">
              Agotado
            </StatusPill>
          ) : null}
        </div>
        {product.description ? (
          <p className="clamp-2 text-muted-foreground text-sm">{product.description}</p>
        ) : null}
        <div className="mt-1 flex items-center gap-3">
          <Price
            cents={product.priceCents}
            currency={currency}
            className={cn('text-sm font-semibold', isSoldOut ? 'text-muted-foreground' : 'text-foreground')}
          />
          <span className="tabular text-muted-foreground text-xs">{product.prepMinutes}′</span>
        </div>
      </div>
    </Link>
  )
}
