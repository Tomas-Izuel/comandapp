import 'server-only'

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apexUrl } from '@/lib/urls'
import { log } from '@/lib/log'
import { DomainError } from '@/lib/errors'
import { sendOwnerInviteEmail } from '@/services/notifications/email/owner-invite'
import {
  createStoreInputSchema,
  storeStatusSchema,
  type CreateStoreInput,
} from '@/models/schemas/platform.schema'
import type { AuditEntry, PlatformMetrics, PlatformStoreRow, StoreStatus } from '@/models/types'
import type { Database, Json } from '@/lib/supabase/database.types'

type AuditRow = Database['public']['Tables']['platform_audit_log']['Row']

/**
 * Fila cruda de la RPC `platform_stores` (snake_case, tal cual la arma
 * `row_to_json` en Postgres) → `PlatformStoreRow` del dominio.
 */
type PlatformStoreRpcRow = {
  id: number
  slug: string
  name: string
  description: string | null
  phone_e164: string | null
  whatsapp_phone_e164: string | null
  address: string | null
  timezone: string
  currency: string
  status: string
  accepting_orders: boolean
  in_store_payment_enabled: boolean
  online_payment_enabled: boolean
  transfer_payment_enabled: boolean
  min_order_cents: number
  demand_threshold_orders: number
  demand_multiplier: number | string
  auto_start_orders: boolean
  auto_ready_orders: boolean
  latitude: number | string | null
  longitude: number | string | null
  instagram_handle: string | null
  maps_url: string | null
  rappi_url: string | null
  pedidos_ya_url: string | null
  uber_eats_url: string | null
  delivery_enabled: boolean
  delivery_fee_cents: number
  delivery_free_from_cents: number
  delivery_min_order_cents: number
  delivery_minutes: number
  delivery_busy_minutes: number
  courier_collects_payment: boolean
  scheduled_delivery_enabled: boolean
  scheduled_capacity_per_night: number | null
  created_at: string
  owner_email: string | null
  orders_last_30: number
  revenue_last_30_cents: number
}

function toPlatformStoreRow(row: PlatformStoreRpcRow): PlatformStoreRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    phoneE164: row.phone_e164,
    whatsappPhoneE164: row.whatsapp_phone_e164,
    address: row.address,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status as StoreStatus,
    acceptingOrders: row.accepting_orders,
    inStorePaymentEnabled: row.in_store_payment_enabled,
    onlinePaymentEnabled: row.online_payment_enabled,
    transferPaymentEnabled: row.transfer_payment_enabled,
    minOrderCents: row.min_order_cents,
    demandThresholdOrders: row.demand_threshold_orders,
    // numeric(4,2) llega como string por el driver.
    demandMultiplier: Number(row.demand_multiplier),
    autoStartOrders: row.auto_start_orders,
    autoReadyOrders: row.auto_ready_orders,
    // numeric llega como string por el driver, igual que `demand_multiplier`.
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    links: {
      instagramHandle: row.instagram_handle,
      mapsUrl: row.maps_url,
      rappiUrl: row.rappi_url,
      pedidosYaUrl: row.pedidos_ya_url,
      uberEatsUrl: row.uber_eats_url,
    },
    delivery: {
      enabled: row.delivery_enabled,
      feeCents: row.delivery_fee_cents,
      freeFromCents: row.delivery_free_from_cents,
      minOrderCents: row.delivery_min_order_cents,
      minutes: row.delivery_minutes,
      busyMinutes: row.delivery_busy_minutes,
      courierCollects: row.courier_collects_payment,
    },
    // La sexta redefinición de `platform_stores` agregó estas dos. La función
    // enumera las columnas a mano: si no se agregan ahí Y acá, el backoffice
    // muestra toda tienda como "sin delivery programado y sin tope" sin un solo
    // error.
    scheduling: {
      deliveryEnabled: row.scheduled_delivery_enabled,
      capacityPerNight: row.scheduled_capacity_per_night,
    },
    ownerEmail: row.owner_email,
    ordersLast30: row.orders_last_30,
    revenueLast30Cents: row.revenue_last_30_cents,
    createdAt: row.created_at,
  }
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    ip: row.ip as string | null,
    userAgent: row.user_agent as string | null,
    createdAt: row.created_at,
  }
}

