import type { Metadata } from 'next'
import { redirectIfAlreadyAuthorized } from '@/controllers/platform.controller'
import { serverEnv } from '@/lib/env.server'
import { Panel } from '@/views/shared/surfaces'
import { BackofficeLoginForm } from '@/views/backoffice/login-form'

export const metadata: Metadata = { title: 'Ingresar — Backoffice' }

/**
 * `error` viene del callback de Google (`/backoffice/auth/callback`) cuando
 * el intercambio del `code` falla. Mismo patrón que `/admin/acceso`: un mapa
 * de código → mensaje en español, nunca el detalle crudo de Supabase.
 */
const ERROR_MESSAGES: Record<string, string> = {
  sin_acceso: 'Esa cuenta de Google no tiene acceso al backoffice.',
  google_fallo: 'No pudimos completar el ingreso con Google. Probá de nuevo.',
}

export default async function BackofficeLoginPage(props: PageProps<'/backoffice/login'>) {
  await redirectIfAlreadyAuthorized()

  const searchParams = await props.searchParams
  const errorParam = typeof searchParams.error === 'string' ? searchParams.error : null

  // El botón de Google no se renderiza si el backoffice no lo tiene
  // configurado: mejor ausente que roto. `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`
  // es el único dato que Next necesita para esa decisión — el secret nunca
  // llega a esta app, lo usa Supabase Auth directo (ver `env.server.ts`).
  const showGoogleAuth = Boolean(serverEnv().SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Backoffice</h1>
          <p className="text-muted-foreground text-sm">
            Acceso de plataforma. Contraseña y authenticator — el staff de cada local entra por otro lado, con link
            mágico.
          </p>
        </div>

        <Panel className="p-6">
          <BackofficeLoginForm
            initialError={errorParam ? ERROR_MESSAGES[errorParam] : undefined}
            showGoogleAuth={showGoogleAuth}
          />
        </Panel>
      </div>
    </div>
  )
}
