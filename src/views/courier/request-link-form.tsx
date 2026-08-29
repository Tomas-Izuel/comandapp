'use client'

import { useId, useState, useTransition } from 'react'
import { Mail, ArrowRight, Loader2, CircleCheck } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { requestMagicLinkAction } from '@/controllers/admin.actions'

/**
 * Mismo formulario que `/admin/acceso` (un solo campo, misma respuesta
 * exista o no ese email), con `surface: 'courier'` para que el link vuelva acá
 * y no al panel del local. La acción es la misma —`admin.actions.ts` es dueño
 * de todo el mecanismo de magic link, repartidor incluido— así que no hay
 * nada que reimplementar más que el copy.
 */
export function RequestCourierLinkForm({ initialError }: { initialError?: string }) {
  const emailId = useId()
  const errorId = useId()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await requestMagicLinkAction(email, 'courier')
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSent(true)
    })
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CircleCheck className="text-primary size-8" />
        <p className="text-base">
          Si <span className="font-medium">{email}</span> está activo como repartidor de algún local, te llegó un
          link nuevo. Revisá tu correo.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          Usar otro email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId} className="sr-only">
          Email
        </Label>
        <div className="relative">
          <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
          <Input
            id={emailId}
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-14 pl-10 text-base"
          />
        </div>
      </div>
      {error ? (
        <p id={errorId} className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || email.trim().length === 0} className="h-14 gap-2 text-base">
        {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        Enviarme un link nuevo
        {!pending ? <ArrowRight className="size-5" aria-hidden /> : null}
      </Button>
    </form>
  )
}
