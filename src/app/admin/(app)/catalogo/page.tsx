import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getAdminCatalog } from '@/models/catalog.model'
import { CategoryList } from '@/views/admin/catalogo/category-list'
import { PageFrame } from '@/views/admin/page-frame'

export default async function AdminCatalogPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const categories = await getAdminCatalog(session.store.id)

  return (
    // `table` (90rem) y no `board` (110rem): el catálogo es un ABM denso, no
    // el tablero de cocina — ver el comentario de `PageFrame` sobre qué
    // ancho corresponde a cada intención.
    //
    // El título va sin uppercase ni `.display`: esa voz es la marca del
    // local en su cara de cliente (ver comentario de la clase `.display` en
    // globals.css), y `/admin` no la hereda — comparte tokens y controles,
    // no composición. La vara acá es Linear/Stripe: título chico, plano, que
    // no compite con la fila que sigue. `PageFrame` ya aplica ese criterio.
    <PageFrame
      title="Catálogo"
      description="Esto es lo que ve quien entra a comprar. Los productos con foto se venden más — empezá por ahí."
      width="table"
    >
      <CategoryList storeId={session.store.id} currency={session.store.currency} categories={categories} />
    </PageFrame>
  )
}
