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
  'admin', 'api', 'app', 'assets', 'auth', 'backoffice', 'blog', 'carrito', 'checkout',
  'dashboard', 'docs', 'envios', 'favicon', 'functions', 'graphql', 'health', 'help',
  'images', 'legal', 'login', 'logout', 'manifest', 'mis-pedidos', 'new', 'nueva',
  'pedido', 'pedidos', 'public', 'realtime', 'repartidor', 'repartidores', 'rest',
  'robots', 'settings', 'sitemap', 'static', 'status', 'storage', 'support', 'www',
  '_next',
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
