import 'server-only'

import { cache } from 'react'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, lastFour } from '@/lib/crypto/secrets'
import { requireStoreMembership, listStoresForCurrentUser } from '@/models/store.model'
import { getBankAccountForAdmin } from '@/models/store-bank-account.model'
import { hasBankAccountValidator } from '@/services/bank-validation'
import { getMaxPrepMinutes } from '@/models/catalog.model'
import { getStoreHoursData } from '@/models/store-hours.model'
import { findCourierMembership } from '@/models/courier.model'
import type { Store, StoreBankAccountAdmin, StoreSchedule } from '@/models/types'

/**
 * Sesión del panel de un local: quién es, qué tienda opera y con qué rol.
 *
 * `cache()` para que layout y cada page puedan pedirla de forma independiente
 * (piso de autorización: "cada page verifica membresía") sin duplicar el
 * round-trip a Postgres dentro del mismo request.
 *
 * `no-store.isCourier` distingue "nunca lo sumaron a ningún local" de "es
 * repartidor, pero de un portal distinto": ver el comentario en
 * `resolveAdminSession` sobre por qué esto se chequea acá y no se infiere de
 * que `store` haya salido vacío.
 */
export type AdminSession =
  | { status: 'unauthenticated' }
  | { status: 'no-store'; email: string; isCourier: boolean }
  | { status: 'ok'; email: string; store: Store; role: 'owner' | 'staff' }

export const resolveAdminSession = cache(async (): Promise<AdminSession> => {
  // `getCurrentUser()` (A-04): antes esto llamaba `auth.getUser()` (un
  // round-trip a Auth), después `listStoresForCurrentUser` lo volvía a llamar,
  // y `requireStoreMembership` una tercera vez. Los tres ahora comparten el
  // mismo resultado memoizado por request.
  const user = await getCurrentUser()
  if (!user) return { status: 'unauthenticated' }

  const stores = await listStoresForCurrentUser()
  const store = stores[0]
  if (!store) {
    // `private.is_store_member()` ya está endurecida a `role in ('owner',
    // 'staff')`, así que `listStoresForCurrentUser` (que depende de esa RLS)
    // ya devuelve `[]` para un repartidor sin que nadie lo pida acá. Confiar
    // solo en eso sería apoyar una defensa en el efecto lateral de OTRA
    // función — si mañana esa RLS se afloja por error, este gate se afloja
    // con ella sin que nadie lo note. Por eso se repite, explícito y directo
    // contra `findCourierMembership`, que no depende de esa policy.
    const courier = await findCourierMembership()
    return { status: 'no-store', email: user.email ?? '', isCourier: courier !== null }
  }

  const { role } = await requireStoreMembership(store.id)
  return { status: 'ok', email: user.email ?? '', store, role }
})

// ---------------------------------------------------------------------------
// Pagos — Mercado Pago
//
// `store_payment_credentials` no tiene grants para `authenticated` (a
// propósito: ver src/services/payments/mercadopago.adapter.ts), así que la
// única manera de leer o escribir ahí es con el cliente admin.
// `requireStoreMembership` hace acá el trabajo que en cualquier otra tabla
// haría RLS. (La acción que escribe estas credenciales vive en
// admin.actions.ts, detrás de `{ role: 'owner' }` — S-03.)
// ---------------------------------------------------------------------------

export type PaymentConnectionStatus = {
  connected: boolean
  isSandbox: boolean
  connectedAt: string | null
  accessTokenPreview: string | null
}

