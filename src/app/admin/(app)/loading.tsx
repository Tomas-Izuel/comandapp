import { Panel } from '@/views/shared/surfaces'

/**
 * Sin esto la navegación entre secciones del panel queda en blanco hasta que
 * resuelven todos los `await` — en 3G se siente colgado y el encargado toca
 * dos veces. Copia la geometría de una columna de comandas (tres bloques) en
 * vez de una barra genérica: el salto de layout cuando llega el contenido real
 * es mínimo.
 *
 * El padding y el ancho son los mismos que pone `PageFrame` alrededor de toda
 * sección real — si no coincidieran, la navegación saltaría un instante antes
 * de asentarse en el ancho definitivo. `board` es el más ancho de los tres
 * anchos declarados: mejor que el esqueleto ceda de más a que quede más
 * angosto que el contenido real que va a reemplazarlo.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto w-full max-w-(--admin-max-board) px-(--admin-gutter) py-6 lg:px-(--admin-gutter-lg) lg:py-8">
      <span role="status" className="sr-only">
        Cargando
      </span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="bg-muted h-7 w-48 animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Panel className="h-40 animate-pulse" />
          <Panel className="h-40 animate-pulse" />
          <Panel className="h-40 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