/**
 * Cuánto vive una sesión del backoffice, contada desde que se completó el
 * segundo factor.
 *
 * `[auth.sessions]` de Supabase es POR PROYECTO: un solo número para el staff
 * de los locales, los repartidores y el platform admin. El staff necesita
 * semanas (su única puerta es un magic link que hay que ir a buscar al mail
 * desde el mostrador), y quien puede suspender locales y ver la facturación de
 * toda la plataforma no puede tener eso. Como el ajuste no se puede separar por
 * rol allá, el límite corto del backoffice se aplica acá.
 */
const MAX_BACKOFFICE_SESSION_SECONDS = 12 * 60 * 60

/**
 * Marca el caso "tu sesión del backoffice cumplió las 12 horas", que es el
 * único fallo de `requirePlatformAdmin()` que se puede diagnosticar con
 * certeza — todos los demás llegan como "0 filas" y son indistinguibles entre
 * sí (ver el comentario de abajo).
 *
 * Existe como clase y no como un mensaje más porque el destino es distinto: el
 * resto va a `/backoffice/mfa`, y este tiene que ir a `/backoffice/login`. Una
 * sesión vencida por edad sigue siendo `aal2` para Supabase, así que mandarla a
 * la pantalla de MFA no arregla nada: lo que la renueva es un login nuevo, que
 * es lo que emite un `amr` nuevo.
 */
export class BackofficeSessionExpiredError extends DomainError {
  constructor() {
    super('Por seguridad, el backoffice cierra la sesión cada 12 horas. Ingresá de nuevo.', { status: 401 })
    this.name = 'BackofficeSessionExpiredError'
  }
}

/**
 * Cuándo se autenticó de verdad esta sesión, en segundos unix.
 *
 * Sale del claim `amr` (*authentication methods reference*) del JWT, que es un
 * array `[{ method, timestamp }]` con una entrada por factor usado. El
 * `timestamp` más nuevo es el momento en que se completó el TOTP.
 *
 * Se lee del token y no de `auth.sessions` a propósito: `getClaims()` valida la
 * firma localmente contra las claves públicas del proyecto, así que esto no
 * agrega un solo round trip a un chequeo que corre en cada page del backoffice.
 * Y `amr` se re-emite intacto en cada refresh —es para lo que existe—, así que
 * rotar el access token no rejuvenece la sesión.
 */
function authTimeFromClaims(claims: Record<string, unknown> | null | undefined): number | null {
  const amr = claims?.amr
  if (!Array.isArray(amr)) return null

  const timestamps = amr
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { timestamp?: unknown }).timestamp : null))
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))

  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

/**
 * Sesión de plataforma. RLS ya exige `aal2` dentro de `private.is_platform_admin()`,
 * así que una sesión de staff sin segundo factor ve 0 filas acá aunque el
 * usuario esté en `platform_admins`. Por eso "0 filas" alcanza como señal de
 * "no autorizado": no hace falta distinguir el motivo.
 *
 * `cache()` por el mismo motivo que `getCurrentUser()`: una page del backoffice
 * lo llama una vez para la guardia y después una vez por cada lectura que hace,
 * y sin memoizar eso son cuatro consultas a `platform_admins` por request.
 */
export const requirePlatformAdmin = cache(async (): Promise<{ userId: string; email: string }> => {
  const user = await getCurrentUser()
  if (!user) throw new Error('No hay una sesión activa')

  const supabase = await createClient()

  // El corte por edad va ANTES de la consulta: si la sesión ya está vencida no
  // tiene sentido preguntarle a Postgres si además es admin.
  //
  // Sin `amr` (un token viejo, o un proveedor que no lo emita) no se corta: el
  // fallback es dejar pasar y que decidan las RLS, porque el modo de falla
  // contrario —desloguear a todos los platform admins por un claim ausente— es
  // peor y encima se ve como "perdí el acceso", no como "se venció".
  const { data: claimsData } = await supabase.auth.getClaims()
  const authTime = authTimeFromClaims(claimsData?.claims)
  if (authTime !== null && Date.now() / 1000 - authTime > MAX_BACKOFFICE_SESSION_SECONDS) {
    throw new BackofficeSessionExpiredError()
  }

  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id, email')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo verificar el acceso: ${error.message}`)
  if (!data) throw new Error('No tenés acceso al backoffice de la plataforma')

  return { userId: data.user_id, email: data.email }
})

