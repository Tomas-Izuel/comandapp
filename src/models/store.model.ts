import 'server-only'

import { cache } from 'react'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { toStore, type StoreRow } from '@/models/mappers/store.mapper'
import { DEFAULT_BRANDING, brandingSchema, type Branding } from '@/models/schemas/branding.schema'
import { storeSettingsInputSchema, type StoreSettingsInput } from '@/models/schemas/store.schema'
import type { Store, StoreWithBranding } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

type StoreBrandingRow = Database['public']['Tables']['store_branding']['Row']

/**
 * Fila de `store_branding` → `Branding`, re-validada con `brandingSchema`.
 *
 * CLAUDE.md decía "todo valor que termina en el <style> pasa por
 * brandingSchema", pero eso solo era cierto en la ESCRITURA: acá se casteaba
 * la fila tal cual (S-07). Lo que de hecho protegía la inyección de CSS eran
 * los CHECK de Postgres. Con `safeParse` + fallback, una fila vieja o fuera de
 * rango (por ejemplo, escrita antes de un CHECK más estricto) nunca llega
 * cruda al `<style>`: cae al branding por defecto en vez de romper el theming
 * de la tienda entera.
 */
function toBranding(row: StoreBrandingRow | null): Branding {
  if (!row) return DEFAULT_BRANDING

  const parsed = brandingSchema.safeParse({
    logo_url: row.logo_url,
    logo_dark_url: row.logo_dark_url,
    favicon_url: row.favicon_url,
    hero_image_url: row.hero_image_url,
    color_primary: row.color_primary,
    color_primary_foreground: row.color_primary_foreground,
    color_accent: row.color_accent,
    color_background: row.color_background,
    color_foreground: row.color_foreground,
    radius_rem: Number(row.radius_rem),
    density: row.density,
    font_heading: row.font_heading,
    font_body: row.font_body,
    theme_mode: row.theme_mode,
  })

  return parsed.success ? parsed.data : DEFAULT_BRANDING
}

/**
 * Trae tienda + branding en una sola query. Sirve tanto para el storefront
 * público (RLS: solo tiendas `active`) como para el staff logueado (RLS:
 * además ve la suya aunque esté `suspended`) — el filtro real vive en Postgres,
 * acá solo se arma la query.
 */
async function fetchStoreWithBranding(
  filter: { slug: string } | { id: number },
): Promise<StoreWithBranding | null> {
  const supabase = await createClient()
  let query = supabase.from('stores').select('*, store_branding(*)')
  query = 'slug' in filter ? query.eq('slug', filter.slug) : query.eq('id', filter.id)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`No se pudo leer la tienda: ${error.message}`)
  if (!data) return null

  const { store_branding, ...storeRow } = data
  const branding = Array.isArray(store_branding) ? (store_branding[0] ?? null) : store_branding

  return { ...toStore(storeRow as StoreRow), branding: toBranding(branding) }
}

/**
 * `cache()` por request: el storefront pide la tienda tres veces por page
 * view (metadata, layout, page) y todas piden exactamente lo mismo (A-04).
 */
export const getStoreBySlug = cache(async (slug: string): Promise<StoreWithBranding | null> => {
  return fetchStoreWithBranding({ slug })
})

export const getStoreById = cache(async (id: number): Promise<StoreWithBranding | null> => {
  return fetchStoreWithBranding({ id })
})

/**
 * Tiendas del staff logueado. Se filtra explícitamente por `store_members` en
 * vez de hacer `select * from stores`: la policy pública (`status = 'active'`)
 * y la de staff (`is_store_member`) son permisivas y se combinan con OR, así
 * que un select sin filtro devolvería TODAS las tiendas activas de la
 * plataforma, no solo las del usuario.
 */
export async function listStoresForCurrentUser(): Promise<Store[]> {
  const user = await getCurrentUser()
  if (!user) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('store_members')
    .select('stores(*)')
    .eq('user_id', user.id)

  if (error) throw new Error(`No se pudieron leer las tiendas del usuario: ${error.message}`)

  return (data ?? [])
    .map((row) => row.stores)
    .filter((store): store is StoreRow => store !== null)
    .map(toStore)
}

/**
 * Verifica que el usuario logueado sea staff de `storeId` y, si se pide,
 * específicamente el `owner`.
 *
 * `cache()` por `storeId` (y por `opts`, que participa de la clave): layout,
 * page y cada Server Action de una misma request preguntaban la membresía por
 * separado — dos o tres round-trips a Postgres para la misma respuesta
 * (A-04). Cachear por `opts` también evita que una llamada sin exigencia de
 * rol "contamine" una llamada posterior que sí la exige: son cache keys
 * distintas.
 *
 * `opts.role: 'owner'` es la guardia de S-03. La función siempre devolvía
 * `role`, pero nadie lo miraba: `savePaymentCredentialsAction` dejaba que
 * cualquier `staff` reemplazara el access token de Mercado Pago del local, y
 * el dueño no tenía forma de enterarse. Reemplazar la caja es la única acción
 * del panel que exige ser dueño — ver el comentario en `admin.actions.ts`
 * sobre por qué ajustes y apariencia NO lo exigen.
 */
