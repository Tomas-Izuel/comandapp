'use client'

import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * Slider de Radix con los tokens del producto.
 *
 * El pulgar mide 44px de área tocable aunque se dibuje más chico: el
 * `::after` extiende el target sin engordar el control, que es el mismo
 * recurso que usa `Checkbox`. Sin eso, arrastrar el redondeo de esquinas con
 * el pulgar en un celular es una lotería.
 *
 * `aria-valuetext` NO se pone acá: lo pone quien lo usa, porque el valor
 * crudo casi nunca es lo que hay que anunciar ("Suave", no "0.65").
 */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbCount = Array.isArray(props.value ?? props.defaultValue)
    ? ((props.value ?? props.defaultValue) as number[]).length
    : 1

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none items-center select-none data-disabled:opacity-50',
        // Alto de 44px en el ROOT, no en el track: el área que responde al
        // arrastre es toda la fila, no una línea de 6px.
        'h-11',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-pill"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          data-slot="slider-thumb"
          className={cn(
            'border-primary bg-background relative block size-5 shrink-0 rounded-full border-2 shadow-raise',
            'transition-[box-shadow,transform] duration-(--dur-fast)',
            'hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            'disabled:pointer-events-none',
            // Target real de 44px sin agrandar el círculo dibujado.
            'after:absolute after:-inset-3 after:content-[""]',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
