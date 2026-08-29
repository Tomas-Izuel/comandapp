import 'server-only'

import { cache } from 'react'
import { getCurrentUser } from '@/lib/supabase/server'
import { getCourierQueue } from '@/models/dispatch.model'
import { findCourierMembership } from '@/models/courier.model'
import type { CourierSession } from '@/models/types'

/**
 * Sesión del portal del repartidor: quién es y su cola de entregas.
 *
 * Espeja `resolveAdminSession` (`admin.controller.ts`): mismo `cache()` por
 * request, mismo motivo — `layout.tsx` (si en algún momento la necesita) y
 * `page.tsx` no tienen por qué pagar dos round-trips por la misma respuesta.
 *
 * No hay un tercer estado de "desactivado": `findCourierMembership()` colapsa
 * "nunca fue repartidor de ningún local" y "lo dieron de baja" en el mismo
 * `null` a propósito (ver el comentario de esa función en
 * `courier.model.ts`) — decirle a alguien dado de baja "ya no sos repartidor
 * acá" en vez de "no encontramos tu acceso" no cambia lo que puede hacer, y
 * distinguirlos exigiría una fila que hoy no se guarda. `status: 'ok'` con
 * `orders: []` (repartidor recién invitado, todavía sin ningún pedido
 * asignado) es un estado de la COLA, no de la sesión: lo resuelve la vista
 * vacía de `DeliveryQueue`, no este controller.
 */
export const resolveCourierSession = cache(async (): Promise<CourierSession> => {
  const user = await getCurrentUser()
  if (!user) return { status: 'unauthenticated' }

  const membership = await findCourierMembership()
  if (!membership) return { status: 'not-a-courier', email: user.email ?? '' }

  const orders = await getCourierQueue()
  return { status: 'ok', email: user.email ?? '', courierName: membership.displayName, orders }
})
