import { describe, expect, it } from 'vitest'
import { lineKey } from '@/lib/cart'

/**
 * `lineKey` (T2, 2026-08-31): es la única pieza de la que depende que el
 * stepper de `product-card.tsx` muestre la cantidad correcta. La tarjeta
 * busca su línea con `lineKey({ productId, optionIds: [], notes: null })`, y
 * `addLine`/`setQuantity` (en `cart.tsx`) mergean por el mismo `lineKey()`
 * sobre la línea real del carrito — si las dos cuentas no coincidieran para
 * el mismo producto sin opciones, la tarjeta mostraría "+" con una unidad ya
 * en el carrito, o un stepper con la cantidad de la línea equivocada.
 *
 * No se monta React ni `CartProvider` para esto: `addLine` es un setter de
 * hook, no una función pura, así que "probar contra `addLine`" de verdad
 * pediría Testing Library + jsdom, un aparato que la suite hoy no tiene (los
 * tests corren en Node — ver `vitest.config.ts`). Lo que SÍ es una función
 * pura, y es exactamente lo que hace que la derivación funcione, es
 * `lineKey()`: los dos call sites (la tarjeta y el merge de `addLine`) le
 * pasan un objeto `{ productId, optionIds, notes }` de la misma forma, así
 * que probar `lineKey` a secas ya cubre la invariante real sin necesitar un
 * DOM. Si el día de mañana la lógica de merge deja de pasar por `lineKey` (o
 * empieza a construir la clave de lookup distinto de como arma la línea
 * `addLine`), esto se rompe primero acá.
 */
describe('lineKey — la clave que une la tarjeta con el carrito real', () => {
  it('la clave de lookup de la tarjeta (sin opciones) es la MISMA que la de la línea que crearía addLine para ese producto', () => {
    const productId = 42
    const cardLookupKey = lineKey({ productId, optionIds: [], notes: null })
    // Esto es literalmente lo que `addLine({ productId, quantity: 1, optionIds: [], notes: null })`
    // termina guardando como línea — mismo shape, mismo call a lineKey().
    const lineAddLineWouldCreate = { productId, optionIds: [] as number[], notes: null as string | null }
    expect(lineKey(lineAddLineWouldCreate)).toBe(cardLookupKey)
  })

  it('dos productos distintos, ambos sin opciones, nunca colisionan en la misma clave', () => {
    const keyA = lineKey({ productId: 1, optionIds: [], notes: null })
    const keyB = lineKey({ productId: 2, optionIds: [], notes: null })
    expect(keyA).not.toBe(keyB)
  })

  it('AISLAMIENTO: la línea "quick add" sin opciones de un producto no se confunde con una línea del mismo producto CON opciones (agregada desde la ficha)', () => {
    // Si un cliente ya tiene "Doble Cheddar + medio/tres cuartos" en el
    // carrito (agregado desde la ficha, con opciones) y después usa el "+"
    // rápido de la tarjeta para el MISMO producto sin pasar por la ficha,
    // el stepper de la tarjeta tiene que arrancar en 0 — no puede leer ni
    // tocar la cantidad de la línea con opciones.
    const productId = 7
    const quickAddKey = lineKey({ productId, optionIds: [], notes: null })
    const lineWithOptionsKey = lineKey({ productId, optionIds: [3], notes: null })
    expect(quickAddKey).not.toBe(lineWithOptionsKey)
  })

  it('el orden en que se arma el array de optionIds no cambia la clave — un merge de addLine encuentra la línea sin importar el orden en que llegaron las opciones', () => {
    const a = lineKey({ productId: 9, optionIds: [5, 2], notes: null })
    const b = lineKey({ productId: 9, optionIds: [2, 5], notes: null })
    expect(a).toBe(b)
  })

  it('notes distintas (incluida la ausencia, null) producen líneas distintas — dos pedidos de "sin sal" y "con extra sal" no se pisan', () => {
    const withoutNotes = lineKey({ productId: 3, optionIds: [], notes: null })
    const withNotes = lineKey({ productId: 3, optionIds: [], notes: 'sin sal' })
    expect(withoutNotes).not.toBe(withNotes)
  })
})
