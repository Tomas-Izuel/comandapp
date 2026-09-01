import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, ShortCodeBlock, SpecRow, StoreBand, TrackingButton, palette } from './_shared'

export type StoreCouponCampaignVars = {
  storeName: string
  customerName: string
  /** Asunto que eligió el dueño (`coupon_campaigns.subject`). Es también el `<title>`/preview del mail. */
  subject: string
  /** Mensaje libre del dueño. React Email escapa el contenido al renderizar, así que no hace falta sanitizarlo acá. */
  message: string | null
  couponCode: string
  /** Ya formateado por `describeDiscount()` — "15% (hasta $3.000)" o "$1.860". */
  discountLabel: string
  /** `null` = sin vencimiento. Ya formateado, no una fecha cruda. */
  endsAtLabel: string | null
  /** Link a la vitrina del local (`storeUrl(slug, '/')`). */
  storeUrl: string
  /** La página humana de baja, `/baja/{token}` — va en el pie, ADEMÁS del header `List-Unsubscribe` que manda el servicio de envío. */
  unsubscribeUrl: string
}

/**
 * La novena plantilla: el mail de campaña de cupón (§5.10.4 del plan de
 * cupones y campañas).
 *
 * **No deja fila en `notifications`** — esa tabla exige `order_id` y una
 * campaña no tiene pedido. El log de la campaña es `campaign_recipients`
 * (`src/services/notifications/email/campaign.tsx` es quien lo escribe vía
 * `settle_campaign_recipient`).
 *
 * El pie de baja humano viaja acá ADEMÁS del header `List-Unsubscribe` +
 * `List-Unsubscribe-Post` que arma el servicio de envío: los clientes de mail
 * que no muestran el botón de "Cancelar suscripción" del header (la mayoría
 * en mobile) solo tienen este link para encontrar la baja.
 */
export default function StoreCouponCampaignEmail(props: StoreCouponCampaignVars) {
  const { storeName, customerName, subject, message, couponCode, discountLabel, endsAtLabel, storeUrl, unsubscribeUrl } =
    props

  const specs = [
    { label: 'Descuento', value: discountLabel },
    ...(endsAtLabel ? [{ label: 'Vale hasta', value: endsAtLabel }] : []),
  ]

  return (
    <EmailDocument title={`${subject} — ${storeName}`} previewText={`${discountLabel} de descuento en ${storeName}.`}>
      <StoreBand storeName={storeName} />

      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          {subject}
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`Hola ${customerName}, tenemos un cupón para vos en ${storeName}.`}
        </Text>
        {message ? (
          <Text style={{ margin: '10px 0 0', fontSize: 14, lineHeight: '1.6', color: palette.ink, whiteSpace: 'pre-wrap' }}>
            {message}
          </Text>
        ) : null}
      </Section>

      <ShortCodeBlock label="Tu código" shortCode={couponCode} />

      <Section style={{ padding: '0 28px 20px' }}>
        <SpecRow specs={specs} />
      </Section>

      <LabelRule />

      <Section style={{ padding: '20px 28px 8px' }}>
        <TrackingButton href={storeUrl}>Ver el menú</TrackingButton>
      </Section>

      <Footer>
        Este mail es una promoción de {storeName}, no un comprobante de compra.{' '}
        <a href={unsubscribeUrl} style={{ color: palette.faint, textDecoration: 'underline' }}>
          Dejar de recibir promos de este local
        </a>
        .
      </Footer>
    </EmailDocument>
  )
}

StoreCouponCampaignEmail.PreviewProps = {
  storeName: 'Burger Estación',
  customerName: 'Lucía',
  subject: 'Volvé a Burger Estación con 15% off',
  message: 'Te extrañamos por acá. Este finde tenés 15% en todo el menú, sin mínimo de compra.',
  couponCode: 'VOLVE15',
  discountLabel: '15% (hasta $3.000)',
  endsAtLabel: '10 de septiembre',
  storeUrl: 'https://burgershop.example.com/burger-estacion',
  unsubscribeUrl: 'https://burgershop.example.com/baja/abc123token',
} satisfies StoreCouponCampaignVars
