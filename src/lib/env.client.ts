import { z } from 'zod'

/**
 * Variables que el browser puede ver.
 *
 * Los `NEXT_PUBLIC_` se inlinean en build time, así que hay que nombrarlos
 * explícitamente: `process.env[key]` dinámico no funciona en el bundle.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /**
   * El origen del APEX, siempre. Nunca el de una tienda: ver el mismo
   * comentario en `env.server.ts`. Duplicada a propósito entre los dos
   * schemas — ya lo estaba antes de este cambio.
   */
  NEXT_PUBLIC_SITE_URL: z.url(),
  /** Ver `env.server.ts`. Los dos schemas la necesitan: `src/lib/urls.ts` es
   * isomórfico (corre en server y en browser) y lee `clientEnv`. */
  NEXT_PUBLIC_STORE_HOST_MODE: z.enum(['subdomain', 'path']).default('path'),
})

const result = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_STORE_HOST_MODE: process.env.NEXT_PUBLIC_STORE_HOST_MODE,
})

if (!result.success) {
  const missing = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Variables de entorno públicas inválidas:\n${missing}`)
}

export const clientEnv = result.data
