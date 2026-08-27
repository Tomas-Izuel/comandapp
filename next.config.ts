import type { NextConfig } from 'next'

/**
 * Los hosts de imagen salen de la URL de Supabase en vez de estar hardcodeados,
 * porque cambian entre local, preview y producción. Sin esto, `next/image`
 * rechaza las fotos de producto y hay que caer a `<img>` plano, perdiendo el
 * redimensionado — que importa mucho acá: las fotos las sube el dueño del local
 * desde el celular y pesan varios MB.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] = []

if (supabaseUrl) {
  const { protocol, hostname, port } = new URL(supabaseUrl)
  remotePatterns.push({
    protocol: protocol.replace(':', '') as 'http' | 'https',
    hostname,
    port: port || undefined,
    pathname: '/storage/v1/object/public/**',
  })
}

/**
 * Headers de seguridad (S-10). Nada impedía hoy embeber /admin (un KDS con
 * botones de un toque) o /backoffice en un iframe ajeno, y sin Referrer-Policy
 * el `public_token` del pedido —la ÚNICA credencial de acceso, viaja en la
 * URL— se filtraba a cualquier destino externo por el header `Referer`.
 *
 * `frame-ancestors 'none'` va como CSP real (no Report-Only) junto al
 * `X-Frame-Options` legacy: a diferencia de `script-src`/`style-src`, esta
 * directiva no toca nada que dependa del <style> inline del tema de marca, así
 * que se puede activar de una sin nonce y sin riesgo de romper el theming.
 */
/**
 * CSP completa — deliberadamente NO activada.
 *
 * `buildThemeCss()` inyecta el tema de marca como <style> inline en
 * [store]/layout.tsx y pedido/[token]/page.tsx: un `style-src` estricto sin
 * 'unsafe-inline' rompe el theming de todas las tiendas de una. La forma
 * correcta es un nonce por request, y next.config.ts no puede generarlo: los
 * headers acá son estáticos, calculados en build. El nonce tiene que salir de
 * `proxy.ts` (dueño: otro agente) — ver el reporte final del slice de layout
 * compartido para el pedido exacto.
 *
 * Con el nonce viajando en un header propio (p. ej. `x-nonce`, seteado por
 * `proxy.ts`) y ese mismo valor puesto en el <style nonce={...}> de esas dos
 * rutas, la política pasaría a esta forma (armada en el propio proxy, que sí
 * corre por request, no en esta función estática):
 *
 * `default-src 'self'; style-src 'self' 'nonce-<NONCE>'; script-src 'self';
 *  img-src 'self' https: data:; connect-src 'self' https://api.mercadopago.com;
 *  frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
 */
async function headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        // `frame-ancestors` no depende de nonce ni toca script-src/style-src:
        // se puede activar de una, a diferencia de la CSP completa de más abajo.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Nada de este producto usa cámara, micrófono, geolocalización ni
        // sensores; y el pago pasa por un redirect a Checkout Pro, no por un
        // iframe propio, así que `payment` tampoco hace falta acá.
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
        },
      ],
    },
    {
      // El public_token de un pedido es su única credencial y viaja en esta
      // URL. `strict-origin-when-cross-origin` ya no manda el path a otro
      // origen, pero un link de esta página compartido en WhatsApp o pegado
      // en un ticket de soporte igual dispara un Referer con el token puesto.
      // Va después del bloque global para que gane (Next.js: last match wins
      // cuando dos configuraciones tocan la misma clave).
      source: '/pedido/:token*',
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    },
  ]
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
    // El catálogo se ve casi siempre en un celular; no hace falta servir 3840px.
    deviceSizes: [360, 420, 640, 828, 1080, 1200, 1920],
  },
  headers,
}

export default nextConfig
