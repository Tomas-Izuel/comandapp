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
import { confirmPendingChangeAction, resendPendingChangeCodeAction } from '@/controllers/admin.actions'
import type { PendingChangeStarted } from '@/controllers/admin.controller'
import type { ActionResult } from '@/models/types'

/**
 * El patrón "pedí → te llega un código → confirmá" (S-03 en CLAUDE.md), la
 * pieza que usan `payment-form.tsx` y la parte de "el repartidor cobra" de
 * `settings-form.tsx`.
 *
 * Es un `Dialog` y no una sección inline a propósito: acá se cierra un cambio
 * que mueve plata o política de cobro, con un código de un solo uso y 5
 * intentos — exactamente el tipo de tarea que sí necesita foco protegido
 * (operate.md: "modal es de última instancia", pero un paso de segundo factor
 * es el caso que sí lo justifica, igual que un banco).
 *
 * `requestChange` es lo único que varía entre los dos consumidores — el resto
 * del flujo (mandar código, confirmar, reenviar) es SIEMPRE
 * `confirmPendingChangeAction` / `resendPendingChangeCodeAction`, así que este
 * componente los importa directo en vez de recibirlos como props: no hay
 * variante razonable de "confirmar" que no sea esa acción.
 */
type RequestResult = ActionResult<PendingChangeStarted>

type Phase =
  | { step: 'requesting' }
  | { step: 'request-failed'; message: string }
  | { step: 'code'; requestId: number; sentTo: string }
  | { step: 'confirming'; requestId: number; sentTo: string }
  | { step: 'resending'; requestId: number; sentTo: string }

export type ConfirmWithCodeHandle = { start: () => void }

export const ConfirmWithCode = forwardRef<
  ConfirmWithCodeHandle,
  {
    storeId: number
    title: string
    description: string
    requestChange: () => Promise<RequestResult>
    onConfirmed: () => void
    /**
     * Además del mensaje genérico que ya muestra el diálogo, el caller puede
     * querer marcar un campo propio (p. ej. el access token) cuando el pedido
     * falla por validación — eso no es asunto de este componente, que no sabe
     * qué campos tiene el form de quien lo usa.
     */
    onRequestFailed?: (result: Extract<RequestResult, { ok: false }>) => void
    /** El toggle o el form que abrió esto necesita saber que se canceló, para volver a su valor anterior. */
    onCancel?: () => void
  }
>(function ConfirmWithCode({ storeId, title, description, requestChange, onConfirmed, onRequestFailed, onCancel }, ref) {
  const [phase, setPhase] = useState<Phase | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const codeId = useId()
  const codeErrorId = useId()

  useImperativeHandle(ref, () => ({
    start() {
      setCode('')
      setCodeError(null)
      setPhase({ step: 'requesting' })
      startTransition(async () => {
        const result = await requestChange()
        if (!result.ok) {
          setPhase({ step: 'request-failed', message: result.error })
          onRequestFailed?.(result)
          return
        }
        setPhase({ step: 'code', requestId: result.data.requestId, sentTo: result.data.sentTo })
      })
    },
  }))

  // Foco automático apenas aparece el input: nadie tiene que ir a buscarlo con
  // el pulgar después de leer "te mandamos un código a...".
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
      const result = await confirmPendingChangeAction(storeId, requestId, code)
      if (!result.ok) {
        // El servidor ya trae los intentos restantes en el mensaje (S-03): se
        // muestra tal cual, es interfaz.
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
  const codeStep = phase?.step === 'code' || phase?.step === 'confirming' || phase?.step === 'resending'

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {phase?.step === 'requesting' ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Mandando el código…
          </div>
        ) : null}

        {phase?.step === 'request-failed' ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="text-destructive text-sm">
              {phase.message}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Volver
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {codeStep && phase ? (
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
              {/* `aria-live` porque un error acá no mueve el foco: sin esto, con
                  lector de pantalla el rechazo del código pasa en silencio. */}
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
