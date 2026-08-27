import { Heading, Section, Text } from '@react-email/components'
import { formatCentsCompact } from '@/lib/money'
import type { EmailVars } from '@/services/notifications/email/email.port'
import { EmailDocument, Footer, LabelRule, SpecRow, ShortCodeBlock, StoreBand, TrackingButton, palette } from './_shared'

/**
 * Comprobante del pedido. Se manda al confirmarse el pago (o al confirmarse
 * el pedido, si se paga en el local — ver `paymentPending`).
 *
 * Regla dura: si `paymentPending` es true, esto NO puede leerse como un
 * recibo de algo ya cobrado. Es la diferencia entre "gracias por tu pago" y
 * "confirmamos tu pedido, pagás al retirar" — mentir ahí es el tipo de cosa
 * que genera un reclamo en el mostrador.
 */
export default function OrderReceiptEmail(props: EmailVars) {
  const {
    customerName,
    storeName,
    shortCode,
    trackingUrl,
    etaMinutes,
    paymentPending,
    currency,
    items,
    subtotalCents,
    totalCents,
    storeAddress,
  } = props

  const money = (cents: number) => formatCentsCompact(cents, currency)

  const pickupSpecs = [
    { label: 'Entrega', value: 'Retiro en el local' },
    ...(etaMinutes ? [{ label: 'Listo en', value: `${etaMinutes} min` }] : []),
  ]

  return (
    <EmailDocument
      title={`Comprobante del pedido ${shortCode} — ${storeName}`}
      previewText={
        paymentPending
          ? `Pedido ${shortCode} confirmado. Pagás al retirar. Total ${money(totalCents)}.`
          : `Pago recibido. Pedido ${shortCode} por ${money(totalCents)}, ya lo estamos preparando.`
      }
    >
      <StoreBand storeName={storeName} />

      <ShortCodeBlock label="Código de retiro" shortCode={shortCode} />

      <Section style={{ padding: '4px 28px 0' }}>
        <Heading as="h1" style={{ margin: '4px 0 8px', fontSize: 20, lineHeight: '1.25', color: palette.ink, fontWeight: 800 }}>
          {paymentPending ? `¡Gracias, ${customerName}!` : `¡Pago recibido, ${customerName}!`}
        </Heading>
        <Text style={{ margin: '0 0 16px', fontSize: 14, lineHeight: '1.55', color: palette.body }}>
          {paymentPending
            ? `Confirmamos tu pedido en ${storeName}. Ya lo estamos preparando.`
            : `Confirmamos tu pago y ya estamos preparando tu pedido en ${storeName}.`}
        </Text>
      </Section>

      {/* Estado de pago: es la parte que no puede mentir. Jerarquía por
          tipografía y espacio — un borderLeft con acento es el default
          decorativo que el craft floor rechaza, así que la etiqueta se
          distingue por color de texto y tracking, no por una caja. */}
      <Section style={{ padding: '4px 28px 20px' }}>
        <Text
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: paymentPending ? palette.accent : palette.ink,
          }}
        >
          {paymentPending ? 'Pagás al retirar' : 'Pago confirmado online'}
        </Text>
        {paymentPending ? (
          <Text style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '1.5', color: palette.body }}>
            Este mail confirma el pedido, no un cobro. Abonás {money(totalCents)} en el local.
          </Text>
        ) : null}
      </Section>

      <LabelRule />

      {/* Detalle de ítems: tabla de datos genuina, sin role="presentation". */}
      <Section style={{ padding: '0 28px' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                scope="col"
                align="left"
                style={{
                  padding: '0 0 8px',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: palette.faint,
                  fontWeight: 600,
                }}
              >
                Producto
              </th>
              <th
                scope="col"
                align="right"
                style={{
                  padding: '0 0 8px',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: palette.faint,
                  fontWeight: 600,
                }}
              >
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.name}-${index}`}>
                <td style={{ padding: '8px 0', borderTop: `1px solid ${palette.border}`, verticalAlign: 'top' }}>
                  <Text style={{ margin: 0, fontSize: 14, color: palette.ink, fontWeight: 600 }}>
                    {item.quantity} × {item.name}
                  </Text>
                  {item.options && item.options.length > 0 ? (
                    <Text style={{ margin: '2px 0 0', fontSize: 12, color: palette.muted }}>
                      {item.options.join(', ')}
                    </Text>
                  ) : null}
                </td>
                <td
                  style={{
                    padding: '8px 0',
                    borderTop: `1px solid ${palette.border}`,
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                  }}
                  align="right"
                >
                  <Text style={{ margin: 0, fontSize: 14, color: palette.ink, fontWeight: 600 }}>
                    {money(item.totalCents)}
                  </Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section style={{ padding: '16px 28px 0' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '2px 0' }}>
                <Text style={{ margin: 0, fontSize: 13, color: palette.body }}>Subtotal</Text>
              </td>
              <td style={{ padding: '2px 0' }} align="right">
                <Text style={{ margin: 0, fontSize: 13, color: palette.body }}>{money(subtotalCents)}</Text>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0 0' }}>
                <Text style={{ margin: 0, fontSize: 16, color: palette.ink, fontWeight: 800 }}>Total</Text>
              </td>
              <td style={{ padding: '8px 0 0' }} align="right">
                <Text style={{ margin: 0, fontSize: 16, color: palette.ink, fontWeight: 800 }}>
                  {money(totalCents)}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      {storeAddress ? (
        <Section style={{ padding: '16px 28px 0' }}>
          <Text style={{ margin: 0, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: palette.faint, fontWeight: 600 }}>
            Retirás en
          </Text>
          <Text style={{ margin: '2px 0 0', fontSize: 13, color: palette.body }}>{storeAddress}</Text>
        </Section>
      ) : null}

      <Section style={{ padding: '16px 28px 24px' }}>
        <SpecRow specs={pickupSpecs} />
      </Section>

      <Section style={{ padding: '0 28px 28px' }}>
        <TrackingButton href={trackingUrl}>Seguir mi pedido</TrackingButton>
      </Section>

      <Footer>
        Si no reconocés este pedido, ignorá este mail: no se te va a cobrar nada por acá. Ante cualquier duda,
        escribinos por WhatsApp desde el link de seguimiento.
      </Footer>
    </EmailDocument>
  )
}

OrderReceiptEmail.PreviewProps = {
  customerName: 'Lucía',
  storeName: 'Burger Estación',
  storeSlug: 'burger-estacion',
  storeAddress: 'Av. Colón 1234, Córdoba',
  shortCode: 'K7QX',
  trackingUrl: 'https://burgershop.example.com/pedido/abc123',
  etaMinutes: 25,
  paymentMethod: 'online',
  paymentPending: false,
  currency: 'ARS',
  items: [
    { name: 'Doble cheddar', quantity: 2, totalCents: 960000, options: ['Sin cebolla', 'Punto jugoso'] },
    { name: 'Papas grandes', quantity: 1, totalCents: 280000 },
    { name: 'Gaseosa línea', quantity: 2, totalCents: 240000 },
  ],
  subtotalCents: 1480000,
  totalCents: 1480000,
} satisfies EmailVars
