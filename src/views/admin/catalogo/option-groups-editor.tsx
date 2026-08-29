'use client'

import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { formatCentsCompact } from '@/lib/money'
import { MoneyInput } from '@/views/shared/money-input'
import { ConfirmDeleteButton } from './confirm-delete-button'
import {
  createOptionAction,
  createOptionGroupAction,
  deleteOptionAction,
  deleteOptionGroupAction,
  updateOptionAction,
  updateOptionGroupAction,
} from '@/controllers/catalog.actions'
import type { MenuOption, MenuOptionGroup } from '@/models/types'

/**
 * Traduce `minSelect`/`maxSelect` a la frase que el cliente va a leer en la
 * carta. Es la parte más difícil de esta pantalla: un par de números no dice
 * nada por sí solo, y el dueño del local tiene que poder anticipar el efecto
 * sin memorizar la convención.
 */
function describeSelectionRule(minSelect: number, maxSelect: number): string {
  if (minSelect === 0 && maxSelect === 1) return 'Opcional'
  if (minSelect === 0) return `Elegí hasta ${maxSelect}`
  if (minSelect === maxSelect) return minSelect === 1 ? 'Elegí 1' : `Elegí ${minSelect}`
  return `Elegí entre ${minSelect} y ${maxSelect}`
}

/**
 * Grupos y opciones de un producto (punto de cocción, extras, sin
 * ingredientes). Vive adentro del drawer del producto: son parte del mismo
 * dato, no una pantalla aparte. Estado local — solo se sincroniza con el
 * servidor al guardar cada fila, no en cada tecla.
 */
export function OptionGroupsEditor({
  storeId,
  productId,
  initialGroups = [],
  currency = 'ARS',
}: {
  storeId: number
  productId: number | null
  initialGroups?: MenuOptionGroup[]
  currency?: string
}) {
  const [groups, setGroups] = useState<MenuOptionGroup[]>(initialGroups)
  const [addingGroup, setAddingGroup] = useState(false)

  if (!productId) {
    return (
      <p className="text-muted-foreground bg-muted rounded-lg px-3 py-2.5 text-sm">
        Guardá el producto primero para poder agregar grupos de opciones.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <OptionGroupRow
          key={group.id}
          storeId={storeId}
          currency={currency}
          group={group}
          onUpdated={(patch) => setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, ...patch } : g)))}
          onDeleted={() => setGroups((prev) => prev.filter((g) => g.id !== group.id))}
          onOptionsChanged={(options) => setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, options } : g)))}
        />
      ))}

      {addingGroup ? (
        <NewGroupForm
          storeId={storeId}
          productId={productId}
          position={groups.length}
          onCreated={(group) => {
            setGroups((prev) => [...prev, group])
            setAddingGroup(false)
          }}
          onCancel={() => setAddingGroup(false)}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAddingGroup(true)} className="w-fit gap-1.5">
          <Plus className="size-3.5" />
          Grupo de opciones
        </Button>
      )}
    </div>
  )
}

