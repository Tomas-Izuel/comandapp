import type { Metadata } from 'next'
import { getUnsubscribeTargetAction } from '@/controllers/unsubscribe.actions'
import { UnsubscribeView } from '@/views/unsubscribe/unsubscribe-view'

export const metadata: Metadata = { title: 'Darte de baja' }

/**
 * Ruta de nivel raíz, sin auth: lo único que autoriza es el token, mismo
 * modelo que `/pedido/[token]`. El `GET` es de solo lectura a propósito —RFC
 * 8058 exige que dar de baja sea un `POST` explícito, porque los escáneres de
 * link de los clientes de mail hacen `GET` de todo, y una baja disparada por
 * un prefetch es una baja que nadie pidió.
 *
 * `target` colapsa a `null` tanto si el token no existe como si la baja ya
 * estaba confirmada: la vista no distingue esos dos casos (ver el comentario
 * de `unsubscribe-view.tsx`), así que ni siquiera vale la pena que este
 * archivo lo sepa.
 */
export default async function UnsubscribePage(props: PageProps<'/baja/[token]'>) {
  const { token } = await props.params
  const result = await getUnsubscribeTargetAction(token)
  const target = result.ok && !result.data.alreadyOptedOut ? { storeName: result.data.storeName } : null

  return <UnsubscribeView token={token} target={target} />
}
