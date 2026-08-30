'use client'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ScheduleSlotGroup } from '@/views/storefront/schedule-lib'

/**
 * El selector de horario del checkout: chips de día (hasta 3-4, snap
 * horizontal) y, para el día activo, una grilla de pastillas de 15 en 15
 * minutos.
 *
 * Es específico de este único consumidor (`checkout-form.tsx`) — no
 * encaja en `CategoryChip` (categorías de carta) ni en `OptionRow` (opciones
 * con precio), así que vive acá y no en `views/shared/surfaces.tsx`. Si
 * mañana otra pantalla necesita elegir un horario de 15 minutos, ahí se
 * justifica extraer.
 *
 * La navegación de día es SOLO estado de UI (qué grupo se mira), no un valor
 * de formulario — por eso son botones con `role="tablist"`, no un segundo
 * radio group. El único valor que viaja al servidor es el horario elegido.
 */
export function SchedulePicker({
  groups,
  timeZone,
  activeNight,
  onActiveNightChange,
  selectedIso,
  onSelect,
  invalid,
}: {
  groups: ScheduleSlotGroup[]
  timeZone: string
  activeNight: string | null
  onActiveNightChange: (night: string) => void
  selectedIso: string | null
  onSelect: (iso: string) => void
  invalid?: boolean
}) {
  if (groups.length === 0) {
    // No hay NINGÚN turno en todo el horizonte: ni un rango abierto dentro de
    // los próximos días, o todos caen antes del lead. Pasa muy poco (un local
    // con horarios cargados rarísimos), pero sin esto la grilla desaparece
    // muda.
    return <p className="text-muted-foreground text-sm">No hay ningún turno disponible en los próximos días.</p>
  }

  const active = groups.find((g) => g.night === activeNight) ?? groups[0]

  return (
    <div className="flex flex-col gap-3">
      {/* Grupo de botones toggle, NO pestañas: elige qué grupo de turnos se
          mira, no cambia de panel de contenido — `aria-pressed`, sin el
          contrato de teclado con flechas que implica `role="tab"`. */}
      <div
        role="group"
        aria-label="Elegí el día"
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      >
        {groups.map((group) => (
          <button
            key={group.night}
            type="button"
            aria-pressed={group.night === active.night}
            onClick={() => onActiveNightChange(group.night)}
            className={cn(
              'flex h-11 shrink-0 snap-start items-center rounded-pill border px-4 text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-fast)',
              group.night === active.night
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/*
       * Un grupo SOLO llega a `groups` si tuvo al menos un slot crudo
       * (`buildScheduleGroups`), así que la única forma de que `slots` quede
       * vacío es que `fullNights` lo haya vaciado: "sin slots" es SIEMPRE
       * "esta noche llegó al tope", nunca un segundo caso distinto — por eso
       * hay un solo mensaje acá, no dos (m5 de la revisión: dos mensajes
       * para una rama que nunca se alcanza es peor que uno solo).
       */}
      {active.slots.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          No quedan turnos esta noche.
        </p>
      ) : (
        <RadioGroup
          value={selectedIso ?? ''}
          onValueChange={onSelect}
          aria-label="Elegí el horario"
          aria-invalid={invalid || undefined}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {active.slots.map((slot) => {
            const iso = slot.toISOString()
            return (
              // Toda la pastilla es el target (44px de alto): el radio real
              // queda oculto y solo cambia de FORMA (`data-state`), que es lo
              // que mueve el borde/fondo de la etiqueta — mismo patrón que el
              // resto del checkout usa para "Cómo lo recibís"/"Cómo pagás".
              <Label
                key={iso}
                className={cn(
                  'border-border has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/8 has-[[data-state=checked]]:text-primary flex h-11 items-center justify-center rounded-(--radius-md) border text-sm font-medium transition-colors duration-(--dur-fast)',
                  'tabular',
                )}
              >
                <RadioGroupItem value={iso} className="sr-only" />
                {formatTime(iso, timeZone)}
              </Label>
            )
          })}
        </RadioGroup>
      )}
    </div>
  )
}
