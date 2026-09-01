import { z } from 'zod'

/**
 * Padrón de clientes (T1A). Todo lo que valida un borde de este slice:
 * el token público de `/baja/[token]`, los inputs de las dos acciones del
 * dueño, y la forma del `jsonb` que devuelve `store_customer_directory`.
 */

/** `storeId`/`customerId` llegan tipados `number` solo por TypeScript: una
 * Server Action es un endpoint HTTP más (mismo criterio que `admin.actions.ts`). */
export const storeIdSchema = z.number().int().positive()
export const customerIdSchema = z.number().int().positive()

/**
 * Token de `/baja/[token]`. Mismo alfabeto y mismo largo que `orderTokenSchema`
 * (`src/models/schemas/order.schema.ts`): los dos salen de
 * `private.random_token(24)` — ver `store_customers.unsubscribe_token` en
 * `20260901120000_clientes.sql`.
 */
export const unsubscribeTokenSchema = z
  .string()
  .trim()
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/, 'Este link de baja no es válido')

/**
 * Nota interna del dueño sobre un cliente. Vacío es "borrar la nota", no un
 * error: `updateCustomerNotes` lo convierte a `null` antes de escribir.
 */
export const customerNotesSchema = z.string().trim().max(2000, 'La nota es demasiado larga (máximo 2000 caracteres)')

/**
 * Fila cruda de un cliente dentro del `jsonb` de `store_customer_directory`.
 * Las claves ya vienen en camelCase (la RPC las arma a mano con
 * `jsonb_build_object`) y coinciden una a una con `StoreCustomer`
 * (`src/models/types.ts`) — no hay mapeo, solo validación de que el borde no
 * tipado (`Returns: Json` en `database.types.ts`) cumple lo que promete.
 */
const storeCustomerRpcSchema = z.object({
  id: z.number().int(),
  storeId: z.number().int(),
  phoneE164: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  ordersCount: z.number().int(),
  totalSpentCents: z.number().int(),
  avgTicketCents: z.number().int(),
  cancelledOrdersCount: z.number().int(),
  firstOrderAt: z.string().nullable(),
  lastOrderAt: z.string().nullable(),
  daysSinceLastOrder: z.number().int().nullable(),
  marketingOptOutAt: z.string().nullable(),
  notes: z.string().nullable(),
})

/** Forma completa de `store_customer_directory(p_store_id)`. */
export const customerDirectoryRpcSchema = z.object({
  customers: z.array(storeCustomerRpcSchema),
  totals: z.object({
    customers: z.number().int(),
    withEmail: z.number().int(),
    inactive30: z.number().int(),
  }),
})
