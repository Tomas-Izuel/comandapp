import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import { FONT_VARIABLES } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pedidos',
  description: 'Pedí, pagá y seguí tu pedido sin escribirle a nadie.',
}

/**
 * El contrato de dirección se emite como comentario HTML dentro del markup, no
 * como comentario de TSX: tiene que sobrevivir al build de producción para que
 * la revisión final pueda auditar el render contra lo que se prometió.
 */
const DIRECTION_CONTRACT = `
THESIS: La app de pedido de la marca, ejecutada completa. El cliente eligió el
estándar de la categoría a propósito, así que la convención ES el compromiso: se
usa entera, sin ironía y sin rarezas de contrabando. La identidad no viene de
inventar una estructura nueva, viene del color, la tipografía, el radio y —sobre
todo— la foto del local.
QUALITY BAR: apps propias de cadena (McDonald's, Mostaza, Starbucks) y webs de
pedido de un local (Toast, Square, Slice). Marca propia, nunca marketplace: la
plataforma no se muestra en la cara del cliente.
ANTI-REFERENCE: el mundo anterior —programa de etiqueta de cerveza artesanal—
prohibía la comida: foto en una franja de 7rem, portada del local sin renderizar,
nombres en caja alta condensada y specs monoespaciadas. Un negocio que vende
hambre había construido una ficha técnica. Nada de eso vuelve.
STORY: El que llega con hambre ve comida antes que texto, entiende el precio y
los minutos sin buscarlos, y llega a pagar sin aprender nada.
MATERIAL: Tarjetas blancas que se levantan de la página con sombra real, todo
en pastilla —chips, campos, botones, el dock—, y el verde de marca como campo
sólido en lo que se toca. El radio es grande y constante (--radius 1.25rem por
defecto): es la mitad de la identidad, junto con la foto.
FIRST VIEWPORT: Encabezado con la marca del local; la portada como tarjeta
redondeada con los datos honestos encima —abierto/cerrado, minutos, retiro,
mínimo—; el buscador en pastilla; el riel de categorías con la foto de cada una;
y ya entrando en pantalla la grilla de dos columnas con la primera foto grande,
su precio en verde y su botón de sumar.
SIGNATURE INTERACTION: Agregar al carrito. Es el único momento autorizado del
producto: la hoja del producto sube, el dock del pie pasa de círculo a pastilla
con el total, y el contador late cuando ya existía. Una sola confirmación,
siempre la misma, en toda la cara del cliente. Sin rebote: nada elástico, el
énfasis lo da la escala del keyframe y no un easing que sobrepasa.
DOCK: Al alcance del pulgar, flotando sobre la carta: el carrito relleno con el
color del local, y los canales propios del local —WhatsApp, cómo llegar,
Instagram, las apps por las que también vende—. Solo aparece lo que el local
configuró; un dock con botones muertos no es una barra, es una promesa rota.
MOTION GRAMMAR: Una sola familia de easing (--ease-out-expo) y tres duraciones
(--dur-fast/base/slow). Todo arranca desde un estado ya visible, así que con
prefers-reduced-motion el resultado final es idéntico y nada queda oculto. Nada
entra al hacer scroll: una carta que se revela de a poco es una carta que tarda.
LANDING (/): la cara de la PLATAFORMA, no de un local. Modo Persuade. Tesis
(2026-09-02): LA PÁGINA ES LA DEMO. No describe el producto: deja mirar UN
pedido —el #A2A1 de src/lib/landing.ts— cruzar la página entera, y cada sección
es una estación de ese recorrido con una prueba interactiva que usa la MISMA
aritmética que cobra el producto (ETA con scaleUpInt, envío con delivery.ts,
precio con PRICING). Gramática de motion propia, y es la excepción declarada a la
regla de arriba: (1) NINGÚN texto, título ni tarjeta entra al hacer scroll — eso
es la firma de la landing genérica y está prohibido; (2) lo único que se mueve
son estados del producto dramatizados —un mensaje que llega, un paso que se
cumple, un número que cambia, una captura que se intercambia—; (3) cada demo se
reproduce UNA vez cuando entra en pantalla y tiene un control para repetirla;
(4) el hero tiene UN solo momento: el STORYBOARD del flujo (hero-flow.tsx), un
pedido de delivery contado en cinco cuadros que entran por la derecha y salen
por la izquierda —el cursor toca el "+", el pedido viaja a la hoja de pago y
queda pagado, la sartén cocina, sale listo, la moto llega a la puerta— con una
frase por cuadro, que se reproduce una vez al cargar y se puede repetir; es la
única escena ilustrada de la página (sartén, moto, cursor son ÍCONOS trazados,
no fotos ni emoji) y la única con un pedido distinto del #A2A1, porque tiene que
terminar en la puerta del cliente; el titular es ESTÁTICO —dos motions al cargar
compiten, y la que explica el producto es la escena, no el título—, así que GSAP
se fue de la landing; (5) con
prefers-reduced-motion toda demo renderiza su estado final de entrada, sin
temporizadores, y nada queda oculto. Misma familia de easing (--ease-out-expo),
mismas duraciones, más --dur-beat como cadencia entre eventos de una escena. Las
islas cliente son las demos y solo las demos; el resto de la página sigue siendo
Server Components y la ruta sigue siendo estática. Cero evidencia inventada:
toda escena dramatizada lleva DEMO_SCENE_CAPTION y toda captura lleva
SCREENSHOT_CAPTION.
OPERATE: /admin y /backoffice NO heredan esta composición. Comparten tokens,
tipografía y controles; la vara ahí son los KDS de cocina y los paneles de
administración, no la app de pedido. Densidad y retomar-el-hilo por encima de
expresión.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance
`

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-AR" className={`${FONT_VARIABLES} h-full antialiased`} suppressHydrationWarning>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <div dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        {children}
        {/*
          Fallback para todo lo que NO vive dentro de un [data-store-theme]:
          /admin, /backoffice, y cualquier ruta sin marca de local. Antes leía
          `next-themes` sin `ThemeProvider` montado, así que `theme` daba
          siempre "system" (F-14): un toast oscuro random según el OS del
          cliente, en una app que no tiene modo oscuro propio acá. "light" fijo
          es correcto para este scope porque el panel es shadcn neutro, no
          marca de tienda.

          El storefront (`/[store]`, `/pedido/[token]`) NECESITA su propio
          <Toaster> montado DENTRO del div `[data-store-theme]`, con
          `theme={isDark ? 'dark' : 'light'}` según `themeClass(branding)`: el
          de acá vive fuera de ese scope (es hijo de <body>, y sonner porta al
          <body>), así que nunca va a heredar los tokens de la marca del local.
          Ver el reporte del slice de layout compartido.
        */}
        {/* `position="bottom-center"`, no `"top-center"`: el reporte real fue
            "miro el botón que acabo de tocar, no arriba de todo" — el pulgar
            y los ojos están abajo en TODO este producto. El offset despega
            el toast del piso lo suficiente para no quedar debajo del dock
            flotante (`--dock-h` + `--dock-gap`, doble porque el dock también
            se separa del borde esa distancia) ni de la `.action-bar` del
            carrito/checkout, que es más alta: `--space-8` de margen extra
            cubre esa diferencia sin un token propio de alto de action-bar.
            `env(safe-area-inset-bottom)` de nuevo por la barra de gestos del
            iPhone, igual que el resto del chasis pegajoso. */}
        <Toaster
          position="bottom-center"
          richColors
          theme="light"
          offset={{ bottom: 'calc(var(--dock-h) + var(--dock-gap) * 2 + var(--space-8) + env(safe-area-inset-bottom, 0px))' }}
          mobileOffset={{ bottom: 'calc(var(--dock-h) + var(--dock-gap) * 2 + var(--space-8) + env(safe-area-inset-bottom, 0px))' }}
        />
      </body>
    </html>
  )
}
