import 'server-only'

import { redirect } from 'next/navigation'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/models/platform.model'
import type { ActionResult } from '@/models/types'

/**
 * Guardias de sesión del backoffice de plataforma.
 *
 * La lectura (`getPlatformMetrics`, `listPlatformStores`, `getPlatformStoreById`,
 * `listAudit`) y la escritura (`createStoreWithOwner`, `setStoreStatus`) viven
 * directo en `@/models/platform.model` — las pages y `platform.actions.ts` las
 * importan de ahí. Este archivo ya NO reexporta esas cuatro lecturas: eran
 * `return model()` sin absolutamente nada encima (ni `cache`, ni composición,
 * ni transformación), la indirección sin valor que CLAUDE.md prohíbe (A-08).
 * Lo que queda acá SÍ aporta algo que el model no puede: resolver sesión y
 * decidir a dónde redirigir cuando falta.
 *
 * Ninguna reimplementa autorización: todo pasa siempre por
 * `requirePlatformAdmin()` adentro del model, que a su vez depende de que
 * Postgres vea `aal2` en el JWT. Acá solo se traduce el resultado a dónde
 * mandar al browser.
 */

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

export type BackofficeIdentity = { email: string }

/**
 * Guardia de las rutas autenticadas del backoffice (todo menos /login y /mfa).
 *
 * Si `requirePlatformAdmin` falla no hay forma de saber con certeza el motivo:
 * leer `platform_admins` YA exige `aal2` en las RLS, así que "no sos admin" y
 * "sos admin pero todavía estás en aal1" se ven exactamente igual (0 filas).
 * `mfa.listFactors()` sí se puede leer en aal1 porque es sobre el usuario
 * autenticado, no una lectura de tabla — es la única señal disponible para
 * distinguir "hay que enrolar" de "hay que loguearse de nuevo".
 */
export async function requireBackofficeSession(): Promise<BackofficeIdentity> {
  try {
    const { email } = await requirePlatformAdmin()
    return { email }
  } catch {
    const user = await getCurrentUser()
    if (!user) redirect('/backoffice/login')

    // `factors.totp` ya viene filtrado por Supabase a solo factores verificados.
    const supabase = await createClient()
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const hasVerifiedTotp = (factors?.totp.length ?? 0) > 0
    // Con TOTP enrolado pero igual bloqueado, el único camino es volver a
    // loguearse: ahí se pide el código y recién ese flujo llega a aal2.
    redirect(hasVerifiedTotp ? '/backoffice/login' : '/backoffice/mfa')
  }
}

/**
 * `/backoffice/mfa` necesita sesión (para enrolar TOTP sobre ESE usuario) pero
 * no puede exigir `aal2` — es literalmente la pantalla que lo consigue. Si no
 * hay ningún usuario logueado, no hay nada que enrolar.
 */
export async function requireAuthenticatedUser(): Promise<{ userId: string; email: string | null }> {
  const user = await getCurrentUser()
  if (!user) redirect('/backoffice/login')
  return { userId: user.id, email: user.email ?? null }
}

/**
 * Usan esto `/backoffice/login` y `/backoffice/mfa`: si quien llega ya tiene
 * una sesión con `aal2`, no tiene sentido mostrarle el formulario de nuevo.
 *
 * `redirect()` lanza su propia excepción de control de flujo — por eso se
 * llama DESPUÉS del try/catch y no adentro: si estuviera adentro, el catch de
 * "no está autorizado" se comería también el redirect.
 */
export async function redirectIfAlreadyAuthorized(): Promise<void> {
  let authorized = false
  try {
    await requirePlatformAdmin()
    authorized = true
  } catch {
    authorized = false
  }
  if (authorized) redirect('/backoffice')
}

// ---------------------------------------------------------------------------
// Escritura (tipos)
// ---------------------------------------------------------------------------
//
// Las acciones en sí viven en `platform.actions.ts`: un archivo con
// `'use server'` no puede exportar nada que no sea una función async, así
// que el tipo de resultado se define acá y se importa desde allá.

export type CreateStoreResult = ActionResult<{ storeId: number }>
