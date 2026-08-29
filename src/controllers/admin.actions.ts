'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apexUrl } from '@/lib/urls'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { formatDateTimeLong } from '@/lib/dates'
import { toActionResult } from '@/lib/action-result'
import { encryptSecret } from '@/lib/crypto/secrets'
import { confirmationCodeSchema, type PendingChangeStarted } from '@/controllers/admin.controller'
import { getStoreById, requireStoreMembership, updateStoreSettings, upsertBranding } from '@/models/store.model'
import {
  consumePendingChange,
  createPendingChange,
  getLivePendingChange,
  type PendingChangeKind,
  type PendingChangePayload,
} from '@/models/store-pending-change.model'
import { getPaymentConnectionStatus } from '@/controllers/admin.controller'
import {
  sendPaymentChangeCode,
  sendPaymentChangeNotice,
  sendPaymentSupportRequest,
} from '@/services/notifications/email/payment-change'
import { storeSettingsInputSchema, type StoreSettingsInput } from '@/models/schemas/store.schema'
import type { Branding } from '@/models/schemas/branding.schema'
import type { ActionResult } from '@/models/types'

/** S-18: los `storeId` llegan tipados `number` solo por TypeScript — un
 * Server Action es un endpoint HTTP más, así que el body real puede traer
 * cualquier cosa. */
const storeIdSchema = z.number().int().positive()

// ---------------------------------------------------------------------------
// Pedido de link de acceso (/admin/acceso) — magic link.
//
// No es un login: el dueño recibe su primer link por la invitación que empuja
// el backoffice. Esta acción existe para el caso en que ese link venció.
// `shouldCreateUser: false`: sin eso el formulario es un registro público,
// cosa que este panel nunca puede ser.
// ---------------------------------------------------------------------------

const emailSchema = z.email('Ingresá un email válido')

/**
 * Throttle propio del magic link (S-06).
 *
 * `signInWithOtp` corre en un Server Action: Supabase Auth ve SIEMPRE la IP
 * del servidor (Vercel), nunca la del browser que apretó el botón. Su rate
 * limit (30 requests / 5 min POR IP) se agota entonces para todos los dueños
 * de todos los locales a la vez —es el único método de login del panel— y no
 * para un atacante puntual que sí tiene una sola IP.
 *
 * Este throttle es propio: la clave es (email + IP real del cliente, leída de
 * `x-forwarded-for`). Vive en memoria del proceso Node, así que sirve para
 * UNA instancia y se pierde en cada deploy o cold start — es una mitigación
 * de desarrollo, no la solución final. Producción necesita un store
 * compartido (Redis/Upstash) para que todas las instancias de Vercel vean el
 * mismo contador, y Turnstile/hCaptcha en `[auth.captcha]` de Supabase Auth
 * para frenar un script que rota de IP en cada intento.
 */
const MAGIC_LINK_WINDOW_MS = 5 * 60 * 1000
const MAGIC_LINK_MAX_ATTEMPTS = 5
const magicLinkAttempts = new Map<string, number[]>()

function isMagicLinkThrottled(key: string): boolean {
  const now = Date.now()
  const recent = (magicLinkAttempts.get(key) ?? []).filter((t) => now - t < MAGIC_LINK_WINDOW_MS)
  recent.push(now)
  magicLinkAttempts.set(key, recent)
  return recent.length > MAGIC_LINK_MAX_ATTEMPTS
}

async function clientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * A qué ruta manda el link según quién lo pide. Unión literal a propósito
 * (S-13 hermano): un `surface` libre —o peor, un `next` que el caller elige—
 * en un endpoint de magic link es la receta de un open redirect. Acá solo
 * hay dos valores posibles y los dos los elige este archivo, nunca el
 * llamador.
 */
const SURFACE_CONFIRM_PATH: Record<'admin' | 'courier', string> = {
  admin: '/admin/acceso/confirm',
  courier: '/admin/acceso/confirm?next=/repartidor',
}

