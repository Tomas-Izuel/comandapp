'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Info, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { PanelHeading } from '@/views/admin/page-frame'
import { DayBar, computeWeekAxis, formatAxisHour } from '@/views/admin/ajustes/schedule-track'
import {
  CancelScheduledOrdersDialog,
  type AffectedOrders,
} from '@/views/admin/shared/cancel-scheduled-orders-dialog'
import {
  saveStoreHoursAction,
  saveStoreHoursOverrideAction,
  deleteStoreHoursOverrideAction,
  previewScheduledNightAction,
  closeStoreHoursDateAction,
} from '@/controllers/admin.actions'
import { zonedDayStart } from '@/lib/dates'
import type { StoreHoursRange, StoreHoursOverride, StoreSchedule } from '@/models/types'

/**
 * Editor semanal de horarios + calendario de excepciones (Ajustes).
 *
 * Modo Operate puro: el dueño carga esto UNA vez y no vuelve a pensarlo. Todo
 * el trabajo de traducir "los viernes cerramos tarde" al modelo
 * (`opens_at_minute` + `duration_minutes`, el rango pertenece al día que
 * ABRE) pasa por acá — el dueño nunca ve esos nombres.
 *
 * NOTA DE INTEGRACIÓN (para quien revise T1 ↔ T4): las acciones
 * `saveStoreHoursAction`, `saveStoreHoursOverrideAction`,
 * `deleteStoreHoursOverrideAction` y `previewScheduledNightAction` se
 * consumen tal como las describe `01-tasks.md`. `deleteStoreHoursOverrideAction`
 * no está nombrada ahí (el documento es anterior a que la migración sumara la
 * RPC `delete_store_hours_override`); si T1 la expuso con otro nombre o la
 * plegó dentro de `saveStoreHoursOverrideAction` con un flag `remove`, este
 * archivo es el único lugar que hay que tocar para alinear la firma.
 *
 * `confirmClose` (cerrar una fecha CON programados adentro) llama
 * `closeStoreHoursDateAction`, no `pauseScheduledNightAction` +
 * `saveStoreHoursOverrideAction` por separado como en una versión anterior:
 * el arreglo de m4 (`03-review.md`) movió la orquestación —guardar el cierre
 * primero, cancelar después— a una sola acción del lado del servidor.
 */

// ---------------------------------------------------------------------------
// Utilidades de horario en el vocabulario del formulario: "HH:MM" de 24 horas,
// nunca minutos crudos — esos solo existen en el borde con el servidor.
// ---------------------------------------------------------------------------

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export type DraftRange = { id: string; opensAt: string; closesAt: string }

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Math.random().toString(36).slice(2)}`
}

function draftRangeFromModel(range: Pick<StoreHoursRange, 'opensAtMinute' | 'durationMinutes'>): DraftRange {
  const closeMinute = (range.opensAtMinute + range.durationMinutes) % 1440
  return { id: randomId(), opensAt: minutesToTime(range.opensAtMinute), closesAt: minutesToTime(closeMinute) }
}

/** `null` si el par de horas no forma un rango válido (campo vacío, formato incompleto). */
function draftRangeToDuration(range: DraftRange): { opensAtMinute: number; durationMinutes: number } | null {
  const opens = timeToMinutes(range.opensAt)
  const closes = timeToMinutes(range.closesAt)
  if (opens === null || closes === null) return null
  // Cierre <= apertura ⇒ cruza la medianoche (o son las 24hs exactas si son iguales).
  const duration = closes <= opens ? 1440 - opens + closes : closes - opens
  if (duration < 15) return null
  return { opensAtMinute: opens, durationMinutes: duration }
}

/** El indicador inline "cruza la medianoche": cierre numéricamente antes o igual que la apertura. */
function crossesMidnight(range: DraftRange): boolean {
  const opens = timeToMinutes(range.opensAt)
  const closes = timeToMinutes(range.closesAt)
  if (opens === null || closes === null) return false
  return closes <= opens
}

/**
 * Solapamiento en la línea circular de la semana — el mismo cálculo que hace
 * `set_store_hours` en Postgres (±10080 minutos), para que el formulario
 * pueda avisar ANTES de que la base lo rechace. No reemplaza esa validación
 * (la base es la autoridad última): solo la adelanta con un mensaje legible.
 */
function findWeekOverlap(
  ranges: { dayOfWeek: number; opensAtMinute: number; durationMinutes: number; label: string }[],
): string | null {
  const withSpan = ranges.map((r) => ({
    ...r,
    start: r.dayOfWeek * 1440 + r.opensAtMinute,
    end: r.dayOfWeek * 1440 + r.opensAtMinute + r.durationMinutes,
  }))
  for (let i = 0; i < withSpan.length; i++) {
    for (let j = i + 1; j < withSpan.length; j++) {
      const a = withSpan[i]
      const b = withSpan[j]
      for (const offset of [0, 10080, -10080]) {
        if (a.start < b.end + offset && b.start + offset < a.end) {
          return a.label === b.label
            ? `Hay dos rangos de ${a.label} que se superponen.`
            : `Los rangos de ${a.label} y ${b.label} se superponen.`
        }
      }
    }
  }
  return null
}

const DAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
}
/** La UI arranca la semana en lunes; el dato interno sigue siendo 0=domingo (`Date#getDay`). Es presentación, no modelo. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const MAX_RANGES_PER_DAY = 4

