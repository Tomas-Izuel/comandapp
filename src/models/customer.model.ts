import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { customerDirectoryRpcSchema, customerNotesSchema, unsubscribeTokenSchema } from '@/models/schemas/customer.schema'
import type { CustomerDirectory, UnsubscribeTarget } from '@/models/types'

const CTX = 'customer.model'

/**
 * Padrón de clientes por tienda (T1A). Único lugar que habla con Postgres
 * para `store_customers`. La tabla no tiene un solo grant para `authenticated`
 * ni `anon` (`20260901120000_clientes.sql`): toda lectura va por RPC y toda
 * escritura por el cliente admin, con `store_id` explícito en cada `.eq()`.
 */

/**
 * Padrón completo de la tienda, vía `store_customer_directory`.
 *
 * OJO — trampa documentada en `CLAUDE.md` e idéntica a `store_couriers`: la
 * RPC es `SECURITY DEFINER` pero verifica `private.is_store_owner(p_store_id)`
 * leyendo `auth.uid()` del JWT de la request. Con el cliente ADMIN
 * (`service_role`, sin JWT de usuario) esa verificación no tiene con qué
 * comparar y la llamada falla siempre — por eso acá se usa el cliente de
 * SESIÓN. El permiso de "solo el dueño" lo exige el controller
 * (`customers.controller.ts`) antes de llamar a esta función; la RPC lo
 * vuelve a chequear adentro como defensa en profundidad, no como la única
 * barrera.
 *
 * El `jsonb` que devuelve la RPC es un `Json` sin tipar del lado de
 * TypeScript (`database.types.ts`), así que se valida con Zod antes de
 * confiar en él.
 */
export async function getCustomerDirectory(storeId: number): Promise<CustomerDirectory> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('store_customer_directory', { p_store_id: storeId })

  if (error) {
    // 42501 es el guard de `is_store_owner()` DENTRO de la RPC. No debería
    // llegar acá porque el controller ya exige `role: 'owner'` antes de
    // invocar este modelo, pero si alguna vez ese orden se rompe, el cliente
    // tiene que ver un error de dominio y no un código de Postgres crudo.
    if (error.code === '42501') {
      throw new DomainError('Solo el dueño del local puede ver el padrón de clientes', { status: 403 })
    }
    log.error(CTX, 'no se pudo leer el padrón de clientes', error, { storeId })
    throw new Error(`No se pudo leer el padrón de clientes: ${error.message}`)
  }

  const parsed = customerDirectoryRpcSchema.safeParse(data)
  if (!parsed.success) {
    log.error(CTX, 'store_customer_directory devolvió una forma inesperada', parsed.error, { storeId })
    throw new Error('El padrón de clientes llegó en un formato inesperado')
  }

  return parsed.data
}

/**
 * Nota interna del dueño sobre un cliente. Cadena vacía borra la nota
 * (`null`), no es un error: es la forma natural de "vaciar el campo" desde un
 * formulario.
 *
 * Cliente ADMIN porque `store_customers` no tiene grants para `authenticated`
 * (§5.11.2 del plan): la pregunta no es "qué grant falta" sino "el browser del
 * staff no debería poder tocar esta tabla directo". `.eq('store_id', storeId)`
 * explícito además del id: el aislamiento por tienda no se delega a que el id
 * que mandó el browser sea correcto.
 */
export async function updateCustomerNotes(storeId: number, customerId: number, notes: string): Promise<void> {
  const parsedNotes = customerNotesSchema.parse(notes)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_customers')
    .update({ notes: parsedNotes.length > 0 ? parsedNotes : null })
    .eq('id', customerId)
    .eq('store_id', storeId)
    .select('id')

  if (error) {
    log.error(CTX, 'no se pudo guardar la nota del cliente', error, { storeId })
    throw new Error(`No se pudo guardar la nota: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new DomainError('No se encontró ese cliente en esta tienda', { status: 404 })
  }
}

/**
 * Baja/alta de marketing hecha a mano por el dueño desde `/admin/clientes`
 * (distinta del token público de `/baja/[token]`, que pasa por
 * `optOutByToken`). Mismo criterio de cliente admin + `store_id` explícito
 * que `updateCustomerNotes`.
 */
export async function setCustomerOptOut(storeId: number, customerId: number, optedOut: boolean): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_customers')
    .update({ marketing_opt_out_at: optedOut ? new Date().toISOString() : null })
    .eq('id', customerId)
    .eq('store_id', storeId)
    .select('id')

  if (error) {
    log.error(CTX, 'no se pudo actualizar la baja de marketing', error, { storeId })
    throw new Error(`No se pudo actualizar la baja de marketing: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new DomainError('No se encontró ese cliente en esta tienda', { status: 404 })
  }
}

/**
 * Busca el cliente por el token de `/baja/[token]`. Nunca tira por "no
 * encontrado": un token que no matchea (vencido, mal copiado, o simplemente
 * inventado por alguien sondeando) es un caso esperado de un endpoint
 * público, no una falla.
 *
 * Valida la forma del token ANTES de tocar la base, mismo patrón que
 * `orderTokenSchema` en `order.model.ts`: no vale la pena consultar por algo
 * que no puede ser un token válido.
 */
export async function findCustomerByUnsubscribeToken(token: string): Promise<UnsubscribeTarget | null> {
  const parsed = unsubscribeTokenSchema.safeParse(token)
  if (!parsed.success) return null

  const admin = createAdminClient()
  // El embed a `stores` trae el nombre del LOCAL, que es lo que la página tiene
  // que mostrar: la baja es por tienda, así que sin ese dato el cliente estaría
  // confirmando a ciegas cuál de sus locales deja de escribirle.
  const { data, error } = await admin
    .from('store_customers')
    .select('marketing_opt_out_at, stores(name)')
    .eq('unsubscribe_token', parsed.data)
    .maybeSingle()

  if (error) {
    log.error(CTX, 'no se pudo buscar el cliente por token de baja', error)
    throw new Error(`No se pudo procesar la baja: ${error.message}`)
  }
  if (!data?.stores) return null

  return {
    storeName: data.stores.name,
    alreadyOptedOut: data.marketing_opt_out_at !== null,
  }
}

/**
 * La baja pública en sí. Idempotente a propósito (§5.12.2 del plan): darse de
 * baja dos veces no cambia nada y no es un error, porque un link de mail
 * puede abrirse más de una vez (reenvíos, el propio cliente, un escáner).
 *
 * Token inválido o inexistente no tira: el llamador (`unsubscribe.actions.ts`)
 * decide si eso es un 404 de cara al cliente. Acá "no hacer nada" y "listo,
 * ya estás afuera" son la misma respuesta observable, que es justo lo que un
 * endpoint que no autentica nada más que un token debe devolver.
 */
export async function optOutByToken(token: string): Promise<void> {
  const parsed = unsubscribeTokenSchema.safeParse(token)
  if (!parsed.success) return

  const admin = createAdminClient()
  const { error } = await admin
    .from('store_customers')
    // No pisa una baja ya registrada: conserva la fecha ORIGINAL en vez de
    // correrla a "ahora" cada vez que alguien reabre el mismo link.
    .update({ marketing_opt_out_at: new Date().toISOString() })
    .eq('unsubscribe_token', parsed.data)
    .is('marketing_opt_out_at', null)

  if (error) {
    log.error(CTX, 'no se pudo procesar la baja por token', error)
    throw new Error(`No se pudo procesar la baja: ${error.message}`)
  }
}
