import { Check, ImageOff, Minus, Plus, Search, X } from 'lucide-react'
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
  fallbackAlign = 'center',
}: {
  ratio?: 'square' | 'wide' | 'hero'
  className?: string
  children?: React.ReactNode
  fallbackLabel?: string
  /**
   * `'end'` ancla el nombre de respaldo abajo del marco en vez de centrarlo.
   * Existe para el hueco donde un control flota arriba del marco (el "volver"
   * de la ficha de producto): centrado, un nombre largo podía crecer hasta esa
   * esquina y quedar tapado. Abajo, no hay control que lo tape nunca, sea cual
   * sea el largo del nombre o el tamaño de pantalla.
   */
  fallbackAlign?: 'center' | 'end'
}) {
  const aspect = ratio === 'square' ? 'aspect-square' : ratio === 'wide' ? 'aspect-[4/3]' : 'aspect-[16/9]'

  return (
    <div className={cn('bg-muted relative w-full overflow-hidden', aspect, className)}>
      {children ?? <PhotoFallback label={fallbackLabel} align={fallbackAlign} />}
    </div>
  )
}

function PhotoFallback({ label, align = 'center' }: { label?: string; align?: 'center' | 'end' }) {
  if (!label) {
    return (
      <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center">
        <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-primary/10 text-primary flex h-full w-full items-center justify-center px-3 text-center',
        align === 'end' && 'items-end pb-5',
      )}
    >
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
    <div className={cn('inline-flex items-center gap-1', className)} role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Quitar uno"
        className={iconButtonClass('surface', 'disabled:opacity-35 disabled:hover:bg-card')}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span aria-live="polite" className="tabular w-9 text-center text-base font-semibold">
        {value}
      </span>
      {/* El "+" es el único relleno de los dos: sumar es la dirección que el
          producto quiere, restar es la corrección. Misma jerarquía que la
          categoría entera usa. */}
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Agregar uno"
        className={iconButtonClass('primary', 'disabled:opacity-35 disabled:hover:bg-primary')}
      >
        <Plus className="size-4" strokeWidth={2.5} aria-hidden />
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
 *
 * El alto total sale de `--rail-h` (globals.css), no de este padding: el
 * scroll-spy resta las dos barras pegajosas para saber cuándo una sección
 * "entró", y ese número tiene que ser el mismo acá y allá.
 */
export function CategoryRail({ className, children, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      aria-label="Categorías de la carta"
      className={cn('bg-background/92 border-border border-b backdrop-blur-md', className)}
      {...props}
    >
      <div className="rail mx-auto flex h-(--rail-h) max-w-(--content-max) items-center gap-2 px-4 sm:px-6">
        {children}
      </div>
    </nav>
  )
}

/**
 * Chip de categoría: pastilla con el ícono de la categoría a la izquierda.
 *
 * El `icon` es un slot y no un emoji por contrato del producto — lo que va
 * adentro es la foto del primer producto de la categoría (identidad real del
 * local) o nada. Un glifo unicode haciendo de ícono está prohibido en todo el
 * sistema, y acá además sería la única imagen no-fotográfica de la carta.
 */
export function CategoryChip({
  active,
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<'a'> & { active?: boolean; icon?: React.ReactNode }) {
  return (
    <a
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex h-12 shrink-0 scroll-ml-4 snap-start items-center gap-2 rounded-pill whitespace-nowrap transition-colors duration-(--dur-fast)',
        icon ? 'pr-4 pl-1.5' : 'px-4',
        active
          ? 'bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground border',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="bg-muted relative block size-9 shrink-0 overflow-hidden rounded-full">{icon}</span>
      ) : null}
      <span className="text-sm font-medium">{children}</span>
    </a>
  )
}

/* -------------------------------------------------------------------------
   Búsqueda
   ------------------------------------------------------------------------- */

/**
 * Campo de búsqueda de la carta. Filtra en el cliente mientras se tipea: la
 * carta entera ya vino en el HTML, así que ir al servidor por cada tecla
 * sería más lento y encima fallaría con mala señal.
 *
 * `type="search"` a propósito: en iOS el teclado trae la tecla "Buscar" y el
 * navegador ofrece limpiar. La X propia igual existe porque en Android no
 * aparece ninguna, y sin ella volver a la carta completa obliga a borrar
 * letra por letra con una mano.
 */
