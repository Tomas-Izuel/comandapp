import { Check, ImageOff, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Gramática del producto.
 *
 * La dirección elegida es el estándar de la categoría —la app de pedido de una
 * marca, no un marketplace— ejecutado completo: foto grande, jerarquía obvia,
 * acción primaria siempre visible. La vara son las apps propias de cadena y las
 * webs de pedido que contrata un local.
 *
 * Se ejecuta sin ironía y sin rarezas de contrabando: si una convención de la
 * categoría existe porque funciona (el riel de categorías, la barra de carrito
 * fija, la hoja de producto que sube desde abajo), se usa tal cual. La marca
 * del local vive en el color, la tipografía, el radio y la foto — que es de
 * donde viene la identidad en este mundo, no de inventar una estructura nueva.
 *
 * Todo lo de acá lee tokens (`--radius`, `--primary`, `--shadow-*`), así que
 * cambia solo cuando cambia el kit de marca de la tienda.
 */

/* -------------------------------------------------------------------------
   Superficies
   ------------------------------------------------------------------------- */

/**
 * La superficie en reposo. Profundidad real —desplazamiento y desenfoque— en
 * vez de un borde solo: en la categoría el contenido se lee como algo que se
 * puede levantar de la página.
 *
 * No se anidan. Un panel adentro de otro panel es siempre un error de
 * composición, no una jerarquía.
 */
export function Panel({
  className,
  elevated = true,
  ...props
}: React.ComponentProps<'div'> & { elevated?: boolean }) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-lg border',
        elevated ? 'shadow-raise' : 'shadow-flat',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Encabezado de sección. Más aire arriba que abajo: el espacio es lo que
 * agrupa el título con lo que titula, y separarlo del bloque anterior es lo
 * que hace que una carta larga se pueda barrer con el pulgar.
 *
 * Sin kicker arriba. El título se sostiene solo.
 */
export function SectionHeading({
  as: Tag = 'h2',
  className,
  children,
  action,
  ...props
}: React.ComponentProps<'h2'> & { as?: 'h1' | 'h2' | 'h3'; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pt-8 pb-3">
      <Tag className={cn('display text-foreground text-xl font-semibold sm:text-2xl', className)} {...props}>
        {children}
      </Tag>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Foto
   ------------------------------------------------------------------------- */

/**
 * El marco de toda foto de producto. Relación de aspecto fija para que la
 * carta forme columna aunque las fotos vengan de distintos celulares.
 *
 * El caso sin foto NO es un hueco gris: una bebida sin foto es normal, y el
 * marco lo declara con el nombre puesto en grande sobre el color de la marca.
 * Un placeholder triste en una carta de comida es una venta menos.
 */
export function PhotoFrame({
  ratio = 'square',
  className,
  children,
  fallbackLabel,
}: {
  ratio?: 'square' | 'wide' | 'hero'
  className?: string
  children?: React.ReactNode
  fallbackLabel?: string
}) {
  const aspect = ratio === 'square' ? 'aspect-square' : ratio === 'wide' ? 'aspect-[4/3]' : 'aspect-[16/9]'

  return (
    <div className={cn('bg-muted relative w-full overflow-hidden', aspect, className)}>
      {children ?? <PhotoFallback label={fallbackLabel} />}
    </div>
  )
}

function PhotoFallback({ label }: { label?: string }) {
  if (!label) {
    return (
      <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center">
        <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
      </div>
    )
  }

  return (
    <div className="bg-primary/10 text-primary flex h-full w-full items-center justify-center px-3 text-center">
      <span className="display line-clamp-3 text-sm font-semibold">{label}</span>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Controles
   ------------------------------------------------------------------------- */

/**
 * Selector de cantidad. 44px de lado mínimo: se usa con el pulgar, parado en
 * la calle y con una sola mano.
 *
 * El número se anuncia con `aria-live` porque tocar "+" no mueve el foco: sin
 * eso, con lector de pantalla la cantidad cambia en silencio.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label = 'Cantidad',
  className,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn('border-border bg-card inline-flex items-center rounded-lg border', className)}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Quitar uno"
        className="text-foreground flex size-11 items-center justify-center rounded-l-lg transition-colors duration-(--dur-fast) disabled:opacity-35 enabled:hover:bg-muted"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span aria-live="polite" className="tabular w-9 text-center text-base font-semibold">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Agregar uno"
        className="text-foreground flex size-11 items-center justify-center rounded-r-lg transition-colors duration-(--dur-fast) disabled:opacity-35 enabled:hover:bg-muted"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Barra de acción fija al pie: "Ver carrito", "Agregar $4.200", "Pagar".
 *
 * En esta categoría la acción primaria no se busca scrolleando — vive donde
 * está el pulgar. La barra suma la safe area del iPhone (`.action-bar`) porque
 * sin eso el botón queda debajo de la barra de gestos.
 */
export function ActionBar({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'action-bar bg-card/95 border-border fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-4 backdrop-blur',
        className,
      )}
      {...props}
    >
      <div className="mx-auto w-full max-w-(--content-max)">{children}</div>
    </div>
  )
}

/**
 * Riel de categorías. Se arrastra con el pulgar, engancha, y el chip activo se
 * trae solo al centro cuando la sección entra en pantalla.
 */
export function CategoryRail({ className, children, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      aria-label="Categorías de la carta"
      className={cn('bg-background/95 border-border border-b backdrop-blur', className)}
      {...props}
    >
      <div className="rail mx-auto flex max-w-(--content-max) gap-2 px-4 py-3">{children}</div>
    </nav>
  )
}

export function CategoryChip({
  active,
  className,
  ...props
}: React.ComponentProps<'a'> & { active?: boolean }) {
  return (
    <a
      aria-current={active ? 'true' : undefined}
      className={cn(
        'shrink-0 scroll-ml-4 snap-start whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-(--dur-fast)',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Fila de opción de un producto (punto de cocción, extras, sin ingredientes).
 *
 * Toda la fila es el target, no solo el círculo: en un celular apuntarle a un
 * radio de 16px con el pulgar falla. El control real lo pone el consumidor
 * (`RadioGroupItem` o `Checkbox`) en el slot `control`, así que la semántica de
 * grupo y el teclado siguen siendo los de Radix.
 */
export function OptionRow({
  control,
  label,
  priceDelta,
  disabled,
  className,
}: {
  control: React.ReactNode
  label: React.ReactNode
  priceDelta?: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-border flex min-h-14 items-center gap-3 border-b px-1 last:border-b-0',
        disabled && 'opacity-45',
        className,
      )}
    >
      {control}
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      {priceDelta ? <span className="tabular text-muted-foreground text-sm">{priceDelta}</span> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Estado
   ------------------------------------------------------------------------- */

type PillTone = 'neutral' | 'live' | 'warning' | 'danger' | 'done'

const PILL_TONE: Record<PillTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  live: 'bg-primary/12 text-primary',
  warning: 'bg-warning/20 text-warning-foreground',
  danger: 'bg-destructive/12 text-destructive',
  done: 'bg-muted text-foreground',
}

/**
 * Estado como texto, no como color. El color acompaña; lo que informa es la
 * palabra y —cuando corresponde— el punto. Un daltónico y alguien mirando la
 * pantalla al sol tienen que leer lo mismo.
 */
export function StatusPill({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: PillTone
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        PILL_TONE[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

/**
 * Paso de un flujo cumplido/actual/pendiente. Tres formas distintas, no tres
 * colores: tilde, punto lleno, círculo hueco.
 */
export function StepMark({ state }: { state: 'done' | 'current' | 'todo' }) {
  if (state === 'done') {
    return (
      <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full">
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span className="border-primary flex size-6 items-center justify-center rounded-full border-2">
        <span className="bg-primary size-2.5 rounded-full" aria-hidden />
      </span>
    )
  }
  return <span className="border-border flex size-6 rounded-full border-2" aria-hidden />
}
