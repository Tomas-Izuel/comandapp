import 'server-only'

import { resolveAdminSession } from '@/controllers/admin.controller'
import { listStoreCouriers } from '@/models/courier.model'
import type { CourierRow } from '@/models/types'

/**
 * Sesión de `/admin/repartidores`: además de resolver la tienda (como
 * `resolveAdminSession`), gatea por rol y trae el listado en la misma
 * llamada. Esto SÍ orquesta (sesión + gate de rol + lectura), a diferencia de
 * un reenvío liso a `listStoreCouriers` — por eso vive en un controller y no
 * se llama directo desde la page.
 *
 * `courierCollects` y `currency` viajan junto con `couriers` porque la vista
 * los necesita para decidir, por repartidor, si mostrar plata: no alcanza con
 * el flag de la tienda solo, porque un local que apagó el cobro en la puerta
 * puede tener repartidores con historial cobrado de cuando estaba prendido
 * (mismo criterio que ya aplica el portal del repartidor en `courier_queue`).
 * Sin `currency` acá, la vista tendría que hardcodear 'ARS' — una mentira en
 * un producto multi-tienda.
 */
export type StaffSession =
  | { status: 'unauthenticated' }
  | { status: 'no-store'; email: string }
  /** Logueado, con tienda, pero no es el dueño: esta sección no es suya. */
  | { status: 'forbidden' }
  | { status: 'ok'; storeId: number; couriers: CourierRow[]; courierCollects: boolean; currency: string }

export async function resolveStaffSession(): Promise<StaffSession> {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') return session
  if (session.role !== 'owner') return { status: 'forbidden' }

  const couriers = await listStoreCouriers(session.store.id)
  return {
    status: 'ok',
    storeId: session.store.id,
    couriers,
    courierCollects: session.store.delivery.courierCollects,
    currency: session.store.currency,
  }
}