/**
 * `platform_metrics()` agrega en Postgres (A-01, A-09). Antes esto traía 30
 * días de `orders` crudos y sumaba en TypeScript: PostgREST corta cualquier
 * respuesta en `max_rows` (1000 filas por default) SIN error, así que la
 * facturación y el conteo de pedidos se truncaban en silencio apenas la
 * plataforma pasara ese volumen — justo cuando el negocio empezara a andar.
 *
 * Se llama con el cliente RLS (`createClient()`), no con el admin: la función
 * es `security definer` y valida `private.is_platform_admin()` (aal2 +
 * `platform_admins`) leyendo el JWT de la sesión. El cliente admin no manda
 * un JWT de usuario, así que la función rechazaría incluso a un admin real.
 *
 * También resuelve P-13: `order_is_billable()` en SQL excluye los `pending`
 * online sin pago aprobado, que antes se contaban como facturación.
 */
export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('platform_metrics')
  if (error) throw new Error(`No se pudieron leer las métricas: ${error.message}`)

  return data as unknown as PlatformMetrics
}

/**
 * `platform_stores()` reemplaza el N+1 a Auth que hacía esto antes: un
 * `auth.admin.getUserById` por dueño, EN SERIE, más el `max_rows` de
 * `orders` (A-01, A-09). El join contra `auth.users` para resolver el email
 * del dueño ahora vive en la función SQL, que sí puede leer ese schema.
 */
export async function listPlatformStores(): Promise<PlatformStoreRow[]> {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('platform_stores')
  if (error) throw new Error(`No se pudieron leer las tiendas: ${error.message}`)

  return ((data ?? []) as unknown as PlatformStoreRpcRow[]).map(toPlatformStoreRow)
}

/**
 * Detalle de UNA tienda. Antes no existía: `getStoreDetail` en el controller
 * traía la plataforma ENTERA (`listPlatformStores`) para quedarse con una fila
 * (A-09). `p_store_id` filtra en la función SQL.
 */
export async function getPlatformStoreById(storeId: number): Promise<PlatformStoreRow | null> {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('platform_stores', { p_store_id: storeId })
  if (error) throw new Error(`No se pudo leer la tienda: ${error.message}`)

  const rows = (data ?? []) as unknown as PlatformStoreRpcRow[]
  return rows[0] ? toPlatformStoreRow(rows[0]) : null
}

/**
 * La API admin de supabase-js no tiene "buscar por email": si `createUser`
 * falla porque ya existe, se pagina `listUsers` hasta encontrarlo. Con la base
 * de usuarios de un backoffice de plataforma (dueños de locales, no clientes)
 * esto es aceptable; si la base de usuarios creciera mucho convendría cachear
 * o pedirle a Supabase un filtro por email en la API admin.
 *
 * Pendiente de A-09 (fuera de este slice: no hay RPC para esto todavía): a
 * diferencia de las métricas y el listado, acá no hubo función SQL nueva
 * porque no hace falta leer `orders` — el costo es la paginación de
 * `listUsers`, no `max_rows`. Si la base de usuarios crece, hace falta un
 * filtro por email en la Admin API o una vista `private` sobre `auth.users`.
 */
async function findOrCreateUserByEmail(admin: SupabaseClient<Database>, email: string): Promise<string> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (!createError && created.user) return created.user.id

  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`No se pudo buscar el usuario dueño: ${error.message}`)

    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < perPage) break
  }

  throw new Error(createError?.message ?? 'No se pudo crear ni encontrar el usuario dueño')
}

/**
 * Link mágico de invitación, listo para mandar por mail.
 *
 * `generateLink` no envía nada — es la contraparte de `inviteUserByEmail`
 * que SÍ manda mail por el SMTP de Auth con la plantilla default de
 * Supabase. Este proyecto manda sus propios mails por la API de Resend con
 * plantillas propias (ver CLAUDE.md, "Dos clases de mail, dos mecanismos"),
 * así que `generateLink` es la única función de la Admin API que sirve acá.
 *
 * **Trampa verificada a mano contra el stack local** (no de memoria): pedir
 * `type: 'magiclink'` hace que Supabase devuelva `action_link` con
 * `type=magiclink` en la query (`properties.verification_type` también dice
 * `'magiclink'`) — NO `type=email`. Se podría suponer entonces que hay que
 * ampliar `SUPPORTED_OTP_TYPES` de `/admin/acceso/confirm/route.ts` con
 * `'magiclink'`. Pero probado contra el Auth local corriendo (crear usuario,
 * generar el link, y llamar `verifyOtp({ type: 'email', token_hash })` con
 * el `hashed_token` de esa respuesta) el login se completa igual: la
 * verificación en GoTrue no distingue `magiclink` de `email` para un token
 * de un solo uso recién emitido — `email` es el tipo unificado que
 * reemplaza a los viejos `signup`/`magiclink` (mismo comentario que ya tiene
 * `confirm/route.ts`), y sigue aceptando ambos nombres en la verificación
 * aunque el link generado por la Admin API todavía etiquete la acción con el
 * nombre viejo. Por eso la URL se arma acá con `type=email` a mano —
 * IGNORANDO el `type` que trae `action_link` — en vez de reusar
 * `properties.action_link` tal cual: así entra sin tocar
 * `SUPPORTED_OTP_TYPES`, que se queda angosto a propósito.
 */
