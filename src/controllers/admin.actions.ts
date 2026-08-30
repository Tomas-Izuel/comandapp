'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apexUrl } from '@/lib/urls'
import { DomainError, RateLimitError } from '@/lib/errors'
import { log } from '@/lib/log'
import { formatDateTimeLong } from '@/lib/dates'
import { toActionResult } from '@/lib/action-result'
import { encryptSecret } from '@/lib/crypto/secrets'
import { consumeRateLimit } from '@/models/rate-limit.model'
import { RATE_LIMIT_POLICY } from '@/lib/rate-limit-policy'
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
import {
  storeHoursOverrideDateSchema,
  storeHoursOverrideInputSchema,
  storeHoursWeeklyInputSchema,
  storeSettingsInputSchema,
  type StoreSettingsInput,
} from '@/models/schemas/store.schema'
import { getStoreHoursData, setStoreHours, setStoreHoursOverride } from '@/models/store-hours.model'
import { currentCommercialNight } from '@/lib/store-hours'
// T2 (senior-backend-engineer B) es dueño de order.model.ts y kitchen.controller.ts:
// se importa, nunca se edita. El apagado destructivo de programados (Q4/Q9,
// 00-architecture.md §7.8.1) vive acá porque orquesta store + horarios + la
// cancelación transaccional + el aviso — ninguno de esos modelos por sí solo
// tiene el contexto completo.
import { cancelScheduledNight, getScheduledNightSummary } from '@/models/order.model'
import { dispatchCancelledNotification } from '@/controllers/kitchen.controller'
import type { Branding } from '@/models/schemas/branding.schema'
import type { ActionResult, RateLimitBucket, StoreHoursRange, StoreHoursOverride } from '@/models/types'

/**
 * Frase legible en español para el mensaje de un `RateLimitError` (S-06/T4).
 * No vive en un lugar compartido: cada `.actions.ts` de T4 la duplica como
 * función privada no exportada, porque un archivo con `'use server'` en la
 * primera línea solo puede EXPORTAR funciones async (Next lo exige), y mover
 * este helper a un controller habría significado tocar `admin.controller.ts`,
 * que no es propiedad de esta tarea.
 */
function humanizeRetryAfter(seconds: number): string {
  if (seconds < 60) return 'unos segundos'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} hora${hours === 1 ? '' : 's'}`
}

/** Consume un balde y tira `RateLimitError` (429, mensaje en interfaz) si ya no queda cupo. */
async function consumeOrThrow(
  bucket: RateLimitBucket,
  subject: string,
  message: (retryAfterSeconds: number) => string,
  onError?: 'allow' | 'deny',
): Promise<void> {
  const policy = RATE_LIMIT_POLICY[bucket]
  const decision = await consumeRateLimit({ bucket, subject, ...policy, onError })
  if (!decision.allowed) {
    throw new RateLimitError(message(decision.retryAfterSeconds), decision.retryAfterSeconds)
  }
}

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
 * Los 4 baldes del magic link (S-06/T4), consumidos EN ORDEN y con corte
 * apenas alguno bloquea: así un reintento contra un email ya frenado no sigue
 * gastando el cupo de `magic_link:ip` ni, sobre todo, el de
 * `magic_link:global` — que es un PRESUPUESTO compartido con las
 * invitaciones autenticadas del backoffice, no un límite de abuso (ver
 * CLAUDE.md). Reemplaza al `Map` en memoria que existía acá: ese contador
 * vivía en el proceso Node, así que se perdía en cada cold start y cada
 * instancia de Vercel contaba por su cuenta — el balde real vive en
 * `public.rate_limits` vía `consumeRateLimit`.
 *
 * `onError: 'deny'` en los cuatro (fail-closed): a diferencia de la mayoría
 * de los baldes del sistema, acá negar por un hipo de Postgres SÍ tiene
 * consecuencia, porque `signInWithOtp` lo atiende Supabase Auth —un servicio
 * aparte— y puede seguir mandando mails aunque esta RPC falle. Ver el
 * comentario largo de `consumeRateLimit` en `rate-limit.model.ts`.
 */
async function checkMagicLinkBudget(
  email: string,
  ip: string,
): Promise<{ allowed: true } | { allowed: false; bucket: RateLimitBucket }> {
  const checks: Array<{ bucket: RateLimitBucket; subject: string }> = [
    { bucket: 'magic_link:email', subject: email },
    { bucket: 'magic_link:email:day', subject: email },
    { bucket: 'magic_link:ip', subject: ip },
    { bucket: 'magic_link:global', subject: 'global' },
  ]

  for (const check of checks) {
    const policy = RATE_LIMIT_POLICY[check.bucket]
    const decision = await consumeRateLimit({ ...check, ...policy, onError: 'deny' })
    if (!decision.allowed) return { allowed: false, bucket: check.bucket }
  }

  return { allowed: true }
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
  const budget = await checkMagicLinkBudget(parsed.data, ip)
  if (!budget.allowed) {
    // Nunca el email ni la IP en el log (regla del repo): el nombre del
    // balde alcanza para diagnosticar sin crear un registro de PII nuevo.
    log.warn('admin.login', 'magic link rate-limited', { bucket: budget.bucket })
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

    // `payment_change:store` fail-closed (S-08/T4): este camino toca las
    // credenciales de cobro, así que ante un hipo de Postgres se rechaza en
    // vez de dejar pasar (00-architecture.md §5.3). Va DESPUÉS de validar el
    // token contra Mercado Pago: no tiene sentido gastar el cupo de 3/hora en
    // un request que ya iba a fallar por otro motivo.
    await consumeOrThrow(
      'payment_change:store',
      String(id),
      (s) =>
        `Ya pediste demasiados cambios de método de cobro para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
      'deny',
    )

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

    await consumeOrThrow(
      'payment_change:store',
      String(id),
      (s) =>
        `Ya pediste demasiados cambios de método de cobro para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
      'deny',
    )

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

    await consumeOrThrow(
      'payment_change:store',
      String(id),
      (s) =>
        `Ya pediste demasiados cambios de método de cobro para este local. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
      'deny',
    )

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
 * Un pedido de soporte cada dos minutos por local, más un tope diario
 * (`support:store` + `support:store:day`). Reemplaza al `Map` en memoria que
 * había acá: mismo problema que el del magic link, se perdía en cada cold
 * start y no se compartía entre instancias de Vercel.
 */
