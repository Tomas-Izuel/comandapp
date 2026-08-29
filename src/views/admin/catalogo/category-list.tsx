'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, ImageOff, Loader2, Pencil, Plus, UtensilsCrossed } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'
import { Panel } from '@/views/shared/surfaces'
import { PanelHeading } from '@/views/admin/page-frame'
import { cn } from '@/lib/utils'
import { ConfirmDeleteButton } from './confirm-delete-button'
import { ProductRow } from './product-row'
import { ProductDrawer } from './product-drawer'
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from '@/controllers/catalog.actions'
import type { MenuCategory, MenuProduct } from '@/models/types'

export function CategoryList({
  storeId,
  currency,
  categories,
}: {
  storeId: number
  currency: string
  categories: MenuCategory[]
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<number>>(new Set(categories.slice(0, 1).map((c) => c.id)))
  const [addingCategory, setAddingCategory] = useState(false)
  const [drawer, setDrawer] = useState<{ open: boolean; product: MenuProduct | null; categoryId: number | null }>({
    open: false,
    product: null,
    categoryId: null,
  })

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreate(categoryId: number | null) {
    setDrawer({ open: true, product: null, categoryId })
  }

  function openEdit(product: MenuProduct) {
    setDrawer({ open: true, product, categoryId: product.categoryId })
  }

  function handleSaved() {
    router.refresh()
  }

  const drawerCategory = categories.find((c) => c.id === drawer.categoryId)
  const defaultPosition = drawer.product ? drawer.product.position : (drawerCategory?.products.length ?? 0)

  return (
    <div className="flex flex-col gap-4">
      {categories.length === 0 && !addingCategory ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-8" strokeWidth={1.5} />}
          title="Es el primer día de este local en el sistema"
          description="Todavía no hay nada en la carta. Empezá creando una categoría (por ejemplo 'Hamburguesas') y después cargá los productos — cada uno con su foto: es lo que más vende."
          action={
            <Button type="button" onClick={() => setAddingCategory(true)} className="gap-1.5">
              <Plus className="size-4" />
              Crear la primera categoría
            </Button>
          }
        />
      ) : (
        /*
         * Topología ≥lg: dos columnas, no una grilla de tarjetas.
         *
         * Se descartó el master-detail (categoría seleccionada a la
         * izquierda, productos a la derecha) porque cambia el modelo de
         * interacción existente: hoy se puede tener más de una categoría
         * abierta a la vez (útil al mover un producto de categoría, por
         * ejemplo), y un maestro-detalle obliga a una sola visible.
         *
         * En cambio, el ancho se aprovecha en dos frentes que no tocan esa
         * interacción: (1) un índice de categorías fijo a la izquierda —
         * `CategoryNavRail`— para saltar directo a una sin scrollear, que es
         * exactamente lo que necesita el encargado que retoma el catálogo
         * después de atender a alguien en el mostrador; y (2) más columnas de
         * información por fila de producto (ver `product-row.tsx`), no
         * tarjetas. El índice solo aparece con categorías creadas: con cero
         * no hay nada que indexar.
         */
        <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:items-start lg:gap-6">
          {categories.length > 0 ? <CategoryNavRail categories={categories} /> : null}
          <div className="flex flex-col gap-4">
            {categories.map((category) => (
              <CategoryBand
                key={category.id}
                storeId={storeId}
                currency={currency}
                category={category}
                expanded={expanded.has(category.id)}
                onToggle={() => toggle(category.id)}
                onAddProduct={() => openCreate(category.id)}
                onEditProduct={openEdit}
              />
            ))}

            {addingCategory ? (
              <NewCategoryForm
                storeId={storeId}
                position={categories.length}
                onCreated={() => {
                  setAddingCategory(false)
                  router.refresh()
                }}
                onCancel={() => setAddingCategory(false)}
              />
            ) : (
              <Button type="button" variant="outline" onClick={() => setAddingCategory(true)} className="w-fit gap-1.5">
                <Plus className="size-4" />
                Nueva categoría
              </Button>
            )}
          </div>
        </div>
      )}

      <ProductDrawer
        key={`${drawer.product?.id ?? 'new'}-${drawer.categoryId ?? 'none'}`}
        storeId={storeId}
        currency={currency}
        categories={categories}
        product={drawer.product}
        defaultCategoryId={drawer.categoryId}
        defaultPosition={defaultPosition}
        open={drawer.open}
        onOpenChange={(open) => setDrawer((prev) => ({ ...prev, open }))}
        onSaved={handleSaved}
      />
    </div>
  )
}

