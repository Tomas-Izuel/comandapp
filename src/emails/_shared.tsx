import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from '@react-email/components'

/**
 * Gramática de etiqueta, reimplementada para email.
 *
 * `src/views/shared/label.tsx` es la referencia de la que esto es traducción:
 * misma idea (banda de color a sangre, cantos vivos, nombre grande, fila de
 * datos duros monoespaciada) pero con tablas y estilos en línea en vez de
 * flexbox/grid, porque Outlook usa el motor de Word y descarta casi todo lo
 * moderno. NO se importa `label.tsx` acá — un email no puede depender de
 * clases de Tailwind del sitio ni de CSS externo.
 *
 * La paleta es la de `store_branding` SIN personalizar (columnas
 * `color_primary`/`color_foreground`/`color_background` con sus defaults:
 * ver `20260825120000_init_schema.sql`). `EmailVars` no trae el color de la
 * tienda, así que estos correos no se tiñen por local — usan el mismo punto
 * de partida que ve cualquier tienda nueva antes de personalizar su marca.
 * Es la misma paleta que ya usa `supabase/templates/magic-link.html`.
 */
export const palette = {
  ink: '#0a0a0a',
  accent: '#f97316',
  accentForeground: '#ffffff',
  paper: '#f6f6f4',
  card: '#ffffff',
  border: '#e4e4e0',
  body: '#57534e',
  muted: '#78716c',
  faint: '#a8a29e',
} as const

const fontStack =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
/** Aproxima la cara de display (condensada, caja alta) sin depender de una
 * fuente de Google que Gmail/Outlook no van a cargar. */
const displayFontStack = `Arial Black,Arial,${fontStack}`
const monoStack = "'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace"

/**
 * Envoltorio de documento: `lang`/`dir` en `<html>` Y en el primer hijo de
 * `<body>` (varios clientes tiran el atributo de `<html>`), `<title>`
 * explícito (la versión instalada de `Preview` no lo emite sola) y ancho de
 * layout fijo a 480px, mismo breakpoint que `magic-link.html`.
 */
export function EmailDocument({
  title,
  previewText,
  children,
}: {
  title: string
  previewText: string
  children: React.ReactNode
}) {
  return (
    <Html lang="es-AR" dir="ltr">
      <Head>
        <title>{title}</title>
      </Head>
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Preview>{previewText}</Preview>
        <Body
          lang="es-AR"
          dir="ltr"
          style={{ backgroundColor: palette.paper, margin: 0, padding: '32px 0', fontFamily: fontStack }}
        >
          <Container
            style={{
              maxWidth: 480,
              width: '100%',
              backgroundColor: palette.card,
              border: `1px solid ${palette.border}`,
            }}
          >
            {children}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

/** Banda a sangre con el nombre del local — línea de productor, arriba de todo. */
export function StoreBand({ storeName }: { storeName: string }) {
  return (
    <Section style={{ backgroundColor: palette.ink, padding: '18px 28px' }}>
      <Text
        style={{
          margin: 0,
          color: palette.accentForeground,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {storeName}
      </Text>
    </Section>
  )
}

/** Código de mostrador: lo único que hace falta cantar en el local. Grande, condensado, caja alta. */
export function ShortCodeBlock({ label, shortCode }: { label: string; shortCode: string }) {
  return (
    <Section style={{ padding: '28px 28px 4px' }}>
      <Text
        style={{
          margin: '0 0 4px',
          color: palette.muted,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          margin: 0,
          color: palette.ink,
          fontFamily: displayFontStack,
          fontSize: 56,
          lineHeight: '0.95',
          letterSpacing: '-0.01em',
          textTransform: 'uppercase',
          fontWeight: 800,
        }}
      >
        {shortCode}
      </Text>
    </Section>
  )
}

/** Fila de datos duros monoespaciada: mismo rol que `SpecRow` en el sitio. */
export function SpecRow({ specs }: { specs: { label: string; value: string }[] }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          {specs.map((spec) => (
            <td key={spec.label} style={{ paddingRight: 20, verticalAlign: 'baseline' }}>
              <span
                style={{
                  fontFamily: monoStack,
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: palette.faint,
                }}
              >
                {spec.label}{' '}
              </span>
              <span style={{ fontFamily: monoStack, fontSize: 11, fontWeight: 700, color: palette.ink }}>
                {spec.value}
              </span>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

export function LabelRule() {
  return <Hr style={{ borderColor: palette.border, borderStyle: 'solid', margin: '20px 0' }} />
}

/** Botón de acción primaria: cantos vivos (sin `rounded`), campo de color a sangre en su celda. */
export function TrackingButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td style={{ backgroundColor: palette.accent }}>
            <a
              href={href}
              style={{
                display: 'inline-block',
                padding: '14px 28px',
                color: palette.accentForeground,
                fontSize: 15,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function Footer({ children }: { children: React.ReactNode }) {
  return (
    <Section style={{ padding: '20px 28px 28px', borderTop: `1px solid ${palette.border}` }}>
      <Text style={{ margin: 0, fontSize: 12, lineHeight: '1.5', color: palette.faint }}>{children}</Text>
    </Section>
  )
}

export const styles = { fontStack, displayFontStack, monoStack }
