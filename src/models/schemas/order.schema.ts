import { z } from 'zod'

/**
 * Contratos del pedido.
 *
 * Regla que atraviesa todo el archivo: el cliente manda IDs y cantidades, nunca
 * precios. Lo que el browser dice que cuesta una hamburguesa es una sugerencia,
 * no un dato. El total sale siempre de la base, en el servidor.
 */

/**
 * Ciclo de la COCINA. El del dinero es `paymentStatusSchema`, aparte.
 * Con pago en el local un pedido puede estar 'ready' y todavía impago.
 */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'cancelled',
] as const

export const orderStatusSchema = z.enum(ORDER_STATUSES)
export type OrderStatus = z.infer<typeof orderStatusSchema>

/** Estados que la cocina ve como "trabajo pendiente". */
export const ACTIVE_STATUSES = ['confirmed', 'preparing', 'ready', 'on_the_way'] as const satisfies readonly OrderStatus[]

/**
 * Los que cuentan para el multiplicador de demanda: lo que está en la plancha.
 *
 * `on_the_way` NO entra: ya salió de la cocina, así que no debería hacer que el
 * próximo pedido diga que va a tardar más.
 */
export const COOKING_STATUSES = ['confirmed', 'preparing'] as const satisfies readonly OrderStatus[]

/** De aca no se sale: la UI no ofrece acciones y el trigger de Postgres las rechaza. */
export const TERMINAL_STATUSES = ['delivered', 'cancelled'] as const satisfies readonly OrderStatus[]

export function isTerminalStatus(status: OrderStatus): boolean {
  return (TERMINAL_STATUSES as readonly OrderStatus[]).includes(status)
}

/**
 * Etiqueta de cada estado, en un solo lugar.
 *
 * Estaba duplicada en el modelo (mensajes de error), en la vista compartida y en
 * el tablero de cocina, con textos distintos para el mismo estado.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Sin confirmar',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

export const paymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'refunded'])
export type PaymentStatus = z.infer<typeof paymentStatusSchema>

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pago pendiente',
  approved: 'Pagado',
  rejected: 'Pago rechazado',
  refunded: 'Reembolsado',
}

/**
 * Estados de la tabla `payments`, que es mas ancha que la del pedido:
 * registra tambien los pagos que NO se aplican, para que quede el rastro.
 *
 *  - `charged_back`: contracargo. La plata se fue y hay que enterarse.
 *  - `mismatch`: el monto, la moneda o la tienda no coinciden con el pedido.
 *    Se guarda y NO se toca el pedido.
 *  - `duplicate`: segundo pago aprobado del mismo pedido. Hay que reembolsarlo.
 */
export const paymentRecordStatusSchema = z.enum([
  'pending', 'approved', 'rejected', 'refunded', 'charged_back', 'mismatch', 'duplicate',
])
export type PaymentRecordStatus = z.infer<typeof paymentRecordStatusSchema>

export const PAYMENT_PROVIDER = 'mercadopago' as const

/**
 * Nombre del indice unico que arbitra la idempotencia.
 *
 * Cualquier 23505 se interpretaba como "otra request gano la carrera", pero una
 * colision de `short_code` da el mismo codigo: se trataba un bug como un
 * reintento. Con el nombre del indice a mano se puede distinguir.
 */
export const IDEMPOTENCY_INDEX = 'orders_idempotency_idx'
export const ONE_APPROVED_PAYMENT_INDEX = 'payments_one_approved_per_order_idx'

export function isUniqueViolationOn(err: { code?: string; message?: string } | null | undefined, index: string): boolean {
  return err?.code === '23505' && (err.message ?? '').includes(index)
}

export const paymentMethodSchema = z.enum(['online', 'in_store', 'transfer'])
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

/**
 * Tope duro del comprobante, en el servidor. 4 MB y no los 5 del bucket: el
 * bucket tiene margen de sobra (backstop), pero acá se rechaza ANTES de que
 * Vercel devuelva su propio `413 FUNCTION_PAYLOAD_TOO_LARGE`, que no dice nada
 * útil para quien está tratando de subir un comprobante desde el celular.
 */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024

