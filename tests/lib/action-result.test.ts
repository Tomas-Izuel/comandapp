import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { toActionResult } from '@/lib/action-result'
import { CONFLICT_FIELD } from '@/lib/conflict'
import { DomainError } from '@/lib/errors'

// `toActionResult` loguea la rama de error genérico con `log.error`.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('toActionResult — la única traducción excepción → ActionResult (A-07)', () => {
  it('éxito: devuelve { ok: true, data }', async () => {
    const result = await toActionResult(async () => ({ id: 42 }), 'test')
    expect(result).toEqual({ ok: true, data: { id: 42 } })
  })

  it('DomainError simple: el mensaje se muestra TAL CUAL, sin fieldErrors', async () => {
    const result = await toActionResult(async () => {
      throw new DomainError('Esta tienda no acepta pago al retirar')
    }, 'test')

    expect(result).toEqual({ ok: false, error: 'Esta tienda no acepta pago al retirar' })
  })

  it('DomainError con field: fieldErrors trae ese campo con el mismo mensaje', async () => {
    const result = await toActionResult(async () => {
      throw new DomainError('Elegí al menos 1 opción de Punto de cocción', { field: 'optionIds' })
    }, 'test')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('Elegí al menos 1 opción de Punto de cocción')
    expect(result.fieldErrors).toEqual({ optionIds: ['Elegí al menos 1 opción de Punto de cocción'] })
  })

  it('DomainError con status 409: se marca con CONFLICT_FIELD, no con err.field', async () => {
    const result = await toActionResult(async () => {
      throw new DomainError('Otro operario ya cambió el estado', { status: 409, field: 'status' })
    }, 'test')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    // El 409 tiene prioridad sobre `field`: la UI necesita reconocer el
    // conflicto por la clave fija, no por el nombre de campo de turno.
    expect(result.fieldErrors).toEqual({ [CONFLICT_FIELD]: ['Otro operario ya cambió el estado'] })
    expect(result.fieldErrors?.status).toBeUndefined()
  })

  it('ZodError: separa los mensajes por campo para que el formulario los muestre', async () => {
    const schema = z
      .object({
        nombre: z.string().min(3, 'nombre demasiado corto'),
        telefono: z.string().min(6, 'teléfono inválido'),
      })
      .strict()

    const result = await toActionResult(async () => {
      const parsed = schema.safeParse({ nombre: 'ab', telefono: '123' })
      if (!parsed.success) throw parsed.error
      return parsed.data
    }, 'test')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('nombre demasiado corto') // el primer issue, para el mensaje de arriba del form
    expect(result.fieldErrors).toEqual({
      nombre: ['nombre demasiado corto'],
      telefono: ['teléfono inválido'],
    })
  })

  it('un Error genérico: mensaje genérico, y NUNCA el mensaje interno', async () => {
    const result = await toActionResult(async () => {
      throw new Error('duplicate key value violates unique constraint "orders_idempotency_key_key"')
    }, 'test')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).not.toContain('constraint')
    expect(result.error).not.toContain('idempotency_key')
    expect(result.error).toBe('No pudimos procesar la operación. Probá de nuevo en un momento.')
  })

  it('loguea la falla genérica con el contexto y los fields opcionales (storeId/orderId)', async () => {
    const errorSpy = vi.spyOn(console, 'error')
    await toActionResult(
      async () => {
        throw new Error('boom interno')
      },
      'kitchen.updateStatus',
      { storeId: 7, orderId: 99 },
    )
    expect(errorSpy).toHaveBeenCalled()
  })
})