async function consumeSupportBudget(storeId: number): Promise<void> {
  await consumeOrThrow(
    'support:store',
    String(storeId),
    (s) => `Ya recibimos tu pedido. Te contestamos al mail apenas lo veamos. Escribinos de nuevo en ${humanizeRetryAfter(s)} si hace falta.`,
  )
  await consumeOrThrow(
    'support:store:day',
    String(storeId),
    (s) => `Ya mandaste muchos pedidos de soporte hoy. Probá de nuevo en ${humanizeRetryAfter(s)}.`,
  )
}

export async function requestPaymentSupportAction(storeId: number, message: string): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    const parsedMessage = supportMessageSchema.parse(message)
    const { role } = await requireStoreMembership(id)

    await consumeSupportBudget(id)

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
    // El balde ya se consumió arriba, antes de mandar: no hace falta marcar
    // nada acá.
  }, 'admin.requestPaymentSupport')
}

// ---------------------------------------------------------------------------
// Horarios de apertura y sus excepciones por fecha
//
// Guardar el patrón semanal o una excepción NUNCA cancela nada por sí solo
// (00-architecture.md §7.8.2): cerrar una fecha con programados adentro pasa
// por el MISMO diálogo destructivo que "pausar pedidos" — la UI hace el
// preview + confirmación y recién después llama `pauseScheduledNightAction`
// con esa fecha. Un solo camino de cancelación masiva, nunca dos.
// ---------------------------------------------------------------------------

export async function saveStoreHoursAction(storeId: number, ranges: StoreHoursRange[]): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)
    const parsed = storeHoursWeeklyInputSchema.parse(ranges)
    await setStoreHours(id, parsed)
  }, 'admin.saveStoreHours')
}

export async function saveStoreHoursOverrideAction(
  storeId: number,
  override: StoreHoursOverride | { date: string; remove: true },
): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)

    if ('remove' in override) {
      const date = storeHoursOverrideDateSchema.parse(override.date)
      await setStoreHoursOverride(id, { date, remove: true })
      return
    }

    const parsed = storeHoursOverrideInputSchema.parse(override)
    await setStoreHoursOverride(id, parsed)
  }, 'admin.saveStoreHoursOverride')
}

/**
 * Convenience wrapper de `saveStoreHoursOverrideAction(storeId, { date,
 * remove: true })`: un botón "quitar excepción" en el calendario no tiene por
 * qué construir el objeto union a mano. No es un contrato de `01-tasks.md`
 * (que plegó el borrado adentro de la acción de guardado con un flag), pero
 * es la forma que la vista de T4 ya espera — agregar el wrapper acá cuesta
 * una función y evita que dos slices en paralelo se bloqueen por un nombre.
 */
export async function deleteStoreHoursOverrideAction(storeId: number, date: string): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)
    const parsedDate = storeHoursOverrideDateSchema.parse(date)
    await setStoreHoursOverride(id, { date: parsedDate, remove: true })
  }, 'admin.deleteStoreHoursOverride')
}

