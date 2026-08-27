'use client'

import { createBrowserClient } from '@supabase/ssr'
import { clientEnv } from '@/lib/env.client'
import type { Database } from './database.types'

/**
 * Cliente para el browser. Usa la publishable key y respeta RLS.
 * Sirve para auth (login del staff) y para Realtime en el panel de cocina.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
