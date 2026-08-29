import { z } from 'zod'

/**
 * Contratos de configuración de tienda (panel de admin → "Mi local").
 *
 * `status` NO está acá: lo maneja exclusivamente la plataforma
 * (`platform.model.ts` → `setStoreStatus`). El staff de un local nunca puede
 * reactivar o suspender su propia tienda.
 */

const e164 = z
  .string()
  .trim()
  .regex(/^\+\d{8,15}$/, 'Tiene que ser un teléfono en formato +54911...')
  .nullable()

/**
 * El formulario de admin manda `''` cuando el input de un link queda vacío,
 * y `z.url()` rechazaría eso como "no es una URL" — el dueño del local vería
 * un error por no haber cargado un dato opcional. Este preprocess corre ANTES
 * de la validación de URL y mapea `''` → `null`, que es lo que significa
 * "no cargó este link".
 */
const emptyToNull = (val: unknown) => (val === '' ? null : val)

/**
 * Mismo regex que `stores_instagram_handle_check` (migración
 * `20260828120200_store_links_brand_defaults.sql`), duplicado a propósito
 * —igual que `RESERVED_SLUGS`—: la base garantiza que no entre, el schema
 * hace que el mensaje se entienda en vez de un error de constraint de
 * Postgres.
 */
const instagramHandle = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._]{1,30}$/, 'Solo el usuario, sin @ ni la URL completa')
    .nullable(),
).default(null)

/** El mapa no se acota a un host —Google Maps, Apple Maps y acortadores propios son todos legítimos— pero sí exige https, mismo motivo que el CHECK. */
const mapsUrl = z.preprocess(
  emptyToNull,
  z
    .url('Tiene que ser una URL válida')
    .max(500, 'El link es demasiado largo')
    .refine((value) => value.startsWith('https://'), {
      error: 'El link del mapa tiene que empezar con https://',
    })
    .nullable(),
).default(null)

/**
 * Rappi, PedidosYa y Uber Eats SÍ acotan el host, a diferencia del mapa: cada
 * local tiene su propia ficha en esas apps y no hay forma de derivarla, pero
 * un botón que dice "Rappi" tiene que ir a rappi.com — si no, la página del
 * local termina publicando un link a cualquier lado con el logo de Rappi al
 * lado, y esa combinación es indistinguible de una estafa de phishing para
 * quien la ve. El regex es una copia literal del CHECK correspondiente.
 */
function deliveryAppUrl(hostRegex: RegExp, brand: string) {
  return z.preprocess(
    emptyToNull,
    z
      .url('Tiene que ser una URL válida')
      .max(500, 'El link es demasiado largo')
      .refine((value) => hostRegex.test(value), {
        error: `Tiene que ser un link de ${brand}`,
      })
      .nullable(),
  ).default(null)
}

const rappiUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*rappi\.com(\.[a-z]{2})?(\/|$)/, 'Rappi')
const pedidosYaUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*pedidosya\.com(\.[a-z]{2})?(\/|$)/, 'PedidosYa')
const uberEatsUrl = deliveryAppUrl(/^https:\/\/([a-zA-Z0-9-]+\.)*ubereats\.com(\/|$)/, 'Uber Eats')

export const storeSettingsInputSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(120),
  description: z.string().trim().max(500).nullable().default(null),
  phoneE164: e164.default(null),
  whatsappPhoneE164: e164.default(null),
  address: z.string().trim().max(200).nullable().default(null),
  timezone: z.string().trim().min(1).max(60).default('America/Argentina/Buenos_Aires'),
  currency: z.string().trim().length(3).default('ARS'),

  acceptingOrders: z.boolean().default(true),
  inStorePaymentEnabled: z.boolean().default(false),

  minOrderCents: z.coerce.number().int().min(0).default(0),

  demandThresholdOrders: z.coerce.number().int().min(1).default(5),
  demandMultiplier: z.coerce.number().min(1).max(10).default(1.5),

  // Automatización de la cocina. Apagadas por defecto: un local que no opta se
  // comporta exactamente como antes. El barrido que las ejecuta vive en
  // `public.advance_auto_orders()`, no acá — esto es solo la preferencia.
  autoStartOrders: z.boolean().default(false),
  autoReadyOrders: z.boolean().default(false),

  // Coordenadas del local. Mismos rangos que los CHECK de
  // `20260828120400_store_coordinates.sql`, duplicados a propósito —igual que
  // `RESERVED_SLUGS`—: la base garantiza que no entre, el schema hace que el
  // mensaje se entienda. La regla "las dos o ninguna" también vive en los dos
  // lados, y acá se valida a nivel objeto porque cruza dos campos.
  latitude: z.coerce.number().min(-90).max(90).nullable().default(null),
  longitude: z.coerce.number().min(-180).max(180).nullable().default(null),

  // Envío propio. Ver StoreDelivery en types.ts.
  //
  // No hay campo de "cantidad de repartidores": la capacidad ES la cantidad de
  // repartidores activos que el dueño invitó, y vive en `store_members`. Un
  // número manual al lado de una lista real se desincroniza el primer día.
  //
  // Tampoco hay validación cruzada `busyMinutes >= minutes`, a propósito: un
  // `.superRefine()` sobre el objeto le cambia el tipo de entrada al schema y
  // `zodResolver` deja de manejarlo igual. Y normalizar en silencio con un
  // `Math.max` sería pisarle al dueño un número que escribió con intención.
  // Queda como hint en el formulario.
  deliveryEnabled: z.boolean().default(false),
  deliveryFeeCents: z.coerce.number().int().min(0).default(0),
  deliveryFreeFromCents: z.coerce.number().int().min(0).default(0),
  deliveryMinOrderCents: z.coerce.number().int().min(0).default(0),
  deliveryMinutes: z.coerce.number().int().min(0).max(240).default(30),
  deliveryBusyMinutes: z.coerce.number().int().min(0).max(240).default(50),

  // `courierCollectsPayment` NO está acá, y la ausencia es a propósito: es
  // plata, no logística. "El repartidor cobra en la puerta" es la decisión de
  // sumar un canal de cobro por fuera de Mercado Pago (efectivo o su propio
  // POSNET en mano), así que entra en la misma categoría que
  // `markPaidInStore` / `setStoreStatus` — cambia SOLO por
  // `requestCourierPaymentPolicyChangeAction` + `confirmPendingChangeAction`
  // (código de 6 dígitos por mail), con `createAdminClient()` detrás de un
  // chequeo de `owner`. Si este campo vuelve a este schema, cualquier staff
  // logueado lo cambia posteando el formulario de Ajustes de nuevo — el
  // candado de confirmación por código queda cosmético, porque el camino
  // general lo esquiva.

  // Los canales del dock de la vitrina. Ver StoreLinks en types.ts.
  instagramHandle,
  mapsUrl,
  rappiUrl,
  pedidosYaUrl,
  uberEatsUrl,
})

export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>
