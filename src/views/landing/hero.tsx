import { WhatsApp } from '@/components/ui/whatsapp'
import { formatCentsCompact } from '@/lib/money'
import { PRICING, whatsappHref } from '@/lib/landing'
import { HeroFlow } from '@/views/landing/hero-flow'

/**
 * El hero: titular, párrafo de apoyo, precio y dos botones a la izquierda;
 * la escena del flujo del pedido a la derecha. Debajo, la franja que
 * reemplaza la tira de logos de clientes que traía la referencia — acá no
 * hay clientes que mostrar, así que son dos hechos verificables del producto
 * en su lugar.
 *
 * Ronda 3 (2026-09-02, "el hero es la demo"): el dueño del producto pidió
 * reemplazar el hero entero — el titular partido por GSAP quedaba recortado
 * a una línea, las tres tarjetas del ticket no llegaban a aparecer, y la
 * columna derecha era una captura recortada del celular que no explicaba
 * nada. Ahora el titular es texto ESTÁTICO (sin GSAP, sin `SplitText`: dos
 * motions compitiendo por la atención de la primera pantalla no suman, y la
 * que explica el producto es la escena, no el título) y la columna derecha
 * es `HeroFlow`: el pedido #A2A1 completo —pide, paga, cocina, listo—
 * dibujado con las primitivas del sistema, no una captura recortada.
 *
 * Una sola columna en mobile: texto primero, la escena después, a todo el
 * ancho. De `lg` para arriba, dos columnas alineadas ARRIBA (no al centro:
 * el bloque de texto y la escena tienen alturas distintas, y centrar
 * verticalmente dejaba contenido flotando a mitad de sección).
 */

/**
 * Grilla + washes de color detrás del contenido del hero. Pedido puntual del
 * dueño del producto, capa decorativa local a esta sección — no toca
 * `globals.css` ni sale de acá.
 *
 * Todo CSS puro (dos `repeating-linear-gradient` para la grilla, dos
 * `radial-gradient` para los washes), sin JS ni imagen: el H1 de al lado ya
 * es el LCP de la página, así que esto no puede sumar peso ni bloquear nada.
 *
 * Los colores salen de los tokens de `[data-comandapp]` vía `color-mix`
 * (nunca hex a mano): `--primary` (verde de marca) y `--accent` (navy) para
 * los washes al 6%, `--border` al 45% para las líneas — "muy tenue" tomado
 * literal, no un degradado que se note. La misma temperatura que el wash
 * verde de `og.jpg`, solo que ahora en CSS y con un segundo polo frío.
 *
 * `mask-image` (radial, centrado donde vive el texto) apaga la grilla antes
 * de los cuatro bordes de la sección en vez de cortarla en seco — un borde
 * recto se lee como asset roto — y de paso la apaga bastante antes de llegar
 * al techo, para que no queden líneas sucias pasando por debajo del
 * `backdrop-blur` de la barra fija al scrollear.
 *
 * `-z-10` + `aria-hidden` + la sección en `relative isolate`: queda atrás de
 * todo, afuera del árbol de accesibilidad, y el `isolate` evita que el
 * z-index negativo se escape por debajo de secciones hermanas. Sin
 * animación: el contrato de dirección ya gastó su única excepción de motion
 * en el H1.
 */
function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        backgroundImage: [
          'radial-gradient(48rem 30rem at 18% 12%, color-mix(in oklch, var(--primary) 6%, transparent), transparent 70%)',
          'radial-gradient(44rem 28rem at 88% 60%, color-mix(in oklch, var(--accent) 6%, transparent), transparent 70%)',
          'repeating-linear-gradient(90deg, color-mix(in oklch, var(--border) 45%, transparent) 0 1px, transparent 1px 64px)',
          'repeating-linear-gradient(0deg, color-mix(in oklch, var(--border) 45%, transparent) 0 1px, transparent 1px 64px)',
        ].join(', '),
        maskImage: 'radial-gradient(85% 65% at 32% 28%, black 0%, black 35%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(85% 65% at 32% 28%, black 0%, black 35%, transparent 90%)',
      }}
    />
  )
}

