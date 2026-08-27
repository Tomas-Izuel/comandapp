import type { Metadata } from 'next'
import Link from 'next/link'
import { listPlatformStores } from '@/models/platform.model'
import { StoreTable } from '@/views/backoffice/store-table'
import { EmptyState } from '@/views/shared/states'
import { Panel } from '@/views/shared/surfaces'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Tiendas — Backoffice' }

const FILTERS = [
  { value: 'todas', label: 'Todas' },
  { value: 'activas', label: 'Activas' },
  { value: 'suspendidas', label: 'Suspendidas' },
] as const

export default async function BackofficeStoresPage(props: PageProps<'/backoffice/tiendas'>) {
  const searchParams = await props.searchParams
  const filterParam = typeof searchParams.estado === 'string' ? searchParams.estado : 'todas'
  const filter = FILTERS.some((f) => f.value === filterParam) ? filterParam : 'todas'

  const stores = await listPlatformStores()
  const filtered = stores.filter((store) => {
    if (filter === 'activas') return store.status === 'active'
    if (filter === 'suspendidas') return store.status === 'suspended'
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tiendas</h1>
        <Button asChild>
          <Link href="/backoffice/tiendas/nueva">Dar de alta una tienda</Link>
        </Button>
      </div>

      {stores.length === 0 ? (
        <EmptyState
          title="Todavía no hay tiendas"
          description="Cada local que aparece acá entra por vos: nombre, slug y el email de su dueño."
          action={
            <Button asChild size="lg">
              <Link href="/backoffice/tiendas/nueva">Dar de alta la primera tienda</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <nav aria-label="Filtrar por estado" className="flex gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={f.value === 'todas' ? '/backoffice/tiendas' : `/backoffice/tiendas?estado=${f.value}`}
                aria-current={filter === f.value ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center border-b-2 px-2 text-sm font-medium transition-colors',
                  filter === f.value
                    ? 'text-foreground border-primary'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          {filtered.length === 0 ? (
            <EmptyState title="Ninguna tienda en este filtro" />
          ) : (
            <Panel elevated={false} className="overflow-hidden p-0">
              <StoreTable stores={filtered} />
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}