/**
 * Índice de categorías, solo ≥lg (debajo, la nav es el riel horizontal del
 * chasis y esto le competiría el ancho). Fijo con `sticky`: el offset usa la
 * variable que expone el chasis (`--admin-header-h`), no un valor propio,
 * porque el alto de su encabezado pegajoso puede cambiar.
 */
function CategoryNavRail({ categories }: { categories: MenuCategory[] }) {
  return (
    <nav
      aria-label="Índice de categorías"
      className="sticky top-(--admin-header-h) hidden max-h-[calc(100dvh-var(--admin-header-h)-1.5rem)] flex-col overflow-y-auto pb-4 lg:flex"
    >
      <PanelHeading as="h3" title="Categorías" className="mb-1" />
      {categories.map((category) => {
        const missingPhotoCount = category.products.filter((p) => !p.imageUrl).length
        return (
          <a
            key={category.id}
            href={`#categoria-${category.id}`}
            className={cn(
              'flex min-h-11 items-center justify-between gap-2 rounded-md px-2.5 text-sm transition-colors duration-(--dur-fast) hover:bg-muted',
              category.isActive ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="truncate">{category.name}</span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
              {missingPhotoCount > 0 ? (
                <ImageOff className="text-warning-foreground size-3" strokeWidth={2} aria-hidden />
              ) : null}
              <span className="tabular">{category.products.length}</span>
            </span>
          </a>
        )
      })}
    </nav>
  )
}

function NewCategoryForm({
  storeId,
  position,
  onCreated,
  onCancel,
}: {
  storeId: number
  position: number
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    setError(null)
    startTransition(async () => {
      const result = await createCategoryAction(storeId, { name, position, isActive: true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated()
    })
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center">
      <Input
        placeholder="Nombre de la categoría"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-10 flex-1"
        autoFocus
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" disabled={pending || !name.trim()} onClick={handleCreate} className="h-10 gap-1.5">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Crear
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="h-10">
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function CategoryBand({
  storeId,
  currency,
  category,
  expanded,
  onToggle,
  onAddProduct,
  onEditProduct,
}: {
  storeId: number
  currency: string
  category: MenuCategory
  expanded: boolean
  onToggle: () => void
  onAddProduct: () => void
  onEditProduct: (product: MenuProduct) => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [isActive, setIsActive] = useState(category.isActive)
  const [pending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      const result = await updateCategoryAction(storeId, category.id, { name, isActive })
      if (!result.ok) {
        toast.error('No se pudo guardar la categoría', { description: result.error })
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  const missingPhotoCount = category.products.filter((p) => !p.imageUrl).length

  return (
    <Panel
      elevated={false}
      className="overflow-hidden"
      id={`categoria-${category.id}`}
      // El índice de la izquierda salta acá con un ancla (`href="#categoria-…"`):
      // sin este margen, el scroll deja la fila tapada bajo el encabezado
      // pegajoso del chasis.
      style={{ scrollMarginTop: 'var(--admin-header-h)' }}
    >
      <div className="flex items-center gap-1 py-1 pr-3 pl-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground size-11 shrink-0"
          aria-label={expanded ? 'Contraer' : 'Expandir'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>

        {editing ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-xs" />
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
              Visible en la carta
            </label>
            <Button type="button" size="sm" disabled={pending} onClick={handleSave} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Guardar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
            <span className={cn('text-sm font-semibold', !category.isActive && 'text-muted-foreground')}>
              {category.name}
            </span>
            <span className="text-muted-foreground tabular text-xs">({category.products.length})</span>
            {!category.isActive ? (
              <span className="bg-muted text-muted-foreground rounded-pill px-2 py-0.5 text-xs">Oculta</span>
            ) : null}
            {missingPhotoCount > 0 ? (
              <span className="text-warning-foreground inline-flex items-center gap-1 text-xs">
                <ImageOff className="size-3" strokeWidth={2} aria-hidden />
                {missingPhotoCount} sin foto
              </span>
            ) : null}
          </button>
        )}

        {!editing ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Editar categoría">
              <Pencil className="size-3.5" />
            </Button>
            <ConfirmDeleteButton
              itemLabel={`"${category.name}"`}
              description="Los productos de esta categoría quedan sin categoría, no se borran."
              onConfirm={async () => {
                const result = await deleteCategoryAction(storeId, category.id)
                if (result.ok) router.refresh()
                return result
              }}
            />
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-border divide-border divide-y border-t px-3">
          {category.products.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">Sin productos todavía en esta categoría.</p>
          ) : (
            category.products.map((product) => (
              <ProductRow
                key={product.id}
                storeId={storeId}
                currency={currency}
                product={product}
                onEdit={() => onEditProduct(product)}
              />
            ))
          )}
          <div className="py-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={onAddProduct} className="gap-1.5">
              <Plus className="size-3.5" />
              Producto
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
