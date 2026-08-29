import 'server-only'

import { z } from 'zod'

/**
 * Variables que NUNCA salen del servidor.
 *
 * El `import 'server-only'` de arriba es el punto de este archivo: si un
 * componente cliente lo importa, **el build falla**. Antes esto vivía junto a
 * `clientEnv` y la única protección era un chequeo de `typeof window` en
 * runtime — o sea que el error aparecía en el navegador del usuario en vez de
 * en CI. Un límite de módulo no se puede olvidar; un `if` sí.
 *
 * Efecto secundario que también se arregla: el schema del servidor ya no viaja
 * al bundle del browser. No filtraba valores, pero sí los nombres de todas las
 * variables secretas.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  /**
   * El origen del APEX, siempre. Nunca el de una tienda: `src/lib/urls.ts` es
   * el único lugar que decide cuándo un slug va como subdominio o como path,
   * y lo hace derivando el host de ESTA variable, no leyéndola directo.
   */
  NEXT_PUBLIC_SITE_URL: z.url(),
  /**
   * Cómo se sirve la vitrina de una tienda: `subdomain` (`<slug>.<apex>`) o
   * `path` (`<apex>/<slug>`). Default `path` a propósito — en local y en
   * preview nadie la setea y el comportamiento no cambia respecto de hoy. Se
   * setea en `subdomain` solo en Production, una vez que el wildcard DNS de
   * `comandapp.ar` esté andando (ver `src/lib/urls.ts`).
   */
  NEXT_PUBLIC_STORE_HOST_MODE: z.enum(['subdomain', 'path']).default('path'),

  WHATSAPP_PROVIDER: z.enum(['link', 'cloud']).default('link'),
  WHATSAPP_CLOUD_PHONE_ID: z.string().optional(),
  WHATSAPP_CLOUD_TOKEN: z.string().optional(),
  /**
   * Plantillas aprobadas en Meta, una por evento.
   *
   * No se puede reusar una sola: el texto de una plantilla de WhatsApp lo fija
   * Meta al aprobarla, así que mandar "tu pedido está listo" cuando el pedido
   * recién se confirmó no es un bug de parámetros, es contenido falso. Sin la
   * plantilla correspondiente cargada, el adapter devuelve `skipped` en vez de
   * mentirle al cliente.
   */
  WHATSAPP_CLOUD_TEMPLATE: z.string().default('pedido_listo'),
  WHATSAPP_CLOUD_TEMPLATE_CONFIRMED: z.string().optional(),
  WHATSAPP_CLOUD_TEMPLATE_CANCELLED: z.string().optional(),

  CRON_SECRET: z.string().min(1),

  /**
   * Kill-switch del rate limiting. En `false`, `consumeRateLimit` devuelve
   * siempre `allowed` sin tocar la base.
   *
   * Existe porque el limitador se mete en el camino de compra, y ahí un falso
   * positivo es plata perdida y un cliente enojado. Si una calibración sale
   * mal en producción —un balde demasiado ajustado, un sujeto mal
   * normalizado— la respuesta tiene que ser una variable de entorno y un
   * redeploy, no un hotfix bajo presión sobre el código que está cortando
   * ventas.
   *
   * Default `true`: apagado por accidente es peor que prendido por accidente.
   */
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),

  /**
   * Clave AES-256 (32 bytes en base64) para cifrar el access token y el webhook
   * secret de Mercado Pago de cada tienda. Opcional para que un entorno sin
   * pagos configurados arranque igual, pero sin ella `encryptSecret` tira: no
   * hay camino silencioso a guardar una credencial de cobro en texto plano.
   *
   *   openssl rand -base64 32
   */
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),

  /**
   * Resend. Opcionales a propósito: sin API key el adapter de email devuelve
   * 'skipped' en vez de tirar. Que no salga un comprobante no puede romper un
   * pedido que ya se pagó.
   */
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_FROM_NAME: z.string().default('Pedidos'),

  /**
   * A dónde llegan los pedidos de soporte que manda el dueño desde
   * `/admin/pagos`. Conectar Mercado Pago es la parte del alta que más se
   * traba —hay que sacar credenciales de producción del panel de MP, que no
   * es obvio— y sin este botón el dueño se queda mirando un formulario que no
   * puede completar.
   *
   * Tiene default para que el botón funcione en cualquier entorno sin
   * configurar nada, pero es una variable y no una constante en el código
   * porque el día que soporte lo atienda otra persona no se toca el repo.
   */
  SUPPORT_EMAIL: z.string().default('tomasizuel@gmail.com'),

  /**
   * "Continuar con Google" del backoffice de plataforma. Opcional: sin esto
   * configurado, el login por contraseña + TOTP tiene que seguir andando
   * solo, y el botón de Google directamente no se renderiza (ver
   * `src/app/backoffice/login/page.tsx`) en vez de mostrar un botón roto.
   *
   * Ojo con la trampa de siempre: este archivo lo lee Next (`.env.local`), y
   * el `env(...)` de `supabase/config.toml` lo sustituye el CLI de Supabase
   * (que mira `.env`, no `.env.local`). Mismo nombre de variable, dos
   * archivos distintos — hay que cargarla en los dos.
   *
   * Solo se necesita el client ID acá: es el dato público que decide si se
   * muestra el botón. El client secret (`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`)
   * lo usa directo Supabase Auth vía `config.toml`; esta app nunca lo toca,
   * así que no tiene sentido que viva en este schema.
   */
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: z.string().optional(),
})

let cached: z.infer<typeof serverSchema> | null = null

export function serverEnv() {
  if (cached) return cached

  const result = serverSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Variables de entorno inválidas:\n${missing}`)
  }

  cached = result.data
  return cached
}