/**
 * El explicador de Q1: se recalcula en vivo contra el cierre MÁS TARDÍO de
 * toda la semana en curso (no uno por fila — combinatoria innecesaria) y el
 * prep más alto real de la carta. Texto genérico no cumple el criterio; por
 * eso reproduce acá la aritmética exacta del ejemplo de producto en vez de
 * mostrar un número cualquiera.
 *
 * BUG CORREGIDO (review M3): "más tardío" tiene que compararse en el orden en
 * que el DUEÑO ve la semana (lunes→domingo), no en el `dayOfWeek` crudo del
 * modelo (`Date#getDay()`, 0=domingo). Con el peso crudo, un local abierto
 * solo sábado 18:00–02:00 y domingo 10:00–22:00 elegía sábado como "el que
 * cierra más tarde" (`6·1440+1080+480=10200` > `0·1440+600+720=1320`) aunque
 * el cierre real más tardío de esa semana sea domingo 22:00 — domingo, al
 * valer 0, se leía como "el día más temprano" en la cuenta lineal. Se
 * remapea `dayOfWeek` a un índice lunes-primero (`(dayOfWeek + 6) % 7`, que
 * manda domingo al final, posición 6) SOLO para decidir cuál cierra más
 * tarde; el `dayOfWeek` real (el que se guarda) no se toca.
 */
function computeLastOrderWarning(
  weekly: { dayOfWeek: number; opensAtMinute: number; durationMinutes: number }[],
  maxPrepMinutes: number,
): { lastOrderLabel: string; exampleOrderLabel: string; fireLabel: string } | null {
  if (weekly.length === 0) return null
  let latestClose = -Infinity
  let latestCloseMinuteOfDay = 0
  for (const r of weekly) {
    const mondayFirstDay = (r.dayOfWeek + 6) % 7 // domingo (0) pasa a valer 6: el último día de la semana que el dueño mira
    const close = mondayFirstDay * 1440 + r.opensAtMinute + r.durationMinutes // lineal, sin módulo: así el cruce de medianoche cae después en la semana
    if (close > latestClose) {
      latestClose = close
      latestCloseMinuteOfDay = ((r.opensAtMinute + r.durationMinutes) % 1440 + 1440) % 1440
    }
  }
  const closeMinuteOfDay = latestCloseMinuteOfDay
  const exampleOrderMinute = (closeMinuteOfDay - 1 + 1440) % 1440
  const fireMinute = exampleOrderMinute + maxPrepMinutes
  return {
    lastOrderLabel: minutesToTime(closeMinuteOfDay),
    exampleOrderLabel: minutesToTime(exampleOrderMinute),
    fireLabel: minutesToTime(fireMinute),
  }
}

