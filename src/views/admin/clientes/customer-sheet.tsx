'use client'

import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Price } from '@/views/shared/money'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { updateCustomerNotesAction, setCustomerOptOutAction } from '@/controllers/customers.actions'
import type { StoreCustomer } from '@/models/types'

/**
 * Hoja de detalle del padrón: primera compra, cancelados, la nota interna
 * editable, y el toggle de baja de promos. Las dos únicas acciones del dueño
 * sobre un cliente (§5.5), cada una con su propio `useTransition` — guardar
 * la nota no tiene que deshabilitar el toggle, y viceversa.
 *
 * Se mantiene montada siempre (controlada por `open`), y `customer` puede
 * seguir siendo el último cliente abierto mientras `open` ya es `false`
 * (ver el comentario en `customer-directory.tsx`): así la animación de
 * salida de `vaul` no se queda a mitad de camino mostrando un panel vacío.
 */
export function CustomerSheet({
  storeId,
  customer,
  timezone,
  currency,
  open,
  onOpenChange,
  onChanged,
}: {
  storeId: number
  customer: StoreCustomer | null
  timezone: string
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const notesId = useId()
  const [notesDraft, setNotesDraft] = useState('')
  const [notesPending, startNotesTransition] = useTransition()
  const [optOutPending, startOptOutTransition] = useTransition()

  // El draft de la nota se resetea cada vez que cambia DE CLIENTE (no en cada
  // render): sin el guard por id, tipear en la nota y que `onChanged` dispare
  // un `router.refresh()` de fondo pisaría lo que el dueño está escribiendo.
  // Ajustar el estado durante el render (en vez de un `useEffect`) es el
  // patrón recomendado para esto: corre antes de pintar, así que no hay
  // parpadeo con el valor viejo ni un render extra en cascada.
  const [draftForId, setDraftForId] = useState<number | null>(null)
  if (customer && customer.id !== draftForId) {
    setNotesDraft(customer.notes ?? '')
    setDraftForId(customer.id)
  }

  // `return null` en vez de un `<Drawer>` vacío: el componente sigue montado
  // (este `return` no lo desmonta), así que el estado del draft de la nota
  // sobrevive, y evitamos depender de cómo `vaul` se comporta sin hijos.
  if (!customer) return null

  const optedOut = customer.marketingOptOutAt !== null
  const notesDirty = notesDraft !== (customer.notes ?? '')

  function handleSaveNotes() {
    if (!customer) return
    startNotesTransition(async () => {
      const result = await updateCustomerNotesAction(storeId, customer.id, notesDraft)
      if (!result.ok) {
        toast.error('No se pudo guardar la nota', { description: result.error })
        return
      }
      toast.success('Nota guardada')
      onChanged()
    })
  }

  function handleToggleOptOut(nextReceivesPromos: boolean) {
    if (!customer) return
    startOptOutTransition(async () => {
      const result = await setCustomerOptOutAction(storeId, customer.id, !nextReceivesPromos)
      if (!result.ok) {
        toast.error('No se pudo actualizar', { description: result.error })
        return
      }
      toast.success(nextReceivesPromos ? 'Vuelve a recibir promos' : 'Dado de baja de promos')
      onChanged()
    })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{customer.displayName}</DrawerTitle>
          <DrawerDescription>{customer.phoneE164}</DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Los datos de contexto son de solo lectura acá: no cabían en la
              tabla y no disparan ninguna acción (§5.5). */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Primera compra</dt>
              <dd className="tabular mt-0.5">
                {customer.firstOrderAt ? formatDateTime(customer.firstOrderAt, timezone) : 'Nunca compró'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Gastado</dt>
              <dd className="mt-0.5">
                <Price cents={customer.totalSpentCents} currency={currency} exact className="tabular font-medium" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Pedidos</dt>
              <dd className="tabular mt-0.5">{customer.ordersCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Cancelados</dt>
              <dd className={cn('tabular mt-0.5', customer.cancelledOrdersCount >= 2 && 'text-warning-foreground font-medium')}>
                {customer.cancelledOrdersCount}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={notesId}>Nota interna</Label>
            <Textarea
              id={notesId}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Solo la ve el equipo del local. Por ejemplo: alergias, pedidos habituales, algo a tener en cuenta."
              rows={4}
              maxLength={2000}
            />
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={!notesDirty || notesPending} onClick={handleSaveNotes} className="gap-1.5">
                {notesPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Guardar nota
              </Button>
            </div>
          </div>

          <label
            htmlFor={`${notesId}-optout`}
            className={cn(
              'group/field-label has-[:focus-visible]:ring-ring/50 flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 transition-colors has-[:focus-visible]:ring-3',
              optOutPending ? 'cursor-wait opacity-70' : 'hover:bg-muted cursor-pointer',
            )}
          >
            <Checkbox
              id={`${notesId}-optout`}
              checked={!optedOut}
              disabled={optOutPending}
              onCheckedChange={(v) => handleToggleOptOut(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Recibe promociones</span>
              <span className="text-muted-foreground block text-xs">
                {/* La baja es del cliente: se lo dice, no se presenta como una decisión libre del dueño (§5.5.1). */}
                {optedOut
                  ? 'Este cliente se dio de baja. Podés reactivarlo si te lo pide directamente.'
                  : 'Puede recibir un cupón o un aviso por mail, si dejó su dirección.'}
              </span>
            </span>
          </label>
        </div>

        <DrawerFooter className="border-border border-t pt-4">
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cerrar
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
