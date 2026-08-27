import 'server-only'

import { cache } from 'react'
import { getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, lastFour } from '@/lib/crypto/secrets'
import { requireStoreMembership, listStoresForCurrentUser } from '@/models/store.model'
import type { Store } from '@/models/types'

/**
 * Sesión del panel de un local: quién es, qué tienda opera y con qué rol.
 *
 * `cache()` para que layout y cada page puedan pedirla de forma independiente
 * (piso de autorización: "cada page verifica membresía") sin duplicar el
 * round-trip a Postgres dentro del mismo request.
 */
export type AdminSession =
  | { status: 'unauthenticated' }
  | { status: 'no-store'; email: string }
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
  if (!store) return { status: 'no-store', email: user.email ?? '' }

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
