export const metadata = { title: 'Política de privacidad' }

const CONTACT_EMAIL = 'tomasizuel@gmail.com'

/**
 * Server Component estática, sin data fetching: la política describe lo que
 * el producto hace de verdad, no una plantilla genérica de estudio jurídico.
 *
 * Por eso NO se toca sin mirar el código: si cambian las claves de
 * `localStorage` (`src/lib/cart.tsx`, `src/lib/customer.ts`), el proveedor de
 * pago (`src/services/payments/`) o el de email (`src/services/notifications/`),
 * esta página queda mintiendo.
 */
export default function PrivacidadPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="display text-foreground text-3xl font-semibold sm:text-4xl">Política de privacidad</h1>
        <p className="text-muted-foreground text-sm">Última actualización: 28 de agosto de 2026.</p>
      </header>

      <div className="text-foreground flex flex-col gap-8 text-base leading-relaxed">
        <p>
          Esta plataforma es la web de pedidos de tu local de hamburguesas. Acá te contamos qué datos pedimos
          cuando hacés un pedido, para qué los usamos y quién los ve.
        </p>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Qué datos pedimos</h2>
          <p>
            Para hacer un pedido te pedimos tu nombre y tu teléfono, siempre. El email es opcional. Si el pedido es
            con delivery, también te pedimos la dirección de entrega.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Quién ve tus datos</h2>
          <p>
            Tu pedido y sus datos de contacto quedan asociados al local que lo recibe. Ese local ve los datos de
            contacto de sus propios pedidos, para poder prepararlo y entregártelo. No se comparten con otros
            locales de la plataforma.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Qué guardamos en tu navegador</h2>
          <p>
            En el almacenamiento local de tu navegador (<code>localStorage</code>) guardamos tu carrito, los datos
            de contacto que dejaste para no volver a pedírtelos, y los pedidos que hiciste desde ese dispositivo
            (bajo las claves <code>burger-shop.cart.*</code>, <code>burger-shop.customer</code>,{' '}
            <code>burger-shop.orders</code> y <code>burger-shop.idempotency.*</code>). No son cookies de publicidad
            ni de seguimiento entre sitios: solo sirven para que tu propia carta y tus propios pedidos te esperen
            la próxima vez que entrás.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">El pago</h2>
          <p>
            El pago lo procesa Mercado Pago. Los datos de tu tarjeta se ingresan ahí, nunca pasan por esta
            plataforma ni se guardan acá.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Los emails</h2>
          <p>
            Si dejaste tu email, te mandamos el comprobante de tu pedido y el aviso de &ldquo;pedido listo&rdquo;
            usando Resend, nuestro proveedor de envío de emails.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Dónde vive todo esto</h2>
          <p>
            La base de datos corre sobre Supabase y la aplicación sobre Vercel.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">El link de tu pedido es secreto</h2>
          <p>
            El link para seguir tu pedido (algo como <code>/pedido/&lt;token&gt;</code>) es secreto: cualquiera que
            lo tenga puede ver ese pedido. No conviene compartirlo con quien no debería ver tus datos ni tu
            dirección.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Tus derechos</h2>
          <p>
            Podés pedirnos acceder, corregir o borrar tus datos escribiéndonos a{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
            . Esto se enmarca en la Ley 25.326 de Protección de Datos Personales de Argentina.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Contacto</h2>
          <p>
            Cualquier consulta sobre tus datos o esta política, escribinos a{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  )
}
