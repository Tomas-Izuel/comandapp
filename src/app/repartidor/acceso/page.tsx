import type { Metadata } from 'next'
import { RequestCourierLinkForm } from '@/views/courier/request-link-form'

export const metadata: Metadata = {
  title: 'Pedir acceso — Repartidor',
}

const ERROR_MESSAGES: Record<string, string> = {
  link_invalido: 'Ese link ya venció o no es válido. Pedí uno nuevo.',
}

/**
 * Espejo de `/admin/acceso`: no es la puerta de entrada (esa es la
 * invitación que manda el local, ya con el link armado), solo la reposición
 * cuando ese link —o cualquier reenvío— venció.
 */
export default async function CourierAccessPage(props: PageProps<'/repartidor/acceso'>) {
  const searchParams = await props.searchParams
  const errorParam = typeof searchParams.error === 'string' ? searchParams.error : null

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Entrar como repartidor</h1>
        <p className="text-muted-foreground mt-2 mb-6 text-center text-base">
          Tu link anterior venció o dejó de funcionar. Pedí uno nuevo con el email que te invitó el local.
        </p>
        <RequestCourierLinkForm initialError={errorParam ? ERROR_MESSAGES[errorParam] : undefined} />
      </div>
    </div>
  )
}
