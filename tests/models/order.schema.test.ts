import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TRANSITIONS,
  IDEMPOTENCY_INDEX,
  ONE_APPROVED_PAYMENT_INDEX,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  TERMINAL_STATUSES,
  canTransition,
  cartItemSchema,
  createOrderSchema,
  isTerminalStatus,
  isUniqueViolationOn,
  orderLookupSchema,
  orderTokenSchema,
  paymentStatusSchema,
  phoneSchema,
  updateOrderStatusSchema,
  type OrderStatus,
} from '@/models/schemas/order.schema'

/**
 * Un pedido válido de referencia: cada test lo clona y rompe UNA cosa, así el
 * fallo señala exactamente qué regla se violó.
 */
function validCartItem() {
  return { productId: 1, quantity: 2, optionIds: [10, 11], notes: 'sin sal' }
}

/**
 * Saca UNA clave de un objeto sin dejar un binding sin usar (el
 * `const { x: _omit, ...rest } = obj` de siempre dispara
 * `no-unused-vars` porque este repo no configura `argsIgnorePattern` para
 * `_`; esta función evita el binding en vez de silenciar el lint).
 */
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const clone = { ...obj }
  delete clone[key]
  return clone
}

function validOrderInput() {
  return {
    storeSlug: 'la-birra',
    idempotencyKey: '5b7a9c2e-7d1a-4b3a-9c2e-7d1a4b3a9c2e',
    items: [validCartItem()],
    paymentMethod: 'online' as const,
    customerName: 'Juan Pérez',
    customerPhone: '11 5555-4444',
    customerEmail: 'juan@example.com',
    notes: 'tocar timbre',
  }
}

describe('cartItemSchema — el cliente manda IDs y cantidades, nunca precios', () => {
  it('un carrito que manda unitPriceCents es rechazado, no corregido en silencio', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), unitPriceCents: 1 })
    expect(result.success).toBe(false)
    // Zod v4 informa la clave no reconocida en el mensaje del issue.
    expect(JSON.stringify(result.error?.issues)).toMatch(/unrecognized_keys|unitPriceCents/i)
  })

  it('un carrito sin precios pasa tal cual', () => {
    const result = cartItemSchema.safeParse(validCartItem())
    expect(result.success).toBe(true)
  })

  it('P-16: optionIds duplicados se rechazan, no se cobran ni descuentan dos veces', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), optionIds: [5, 5] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/repetid/i)
  })

  it('P-16: optionIds sin repetir es válido aunque compartan el mismo delta', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), optionIds: [5, 6, 7] })
    expect(result.success).toBe(true)
  })

  it('optionIds es [] por default: no hace falta mandarlo para un ítem sin opciones', () => {
    const result = cartItemSchema.safeParse({ productId: 1, quantity: 1 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.optionIds).toEqual([])
  })

  it('S-18: productId llega como string desde un form y se coerce a número', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), productId: '42' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.productId).toBe(42)
  })

  it('S-18: productId negativo falla en vez de coercionarse a algo usable', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), productId: -1 })
    expect(result.success).toBe(false)
  })

  it('S-18: productId como array falla en vez de tomar el primer elemento', () => {
    const result = cartItemSchema.safeParse({ ...validCartItem(), productId: [1, 2] })
    expect(result.success).toBe(false)
  })

  it('quantity fuera de 1..50 falla', () => {
    expect(cartItemSchema.safeParse({ ...validCartItem(), quantity: 0 }).success).toBe(false)
    expect(cartItemSchema.safeParse({ ...validCartItem(), quantity: 51 }).success).toBe(false)
  })

  it('más de 20 opciones en un mismo ítem falla', () => {
    const optionIds = Array.from({ length: 21 }, (_, i) => i + 1)
    expect(cartItemSchema.safeParse({ ...validCartItem(), optionIds }).success).toBe(false)
  })
})

