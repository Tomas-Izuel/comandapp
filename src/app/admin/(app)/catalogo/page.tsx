import { redirect } from 'next/navigation'
import { resolveAdminSession } from '@/controllers/admin.controller'
import { getAdminCatalog } from '@/models/catalog.model'
import { CategoryList } from '@/views/admin/catalogo/category-list'

export default async function AdminCatalogPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const categories = await getAdminCatalog(session.store.id)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
      {/*
        Sin uppercase ni `.display`: esa voz es la marca del local en su
        cara de cliente (ver comentario de la clase `.display` en
        globals.css), y `/admin` no la hereda — comparte tokens y controles,
        no composición. La vara acá es Linear/Stripe: título chico, plano,
        que no compite con la fila que sigue.
      */}
      <div>
        <h1 className="text-foreground text-xl font-semibold">Catálogo</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Esto es lo que ve quien entra a comprar. Los productos con foto se venden más — empezá por ahí.
        </p>
      </div>
      <CategoryList storeId={session.store.id} currency={session.store.currency} categories={categories} />
    </div>
  )
}
