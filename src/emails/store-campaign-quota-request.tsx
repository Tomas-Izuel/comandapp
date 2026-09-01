import { Heading, Section, Text } from '@react-email/components'
import { EmailDocument, Footer, LabelRule, SpecRow, palette } from './_shared'

export type StoreCampaignQuotaRequestVars = {
  storeName: string
  storeSlug: string
  storeId: number
  /** Quién pide, para poder responderle (`replyTo` en el envío). */
  ownerEmail: string
  /** Clientes en el padrón, y cuántos tienen mail cargado — el tamaño real de la lista. */
  customersTotal: number
  customersWithEmail: number
  /** Destinatarios de la campaña que el dueño quiso mandar — la demanda concreta. */
  campaignRecipients: number
  /** Días que tarda esa campaña con el cupo de hoy (`campaignDaysNeeded()`). */
  daysNeeded: number
  /** Si ya le está funcionando: cupones activos y canjes del último mes. */
  activeCoupons: number
  redemptionsLastMonth: number
  /** Lo que escribió el dueño. Opcional: el pedido sirve igual sin texto. */
  message: string | null
}

/**
 * La décima plantilla: el pedido de más cupo de campaña (§5.10.6 del plan de
 * cupones), cuando `CAMPAIGN_DAILY_BUDGET` (15/día) no alcanza.
 *
 * Mismo criterio que `store-payment-support`: no usa `StoreBand` porque este
 * mail no va al dueño, va a ventas — la banda con el nombre del local arriba
 * de todo haría parecer que es una notificación del local, y acá el local es
 * un dato del cuerpo, no la identidad del mensaje.
 *
 * **Plantilla nueva y no `store-payment-support` parametrizada**: el payload
 * es distinto (seis números, no un mensaje suelto) y el destino es otro
 * (`SALES_EMAIL`, no `SUPPORT_EMAIL`) — parametrizar convertiría el asunto y
 * el ruteo en un switch dentro de una plantilla que hoy hace una sola cosa
 * bien.
 *
 * Los seis números van primero y el mensaje libre al final a propósito: la
 * conversación tiene que empezar con datos ("142 destinatarios, 10 días"), no
 * con "quiero más mails".
 */
export default function StoreCampaignQuotaRequestEmail(props: StoreCampaignQuotaRequestVars) {
  const {
    storeName,
    storeSlug,
    storeId,
    ownerEmail,
    customersTotal,
    customersWithEmail,
    campaignRecipients,
    daysNeeded,
    activeCoupons,
    redemptionsLastMonth,
    message,
  } = props

  return (
    <EmailDocument
      title={`Pedido de más cupo de campaña — ${storeName}`}
      previewText={`${storeName} quiere mandar a ${campaignRecipients} personas y con el cupo de hoy tarda ${daysNeeded} días.`}
    >
      <Section style={{ padding: '28px 28px 0' }}>
        <Heading as="h1" style={{ margin: 0, fontSize: 22, lineHeight: '1.2', color: palette.ink, fontWeight: 800 }}>
          Pedido de más cupo de campaña
        </Heading>
        <Text style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {`${storeName} pidió ampliar el cupo de campaña desde el preview de una campaña de cupón.`}
        </Text>
      </Section>

      <SpecRow
        specs={[
          { label: 'Local', value: `${storeName} (/${storeSlug} · #${storeId})` },
          { label: 'Lo pidió', value: ownerEmail },
        ]}
      />

      <LabelRule />

      <Section style={{ padding: '0 28px 4px' }}>
        <SpecRow
          specs={[
            { label: 'Padrón', value: `${customersTotal} (${customersWithEmail} con mail)` },
            { label: 'Quiere mandar a', value: `${campaignRecipients}` },
            { label: 'Tarda', value: `${daysNeeded} días` },
          ]}
        />
      </Section>

      <Section style={{ padding: '16px 28px 24px' }}>
        <SpecRow
          specs={[
            { label: 'Cupones activos', value: `${activeCoupons}` },
            { label: 'Canjes último mes', value: `${redemptionsLastMonth}` },
          ]}
        />
      </Section>

      <LabelRule />

      <Section style={{ padding: '0 28px 24px' }}>
        {message ? (
          <Text style={{ margin: 0, fontSize: 14, lineHeight: '1.6', color: palette.ink, whiteSpace: 'pre-wrap' }}>
            {message}
          </Text>
        ) : (
          <Text style={{ margin: 0, fontSize: 13, lineHeight: '1.55', color: palette.muted }}>
            No dejó un mensaje: pidió el cupo desde el preview de la campaña sin escribir nada.
          </Text>
        )}
      </Section>

      <Footer>Respondé a este mail y le llega directo a quien lo pidió.</Footer>
    </EmailDocument>
  )
}

StoreCampaignQuotaRequestEmail.PreviewProps = {
  storeName: 'Burger Estación',
  storeSlug: 'burger-estacion',
  storeId: 12,
  ownerEmail: 'dueno@burgerestacion.com.ar',
  customersTotal: 340,
  customersWithEmail: 142,
  campaignRecipients: 142,
  daysNeeded: 10,
  activeCoupons: 2,
  redemptionsLastMonth: 58,
  message: 'Nos está yendo bien con los cupones, ¿tienen algún plan con más cupo de mail?',
} satisfies StoreCampaignQuotaRequestVars
