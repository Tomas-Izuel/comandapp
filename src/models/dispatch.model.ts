import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { navigationUrlFor } from '@/lib/delivery'
import type { CourierOrder, CourierRow, OrderDeliveryAddress } from '@/models/types'

const CTX = 'dispatch'

/**
 * Despacho: asignar un pedido a un repartidor, y el avance de la entrega.
 *
 * Dos decisiones que ya estaban fijadas en el stub y que la implementación no
 * cambia:
 *
 * - `assignCourier` va con `createAdminClient()` detrás de un chequeo de permiso
 *   explícito del caller. `courier_id` no está en el `grant update` de `orders`
 *   —el browser del staff solo puede escribir `status`— así que el cliente RLS
 *   devolvería `permission denied`. Mismo patrón que `markPaidInStore`.
 * - Las otras dos van con el cliente RLS (`lib/supabase/server.ts`), NO con el
 *   admin: la identidad del repartidor la pone su propio JWT dentro de la RPC.
 *   Pasarlas por el admin sería darle acceso a los pedidos de cualquiera.
 */

/**
 * `courierId: null` desasigna. La invariante "es de esta tienda y está activo"
 * la valida el trigger `private.enforce_order_rules` — acá solo se traduce el
 * `check_violation` a un mensaje legible, nunca se reimplementa la regla.
 *
 * El `.eq('store_id', storeId)` en el UPDATE no es redundante con el trigger:
 * el trigger valida que el REPARTIDOR sea de esta tienda, pero no impide que
 * el admin client actualice un pedido de OTRA tienda si el caller le pasa un
 * `orderId` que no le pertenece. Ese filtro es lo que cierra esa puerta.
 */
export async function assignCourier(
  storeId: number,
  orderId: number,
  courierId: number | null,
): Promise<void> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('orders')
    .update({ courier_id: courierId })
    .eq('id', orderId)
    .eq('store_id', storeId)
    .select('id')
    .maybeSingle()

  if (error) {
    // 23514 = check_violation: el trigger rechazó un repartidor que no es
    // activo de ESTA tienda (o que ya no existe). El texto de Postgres no se
    // muestra tal cual —es de implementación—, se traduce a interfaz.
    if (error.code === '23514') {
      throw new DomainError('Ese repartidor no está disponible para esta tienda')
    }
    log.error(CTX, 'no se pudo asignar el repartidor', error, { storeId, orderId, courierId })
    throw new Error(`No se pudo asignar el repartidor: ${error.message}`)
  }

  if (!data) {
    throw new DomainError('No se encontró el pedido en esta tienda', { status: 404 })
  }
}

/** Fila cruda de la RPC `courier_queue` (camelCase tal cual la arma el `jsonb_build_object`/`jsonb_agg`). */
type CourierQueueRpcRow = {
  orderId: number
  shortCode: string
  status: 'ready' | 'on_the_way'
  storeName: string
  customerName: string
  customerPhoneE164: string
  addressLine: string | null
  addressUnit: string | null
  addressBetween: string | null
  addressNotes: string | null
  assignedAt: string
  collect: { subtotalCents: number; deliveryFeeCents: number; totalCents: number; currency: string } | null
}

/**
 * RPC `courier_queue`, con el cliente RLS. Devuelve solo los pedidos del
 * usuario logueado —el filtro por identidad vive en el cuerpo de la RPC, acá
 * no hay ningún `storeId` ni `userId` que pasar.
 */