export function SearchField({
  value,
  onValueChange,
  label,
  placeholder,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (next: string) => void
  label: string
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute left-4 size-5 shrink-0"
        strokeWidth={2}
        aria-hidden
      />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'border-border bg-card text-foreground placeholder:text-muted-foreground h-12 w-full rounded-pill border pl-12 text-base',
          // El clear nativo de WebKit se saca: dibujamos el nuestro, y tener
          // los dos deja dos X pisadas en Safari.
          '[&::-webkit-search-cancel-button]:appearance-none',
          value ? 'pr-12' : 'pr-4',
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange('')}
          aria-label="Limpiar la búsqueda"
          className="text-muted-foreground hover:text-foreground absolute right-1 flex size-11 items-center justify-center rounded-full transition-colors duration-(--dur-fast)"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Dock
   ------------------------------------------------------------------------- */

/**
 * Clases de un botón circular de 44px. Es una función y no un componente
 * porque los consumidores necesitan `<a>`, `<Link>` y `<button>` indistintamente
 * —el dock mezcla los tres— y envolver eso en un componente polimórfico cuesta
 * más de lo que ahorra.
 *
 * 44px es el piso de todo lo que se toca con el pulgar en este producto.
 */
export function iconButtonClass(
  tone: 'surface' | 'primary' | 'plain' = 'surface',
  className?: string,
): string {
  return cn(
    'flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-(--dur-fast)',
    tone === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    tone === 'surface' && 'border-border bg-card text-foreground hover:bg-muted border',
    tone === 'plain' && 'text-foreground hover:bg-muted',
    className,
  )
}

/**
 * La barra flotante al pie de la vitrina: el carrito y los canales propios del
 * local (WhatsApp, cómo llegar, Instagram, las apps por las que también vende).
 *
 * Flota en vez de pegarse al borde —y por eso no es `ActionBar`— porque no es
 * la acción de una tarea en curso: está siempre, sobre la carta, y tiene que
 * leerse como una capa por encima del contenido y no como el pie de la página.
 * Quien la use tiene que poner `.dock-clearance` en el contenedor scrolleable,
 * porque un elemento `fixed` no reserva espacio y si no el último producto
 * queda debajo.
 */
export function Dock({ className, children, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      className={cn('dock fixed inset-x-0 z-40 flex justify-center px-4', className)}
      {...props}
    >
      <div className="border-border bg-card/85 shadow-pop flex h-(--dock-h) max-w-full items-center gap-1.5 rounded-pill border px-1.5 backdrop-blur-xl">
        {children}
      </div>
    </nav>
  )
}

/**
 * Fila de opción de un producto (punto de cocción, extras, sin ingredientes).
 *
 * Toda la fila es el target, no solo el control: en un celular apuntarle a un
 * radio de 16px con el pulgar falla. El control real lo pone el consumidor
 * (`RadioGroupItem` o `Checkbox`) en el slot `control`, así que la semántica de
 * grupo y el teclado siguen siendo los de Radix.
 *
 * El control vive en el borde derecho —donde barre el pulgar en una mano— y no
 * en el izquierdo. Eso le saca su lugar de siempre al precio del extra, así que
 * el precio pasa a ser la segunda línea bajo el nombre: sigue leyéndose como
 * plata (tabular, agrupado con lo que cuesta) sin pelear con el control por el
 * mismo borde.
 *
 * `selected` pinta un fondo tenue en la fila entera: es un refuerzo, no la
 * señal — el control (`RadioGroupItem`/`Checkbox`) ya cambia de FORMA al
 * marcarse (se rellena, aparece el tilde), así que quien no distingue el tinte
 * igual ve que la fila cambió.
 */
export function OptionRow({
  control,
  label,
  priceDelta,
  disabled,
  selected,
  className,
}: {
  control: React.ReactNode
  label: React.ReactNode
  priceDelta?: React.ReactNode
  disabled?: boolean
  selected?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-border flex min-h-14 items-center gap-3 border-b px-4 transition-colors duration-(--dur-fast) last:border-b-0',
        selected && 'bg-primary/5',
        disabled && 'opacity-45',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {priceDelta ? <span className="tabular text-muted-foreground text-sm">{priceDelta}</span> : null}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
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
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium',
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
