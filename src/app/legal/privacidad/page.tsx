export const metadata = { title: 'Política de privacidad' }

const CONTACT_EMAIL = 'hola@comandapp.ar'

/**
 * Server Component estática, sin data fetching: la política describe lo que
 * el producto hace de verdad, no una plantilla genérica de estudio jurídico.
 *
 * Por eso NO se toca sin mirar el código: si cambian las claves de
 * `localStorage` (`src/lib/cart.tsx`, `src/lib/customer.ts`), el proveedor de
 * pago (`src/services/payments/`) o el de email (`src/services/notifications/`),
 * esta página queda mintiendo. La sección del comprobante de transferencia es
 * el ejemplo directo: los plazos de retención citados ahí tienen que coincidir
 * con las constantes de `src/app/api/cron/cleanup/route.ts` (T2.7).
 *
 * "El padrón del local" describe `store_customers` (`src/models/customer.model.ts`)
 * y la baja de `/baja/[token]`. A propósito NO promete un borrado autoservicio
 * ni un plazo de retención: hoy no existe ese camino de producto
 * (00-architecture.md §5.12.5.1) y prometerlo sería mentir. Si algún día se
 * construye una lista de supresión o un plazo real, esta sección se actualiza
 * recién ahí — no antes.
 */
export default function PrivacidadPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="display text-foreground text-3xl font-semibold sm:text-4xl">Política de privacidad</h1>
        <p className="text-muted-foreground text-sm">Última actualización: 31 de agosto de 2026.</p>
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
          <h2 className="text-xl font-semibold">El padrón del local</h2>
          <p>
            Cada local que te vendió algo guarda tu nombre, tu teléfono, tu email si lo dejaste, cuántos pedidos le
            hiciste, cuánto gastaste en total y la fecha de tu último pedido. Ese registro es <strong>por local</strong>:
            si le compraste a dos locales de la plataforma, cada uno tiene su propia fila con tus datos, y no se
            comparten entre sí.
          </p>
          <p>
            Si dejaste tu email, el local puede usarlo para mandarte promociones además del comprobante y el aviso
            de &ldquo;pedido listo&rdquo;. Todo mail de promoción trae un link para darte de baja, y esa baja es
            inmediata para los envíos que hace la plataforma en nombre del local — no para un mensaje que el local te
            mande a mano por WhatsApp, que queda fuera de nuestro control.
          </p>
          <p>
            Esta fila se conserva mientras el local use la plataforma. No tiene un plazo de borrado automático:
            es tu historial comercial con ese local, no un registro temporal.
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
          <h2 className="text-xl font-semibold">Si pagás por transferencia</h2>
          <p>
            Si elegís transferencia bancaria, te mostramos el CBU o alias del local recién en la pantalla de
            seguimiento de tu pedido — nunca antes de que el pedido exista. Ahí podés subir una foto o un PDF del
            comprobante, <strong>una sola vez</strong>: si subiste el archivo equivocado, esa misma pantalla te ofrece
            escribirle al local por WhatsApp para resolverlo.
          </p>
          <p>
            El comprobante se guarda en un almacenamiento privado que solo puede leer el staff de ese local — nunca
            vos de vuelta, ni otro local de la plataforma. Lo borramos 24 horas después de que el local confirma el
            pago, o a los 7 días si el pedido se cancela o queda sin confirmar. El registro de que subiste un
            comprobante (fecha, tamaño y una huella del archivo) queda igual después de ese borrado, aunque la
            imagen ya no exista.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Los emails</h2>
          <p>
            Si dejaste tu email, te mandamos el comprobante de tu pedido y el aviso de &ldquo;pedido listo&rdquo;
            usando Resend, nuestro proveedor de envío de emails. El local también puede usar ese email para mandarte
            promociones propias — ver &ldquo;El padrón del local&rdquo; más arriba para qué implica eso y cómo darte
            de baja.
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