describe('createOrderSchema — el total lo pone siempre el servidor', () => {
  it('un pedido que manda totalCents es rechazado, no ignorado en silencio', () => {
    const result = createOrderSchema.safeParse({ ...validOrderInput(), totalCents: 1 })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/unrecognized_keys|totalCents/i)
  })

  it('un pedido bien formado pasa', () => {
    expect(createOrderSchema.safeParse(validOrderInput()).success).toBe(true)
  })

  it('idempotencyKey es obligatoria: sin ella, un doble tap con mala señal podría duplicar el pedido', () => {
    const result = createOrderSchema.safeParse(omit(validOrderInput(), 'idempotencyKey'))
    expect(result.success).toBe(false)
  })

  it('idempotencyKey tiene que ser un UUID de verdad, no cualquier string', () => {
    const result = createOrderSchema.safeParse({ ...validOrderInput(), idempotencyKey: 'no-es-un-uuid' })
    expect(result.success).toBe(false)
  })

  describe('customerEmail — opcional, pero si viene tiene forma de email', () => {
    it('el string vacío (input tocado y dejado en blanco) se trata como ausente, no como error', () => {
      const result = createOrderSchema.safeParse({ ...validOrderInput(), customerEmail: '' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.customerEmail).toBeUndefined()
    })

    it('un email sin @ ni dominio sí falla', () => {
      const result = createOrderSchema.safeParse({ ...validOrderInput(), customerEmail: 'no-es-un-email' })
      expect(result.success).toBe(false)
    })

    it('omitir el campo directamente también es válido', () => {
      expect(createOrderSchema.safeParse(omit(validOrderInput(), 'customerEmail')).success).toBe(true)
    })
  })
})

describe('phoneSchema — la puerta al WhatsApp: si normaliza mal, el aviso no llega', () => {
  const equivalentInputs = ['11 5555-4444', '+54 9 11 5555 4444', '011 5555-4444', '+5491155554444']

  it.each(equivalentInputs)('"%s" normaliza a +5491155554444', (raw) => {
    const result = phoneSchema.safeParse(raw)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('+5491155554444')
  })

  it('trampa documentada en CLAUDE.md/AGENTS.md: en Córdoba el "15" es parte del número real y NO se saca cuando no sobran dígitos', () => {
    // Área 351 + número real de 7 dígitos que empieza con "15": 3511544567.
    // El local resultante mide exactamente 10, así que el recorte del "15" de
    // celular (que solo aplica cuando sobran dígitos) nunca se dispara y el
    // número llega intacto.
    const result = phoneSchema.safeParse('+54 9 351 1544567')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('+5493511544567')
  })

  it('el mismo número de Córdoba escrito con 0 y sin 9 también se preserva', () => {
    const result = phoneSchema.safeParse('0351 1544567')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('+5493511544567')
  })

  it('un número demasiado corto falla con un mensaje que sirve para corregirlo', () => {
    const result = phoneSchema.safeParse('11 5555')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/característica/i)
  })

  it('un número demasiado largo también falla', () => {
    const result = phoneSchema.safeParse('11 5555 4444 4444 4444')
    expect(result.success).toBe(false)
  })

  it('un string vacío falla: sin teléfono no hay forma de avisar por WhatsApp', () => {
    expect(phoneSchema.safeParse('').success).toBe(false)
  })
})

describe('orderTokenSchema — la única credencial de un pedido', () => {
  const validToken = '23456789abcdefghjkmnpqrs' // 24 chars, alfabeto correcto

  it('un token de 24 chars del alfabeto correcto es válido', () => {
    expect(validToken.length).toBe(24)
    expect(orderTokenSchema.safeParse(validToken).success).toBe(true)
  })

  it('rechaza mayúsculas: el alfabeto de private.random_token es todo minúsculas', () => {
    const upper = validToken.toUpperCase()
    expect(orderTokenSchema.safeParse(upper).success).toBe(false)
  })

  it.each(['0', '1', 'i', 'l', 'o'])('rechaza el carácter ambiguo "%s", excluido del alfabeto', (char) => {
    const withAmbiguous = char + validToken.slice(1)
    expect(orderTokenSchema.safeParse(withAmbiguous).success).toBe(false)
  })

  it('rechaza un token más corto que 24', () => {
    expect(orderTokenSchema.safeParse(validToken.slice(0, 23)).success).toBe(false)
  })

  it('rechaza un token más largo que 24', () => {
    expect(orderTokenSchema.safeParse(validToken + '2').success).toBe(false)
  })

  it('orderLookupSchema exige al menos un token y como mucho 50', () => {
    expect(orderLookupSchema.safeParse({ tokens: [] }).success).toBe(false)
    expect(orderLookupSchema.safeParse({ tokens: [validToken] }).success).toBe(true)
    const tooMany = Array.from({ length: 51 }, () => validToken)
    expect(orderLookupSchema.safeParse({ tokens: tooMany }).success).toBe(false)
  })
})

