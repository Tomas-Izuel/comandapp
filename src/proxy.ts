import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * En Next.js 16 el middleware se llama Proxy. Su único trabajo acá es refrescar
 * la sesión de Supabase para que las cookies no venzan mientras se navega.
 *
 * NO autoriza nada. La autorización real vive en las RLS de Postgres y se
 * verifica de nuevo en cada page y server action de /admin y /backoffice.
 * Un proxy es un chequeo optimista: nunca la única defensa.
 */
/**
 * No importamos `src/lib/env.server.ts` acá a propósito. Ese módulo trae
 * `import 'server-only'`, y ese marker distingue Server Components de Client
 * Components resolviendo por la condición de export `react-server` — algo que
 * el compilador de Proxy no garantiza (Proxy corre siempre en runtime Node.js,
 * pero es un target de build separado del de RSC; ni la doc de Next 16 ni el
 * código fuente confirman que herede esa condición). Si no la hereda,
 * `server-only` tira en cold start y se cae el proxy para **todo** el sitio.
 *
 * El chequeo de abajo persigue lo mismo (fallar fuerte y claro en vez de un
 * `undefined` que revienta más adelante) sin apostar el sitio entero a un
 * detalle de bundling no documentado.
 */
function requiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Proxy: falta la variable de entorno ${name}. Sin ella no se puede refrescar la sesión de Supabase.`,
    )
  }
  return value
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getClaims() valida la firma del JWT localmente; no hace un round trip por
  // request como getUser(). Es lo recomendado para el proxy.
  await supabase.auth.getClaims()

  return response
}

export const config = {
  matcher: [
    /*
     * Todo menos assets estáticos e imágenes. El webhook de Mercado Pago y el
     * cron quedan afuera a propósito: no tienen sesión que refrescar.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
