import 'server-only'

import { cache } from 'react'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, lastFour } from '@/lib/crypto/secrets'
import { requireStoreMembership, listStoresForCurrentUser } from '@/models/store.model'
import { findCourierMembership } from '@/models/courier.model'
import type { Store } from '@/models/types'

/**
 * Sesión del panel de un local: quién es, qué tienda opera y con qué rol.
 *
 * `cache()` para que layout y cada page puedan pedirla de forma independiente
 * (piso de autorización: "cada page verifica membresía") sin duplicar el
 * round-trip a Postgres dentro del mismo request.
 *
 * `no-store.isCourier` distingue "nunca lo sumaron a ningún local" de "es
 * repartidor, pero de un portal distinto": ver el comentario en
 * `resolveAdminSession` sobre por qué esto se chequea acá y no se infiere de
 * que `store` haya salido vacío.
 */
export type AdminSession =
  | { status: 'unauthenticated' }
  | { status: 'no-store'; email: string; isCourier: boolean }
  | { status: 'ok'; email: string; store: Store; role: 'owner' | 'staff' }

export const resolveAdminSession = cache(async (): Promise<AdminSession> => {
  // `getCurrentUser()` (A-04): antes esto llamaba `auth.getUser()` (un
  // round-trip a Auth), después `listStoresForCurrentUser` lo volvía a llamar,
  // y `requireStoreMembership` una tercera vez. Los tres ahora comparten el
  // mismo resultado memoizado por request.
  const user = await getCurrentUser()
  if (!user) return { status: 'unauthenticated' }

  const stores = await listStoresForCurrentUser()
  const store = stores[0]
  if (!store) {
    // `private.is_store_member()` ya está endurecida a `role in ('owner',
    // 'staff')`, así que `listStoresForCurrentUser` (que depende de esa RLS)
    // ya devuelve `[]` para un repartidor sin que nadie lo pida acá. Confiar
    // solo en eso sería apoyar una defensa en el efecto lateral de OTRA
    // función — si mañana esa RLS se afloja por error, este gate se afloja
    // con ella sin que nadie lo note. Por eso se repite, explícito y directo
    // contra `findCourierMembership`, que no depende de esa policy.
    const courier = await findCourierMembership()
    return { status: 'no-store', email: user.email ?? '', isCourier: courier !== null }
  }

  const { role } = await requireStoreMembership(store.id)
  return { status: 'ok', email: user.email ?? '', store, role }
})

// ---------------------------------------------------------------------------
// Pagos — Mercado Pago
//
// `store_payment_credentials` no tiene grants para `authenticated` (a
// propósito: ver src/services/payments/mercadopago.adapter.ts), así que la
// única manera de leer o escribir ahí es con el cliente admin.
// `requireStoreMembership` hace acá el trabajo que en cualquier otra tabla
// haría RLS. (La acción que escribe estas credenciales vive en
// admin.actions.ts, detrás de `{ role: 'owner' }` — S-03.)
// ---------------------------------------------------------------------------

export type PaymentConnectionStatus = {
  connected: boolean
  isSandbox: boolean
  connectedAt: string | null
  accessTokenPreview: string | null
}

export async function getPaymentConnectionStatus(storeId: number): Promise<PaymentConnectionStatus> {
  await requireStoreMembership(storeId)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_payment_credentials')
    .select('access_token, is_sandbox, connected_at')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el estado de Mercado Pago: ${error.message}`)

  // S-08: el access_token vive cifrado (`encryptSecret`, ver admin.actions.ts).
  // Antes esto devolvía los últimos 4 caracteres del TEXTO GUARDADO —del
  // ciphertext, no del token— y el día que se cifrara el preview se habría
  // roto en silencio. `decryptSecret` devuelve tal cual los valores de
  // tiendas conectadas antes del cifrado (texto plano), así que esto también
  // sigue funcionando para ellas sin migración de datos.
  const token = decryptSecret(data?.access_token ?? null)

  return {
    connected: Boolean(token),
    isSandbox: data?.is_sandbox ?? true,
    connectedAt: data?.connected_at ?? null,
    accessTokenPreview: token ? `•••• ${lastFour(token)}` : null,
  }
}

// ---------------------------------------------------------------------------
// Confirmación por código de los cambios que tocan plata
//
// Estos dos viven acá y no en `admin.actions.ts` porque un archivo con
// `'use server'` solo puede exportar funciones async: ni tipos, ni schemas, ni
// constantes. Las acciones los importan desde este lado.
// ---------------------------------------------------------------------------

/**
 * Exactamente 6 dígitos.
 *
 * El `trim()` y el reemplazo de espacios no son cosmética: el código llega
 * pegado desde el mail, y en mobile la selección se lleva un espacio de más
 * más veces de las que uno cree. Rechazarlo por eso es hacerle perder un
 * intento de los cinco a alguien que puso el código correcto.
 */
export const confirmationCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'El código son 6 dígitos'))

/**
 * Lo que devuelve pedir un cambio sensible: el id de la solicitud (para
 * confirmarla) y a qué casilla salió el código, enmascarada.
 *
 * `sentTo` va enmascarado y no completo porque esta pantalla la puede estar
 * mirando alguien parado al lado de la caja. Alcanza para que el dueño
 * reconozca su casilla.
 */
export type PendingChangeStarted = { requestId: number; sentTo: string }