describe('ALLOWED_TRANSITIONS / canTransition — la máquina de estados de cocina', () => {
  it('ALLOWED_TRANSITIONS tiene una entrada por cada estado de ORDER_STATUSES', () => {
    const keys = Object.keys(ALLOWED_TRANSITIONS).sort()
    expect(keys).toEqual([...ORDER_STATUSES].sort())
  })

  it('delivered y cancelled son terminales: no tienen NINGUNA transición de salida', () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([])
      for (const to of ORDER_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false)
      }
    }
  })

  it('se permite un paso atrás dentro de la cocina', () => {
    expect(canTransition('preparing', 'confirmed')).toBe(true)
    expect(canTransition('ready', 'preparing')).toBe(true)
  })

  it('no se permiten dos pasos atrás', () => {
    // ready -> confirmed son dos pasos (ready -> preparing -> confirmed).
    expect(canTransition('ready', 'confirmed')).toBe(false)
    expect(canTransition('preparing', 'pending')).toBe(false)
  })

  it('pending -> delivered (saltear todo el flujo) es ilegal', () => {
    expect(canTransition('pending', 'delivered')).toBe(false)
  })

  it('todo estado puede cancelarse salvo los terminales', () => {
    const nonTerminal = ORDER_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly OrderStatus[]).includes(s))
    for (const status of nonTerminal) {
      expect(canTransition(status, 'cancelled')).toBe(true)
    }
  })

  it('quedarse en el mismo estado no es una transición válida', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false)
    }
  })
})

describe('ORDER_STATUS_LABELS y PAYMENT_STATUS_LABELS — única fuente de las etiquetas', () => {
  it('hay una etiqueta no vacía para cada OrderStatus', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy()
      expect(typeof ORDER_STATUS_LABELS[status]).toBe('string')
    }
  })

  it('hay una etiqueta no vacía para cada PaymentStatus', () => {
    for (const status of paymentStatusSchema.options) {
      expect(PAYMENT_STATUS_LABELS[status]).toBeTruthy()
    }
  })
})

describe('isTerminalStatus', () => {
  it('coincide exactamente con TERMINAL_STATUSES para todo el enum', () => {
    for (const status of ORDER_STATUSES) {
      const expected = (TERMINAL_STATUSES as readonly OrderStatus[]).includes(status)
      expect(isTerminalStatus(status)).toBe(expected)
    }
  })
})

describe('isUniqueViolationOn — P-17: no todo 23505 es una carrera de idempotencia', () => {
  it('reconoce una violación del índice de idempotencia', () => {
    const err = { code: '23505', message: `duplicate key value violates unique constraint "${IDEMPOTENCY_INDEX}"` }
    expect(isUniqueViolationOn(err, IDEMPOTENCY_INDEX)).toBe(true)
  })

  it('reconoce una violación del índice de "un solo pago aprobado" como algo DISTINTO de la idempotencia', () => {
    const err = { code: '23505', message: `duplicate key value violates unique constraint "${ONE_APPROVED_PAYMENT_INDEX}"` }
    expect(isUniqueViolationOn(err, ONE_APPROVED_PAYMENT_INDEX)).toBe(true)
    // La colisión de short_code (u otro índice cualquiera) no se confunde con idempotencia.
    expect(isUniqueViolationOn(err, IDEMPOTENCY_INDEX)).toBe(false)
  })

  it('una colisión de short_code (otro índice único) no se toma como carrera de idempotencia', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "orders_short_code_idx"' }
    expect(isUniqueViolationOn(err, IDEMPOTENCY_INDEX)).toBe(false)
  })

  it('un error que no es 23505 nunca cuenta, aunque el mensaje mencione el índice', () => {
    const err = { code: '23503', message: `foreign key violation near ${IDEMPOTENCY_INDEX}` }
    expect(isUniqueViolationOn(err, IDEMPOTENCY_INDEX)).toBe(false)
  })

  it('null o undefined no rompen la función', () => {
    expect(isUniqueViolationOn(null, IDEMPOTENCY_INDEX)).toBe(false)
    expect(isUniqueViolationOn(undefined, IDEMPOTENCY_INDEX)).toBe(false)
  })
})

describe('updateOrderStatusSchema — S-18: coerción de IDs', () => {
  it('orderId como string numérico se coerce', () => {
    const result = updateOrderStatusSchema.safeParse({ orderId: '7', status: 'confirmed' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.orderId).toBe(7)
  })

  it('orderId negativo falla', () => {
    expect(updateOrderStatusSchema.safeParse({ orderId: -1, status: 'confirmed' }).success).toBe(false)
  })

  it('un status fuera del enum falla', () => {
    expect(updateOrderStatusSchema.safeParse({ orderId: 1, status: 'en-camino' }).success).toBe(false)
  })
})
