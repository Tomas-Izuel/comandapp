import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, SpecRow, StoreBand, palette } from './_shared'

export type StorePaymentChangeNoticeVars = {
  storeName: string
  /** Qué se pidió cambiar. */
  changeLabel: string
  /** Quién lo pidió, para que el dueño reconozca (o no) el movimiento. */
  requestedByEmail: string
  /** Cuándo, ya formateado en la zona del local. */
  requestedAtLabel: string
}

/**
 * Aviso de que ALGUIEN pidió cambiar la configuración de pagos. Va sin código,
 * a la misma casilla del dueño.
 *
 * Es lo que convierte el mecanismo de un candado en una alarma. El código solo
 * frena el cambio; este mail es lo que hace que el dueño se entere de que
 * alguien tiene su sesión, incluso si el intento no prospera. Sin esto, un
 * atacante que no adivina el código no deja rastro visible para nadie.
 *
 * Por eso son dos mails y no un párrafo más en el otro: el del código se
 * escribe para quien está haciendo el cambio, y este para quien no lo está
 * haciendo.
 */
export default function StorePaymentChangeNoticeEmail(props: StorePaymentChangeNoticeVars) {
  const { storeName, changeLabel, requestedByEmail, requestedAtLabel } = props

  return (
    <EmailDocument
      title={`Movimiento en los pagos de ${storeName}`}
      previewText={`Alguien pidió cambiar ${changeLabel} en ${storeName}.`}
    >
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Alguien pidió cambiar tus pagos
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`Se pidió cambiar ${changeLabel} en ${storeName}. El cambio NO se aplicó: necesita el código que te mandamos en un mail aparte.`}
        </Text>
      </Section>

      <SpecRow
        specs={[
          { label: 'Lo pidió', value: requestedByEmail },
          { label: 'Cuándo', value: requestedAtLabel },
        ]}
      />

      <LabelRule />

      <Section style={{ padding: '0 28px 24px' }}>
        <Text style={{ margin: 0, fontSize: 13, lineHeight: '1.55', color: palette.body }}>
          <strong style={{ color: palette.ink }}>Si fuiste vos</strong>, ignorá este mail y usá el código.
        </Text>
        <Text style={{ margin: '10px 0 0', fontSize: 13, lineHeight: '1.55', color: palette.body }}>
          <strong style={{ color: palette.ink }}>Si no fuiste vos</strong>, alguien tiene acceso al panel de tu local.
          Cerrá la sesión en los dispositivos del local y escribinos: mientras no uses el código, la plata sigue
          entrando a tu cuenta de siempre.
        </Text>
      </Section>

      <Footer>Este aviso sale cada vez que se pide un cambio en los pagos, se complete o no.</Footer>
    </EmailDocument>
  )
}

StorePaymentChangeNoticeEmail.PreviewProps = {
  storeName: 'Burger Estación',
  changeLabel: 'la cuenta de Mercado Pago donde recibís los cobros',
  requestedByEmail: 'dueno@burgerestacion.com.ar',
  requestedAtLabel: '28 de agosto, 21:14',
} satisfies StorePaymentChangeNoticeVars