/**
 * Siempre devuelve el mismo mensaje: exista o no el email, y también cuando
 * el pedido se frenó por el throttle. Filtrar cuál es cuál es una fuga de
 * información sobre quién tiene acceso al panel de un local ajeno.
 *
 * `surface` decide SOLO el `emailRedirectTo` (a qué panel vuelve el click).
 * Todo lo demás —el throttle, `shouldCreateUser: false`, la respuesta
 * uniforme— es exactamente el mismo camino para admin y para repartidor: los
 * dos comparten el mismo mecanismo de acceso (magic link a un email ya
 * dado de alta), no dos sistemas de login distintos.
 */
export async function requestMagicLinkAction(
  email: string,
  surface: 'admin' | 'courier' = 'admin',
): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Email inválido' }
  }

  const ip = await clientIp()
  const key = `${parsed.data.toLowerCase()}:${ip}`
  if (isMagicLinkThrottled(key)) {
    log.warn('admin.login', 'magic link throttled', { ip })
    return { ok: true, data: undefined }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      // El panel vive en el apex siempre: es la premisa de seguridad de
      // "subdominio por local" (00-architecture.md §1). `apexUrl` nunca
      // devuelve el host de una tienda, así que este link no puede terminar
      // apuntando a un subdominio aunque el modo de host cambie.
      emailRedirectTo: apexUrl(SURFACE_CONFIRM_PATH[surface]),
    },
  })

  // La respuesta al cliente es la MISMA exista o no el email: si un email
  // desconocido devolviera algo distinto, el formulario sería un oráculo para
  // averiguar quién tiene panel en la plataforma.
  //
  // El nivel de log sí distingue, porque el que mira los logs necesita
  // distinguir. "Ese email no es staff de ningún local" es el resultado
  // esperado de que alguien se equivoque de casilla, no una falla: Auth lo
  // rechaza con `otp_disabled` (422). Loguearlo como error, con stack, entierra
  // los errores de verdad.
  //
  // Quien produce ese 422 es el `shouldCreateUser: false` de arriba, NO el
  // `enable_signup` global — que desde la allowlist de registro está en `true`
  // para que el platform admin pueda registrarse con Google. Verificado tras
  // ese cambio: `POST /auth/v1/otp` con `create_user:false` y un email
  // desconocido sigue devolviendo 422 `otp_disabled`, y con `create_user:true`
  // lo frena el hook con 403. Esta página no es un registro por ninguno de los
  // dos caminos.
  if (error) {
    const isUnknownEmail = error.code === 'otp_disabled' || error.status === 422
    if (isUnknownEmail) {
      log.warn('admin.login', 'magic link pedido para un email sin panel', { code: error.code })
    } else {
      log.error('admin.login', 'signInWithOtp falló', error)
    }
  }

  return { ok: true, data: undefined }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

// ---------------------------------------------------------------------------
// Ajustes del local
//
// Nombre, horario, si acepta pedidos: decisiones del NEGOCIO, no de la caja.
// Cualquier staff logueado puede tocarlas — solo pagos exige ser dueño, más
// abajo (S-03).
// ---------------------------------------------------------------------------

export async function updateStoreSettingsAction(storeId: number, input: StoreSettingsInput): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)
    const parsed = storeSettingsInputSchema.parse(input)
    await updateStoreSettings(id, parsed)
  }, 'admin.updateStoreSettings')
}

// ---------------------------------------------------------------------------
// Apariencia — kit de marca. Mismo criterio que ajustes: es identidad del
// negocio, no la caja, así que cualquier staff puede cambiarla (S-03).
// ---------------------------------------------------------------------------

export async function upsertBrandingAction(storeId: number, input: Branding): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)
    await upsertBranding(id, input)
  }, 'admin.upsertBranding')
}

