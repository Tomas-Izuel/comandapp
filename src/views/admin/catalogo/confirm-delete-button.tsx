'use client'

import { useState, useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Único uso de modal en este ABM: borrar es lo único que necesita interrumpir.
 * Todo lo demás (editar, expandir) es inline o drawer.
 */
export function ConfirmDeleteButton({
  itemLabel,
  description,
  onConfirm,
  size = 'icon-sm',
}: {
  itemLabel: string
  description?: string
  onConfirm: () => Promise<{ ok: boolean; error?: string }>
  size?: 'icon-sm' | 'sm'
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await onConfirm()
      if (!result.ok) {
        setError(result.error ?? 'No se pudo borrar')
        return
      }
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size={size} aria-label={`Borrar ${itemLabel}`}>
          <Trash2 className="text-destructive size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Borrar {itemLabel}?</DialogTitle>
          <DialogDescription>{description ?? 'Esta acción no se puede deshacer.'}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Borrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
