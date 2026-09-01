'use client'

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, useTransition } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resendPendingChangeCodeAction } from '@/controllers/admin.actions'
import { confirmCouponChangeAction } from '@/controllers/marketing.actions'
import type { PendingChangeStarted } from '@/controllers/admin.controller'

/**
 * El paso del código de 6 dígitos para cupones. Visualmente y en interacción
 * es EL MISMO diseño que `views/admin/shared/confirm-with-code.tsx` (Mercado
 * Pago y la cuenta bancaria) — mismo layout, mismo input, mismos mensajes,
 * mismos 10 minutos, mismo "mandar otro código". Es un archivo hermano y no
 * el mismo componente por una razón concreta y no estética:
 *
 * `ConfirmWithCode` importa `confirmPendingChangeAction` DIRECTO desde
 * `admin.actions.ts` (no lo recibe por prop) y esa función tiene un switch
 * cerrado sobre `change.kind`: `payment_credentials` y `bank_account` tienen
 * rama propia, y CUALQUIER otro kind cae en la rama final, que escribe
 * `stores.courier_collects_payment`. Con `kind: 'coupon'` eso hubiera
 * ejecutado un `update` equivocado sobre la tienda en vez de aplicar el
 * cambio de cupón (T1B ya escribió `confirmCouponChangeAction`, que sí lo hace
 * bien). Ni `confirm-with-code.tsx` ni `admin.actions.ts` son archivos de
 * este slice — tocar el switch para sumar `'coupon'` es exactamente el "para
 * y reportá" que el brief pide. Quedó reportado en el dev log de T4B.
 *
 * `resendPendingChangeCodeAction` en cambio SÍ es seguro de reusar tal cual:
 * no bifurca por `kind`, re-envía con el `kind`/`payload` de la solicitud
 * viva. Se importa igual que en `ConfirmWithCode`.
 *
 * Diferencia de forma con `ConfirmWithCode`: acá el "pedido" del código ya
 * pasó cuando este componente se abre — lo dispara el LLAMADOR
 * (`requestCouponActivationAction` para activar, o el propio
 * `updateCouponAction` cuando editar un activo escala) porque en cupones hay
 * DOS caminos que terminan en un pending change y uno de ellos ya viene
 * resuelto adentro de la Server Action que guarda el formulario. Por eso este
 * componente no tiene una prop `requestChange`: se abre ya con el
 * `PendingChangeStarted` en mano.
 */
export type ConfirmCouponCodeHandle = { openWithPending: (pending: PendingChangeStarted) => void }

type Phase =
  | { step: 'code'; requestId: number; sentTo: string }
  | { step: 'confirming'; requestId: number; sentTo: string }
  | { step: 'resending'; requestId: number; sentTo: string }

export const ConfirmCouponCode = forwardRef<
  ConfirmCouponCodeHandle,
  {
    storeId: number
    title: string
    description: string
    onConfirmed: () => void
    onCancel?: () => void
  }
>(function ConfirmCouponCode({ storeId, title, description, onConfirmed, onCancel }, ref) {
  const [phase, setPhase] = useState<Phase | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const codeId = useId()
  const codeErrorId = useId()

  useImperativeHandle(ref, () => ({
    openWithPending(pending) {
      setCode('')
      setCodeError(null)
      setPhase({ step: 'code', requestId: pending.requestId, sentTo: pending.sentTo })
    },
  }))

  // Mismo motivo que `ConfirmWithCode`: nadie va a buscar el input con el
  // pulgar después de leer "te mandamos un código a...".
  useEffect(() => {
    if (phase?.step === 'code') codeInputRef.current?.focus()
  }, [phase?.step])

  function close() {
    setPhase(null)
    onCancel?.()
  }

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (phase?.step !== 'code' || code.length !== 6) return
    const { requestId, sentTo } = phase
    setCodeError(null)
    setPhase({ step: 'confirming', requestId, sentTo })
    startTransition(async () => {
      const result = await confirmCouponChangeAction(storeId, requestId, code)
      if (!result.ok) {
        setCodeError(result.fieldErrors?.code?.[0] ?? result.error)
        setCode('')
        setPhase({ step: 'code', requestId, sentTo })
        return
      }
      setPhase(null)
      onConfirmed()
    })
  }

  function handleResend() {
    if (phase?.step !== 'code') return
    const { requestId, sentTo } = phase
    setCodeError(null)
    setPhase({ step: 'resending', requestId, sentTo })
    startTransition(async () => {
      const result = await resendPendingChangeCodeAction(storeId, requestId)
      if (!result.ok) {
        setCodeError(result.error)
        setPhase({ step: 'code', requestId, sentTo })
        return
      }
      setCode('')
      setPhase({ step: 'code', requestId: result.data.requestId, sentTo: result.data.sentTo })
    })
  }

  const open = phase !== null

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {phase ? (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-sm">
              Te mandamos un código a <span className="font-medium">{phase.sentTo}</span>. Vence en 10 minutos.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={codeId}>Código de 6 dígitos</Label>
              <Input
                ref={codeInputRef}
                id={codeId}
                value={code}
                onChange={(e) => {
                  setCodeError(null)
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                disabled={phase.step !== 'code'}
                aria-invalid={!!codeError}
                aria-describedby={codeError ? codeErrorId : undefined}
                className="tabular h-12 text-center text-lg tracking-[0.3em]"
              />
              <p id={codeErrorId} role="alert" aria-live="assertive" className="text-destructive min-h-4 text-xs">
                {codeError}
              </p>
            </div>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={handleResend}
              disabled={phase.step !== 'code'}
              className="h-11 w-fit gap-1.5 px-0"
            >
              {phase.step === 'resending' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Mandar otro código
            </Button>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={phase.step !== 'code' || code.length !== 6} className="gap-2">
                {phase.step === 'confirming' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
})
