import { z } from 'zod'

/**
 * Contratos del backoffice de plataforma (alta de tiendas, etc).
 * Todo lo que llega acá ya pasó `requirePlatformAdmin()` en el model, pero se
 * valida igual: la sesión autoriza la operación, no la forma de los datos.
 */

export const storeStatusSchema = z.enum(['active', 'suspended'])

/**
 * Slugs que no se pueden registrar.
 *
 * `stores.slug` es único, pero nada impedía dar de alta un local con slug
 * `admin`, `api` o `backoffice`. Hoy el segmento estático de Next le gana a
 * `[store]`, así que esa tienda queda inalcanzable y es un bug menor; con la
 * iteración de subdominios —ya decidida en CLAUDE.md— pasa a ser secuestro de
 * ruta.
 *
 * La lista está duplicada a propósito en el CHECK
 * `stores_slug_not_reserved_check` (migración `20260826120000_hardening.sql`):
 * la base es la que garantiza que no entre por ningún camino, y este schema es
 * el que hace que el dueño reciba un mensaje que se entiende en vez del texto
 * de una constraint de Postgres. Si se agrega uno, va en los dos lados.
 */
export const RESERVED_SLUGS = [
  // Rutas de la app y del stack.
  'admin', 'api', 'app', 'assets', 'auth', 'backoffice', 'blog', 'carrito', 'checkout',
  'dashboard', 'docs', 'envios', 'favicon', 'functions', 'graphql', 'health', 'help',
  'images', 'legal', 'login', 'logout', 'manifest', 'mis-pedidos', 'new', 'nueva',
  'pedido', 'pedidos', 'public', 'realtime', 'repartidor', 'repartidores', 'rest',
  'robots', 'settings', 'sitemap', 'static', 'status', 'storage', 'support', 'www',
  '_next',

  // Desde acá, la lista dejó de proteger PATHS para proteger HOSTNAMES: con
  // `[slug].comandapp.ar`, cada slug es además un subdominio real de la zona
  // DNS de la plataforma. Si un local toma `mail` y después hace falta
  // `mail.comandapp.ar` para Resend, el conflicto se resuelve renombrándole la
  // tienda a un cliente.

  // Correo e infraestructura de entrega. Los más urgentes: el magic link es la
  // única puerta a /admin y Resend necesita registros en esta misma zona.
  'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'webmail', 'autoconfig', 'autodiscover',
  'bounces', 'track', 'link', 'links', 'send',

  // DNS y red.
  'ns', 'ns1', 'ns2', 'dns', 'ftp', 'vpn', 'gateway', 'proxy',

  // Entornos.
  'staging', 'stage', 'dev', 'test', 'qa', 'demo', 'beta', 'preview', 'sandbox', 'local',
  'internal',

  // CDN y assets.
  'cdn', 'img', 'media', 'files', 'download', 'downloads', 'web', 'www2',

  // Identidad y pagos.
  'id', 'sso', 'oauth', 'callback', 'account', 'accounts', 'cuenta', 'pay', 'pago', 'pagos',
  'billing', 'facturacion', 'webhook', 'webhooks',

  // Observabilidad.
  'metrics', 'monitor', 'logs', 'grafana', 'ci', 'git',

  // Marca y proveedores. `comandapp.comandapp.ar` de un tercero es phishing
  // servido por nosotros, con nuestro certificado.
  'comandapp', 'vercel', 'supabase', 'resend', 'mercadopago', 'mp',

  // Superficie de cliente.
  'm', 'mobile', 'soporte', 'ayuda', 'contacto',
] as const

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'El slug tiene que ser minúsculas, números y guiones, por ejemplo mi-local')
  .min(2)
  .max(60)
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), {
    error: 'Esa dirección está reservada por la plataforma: elegí otra',
  })

export const createStoreInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, 'Falta el nombre').max(120),
  description: z.string().trim().max(500).nullable().default(null),
  phoneE164: z.string().trim().max(20).nullable().default(null),
  whatsappPhoneE164: z.string().trim().max(20).nullable().default(null),
  address: z.string().trim().max(200).nullable().default(null),
  timezone: z.string().trim().min(1).max(60).default('America/Argentina/Buenos_Aires'),
  currency: z.string().trim().length(3).default('ARS'),

  /** Email del dueño. Si no existe usuario con ese email, se crea. */
  ownerEmail: z.email('Email de dueño inválido'),
})

export type CreateStoreInput = z.infer<typeof createStoreInputSchema>