/**
 * El MIME que declara este schema es el que SNIFFEÓ el servidor sobre los
 * bytes reales (magic bytes), nunca el `Content-Type` que manda el browser —
 * eso es justo lo que pidió el dueño del producto. Este schema valida la forma
 * ya derivada; el sniff en sí vive en el route handler, que es quien tiene los
 * bytes.
 */
export const receiptUploadSchema = z.object({
  mime: z.enum(['image/jpeg', 'application/pdf']),
  sizeBytes: z.number().int().positive().max(MAX_RECEIPT_BYTES, 'El comprobante pesa más de lo permitido'),
})
export type ReceiptUploadInput = z.infer<typeof receiptUploadSchema>

/** Cómo recibe el pedido el cliente. `pickup` es el default histórico. */
export const deliveryMethodSchema = z.enum(['pickup', 'delivery'])
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>


/**
 * Teléfono argentino normalizado a E.164.
 * Acepta lo que la gente realmente escribe (11 5555-4444, +54 9 11..., 011...)
 * y devuelve +54911XXXXXXXX. Sin esto, el WhatsApp no llega.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Necesitamos tu teléfono para avisarte')
  .transform((raw, ctx) => {
    const digits = raw.replace(/\D/g, '')
    let local = digits

    if (local.startsWith('54')) local = local.slice(2)
    if (local.startsWith('9')) local = local.slice(1)
    local = local.replace(/^0/, '')

    // El "15" de celular solo se saca si sobran dígitos. En Córdoba (351) el
    // "15" aparece dentro del número real y sacarlo lo destruye.
    if (local.length > 10) {
      const stripped = local.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
      if (stripped.length === 10) local = stripped
    }

    if (local.length !== 10) {
      ctx.addIssue({
        code: 'custom',
        message: 'Revisá el número: tiene que ser un celular con característica, por ejemplo 11 5555-4444',
      })
      return z.NEVER
    }
    return `+549${local}`
  })

/**
 * Un ítem del carrito, tal como lo manda el browser: QUÉ se quiere y CUÁNTO.
 * Ningún precio, ni acá ni en `localStorage`.
 *
 * `.strict()` no es cosmético. Por defecto Zod descarta las claves que no
 * conoce, así que un cliente que mandara `unitPriceCents` recibiría un 200 y el
 * campo se tiraría en silencio. Seguro, pero mudo: nadie se enteraría de que
 * algo está mandando precios. Con `.strict()` eso es un 400 y se ve.
 */
export const cartItemSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(50),
    /** IDs de opciones elegidas. Se validan contra el producto en el servidor. */
    /**
     * IDs de opciones elegidas. Se validan contra el producto en el servidor.
     *
     * Sin unicidad, `[5, 5]` sumaba el delta dos veces: con un delta negativo
     * ("sin cebolla −$100") el cliente se hacia un descuento doble, y con uno
     * positivo se le cobraba de mas. Se rechaza en vez de deduplicar en silencio
     * para que un cliente que manda basura se vea.
     */
    optionIds: z
      .array(z.coerce.number().int().positive())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'Hay una opción repetida en el pedido')
      .default([]),
    notes: z.string().trim().max(200).optional(),
  })
  .strict()

export type CartItem = z.infer<typeof cartItemSchema>

