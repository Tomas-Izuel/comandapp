import { describe, expect, it } from 'vitest'
import {
  categoryInputSchema,
  optionGroupInputSchema,
  optionGroupPartialInputSchema,
  optionInputSchema,
  productInputSchema,
} from '@/models/schemas/catalog.schema'

describe('productInputSchema', () => {
  function valid() {
    return {
      categoryId: 3,
      name: 'Doble cheddar',
      description: 'con panceta',
      imagePath: 'productos/doble-cheddar.jpg',
      priceCents: 550000,
      prepMinutes: 12,
      isAvailable: true,
      position: 0,
    }
  }

  it('un producto bien formado pasa', () => {
    expect(productInputSchema.safeParse(valid()).success).toBe(true)
  })

  it('priceCents es un entero de centavos: no admite decimales', () => {
    const result = productInputSchema.safeParse({ ...valid(), priceCents: 550000.5 })
    expect(result.success).toBe(false)
  })

  it('priceCents negativo falla: no hay descuentos vía precio base negativo', () => {
    expect(productInputSchema.safeParse({ ...valid(), priceCents: -1 }).success).toBe(false)
  })

  it('priceCents en 0 es válido (ítem gratis, ej. promoción): min es 0, no 1', () => {
    expect(productInputSchema.safeParse({ ...valid(), priceCents: 0 }).success).toBe(true)
  })

  it('priceCents llega como string desde un <input> y se coerce', () => {
    const result = productInputSchema.safeParse({ ...valid(), priceCents: '550000' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priceCents).toBe(550000)
  })

  it('prepMinutes está acotado a 0..240: un producto no puede tardar 5 horas', () => {
    expect(productInputSchema.safeParse({ ...valid(), prepMinutes: 241 }).success).toBe(false)
    expect(productInputSchema.safeParse({ ...valid(), prepMinutes: -1 }).success).toBe(false)
    expect(productInputSchema.safeParse({ ...valid(), prepMinutes: 240 }).success).toBe(true)
  })

  it('S-18: categoryId string se coerce a número', () => {
    const result = productInputSchema.safeParse({ ...valid(), categoryId: '9' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.categoryId).toBe(9)
  })

  it('S-18: categoryId negativo falla', () => {
    expect(productInputSchema.safeParse({ ...valid(), categoryId: -3 }).success).toBe(false)
  })

  it('S-18: categoryId como array falla en vez de quedarse con el primer elemento', () => {
    expect(productInputSchema.safeParse({ ...valid(), categoryId: [1, 2] }).success).toBe(false)
  })

  it('categoryId nullable: un producto puede no tener categoría todavía', () => {
    expect(productInputSchema.safeParse({ ...valid(), categoryId: null }).success).toBe(true)
  })

  it('un nombre vacío falla', () => {
    expect(productInputSchema.safeParse({ ...valid(), name: '   ' }).success).toBe(false)
  })
})

describe('categoryInputSchema', () => {
  it('acepta lo mínimo y aplica los defaults documentados', () => {
    const result = categoryInputSchema.safeParse({ name: 'Hamburguesas' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.position).toBe(0)
      expect(result.data.isActive).toBe(true)
    }
  })

  it('position negativa falla', () => {
    expect(categoryInputSchema.safeParse({ name: 'x', position: -1 }).success).toBe(false)
  })
})

describe('optionGroupInputSchema — grupos de opciones (ej. "Punto de cocción")', () => {
  it('maxSelect tiene que ser >= minSelect', () => {
    const result = optionGroupInputSchema.safeParse({ name: 'Punto', minSelect: 2, maxSelect: 1 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['maxSelect'])
  })

  it('minSelect === maxSelect es válido (selección exacta obligatoria)', () => {
    expect(optionGroupInputSchema.safeParse({ name: 'Punto', minSelect: 1, maxSelect: 1 }).success).toBe(true)
  })

  it('minSelect negativo falla', () => {
    expect(optionGroupInputSchema.safeParse({ name: 'Punto', minSelect: -1, maxSelect: 1 }).success).toBe(false)
  })

  it('optionGroupPartialInputSchema permite mandar un solo campo para un update parcial', () => {
    const result = optionGroupPartialInputSchema.safeParse({ position: 2 })
    expect(result.success).toBe(true)
  })
})

describe('optionInputSchema — ej. "sin cebolla" con delta negativo', () => {
  it('priceDeltaCents negativo es válido: es la forma de modelar un descuento', () => {
    const result = optionInputSchema.safeParse({ name: 'Sin cebolla', priceDeltaCents: -10000 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priceDeltaCents).toBe(-10000)
  })

  it('priceDeltaCents no admite decimales', () => {
    expect(optionInputSchema.safeParse({ name: 'x', priceDeltaCents: 1.5 }).success).toBe(false)
  })

  it('sin priceDeltaCents, el default es 0', () => {
    const result = optionInputSchema.safeParse({ name: 'Extra' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priceDeltaCents).toBe(0)
  })
})
