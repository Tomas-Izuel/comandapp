import type { Metadata } from 'next'
import { RequestLinkForm } from '@/views/admin/acceso/request-link-form'

export const metadata: Metadata = {
  title: 'Pedir acceso — Panel del local',
}

const ERROR_MESSAGES: Record<string, string> = {
  link_invalido: 'Ese link ya venció o no es válido. Pedí uno nuevo.',
}

/**
 * Esta página ya NO es la puerta de entrada al panel: la invitación se
 * empuja desde el backoffice apenas se da de alta la tienda, y ese primer
 * mail ya trae el link. Lo único que queda acá es la reposición cuando ese
 * link (o cualquier reenvío posterior) venció — por eso nadie llega
 * escribiendo la URL a mano, siempre desde un mail vencido.
 */
export default async function RequestAccessPage(props: PageProps<'/admin/acceso'>) {
  const searchParams = await props.searchParams
  const errorParam = typeof searchParams.error === 'string' ? searchParams.error : null

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Pedir un link de acceso</h1>
        <p className="text-muted-foreground mt-2 mb-6 text-center text-sm">
          Tu link anterior venció o dejó de funcionar. Pedí uno nuevo con el email que usás en el staff de tu local.
        </p>
        <RequestLinkForm initialError={errorParam ? ERROR_MESSAGES[errorParam] : undefined} />
      </div>
    </div>
  )
}
