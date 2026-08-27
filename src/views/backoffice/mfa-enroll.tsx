'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, Loader2 } from 'lucide-react'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Enrolamiento de TOTP. Sin esto, un admin recién creado por SQL queda en
 * aal1 para siempre: las RLS no le muestran nada y no hay forma de pedir el
 * código de un authenticator que nunca configuró.
 *
 * Si ya hay un factor verificado, esta pantalla no tiene nada que hacer —
 * manda a loguearse de nuevo, ahí se pide el código.
 */

type Phase = 'checking' | 'already-enrolled' | 'ready' | 'verifying'

export function BackofficeMfaEnroll() {
  const router = useRouter()
  const errorId = useId()
  const [phase, setPhase] = useState<Phase>('checking')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      const supabase = createBrowserClient()
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (factorsError) {
        setError(factorsError.message)
        return
      }

      // `factorsData.totp` ya viene filtrado por Supabase a solo factores
      // VERIFICADOS — los no verificados solo aparecen en `.all`.
      if (factorsData.totp.length > 0) {
        setPhase('already-enrolled')
        return
      }

      // Limpia intentos de enrolamiento abandonados antes de crear uno nuevo:
      // Supabase limita cuántos factores sin verificar puede tener un usuario.
      const abandoned = factorsData.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified')
      for (const factor of abandoned) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
      if (cancelled) return

      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (cancelled) return
      if (enrollError || !enrolled) {
        setError(enrollError?.message ?? 'No se pudo iniciar el enrolamiento')
        return
      }

      setFactorId(enrolled.id)
      setQrCode(enrolled.totp.qr_code)
      setSecret(enrolled.totp.secret)
      setPhase('ready')
    }

    setup()
    return () => {
      cancelled = true
    }
  }, [])

  function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!factorId) return
    setError(null)
    setPhase('verifying')

    createBrowserClient()
      .auth.mfa.challengeAndVerify({ factorId, code })
      .then(({ error: verifyError }) => {
        if (verifyError) {
          setError('El código no es válido o venció. Probá con el siguiente que te muestre la app.')
          setCode('')
          setPhase('ready')
          return
        }
        router.push('/backoffice')
        router.refresh()
      })
  }

  if (phase === 'checking') {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Preparando el enrolamiento
      </div>
    )
  }

  if (phase === 'already-enrolled') {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertDescription>
            Ya tenés un authenticator configurado. Iniciá sesión de nuevo e ingresá el código ahí.
          </AlertDescription>
        </Alert>
        <Button size="lg" onClick={() => router.push('/backoffice/login')}>
          Ir a iniciar sesión
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {error && phase === 'ready' ? (
        <Alert variant="destructive" id={errorId}>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {qrCode ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL SVG, no hay Image loader que la sirva mejor */}
          <img
            src={qrCode}
            alt="Código QR para enrolar el authenticator"
            width={200}
            height={200}
            className="border-border rounded-lg border"
          />
          {secret ? (
            <p className="text-muted-foreground max-w-[32ch] text-center text-xs">
              Si no podés escanear el código, cargá esta clave a mano en tu app de authenticator:
              <br />
              <span className="text-foreground font-mono tracking-[0.08em] select-all">{secret}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="border-border border-t" />

      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mfa-code">Código de 6 dígitos</Label>
          <Input
            id="mfa-code"
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
        <Button type="submit" size="lg" disabled={phase === 'verifying' || code.length < 6}>
          {phase === 'verifying' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Confirmar
        </Button>
      </form>
    </div>
  )
}