async function generateOwnerInviteLink(admin: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) {
    throw new Error(`No se pudo generar el link de invitación: ${error?.message ?? 'error desconocido'}`)
  }

  // El panel del dueño vive en el apex siempre (00-architecture.md §1).
  const url = new URL(apexUrl('/admin/acceso/confirm'))
  url.searchParams.set('token_hash', data.properties.hashed_token)
  url.searchParams.set('type', 'email')
  return url.toString()
}

/**
 * Genera el link y lo manda. Nunca tira: la tienda (o, en el reenvío, nada)
 * ya existe cuando esto se llama, y que la invitación no salga no puede
 * romper esa transacción — mismo principio que el resto de los envíos de
 * mail del proyecto. Un fallo queda en el log estructurado, no en una
 * excepción que boya hasta el caller.
 */
async function sendOwnerInvite(admin: SupabaseClient<Database>, p: { storeId: number; storeName: string; ownerEmail: string }): Promise<void> {
  try {
    const inviteUrl = await generateOwnerInviteLink(admin, p.ownerEmail)
    const result = await sendOwnerInviteEmail({
      storeId: p.storeId,
      to: p.ownerEmail,
      storeName: p.storeName,
      inviteUrl,
    })
    if (result.status === 'failed') {
      log.error('platform.sendOwnerInvite', 'no se pudo mandar la invitación', undefined, {
        storeId: p.storeId,
        error: result.error,
      })
    }
  } catch (err) {
    log.error('platform.sendOwnerInvite', 'no se pudo generar ni mandar la invitación', err, { storeId: p.storeId })
  }
}

export async function createStoreWithOwner(
  input: CreateStoreInput,
  audit?: { ip?: string | null; userAgent?: string | null },
): Promise<{ storeId: number; ownerUserId: string }> {
  await requirePlatformAdmin()
  const parsed = createStoreInputSchema.parse(input)
  const admin = createAdminClient()

  const { data: storeRow, error: storeError } = await admin
    .from('stores')
    .insert({
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      phone_e164: parsed.phoneE164,
      whatsapp_phone_e164: parsed.whatsappPhoneE164,
      address: parsed.address,
      timezone: parsed.timezone,
      currency: parsed.currency,
    })
    .select('id')
    .single()

  if (storeError || !storeRow) {
    throw new Error(`No se pudo crear la tienda: ${storeError?.message ?? 'error desconocido'}`)
  }

  let ownerUserId: string
  try {
    const { error: brandingError } = await admin.from('store_branding').insert({ store_id: storeRow.id })
    if (brandingError) throw new Error(brandingError.message)

    ownerUserId = await findOrCreateUserByEmail(admin, parsed.ownerEmail)

    const { error: memberError } = await admin
      .from('store_members')
      .insert({ store_id: storeRow.id, user_id: ownerUserId, role: 'owner' })
    if (memberError) throw new Error(memberError.message)

    await recordAudit({
      action: 'store.created',
      targetType: 'store',
      targetId: String(storeRow.id),
      payload: { slug: parsed.slug, name: parsed.name, ownerEmail: parsed.ownerEmail },
      ip: audit?.ip,
      userAgent: audit?.userAgent,
    })
  } catch (err) {
    // No dejar una tienda a medio crear (sin branding o sin dueño asignado).
    await admin.from('stores').delete().eq('id', storeRow.id)
    throw err instanceof Error ? new Error(`No se pudo crear la tienda: ${err.message}`) : err
  }

  // Deliberadamente FUERA del try/catch de arriba: acá la tienda ya quedó
  // bien creada (branding + dueño + auditoría), así que un fallo de mail no
  // puede disparar el rollback que la borra. `sendOwnerInvite` además nunca
  // tira sola, pero la posición es la que hace la garantía obvia sin
  // depender de leer esa función.
  await sendOwnerInvite(admin, { storeId: storeRow.id, storeName: parsed.name, ownerEmail: parsed.ownerEmail })

  return { storeId: storeRow.id, ownerUserId }
}

