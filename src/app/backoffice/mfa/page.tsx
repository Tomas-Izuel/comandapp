import type { Metadata } from 'next'
import { redirectIfAlreadyAuthorized, requireAuthenticatedUser } from '@/controllers/platform.controller'
import { Panel } from '@/views/shared/surfaces'
import { BackofficeMfaEnroll } from '@/views/backoffice/mfa-enroll'

export const metadata: Metadata = { title: 'Configurar authenticator — Backoffice' }

export default async function BackofficeMfaPage() {
  await redirectIfAlreadyAuthorized()
  const { email } = await requireAuthenticatedUser()

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Configurar authenticator</h1>
          <p className="text-muted-foreground text-sm">
            {email ? `${email} ` : 'Tu cuenta '}
            todavía no tiene un segundo factor. Sin uno, las políticas de la base no te van a mostrar nada del
            backoffice.
          </p>
        </div>

        <Panel className="p-6">
          <BackofficeMfaEnroll />
        </Panel>
      </div>
    </div>
  )
}
