'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ActionBar, OptionRow, PhotoFrame, SectionHeading, Stepper } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { ClosedNotice } from '@/views/shared/states'
import { useCart } from '@/lib/cart'
import { cn } from '@/lib/utils'
import type { MenuOptionGroup, MenuProduct, StoreWithBranding } from '@/models/types'

/**
 * La ficha de producto: la convención de la categoría, entera. Nada de drawer
 * para las opciones — a diferencia del mundo de etiqueta anterior, acá TODA
 * la página es la "hoja" (sube con `animate-sheet-in` al entrar) y las
 * opciones son filas tocables inline, siempre visibles, con la acción
 * primaria fija al pie mostrando el total en vivo.
 */
export function ProductDetailView({
  store,
  product,
}: {
  store: StoreWithBranding
  product: MenuProduct
}) {
  const { addLine } = useCart()
  const [quantity, setQuantity] = React.useState(1)
  const [selected, setSelected] = React.useState<Record<number, number[]>>({})
  const [notes, setNotes] = React.useState('')

  const canOrder = store.acceptingOrders && product.isAvailable

  function toggleOption(group: MenuOptionGroup, optionId: number) {
    setSelected((prev) => {
      const current = prev[group.id] ?? []
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: current[0] === optionId ? [] : [optionId] }
      }
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) }
      }
      if (current.length >= group.maxSelect) return prev
      return { ...prev, [group.id]: [...current, optionId] }
    })
  }

  // El NÚMERO (minSelect/maxSelect) sale siempre del producto que mandó el
  // servidor — acá solo se formatea. La regla en sí vive en el dominio
  // (order.model.ts la vuelve a exigir al cotizar), así que si un cliente
  // saltea esto pegándole directo a la API, el servidor igual la frena.
  const groupErrors = product.optionGroups
    .map((group) => {
      const count = (selected[group.id] ?? []).length
      if (count < group.minSelect) {
        return `Elegí ${group.minSelect === 1 ? '1 opción' : `al menos ${group.minSelect} opciones`} de "${group.name}"`
      }
      return null
    })
    .filter((message): message is string => message !== null)

  const isValid = groupErrors.length === 0

  const optionsDeltaCents = product.optionGroups.reduce((sum, group) => {
    const ids = selected[group.id] ?? []
    return (
      sum +
      ids.reduce((s, id) => {
        const option = group.options.find((o) => o.id === id)
        return s + (option?.priceDeltaCents ?? 0)
      }, 0)
    )
  }, 0)

  const unitPriceCents = Math.max(0, product.priceCents + optionsDeltaCents)
  const totalCents = unitPriceCents * quantity

  function handleAdd() {
    if (!canOrder || !isValid) return
    const optionIds = Object.values(selected).flat()
    addLine({ productId: product.id, quantity, optionIds, notes: notes.trim() || null })
    toast.success(`${product.name} agregado al carrito`)
    // Se resetea para que un segundo "Agregar" arranque de cero: la hoja se
    // queda en pantalla (no navega) por si quiere cargar OTRA combinación del
    // mismo producto — dos hamburguesas con distinto término, por ejemplo.
    setQuantity(1)
    setSelected({})
    setNotes('')
  }

  const ctaLabel = !store.acceptingOrders
    ? 'El local no está tomando pedidos'
    : !product.isAvailable
      ? 'No disponible'
      : null

  return (
    <div className="animate-sheet-in flex flex-1 flex-col pb-32">
      <div className="relative w-full">
        {/* `fallbackLabel` deja que `PhotoFrame` resuelva el caso sin foto
            (nombre en grande sobre el color de marca) — el mismo mecanismo
            que ya usa `ProductRow` en la carta, así que no hace falta un
            componente aparte acá. */}
        <PhotoFrame ratio="wide" className="w-full" fallbackLabel={product.name}>
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill priority sizes="100vw" className="object-cover" />
          ) : undefined}
        </PhotoFrame>
        <Link
          href={`/${store.slug}`}
          aria-label={`Volver a ${store.name}`}
          className="bg-background/90 text-foreground shadow-raise absolute top-3 left-3 z-10 flex size-11 items-center justify-center rounded-full backdrop-blur transition-colors hover:bg-background"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col gap-1 px-4 pt-5 sm:px-6">
        <h1 className="display text-foreground text-2xl font-semibold sm:text-3xl">{product.name}</h1>
        {product.description ? <p className="text-muted-foreground max-w-[65ch] text-sm">{product.description}</p> : null}
      </div>

      {!store.acceptingOrders ? <ClosedNotice storeName={store.name} className="mt-4" /> : null}
      {store.acceptingOrders && !product.isAvailable ? (
        <p className="text-muted-foreground mx-auto w-full max-w-(--content-max) px-4 pt-4 text-sm sm:px-6">
          Este producto no está disponible en este momento.
        </p>
      ) : null}

      {canOrder ? (
        <div className="mx-auto flex w-full max-w-(--content-max) flex-col px-4 sm:px-6">
          {product.optionGroups.map((group) => (
            <fieldset key={group.id} className="flex flex-col">
              <SectionHeading
                as="h2"
                id={`group-${group.id}-heading`}
                className="text-base"
                action={<span className="text-muted-foreground text-xs">{selectionHint(group)}</span>}
              >
                {group.name}
              </SectionHeading>

              {group.maxSelect === 1 ? (
                <RadioGroup
                  aria-labelledby={`group-${group.id}-heading`}
                  value={String((selected[group.id] ?? [])[0] ?? '')}
                  onValueChange={(value) => toggleOption(group, Number(value))}
                >
                  {group.options.map((option) => (
                    <label key={option.id} className="contents">
                      <OptionRow
                        control={<RadioGroupItem value={String(option.id)} disabled={!option.isAvailable} />}
                        label={option.name}
                        disabled={!option.isAvailable}
                        priceDelta={
                          option.priceDeltaCents !== 0 ? (
                            <Price cents={option.priceDeltaCents} currency={store.currency} />
                          ) : undefined
                        }
                      />
                    </label>
                  ))}
                </RadioGroup>
              ) : (
                <div role="group" aria-labelledby={`group-${group.id}-heading`} className="flex flex-col">
                  {group.options.map((option) => {
                    const checked = (selected[group.id] ?? []).includes(option.id)
                    const atMax = (selected[group.id] ?? []).length >= group.maxSelect
                    const disabled = !option.isAvailable || (atMax && !checked)
                    return (
                      <label key={option.id} className="contents">
                        <OptionRow
                          control={<Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggleOption(group, option.id)} />}
                          label={option.name}
                          disabled={disabled}
                          priceDelta={
                            option.priceDeltaCents !== 0 ? (
                              <Price cents={option.priceDeltaCents} currency={store.currency} />
                            ) : undefined
                          }
                        />
                      </label>
                    )
                  })}
                </div>
              )}
            </fieldset>
          ))}

          <div className="flex flex-col gap-2 py-6">
            <Label htmlFor="product-notes">Alguna aclaración (opcional)</Label>
            <Textarea
              id="product-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ej: sin cebolla, cortada al medio…"
              maxLength={200}
            />
          </div>

          <div className={cn('flex items-center justify-between', product.optionGroups.length === 0 && '-mt-2')}>
            <span className="text-foreground text-sm font-medium">Cantidad</span>
            <Stepper value={quantity} onChange={setQuantity} max={50} />
          </div>

          {!isValid ? (
            <ul className="text-destructive mt-4 flex flex-col gap-1 text-sm" role="alert">
              {groupErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* `animate-bar-in`: la barra entra con resorte la primera vez que esta
          hoja se monta. El total de adentro (el "contador") late con
          `animate-bump` cada vez que cambia — la clave en `totalCents`
          reinicia el keyframe sin depender de estado extra. */}
      <ActionBar className="animate-bar-in">
        <Button size="lg" className="h-12 w-full text-base" disabled={!canOrder || !isValid} onClick={handleAdd}>
          {ctaLabel ?? (
            <span key={totalCents} className="animate-bump inline-flex items-center gap-1.5">
              Agregar · <Price cents={totalCents} currency={store.currency} />
            </span>
          )}
        </Button>
      </ActionBar>
    </div>
  )
}

/**
 * Traduce minSelect/maxSelect a la pista que se lee junto al nombre del
 * grupo. Es formato, no regla: los números son los que mandó el servidor.
 */
function selectionHint(group: MenuOptionGroup): string {
  if (group.minSelect === 0) {
    return group.maxSelect === 1 ? 'Opcional' : `Hasta ${group.maxSelect} (opcional)`
  }
  if (group.minSelect === group.maxSelect) {
    return group.maxSelect === 1 ? 'Elegí 1' : `Elegí ${group.maxSelect}`
  }
  return `Elegí entre ${group.minSelect} y ${group.maxSelect}`
}
