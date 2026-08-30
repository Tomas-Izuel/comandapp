import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import type { StoreHoursRange, StoreHoursOverride, StoreSchedule } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Lectura y escritura del calendario de un local.
 *
 * Las tablas (`store_hours`, `store_hours_overrides`) son de lectura pública
 * (RLS: `select` para `anon, authenticated` mientras la tienda esté activa) y
 * de escritura CERO para cualquier rol vía la tabla directa: toda escritura
 * pasa por una RPC `SECURITY DEFINER` que verifica `private.is_store_member()`
 * leyendo `auth.uid()`. Por eso las tres funciones de escritura de acá usan el
 * cliente de SESIÓN — con el admin client `auth.uid()` no existe y la RPC
 * falla siempre (mismo patrón que `store_couriers`).
 */

type StoreHoursRow = Database['public']['Tables']['store_hours']['Row']
type StoreHoursOverrideRow = Database['public']['Tables']['store_hours_overrides']['Row']

function toRange(row: StoreHoursRow): StoreHoursRange {
  return { dayOfWeek: row.day_of_week, opensAtMinute: row.opens_at_minute, durationMinutes: row.duration_minutes }
}

/**
 * Agrupa las filas de overrides por fecha: la tabla tiene una fila por RANGO
 * (igual que `store_hours`), así que una fecha con dos cortes son dos filas
 * con el mismo `on_date`. Una fecha cerrada es, por construcción de
 * `set_store_hours_override`, exactamente una fila con `is_closed = true` y
 * los minutos en `null` — el CHECK de la tabla lo garantiza.
 */
function groupOverrides(rows: StoreHoursOverrideRow[]): StoreHoursOverride[] {
  const byDate = new Map<string, StoreHoursOverrideRow[]>()
  for (const row of rows) {
    const list = byDate.get(row.on_date) ?? []
    list.push(row)
    byDate.set(row.on_date, list)
  }

  return Array.from(byDate.entries()).map(([date, dateRows]) => {
    const isClosed = dateRows.some((r) => r.is_closed)
    return {
      date,
      isClosed,
      // `opens_at_minute`/`duration_minutes` son NOT NULL cuando `is_closed`
      // es `false` (constraint `store_hours_overrides_shape_check`): el `??`
      // es solo para que TypeScript no se queje del tipo nullable de la
      // columna, nunca un valor que de verdad pueda faltar acá.
      ranges: isClosed
        ? []
        : dateRows.map((r) => ({ opensAtMinute: r.opens_at_minute ?? 0, durationMinutes: r.duration_minutes ?? 0 })),
    }
  })
}

export async function getStoreHoursData(storeId: number): Promise<StoreSchedule> {
  const supabase = await createClient()
  const [weekly, overrides] = await Promise.all([
    supabase
      .from('store_hours')
      .select('*')
      .eq('store_id', storeId)
      .order('day_of_week', { ascending: true })
      .order('opens_at_minute', { ascending: true }),
    supabase
      .from('store_hours_overrides')
      .select('*')
      .eq('store_id', storeId)
      .order('on_date', { ascending: true })
      .order('opens_at_minute', { ascending: true }),
  ])

  if (weekly.error) throw new Error(`No se pudo leer el horario semanal: ${weekly.error.message}`)
  if (overrides.error) throw new Error(`No se pudieron leer las excepciones de horario: ${overrides.error.message}`)

  return {
    weekly: (weekly.data ?? []).map(toRange),
    overrides: groupOverrides(overrides.data ?? []),
  }
}

/**
 * SQLSTATEs que las tres RPC de horarios usan para condiciones de NEGOCIO
 * (permiso, límites, solapamiento, forma del payload) — todo lo demás es un
 * fallo nuestro y no se le muestra al dueño tal cual.
 *
 * `42501` = permiso (`private.is_store_member` rechazó); `23514` =
 * `check_violation` (límites y solapamiento); `22023` = `invalid_parameter_value`
 * (forma del payload). Postgres devuelve el SQLSTATE numérico en
 * `error.code`, no el alias de texto que usa el `raise ... using errcode`.
 */
const HOURS_DOMAIN_ERROR_CODES = new Set(['42501', '23514', '22023'])

function translateHoursError(context: string, error: { code?: string | null; message: string }): Error {
  if (HOURS_DOMAIN_ERROR_CODES.has(error.code ?? '')) return new DomainError(error.message)
  return new Error(`${context}: ${error.message}`)
}

/** Reemplaza la semana ENTERA de una vez (`set_store_hours`): la RPC hace un
 *  `delete` + N `insert` transaccional para que un crash a mitad de camino no
 *  deje al local con la mitad de los rangos guardados. */
export async function setStoreHours(storeId: number, ranges: StoreHoursRange[]): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_store_hours', {
    p_store_id: storeId,
    p_ranges: ranges.map((r) => ({
      day_of_week: r.dayOfWeek,
      opens_at_minute: r.opensAtMinute,
      duration_minutes: r.durationMinutes,
    })),
  })
  if (error) throw translateHoursError('No se pudo guardar el horario', error)
}

/**
 * Guarda o borra el override de UNA fecha.
 *
 * `{ date, remove: true }` es un caso aparte y no `ranges: []` con
 * `isClosed: false`: esa combinación es justamente la que la RPC de guardado
 * rechaza ("una fecha abierta necesita al menos un rango"), así que borrar
 * necesita su propia RPC (`delete_store_hours_override`).
 */
export async function setStoreHoursOverride(
  storeId: number,
  override: StoreHoursOverride | { date: string; remove: true },
): Promise<void> {
  const supabase = await createClient()

  if ('remove' in override) {
    const { error } = await supabase.rpc('delete_store_hours_override', {
      p_store_id: storeId,
      p_on_date: override.date,
    })
    if (error) throw translateHoursError('No se pudo borrar la excepción de horario', error)
    return
  }

  const { error } = await supabase.rpc('set_store_hours_override', {
    p_store_id: storeId,
    p_on_date: override.date,
    p_is_closed: override.isClosed,
    p_ranges: override.isClosed
      ? []
      : override.ranges.map((r) => ({ opens_at_minute: r.opensAtMinute, duration_minutes: r.durationMinutes })),
  })
  if (error) throw translateHoursError('No se pudo guardar la excepción de horario', error)
}
