import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/surfaces'

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
 *
 * `schedule` es la única bifurcación de contenido, y se distingue por PROP,
 * nunca por heurística sobre el texto: está presente solo cuando
 * `storefrontGate() === 'closed_by_hours'` (cerrado por horario, la única
 * rama con salida — programar). Los otros tres estados de la precedencia
 * (`suspended`/`no_payment`/`paused`) nunca lo pasan y quedan pixel-idénticos
 * al banner de una línea de siempre: son cierres que decidió el dueño o la
 * plataforma, y ahí no hay "próxima apertura" que prometer.
 */
export function ClosedNotice({
  storeName,
  reopensAt,
  schedule,
  className,
}: {
  storeName: string
  reopensAt?: string | null
  /**
   * Presente SOLO para `closed_by_hours`. `href` en `null` degrada sin CTA:
   * es el caso "sin apertura calculable dentro del horizonte", donde no hay
   * ningún turno que ofrecer todavía.
   */
  schedule?: { message: string; href: string | null }
  className?: string
}) {
  if (schedule) {
    return (
      <div role="status" className={cn('bg-muted border-border border-b px-4 py-3', className)}>
        <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">{storeName}</span> {schedule.message}
          </p>
          {schedule.href ? (
            <Button asChild size="sm" className="h-11 shrink-0 rounded-pill px-5">
              <Link href={schedule.href}>Programar pedido</Link>
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

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
 * Copia la geometría REAL de `ProductCard` (`src/views/storefront/product-card.tsx`)
 * en sus DOS formas, no solo el aire: la cantidad de columnas sale de
 * `--catalog-cols` (la misma variable que arma la grilla real, ver
 * `theme.ts` y el comentario sobre el `sm:` al cuadrado en `catalog-list.tsx`)
 * y cada tarjeta es su propio `@container` que se acuesta a `@min-[14rem]`,
 * exactamente el mismo punto de quiebre que la real (está medido; ver el
 * comentario largo en `product-card.tsx` antes de tocarlo acá o allá). Así el esqueleto queda correcto
 * sin saber la densidad del local — que acá no se puede leer, ver el
 * comentario de `app/[store]/loading.tsx` — porque no depende de density sino
 * del ancho de la celda, igual que la tarjeta real. Un esqueleto que no
 * coincide con el contenido produce un salto de layout, que es peor que no
 * mostrar nada.
 */
export function MenuSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(var(--catalog-cols),minmax(0,1fr))] gap-3 sm:grid-cols-[repeat(calc(var(--catalog-cols)*var(--catalog-cols)),minmax(0,1fr))]',
        className,
      )}
    >
      <span className="sr-only" role="status">
        Cargando la carta
      </span>
      {Array.from({ length: rows }, (_, i) => (
        // El `@container` va en el Panel; las clases `@min-[14rem]:` que deciden
        // fila-vs-columna van en el `<div>` de adentro, nunca en el propio
        // Panel — una consulta de contenedor no puede aplicarse al elemento
        // que la declara. Mismo bug, mismo arreglo que `ProductCard`.
        <Panel key={i} className="@container relative overflow-hidden" elevated aria-hidden>
          <div className="flex flex-col @min-[14rem]:flex-row @min-[14rem]:items-stretch @min-[14rem]:gap-3 @min-[14rem]:p-3">
            {/* `w-[4.5rem] h-[4.5rem]`, no `size-*`: ver el comentario largo
                en `product-card.tsx` sobre por qué la miniatura horizontal NO
                escala con la densidad — con el "+" en el borde de la fila, una
                foto que crece le come la columna de texto al esqueleto igual
                que a la tarjeta real. */}
            <div className="relative @min-[14rem]:h-[4.5rem] @min-[14rem]:w-[4.5rem] @min-[14rem]:shrink-0 @min-[14rem]:self-center">
              <Skeleton className="aspect-square w-full rounded-md @min-[14rem]:rounded-lg" />
              <Skeleton className="rounded-pill absolute top-2 left-2 h-5 w-12" />
              {/* El círculo de sumar sobre la foto es SOLO de la forma
                  vertical — en horizontal se muda al borde derecho de la
                  fila (ver el círculo después de este bloque de texto).
                  Mismo cambio que `ProductCard`, misma razón: no tapar la
                  foto ni el nombre de respaldo. */}
              <Skeleton className="absolute right-2 bottom-2 size-11 rounded-full @min-[14rem]:hidden" />
            </div>
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-col p-3',
                '@min-[14rem]:justify-center @min-[14rem]:p-0',
              )}
            >
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
                {/* Solo la forma horizontal muestra descripción — ver ProductCard. */}
                <Skeleton className="hidden h-3 w-full @min-[14rem]:block" />
              </div>
              <Skeleton className="mt-auto h-4 w-14 @min-[14rem]:mt-1" />
            </div>
            <Skeleton className="hidden size-11 shrink-0 self-center rounded-full @min-[14rem]:block" />
          </div>
        </Panel>
      ))}
    </div>
  )
}
