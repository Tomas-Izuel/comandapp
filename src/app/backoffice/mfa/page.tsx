import type { Metadata } from 'next'
import { redirectIfAlreadyAuthorized, requireAuthenticatedUser } from '@/controllers/platform.controller'
import { signOutAction } from '@/controllers/platform.actions'
import { createClient } from '@/lib/supabase/server'
import { Panel } from '@/views/shared/surfaces'
import { Button } from '@/components/ui/button'
import { BackofficeMfaEnroll } from '@/views/backoffice/mfa-enroll'
import { BackofficeMfaChallenge } from '@/views/backoffice/mfa-challenge'

export const metadata: Metadata = { title: 'Verificación en dos pasos — Backoffice' }

export default async function BackofficeMfaPage() {
  await redirectIfAlreadyAuthorized()
  const { email } = await requireAuthenticatedUser()

  // `/backoffice/mfa` cubre las dos mitades del segundo factor: enrolar un
  // TOTP nuevo o desafiar uno que ya existe. `listFactors()` es sobre el
  // usuario autenticado, no una lectura de tabla, así que se puede leer en
  // aal1 — es la señal que decide cuál de las dos mitades mostrar.
  const supabase = await createClient()
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const totpFactor = factorsData?.totp[0] ?? null

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {totpFactor ? 'Ingresá el código' : 'Configurar authenticator'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {totpFactor
              ? `Tu cuenta${email ? ` (${email})` : ''} ya tiene un authenticator configurado. Abrí la app y escribí el código de 6 dígitos para entrar.`
              : `${email ? `${email} ` : 'Tu cuenta '}todavía no tiene un segundo factor. Sin uno, las políticas de la base no te van a mostrar nada del backoffice.`}
          </p>
        </div>

        <Panel className="p-6">
          {totpFactor ? <BackofficeMfaChallenge factorId={totpFactor.id} /> : <BackofficeMfaEnroll />}
        </Panel>

        {/* Salida siempre disponible: quien perdió el authenticator no puede
            quedar encerrado en esta pantalla sin más recurso que borrar cookies. */}
        <form action={signOutAction} className="mt-6 flex justify-center">
          <Button type="submit" variant="ghost" className="text-muted-foreground">
            Salir
          </Button>
        </form>
      </div>
    </div>
  )
}
