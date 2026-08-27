'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Price } from '@/views/shared/money'
import { PhotoFrame } from '@/views/shared/surfaces'
import { cn } from '@/lib/utils'
import { updateProductAction } from '@/controllers/catalog.actions'
import type { MenuProduct } from '@/models/types'

export function ProductRow({
  storeId,
  currency,
  product,
  onEdit,
}: {
  storeId: number
  currency: string
  product: MenuProduct
  onEdit: () => void
}) {
  const [pending, startTransition] = useTransition()

  function handleToggleAvailable() {
    const next = !product.isAvailable
    startTransition(async () => {
      const result = await updateProductAction(storeId, product.id, { isAvailable: next })
      if (!result.ok) toast.error('No se pudo actualizar', { description: result.error })
    })
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      {product.imageUrl ? (
        <PhotoFrame ratio="square" className="size-11 shrink-0 rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
        </PhotoFrame>
      ) : (
        // Sin foto: el hueco NO es neutro. Borde punteado en tono de aviso
        // (nunca `destructive`: no hay nada roto) y la acción de arreglarlo
        // a mano en el mismo tap — bebidas y guarniciones sin foto son
        // normales, pero para el resto es plata que se pierde, y acá se dice.
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Agregar foto a ${product.name}`}
          className="border-warning/50 bg-warning/10 text-warning-foreground hover:bg-warning/20 flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed transition-colors duration-(--dur-fast)"
        >
          <ImagePlus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className={cn('truncate text-sm font-medium', !product.isAvailable && 'text-muted-foreground')}>
          {product.name}
        </p>
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Price cents={product.priceCents} currency={currency} /> · {product.prepMinutes} min
          {!product.imageUrl ? <span className="text-warning-foreground"> · Sin foto</span> : null}
        </p>
      </button>
      {/* Botón real de 44px con texto que cambia, no solo color: "un toque"
          para agotar en hora pico, pero legible sin depender del tono. */}
      <button
        type="button"
        onClick={handleToggleAvailable}
        disabled={pending}
        aria-pressed={product.isAvailable}
        className={cn(
          'flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-(--dur-fast) disabled:opacity-60',
          product.isAvailable
            ? 'bg-primary/12 text-primary hover:bg-primary/20'
            : 'bg-warning/20 text-warning-foreground hover:bg-warning/30',
        )}
      >
        {pending ? (
          <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        )}
        {product.isAvailable ? 'Disponible' : 'Agotado'}
      </button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Editar producto">
        <Pencil className="size-3.5" />
      </Button>
    </div>
  )
}