export async function getCourierQueue(): Promise<CourierOrder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('courier_queue')

  if (error) {
    log.error(CTX, 'no se pudo leer la cola del repartidor', error)
    throw new Error(`No se pudo leer la cola de entregas: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as CourierQueueRpcRow[]
  return rows.map(toCourierOrder)
}

function toCourierOrder(row: CourierQueueRpcRow): CourierOrder {
  const address: OrderDeliveryAddress = {
    // La RPC solo puede devolver null si un pedido de delivery se coló sin
    // dirección, algo que un CHECK de Postgres ya impide. String vacío es un
    // fallback defensivo, no un camino esperado.
    line: row.addressLine ?? '',
    unit: row.addressUnit,
    between: row.addressBetween,
    notes: row.addressNotes,
  }

  return {
    orderId: row.orderId,
    shortCode: row.shortCode,
    status: row.status,
    storeName: row.storeName,
    customerName: row.customerName,
    customerPhoneE164: row.customerPhoneE164,
    address,
    // `courier_queue` no trae `stores.address`: sin ella `navigationUrlFor`
    // arma igual un link válido, solo pierde la desambiguación de ciudad.
    // Pedido de schema en el dev log: sumar `s.address as "storeAddress"` a
    // la RPC para que este link sea tan preciso como el que arma el checkout.
    navigationUrl: navigationUrlFor(address.line, null),
    assignedAt: row.assignedAt,
    collect: row.collect,
  }
}

/**
 * RPC `courier_advance_order`, con el cliente RLS. Solo acepta `on_the_way` y
 * `delivered` —lo valida el schema Y la RPC en el cuerpo, así que ni un
 * request armado a mano contra PostgREST puede pedir `cancelled`.
 */
export async function advanceAssignedOrder(input: {
  orderId: number
  status: 'on_the_way' | 'delivered'
  collected: boolean
}): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('courier_advance_order', {
    p_order_id: input.orderId,
    p_status: input.status,
    p_collected: input.collected,
  })

  if (error) {
    // 40001 = la RPC usa predicado de estado en el UPDATE: otro cambio (el
    // mostrador, u otro poll del mismo repartidor) pisó el pedido entre el
    // `for update` y el `update`. 42501 = el pedido no está asignado a este
    // repartidor (o dejó de estarlo).
    if (error.code === '40001') {
      throw new DomainError('El pedido cambió de estado justo ahora. Actualizá la pantalla e intentá de nuevo.', {
        status: 409,
      })
    }
    if (error.code === '42501') {
      throw new DomainError('Ese pedido no está asignado a vos')
    }
    log.error(CTX, 'no se pudo avanzar el pedido asignado', error, input)
    throw new Error(`No se pudo avanzar el pedido: ${error.message}`)
  }
}

/**
 * Repartidores de una tienda para el selector de asignación del KDS, con su
 * carga actual. Lo opera cualquier staff, no solo el dueño.
 *
 * La RPC `store_couriers` sería el camino obvio, pero exige `is_store_owner`
 * en el cuerpo —correcto para SU caso de uso, la gestión de repartidores
 * (invitar/dar de baja) en `courier.model.ts`, que es del dueño—. Forzarla
 * acá le daría un 42501 a cualquier staff que no sea dueño y que abra el KDS.
 *
 * En vez de eso, se lee `store_members` con el cliente RLS (la policy
 * `store_members_read` deja ver a cualquier miembro de la tienda, courier
 * incluido) y se cuenta la carga por separado contra `orders`, que el staff
 * también puede leer. Lo que este camino NO puede traer es `email` ni
 * `lastSignInAt`: viven en `auth.users`, fuera del alcance de PostgREST, y acá
 * no hace falta — el selector del KDS solo necesita nombre y carga, no el
 * padrón completo de repartidores.
 */
export async function listCouriersForAssignment(storeId: number): Promise<CourierRow[]> {
  const supabase = await createClient()

  const { data: members, error: membersError } = await supabase
    .from('store_members')
    .select('id, user_id, display_name, is_active, invited_at')
    .eq('store_id', storeId)
    .eq('role', 'courier')
    .order('display_name', { ascending: true })

  if (membersError) {
    log.error(CTX, 'no se pudo leer el padrón de repartidores', membersError, { storeId })
    throw new Error(`No se pudo leer los repartidores: ${membersError.message}`)
  }
  if (!members || members.length === 0) return []

  const courierIds = members.map((m) => m.id)
  const { data: openOrders, error: ordersError } = await supabase
    .from('orders')
    .select('courier_id, status')
    .eq('store_id', storeId)
    .in('courier_id', courierIds)
    .in('status', ['ready', 'on_the_way'])

  if (ordersError) {
    log.error(CTX, 'no se pudo contar la carga de los repartidores', ordersError, { storeId })
    throw new Error(`No se pudo calcular la carga de los repartidores: ${ordersError.message}`)
  }

  const assignedByCourier = new Map<number, number>()
  const onTheWayByCourier = new Map<number, number>()
  for (const row of openOrders ?? []) {
    if (row.courier_id === null) continue
    assignedByCourier.set(row.courier_id, (assignedByCourier.get(row.courier_id) ?? 0) + 1)
    if (row.status === 'on_the_way') {
      onTheWayByCourier.set(row.courier_id, (onTheWayByCourier.get(row.courier_id) ?? 0) + 1)
    }
  }

  return members.map((m) => ({
    id: m.id,
    userId: m.user_id,
    displayName: m.display_name ?? '',
    // No disponibles por este camino: ver el comentario de la función.
    email: '',
    lastSignInAt: null,
    isActive: m.is_active,
    invitedAt: m.invited_at,
    assignedOrders: assignedByCourier.get(m.id) ?? 0,
    onTheWayOrders: onTheWayByCourier.get(m.id) ?? 0,
  }))
}