// ---------------------------------------------------------------------------
// Pagos — Mercado Pago
//
// `store_payment_credentials` no tiene grants para `authenticated` (a
// propósito: ver src/services/payments/mercadopago.adapter.ts), así que la
// única manera de escribir ahí es con el cliente admin. Acá SÍ se exige
// `{ role: 'owner' }`: reemplazar el access token de Mercado Pago redirige
// TODOS los cobros online del local a la cuenta de quien lo carga. Antes la
// única guardia era `requireStoreMembership` sin mirar el rol devuelto:
// cualquier encargado podía hacerlo sin que el dueño se enterara (S-03).
//
// Y ser dueño tampoco alcanza ya: el cambio pasa por un código que se manda al
// mail del dueño registrado en `auth.users`. Ser dueño es tener la sesión, y
// una sesión abierta y olvidada en la tablet del mostrador es exactamente el
// escenario contra el que hay que defender la caja. El código va a un canal
// que la sesión NO controla — por eso el destinatario nunca sale del request.
// ---------------------------------------------------------------------------

const paymentCredentialsSchema = z.object({
  accessToken: z.string().trim().min(10, 'El access token no parece válido'),
  webhookSecret: z.string().trim().min(10, 'La clave secreta del webhook no parece válida'),
})

type PaymentCredentialsInput = z.infer<typeof paymentCredentialsSchema>

/**
 * Confirma el token contra Mercado Pago ANTES de guardarlo (S-08).
 *
 * `is_sandbox` se derivaba solo del prefijo `TEST-` del string y nunca se
 * consultaba contra el proveedor: un token con un typo, revocado, o copiado
 * de otra cuenta quedaba "conectado" en la UI hasta el primer cobro real
 * fallido. `/users/me` es el endpoint más barato de MP para validar que el
 * token es real sin gastar una operación de cobro.
 *
 * El bloqueo de `TEST-` en producción es la mitad "o al menos" de S-08: sin
 * esto, una tienda en producción podía "cobrar" con tarjetas de prueba — la
 * plata nunca entra pero el pedido queda igual `approved` si nadie lo frena
 * antes (ver también el chequeo de `live_mode` en `mercadopago.adapter.ts`,
 * que cubre el caso de un token real que empieza a devolver pagos sandbox).
 *
 * Corre al PEDIR el cambio, no al confirmarlo: mandarle un código al dueño
 * para que descubra diez minutos después que había un typo en el token es
 * hacerle perder el viaje dos veces.
 */
async function assertValidMercadoPagoToken(accessToken: string): Promise<void> {
  if (process.env.NODE_ENV === 'production' && accessToken.startsWith('TEST-')) {
    throw new DomainError('No se puede conectar un token de prueba (TEST-) en producción.', {
      status: 400,
      field: 'accessToken',
    })
  }

  const response = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new DomainError('Mercado Pago rechazó el access token: verificá que lo copiaste bien.', {
      status: 400,
      field: 'accessToken',
    })
  }
}

/**
 * Contexto del dueño que pide el cambio: a qué casilla va el código y con qué
 * nombre de local se arma el mail.
 *
 * El mail sale de `auth.users`, NUNCA del request. Es el punto entero del
 * mecanismo: si el destinatario pudiera venir del formulario, quien tiene la
 * sesión se manda el código a sí mismo y el segundo factor no existe.
 */
async function requireOwnerForPaymentChange(storeId: number) {
  const { userId } = await requireStoreMembership(storeId, { role: 'owner' })

  const user = await getCurrentUser()
  const email = user?.email
  if (!email) {
    throw new DomainError(
      'Tu cuenta no tiene un mail asociado, así que no podemos mandarte el código de confirmación.',
      { status: 400 },
    )
  }

  const store = await getStoreById(storeId)
  if (!store) throw new DomainError('No encontramos el local.', { status: 404 })

  return { userId, email, store }
}

/**
 * Arranca un cambio sensible: crea la solicitud y manda el código + el aviso.
 *
 * El aviso va DESPUÉS del código y sin `await` bloqueante sobre su resultado
 * porque es informativo; el código sí tira si no sale (ver
 * `services/notifications/email/payment-change.tsx`).
 */