export async function setStoreStatus(
  storeId: number,
  status: StoreStatus,
  audit?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await requirePlatformAdmin()
  const parsedStatus = storeStatusSchema.parse(status)

  // S-01: `stores.status` está revocado por columna para `authenticated` (el
  // grant por columna de la migración de hardening deja afuera `status` y
  // `slug` a propósito: son de la plataforma). El cliente RLS de acá
  // rechazaría el UPDATE con `permission denied` — hace falta el cliente
  // admin, ya detrás de `requirePlatformAdmin()`.
  const admin = createAdminClient()
  const { data, error } = await admin.from('stores').update({ status: parsedStatus }).eq('id', storeId).select('id')
  if (error) throw new Error(`No se pudo actualizar el estado de la tienda: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No se encontró la tienda')

  await recordAudit({
    action: 'store.status_changed',
    targetType: 'store',
    targetId: String(storeId),
    payload: { status: parsedStatus },
    ip: audit?.ip,
    userAgent: audit?.userAgent,
  })
}

/**
 * Reenvío explícito desde el detalle de la tienda. A diferencia de
 * `sendOwnerInvite` (el que dispara `createStoreWithOwner`, que nunca tira
 * porque un mail que no sale no puede deshacer una tienda ya creada), acá
 * SÍ hay que avisarle a quien apretó el botón si no salió — quedarse
 * calladito y mostrar "invitación reenviada" cuando en realidad no había
 * `RESEND_API_KEY` sería peor que el botón de copiar link que reemplaza.
 */
export async function resendOwnerInvite(
  storeId: number,
  audit?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await requirePlatformAdmin()

  const store = await getPlatformStoreById(storeId)
  if (!store) throw new DomainError('No se encontró la tienda', { status: 404 })
  if (!store.ownerEmail) throw new DomainError('Esta tienda todavía no tiene un dueño asignado', { status: 400 })

  const admin = createAdminClient()
  const inviteUrl = await generateOwnerInviteLink(admin, store.ownerEmail)
  const result = await sendOwnerInviteEmail({
    storeId,
    to: store.ownerEmail,
    storeName: store.name,
    inviteUrl,
  })

  if (result.status !== 'sent') {
    throw new DomainError(result.error ?? 'No se pudo mandar la invitación. Probá de nuevo en un momento.')
  }

  await recordAudit({
    action: 'store.owner_invited',
    targetType: 'store',
    targetId: String(storeId),
    payload: { ownerEmail: store.ownerEmail },
    ip: audit?.ip,
    userAgent: audit?.userAgent,
  })
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('platform_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`No se pudo leer la auditoría: ${error.message}`)
  return (data ?? []).map(toAuditEntry)
}

/**
 * `platform_audit_log` no tiene policy de INSERT para `authenticated` a
 * propósito (solo `service_role` escribe), así que esto usa `admin` aunque
 * quien dispara la acción esté logueado. El actor se resuelve desde la sesión
 * real, no desde lo que mande el caller.
 *
 * `ip`/`userAgent` (S-14): antes `ip` era opcional y NINGÚN caller lo pasaba,
 * y `user_agent` ni estaba en la firma. Para un backoffice que puede
 * suspender un local ajeno, la IP y el user agent son lo primero que se pide
 * en un incidente. Los llena `platform.actions.ts`, leyéndolos de `headers()`
 * (`x-forwarded-for`, `user-agent`) — acá no se puede: `recordAudit` no
 * necesariamente corre en el mismo request que originó la acción.
 */
export async function recordAudit(e: {
  action: string
  targetType?: string
  targetId?: string
  payload?: Record<string, unknown>
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const user = await getCurrentUser()

  const admin = createAdminClient()
  const { error } = await admin.from('platform_audit_log').insert({
    actor_user_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    action: e.action,
    target_type: e.targetType ?? null,
    target_id: e.targetId ?? null,
    payload: (e.payload ?? {}) as Json,
    ip: e.ip ?? null,
    user_agent: e.userAgent ?? null,
  })

  if (error) throw new Error(`No se pudo registrar la auditoría: ${error.message}`)
}
