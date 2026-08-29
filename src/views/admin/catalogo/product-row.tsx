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

  const modifierCount = product.optionGroups.length

  return (
    // ≥lg pasa de fila flex a grid de columnas fijas: la pantalla del
    // mostrador tiene ancho de sobra (ver category-list.tsx) y una lista de
    // texto con más columnas por fila es contenido legítimo — la grilla
    // prohibida es la de tarjetas icono+título, no esta. Las dos columnas
    // nuevas (descripción, modificadores) están `hidden` bajo `lg` para que
    // la fila mobile no cambie: ahí no hay ancho para ganar nada mostrándolas.
    <div className="flex items-center gap-3 py-2.5 lg:grid lg:grid-cols-[3.5rem_minmax(0,1fr)_16rem_7rem_9rem_2.75rem] lg:gap-4 lg:py-3">
      {product.imageUrl ? (
        <PhotoFrame ratio="square" className="size-11 shrink-0 rounded-md border lg:size-14">
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
          className="border-warning/50 bg-warning/10 text-warning-foreground hover:bg-warning/20 flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed transition-colors duration-(--dur-fast) lg:size-14"
        >
          <ImagePlus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left lg:flex-none">
        <p className={cn('truncate text-sm font-medium lg:text-base', !product.isAvailable && 'text-muted-foreground')}>
          {product.name}
        </p>
        <p className="text-muted-foreground flex items-center gap-1 text-xs lg:text-sm">
          <Price cents={product.priceCents} currency={currency} /> · {product.prepMinutes} min
          {!product.imageUrl ? <span className="text-warning-foreground"> · Sin foto</span> : null}
        </p>
      </button>
      {/* Descripción: la pantalla de 1920 tiene lugar para leerla sin abrir
          el drawer. En celular no cabe ni hace falta. */}
      <div className="text-muted-foreground hidden min-w-0 items-center text-sm lg:flex">
        <p className="line-clamp-1">{product.description || '—'}</p>
      </div>
      {/* Modificadores: cuenta rápida de si el producto tiene punto de
          cocción, extras, etc. sin tener que abrirlo para averiguarlo. */}
      <div className="text-muted-foreground hidden items-center text-sm lg:flex">
        <span className="tabular">
          {modifierCount === 0 ? '—' : `${modifierCount} ${modifierCount === 1 ? 'grupo' : 'grupos'}`}
        </span>
      </div>
      {/* Botón real de 44px con texto que cambia, no solo color: "un toque"
          para agotar en hora pico, pero legible sin depender del tono. */}
      <button
        type="button"
        onClick={handleToggleAvailable}
        disabled={pending}
        aria-pressed={product.isAvailable}
        className={cn(
          'flex h-11 shrink-0 items-center gap-1.5 rounded-pill px-3 text-xs font-medium transition-colors duration-(--dur-fast) disabled:opacity-60 lg:h-12 lg:text-sm',
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
      <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Editar producto" className="lg:size-12">
        <Pencil className="size-3.5" />
      </Button>
    </div>
  )
}