async function startPendingChange(p: {
  storeId: number
  userId: string
  email: string
  storeName: string
  timezone: string
  kind: PendingChangeKind
  payload: PendingChangePayload
}): Promise<{ requestId: number; sentTo: string }> {
  const { id, code } = await createPendingChange({
    storeId: p.storeId,
    userId: p.userId,
    kind: p.kind,
    payload: p.payload,
  })

  await sendPaymentChangeCode({
    requestId: id,
    attempt: 1,
    to: p.email,
    storeName: p.storeName,
    kind: p.kind,
    code,
  })

  await sendPaymentChangeNotice({
    requestId: id,
    to: p.email,
    storeName: p.storeName,
    kind: p.kind,
    requestedByEmail: p.email,
    requestedAtLabel: formatDateTimeLong(new Date().toISOString(), p.timezone),
  })

  return { requestId: id, sentTo: maskEmail(p.email) }
}

/** `du••••@gmail.com`: alcanza para que el dueño reconozca su casilla sin publicarla en pantalla. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(2, local.length - 2))}@${domain}`
}

export async function requestPaymentCredentialsChangeAction(
  storeId: number,
  input: PaymentCredentialsInput,
): Promise<ActionResult<PendingChangeStarted>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const { userId, email, store } = await requireOwnerForPaymentChange(id)
    const parsed = paymentCredentialsSchema.parse(input)
    await assertValidMercadoPagoToken(parsed.accessToken)

    return startPendingChange({
      storeId: id,
      userId,
      email,
      storeName: store.name,
      timezone: store.timezone,
      kind: 'payment_credentials',
      // Cifrados con AES-256-GCM (S-08) ANTES de tocar la base, igual que en la
      // tabla final: que esta fila sea transitoria no la exime. Un pg_dump no
      // distingue entre una tabla definitiva y una de paso.
      payload: {
        accessToken: encryptSecret(parsed.accessToken),
        webhookSecret: encryptSecret(parsed.webhookSecret),
        isSandbox: parsed.accessToken.startsWith('TEST-'),
      },
    })
  }, 'admin.requestPaymentCredentialsChange')
}

export async function requestCourierPaymentPolicyChangeAction(
  storeId: number,
  courierCollectsPayment: boolean,
): Promise<ActionResult<PendingChangeStarted>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const value = z.boolean().parse(courierCollectsPayment)
    const { userId, email, store } = await requireOwnerForPaymentChange(id)

    return startPendingChange({
      storeId: id,
      userId,
      email,
      storeName: store.name,
      timezone: store.timezone,
      kind: 'courier_payment_policy',
      payload: { courierCollectsPayment: value },
    })
  }, 'admin.requestCourierPaymentPolicyChange')
}

/**
 * Aplica el cambio si el código es correcto.
 *
 * Todo lo que decide si se aplica —vencimiento, intentos, un solo uso— vive en
 * `consumePendingChange`, o sea en Postgres. Acá solo se despacha por `kind`.
 */
export async function confirmPendingChangeAction(
  storeId: number,
  requestId: number,
  code: string,
): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const request = z.number().int().positive().parse(requestId)
    const parsedCode = confirmationCodeSchema.parse(code)

    const { userId } = await requireStoreMembership(id, { role: 'owner' })
    const change = await consumePendingChange({ id: request, storeId: id, userId, code: parsedCode })

    const admin = createAdminClient()

    if (change.kind === 'payment_credentials') {
      const { error } = await admin.from('store_payment_credentials').upsert(
        {
          store_id: id,
          provider: 'mercadopago',
          access_token: String(change.payload.accessToken),
          webhook_secret: String(change.payload.webhookSecret),
          is_sandbox: Boolean(change.payload.isSandbox),
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'store_id' },
      )
      if (error) throw new Error(`No se pudieron guardar las credenciales de pago: ${error.message}`)
      revalidatePath('/admin/pagos')
      return
    }

    // `stores.courier_collects_payment` no se escribe con el cliente RLS aunque
    // el grant lo permita: si pasara por ahí, el formulario de Ajustes podría
    // volver a tocarlo sin código y toda esta confirmación sería decorado.
    const { error } = await admin
      .from('stores')
      .update({ courier_collects_payment: Boolean(change.payload.courierCollectsPayment) })
      .eq('id', id)

    if (error) throw new Error(`No se pudo actualizar la política de cobro: ${error.message}`)
    revalidatePath('/admin/ajustes')
  }, 'admin.confirmPendingChange')
}

