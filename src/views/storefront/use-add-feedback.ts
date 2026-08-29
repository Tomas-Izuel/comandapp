'use client'

import * as React from 'react'

/**
 * El botón ES el aviso.
 *
 * El toast de "agregado al carrito" sale arriba de todo y el pulgar está
 * abajo: el cliente mira el botón que acaba de tocar, así que el aviso más
 * caro del producto es también el que menos se ve. En vez de mover la
 * notificación, el control que se tocó confirma solo — cambia texto y color
 * por un momento y vuelve.
 *
 * `flash()` se llama DESPUÉS de que la acción ya ocurrió, nunca antes: esto
 * confirma un hecho, no promete uno.
 */
export type AddFeedbackState = 'idle' | 'added'

export function useAddFeedback(resetMs = 1600) {
  const [state, setState] = React.useState<AddFeedbackState>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const flash = React.useCallback(() => {
    setState('added')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), resetMs)
  }, [resetMs])

  return { state, flash, isAdded: state === 'added' }
}