export async function getPaymentConnectionStatus(storeId: number): Promise<PaymentConnectionStatus> {
  await requireStoreMembership(storeId)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_payment_credentials')
    .select('access_token, is_sandbox, connected_at')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el estado de Mercado Pago: ${error.message}`)

  // S-08: el access_token vive cifrado (`encryptSecret`, ver admin.actions.ts).
  // Antes esto devolvía los últimos 4 caracteres del TEXTO GUARDADO —del
  // ciphertext, no del token— y el día que se cifrara el preview se habría
  // roto en silencio. `decryptSecret` devuelve tal cual los valores de
  // tiendas conectadas antes del cifrado (texto plano), así que esto también
  // sigue funcionando para ellas sin migración de datos.
  const token = decryptSecret(data?.access_token ?? null)

  return {
    connected: Boolean(token),
    isSandbox: data?.is_sandbox ?? true,
    connectedAt: data?.connected_at ?? null,
    accessTokenPreview: token ? `•••• ${lastFour(token)}` : null,
  }
}

// ---------------------------------------------------------------------------
// Pagos — Cuenta bancaria (transferencia)
//
// `store_bank_accounts` no tiene ninguna policy de SELECT para
// `authenticated` (T0): la única manera de leer TODAS sus columnas es con el
// cliente admin. `requireStoreMembership` hace acá el mismo trabajo que hace
// para Mercado Pago, arriba. (Las acciones que escriben esta cuenta viven en
// `admin.actions.ts`, detrás de `{ role: 'owner' }` — mismo criterio que las
// credenciales de MP.)
// ---------------------------------------------------------------------------

export type BankAccountStatus = {
  account: StoreBankAccountAdmin | null
  /** Hay un proveedor de contraste configurado. Con `false` (el estado normal
   *  hoy — D0/D7), el panel ni muestra el botón de contraste: uno que nunca
   *  contesta es peor que no tenerlo. */
  validatorAvailable: boolean
}

export async function getBankAccountStatus(storeId: number): Promise<BankAccountStatus> {
  await requireStoreMembership(storeId)
  const account = await getBankAccountForAdmin(storeId)
  return { account, validatorAvailable: hasBankAccountValidator() }
}

/**
 * El resultado de contrastar EN VIVO mientras el dueño carga el formulario
 * (`lookupBankHolderAction`, `admin.actions.ts`).
 *
 * NO lleva `holderName`, y es deliberado (00-architecture.md §3.5): cuando el
 * resultado es `mismatch`, la cuenta puede ser de otra persona, y devolverle
 * ese nombre al browser del dueño sería divulgar el dato personal de un
 * tercero. El veredicto solo alcanza: "el CUIT de esa cuenta no coincide con
 * el que cargaste" ya le dice al dueño exactamente lo que tiene que revisar.
 */
export type BankHolderProbe = {
  /** Hubo proveedor Y contestó con algo. */
  available: boolean
  match: 'match' | 'mismatch' | 'unavailable'
  /** Derivado OFFLINE por `bankNameForCbu` — nunca del proveedor. */
  bankName: string | null
  /** El CBU que resolvió el proveedor a partir de un alias. `null` si se buscó directo por CBU. */
  resolvedCbu: string | null
}

// ---------------------------------------------------------------------------
// Confirmación por código de los cambios que tocan plata
//
// Estos dos viven acá y no en `admin.actions.ts` porque un archivo con
// `'use server'` solo puede exportar funciones async: ni tipos, ni schemas, ni
// constantes. Las acciones los importan desde este lado.
// ---------------------------------------------------------------------------

/**
 * Exactamente 6 dígitos.
 *
 * El `trim()` y el reemplazo de espacios no son cosmética: el código llega
 * pegado desde el mail, y en mobile la selección se lleva un espacio de más
 * más veces de las que uno cree. Rechazarlo por eso es hacerle perder un
 * intento de los cinco a alguien que puso el código correcto.
 */
export const confirmationCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'El código son 6 dígitos'))

/**
 * Lo que devuelve pedir un cambio sensible: el id de la solicitud (para
 * confirmarla) y a qué casilla salió el código, enmascarada.
 *
 * `sentTo` va enmascarado y no completo porque esta pantalla la puede estar
 * mirando alguien parado al lado de la caja. Alcanza para que el dueño
 * reconozca su casilla.
 */
export type PendingChangeStarted = { requestId: number; sentTo: string }

// ---------------------------------------------------------------------------
// Horarios de apertura — editor de Ajustes
//
// `getStoreHoursData` en sí es de lectura pública (RLS pública, igual que la
// vitrina), pero esto sí exige membresía: es el camino del PANEL, y sumarle el
// prep_minutes más lento del catálogo (dato interno del local) no tiene
// sentido ofrecerlo a un storeId ajeno solo porque las tablas subyacentes son
// legibles.
// ---------------------------------------------------------------------------

export type StoreScheduleAdmin = {
  schedule: StoreSchedule
  /** El `prep_minutes` más alto real de la carta: insumo de la advertencia
   *  "se aceptan pedidos hasta las X, tu producto más lento sale Y" que arma
   *  `lastOrderWarning()` (`src/lib/store-hours.ts`) — la compone la vista con
   *  el `timezone` de la sesión, no este controller. */
  maxPrepMinutes: number
}

export async function getStoreScheduleForAdmin(storeId: number): Promise<StoreScheduleAdmin> {
  await requireStoreMembership(storeId)
  const [schedule, maxPrepMinutes] = await Promise.all([getStoreHoursData(storeId), getMaxPrepMinutes(storeId)])
  return { schedule, maxPrepMinutes }
}
