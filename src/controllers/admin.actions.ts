'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { serverEnv } from '@/lib/env.server'
import { DomainError } from '@/lib/errors'
import { log } from '@/lib/log'
import { toActionResult } from '@/lib/action-result'
import { encryptSecret } from '@/lib/crypto/secrets'
import { requireStoreMembership, updateStoreSettings, upsertBranding } from '@/models/store.model'
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
 * Siempre devuelve el mismo mensaje: exista o no el email, y también cuando
 * el pedido se frenó por el throttle. Filtrar cuál es cuál es una fuga de
 * información sobre quién tiene acceso al panel de un local ajeno.
 */
export async function requestMagicLinkAction(email: string): Promise<ActionResult> {
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
      emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL}/admin/acceso/confirm`,
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

export async function savePaymentCredentialsAction(
  storeId: number,
  input: PaymentCredentialsInput,
): Promise<ActionResult> {
  return toActionResult(async () => {
    const id = storeIdSchema.parse(storeId)
    await requireStoreMembership(id, { role: 'owner' })
    const parsed = paymentCredentialsSchema.parse(input)
    await assertValidMercadoPagoToken(parsed.accessToken)

    const admin = createAdminClient()
    const { error } = await admin.from('store_payment_credentials').upsert(
      {
        store_id: id,
        provider: 'mercadopago',
        // Cifrados con AES-256-GCM (S-08): un pg_dump, un backup, la consola
        // de Studio o una secret key filtrada ya no exponen en texto plano el
        // token de cobro de todos los locales.
        access_token: encryptSecret(parsed.accessToken),
        webhook_secret: encryptSecret(parsed.webhookSecret),
        is_sandbox: parsed.accessToken.startsWith('TEST-'),
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' },
    )

    if (error) throw new Error(`No se pudieron guardar las credenciales de pago: ${error.message}`)
  }, 'admin.savePaymentCredentials')
}
