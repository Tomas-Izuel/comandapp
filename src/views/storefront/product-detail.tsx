'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Check, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ActionBar,
  OptionRow,
  Panel,
  PhotoFrame,
  SectionHeading,
  StatusPill,
  Stepper,
  iconButtonClass,
} from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { ClosedNotice } from '@/views/shared/states'
import { useAddFeedback } from '@/views/storefront/use-add-feedback'
import { useCart } from '@/lib/cart'
import { formatCentsCompact } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { MenuOptionGroup, MenuProduct, StoreWithBranding } from '@/models/types'

/**
 * La ficha de producto: Persuade, no Operate — ya decidió el catálogo, acá
 * tiene que dar ganas. La composición sigue la pantalla "Details" de
 * referencia: foto grande en tarjeta, título y precio en la misma línea,
 * metadatos reales debajo, descripción, y al pie el stepper junto al botón.
 *
 * Se conserva toda la lógica que ya funcionaba: validación de minSelect/
 * maxSelect, el cálculo de unitPriceCents con los deltas de opciones, el
 * reset después de agregar, y que el servidor vuelve a exigir las mismas
 * reglas al cotizar (esto solo formatea lo que la base ya validó).
 *
 * La confirmación de "agregado" ya no es un toast arriba de la pantalla: con
 * el pulgar abajo, en el botón, un aviso arriba es un aviso que nadie mira.
 * `useAddFeedback` hace que el botón mismo cambie de texto y color un
 * instante — el control que se acaba de tocar es el que confirma.
 */