/**
 * Manda un código nuevo para una solicitud que sigue viva, sin obligar al dueño
 * a volver a cargar el token de Mercado Pago.
 *
 * Regenera en vez de reenviar el mismo: `createPendingChange` invalida el
 * anterior, así que reenviar el viejo dejaría dos códigos válidos con sus
 * propios contadores de intentos.
 */
export async function resendPendingChangeCodeAction(
  storeId: number,
  requestId: number,
): Promise<ActionResult<PendingChangeStarted>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const request = z.number().int().positive().parse(requestId)
    const { userId, email, store } = await requireOwnerForPaymentChange(id)

    const live = await getLivePendingChange({ id: request, storeId: id, userId })
    if (!live) {
      throw new DomainError('Esa solicitud ya venció. Volvé a empezar el cambio.', { status: 400 })
    }

    return startPendingChange({
      storeId: id,
      userId,
      email,
      storeName: store.name,
      timezone: store.timezone,
      kind: live.kind,
      payload: live.payload,
    })
  }, 'admin.resendPendingChangeCode')
}

// ---------------------------------------------------------------------------
// Soporte para conectar Mercado Pago
//
// Sacar las credenciales de producción del panel de Mercado Pago es el paso
// del alta que más se traba, y no es algo que el dueño pueda resolver leyendo
// otra vez el formulario. Sin esta puerta, el que se traba abandona y el local
// queda sin cobro online — que es lo mismo que no estar en la plataforma.
//
// Acá NO se exige `owner`: pedir ayuda no cambia nada. Un encargado que se
// queda trabado tiene que poder avisar.
// ---------------------------------------------------------------------------

const supportMessageSchema = z
  .string()
  .trim()
  .max(2000, 'El mensaje es muy largo: contanos lo esencial en menos de 2000 caracteres.')

/**
 * Un pedido de soporte cada dos minutos por local. Mismo throttle en memoria
 * que el magic link y con la misma limitación honesta: vive en el proceso Node,
 * así que sirve para UNA instancia y se pierde en cada deploy. Alcanza para lo
 * que tiene que frenar —un doble tap y un dueño ansioso— y no para un abuso
 * decidido, que igual necesitaría una sesión de staff válida.
 */
const SUPPORT_WINDOW_MS = 2 * 60 * 1000
const supportRequests = new Map<number, number>()

export async function requestPaymentSupportAction(storeId: number, message: string): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const parsedMessage = supportMessageSchema.parse(message)
    const { role } = await requireStoreMembership(id)

    const last = supportRequests.get(id)
    if (last && Date.now() - last < SUPPORT_WINDOW_MS) {
      throw new DomainError('Ya recibimos tu pedido. Te contestamos al mail apenas lo veamos.', { status: 429 })
    }

    const user = await getCurrentUser()
    const store = await getStoreById(id)
    if (!store) throw new DomainError('No encontramos el local.', { status: 404 })

    const status = await getPaymentConnectionStatus(id)

    const result = await sendPaymentSupportRequest({
      storeId: id,
      storeName: store.name,
      storeSlug: store.slug,
      requestedByEmail: user?.email ?? 'sin-mail@desconocido',
      requestedByRole: role,
      connectionLabel: status.connected
        ? `Conectado ${status.isSandbox ? '(sandbox)' : '(producción)'} · ${status.accessTokenPreview ?? ''}`.trim()
        : 'Sin conectar',
      message: parsedMessage || null,
    })

    if (result.status === 'failed') {
      throw new DomainError('No pudimos mandar tu pedido de soporte. Probá de nuevo en un rato.', { status: 503 })
    }

    // El `skipped` (sin Resend configurado) NO se le muestra como error al
    // dueño: en producción no pasa, y en desarrollo un error acá no le sirve a
    // nadie. Queda en los logs, que es donde lo va a buscar quien configura.
    supportRequests.set(id, Date.now())
  }, 'admin.requestPaymentSupport')
}
