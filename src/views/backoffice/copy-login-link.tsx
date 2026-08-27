'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resendOwnerInviteAction } from '@/controllers/platform.actions'

/**
 * Acción primaria del detalle de tienda: reenviar el magic link al dueño.
 *
 * Reemplaza al viejo "copiar link de acceso": el dueño ya recibió una
 * invitación automática al darse de alta la tienda (`createStoreWithOwner`
 * → `sendOwnerInvite`), así que lo que hace falta ACÁ es la reposición
 * cuando ese primer link venció (vencen en 1 hora) o se perdió. No hay
 * forma de saber desde acá si el envío original salió bien —no queda un
 * registro por tienda, a diferencia de los mails de pedido que sí quedan en
 * `notifications`, que exige `order_id`— así que el botón siempre dice
 * "Reenviar": es la etiqueta correcta tanto si el primero llegó como si
 * nunca salió.
 */
export function CopyLoginLink({ storeId }: { storeId: number }) {
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  function handleInvite() {
    startTransition(async () => {
      const result = await resendOwnerInviteAction(storeId)
      if (!result.ok) {
        toast.error('No se pudo reenviar la invitación', { description: result.error })
        return
      }
      toast.success('Invitación reenviada', { description: 'El dueño recibió un nuevo link mágico por mail.' })
    })
  }

  async function handleCopyFallback() {
    const url = `${window.location.origin}/admin/acceso`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sin permiso de portapapeles no hay mucho más que hacer acá; el dueño
      // igual puede escribir la URL a mano.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" onClick={handleInvite} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Mail aria-hidden="true" />}
        Reenviar invitación
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopyFallback}>
        <Copy aria-hidden="true" />
        {copied ? 'Copiado' : 'Copiar /admin/acceso'}
      </Button>
    </div>
  )
}
