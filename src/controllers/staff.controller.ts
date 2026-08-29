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
 */
export type StaffSession =
  | { status: 'unauthenticated' }
  | { status: 'no-store'; email: string }
  /** Logueado, con tienda, pero no es el dueño: esta sección no es suya. */
  | { status: 'forbidden' }
  | { status: 'ok'; storeId: number; couriers: CourierRow[] }

export async function resolveStaffSession(): Promise<StaffSession> {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') return session
  if (session.role !== 'owner') return { status: 'forbidden' }

  const couriers = await listStoreCouriers(session.store.id)
  return { status: 'ok', storeId: session.store.id, couriers }
}
