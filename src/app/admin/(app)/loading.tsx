import { Panel } from '@/views/shared/surfaces'

/**
 * Sin esto la navegación entre secciones del panel queda en blanco hasta que
 * resuelven todos los `await` — en 3G se siente colgado y el encargado toca
 * dos veces. Copia la geometría de una columna de comandas (tres bloques) en
 * vez de una barra genérica: el salto de layout cuando llega el contenido real
 * es mínimo.
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <span role="status" className="sr-only">
        Cargando
      </span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="bg-muted h-6 w-40 animate-pulse rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Panel className="h-40 animate-pulse" />
          <Panel className="h-40 animate-pulse" />
          <Panel className="h-40 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