function NewGroupForm({
  storeId,
  productId,
  position,
  onCreated,
  onCancel,
}: {
  storeId: number
  productId: number
  position: number
  onCreated: (group: MenuOptionGroup) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [minSelect, setMinSelect] = useState('0')
  const [maxSelect, setMaxSelect] = useState('1')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    setError(null)
    const min = Math.max(0, Math.round(Number(minSelect) || 0))
    const max = Math.max(1, Math.round(Number(maxSelect) || 1))
    startTransition(async () => {
      const result = await createOptionGroupAction(storeId, productId, { name, minSelect: min, maxSelect: max, position })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated({ id: result.data, name, minSelect: min, maxSelect: max, position, options: [] })
    })
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem]">
        <Input
          placeholder="Nombre (ej. Punto de cocción)"
          aria-label="Nombre del grupo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9"
        />
        <Input
          type="text"
          inputMode="numeric"
          placeholder="Mínimo"
          aria-label="Mínimo a elegir"
          value={minSelect}
          onChange={(e) => setMinSelect(e.target.value)}
          className="h-9"
        />
        <Input
          type="text"
          inputMode="numeric"
          placeholder="Máximo"
          aria-label="Máximo a elegir"
          value={maxSelect}
          onChange={(e) => setMaxSelect(e.target.value)}
          className="h-9"
        />
      </div>
      {/* Preview en vivo: un par de números no dice nada por sí solo, esto sí. */}
      <p className="text-muted-foreground text-xs">
        En la carta se va a leer: <span className="text-foreground font-medium">{describeSelectionRule(Math.max(0, Math.round(Number(minSelect) || 0)), Math.max(1, Math.round(Number(maxSelect) || 1)))}</span>
      </p>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={handleCreate} className="gap-1.5">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Crear grupo
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function OptionGroupRow({
  storeId,
  currency,
  group,
  onUpdated,
  onDeleted,
  onOptionsChanged,
}: {
  storeId: number
  currency: string
  group: MenuOptionGroup
  onUpdated: (patch: Partial<MenuOptionGroup>) => void
  onDeleted: () => void
  onOptionsChanged: (options: MenuOption[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)
  const [minSelect, setMinSelect] = useState(String(group.minSelect))
  const [maxSelect, setMaxSelect] = useState(String(group.maxSelect))
  const [pending, startTransition] = useTransition()
  const [addingOption, setAddingOption] = useState(false)
  const nameId = useId()
  const minId = useId()
  const maxId = useId()

  function handleSave() {
    const min = Math.max(0, Math.round(Number(minSelect) || 0))
    const max = Math.max(1, Math.round(Number(maxSelect) || 1))
    startTransition(async () => {
      const result = await updateOptionGroupAction(storeId, group.id, { name, minSelect: min, maxSelect: max })
      if (!result.ok) {
        toast.error('No se pudo guardar el grupo', { description: result.error })
        return
      }
      onUpdated({ name, minSelect: min, maxSelect: max })
      setEditing(false)
    })
  }

  return (
    <div className="border-border rounded-lg border p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={nameId} className="sr-only">
                Nombre del grupo
              </Label>
              <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={minId} className="sr-only">
                Mínimo a elegir
              </Label>
              <Input id={minId} type="text" inputMode="numeric" value={minSelect} onChange={(e) => setMinSelect(e.target.value)} className="h-9" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={maxId} className="sr-only">
                Máximo a elegir
              </Label>
              <Input id={maxId} type="text" inputMode="numeric" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} className="h-9" />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            En la carta se va a leer: <span className="text-foreground font-medium">{describeSelectionRule(Math.max(0, Math.round(Number(minSelect) || 0)), Math.max(1, Math.round(Number(maxSelect) || 1)))}</span>
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={handleSave} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Guardar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{group.name}</p>
            <p className="text-muted-foreground text-xs">
              {describeSelectionRule(group.minSelect, group.maxSelect)} · así lo va a ver el cliente
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Editar grupo">
              <Pencil className="size-3.5" />
            </Button>
            <ConfirmDeleteButton
              itemLabel={`el grupo "${group.name}"`}
              description="Con todas sus opciones. Los pedidos que ya lo tienen no cambian: guardan el nombre y el precio de cuando se pidieron."
              onConfirm={async () => {
                const result = await deleteOptionGroupAction(storeId, group.id)
                if (result.ok) onDeleted()
                return result
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5 border-t pt-3">
        {group.options.map((option) => (
          <OptionRow
            key={option.id}
            storeId={storeId}
            currency={currency}
            option={option}
            onUpdated={(patch) =>
              onOptionsChanged(group.options.map((o) => (o.id === option.id ? { ...o, ...patch } : o)))
            }
            onDeleted={() => onOptionsChanged(group.options.filter((o) => o.id !== option.id))}
          />
        ))}
        {addingOption ? (
          <NewOptionForm
            storeId={storeId}
            groupId={group.id}
            position={group.options.length}
            onCreated={(option) => {
              onOptionsChanged([...group.options, option])
              setAddingOption(false)
            }}
            onCancel={() => setAddingOption(false)}
          />
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingOption(true)} className="w-fit gap-1.5">
            <Plus className="size-3.5" />
            Opción
          </Button>
        )}
      </div>
    </div>
  )
}

function NewOptionForm({
  storeId,
  groupId,
  position,
  onCreated,
  onCancel,
}: {
  storeId: number
  groupId: number
  position: number
  onCreated: (option: MenuOption) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [priceDeltaCents, setPriceDeltaCents] = useState(0)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    setError(null)
    startTransition(async () => {
      const result = await createOptionAction(storeId, groupId, { name, priceDeltaCents, isAvailable: true, position })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated({ id: result.data, name, priceDeltaCents, isAvailable: true, position })
    })
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        placeholder="Nombre (ej. Sin cebolla)"
        aria-label="Nombre de la opción"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9 flex-1"
      />
      <MoneyInput
        cents={priceDeltaCents}
        onCentsChange={setPriceDeltaCents}
        allowNegative
        aria-label="Diferencia de precio"
        className="h-9 sm:w-36"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={handleCreate} className="gap-1.5">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Crear
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}

function OptionRow({
  storeId,
  currency,
  option,
  onUpdated,
  onDeleted,
}: {
  storeId: number
  currency: string
  option: MenuOption
  onUpdated: (patch: Partial<MenuOption>) => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(option.name)
  const [priceDeltaCents, setPriceDeltaCents] = useState(option.priceDeltaCents)
  const [pending, startTransition] = useTransition()
  const nameId = useId()
  const priceId = useId()

  function handleSave() {
    startTransition(async () => {
      const result = await updateOptionAction(storeId, option.id, { name, priceDeltaCents })
      if (!result.ok) {
        toast.error('No se pudo guardar la opción', { description: result.error })
        return
      }
      onUpdated({ name, priceDeltaCents })
      setEditing(false)
    })
  }

  function handleToggleAvailable(checked: boolean) {
    startTransition(async () => {
      const result = await updateOptionAction(storeId, option.id, { isAvailable: checked })
      if (!result.ok) {
        toast.error('No se pudo actualizar', { description: result.error })
        return
      }
      onUpdated({ isAvailable: checked })
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Label htmlFor={nameId} className="sr-only">
          Nombre de la opción
        </Label>
        <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} className="h-8 flex-1 text-sm" />
        <Label htmlFor={priceId} className="sr-only">
          Diferencia de precio
        </Label>
        <MoneyInput
          id={priceId}
          cents={priceDeltaCents}
          onCentsChange={setPriceDeltaCents}
          allowNegative
          className="h-8 w-32 text-sm"
        />
        <Button type="button" size="sm" disabled={pending} onClick={handleSave}>
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <label className="flex flex-1 items-center gap-2">
        <Checkbox checked={option.isAvailable} onCheckedChange={(v) => handleToggleAvailable(v === true)} />
        <span className={option.isAvailable ? '' : 'text-muted-foreground line-through'}>{option.name}</span>
      </label>
      <span className="tabular text-muted-foreground text-xs">
        {option.priceDeltaCents === 0
          ? '—'
          : `${option.priceDeltaCents > 0 ? '+' : ''}${formatCentsCompact(option.priceDeltaCents, currency)}`}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Editar opción">
          <Pencil className="size-3.5" />
        </Button>
        <ConfirmDeleteButton
          itemLabel={`"${option.name}"`}
          onConfirm={async () => {
            const result = await deleteOptionAction(storeId, option.id)
            if (result.ok) onDeleted()
            return result
          }}
        />
      </div>
    </div>
  )
}
