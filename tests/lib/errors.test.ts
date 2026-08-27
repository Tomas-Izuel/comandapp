import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DomainError, isDomainError, toApiError, zodToApiError } from '@/lib/errors'

// `zodToApiError` y `toApiError` loguean con `log.error`, que en desarrollo
// escribe por `console.error`/`console.log`. Lo silenciamos para no ensuciar
// la salida de `npm test`, sin dejar de poder inspeccionar qué se logueó.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('DomainError / isDomainError', () => {
  it('status por defecto es 400', () => {
    const err = new DomainError('mensaje de negocio')
    expect(err.status).toBe(400)
  })

  it('acepta status y field explícitos', () => {
    const err = new DomainError('conflicto', { status: 409, field: 'estado' })
    expect(err.status).toBe(409)
    expect(err.field).toBe('estado')
  })

  it('isDomainError distingue un DomainError de un Error genérico', () => {
    expect(isDomainError(new DomainError('x'))).toBe(true)
    expect(isDomainError(new Error('x'))).toBe(false)
    expect(isDomainError('no ni siquiera es un Error')).toBe(false)
  })
})

describe('toApiError — la frontera entre error de negocio y falla interna', () => {
  it('un DomainError devuelve su propio mensaje y status: el mensaje ES la interfaz', () => {
    const err = new DomainError('Esta tienda no está disponible', { status: 400 })
    const { body, status } = toApiError(err, 'checkout')
    expect(body.error).toBe('Esta tienda no está disponible')
    expect(status).toBe(400)
  })

  it('un DomainError con field lo incluye en el body', () => {
    const err = new DomainError('Elegí al menos 1 opción de Punto de cocción', {
      field: 'optionIds',
    })
    const { body } = toApiError(err, 'checkout')
    expect(body.field).toBe('optionIds')
  })

  it('cualquier otro error da el mensaje genérico y NUNCA el mensaje interno', () => {
    // Simula lo que devolvería Postgres al rechazar una constraint: ese texto
    // no puede llegar nunca al cliente.
    const pgError = new Error(
      'duplicate key value violates unique constraint "orders_store_id_idempotency_key_key"',
    )
    const { body, status } = toApiError(pgError, 'orders.create')

    expect(status).toBe(500)
    expect(body.error).not.toContain('constraint')
    expect(body.error).not.toContain('orders_store_id_idempotency_key_key')
    expect(body.error).toBe('No pudimos procesar el pedido. Probá de nuevo en un momento.')
  })

  it('un valor no-Error lanzado (p. ej. un string) también cae al genérico', () => {
    const { body, status } = toApiError('algo explotó en algún lado', 'orders.create')
    expect(status).toBe(500)
    expect(body.error).not.toContain('algo explotó')
  })

  it('loguea la falla interna con el contexto, para poder rastrearla del lado del servidor', () => {
    const errorSpy = vi.spyOn(console, 'error')
    toApiError(new Error('boom'), 'mi-contexto')
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('zodToApiError — acepta el ZodError completo Y el array de issues (A-07)', () => {
  const schema = z.object({ nombre: z.string().min(3, 'nombre demasiado corto') }).strict()

  it('con el ZodError completo devuelve el mismo resultado que con el array de issues', () => {
    const result = schema.safeParse({ nombre: 'ab' })
    if (result.success) throw new Error('el parse debería haber fallado')

    const fromError = zodToApiError(result.error)
    const fromIssues = zodToApiError(result.error.issues)

    expect(fromError).toEqual(fromIssues)
    expect(fromError.body.error).toBe('nombre demasiado corto')
    expect(fromError.body.field).toBe('nombre')
    expect(fromError.status).toBe(400)
  })

  it('sin issues (array vacío) da un mensaje genérico de fallback', () => {
    const { body, status } = zodToApiError([])
    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it('un issue de clave desconocida (.strict()) NO nombra la clave rechazada en la respuesta', () => {
    // Este es el caso real: el mensaje que da Zod para `unrecognized_keys`
    // contiene el nombre de la clave ("Unrecognized key: \"unitPriceCents\"").
    // `zodToApiError` tiene que interceptarlo, no devolverlo tal cual.
    const result = schema.safeParse({ nombre: 'valido', unitPriceCents: 1 })
    if (result.success) throw new Error('el parse debería haber fallado')

    expect(result.error.issues[0]?.code).toBe('unrecognized_keys')
    expect(result.error.issues[0]?.message).toContain('unitPriceCents') // así viene crudo de Zod

    const { body, status } = zodToApiError(result.error)
    expect(status).toBe(400)
    expect(body.error).not.toContain('unitPriceCents') // pero esto es lo que sale
    expect(body.field).toBeUndefined()
  })

  it('un issue normal sí devuelve el campo, porque un cliente legítimo puede producirlo', () => {
    const result = schema.safeParse({ nombre: 'ab' })
    if (result.success) throw new Error('el parse debería haber fallado')
    const { body } = zodToApiError(result.error)
    expect(body.field).toBe('nombre')
  })
})
