import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Callback del magic link. Server-side a propósito: `@supabase/ssr` guarda la
 * sesión en cookies, no en localStorage, así que el intercambio del token
 * tiene que pasar por un Route Handler que pueda escribir la respuesta —
 * hacerlo en un componente de cliente dejaría al servidor sin la sesión hasta
 * la siguiente navegación.
 *
 * Requiere que la plantilla de email "Magic Link" del proyecto de Supabase
 * apunte acá con `token_hash` y `type` (en vez del `{{ .ConfirmationURL }}`
 * default, que resuelve contra el propio dominio de Supabase). Configuración
 * de infraestructura, no de este código: ver Auth → Email Templates.
 *
 * `signup` y `magiclink` son el flujo viejo de GoTrue (dos columnas de token
 * separadas, `confirmation_token`/`recovery_token`). `email` es el tipo
 * unificado que los reemplaza — es el único que manda
 * `supabase/templates/magic-link.html` (`type=email` a mano, no el default de
 * Supabase) y el único acceso a /admin es magic link, así que es el único que
 * este endpoint necesita aceptar. Angostar la lista es angostar la superficie:
 * no hay motivo para que esta ruta sepa validar `recovery`/`invite`/
 * `email_change`, que no tienen ningún caller en el repo.
 *
 * Verificado a mano contra el Auth local: un `token_hash` de un link generado
 * con `admin.generateLink({ type: 'magiclink' })` (la invitación que empuja
 * el backoffice, `src/models/platform.model.ts`) también verifica con
 * `type: 'email'` acá, aunque `action_link`/`verification_type` en esa
 * respuesta digan `magiclink`. No hace falta sumar `'magiclink'` a
 * `SUPPORTED_OTP_TYPES`.
 */
const SUPPORTED_OTP_TYPES = ['email'] as const

/**
 * S-13: `next` viene del query string de un link que un atacante puede armar
 * (`?next=https://evil.tld` o `?next=//evil.tld`) y `new URL(next, origin)`
 * lo resuelve afuera del sitio sin chequeo. Solo rutas relativas de un único
 * nivel de "/": nada de esquema, nada de "//" (que el browser interpreta como
 * protocol-relative), nada de backslash (algunos parsers lo tratan como "/").
 */
function isSafeRedirectPath(next: string | null): next is string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextParam = searchParams.get('next')
  const next = isSafeRedirectPath(nextParam) ? nextParam : '/admin'

  const isSupportedType = (v: string | null): v is (typeof SUPPORTED_OTP_TYPES)[number] =>
    v !== null && (SUPPORTED_OTP_TYPES as readonly string[]).includes(v)

  if (tokenHash && isSupportedType(type)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  return NextResponse.redirect(new URL('/admin/acceso?error=link_invalido', origin))
}
