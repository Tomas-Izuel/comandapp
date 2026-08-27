import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, StoreBand, TrackingButton, palette } from './_shared'

export type StoreOwnerInviteVars = {
  storeName: string
  /** Link mágico a `/admin/acceso/confirm`, ya con `token_hash` y `type`. Vence en 1 hora — mismo TTL que cualquier magic link de Supabase Auth. */
  inviteUrl: string
  /** `NEXT_PUBLIC_SITE_URL`, para armar el link a `/admin/acceso` cuando este ya venció. */
  siteUrl: string
}

/**
 * Invitación al panel del local. Es el PRIMER contacto del dueño con
 * `/admin`, no un aviso de pedido — por eso no usa `_shared.ShortCodeBlock`
 * ni `SpecRow`, pensados para el ciclo de un pedido.
 *
 * El link es de un solo uso y vence en una hora (TTL del magic link de
 * Supabase Auth): si el dueño lo deja pasar, el backoffice puede reenviar
 * uno nuevo desde el detalle de la tienda — por eso el texto avisa el
 * vencimiento en vez de sugerir que el link queda guardado en el mail.
 */
export default function StoreOwnerInviteEmail(props: StoreOwnerInviteVars) {
  const { storeName, inviteUrl, siteUrl } = props
  const requestNewLinkUrl = `${siteUrl}/admin/acceso`

  return (
    <EmailDocument
      title={`Entrá al panel de ${storeName}`}
      previewText={`Ya podés entrar al panel de ${storeName} para armar el menú y gestionar pedidos.`}
    >
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Ya podés entrar al panel de tu local
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`Te dimos de alta ${storeName} en la plataforma. Desde tu panel armás el menú, seguís los pedidos que van entrando y controlás el estado de la cocina en tiempo real.`}
        </Text>
      </Section>

      <LabelRule />

      <Section style={{ padding: '0 28px 8px' }}>
        <TrackingButton href={inviteUrl}>Entrar al panel</TrackingButton>
      </Section>

      <Section style={{ padding: '4px 28px 24px' }}>
        <Text style={{ margin: 0, fontSize: 12, lineHeight: '1.5', color: palette.muted }}>
          Este link es de un solo uso y vence en 1 hora. Si ya venció, pedí uno nuevo en{' '}
          <a href={requestNewLinkUrl} style={{ color: palette.ink, fontWeight: 700, textDecoration: 'underline' }}>
            {requestNewLinkUrl.replace(/^https?:\/\//, '')}
          </a>
          .
        </Text>
      </Section>

      <Footer>Si no esperabas este mail, ignoralo: no se activa nada sin abrir el link.</Footer>
    </EmailDocument>
  )
}

StoreOwnerInviteEmail.PreviewProps = {
  storeName: 'Burger Estación',
  inviteUrl: 'https://burgershop.example.com/admin/acceso/confirm?token_hash=abc123&type=email',
  siteUrl: 'https://burgershop.example.com',
} satisfies StoreOwnerInviteVars