// ---------------------------------------------------------------------------
// "Pausar pedidos" = apagado destructivo (Q4/Q9) y cierre de fecha (Q14)
//
// Las dos comparten el mismo camino de cancelación masiva: SIN `night` es
// "pausar pedidos" (la noche comercial en curso, la que calcula
// `currentCommercialNight`); CON `night` es cerrar una fecha puntual desde el
// calendario de excepciones. Solo el primer caso toca `accepting_orders` — la
// fecha ya se cerró por el override, guardado aparte.
// ---------------------------------------------------------------------------

async function resolveTargetNight(storeId: number, night: string | undefined): Promise<string> {
  if (night !== undefined) return night
  const store = await getStoreById(storeId)
  if (!store) throw new DomainError('No encontramos el local.', { status: 404 })
  const schedule = await getStoreHoursData(storeId)
  return currentCommercialNight(schedule, new Date(), store.timezone)
}

export async function previewScheduledNightAction(
  storeId: number,
  night?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getScheduledNightSummary>>>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)
    const targetNight = await resolveTargetNight(id, night)
    return getScheduledNightSummary(id, targetNight)
  }, 'admin.previewScheduledNight')
}

export async function pauseScheduledNightAction(
  storeId: number,
  night?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof cancelScheduledNight>>>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)

    const isPause = night === undefined
    const targetNight = await resolveTargetNight(id, night)

    // `cancel_scheduled_orders` apaga `accepting_orders` DENTRO de la misma
    // transacción que cancela cuando `opts.pause` es `true` — la atomicidad
    // que evita la ventana "puerta cerrada con programados vivos, o al
    // revés". Togglear `accepting_orders` acá aparte (como proponía el
    // borrador del plan, dos pasos) REABRIRÍA esa ventana: ver el JSDoc de
    // `cancelScheduledNight` en order.model.ts. Para el cierre de una fecha
    // puntual (Q14) no hace falta: esa fecha ya se cerró con el override.
    const result = await cancelScheduledNight(id, targetNight, { pause: isPause })

    for (const orderId of result.cancelledIds) {
      // Una falla al mandar el aviso no revierte la cancelación: el pedido ya
      // está cancelado en la base, y no tiene sentido perder eso por un
      // WhatsApp que no salió (mismo criterio que el resto de las
      // notificaciones del repo).
      await dispatchCancelledNotification(orderId, id)
    }

    return result
  }, 'admin.pauseScheduledNight')
}

/**
 * Cerrar una fecha CON programados adentro (Q14): guarda el override
 * `isClosed: true` y recién DESPUÉS cancela los programados de esa noche +
 * despacha el aviso — en ese orden, y ese orden es el arreglo de m4 de
 * `03-review.md`.
 *
 * **No es atómico** (dos RPC distintas — `set_store_hours_override` y
 * `cancel_scheduled_orders` — no comparten transacción), y arreglar eso de
 * verdad exigiría una tercera RPC en Postgres que hiciera las dos cosas juntas
 * — cambio de schema, así que se REPORTA en el dev log en vez de escribirse
 * acá. Lo que SÍ se resuelve con las piezas existentes es el ORDEN: antes,
 * `schedule-editor.tsx` cancelaba primero y guardaba el cierre después: si el
 * guardado fallaba (red, timeout), quedaban pedidos YA cancelados con la
 * fecha todavía "abierta" según el patrón semanal — el peor estado a medio
 * camino, porque un cliente nuevo podía seguir programando ahí. Guardando el
 * cierre PRIMERO, una falla en el paso de cancelar deja la fecha
 * correctamente cerrada (nadie más programa ahí) con algunos programados
 * viejos pendientes de cancelar — se reintenta sin pérdida, mismo patrón que
 * "la puerta cerrada con programados vivos" ya documentado en
 * `pauseScheduledNightAction`.
 *
 * A diferencia de esa función, acá NUNCA se pasa `pause: true`: cerrar una
 * fecha puntual no toca `accepting_orders` — la tienda sigue aceptando
 * pedidos para cualquier otro día.
 */
export async function closeStoreHoursDateAction(
  storeId: number,
  date: string,
): Promise<ActionResult<Awaited<ReturnType<typeof cancelScheduledNight>>>> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id)

    const parsedOverride = storeHoursOverrideInputSchema.parse({ date, isClosed: true, ranges: [] })
    await setStoreHoursOverride(id, parsedOverride)

    const result = await cancelScheduledNight(id, parsedOverride.date, { pause: false })
    for (const orderId of result.cancelledIds) {
      await dispatchCancelledNotification(orderId, id)
    }

    return result
  }, 'admin.closeStoreHoursDate')
}
