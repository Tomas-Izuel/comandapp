import { Skeleton } from '@/components/ui/skeleton'
import { Panel } from '@/views/shared/surfaces'

/**
 * Mismo motivo que el panel del local: sin esto, cambiar de Métricas a
 * Tiendas queda en blanco mientras resuelven los `await` del backoffice.
 *
 * La geometría copia la de un panel de filas (métricas, spec list) porque es
 * la forma más común entre las páginas que cuelgan de este layout — no calza
 * pixel a pixel con cada una (la tabla de tiendas es otra forma), pero un
 * esqueleto de filas se acerca más que barras genéricas.
 */
export default function BackofficeLoading() {
  return (
    <div className="flex flex-col gap-6">
      <span role="status" className="sr-only">
        Cargando
      </span>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Panel elevated={false}>
          <div className="divide-border divide-y">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
