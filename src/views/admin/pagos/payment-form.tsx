'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { savePaymentCredentialsAction } from '@/controllers/admin.actions'
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

export function PaymentForm({
  storeId,
  status,
  webhookUrl,
}: {
  storeId: number
  status: PaymentConnectionStatus
  webhookUrl: string
}) {
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await savePaymentCredentialsAction(storeId, { accessToken, webhookSecret })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Mercado Pago conectado')
      setAccessToken('')
      setWebhookSecret('')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border rounded-lg border p-4">
        <p className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.08em] uppercase">Estado</p>
        {status.connected ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium">Conectado</span>
            <span
              className={
                // Prueba usa `--warning` (F-16, resuelto): no hay nada roto,
                // pero cobrar de verdad con un token de prueba sí lo estaría —
                // por eso ni el gris neutral de `muted` ni el rojo de
                // `destructive` encajan acá.
                status.isSandbox
                  ? 'text-warning-foreground bg-warning/20 rounded-full px-2.5 py-0.5 text-xs font-medium'
                  : 'bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium'
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
            className="h-10 font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs">Credenciales → Producción o Prueba, en tu cuenta de Mercado Pago.</p>
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
            className="h-10 font-mono text-sm"
          />
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {status.connected ? 'Actualizar conexión' : 'Conectar Mercado Pago'}
        </Button>
      </form>
    </div>
  )
}
