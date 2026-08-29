import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, SpecRow, palette } from './_shared'

export type StorePaymentSupportVars = {
  storeName: string
  storeSlug: string
  storeId: number
  /** Quién pide ayuda y con qué rol. El destinatario tiene que poder responderle. */
  requestedByEmail: string
  requestedByRole: 'owner' | 'staff'
  /** Estado de la conexión con Mercado Pago al momento del pedido: la primera pregunta que haría soporte. */
  connectionLabel: string
  /** Lo que escribió el dueño. Opcional: el botón sirve igual sin texto. */
  message: string | null
}

/**
 * Pedido de ayuda para conectar Mercado Pago, del panel del local a soporte.
 *
 * No usa `StoreBand` como los otros: este mail no va al dueño, va a soporte, y
 * la banda con el nombre del local arriba de todo haría parecer que es una
 * notificación del local. Acá el local es un dato del cuerpo, no la identidad
 * del mensaje.
 *
 * `message` lo escribe el dueño. React Email escapa el texto al renderizar, así
 * que no hace falta sanitizarlo acá — pero por eso mismo va como `<Text>` y
 * nunca dentro de un `dangerouslySetInnerHTML`.
 */
export default function StorePaymentSupportEmail(props: StorePaymentSupportVars) {
  const { storeName, storeSlug, storeId, requestedByEmail, requestedByRole, connectionLabel, message } = props

  return (
    <EmailDocument
      title={`Soporte de pagos — ${storeName}`}
      previewText={`${storeName} pide ayuda para conectar Mercado Pago.`}
    >
      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Pedido de soporte: Mercado Pago
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`${storeName} pidió ayuda desde la pantalla de Pagos de su panel.`}
        </Text>
      </Section>

      <SpecRow
        specs={[
          { label: 'Local', value: `${storeName} (/${storeSlug} · #${storeId})` },
          { label: 'Lo pidió', value: `${requestedByEmail} · ${requestedByRole === 'owner' ? 'dueño' : 'staff'}` },
          { label: 'Mercado Pago', value: connectionLabel },
        ]}
      />

      <LabelRule />

      <Section style={{ padding: '0 28px 24px' }}>
        {message ? (
          <Text
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: '1.6',
              color: palette.ink,
              whiteSpace: 'pre-wrap',
            }}
          >
            {message}
          </Text>
        ) : (
          <Text style={{ margin: 0, fontSize: 13, lineHeight: '1.55', color: palette.muted }}>
            No dejó un mensaje: apretó el botón de ayuda sin escribir nada.
          </Text>
        )}
      </Section>

      <Footer>Respondé a este mail y le llega directo a quien lo pidió.</Footer>
    </EmailDocument>
  )
}

StorePaymentSupportEmail.PreviewProps = {
  storeName: 'Burger Estación',
  storeSlug: 'burger-estacion',
  storeId: 12,
  requestedByEmail: 'dueno@burgerestacion.com.ar',
  requestedByRole: 'owner',
  connectionLabel: 'Sin conectar',
  message: 'No encuentro dónde sacar el access token de producción, en el panel de MP solo me aparece el de prueba.',
} satisfies StorePaymentSupportVars
