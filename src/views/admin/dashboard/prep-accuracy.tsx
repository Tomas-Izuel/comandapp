import { StatRow } from './stat-summary'
import type { StoreDashboard } from '@/models/types'

/**
 * El dato más valioso del panel: si la cocina tarda más o menos de lo que el
 * catálogo promete. Se lee como spec —misma familia y peso que el resumen de
 * arriba de la página, dos valores en la misma fila— nunca como una
 * métrica-héroe con un número gigante y una etiqueta chica encima.
 */
export function PrepAccuracy({ prepAccuracy }: { prepAccuracy: StoreDashboard['prepAccuracy'] }) {
  const { avgRealMinutes, avgEstimatedMinutes, sampleSize } = prepAccuracy

  if (sampleSize === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Todavía no hay pedidos completos (confirmado → listo) en este rango para comparar.
      </p>
    )
  }

  const delta = avgRealMinutes - avgEstimatedMinutes

  return (
    <div className="flex flex-col gap-3">
      <StatRow
        columns={2}
        items={[
          { label: 'Estimado', value: `${avgEstimatedMinutes} min` },
          { label: 'Real', value: `${avgRealMinutes} min` },
        ]}
      />
      <p className="max-w-[60ch] text-sm lg:text-base">
        {delta === 0 ? (
          'La cocina cumple el estimado al pie de la letra.'
        ) : delta > 0 ? (
          <>
            Tarda en promedio <span className="font-medium">{delta} min más</span> de lo que promete el catálogo.
            Convendría subir el tiempo de preparación de los productos más pedidos.
          </>
        ) : (
          <>
            Termina en promedio <span className="font-medium">{Math.abs(delta)} min antes</span> de lo estimado. Hay
            margen para bajar el tiempo de preparación declarado.
          </>
        )}
      </p>
      <p className="text-muted-foreground text-xs lg:text-sm">Basado en {sampleSize} pedidos</p>
    </div>
  )
}
