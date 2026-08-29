import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { serverEnv } from '@/lib/env.server'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { requireStoreMembership, getStoreById } from '@/models/store.model'
import { inviteCourierSchema, type InviteCourierInput } from '@/models/schemas/courier.schema'
import { sendCourierInviteEmail } from '@/services/notifications/email/courier-invite'
import type { CourierAvailability, CourierRow, InviteCourierResult } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

/**
 * El padrón de repartidores de una tienda: alta por invitación, baja lógica y
 * disponibilidad.
 *
 * Implementada acá salvo `getCourierAvailability`, que ya estaba resuelta por
 * la slice de precio/ETA.
 *
 * Reglas que la implementación NO puede cambiar:
 *
 * - Todo lo de gestión es del DUEÑO: `requireStoreMembership(storeId, { role: 'owner' })`.
 *   El resto de Ajustes lo puede tocar cualquier staff; esto no.
 * - Un repartidor se DESACTIVA, nunca se borra. `orders.courier_id` tiene
 *   `on delete set null`: borrar la fila pierde el rastro de quién llevó qué,
 *   que es parte de la contabilidad del local.
 * - La invitación copia el par de `platform.model.ts` (`findOrCreateUserByEmail`
 *   + `generateLink` + Resend). No se refactoriza a un módulo compartido ahora:
 *   eso crearía un archivo que dos slices quieren tocar al mismo tiempo.
 * - `inviteCourier` NO tira si el mail falla (un mail que no sale no puede
 *   deshacer un repartidor ya creado), pero devuelve `{ emailSent: false }`
 *   para que el llamador pueda ofrecer un reenvío en vez de mostrar éxito
 *   ciego; `resendCourierInvite` SÍ tira `DomainError`, porque el que apretó
 *   el botón tiene que enterarse. Mismo criterio que `sendOwnerInvite` /
 *   `resendOwnerInvite`.
 */

// -----------------------------------------------------------------------------
// Alta: usuario de Auth + link mágico (copiado de platform.model.ts a propósito,
// ver comentario de arriba).
// -----------------------------------------------------------------------------

async function findOrCreateUserByEmail(admin: SupabaseClient<Database>, email: string): Promise<string> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (!createError && created.user) return created.user.id

  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`No se pudo buscar el usuario del repartidor: ${error.message}`)

    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < perPage) break
  }

  throw new Error(createError?.message ?? 'No se pudo crear ni encontrar el usuario del repartidor')
}

/**
 * Link mágico de invitación, listo para mandar por mail.
 *
 * Mismo mecanismo que `generateOwnerInviteLink` (ver el comentario largo en
 * `platform.model.ts` sobre por qué se arma `type=email` a mano en vez de usar
 * `action_link` tal cual). La única diferencia es `next=/repartidor`: sin eso
 * el link aterriza en `/admin`, que un repartidor no puede ver (RLS lo deja
 * afuera — ver `private.is_store_member` endurecida). `isSafeRedirectPath` del
 * confirm handler ya sanitiza este parámetro.
 */
async function generateCourierInviteLink(admin: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) {
    throw new Error(`No se pudo generar el link de invitación: ${error?.message ?? 'error desconocido'}`)
  }

  const url = new URL('/admin/acceso/confirm', serverEnv().NEXT_PUBLIC_SITE_URL)
  url.searchParams.set('token_hash', data.properties.hashed_token)
  url.searchParams.set('type', 'email')
  url.searchParams.set('next', '/repartidor')
  return url.toString()
}

/**
 * Genera el link y lo manda. Nunca TIRA: el repartidor ya quedó dado de alta
 * en `store_members` cuando esto se llama, y que la invitación no salga no
 * puede deshacer esa fila — mismo principio que `sendOwnerInvite`.
 *
 * Pero devuelve si salió o no, en vez de tragarse el resultado entero: antes
 * `inviteCourier` no tenía forma de decir "se creó, pero el mail no salió", y
 * el dueño veía "invitado" sin que nadie se enterara del fallo real (el bug
 * de idempotencia de `courier-invite.tsx` era invisible por esto mismo). El
 * llamador decide qué hacer con el dato — hoy, exponerlo para que la UI
 * ofrezca "Reenviar invitación".
 */
