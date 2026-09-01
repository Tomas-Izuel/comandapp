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
import { deleteCouponAction } from '@/controllers/marketing.actions'
import type { Coupon } from '@/models/types'

/**
 * Borrar un cupón, con confirmación. Solo se ofrece cuando `reservedCount` y
 * `redeemedCount` son cero — es un heurístico del lado del cliente, no la
 * garantía real: la garantía real es el `on delete restrict` de
 * `coupon_redemptions_coupon_same_store_fkey` (00-architecture.md §5.14.6),
 * que también rechaza un cupón con canjes `released` aunque los dos
 * contadores visibles den cero. Ese caso (cupón sin reservas ni canjes vivos
 * pero con algún `released` viejo) no se puede detectar desde acá: `Coupon` no
 * trae esa señal. Si el borrado se rechaza, `deleteUnusedCoupon` ya traduce el
 * `23503` al mensaje de interfaz correcto ("Este cupón ya se usó: se puede
 * pausar, no borrar."), así que el peor caso es un mensaje claro, nunca un
 * borrado real de un cupón usado.
 */
export function ConfirmDeleteCouponButton({
  storeId,
  coupon,
  onDeleted,
}: {
  storeId: number
  coupon: Coupon
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await deleteCouponAction(storeId, coupon.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      onDeleted()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive gap-1.5">
          <Trash2 className="size-4" aria-hidden />
          Borrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Borrar el cupón {coupon.code}?</DialogTitle>
          <DialogDescription>
            No tiene canjes todavía, así que se borra entero. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Borrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
