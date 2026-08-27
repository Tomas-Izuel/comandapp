import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env.server'
import type { Database } from './database.types'

/**
 * Cliente para lecturas PÚBLICAS y cacheables.
 *
 * Es el mismo alcance que `anon` en el browser: respeta RLS y solo ve el
 * catálogo de tiendas activas. La diferencia con `server.ts` es que NO toca
 * `cookies()`.
 *
 * Eso es exactamente lo que lo hace útil: `'use cache'` no puede envolver una
 * función que lea cookies, porque el resultado dependería de la request. Todo el
 * storefront anónimo usaba el cliente con cookies, así que cada page view
 * renderizaba y consultaba desde cero aunque el menú de una hamburguesería
 * cambie dos veces por semana.
 *
 * NO usar para nada de staff ni de backoffice: sin sesión, esas policies
 * devuelven cero filas y el bug se ve como "no hay datos" en vez de como un
 * error de permisos.
 *
 * Es singleton: el cliente no guarda estado por request (`persistSession: false`),
 * así que crear uno nuevo por llamada era solo trabajo.
 */
let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createPublicClient() {
  if (cached) return cached

  const env = serverEnv()
  cached = createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  return cached
}
