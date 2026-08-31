import { describe, expect, it } from 'vitest'
import { firstToken, relativeLastOrderLabel } from '@/views/admin/clientes/format'

describe('relativeLastOrderLabel — la columna "Última compra" del padrón', () => {
  it('null (nunca compró) → "Nunca compró"', () => {
    expect(relativeLastOrderLabel(null)).toBe('Nunca compró')
  })

  it('BORDE: 0 días → "Hoy"', () => {
    expect(relativeLastOrderLabel(0)).toBe('Hoy')
  })

  it('BORDE: 1 día → "Ayer" (no "Hace 1 días")', () => {
    expect(relativeLastOrderLabel(1)).toBe('Ayer')
  })

  it('BORDE: 2 días → "Hace 2 días" (el primer caso del plural)', () => {
    expect(relativeLastOrderLabel(2)).toBe('Hace 2 días')
  })

  it('un número grande de días también funciona (cliente muy inactivo)', () => {
    expect(relativeLastOrderLabel(400)).toBe('Hace 400 días')
  })
})

/**
 * `firstToken` — el `{nombre}` de los mensajes de WhatsApp (§5.5.1, T2A):
 * "la gente escribe 'Juan Pérez' y nadie saluda por apellido."
 */
describe('firstToken', () => {
  it('nombre y apellido → solo el nombre', () => {
    expect(firstToken('Juan Pérez')).toBe('Juan')
  })

  it('un solo token → se devuelve tal cual', () => {
    expect(firstToken('Rita')).toBe('Rita')
  })

  it('nombre compuesto con varios espacios (typeo real de checkout) → toma el primero, colapsando espacios de más', () => {
    expect(firstToken('María  José  Fernández')).toBe('María')
  })

  it('espacios de sobra al principio no producen un token vacío', () => {
    expect(firstToken('  Carlos Gómez')).toBe('Carlos')
  })
})
