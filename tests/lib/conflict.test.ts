import { describe, expect, it } from 'vitest'
import { CONFLICT_FIELD, isConflict } from '@/lib/conflict'
import type { ActionResult } from '@/models/types'

describe('isConflict — reconoce un 409 sin confundirlo con un error de campo cualquiera', () => {
  it('un resultado exitoso nunca es un conflicto', () => {
    const result: ActionResult<{ id: number }> = { ok: true, data: { id: 1 } }
    expect(isConflict(result)).toBe(false)
  })

  it('un error sin fieldErrors no es un conflicto', () => {
    const result: ActionResult<never> = { ok: false, error: 'algo salió mal' }
    expect(isConflict(result)).toBe(false)
  })

  it('un error de validación en un campo normal (p. ej. "nombre") NO es un conflicto', () => {
    const result: ActionResult<never> = {
      ok: false,
      error: 'Revisá los datos',
      fieldErrors: { nombre: ['es obligatorio'] },
    }
    expect(isConflict(result)).toBe(false)
  })

  it('un error con fieldErrors[CONFLICT_FIELD] SÍ es un conflicto', () => {
    const result: ActionResult<never> = {
      ok: false,
      error: 'Otro operario ya cambió el estado',
      fieldErrors: { [CONFLICT_FIELD]: ['Otro operario ya cambió el estado'] },
    }
    expect(isConflict(result)).toBe(true)
  })

  it('CONFLICT_FIELD es la clave literal "conflict"', () => {
    // El valor concreto importa: `kitchen.actions.ts` y `order-card.tsx` lo
    // usaban como literal duplicado antes de esta constante (A-07); si el
    // valor cambia sin querer, esos call sites tienen que enterarse por acá.
    expect(CONFLICT_FIELD).toBe('conflict')
  })
})
