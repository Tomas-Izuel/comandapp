import { Heading, Section, Text } from '@react-email/components'
import type { EmailVars } from '@/services/notifications/email/email.port'
import { EmailDocument, Footer, ShortCodeBlock, StoreBand, TrackingButton, palette } from './_shared'

/**
 * "Está listo": corto y al hueso. Quien lo abre está por salir a buscar la
 * comida, no a leer — el código de mostrador tiene que verse ANTES de leer
 * una sola palabra.
 */
export default function OrderReadyEmail(props: EmailVars) {
  const { customerName, storeName, shortCode, trackingUrl, storeAddress } = props

  return (
    <EmailDocument
      title={`Tu pedido ${shortCode} está listo — ${storeName}`}
      previewText={`${customerName}, tu pedido ${shortCode} ya está listo en ${storeName}.`}
    >
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Tu pedido está listo para retirar
        </Heading>
      </Section>

      <ShortCodeBlock label="Código de retiro" shortCode={shortCode} />

      <Section style={{ padding: '0 28px 24px' }}>
        <Text style={{ margin: 0, fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`${customerName}, mostrá este código en ${storeName} para retirarlo.`}
        </Text>
        {storeAddress ? (
          <Text style={{ margin: '8px 0 0', fontSize: 13, color: palette.muted }}>{storeAddress}</Text>
        ) : null}
      </Section>

      <Section style={{ padding: '0 28px 28px' }}>
        <TrackingButton href={trackingUrl}>Ver mi pedido</TrackingButton>
      </Section>

      <Footer>Si no reconocés este pedido, ignorá este mail.</Footer>
    </EmailDocument>
  )
}

OrderReadyEmail.PreviewProps = {
  customerName: 'Lucía',
  storeName: 'Burger Estación',
  storeSlug: 'burger-estacion',
  storeAddress: 'Av. Colón 1234, Córdoba',
  shortCode: 'K7QX',
  trackingUrl: 'https://burgershop.example.com/pedido/abc123',
  etaMinutes: null,
  paymentMethod: 'online',
  paymentPending: false,
  currency: 'ARS',
  items: [{ name: 'Doble cheddar', quantity: 2, totalCents: 960000 }],
  subtotalCents: 960000,
  totalCents: 960000,
} satisfies EmailVars
