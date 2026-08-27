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
  NEXT_PUBLIC_SITE_URL: z.url(),
})

const result = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
})

if (!result.success) {
  const missing = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Variables de entorno públicas inválidas:\n${missing}`)
}

export const clientEnv = result.data
