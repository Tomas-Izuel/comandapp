import { z } from 'zod'

/**
 * Contratos de repartidores: invitación, asignación y avance de una entrega.
 *
 * Los tres son `.strict()` por el mismo motivo que `createOrderSchema`: una
 * clave que no está en el schema tiene que fallar ruidoso, no descartarse en
 * silencio. Acá importa el doble porque la asignación se ejecuta con el cliente
 * admin (bypassea RLS) detrás de un chequeo de permiso.
 */

export const inviteCourierSchema = z
  .object({
    /**
     * Obligatorio, y no es burocracia: es lo que ve el CLIENTE en el
     * seguimiento ("Martín está llevando tu pedido"). Hay un CHECK en Postgres
     * que rechaza un courier sin nombre.
     */
    displayName: z.string().trim().min(2, 'Poné el nombre del repartidor').max(60),
    email: z.email('Ingresá un email válido'),
  })
  .strict()

export type InviteCourierInput = z.infer<typeof inviteCourierSchema>

export const assignCourierSchema = z
  .object({
    storeId: z.coerce.number().int().positive(),
    orderId: z.coerce.number().int().positive(),
    /** `null` desasigna. Solo se puede antes de que el pedido salga. */
    courierId: z.coerce.number().int().positive().nullable(),
  })
  .strict()

export type AssignCourierInput = z.infer<typeof assignCourierSchema>

/**
 * Lo único que el repartidor puede pedir.
 *
 * El enum tiene dos elementos y eso es el modelo de seguridad, no una
 * comodidad: la RPC `courier_advance_order` valida la misma lista en el cuerpo,
 * así que ni siquiera un request armado a mano contra PostgREST puede pedir
 * `cancelled`.
 */
export const courierAdvanceSchema = z
  .object({
    orderId: z.coerce.number().int().positive(),
    status: z.enum(['on_the_way', 'delivered']),
    /**
     * Solo se honra si el local activó el cobro en la puerta, el pedido es de
     * pago en el local y estaba pendiente. Si no, Postgres lo ignora.
     */
    collected: z.boolean().default(false),
  })
  .strict()

export type CourierAdvanceInput = z.infer<typeof courierAdvanceSchema>
