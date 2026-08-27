'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CircleAlert, Loader2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { setStoreStatusAction } from '@/controllers/platform.actions'
import type { StoreStatus } from '@/models/types'

/**
 * Suspender apaga la web pública de otro negocio. Nunca es un botón suelto:
 * exige escribir el slug exacto, lo mismo que se usaría para confirmar un
 * borrado. Reactivar no es destructivo, pero pasa por el mismo diálogo para
 * no tener dos vocabularios de confirmación distintos en la misma pantalla.
 */
export function StoreStatusDialog({
  storeId,
  slug,
  currentStatus,
}: {
  storeId: number
  slug: string
  currentStatus: StoreStatus
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const nextStatus: StoreStatus = currentStatus === 'active' ? 'suspended' : 'active'
  const isSuspending = nextStatus === 'suspended'

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setConfirmation('')
      setError(null)
    }
  }

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await setStoreStatusAction(storeId, nextStatus, confirmation)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(isSuspending ? 'Tienda suspendida' : 'Tienda reactivada')
      setOpen(false)
      setConfirmation('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={isSuspending ? 'destructive' : 'default'}>
          {isSuspending ? 'Suspender' : 'Reactivar'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSuspending ? 'Suspender' : 'Reactivar'} /{slug}</DialogTitle>
          <DialogDescription>
            {isSuspending
              ? 'La web pública del local deja de responder: nadie nuevo puede entrar a pedir. Los pedidos que ya están en curso NO se cancelan — siguen su ciclo normal y el staff sigue pudiendo entrar a su panel para cocinarlos y entregarlos.'
              : 'La web pública del local vuelve a aceptar pedidos nuevos.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug-confirmation">Escribí “{slug}” para confirmar</Label>
          <Input
            id="slug-confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant={isSuspending ? 'destructive' : 'default'}
            disabled={pending || confirmation.trim().toLowerCase() !== slug}
            onClick={handleConfirm}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