async function sendCourierInviteNoThrow(
  admin: SupabaseClient<Database>,
  p: { courierId: number; storeId: number; storeName: string; courierName: string; email: string },
): Promise<boolean> {
  try {
    const inviteUrl = await generateCourierInviteLink(admin, p.email)
    const result = await sendCourierInviteEmail({
      courierId: p.courierId,
      to: p.email,
      storeName: p.storeName,
      courierName: p.courierName,
      inviteUrl,
    })
    if (result.status !== 'sent') {
      log.error('courier.invite', 'no se pudo mandar la invitación', undefined, {
        storeId: p.storeId,
        courierId: p.courierId,
        error: result.error,
      })
      return false
    }
    return true
  } catch (err) {
    log.error('courier.invite', 'no se pudo generar ni mandar la invitación', err, {
      storeId: p.storeId,
      courierId: p.courierId,
    })
    return false
  }
}

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

/**
 * Fila cruda de la RPC `store_couriers` (ya viene en camelCase: la función la
 * arma con `jsonb_agg` sobre columnas aliasadas a mano, ver
 * `20260828130000_delivery.sql`).
 */
type CourierRpcRow = CourierRow

/**
 * RPC `store_couriers`. Se llama con el cliente de SESIÓN (no el admin): la
 * función es `SECURITY DEFINER` pero verifica el permiso adentro con
 * `private.is_store_owner(p_store_id)`, que lee `auth.uid()` del JWT de la
 * request — con el cliente admin (`service_role`, sin JWT de usuario) esa
 * verificación no tiene con qué comparar y siempre falla.
 *
 * `requireStoreMembership` corre antes igual, para devolver un `DomainError`
 * legible en vez del `42501` crudo que tira la RPC si alguien la llama sin ser
 * dueño (defensa en profundidad, no la única barrera).
 */
export async function listStoreCouriers(storeId: number): Promise<CourierRow[]> {
  await requireStoreMembership(storeId, { role: 'owner' })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('store_couriers', { p_store_id: storeId })
  if (error) throw new Error(`No se pudieron leer los repartidores: ${error.message}`)

  return (data as unknown as CourierRpcRow[] | null) ?? []
}

// -----------------------------------------------------------------------------
// Alta
// -----------------------------------------------------------------------------

/**
 * Crea el usuario en Auth si no existe, lo suma como `courier` y le manda el
 * magic link a `/repartidor`.
 *
 * La escritura en `store_members` va con el cliente de SESIÓN, no el admin:
 * la policy `store_members_owner_manage` (`FOR ALL ... using is_store_owner`)
 * ya deja pasar exactamente esto, y usar RLS acá es la barrera real en vez de
 * un chequeo que solo vive en TypeScript. El cliente ADMIN se usa nada más
 * para lo que RLS no puede hacer: crear (o encontrar) el usuario en
 * `auth.users`, tabla que no tiene policies de aplicación.
 */
export async function inviteCourier(storeId: number, input: InviteCourierInput): Promise<InviteCourierResult> {
  await requireStoreMembership(storeId, { role: 'owner' })
  const parsed = inviteCourierSchema.parse(input)

  const store = await getStoreById(storeId)
  if (!store) throw new DomainError('No se encontró la tienda', { status: 404 })

  const admin = createAdminClient()
  const userId = await findOrCreateUserByEmail(admin, parsed.email)

  const supabase = await createClient()
  const { data: member, error } = await supabase
    .from('store_members')
    .insert({
      store_id: storeId,
      user_id: userId,
      role: 'courier',
      display_name: parsed.displayName,
      is_active: true,
      invited_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // 23505: `unique (store_id, user_id)` — ese email ya es parte de este
    // local (owner, staff o courier). No hay nada que "reintentar": es un
    // 409 legible, no un fallo nuestro.
    if (error.code === '23505') {
      throw new DomainError('Ese email ya es parte de este local.', { status: 409, field: 'email' })
    }
    throw new Error(`No se pudo crear el repartidor: ${error.message}`)
  }

  const emailSent = await sendCourierInviteNoThrow(admin, {
    courierId: member.id,
    storeId,
    storeName: store.name,
    courierName: parsed.displayName,
    email: parsed.email,
  })

  return { courierId: member.id, emailSent }
}

// -----------------------------------------------------------------------------
// Baja / alta lógica
// -----------------------------------------------------------------------------

/** Baja y alta lógica. Nunca borra la fila (ver comentario de cabecera). */
export async function setCourierActive(storeId: number, courierId: number, isActive: boolean): Promise<void> {
  await requireStoreMembership(storeId, { role: 'owner' })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('store_members')
    .update({ is_active: isActive })
    .eq('id', courierId)
    .eq('store_id', storeId)
    .eq('role', 'courier')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`No se pudo actualizar el repartidor: ${error.message}`)
  if (!data) throw new DomainError('No se encontró el repartidor', { status: 404 })
}

