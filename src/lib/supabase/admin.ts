import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env.server'
import type { Database } from './database.types'

/**
 * Cliente con la secret key: BYPASSEA RLS por completo.
 *
 * Usar solo donde no hay un usuario que autorice la operación:
 *   - crear pedidos (el cliente no está logueado)
 *   - buscar un pedido por public_token
 *   - webhook de Mercado Pago
 *   - leer store_payment_credentials
 *   - cron del outbox
 *
 * Nunca en respuesta directa a algo que mandó el browser sin validar antes.
 *
 * Es singleton: con `persistSession: false` el cliente no guarda nada por
 * request, así que instanciar uno nuevo en cada llamada —seis o más en un solo
 * `createOrder`— era trabajo puro. No viola `server-no-shared-module-state`
 * porque no hay estado de request que se pueda filtrar entre usuarios.
 */
let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createAdminClient() {
  if (cached) return cached

  const env = serverEnv()
  cached = createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
