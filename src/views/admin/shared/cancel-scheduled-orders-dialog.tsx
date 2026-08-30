'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/money'
import type { ScheduledNightSummary } from '@/models/types'

/**
 * El conteo real de pedidos programados que una cancelación masiva o
 * individual se lleva puestos. Sale de `previewScheduledNightAction` para el
 * caso de noche/fecha (que devuelve `ScheduledNightSummary` completo, con
 * `night` incluida) o se arma en el momento con el pedido ya cargado en
 * pantalla para el caso singular (la bandeja de Programados): ahí no hace
 * falta pedirle nada al servidor, ya tenemos el estado de pago y el total, y
 * no hay una "noche" que nombrar para un solo pedido.
 *
 * `Omit<ScheduledNightSummary, 'night'>` en vez de una forma estructural
 * paralela: cuando T1 definió `ScheduledNightSummary` en `models/types.ts`
 * (no existía todavía cuando se escribió la primera versión de este
 * archivo), quedó pendiente alinear los dos tipos — esto lo cierra.
 */
export type AffectedOrders = Omit<ScheduledNightSummary, 'night'>

/**
 * Arma el mensaje de tres piezas que la decisión de producto exige, SIEMPRE
 * en el mismo orden: cuántos se cancelan, cuántos de esos están pagados y por
 * cuánto, y la frase del reembolso manual con todas las letras. Un solo lugar
 * que lo arma es lo que garantiza que las tres cancelaciones (pausa, cierre de
 * fecha, individual) digan exactamente lo mismo.
 *
 * `subject` es la única parte que varía entre los tres usos: "de esta noche",
 * "el 25/12", "para Juan Pérez, el viernes a las 21:00".
 */
export function describeCancellationImpact(affected: AffectedOrders, currency: string, subject: string): string {
  const orderWord = affected.count === 1 ? 'pedido programado' : 'pedidos programados'
  const base = `Esto cancela ${affected.count} ${orderWord} ${subject}.`

  if (affected.paidCount === 0) {
    return `${base} Ninguno está pagado todavía, así que no hay nada que reembolsar.`
  }

  const paidWord = affected.paidCount === 1 ? 'está pagado' : 'están pagados'
  const amount = formatCents(affected.paidTotalCents, currency)
  return `${base} ${affected.paidCount} ${paidWord} (${amount}). El reembolso lo gestionás vos desde Mercado Pago.`
}

/**
 * El diálogo de mayor radio de todo este trabajo: hasta acá "pausar pedidos"
 * era un booleano gratis y reversible. Ahora puede cancelar plata ya cobrada,
 * así que la consecuencia se dice ANTES de ejecutar, con el conteo recién
 * calculado — nunca cacheado de un render anterior.
 *
 * Reusado por los tres lugares que cancelan pedidos programados: el toggle de
 * "Tomando pedidos" (pausa la noche en curso), el cierre de una fecha desde el
 * calendario de excepciones, y la cancelación de un pedido suelto desde la
 * bandeja de Programados. Ninguno de los tres reimplementa el mensaje ni el
 * flujo: todos pasan por acá.
 *
 * `affected === null` es "todavía no sabemos" (cargando el preview); una vez
 * resuelto, `count === 0` cambia el tono: no hay nada destructivo que
 * confirmar, así que el botón deja de ser rojo y el título deja de asustar.
 */
export function CancelScheduledOrdersDialog({
  open,
  onOpenChange,
  loading,
  affected,
  currency,
  subject,
  destructiveLabel = 'Cancelar y continuar',
  safeLabel = 'Continuar',
  cancelLabel = 'Volver',
  onConfirm,
  onConfirmed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Si el preview todavía está en camino. Tiene que sentirse inmediato: es un conteo acotado a una noche. */
  loading: boolean
  affected: AffectedOrders | null
  currency: string
  /** La parte variable del mensaje: "de esta noche", "el 25/12", "para Juan Pérez, el viernes a las 21:00". */
  subject: string
  /** Texto del botón cuando SÍ hay algo que cancelar. */
  destructiveLabel?: string
  /** Texto del botón cuando el conteo da 0: no es destructivo, no hace falta asustar. */
  safeLabel?: string
  cancelLabel?: string
  onConfirm: () => Promise<{ ok: boolean; error?: string }>
  /** Se dispara después de un `onConfirm` exitoso, además de cerrar el diálogo. */
  onConfirmed?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDestructive = (affected?.count ?? 0) > 0

  function handleOpenChange(next: boolean) {
    if (pending) return // no se cierra a mitad de una cancelación en curso
    if (!next) setError(null)
    onOpenChange(next)
  }

  function handleConfirm() {
    setError(null)
    setPending(true)
    void (async () => {
      const result = await onConfirm()
      setPending(false)
      if (!result.ok) {
        setError(result.error ?? 'No se pudo completar la cancelación')
        return
      }
      onOpenChange(false)
      onConfirmed?.()
    })()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {loading ? 'Calculando pedidos afectados…' : isDestructive ? '¿Confirmás la cancelación?' : '¿Confirmás?'}
          </DialogTitle>
          <DialogDescription>
            {loading ? (
              'Contando los pedidos programados que todavía no dispararon.'
            ) : affected ? (
              describeCancellationImpact(affected, currency, subject)
            ) : (
              'No pudimos calcular el impacto. Probá de nuevo.'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Un momento…
          </div>
        ) : null}

        {error ? (
          <p role="alert" aria-live="assertive" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? 'destructive' : 'default'}
            disabled={loading || pending || !affected}
            onClick={handleConfirm}
            className="gap-2"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {isDestructive ? destructiveLabel : safeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
