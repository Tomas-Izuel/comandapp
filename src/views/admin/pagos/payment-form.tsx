'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, CircleHelp, Copy, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { MercadoPago } from '@/components/ui/mercadopago'
import { requestPaymentCredentialsChangeAction, requestPaymentSupportAction } from '@/controllers/admin.actions'
import { ConfirmWithCode, type ConfirmWithCodeHandle } from '@/views/admin/shared/confirm-with-code'
import type { PaymentConnectionStatus } from '@/controllers/admin.controller'

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="bg-muted flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs">{value}</code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Copiar URL"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

/**
 * "Pedir ayuda" (S-brief): conectar Mercado Pago es el paso del alta que más se
 * traba, y a diferencia del resto de esta pantalla CUALQUIER staff lo puede
 * pedir — no hace falta ser dueño para avisar que algo no funciona.
 *
 * Empieza colapsado en un botón: no es la acción primaria de la pantalla, y
 * mostrar el textarea siempre le restaría jerarquía al formulario de
 * credenciales, que sí lo es.
 */
function SupportRequest({ storeId }: { storeId: number }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSend() {
    startTransition(async () => {
      const result = await requestPaymentSupportAction(storeId, message)
      if (!result.ok) {
        toast.error('No pudimos mandar tu pedido', { description: result.error })
        return
      }
      setSent(true)
    })
  }

  if (sent) {
    return (
      <p role="status" className="bg-muted rounded-lg p-4 text-sm">
        <span className="font-medium">Listo, ya avisamos al equipo.</span> Te contestamos por mail apenas lo veamos.
      </p>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="w-fit gap-2">
        <CircleHelp className="size-4" aria-hidden />
        Pedir ayuda para conectar
      </Button>
    )
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Pedir ayuda para conectar Mercado Pago</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Le avisamos al equipo con el estado actual de tu conexión. La respuesta te llega por mail, no acá.
        </p>
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
        placeholder="Contanos qué te está pasando (opcional)"
        rows={3}
        maxLength={2000}
        aria-label="Mensaje para el equipo de soporte"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSend} disabled={pending} className="gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Mandar pedido de ayuda
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

export function PaymentForm({
  storeId,
  status,
  webhookUrl,
}: {
  storeId: number
  status: PaymentConnectionStatus
  webhookUrl: string
}) {
  const router = useRouter()
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Por campo (S-08 puede rechazar el token con un `field: 'accessToken'`, y
  // Zod hace lo mismo para cualquiera de los dos): sin esto, un token de
  // producción con `TEST-` en el medio del ambiente equivocado se mostraba
  // como un error genérico arriba del form en vez de señalar el input.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const confirmRef = useRef<ConfirmWithCodeHandle>(null)

  const accessTokenError = fieldErrors.accessToken?.[0]
  const webhookSecretError = fieldErrors.webhookSecret?.[0]

  // El submit YA NO guarda nada: solo dispara el pedido de código
  // (`ConfirmWithCode` llama a `requestPaymentCredentialsChangeAction`).
  // Reemplazar el access token de Mercado Pago redirige TODOS los cobros
  // online del local, así que ni siendo dueño alcanza con la sesión abierta —
  // el código va a un canal que la sesión no controla.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSubmitting(true)
    confirmRef.current?.start()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border flex items-start gap-3 rounded-lg border p-4">
        {/* Un solo lugar en toda la pantalla donde aparece el isotipo: acá,
            anclando el estado de la conexión — no repetido en cada línea de
            texto que ya dice "Mercado Pago". */}
        <MercadoPago aria-hidden className="mt-0.5 h-5 w-auto shrink-0" />
        <div className="min-w-0">
          <p className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.08em] uppercase">Estado</p>
          {status.connected ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="bg-primary/10 text-primary rounded-pill px-2.5 py-0.5 text-xs font-medium">Conectado</span>
              <span
                className={
                  // Prueba usa `--warning` (F-16, resuelto): no hay nada roto,
                  // pero cobrar de verdad con un token de prueba sí lo estaría —
                  // por eso ni el gris neutral de `muted` ni el rojo de
                  // `destructive` encajan acá.
                  status.isSandbox
                    ? 'text-warning-foreground bg-warning/20 rounded-pill px-2.5 py-0.5 text-xs font-medium'
                    : 'bg-muted text-muted-foreground rounded-pill px-2.5 py-0.5 text-xs font-medium'
                }
              >
                {status.isSandbox ? 'Modo prueba' : 'Modo real'}
              </span>
              {status.accessTokenPreview ? (
                <span className="text-muted-foreground font-mono text-xs">{status.accessTokenPreview}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1.5 text-sm">Todavía no conectaste una cuenta de Mercado Pago.</p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">URL de notificaciones</p>
        <p className="text-muted-foreground mb-2 text-sm">
          Pegá esta URL en Mercado Pago (Tu negocio → Configuración → Webhooks) para que los pagos se confirmen solos.
        </p>
        <CopyField value={webhookUrl} />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="access-token">Access token</Label>
          <Input
            id="access-token"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="APP_USR-… o TEST-…"
            autoComplete="off"
            spellCheck={false}
            required
            disabled={submitting}
            aria-invalid={!!accessTokenError}
            aria-describedby={accessTokenError ? 'access-token-error' : undefined}
            className="h-10 font-mono text-sm"
          />
          {accessTokenError ? (
            <p id="access-token-error" role="alert" className="text-destructive text-xs">
              {accessTokenError}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">Credenciales → Producción o Prueba, en tu cuenta de Mercado Pago.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-secret">Clave secreta del webhook</Label>
          <Input
            id="webhook-secret"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="La que te muestra Mercado Pago al guardar la URL de arriba"
            autoComplete="off"
            spellCheck={false}
            required
            disabled={submitting}
            aria-invalid={!!webhookSecretError}
            aria-describedby={webhookSecretError ? 'webhook-secret-error' : undefined}
            className="h-10 font-mono text-sm"
          />
          {webhookSecretError ? (
            <p id="webhook-secret-error" role="alert" className="text-destructive text-xs">
              {webhookSecretError}
            </p>
          ) : null}
        </div>

        {/* Si el error ya se muestra pegado al campo que lo causó, repetirlo
            acá arriba es ruido — pero un fallo sin campo (token que no valida
            contra la API de MP, "permission denied" traducido a genérico, un
            504) no tiene otro lugar donde aparecer. */}
        {error && !accessTokenError && !webhookSecretError ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <p className="text-muted-foreground text-xs">
          Al confirmar te vamos a mandar un código de 6 dígitos al mail de tu cuenta para autorizar el cambio — antes
          de que se guarde nada.
        </p>

        <Button type="submit" disabled={submitting} className="h-10 w-fit gap-2">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {status.connected ? 'Actualizar conexión' : 'Conectar Mercado Pago'}
        </Button>
      </form>

      <div className="border-border border-t pt-6">
        <SupportRequest storeId={storeId} />
      </div>

      <ConfirmWithCode
        ref={confirmRef}
        storeId={storeId}
        title="Confirmá el cambio de credenciales"
        description="Reemplazar el access token cambia a dónde va la plata de todos los cobros online del local."
        requestChange={() => requestPaymentCredentialsChangeAction(storeId, { accessToken, webhookSecret })}
        onRequestFailed={(result) => {
          setError(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          setSubmitting(false)
        }}
        onCancel={() => setSubmitting(false)}
        onConfirmed={() => {
          toast.success('Mercado Pago conectado')
          setAccessToken('')
          setWebhookSecret('')
          setSubmitting(false)
          router.refresh()
        }}
      />
    </div>
  )
}
