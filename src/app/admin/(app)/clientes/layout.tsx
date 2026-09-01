import { PageFrame } from '@/views/admin/page-frame'
import { ClientesTabs } from '@/views/admin/clientes/clientes-tabs'

/**
 * Marco común del Padrón y Cupones: título fijo, sub-nav de tabs, y el mismo
 * ancho para las dos (`table`, igual que `/admin/pedidos`) porque las dos son
 * listas densas, no formularios. Es solo estructura — NO resuelve sesión.
 * Regla dura del repo: el layout no autoriza, cada `page.tsx` de abajo lo
 * hace de nuevo con `resolveAdminSession()` Y exige `role === 'owner'` (el
 * padrón muestra cuánto gastó cada cliente: información de caja, mismo
 * criterio que `store_couriers`). Mismo patrón que `ajustes/layout.tsx`.
 */
export default function ClientesLayout({ children }: LayoutProps<'/admin/clientes'>) {
  return (
    <PageFrame title="Clientes" width="table">
      <div className="flex flex-col gap-6">
        <ClientesTabs />
        {children}
      </div>
    </PageFrame>
  )
}