export function LandingHero() {
  return (
    <>
      <section className="relative isolate px-4 pt-10 pb-10 sm:px-6 sm:pt-14 sm:pb-12">
        <HeroBackdrop />
        <div className="mx-auto grid max-w-(--content-max) items-start gap-10 lg:grid-cols-[1fr_25rem] lg:gap-12 xl:grid-cols-[1fr_27rem]">
          <div className="flex flex-col items-start gap-6 sm:gap-7">
            {/*
             * Titular ESTÁTICO: texto plano en el HTML, sin split, sin
             * `opacity-0` de arranque. El único motion del hero es la escena
             * de `HeroFlow` — un titular que además se anima le compite la
             * atención en el mismo segundo, y es la escena la que explica el
             * producto, no el título.
             */}
            <h1 className="display text-foreground max-w-xl text-3xl font-semibold sm:text-5xl">
              Vendé online sin que nadie escriba un WhatsApp.
            </h1>
            <p className="text-muted-foreground max-w-lg text-base sm:text-lg">
              ComandApp es la web de pedidos de tu local: el cliente arma el pedido, paga con Mercado Pago y sigue el
              estado solo.
            </p>

            {/*
             * El precio bajó de panel a línea: sigue siendo lo primero que se
             * lee después del titular (la hoja de venta lo exige), pero deja
             * de competirle en peso visual — texto sólido, sin banda propia.
             *
             * Dos líneas separadas, no una con un "·" en el medio: con el
             * separador inline, cuando el texto envolvía en mobile la segunda
             * línea arrancaba con "· 15 días..." y el punto colgando se leía
             * como una viñeta suelta. Dos `<p>` no tienen ese problema en
             * ningún ancho — la segunda línea nunca empieza con puntuación.
             */}
            <div className="flex flex-col gap-0.5">
              <p className="tabular text-foreground text-2xl font-semibold sm:text-3xl">
                {formatCentsCompact(PRICING.monthlyCents, PRICING.currency)}
                <span className="text-muted-foreground text-base font-normal"> /mes por local</span>
              </p>
              <p className="text-muted-foreground text-sm">
                {PRICING.trialDays} días gratis con la integración hecha
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={whatsappHref()}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation inline-flex h-12 items-center gap-2.5 rounded-pill px-6 text-base font-semibold transition-[background-color,transform] duration-(--dur-fast) active:scale-[0.97]"
              >
                {/* Fill forzado: ver el comentario igual en `landing-bar.tsx`. */}
                <WhatsApp className="size-5 shrink-0 [&_path]:fill-current" aria-hidden />
                Hablar por WhatsApp
              </a>
              <a
                href="#como-funciona"
                className="border-border text-foreground hover:bg-muted touch-manipulation inline-flex h-12 items-center rounded-pill border px-6 text-base font-semibold transition-colors duration-(--dur-fast) active:scale-[0.97]"
              >
                Ver cómo funciona
              </a>
            </div>
          </div>

          {/*
           * La escena del flujo: ocupa el ancho entero de la columna (o de
           * la pantalla en mobile) y compone su propia altura —no la de un
           * celular recortado— para quedar pareja con el bloque de texto.
           */}
          <HeroFlow />
        </div>
      </section>

      {/*
       * La franja que en la referencia es una tira de logos de clientes.
       * ComandApp no tiene ni un local para mostrar ahí (y PRODUCT.md
       * prohíbe insinuarlo), así que el slot se ocupa con las dos cosas que
       * un dueño de local se pregunta en los primeros diez segundos, no con
       * cuatro hechos parejos: quién se queda con la plata, y si esto
       * compite con el marketplace que ya conoce. Dos bloques con peso, no
       * una grilla de tarjetas ícono+título+texto — eso está prohibido como
       * estructura de sección.
       */}
      <section className="border-border border-t px-4 pt-8 pb-10 sm:px-6 sm:pt-10 sm:pb-12 lg:pb-14">
        <div className="divide-border mx-auto grid max-w-(--content-max) divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="flex flex-col gap-2 py-6 first:pt-0 lg:py-2 lg:pr-10">
            <p className="display text-foreground text-lg font-semibold sm:text-xl">
              Cobrás con tu propia cuenta de Mercado Pago.
            </p>
            <p className="text-muted-foreground text-sm sm:text-base">
              La plata entra ahí directo — ComandApp no toca un peso de tu venta.
            </p>
          </div>
          <div className="flex flex-col gap-2 py-6 last:pb-0 lg:py-2 lg:pl-10">
            <p className="display text-foreground text-lg font-semibold sm:text-xl">
              No competimos con Rappi, PedidosYa ni Uber Eats.
            </p>
            <p className="text-muted-foreground text-sm sm:text-base">
              Ahí sos una opción en la vidriera de otro y el cliente es de la plataforma. Acá el cliente entra a tu
              marca y queda tuyo — y tu web puede llevar el botón a los tres igual, si también vendés ahí.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
