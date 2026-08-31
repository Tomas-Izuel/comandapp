export const metadata = { title: 'Términos y condiciones' }

const CONTACT_EMAIL = 'hola@comandapp.ar'

/**
 * Server Component estática, sin data fetching. Texto claro sobre lo que el
 * producto hace de verdad, no cláusulas genéricas de relleno.
 */
export default function TerminosPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="display text-foreground text-3xl font-semibold sm:text-4xl">Términos y condiciones</h1>
        <p className="text-muted-foreground text-sm">Última actualización: 28 de agosto de 2026.</p>
      </header>

      <div className="text-foreground flex flex-col gap-8 text-base leading-relaxed">
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Qué es este servicio</h2>
          <p>
            Esta plataforma provee la web de pedidos. Quien prepara, vende y entrega la comida es el local: es el
            responsable del producto, los precios, el horario de atención y la entrega.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Precios y disponibilidad</h2>
          <p>
            Cada local define sus propios precios y qué tiene disponible, y pueden cambiar sin aviso previo. El
            total de tu pedido se calcula siempre en nuestro servidor en el momento de confirmarlo, así que el
            precio que pagás es el vigente en ese instante.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Tiempos de entrega</h2>
          <p>
            Los tiempos de entrega que te mostramos son estimados, no una garantía. Pueden variar según cuánto
            trabajo tenga la cocina en ese momento.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Cancelaciones, reclamos y devoluciones</h2>
          <p>
            Todo eso se resuelve directamente con el local: es quien conoce tu pedido y puede resolverlo. Cuando
            corresponde un reembolso de un pago hecho online, se procesa a través de Mercado Pago.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Uso aceptable</h2>
          <p>
            No hagas pedidos falsos ni intentes vulnerar el funcionamiento del servicio. Un uso de mala fe puede
            hacer que se te niegue el acceso.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Contacto</h2>
          <p>
            Cualquier consulta sobre estos términos, escribinos a{' '}
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
