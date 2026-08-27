import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Vacíos, avisos y cargas.
 *
 * El vacío nunca es una pantalla en blanco con una frase: dice qué pasó, y
 * cuando hay algo que hacer, lo ofrece. Sin ilustración de stock y sin emoji
 * haciendo de ícono.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      {icon ? <div className="text-muted-foreground mb-1" aria-hidden>{icon}</div> : null}
      <p className="display text-lg font-semibold">{title}</p>
      {description ? <p className="text-muted-foreground max-w-[45ch] text-sm">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/**
 * El local cerrado NO esconde la carta: quien elige a las 4 de la tarde dónde
 * va a cenar tiene que poder ver todo y volver. Este aviso solo explica por qué
 * no se puede pedir todavía.
 */
export function ClosedNotice({
  storeName,
  reopensAt,
  className,
}: {
  storeName: string
  reopensAt?: string | null
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'bg-muted text-muted-foreground border-border border-b px-4 py-2.5 text-center text-sm',
        className,
      )}
    >
      <span className="text-foreground font-medium">{storeName}</span> no está tomando pedidos ahora
      {reopensAt ? <> · abre {reopensAt}</> : null}. Podés ver la carta.
    </div>
  )
}

/**
 * Esqueleto de carga.
 *
 * Copia la geometría real de lo que viene —foto cuadrada a la izquierda, dos
 * renglones de texto, precio— en vez de barras genéricas. Un esqueleto que no
 * coincide con el contenido produce un salto de layout, que es peor que no
 * mostrar nada.
 */
export function MenuSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <span className="sr-only" role="status">
        Cargando la carta
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-2" aria-hidden>
          <Skeleton className="size-24 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
