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
        <>
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
        </>
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
    <Panel elevated={false} className="overflow-hidden">
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
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">Oculta</span>
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
