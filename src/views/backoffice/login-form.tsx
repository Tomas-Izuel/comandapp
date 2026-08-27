'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, Loader2 } from 'lucide-react'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { GoogleIcon } from '@/views/shared/icons/google'

/**
 * Login de plataforma: contraseña y, si el usuario tiene un factor TOTP
 * verificado, un segundo paso con el código. La sesión no se considera
 * "adentro" hasta que `getAuthenticatorAssuranceLevel` diga `aal2` — antes de
 * eso las RLS no muestran una sola fila, así que empujar al usuario para
 * adelante acá es UX, no autorización.
 *
 * Google es una PUERTA alternativa al mismo primer paso, no un atajo del
 * TOTP: deja la sesión en `aal1`, igual que `signInWithPassword` recién
 * hecho. El intercambio real pasa por `/backoffice/auth/callback` (Route
 * Handler, server-side) porque `@supabase/ssr` necesita escribir la cookie de
 * sesión en una respuesta — un Client Component no puede.
 */

type Step = 'credentials' | 'totp'

export function BackofficeLoginForm({
  initialError,
  showGoogleAuth = false,
}: {
  initialError?: string
  showGoogleAuth?: boolean
}) {
  const router = useRouter()
  const errorId = useId()
  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [pending, startTransition] = useTransition()
  const [googlePending, setGooglePending] = useState(false)

  function handleGoogle() {
    setError(null)
    setGooglePending(true)
    const supabase = createBrowserClient()
    supabase.auth
      .signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/backoffice/auth/callback` },
      })
      .then(({ error: oauthError }) => {
        // En éxito el browser ya se está yendo a Google: este `.then` solo
        // corre cuando `signInWithOAuth` no pudo ni arrancar la redirección.
        if (oauthError) {
          setError('No pudimos iniciar el ingreso con Google. Probá de nuevo.')
          setGooglePending(false)
        }
      })
  }

  function handleCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const supabase = createBrowserClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError('Email o contraseña incorrectos')
        return
      }

      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalError) {
        setError(aalError.message)
        return
      }

      if (aal.currentLevel === 'aal2') {
        router.push('/backoffice')
        router.refresh()
        return
      }

      if (aal.nextLevel !== 'aal2') {
        // No hay ningún factor TOTP enrolado todavía: no se lo deja entrar en
        // aal1, va derecho a configurar su authenticator.
        router.push('/backoffice/mfa')
        return
      }

      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      // `factorsData.totp` ya viene filtrado a solo factores verificados.
      const totpFactor = factorsData?.totp[0]
      if (factorsError || !totpFactor) {
        setError('No se pudo encontrar tu authenticator. Pedile a otro administrador que revise tu cuenta.')
        return
      }

      setFactorId(totpFactor.id)
      setStep('totp')
    })
  }

  function handleTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!factorId) return

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

  if (step === 'totp') {
    return (
      <form onSubmit={handleTotp} className="flex flex-col gap-5" aria-label="Verificación en dos pasos">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-code">Código del authenticator</Label>
          <Input
            id="totp-code"
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

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={pending || code.length < 6} size="lg">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Verificar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setStep('credentials')
              setCode('')
              setError(null)
            }}
          >
            Volver
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <Alert variant="destructive" id={errorId}>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {showGoogleAuth ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={googlePending || pending}
            onClick={handleGoogle}
            className="gap-2"
          >
            {googlePending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GoogleIcon />}
            Continuar con Google
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs">o</span>
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}

      <form onSubmit={handleCredentials} className="flex flex-col gap-5" aria-label="Iniciar sesión">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            spellCheck={false}
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        <Button type="submit" disabled={pending} size="lg">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Ingresar
        </Button>
      </form>
    </div>
  )
}
