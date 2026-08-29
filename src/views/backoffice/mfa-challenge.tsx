'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, Loader2 } from 'lucide-react'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Desafío de TOTP para una sesión que ya tiene un factor verificado pero
 * quedó en `aal1` — el caso de Google, que vuelve por un redirect y no tiene
 * la continuación del lado del cliente que sí tiene el login por contraseña
 * (`login-form.tsx` pide el código ahí mismo, justo después de
 * `signInWithPassword`, dentro del mismo flujo). Acá esa continuación necesita
 * ser una página propia.
 *
 * Mismo control, mismo tratamiento visual que el paso `totp` de
 * `login-form.tsx`: es el mismo pedido llegando por otra puerta, no un
 * control nuevo.
 */
export function BackofficeMfaChallenge({ factorId }: { factorId: string }) {
  const router = useRouter()
  const errorId = useId()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const supabase = createBrowserClient()
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (verifyError) {
        setError('El código no es válido o venció. Probá con el siguiente que te muestre la app.')
        setCode('')
        return
      }
      router.push('/backoffice')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Verificación en dos pasos">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="challenge-code">Código del authenticator</Label>
        <Input
          id="challenge-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="text-center text-lg tracking-[0.3em] tabular-nums"
        />
      </div>

      {error ? (
        <Alert variant="destructive" id={errorId}>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending || code.length < 6} size="lg">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Verificar
      </Button>
    </form>
  )
}