/**
 * Texto opcional que trata el string vacío como ausente.
 *
 * Un input que el cliente tocó y dejó en blanco no puede fallar la validación
 * ni guardarse como `''`: en la base, "no puso piso" es `null`.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))

export const createOrderSchema = z
  .object({
    storeSlug: z.string().trim().min(1).max(60),
    /**
     * La genera el browser al confirmar el pedido y la reusa en cada reintento.
     * Es lo que evita que un doble tap con mala señal meta dos pedidos en la
     * cocina. Obligatoria a propósito: opcional dejaría el agujero abierto para
     * cualquier cliente que se la olvide.
     */
    idempotencyKey: z.uuid('Falta la clave de idempotencia del pedido'),
    items: z.array(cartItemSchema).min(1, 'El carrito está vacío').max(40),
    paymentMethod: paymentMethodSchema.default('online'),
    customerName: z.string().trim().min(2, 'Necesitamos tu nombre').max(80),
    customerPhone: phoneSchema,
    /**
     * Opcional a propósito: un campo más en el checkout es fricción real en
     * mobile. Si viene, habilita comprobante y aviso por mail. Si no, el único
     * canal es WhatsApp.
     *
     * El string vacío se trata como ausente: un input que el cliente tocó y
     * dejó en blanco no puede fallar la validación de email.
     */
    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(160)
      .optional()
      .transform((v) => (v === '' ? undefined : v))
      .pipe(z.email('Revisá el email').optional()),
    notes: z.string().trim().max(400).optional(),

    /**
     * Cómo lo recibe. El cliente elige el MÉTODO; el costo del envío lo calcula
     * el servidor contra la config de la tienda y no viaja nunca en esta
     * request — mismo principio que los precios de los ítems.
     *
     * Los cuatro campos de dirección van PLANOS, no anidados en un objeto, y es
     * deliberado: `zodToApiError` devuelve el último segmento del path como
     * `field`, y el checkout mapea ese `field` contra sus refs para enfocar el
     * input con error. Un objeto anidado produciría `field: 'line'` para un
     * input llamado `deliveryAddressLine`, y el foco se perdería en silencio.
     */
    deliveryMethod: deliveryMethodSchema.default('pickup'),
    deliveryAddressLine: optionalText(160),
    deliveryAddressUnit: optionalText(60),
    deliveryAddressBetween: optionalText(160),
    deliveryAddressNotes: optionalText(300),

    /**
     * El INSTANTE que el cliente eligió de la lista de turnos, nunca una hora
     * de pared. `z.iso.datetime()` sin `offset` acepta solo UTC con `Z`
     * (verificado contra la doc de Zod v4) — es la misma restricción que ya
     * vale para el resto del pedido: el browser manda un dato crudo y el
     * servidor deriva todo lo demás (granularidad, lead, horizonte, horario,
     * noche comercial, `fire_at`). Ausente = pedido para ahora, el
     * comportamiento de siempre.
     */
    scheduledFor: z.iso.datetime().optional(),
  })
  // Mismo motivo: un cliente que mande `totalCents` tiene que fallar ruidoso,
  // no ser corregido en silencio.
  .strict()
  .superRefine((v, ctx) => {
    if (v.deliveryMethod !== 'delivery') return
    if (!v.deliveryAddressLine || v.deliveryAddressLine.length < 4) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddressLine'],
        message: 'Escribí la calle y el número para el envío',
      })
    }
  })

export type CreateOrderInput = z.infer<typeof createOrderSchema>

/**
 * Token público del pedido: 24 caracteres del alfabeto de private.random_token.
 * Es lo único que da acceso a un pedido, así que se valida con forma estricta
 * antes de tocar la base — no vale la pena consultar por basura.
 */
export const orderTokenSchema = z
  .string()
  .trim()
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/, 'Código de pedido inválido')

/** "Mis pedidos": el browser manda los tokens que guardó en localStorage. */
export const orderLookupSchema = z.object({
  tokens: z.array(orderTokenSchema).min(1).max(50),
})

/**
 * Transiciones permitidas del ciclo de cocina.
 *
 * El CHECK de Postgres valida que el estado EXISTA; esto valida que se pueda
 * LLEGAR ahí desde donde estás. Sin esto, `pending → delivered` salteando todo
 * es legal, y `delivered → pending` también: con dos personas tocando el panel
 * en hora pico, un pedido entregado vuelve a la cola.
 *
 * Se permite un paso atrás dentro de la cocina (`preparing → confirmed`,
 * `ready → preparing`, `on_the_way → ready`) porque un toque equivocado en una
 * cocina llena —o arriba de una moto— está garantizado, y obligar a rehacer el
 * pedido es peor que dejar corregir.
 * `delivered` y `cancelled` son terminales: de ahí no se sale.
 *
 * `ready → delivered` se mantiene: es el camino de todo pedido de retiro, y el
 * de un delivery que el cliente termina pasando a buscar.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'confirmed', 'cancelled'],
  // `delivered` va PRIMERO y eso no es cosmético: el KDS elige el botón
  // primario con un `.find()` sobre este array, y un pedido de RETIRO no puede
  // ofrecer "Salió a repartir". Ver el cálculo explícito de `forwardTarget` en
  // `kds/order-card.tsx`, que además exige repartidor asignado.
  ready: ['delivered', 'on_the_way', 'preparing', 'cancelled'],
  on_the_way: ['delivered', 'ready', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export const updateOrderStatusSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  status: orderStatusSchema,
})
