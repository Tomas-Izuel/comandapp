import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `serverEnv()` cachea en una variable de módulo (`src/lib/env.server.ts`) y
 * NO se mockea acá a propósito: es justo lo que arma la mitad de la URL bajo
 * prueba (`NEXT_PUBLIC_SITE_URL`). Se setean las variables mínimas que exige
 * `serverSchema` antes del primer `import`, como en `tests/lib/secrets.test.ts`.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
process.env.SUPABASE_SECRET_KEY = 'secret-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://burgershop.test'
process.env.CRON_SECRET = 'cron-secret'

const ADMIN_ID = 'platform-admin-uid'
const ADMIN_EMAIL = 'admin@burgershop.test'
const OWNER_EMAIL = 'dueno@la-birra.test'
const STORE_ID = 42

/**
 * Se mockean los tres bordes de I/O que atraviesa `resendOwnerInvite`:
 * el cliente RLS (sesión de plataforma + lectura de la tienda), el cliente
 * admin (generar el link + auditoría) y el envío del mail. La lógica de
 * ARMADO de la URL (`generateOwnerInviteLink`, no exportada) corre de
 * verdad — es lo que este archivo prueba.
 */
const { generateLinkMock, sendOwnerInviteEmailMock, auditInsertMock } = vi.hoisted(() => ({
  generateLinkMock: vi.fn(),
  sendOwnerInviteEmailMock: vi.fn(),
  auditInsertMock: vi.fn(),
}))

vi.mock('@/services/notifications/email/owner-invite', () => ({
  sendOwnerInviteEmail: sendOwnerInviteEmailMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== 'platform_admins') throw new Error(`tabla RLS inesperada en el test: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { user_id: ADMIN_ID, email: ADMIN_EMAIL }, error: null }),
          }),
        }),
      }
    },
    rpc: async (fn: string) => {
      if (fn !== 'platform_stores') throw new Error(`rpc inesperada en el test: ${fn}`)
      return {
        data: [
          {
            id: STORE_ID,
            slug: 'la-birra',
            name: 'La Birra',
            description: null,
            phone_e164: null,
            whatsapp_phone_e164: null,
            address: null,
            timezone: 'America/Argentina/Cordoba',
            currency: 'ARS',
            status: 'active',
            accepting_orders: true,
            in_store_payment_enabled: true,
            min_order_cents: 0,
            demand_threshold_orders: 5,
            demand_multiplier: '1.10',
            created_at: '2026-01-01T00:00:00.000Z',
            owner_email: OWNER_EMAIL,
            orders_last_30: 0,
            revenue_last_30_cents: 0,
          },
        ],
        error: null,
      }
    },
  }),
  getCurrentUser: async () => ({ id: ADMIN_ID, email: ADMIN_EMAIL }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: generateLinkMock } },
    from: (table: string) => {
      if (table !== 'platform_audit_log') throw new Error(`tabla admin inesperada en el test: ${table}`)
      return { insert: auditInsertMock }
    },
  }),
}))

const { resendOwnerInvite } = await import('@/models/platform.model')

beforeEach(() => {
  generateLinkMock.mockReset()
  sendOwnerInviteEmailMock.mockReset()
  auditInsertMock.mockReset()
  auditInsertMock.mockResolvedValue({ error: null })
  sendOwnerInviteEmailMock.mockResolvedValue({ status: 'sent', providerRef: 'resend-id-1' })
  generateLinkMock.mockResolvedValue({
    data: { properties: { hashed_token: 'el-hash-del-token', action_link: 'https://esto-se-ignora.example' } },
    error: null,
  })
})

describe('resendOwnerInvite → armado de la URL de invitación', () => {
  it('genera el link con `admin.generateLink({ type: "magiclink" })` para el email del dueño', async () => {
    await resendOwnerInvite(STORE_ID)

    expect(generateLinkMock).toHaveBeenCalledWith({ type: 'magiclink', email: OWNER_EMAIL })
  })

  it('la URL mandada al mail apunta a /admin/acceso/confirm (no al viejo /admin/login/confirm)', async () => {
    await resendOwnerInvite(STORE_ID)

    const inviteUrl = sendOwnerInviteEmailMock.mock.calls[0]?.[0]?.inviteUrl as string
    const parsed = new URL(inviteUrl)

    expect(parsed.origin).toBe('https://burgershop.test')
    expect(parsed.pathname).toBe('/admin/acceso/confirm')
  })

  it('lleva el token_hash que devolvió generateLink', async () => {
    await resendOwnerInvite(STORE_ID)

    const inviteUrl = sendOwnerInviteEmailMock.mock.calls[0]?.[0]?.inviteUrl as string
    const parsed = new URL(inviteUrl)

    expect(parsed.searchParams.get('token_hash')).toBe('el-hash-del-token')
  })

  /**
   * La trampa verificada a mano contra el stack local (comentario de
   * `platform.model.ts`): `generateLink({type:'magiclink'})` devuelve
   * `verification_type: 'magiclink'`, pero `/admin/acceso/confirm` SOLO
   * acepta `type=email` en `SUPPORTED_OTP_TYPES`. Si alguien "corrige" esto a
   * `type=magiclink` copiando el nombre que trae la respuesta de Supabase, el
   * link deja de entrar — este test tiene que romper si eso pasa.
   */
  it('el query param `type` es `email`, NUNCA `magiclink` (aunque generateLink pida type: magiclink)', async () => {
    await resendOwnerInvite(STORE_ID)

    const inviteUrl = sendOwnerInviteEmailMock.mock.calls[0]?.[0]?.inviteUrl as string
    const parsed = new URL(inviteUrl)

    expect(parsed.searchParams.get('type')).toBe('email')
    expect(parsed.searchParams.get('type')).not.toBe('magiclink')
  })

  it('no reusa action_link de la respuesta de generateLink tal cual (que trae type=magiclink)', async () => {
    await resendOwnerInvite(STORE_ID)

    const inviteUrl = sendOwnerInviteEmailMock.mock.calls[0]?.[0]?.inviteUrl as string
    expect(inviteUrl).not.toContain('esto-se-ignora.example')
  })
})