export const requireStoreMembership = cache(
  async (storeId: number, opts?: { role: 'owner' }): Promise<{ userId: string; role: 'owner' | 'staff' }> => {
    const user = await getCurrentUser()
    if (!user) throw new Error('No hay una sesión activa')

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('store_members')
      .select('role')
      .eq('store_id', storeId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw new Error(`No se pudo verificar la membresía: ${error.message}`)
    if (!data) throw new Error('No sos parte del staff de esta tienda')

    // Un repartidor NO es staff, y este es el único cuello de botella por el
    // que pasan todas las pages y actions de /admin: cerrarlo acá los cubre a
    // todos de una.
    //
    // Hoy es inalcanzable —`private.is_store_member()` filtra por
    // `role in ('owner','staff')`, así que la lectura de arriba ni devuelve la
    // fila—, y por eso mismo hace falta: sin esto, aflojar esa RLS por error
    // convertiría a cada repartidor en staff del local sin que nada lo diga.
    // El cast de la línea siguiente era exactamente esa mentira.
    if (data.role === 'courier') {
      throw new DomainError('Los repartidores entran por /repartidor, no por el panel del local', { status: 403 })
    }

    const role = data.role as 'owner' | 'staff'
    if (opts?.role === 'owner' && role !== 'owner') {
      throw new DomainError('Esta acción es solo para el dueño del local', { status: 403 })
    }

    return { userId: user.id, role }
  },
)

export async function updateStoreSettings(storeId: number, input: StoreSettingsInput): Promise<void> {
  // Ajustes (nombre, horario, si acepta pedidos) son una decisión del
  // negocio, no de la caja: cualquier staff logueado puede tocarlos. Solo
  // pagos exige `{ role: 'owner' }` (S-03, ver admin.actions.ts).
  await requireStoreMembership(storeId)
  const parsed = storeSettingsInputSchema.parse(input)
  const supabase = await createClient()

  // "Las dos o ninguna" se normaliza acá en vez de con un `.refine()` sobre el
  // objeto: refinar convierte el schema en `ZodEffects` y ese tipo se propaga a
  // `zodResolver` y a cualquier `.shape`/`.pick()` del formulario. Media
  // coordenada no ubica nada, así que colapsarla a null es la respuesta
  // correcta y no hay nada que explicarle al dueño. El CHECK de Postgres sigue
  // siendo la garantía real.
  const hasCoordinates = parsed.latitude !== null && parsed.longitude !== null

  const { error } = await supabase
    .from('stores')
    .update({
      name: parsed.name,
      description: parsed.description,
      phone_e164: parsed.phoneE164,
      whatsapp_phone_e164: parsed.whatsappPhoneE164,
      address: parsed.address,
      timezone: parsed.timezone,
      currency: parsed.currency,
      accepting_orders: parsed.acceptingOrders,
      in_store_payment_enabled: parsed.inStorePaymentEnabled,
      min_order_cents: parsed.minOrderCents,
      demand_threshold_orders: parsed.demandThresholdOrders,
      demand_multiplier: parsed.demandMultiplier,
      auto_start_orders: parsed.autoStartOrders,
      auto_ready_orders: parsed.autoReadyOrders,
      latitude: hasCoordinates ? parsed.latitude : null,
      longitude: hasCoordinates ? parsed.longitude : null,
      instagram_handle: parsed.instagramHandle,
      maps_url: parsed.mapsUrl,
      rappi_url: parsed.rappiUrl,
      pedidos_ya_url: parsed.pedidosYaUrl,
      uber_eats_url: parsed.uberEatsUrl,
      delivery_enabled: parsed.deliveryEnabled,
      delivery_fee_cents: parsed.deliveryFeeCents,
      delivery_free_from_cents: parsed.deliveryFreeFromCents,
      delivery_min_order_cents: parsed.deliveryMinOrderCents,
      delivery_minutes: parsed.deliveryMinutes,
      delivery_busy_minutes: parsed.deliveryBusyMinutes,
      // `courier_collects_payment` NO se escribe acá a propósito: ver el
      // comentario en `storeSettingsInputSchema` (store.schema.ts). Ese campo
      // solo lo toca `confirmPendingChangeAction` con `createAdminClient()`
      // detrás del código de 6 dígitos — agregarlo de vuelta a este `.update()`
      // reabre el bypass que el candado de plata vino a cerrar.
    })
    .eq('id', storeId)

  if (error) throw new Error(`No se pudo actualizar la tienda: ${error.message}`)
}

export async function upsertBranding(storeId: number, input: Branding): Promise<void> {
  // Mismo criterio que ajustes: apariencia es decisión del negocio, no de la
  // caja. Cualquier staff logueado puede cambiarla (S-03).
  await requireStoreMembership(storeId)

  // S-07: la action llegaba a pasar `input` tal cual, sin este `parse`. Lo que
  // de hecho frenaba una inyección de CSS eran los CHECK de Postgres, no esto
  // — y CLAUDE.md afirmaba lo contrario. Estos valores terminan dentro de un
  // `<style>`, así que la validación acá no es cosmética.
  const parsed = brandingSchema.parse(input)
  const supabase = await createClient()

  const { error } = await supabase.from('store_branding').upsert(
    {
      store_id: storeId,
      logo_url: parsed.logo_url,
      logo_dark_url: parsed.logo_dark_url,
      favicon_url: parsed.favicon_url,
      hero_image_url: parsed.hero_image_url,
      color_primary: parsed.color_primary,
      color_primary_foreground: parsed.color_primary_foreground,
      color_accent: parsed.color_accent,
      color_background: parsed.color_background,
      color_foreground: parsed.color_foreground,
      radius_rem: parsed.radius_rem,
      density: parsed.density,
      font_heading: parsed.font_heading,
      font_body: parsed.font_body,
      theme_mode: parsed.theme_mode,
    },
    { onConflict: 'store_id' },
  )

  if (error) throw new Error(`No se pudo guardar el branding: ${error.message}`)
}