// ---------------------------------------------------------------------------
// Fila de rango: dos <input type="time" step="900"> + borrar. Se repite en la
// semana y en las excepciones — mismo componente, sin duplicar el patrón.
// ---------------------------------------------------------------------------

function RangeRow({
  range,
  onChange,
  onRemove,
  removeLabel,
}: {
  range: DraftRange
  onChange: (patch: Partial<DraftRange>) => void
  onRemove: () => void
  removeLabel: string
}) {
  const opensId = useId()
  const closesId = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={opensId} className="sr-only">
          Hora de apertura
        </Label>
        <Input
          id={opensId}
          type="time"
          step={900}
          value={range.opensAt}
          onChange={(e) => onChange({ opensAt: e.target.value })}
          className="h-11 w-[7.5rem]"
        />
        <span className="text-muted-foreground text-sm" aria-hidden>
          a
        </span>
        <Label htmlFor={closesId} className="sr-only">
          Hora de cierre
        </Label>
        <Input
          id={closesId}
          type="time"
          step={900}
          value={range.closesAt}
          onChange={(e) => onChange({ closesAt: e.target.value })}
          className="h-11 w-[7.5rem]"
        />
        <Button type="button" variant="ghost" size="icon" aria-label={removeLabel} onClick={onRemove}>
          <Trash2 className="text-destructive size-4" aria-hidden />
        </Button>
      </div>
      {crossesMidnight(range) ? (
        <p className="text-muted-foreground pl-0.5 text-xs">Cruza la medianoche</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Semana
// ---------------------------------------------------------------------------

function buildInitialWeek(weekly: StoreHoursRange[]): Record<number, DraftRange[]> {
  const week: Record<number, DraftRange[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const range of weekly) {
    week[range.dayOfWeek] = [...(week[range.dayOfWeek] ?? []), draftRangeFromModel(range)]
  }
  return week
}

/**
 * Texto de la fila en reposo. Crudo del draft (`opensAt`/`closesAt`), no
 * minutos parseados: el `<input type="time">` ya garantiza HH:MM o vacío, así
 * que no hace falta pasar por `draftRangeToDuration` para mostrar algo legible
 * incluso con un rango a medio cargar.
 */
function formatDaySummary(ranges: DraftRange[]): string {
  if (ranges.length === 0) return 'Cerrado'
  return ranges.map((r) => `${r.opensAt || '--:--'} a ${r.closesAt || '--:--'}`).join(', ')
}

/**
 * "Copiar a…": la carga inicial es la única vez que esta pantalla se usa en
 * serio (brief de superficie); sin esto son siete días a mano. Copia
 * REEMPLAZA los rangos del destino, no los mezcla — mismo criterio que
 * "Agregar excepción" reemplaza en vez de acumular. Queda abierto después de
 * cada click a propósito: replicar un horario a los siete días no debería
 * obligar a reabrir el menú siete veces.
 */
function CopyToControl({ sourceDay, onCopy }: { sourceDay: number; onCopy: (targetDay: number) => void }) {
  const [open, setOpen] = useState(false)
  const targets = DAY_ORDER.filter((day) => day !== sourceDay)
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-fit gap-1.5"
      >
        <Copy className="size-3.5" aria-hidden />
        Copiar a…
      </Button>
      {open ? (
        <div role="group" aria-label={`Copiar el horario de ${DAY_LABELS[sourceDay]} a`} className="flex flex-wrap gap-1.5">
          {targets.map((day) => (
            <Button key={day} type="button" variant="secondary" onClick={() => onCopy(day)} className="px-3 text-xs">
              {DAY_LABELS[day]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WeekEditor({
  storeId,
  initialWeekly,
  maxPrepMinutes,
}: {
  storeId: number
  initialWeekly: StoreHoursRange[]
  maxPrepMinutes: number
}) {
  const router = useRouter()
  const [week, setWeek] = useState(() => buildInitialWeek(initialWeekly))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Un solo día editable a la vez: abrir otro cierra el anterior solo, porque
  // los dos leen y escriben la misma variable.
  const [openDay, setOpenDay] = useState<number | null>(null)
  // Acotado a la lista de rangos (sin la cabecera con "Listo"): así el foco de
  // apertura aterriza en el primer campo editable, nunca en ese botón (03-review.md, #2).
  const rangesContainerRef = useRef<HTMLDivElement | null>(null)
  // Un botón de `DayBar` por día, para devolver el foco a la fila que abrió el
  // panel en vez de dejarlo huérfano en `<body>` al cerrarlo con "Listo".
  const dayTriggerRefs = useRef(new Map<number, HTMLButtonElement>())
  const previousOpenDayRef = useRef<number | null>(null)

  const isEmpty = DAY_ORDER.every((day) => (week[day] ?? []).length === 0)

  // El eje de la pista: se recalcula en cada tecla porque es la MISMA fuente
  // que ya recalcula el explicador de abajo. Un rango a medio completar
  // (`draftRangeToDuration` → null) se ignora acá, no rompe el eje de los
  // demás.
  const axis = useMemo(() => {
    const flat: { opensAtMinute: number; durationMinutes: number }[] = []
    for (const day of DAY_ORDER) {
      for (const range of week[day] ?? []) {
        const parsed = draftRangeToDuration(range)
        if (parsed) flat.push(parsed)
      }
    }
    return computeWeekAxis(flat)
  }, [week])

  const warning = useMemo(() => {
    const flat: { dayOfWeek: number; opensAtMinute: number; durationMinutes: number }[] = []
    for (const day of DAY_ORDER) {
      for (const range of week[day] ?? []) {
        const parsed = draftRangeToDuration(range)
        if (parsed) flat.push({ dayOfWeek: day, ...parsed })
      }
    }
    return computeLastOrderWarning(flat, maxPrepMinutes)
  }, [week, maxPrepMinutes])

  // Foco al abrir/cerrar un día: sin esto, tocar la fila con teclado/lector de
  // pantalla deja el foco huérfano en un botón que la edición reemplazó (o,
  // antes de este arreglo, aterrizaba en "Listo" — que va ANTES en el DOM que
  // los `<input type="time">` — así que un Enter de más cerraba el panel que
  // el usuario recién había abierto, creyendo estar parado en un campo).
  useEffect(() => {
    if (openDay !== null) {
      const firstField = rangesContainerRef.current?.querySelector<HTMLElement>('input[type="time"], button')
      firstField?.focus()
    } else if (previousOpenDayRef.current !== null) {
      // Se cerró: el foco vuelve al disparador del día, no a <body>.
      dayTriggerRefs.current.get(previousOpenDayRef.current)?.focus()
    }
    previousOpenDayRef.current = openDay
  }, [openDay])

  function addRange(day: number) {
    setWeek((prev) => {
      const current = prev[day] ?? []
      if (current.length >= MAX_RANGES_PER_DAY) return prev
      return { ...prev, [day]: [...current, { id: randomId(), opensAt: '18:00', closesAt: '23:00' }] }
    })
  }
  function updateRange(day: number, id: string, patch: Partial<DraftRange>) {
    setWeek((prev) => ({ ...prev, [day]: (prev[day] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  }
  function removeRange(day: number, id: string) {
    setWeek((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((r) => r.id !== id) }))
  }
  function copyRangesTo(sourceDay: number, targetDay: number) {
    setWeek((prev) => ({ ...prev, [targetDay]: (prev[sourceDay] ?? []).map((r) => ({ ...r, id: randomId() })) }))
    toast.success(`Copiado a ${DAY_LABELS[targetDay]}`)
  }

  function handleSave() {
    setError(null)
    const flat: { dayOfWeek: number; opensAtMinute: number; durationMinutes: number; label: string }[] = []
    for (const day of DAY_ORDER) {
      for (const range of week[day] ?? []) {
        const parsed = draftRangeToDuration(range)
        if (!parsed) {
          setError(`Completá los dos horarios de ${DAY_LABELS[day]}, o borrá el rango.`)
          return
        }
        flat.push({ dayOfWeek: day, ...parsed, label: DAY_LABELS[day] })
      }
    }
    const overlap = findWeekOverlap(flat)
    if (overlap) {
      setError(overlap)
      return
    }
    startTransition(async () => {
      const result = await saveStoreHoursAction(
        storeId,
        flat.map(({ dayOfWeek, opensAtMinute, durationMinutes }) => ({ dayOfWeek, opensAtMinute, durationMinutes })),
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Horario guardado')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelHeading
        title="Horario semanal"
        description="Cuándo tomás pedidos por defecto. Un rango que cruza la medianoche (ej. viernes 18:00 a 02:00) se carga tal cual, como una fila del viernes."
      />

      {isEmpty ? (
        <div className="bg-muted text-muted-foreground flex items-start gap-2.5 rounded-lg p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Sin horarios cargados, tu local está siempre abierto. Agregá un rango si querés empezar a acotarlo.</p>
        </div>
      ) : null}

      {axis ? (
        <p className="text-muted-foreground text-xs">
          Franja mostrada: <span className="tabular">{formatAxisHour(axis.start)}</span> a{' '}
          <span className="tabular">{formatAxisHour(axis.end)}</span>.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {DAY_ORDER.map((day) => {
          const ranges = week[day] ?? []

          if (day !== openDay) {
            const parsedRanges: { opensAtMinute: number; durationMinutes: number }[] = []
            for (const range of ranges) {
              const parsed = draftRangeToDuration(range)
              if (parsed) parsedRanges.push(parsed)
            }
            return (
              <DayBar
                key={day}
                ref={(el) => {
                  if (el) dayTriggerRefs.current.set(day, el)
                  else dayTriggerRefs.current.delete(day)
                }}
                label={DAY_LABELS[day]}
                summary={formatDaySummary(ranges)}
                ranges={parsedRanges}
                axis={axis}
                onOpen={() => setOpenDay(day)}
              />
            )
          }

          return (
            <div key={day} className="border-border bg-card rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{DAY_LABELS[day]}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpenDay(null)}>
                  Listo
                </Button>
              </div>
              <div ref={rangesContainerRef} className="flex flex-col gap-2">
                {ranges.map((range) => (
                  <RangeRow
                    key={range.id}
                    range={range}
                    onChange={(patch) => updateRange(day, range.id, patch)}
                    onRemove={() => removeRange(day, range.id)}
                    removeLabel={`Borrar este rango de ${DAY_LABELS[day]}`}
                  />
                ))}
                <div className="flex flex-col items-start gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ranges.length >= MAX_RANGES_PER_DAY}
                    onClick={() => addRange(day)}
                    className="w-fit gap-1.5"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Agregar rango
                  </Button>
                  <CopyToControl sourceDay={day} onCopy={(targetDay) => copyRangesTo(day, targetDay)} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {warning ? (
        <p className="bg-muted rounded-lg px-3 py-2.5 text-sm leading-relaxed">
          Se aceptan pedidos hasta las <span className="tabular font-medium">{warning.lastOrderLabel}</span>. Tu
          producto más lento tarda <span className="tabular font-medium">{maxPrepMinutes} min</span>, así que un
          pedido de las <span className="tabular font-medium">{warning.exampleOrderLabel}</span> sale a las{' '}
          <span className="tabular font-medium">{warning.fireLabel}</span>.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={handleSave} disabled={pending} className="w-fit gap-2">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Guardar horario semanal
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Excepciones por fecha
// ---------------------------------------------------------------------------

type OverrideDraft = {
  key: string
  date: string
  isClosed: boolean
  ranges: DraftRange[]
  /** `true` mientras es un borrador sin guardar todavía (no existe en el servidor). */
  isNew: boolean
}

function overrideFromModel(override: StoreHoursOverride): OverrideDraft {
  return {
    key: override.date,
    date: override.date,
    isClosed: override.isClosed,
    ranges: override.ranges.map(draftRangeFromModel),
    isNew: false,
  }
}

function OverrideRow({
  storeId,
  timezone,
  currency,
  draft,
  isOpen,
  onToggle,
  onSaved,
  onRemoved,
  onDiscard,
}: {
  storeId: number
  timezone: string
  currency: string
  draft: OverrideDraft
  /** Ignorado si `draft.isNew`: una excepción recién creada siempre se ve entera, no hay nada que resumir todavía. */
  isOpen: boolean
  onToggle: () => void
  onSaved: (saved: OverrideDraft) => void
  onRemoved: () => void
  onDiscard: () => void
}) {
  const router = useRouter()
  const [date, setDate] = useState(draft.date)
  const [isClosed, setIsClosed] = useState(draft.isClosed)
  const [ranges, setRanges] = useState(draft.ranges)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Mismo tratamiento de foco que `WeekEditor` (03-review.md, hallazgo #3):
  // esta fila copió el patrón de reposo/apertura pero no el de foco, así que
  // expandir con teclado dejaba el foco huérfano en `<body>`.
  const formContainerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(isOpen)

  useEffect(() => {
    if (draft.isNew) return // siempre se ve entera: no hay transición reposo↔abierto que atender
    if (isOpen && !wasOpenRef.current) {
      // Se acaba de expandir: al primer campo real, no a "Listo"/"Quitar
      // excepción" que van antes en el DOM.
      const firstField = formContainerRef.current?.querySelector<HTMLElement>(
        'input[type="date"], input[type="checkbox"], input[type="time"]',
      )
      firstField?.focus()
    } else if (!isOpen && wasOpenRef.current) {
      // Se acaba de colapsar: el foco vuelve a la fila que la abrió.
      triggerRef.current?.focus()
    }
    wasOpenRef.current = isOpen
  }, [isOpen, draft.isNew])

  // Diálogo destructivo: solo se dispara al CERRAR una fecha, nunca al
  // ajustar rangos o al quitar la excepción (fuera de alcance a propósito —
  // esos casos la UI solo advierte, ver la nota debajo del botón "Quitar").
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [closeLoading, setCloseLoading] = useState(false)
  const [closeAffected, setCloseAffected] = useState<AffectedOrders | null>(null)

  const dateId = useId()
  const closedId = useId()

  function addRange() {
    setRanges((prev) => (prev.length >= MAX_RANGES_PER_DAY ? prev : [...prev, { id: randomId(), opensAt: '18:00', closesAt: '23:00' }]))
  }
  function updateRange(id: string, patch: Partial<DraftRange>) {
    setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRange(id: string) {
    setRanges((prev) => prev.filter((r) => r.id !== id))
  }

  function persistOpen() {
    if (!date) {
      setError('Elegí una fecha.')
      return
    }
    if (ranges.length === 0) {
      setError('Una fecha abierta necesita al menos un rango, o marcá "Cerrado todo el día".')
      return
    }
    const parsedRanges: { opensAtMinute: number; durationMinutes: number }[] = []
    for (const range of ranges) {
      const parsed = draftRangeToDuration(range)
      if (!parsed) {
        setError('Completá los dos horarios de cada rango, o borralo.')
        return
      }
      parsedRanges.push(parsed)
    }
    // Solapamiento dentro de la misma fecha: mismo chequeo que la semana, sin
    // el módulo circular (acá no hay "día siguiente" con el que comparar).
    for (let i = 0; i < parsedRanges.length; i++) {
      for (let j = i + 1; j < parsedRanges.length; j++) {
        const a = parsedRanges[i]
        const b = parsedRanges[j]
        if (a.opensAtMinute < b.opensAtMinute + b.durationMinutes && b.opensAtMinute < a.opensAtMinute + a.durationMinutes) {
          setError('Hay rangos de esta excepción que se superponen.')
          return
        }
      }
    }
    setError(null)
    setSaving(true)
    void (async () => {
      const result = await saveStoreHoursOverrideAction(storeId, { date, isClosed: false, ranges: parsedRanges })
      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Excepción guardada')
      onSaved({ key: date, date, isClosed: false, ranges, isNew: false })
      router.refresh()
    })()
  }

  function startClose() {
    if (!date) {
      setError('Elegí una fecha.')
      return
    }
    setError(null)
    setCloseDialogOpen(true)
    setCloseLoading(true)
    setCloseAffected(null)
    void (async () => {
      const result = await previewScheduledNightAction(storeId, date)
      setCloseLoading(false)
      if (!result.ok) {
        toast.error('No pudimos calcular el impacto', { description: result.error })
        setCloseDialogOpen(false)
        return
      }
      setCloseAffected(result.data)
    })()
  }

  async function confirmClose(): Promise<{ ok: boolean; error?: string }> {
    // Una sola acción que guarda el cierre y RECIÉN DESPUÉS cancela los
    // programados (m4 de 03-review.md): el orden viejo —cancelar primero,
    // guardar el cierre después— podía dejar pedidos ya cancelados con la
    // fecha todavía "abierta" si el segundo paso fallaba. Se llama siempre,
    // aunque `closeAffected?.count` sea 0: la cancelación es una query barata
    // que no encuentra nada que tocar en ese caso.
    const result = await closeStoreHoursDateAction(storeId, date)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  }

  function handleRemove() {
    setRemoving(true)
    setError(null)
    void (async () => {
      const result = await deleteStoreHoursOverrideAction(storeId, date)
      setRemoving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Volvió al horario habitual')
      onRemoved()
      router.refresh()
    })()
  }

  const dateLabel = date
    ? new Intl.DateTimeFormat('es-AR', { timeZone: timezone, day: 'numeric', month: 'long' }).format(zonedDayStart(date, timezone))
    : ''
  const statusText = isClosed ? 'Cerrado todo el día' : formatDaySummary(ranges)

  // Reposo compactado a una línea (brief de superficie): una excepción ya
  // guardada se abre al tocarla, igual que un día de la semana. Una recién
  // creada (`isNew`) no tiene nada que resumir todavía, así que se ve entera
  // sin importar `isOpen`.
  if (!draft.isNew && !isOpen) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label={`${dateLabel}, ${statusText}`}
        className="border-border bg-card hover:bg-muted focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-sm font-semibold">{dateLabel}</span>
        <span className="tabular text-sm text-muted-foreground">{statusText}</span>
      </button>
    )
  }

  return (
    <div ref={formContainerRef} className="border-border rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={dateId} className="sr-only">
            Fecha de la excepción
          </Label>
          <Input
            id={dateId}
            type="date"
            value={date}
            disabled={!draft.isNew}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-[10.5rem]"
          />
        </div>
        <label htmlFor={closedId} className="flex h-11 min-h-11 items-center gap-2">
          <Checkbox id={closedId} checked={isClosed} onCheckedChange={(v) => setIsClosed(v === true)} />
          <span className="text-sm">Cerrado todo el día</span>
        </label>
        {!draft.isNew ? (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
              Listo
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={handleRemove} className="gap-1.5">
              {removing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Quitar excepción
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} className="ml-auto">
            Cancelar
          </Button>
        )}
      </div>

      {!draft.isNew ? (
        <p className="text-muted-foreground mt-1 text-xs">
          Quitarla vuelve al horario habitual de ese día. Si había pedidos programados dentro de este rango, no se
          cancelan solos: revisalos en la bandeja de Programados.
        </p>
      ) : null}

      {!isClosed ? (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          {ranges.map((range) => (
            <RangeRow
              key={range.id}
              range={range}
              onChange={(patch) => updateRange(range.id, patch)}
              onRemove={() => removeRange(range.id)}
              removeLabel="Borrar este rango de la excepción"
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ranges.length >= MAX_RANGES_PER_DAY}
            onClick={addRange}
            className="w-fit gap-1.5"
          >
            <Plus className="size-3.5" aria-hidden />
            Agregar rango
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}

      <div className="mt-3">
        <Button type="button" size="sm" disabled={saving} onClick={() => (isClosed ? startClose() : persistOpen())} className="gap-1.5">
          {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Guardar excepción
        </Button>
      </div>

      <CancelScheduledOrdersDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        loading={closeLoading}
        affected={closeAffected}
        currency={currency}
        subject={dateLabel ? `el ${dateLabel}` : 'esta fecha'}
        destructiveLabel="Cerrar y cancelar"
        safeLabel="Cerrar el día"
        onConfirm={confirmClose}
        onConfirmed={() => {
          toast.success('Fecha cerrada')
          onSaved({ key: date, date, isClosed: true, ranges: [], isNew: false })
          router.refresh()
        }}
      />
    </div>
  )
}

function OverridesEditor({
  storeId,
  timezone,
  currency,
  initialOverrides,
}: {
  storeId: number
  timezone: string
  currency: string
  initialOverrides: StoreHoursOverride[]
}) {
  const [overrides, setOverrides] = useState<OverrideDraft[]>(() =>
    [...initialOverrides].sort((a, b) => a.date.localeCompare(b.date)).map(overrideFromModel),
  )
  const [draftKey, setDraftKey] = useState<string | null>(null)
  // Igual que la semana: una excepción abierta a la vez.
  const [openKey, setOpenKey] = useState<string | null>(null)

  function addDraft() {
    if (draftKey) return // un borrador a la vez alcanza
    const key = `new-${randomId()}`
    setDraftKey(key)
    setOverrides((prev) => [
      ...prev,
      { key, date: '', isClosed: false, ranges: [{ id: randomId(), opensAt: '18:00', closesAt: '23:00' }], isNew: true },
    ])
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelHeading
        title="Excepciones por fecha"
        description="Cerrá un feriado, o abrí un día que el horario habitual dice cerrado."
        action={
          <Button type="button" variant="outline" size="sm" onClick={addDraft} disabled={draftKey !== null} className="gap-1.5">
            <Plus className="size-3.5" aria-hidden />
            Agregar excepción
          </Button>
        }
      />

      {overrides.length === 0 ? (
        <p className="text-muted-foreground text-sm">Sin excepciones cargadas todavía.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {overrides.map((draft) => (
            <OverrideRow
              key={draft.key}
              storeId={storeId}
              timezone={timezone}
              currency={currency}
              draft={draft}
              isOpen={openKey === draft.key}
              onToggle={() => setOpenKey((prev) => (prev === draft.key ? null : draft.key))}
              onSaved={(saved) => {
                setOverrides((prev) => {
                  const withoutDraft = prev.filter((o) => o.key !== draft.key)
                  return [...withoutDraft, { ...saved, key: saved.date }].sort((a, b) => a.date.localeCompare(b.date))
                })
                if (draft.isNew) setDraftKey(null)
                // Vuelve al reposo: ni la carga inicial ni un ajuste puntual justifican dejarla abierta después de guardar.
                setOpenKey(null)
              }}
              onRemoved={() => setOverrides((prev) => prev.filter((o) => o.key !== draft.key))}
              onDiscard={() => {
                setOverrides((prev) => prev.filter((o) => o.key !== draft.key))
                setDraftKey(null)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function ScheduleEditor({
  storeId,
  timezone,
  currency,
  schedule,
  maxPrepMinutes,
}: {
  storeId: number
  timezone: string
  currency: string
  schedule: StoreSchedule
  maxPrepMinutes: number
}) {
  return (
    <div className="flex flex-col gap-10">
      <WeekEditor storeId={storeId} initialWeekly={schedule.weekly} maxPrepMinutes={maxPrepMinutes} />
      <OverridesEditor storeId={storeId} timezone={timezone} currency={currency} initialOverrides={schedule.overrides} />
    </div>
  )
}
