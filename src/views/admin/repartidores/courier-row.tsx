'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Mail, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/views/shared/surfaces'
import { cn } from '@/lib/utils'
import { setCourierActiveAction, resendCourierInviteAction } from '@/controllers/staff.actions'
import { CourierMetrics } from './courier-metrics'
import type { CourierRow as CourierRowType } from '@/models/types'

/** "Repartiendo" > "N pedidos" > "Libre", en ese orden — mismo criterio que le pide el brief al dueño para decidir a quién asignarle el próximo pedido. */
function loadLabel(courier: CourierRowType): string {
  if (courier.onTheWayOrders > 0) return 'Repartiendo'
  if (courier.assignedOrders > 0) return `${courier.assignedOrders} pedido${courier.assignedOrders === 1 ? '' : 's'}`
  return 'Libre'
}

export function CourierRow({
  storeId,
  courier,
  currency,
  courierCollects,
}: {
  storeId: number
  courier: CourierRowType
  currency: string
  courierCollects: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const invitedNotEntered = courier.isActive && courier.lastSignInAt === null
  // Sin cobro en la puerta habilitado y sin un solo peso histórico: ni una
  // palabra sobre plata, mismo criterio que ya usa el portal del repartidor
  // (`collect: null` → no se menciona el dinero).
  const showMoney = courierCollects || courier.collected30dCents > 0

  function handleToggleActive() {
    const next = !courier.isActive
    startTransition(async () => {
      const result = await setCourierActiveAction(storeId, courier.id, next)
      if (!result.ok) {
        toast.error('No se pudo actualizar el repartidor', { description: result.error })
        return
      }
      toast.success(next ? 'Repartidor reactivado' : 'Repartidor desactivado')
      router.refresh()
    })
  }

  function handleResend() {
    startTransition(async () => {
      const result = await resendCourierInviteAction(storeId, courier.id)
      if (!result.ok) {
        toast.error('No se pudo reenviar la invitación', { description: result.error })
        return
      }
      toast.success('Invitación reenviada')
      router.refresh()
    })
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 py-3',
        // Visible pero apagado: el repartidor de baja sigue en la lista (su
        // historial de pedidos entregados sigue siendo suyo), pero no se
        // confunde con uno operativo.
        !courier.isActive && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{courier.displayName}</p>
          <p className="text-muted-foreground truncate text-xs">{courier.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={!courier.isActive ? 'neutral' : invitedNotEntered ? 'warning' : 'live'}
            dot={courier.isActive && !invitedNotEntered}
          >
            {!courier.isActive ? 'Desactivado' : invitedNotEntered ? 'Invitado · todavía no entró' : 'Activo'}
          </StatusPill>
          <StatusPill tone="neutral">{loadLabel(courier)}</StatusPill>

          {invitedNotEntered ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={handleResend}
              className="gap-1.5"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
              Reenviar invitación
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={handleToggleActive}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
            {courier.isActive ? 'Desactivar' : 'Reactivar'}
          </Button>
        </div>
      </div>

      {invitedNotEntered ? (
        // Un repartidor invitado que nunca entró no tiene un solo dato real
        // todavía: tres métricas en cero al lado de su nombre se leen como que
        // algo se rompió, no como "recién arranca". Una línea corta en vez de
        // la tira completa.
        <p className="text-muted-foreground text-xs">
          Sin actividad todavía — cuando entre y reparta su primer pedido, sus números van a aparecer acá.
        </p>
      ) : (
        <CourierMetrics courier={courier} currency={currency} showMoney={showMoney} />
      )}
    </div>
  )
}
