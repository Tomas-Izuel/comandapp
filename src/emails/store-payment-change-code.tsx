import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, ShortCodeBlock, StoreBand, palette } from './_shared'

export type StorePaymentChangeCodeVars = {
  storeName: string
  /** Código de 6 dígitos. Vence en 10 minutos. */
  code: string
  /** Qué se está por cambiar, en una línea que el dueño entienda sin saber cómo se llama la columna. */
  changeLabel: string
}

/**
 * Código para confirmar un cambio que toca plata.
 *
 * Usa `ShortCodeBlock` —la misma pieza con la que el cliente lee el código de
 * su pedido— y no un bloque propio: es exactamente el mismo trabajo visual
 * (leer seis caracteres de una pantalla y tipearlos en otra) y el sistema ya lo
 * resolvió una vez.
 *
 * Sin botón ni link a propósito. Un mail de confirmación que trae su propio
 * link es un mail que, reenviado o filtrado, ES la llave. Acá el código no
 * sirve sin la sesión abierta en el formulario que lo pidió.
 */
export default function StorePaymentChangeCodeEmail(props: StorePaymentChangeCodeVars) {
  const { storeName, code, changeLabel } = props

  return (
    <EmailDocument
      title={`Tu código para ${storeName}`}
      previewText={`Código ${code} para confirmar un cambio en los pagos de ${storeName}.`}
    >
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Confirmá el cambio en tus pagos
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`Pediste cambiar ${changeLabel} en ${storeName}. Escribí este código en la pantalla donde lo pediste para que el cambio se aplique.`}
        </Text>
      </Section>

      <ShortCodeBlock label="Tu código" shortCode={code} />

      <LabelRule />

      <Section style={{ padding: '0 28px 24px' }}>
        <Text style={{ margin: 0, fontSize: 12, lineHeight: '1.5', color: palette.muted }}>
          El código vence en 10 minutos y sirve una sola vez.
        </Text>
        <Text style={{ margin: '10px 0 0', fontSize: 12, lineHeight: '1.5', color: palette.muted }}>
          <strong style={{ color: palette.ink }}>Si no fuiste vos, no lo uses.</strong> Sin este código no se cambia
          nada, pero significa que alguien más está entrando a tu panel: cerrá la sesión en los dispositivos del local y
          escribinos.
        </Text>
      </Section>

      <Footer>Nunca te vamos a pedir este código por teléfono ni por WhatsApp.</Footer>
    </EmailDocument>
  )
}

StorePaymentChangeCodeEmail.PreviewProps = {
  storeName: 'Burger Estación',
  code: '408315',
  changeLabel: 'la cuenta de Mercado Pago donde recibís los cobros',
} satisfies StorePaymentChangeCodeVars
