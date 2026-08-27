import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/log'

/**
 * Callback de "Continuar con Google" para el backoffice de plataforma.
 * Server-side a propósito, igual que `/admin/acceso/confirm`: `@supabase/ssr`
 * guarda la sesión en cookies, y solo un Route Handler puede escribirlas en
 * la respuesta.
 *
 * A diferencia del magic link de `/admin` (que verifica un `token_hash` con
 * `verifyOtp`, ver ese archivo), OAuth pasa por el endpoint de Supabase
 * `/auth/v1/authorize` — signInWithOAuth redirige el browser ahí, no acá — y
 * ese endpoint es el que vuelve a este callback con un `code` de PKCE.
 * `exchangeCodeForSession` lo canjea por la sesión (doc de `@supabase/ssr`,
 * "Exchange PKCE code for session"). No hay `token_hash` que validar acá.
 *
 * Google es un PRIMER factor, igual que la contraseña: la sesión que deja
 * este intercambio queda en `aal1`. Por eso el éxito redirige a `/backoffice`
 * sin más — el layout de `(authenticated)` llama a `requireBackofficeSession()`
 * (`src/controllers/platform.controller.ts`), que exige `aal2` y manda a
 * `/backoffice/mfa` (sin TOTP enrolado) o de vuelta a `/backoffice/login` (con
 * TOTP enrolado, a completar el segundo factor). Redirigir a `/backoffice` y
 * dejar que ESE guard decida es reusar el único lugar que tiene el criterio,
 * no una copia de acá que se puede desincronizar si el original cambia.
 *
 * El primer login de Google SÍ puede crear el usuario (`enable_signup =
 * true`): quién puede registrarse lo filtra un hook `before_user_created` del
 * lado de Postgres (fuera de este archivo), no esta app. Este callback nunca
 * lee `platform_admins` ni asume que el usuario recién creado ya es admin —
 * eso también lo decide `requireBackofficeSession()` en la próxima request.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const providerError = searchParams.get('error')

  // El usuario canceló el consentimiento de Google, o Google devolvió un
  // error propio (`access_denied`, etc). Nunca llega `code` en ese caso.
  if (providerError) {
    return NextResponse.redirect(new URL('/backoffice/login?error=google_fallo', origin))
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL('/backoffice', origin))
    }

    // El hook `before_user_created` rechaza a un usuario de Google que no
    // está en la allowlist devolviendo `{"error": {"http_code": ..., "message": ...}}`
    // desde Postgres. GoTrue reenvía ESE `http_code` tal cual, pero sin
    // `error_code` propio (el campo queda vacío del lado del hook: ver
    // `internal/hooks/hookserrors/hookserrors.go` y `apierrors.HTTPError` en
    // el repo de supabase/auth) — así que `error.code` de supabase-js llega
    // `undefined`, nunca un string con nombre. Eso es lo que distingue "el
    // hook lo rechazó" (4xx sin `code`) de una falla técnica del intercambio
    // PKCE, que SÍ trae un `code` con nombre propio (`bad_code_verifier`,
    // `bad_oauth_state`, `flow_state_expired`, etc — ver
    // `internal/api/apierrors/errorcode.go`). No se puede discriminar por
    // mensaje: el texto exacto lo define quien escriba el hook.
    if (!error.code && typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
      return NextResponse.redirect(new URL('/backoffice/login?error=sin_acceso', origin))
    }

    log.error('backoffice/auth/callback', 'no se pudo canjear el code de Google por una sesión', error)
  }

  return NextResponse.redirect(new URL('/backoffice/login?error=google_fallo', origin))
}
