import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, StoreBand, TrackingButton, palette } from './_shared'

export type StoreCourierInviteVars = {
  storeName: string
  /** Lo que ve el CLIENTE en el seguimiento ("Martín está llevando tu pedido"). */
  courierName: string
  /** Link mágico a `/repartidor` (vía `/admin/acceso/confirm?...&next=/repartidor`). Vence en 1 hora — mismo TTL que cualquier magic link de Supabase Auth. */
  inviteUrl: string
  /** `NEXT_PUBLIC_SITE_URL`, sin uso hoy (a diferencia del dueño, el repartidor no tiene una pantalla propia para pedir un link nuevo) pero se deja para que la firma sea la misma que `StoreOwnerInviteVars`. */
  siteUrl: string
}

/**
 * Invitación al portal de reparto. Es el PRIMER contacto de esta persona con
 * la plataforma — probablemente nunca usó `/admin` ni sabe qué es "Burger
 * Shop" — así que el texto explica de entrada quién lo invitó y para qué,
 * en vez de asumir contexto como sí puede hacerlo un aviso de pedido.
 */
export default function StoreCourierInviteEmail(props: StoreCourierInviteVars) {
  const { storeName, courierName, inviteUrl } = props

  return (
    <EmailDocument
      title={`${storeName} te sumó como repartidor`}
      previewText={`${storeName} te agregó como repartidor. Entrá para ver tus entregas.`}
    >
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Te sumaron como repartidor
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`Hola ${courierName}, ${storeName} te agregó a su equipo de reparto. Desde tu portal vas a ver qué pedidos tenés que entregar y marcar cuándo salís y cuándo llegan.`}
        </Text>
      </Section>

      <LabelRule />

      <Section style={{ padding: '0 28px 8px' }}>
        <TrackingButton href={inviteUrl}>Ver mis entregas</TrackingButton>
      </Section>

      <Section style={{ padding: '4px 28px 24px' }}>
        <Text style={{ margin: 0, fontSize: 12, lineHeight: '1.5', color: palette.muted }}>
          Este link es de un solo uso y vence en 1 hora. Si ya venció, pedile al local que te reenvíe la invitación.
        </Text>
      </Section>

      <Footer>Si no esperabas este mail, ignoralo: no se activa nada sin abrir el link.</Footer>
    </EmailDocument>
  )
}

StoreCourierInviteEmail.PreviewProps = {
  storeName: 'Burger Estación',
  courierName: 'Martín',
  inviteUrl: 'https://burgershop.example.com/admin/acceso/confirm?token_hash=abc123&type=email&next=%2Frepartidor',
  siteUrl: 'https://burgershop.example.com',
} satisfies StoreCourierInviteVars