export function ProductDetailView({
  store,
  product,
}: {
  store: StoreWithBranding
  product: MenuProduct
}) {
  const { addLine } = useCart()
  const { flash, isAdded } = useAddFeedback()
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
    // `flash()` va DESPUÉS de que la línea ya se agregó: confirma un hecho, no
    // promete uno. El botón —no un toast— es el que avisa.
    flash()
    // Se resetea para que un segundo "Agregar" arranque de cero: la hoja se
    // queda en pantalla (no navega) por si quiere cargar OTRA combinación del
    // mismo producto — dos hamburguesas con distinto término, por ejemplo.
    setQuantity(1)
    setSelected({})
    setNotes('')
  }

  // Todo estado de "no se puede" se dice con la palabra, nunca solo con el
  // botón deshabilitado — incluida la falta de opciones, que antes solo se
  // veía en la lista de errores de más abajo.
  const ctaLabel = !store.acceptingOrders
    ? 'El local no está tomando pedidos'
    : !product.isAvailable
      ? 'No disponible'
      : !isValid
        ? 'Elegí las opciones'
        : null

  return (
    <div className="animate-sheet-in flex flex-1 flex-col pb-32">
      {/* La foto va en tarjeta, con margen y radio grande — que se lea como
          algo que se levanta de la página, no como una banda a sangre. El
          botón de volver flota adentro de ese mismo margen. */}
      <div className="relative px-4 pt-4 sm:px-6 sm:pt-6">
        {/* `fallbackAlign="end"`: sin foto, el nombre va grande sobre el color
            de marca (así lo pide el producto), pero anclado ABAJO del marco.
            Centrado, un nombre largo podía crecer hasta la esquina donde flota
            el botón de volver y quedar tapado — abajo no hay control que lo
            tape nunca, sea cual sea el largo del nombre. */}
        <PhotoFrame ratio="wide" className="rounded-3xl" fallbackLabel={product.name} fallbackAlign="end">
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill priority sizes="100vw" className="object-cover" />
          ) : undefined}
        </PhotoFrame>
        <Link
          href={`/${store.slug}`}
          aria-label={`Volver a ${store.name}`}
          className={iconButtonClass('surface', 'absolute top-7 left-7 sm:top-9 sm:left-9 bg-card/90 shadow-raise backdrop-blur hover:bg-card')}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-1 px-4 pt-5 sm:px-6">
        {/* Título y precio en la misma línea. `items-start` para que el precio
            quede pegado al primer renglón si el nombre envuelve a dos. */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="display text-foreground min-w-0 text-2xl font-semibold sm:text-3xl">{product.name}</h1>
          <Price
            cents={product.priceCents}
            currency={store.currency}
            className="text-primary shrink-0 pt-0.5 text-xl font-semibold sm:text-2xl"
          />
        </div>

        {/* Fila de metadatos: solo lo que es real. Hoy es un solo dato
            (prepMinutes), así que no hay nada que separar con un divisor
            todavía — dos datos inventados valen menos que uno honesto. */}
        <div className="text-muted-foreground flex items-center gap-1.5 pt-1 text-sm">
          <Clock className="size-4" aria-hidden />
          <span className="tabular">{product.prepMinutes} min</span>
        </div>
      </div>

      {!store.acceptingOrders ? <ClosedNotice storeName={store.name} className="mt-4" /> : null}
      {store.acceptingOrders && !product.isAvailable ? (
        <p className="text-muted-foreground mx-auto w-full max-w-(--content-max) px-4 pt-4 text-sm sm:px-6">
          Este producto no está disponible en este momento.
        </p>
      ) : null}

      {product.description ? (
        <div className="mx-auto w-full max-w-(--content-max) px-4 sm:px-6">
          <div className="border-border mt-6 border-t border-dashed" />
          <SectionHeading as="h2" className="text-base">
            Descripción
          </SectionHeading>
          <p className="text-muted-foreground max-w-[70ch] text-sm">{product.description}</p>
        </div>
      ) : null}

      {canOrder ? (
        <div className="mx-auto flex w-full max-w-(--content-max) flex-col px-4 sm:px-6">
          {product.optionGroups.length > 0 ? <div className="border-border mt-6 border-t border-dashed" /> : null}

          {product.optionGroups.map((group) => {
            const count = (selected[group.id] ?? []).length
            return (
              <fieldset key={group.id} className="flex flex-col">
                <SectionHeading
                  as="h2"
                  id={`group-${group.id}-heading`}
                  className="text-base"
                  action={<GroupStatus group={group} count={count} />}
                >
                  {group.name}
                </SectionHeading>

                {/* La tarjeta (`Panel` sin elevar) es lo que le da jerarquía de
                    GRUPO a las opciones: antes flotaban sueltas en la página y
                    la única señal de que eran un conjunto era el divisor entre
                    filas. `gap-0` en `RadioGroup` saca el gap de grid propio de
                    Radix — el borde entre filas de `OptionRow` ya separa, y con
                    los dos puestos quedaba un doble espacio. */}
                <Panel elevated={false} className="overflow-hidden">
                  {group.maxSelect === 1 ? (
                    <RadioGroup
                      aria-labelledby={`group-${group.id}-heading`}
                      value={String((selected[group.id] ?? [])[0] ?? '')}
                      onValueChange={(value) => toggleOption(group, Number(value))}
                      className="gap-0"
                    >
                      {group.options.map((option) => {
                        const checked = (selected[group.id] ?? [])[0] === option.id
                        return (
                          <label key={option.id} className="contents">
                            <OptionRow
                              control={<RadioGroupItem value={String(option.id)} disabled={!option.isAvailable} />}
                              label={option.name}
                              disabled={!option.isAvailable}
                              selected={checked}
                              priceDelta={
                                option.priceDeltaCents !== 0
                                  ? formatPriceDelta(option.priceDeltaCents, store.currency)
                                  : undefined
                              }
                            />
                          </label>
                        )
                      })}
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
                              control={
                                <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggleOption(group, option.id)} />
                              }
                              label={option.name}
                              disabled={disabled}
                              selected={checked}
                              priceDelta={
                                option.priceDeltaCents !== 0
                                  ? formatPriceDelta(option.priceDeltaCents, store.currency)
                                  : undefined
                              }
                            />
                          </label>
                        )
                      })}
                    </div>
                  )}
                </Panel>
              </fieldset>
            )
          })}

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
        </div>
      ) : null}

      {/* `animate-bar-in`: la barra entra con resorte la primera vez que esta
          hoja se monta. El stepper vive acá adentro ahora, junto al botón —
          antes estaba suelto en el cuerpo. El total (el "contador") late con
          `animate-bump` cada vez que cambia: la clave en `totalCents`
          reinicia el keyframe sin depender de estado extra.

          El botón ES el aviso: en vez de un toast arriba de la pantalla —que
          nadie mira porque el pulgar está abajo, en el botón—, `isAdded` le
          cambia el color y el texto un instante. `bg-foreground`/
          `text-background` y no un color inventado: es el mismo par que
          `ensureContrast()` ya garantiza a 4.5:1 contra cualquier marca, así
          que la confirmación se lee sin importar qué color eligió el local. */}
      <ActionBar className="animate-bar-in">
        <div className="flex items-center gap-3">
          {canOrder ? <Stepper value={quantity} onChange={setQuantity} max={50} /> : null}
          <Button
            size="lg"
            className={cn(
              'h-12 flex-1 rounded-pill text-base transition-colors duration-(--dur-fast)',
              isAdded && 'bg-foreground text-background hover:bg-foreground',
            )}
            disabled={!canOrder || !isValid}
            onClick={handleAdd}
          >
            {isAdded ? (
              <span className="animate-bump inline-flex items-center gap-1.5">
                <Check className="size-4" aria-hidden />
                Agregado
              </span>
            ) : (
              (ctaLabel ?? (
                <span key={totalCents} className="animate-bump inline-flex items-center gap-1.5">
                  Agregar · <Price cents={totalCents} currency={store.currency} />
                </span>
              ))
            )}
          </Button>
          {/* Anuncio para lector de pantalla: el cambio de texto del botón no
              alcanza solo, porque el foco sigue en el botón mientras cambia y
              no todo lector re-lee el nombre accesible en cada render. */}
          <span aria-live="polite" role="status" className="sr-only">
            {isAdded ? `${product.name} agregado al carrito` : ''}
          </span>
        </div>
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

/**
 * La pastilla junto al nombre del grupo. Un grupo requerido sin responder
 * tiene que pedir la respuesta ANTES de que el cliente llegue al botón, no
 * solo enterarse ahí — por eso vive acá, al lado del propio grupo, y no en
 * una lista de errores al final que hay que scrollear para encontrar.
 *
 * La diferencia entre "falta" y "listo" es de FORMA (punto vs. tilde), no solo
 * de color: `warning` y el tilde son dos señales que coinciden, no una sola
 * disfrazada de dos.
 */
function GroupStatus({ group, count }: { group: MenuOptionGroup; count: number }) {
  const required = group.minSelect > 0
  if (!required) {
    return <StatusPill tone="neutral">{selectionHint(group)}</StatusPill>
  }
  const satisfied = count >= group.minSelect
  if (satisfied) {
    return (
      <StatusPill tone="neutral">
        <Check className="size-3" aria-hidden />
        {selectionHint(group)}
      </StatusPill>
    )
  }
  return (
    <StatusPill tone="warning" dot>
      {selectionHint(group)}
    </StatusPill>
  )
}

/** Centavos → "+$500" / "-$200": el signo es lo que dice si suma o resta del precio base. */
function formatPriceDelta(cents: number, currency: string): string {
  const sign = cents > 0 ? '+' : ''
  return `${sign}${formatCentsCompact(cents, currency)}`
}