/**
 * Reenvío explícito desde el listado. A diferencia de `inviteCourier` (que
 * nunca tira porque el repartidor ya existe cuando se llama), acá SÍ hay que
 * avisarle a quien apretó el botón si no salió — mismo criterio que
 * `resendOwnerInvite`.
 */
export async function resendCourierInvite(storeId: number, courierId: number): Promise<void> {
  await requireStoreMembership(storeId, { role: 'owner' })

  const store = await getStoreById(storeId)
  if (!store) throw new DomainError('No se encontró la tienda', { status: 404 })

  const supabase = await createClient()
  const { data: member, error } = await supabase
    .from('store_members')
    .select('id, display_name, user_id')
    .eq('id', courierId)
    .eq('store_id', storeId)
    .eq('role', 'courier')
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el repartidor: ${error.message}`)
  if (!member || !member.display_name) throw new DomainError('No se encontró el repartidor', { status: 404 })

  const admin = createAdminClient()
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(member.user_id)
  if (userError || !userData.user?.email) {
    throw new DomainError('No se pudo reenviar la invitación: el repartidor no tiene un email asociado.')
  }

  const inviteUrl = await generateCourierInviteLink(admin, userData.user.email)
  const result = await sendCourierInviteEmail({
    courierId: member.id,
    to: userData.user.email,
    storeName: store.name,
    courierName: member.display_name,
    inviteUrl,
  })

  if (result.status !== 'sent') {
    throw new DomainError(result.error ?? 'No se pudo mandar la invitación. Probá de nuevo en un momento.')
  }
}

// -----------------------------------------------------------------------------
// Portal del repartidor
// -----------------------------------------------------------------------------

/**
 * La membresía `courier` del usuario logueado, para el gate del portal.
 *
 * Va con el cliente ADMIN a propósito: `store_members_read` exige
 * `private.is_store_member(store_id)`, y esa función quedó endurecida a
 * `role in ('owner','staff')` — un courier no puede leer ni siquiera SU
 * PROPIA fila con el cliente de sesión. No es un agujero: es la RLS
 * cumpliendo "un courier no entra a /admin" también para esta tabla. El
 * filtro de acá no viene del browser, viene del `user_id` que ya validó
 * Supabase Auth en la sesión del pedido, así que no es el caso que
 * `admin.ts` prohíbe (responder directo a un input del browser sin validar).
 *
 * Devuelve null si no es repartidor de ningún local, o si lo dieron de baja.
 */
export async function findCourierMembership(): Promise<{
  memberId: number
  storeId: number
  displayName: string
} | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_members')
    .select('id, store_id, display_name')
    .eq('user_id', user.id)
    .eq('role', 'courier')
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`No se pudo verificar la membresía de repartidor: ${error.message}`)
  if (!data || !data.display_name) return null

  return { memberId: data.id, storeId: data.store_id, displayName: data.display_name }
}

/**
 * Cuántos repartidores activos tiene el local y cuántos están libres.
 *
 * Va con el cliente ADMIN y no con el de sesión porque la llama el camino de
 * cotización del checkout, donde el cliente no está logueado. La RPC no tiene
 * grant a `authenticated` justamente por eso: no es un dato que el browser
 * pueda pedir por su cuenta.
 *
 * Implementada acá (y no como stub) porque la slice de precio/ETA la necesita y
 * no depende de nada de la slice de gestión de repartidores.
 */
export async function getCourierAvailability(storeId: number): Promise<CourierAvailability> {
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('store_courier_availability', { p_store_id: storeId })

  if (error) {
    log.error('courier.availability', 'no se pudo leer la disponibilidad de repartidores', error, { storeId })
    // Degradar a "sin repartidores" y no tirar: la cotización de un carrito no
    // puede romperse porque falló un conteo. Con 0 activos la opción delivery
    // queda deshabilitada con un motivo, que es el peor caso honesto.
    return { activeCouriers: 0, freeCouriers: 0 }
  }

  return data as unknown as CourierAvailability
}
