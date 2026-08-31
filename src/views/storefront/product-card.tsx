'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Clock, Minus, Plus } from 'lucide-react'
import { Panel, PhotoFrame, StatusPill, iconButtonClass } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { lineKey, useCart } from '@/lib/cart'
import { storeHref, useStoreBasePath } from '@/views/storefront/store-base-path'
import { cn } from '@/lib/utils'
import type { MenuProduct } from '@/models/types'

// Espeja el techo de `MAX_LINE_QUANTITY` en `src/lib/cart.tsx` (no exportado
// desde ahí, y ese archivo es de otro slice — no se toca). NO es una
// invención: `product-detail.tsx` ya hardcodea el mismo `max={50}` al pasarle
// `<Stepper>` a la ficha, así que este número replica un precedente ya
// aceptado en el repo, no un mágico nuevo. Si el tope de `cart.tsx` cambia,
// hay que actualizar los dos lugares — igual que hoy.
const MAX_QUICK_ADD_QUANTITY = 50

/**
 * Tarjeta de producto. Tiene DOS formas y elige sola cuál usar mirando su
 * PROPIO ancho (`@container` + variantes `@min-[14rem]:`), no la densidad ni ningún
 * prop: compacta pone dos tarjetas por fila (celda angosta, foto arriba,
 * vertical) y cómoda/amplia pone una sola (celda ancha, foto al costado,
 * horizontal) — ver `--catalog-cols` en `theme.ts`. Cambiar el ancho de la
 * grilla mueve la forma sin tocar este archivo, y es la MISMA geometría que
 * `MenuSkeleton` (`src/views/shared/states.tsx`) dibuja durante la carga: si
 * acá cambia el punto de quiebre o el tamaño, el esqueleto deja de coincidir y
 * aparece un salto de layout.
 *
 * El punto de quiebre es `@min-[14rem]` (224px) y ese número está MEDIDO, no
 * elegido de una escala. Medido en el navegador, el contenido de una celda:
 *
 *   compacta (2 col)     126px @320 · 161px @390 · 181px @430 · 157px @900
 *   cómoda/amplia (1 col) 263px @320 · 303px @360 · 333px @390
 *
 * La compacta nunca pasa de ~185px —en desktop hasta BAJA, porque ahí son
 * cuatro columnas— y la de una sola columna nunca baja de ~263px, ni en un
 * teléfono de 320px. 224px parte esa distancia casi al medio: ~39px de aire
 * de cada lado.
 *
 * El valor anterior (`@xs`, 20rem/320px) estaba pegado al borde equivocado y
 * el bug era invisible en el emulador que usamos para verificar: a 390px
 * (iPhone 13) daba `row`, pero a 375 (iPhone SE, 13 mini) y 360 (casi todo
 * Android) daba `column`. O sea que la carta cómoda se veía como la compacta
 * en la mitad de los teléfonos del mercado. Si tocás este número, medí de
 * nuevo las dos columnas de arriba — no lo estimes.
 *
 * `rem` acá es del root, así que no lo mueve `--spacing`: el punto de quiebre
 * es el mismo en las tres densidades, que es exactamente lo que se quiere.
 *
 * El tiempo de demora vive en la esquina OPUESTA del "+" en la forma VERTICAL
 * (arriba a la izquierda de la foto, donde si no va "Agotado"): a ~165px de
 * ancho de foto el círculo de 44px y la pastilla de minutos abajo a la derecha
 * leían como una sola masa atropellada. En la forma HORIZONTAL el "+" ya no
 * vive sobre la foto (ver más abajo), así que la pastilla es lo único que
 * ocupa esa esquina y la foto de respaldo (sin imagen real) queda con mucho
 * más lugar para el nombre.
 *
 * El control de sumar tiene DOS lugares, no uno: sobre la foto en vertical
 * (como toda la categoría), pegado al borde derecho de la fila en horizontal.
 * Puesto sobre la foto en la forma horizontal, tapaba la miniatura —lo que
 * vende el producto— y en un producto sin foto se comía el nombre de respaldo
 * ("Doble Cheddar", "Bacon Bomb"): el mismo defecto que ya se corrigió en
 * `OptionRow` (el control vive en el borde derecho, donde barre el pulgar, no
 * encima del contenido). Por eso hay DOS instancias del mismo control
 * (`renderQuickAdd`, más abajo): una absoluta sobre la foto, oculta en
 * horizontal; otra de flujo normal al final de la fila, oculta en vertical.
 * Solo una es visible por vez —la oculta es `display:none`, así que no
 * duplica nada para lectores de pantalla ni orden de tabulación.
 *
 * HTML válido: la tarjeta entera es tocable y además tiene botones adentro.
 * Un `<button>` dentro de un `<a>` no es válido, así que la tarjeta es un
 * `<div>` (el `Panel`) y el nombre/precio viven en un `<Link>` que se estira
 * sobre TODA la tarjeta con `after:absolute after:inset-0` (el `relative` que
 * lo permite está en el `Panel` contenedor, no en el Link mismo — si se lo
 * pusiera acá, el estiramiento quedaría acotado a este bloque de texto en vez
 * de cubrir también la foto, en cualquiera de las dos formas). Los controles
 * de sumar son hermanos del Link, no están adentro, así que tocarlos no
 * dispara también la navegación — y llevan `relative z-10` (la versión de
 * borde) o `absolute z-10` (la versión sobre la foto) para quedar SIEMPRE por
 * encima del `::after` del Link: un elemento posicionado sin z-index pierde
 * contra uno sin posición en el orden del DOM, así que sin esto el botón de
 * borde quedaría debajo del área de click del Link y tocarlo navegaría en vez
 * de sumar.
 *
 * El "+" se convierte en selector de cantidad (T2, pedido del dueño del
 * producto) SOLO en el camino sin opciones obligatorias — con ellas sigue
 * siendo el `<Link>` de arriba, sin cambios, porque no hay forma de armar una
 * línea de carrito válida sin pasar por la ficha.
 *
 * El estado real es el carrito (`useCart().lines`), nunca un `useState`
 * local: si el cliente vacía `/carrito` y vuelve a la carta, la tarjeta tiene
 * que reflejarlo sin que nadie la avise a mano. `quantity` se deriva en cada
 * render buscando la línea SIN opciones de este producto por `lineKey()` —
 * la misma clave que usa `addLine` para decidir si suma una línea nueva o
 * incrementa la existente. Con `quantity === 0` el control es el "+" de
 * siempre; con `quantity >= 1` pasa a stepper y vuelve a "+" solo cuando la
 * cantidad llega a 0 (ahí `setQuantity` ya borra la línea sola).
 *
 * GEOMETRÍA — por qué el stepper es VERTICAL y no el `Stepper` horizontal de
 * `src/views/shared/surfaces.tsx` (que se queda tal cual, sin tocar, y se usa
 * sin cambios en `/carrito` y en la ficha, donde sí hay ancho de sobra).
 * Medido en el navegador, no estimado:
 *
 * - `Stepper` horizontal mide 44 (menos) + 4 (gap) + 36 (contador `w-9`) + 4
 *   (gap) + 44 (más) = 132px de ancho.
 * - Variante `edge` (fila horizontal): a 320px de viewport la celda cómoda
 *   mide 263px, y ya hoy el texto se queda con ~99px después de la miniatura
 *   (72px) y los `gap-3`/`p-3` del comentario de arriba. Un `Stepper` de
 *   132px de ancho en el lugar del botón de 44px deja ~3px para el nombre y
 *   el precio: no entra, ni de cerca.
 * - Variante `photo` (esquina de la foto, forma vertical): la foto es
 *   CUADRADA y mide el ancho de la celda — 126px en la celda compacta más
 *   angosta medida (320px). Un `Stepper` de 132px de ancho creciendo hacia la
 *   izquierda (`right-2`) se sale por el borde izquierdo de una foto de
 *   126px, y en cualquier celda angosta reventaría contra la miniatura.
 *
 * La salida honesta es un stepper propio (no uno nuevo en `shared/`, este
 * caso es específico de esta tarjeta) que crece en ALTO y no en ANCHO: menos
 * arriba, contador al medio, más abajo, apilados en columna, con el mismo
 * ancho de 44px que el "+" de siempre tenía. Eso resuelve las dos variantes
 * a la vez sin desbordar nunca en X:
 *
 * - `edge`: el ancho de columna que le come al texto sigue siendo 44px, IDÉNTICO
 *   a antes — cero regresión en el problema que ya era justo.
 * - `photo`: apilado en columna y anclado `right-2 bottom-2` (el mismo
 *   anclaje de siempre, así que el "+" queda en el MISMO lugar exacto en el
 *   que el cliente ya lo tocó — sigue funcionando ahí sin que el pulgar tenga
 *   que reubicarse), el stepper activo mide ~108px de alto (44+2+16+2+44 con
 *   `gap-0.5` y un contador de `h-4`). En la celda compacta más angosta
 *   (126px de foto cuadrada, 320px de viewport) quedan ~110px libres después
 *   de los `right-2 bottom-2` (8px de cada lado) — entra, ajustado pero sin
 *   superponerse con la pastilla de minutos de la esquina opuesta (esa
 *   pastilla vive en la columna IZQUIERDA, el stepper en la DERECHA: no
 *   comparten X aunque sí compartan parte del rango de Y). A partir de
 *   161px (@390) sobra bastante margen.
 *
 * El "+" NUNCA se desmonta al pasar de botón suelto a stepper: es el MISMO
 * elemento en las dos ramas (última posición del `<div>` contenedor, con
 * `onClick` que decide adentro si crea la línea o incrementa la existente),
 * así que no hay parpadeo ni pérdida de foco en la transición — coincide con
 * la regla de motion de abajo.
 *
 * MOTION — el único momento autorizado ("agregar al carrito") es exactamente
 * la aparición del menos y el contador cuando `quantity` pasa de 0 a 1: ese
 * envoltorio (no el "+", que ya estaba visible y no se remonta) usa
 * `animate-rise` de `globals.css`, que ya arranca desde un estado VISIBLE en
 * el destino — con `prefers-reduced-motion` el resultado final es idéntico,
 * nada queda oculto por JS. El contador reusa `animate-bump` con
 * `key={quantity}` en un `<span>` propio adentro de ese envoltorio (mismo
 * patrón que `cart-view.tsx` y `store-dock.tsx` para "el contador que ya
 * existía late"): así el `rise` se reproduce UNA vez al aparecer el stepper y
 * el `bump` en CADA cambio de cantidad después, sin que uno reinicie al otro.
 *
 * `useAddFeedback` (el flash "agregado ✓" del "+" suelto) se sacó de este
 * camino: una vez que el control es un stepper, la cantidad exacta que
 * muestra —con su propio `bump`— es una confirmación estrictamente mejor que
 * un tilde que desaparece solo. Sigue viva para quien la necesite (la usa
 * `store-dock.tsx` con su propia instancia); acá quedaba una segunda fuente
 * de "ya se agregó" diciendo lo mismo con menos información.
 */
export function ProductCard({
  product,
  currency,
}: {
  product: MenuProduct
  // `storeSlug` sigue en el tipo aunque no se destructura acá: `catalog-list.tsx`
  // (fuera de este slice) lo sigue pasando y sacarlo del tipo rompería ese
  // call site con un error de propiedad excedente. El link ya no lo necesita
  // — sale de `useStoreBasePath()`, no del slug a mano (T6).
  storeSlug: string
  currency: string
}) {
  const { lines, addLine, setQuantity } = useCart()
  const basePath = useStoreBasePath()
  const productHref = storeHref(basePath, `/producto/${product.id}`)
  const isSoldOut = !product.isAvailable
  // El número (minSelect) lo manda siempre el servidor; acá solo se decide
  // el camino: sin opciones obligatorias, sumar directo tiene sentido — con
  // ellas, no se puede armar un pedido válido sin pasar por la ficha.
  const needsOptions = product.optionGroups.some((group) => group.minSelect > 0)

  // La línea de carrito de ESTE producto sin opciones — la misma forma que
  // `addLine` arma más abajo. `lineKey` viene de `lib/cart.tsx`: es la clave
  // que decide si dos líneas son "la misma" (mismo producto, sin opciones,
  // sin notas). El carrito, no un estado local, es la fuente de verdad: si el
  // cliente vacía `/carrito`, `lines` cambia y este `find` lo ve solo.
  const quickAddKey = lineKey({ productId: product.id, optionIds: [], notes: null })
  const lineIndex = lines.findIndex((line) => lineKey(line) === quickAddKey)
  const quantity = lineIndex >= 0 ? lines[lineIndex].quantity : 0
  const isStepper = quantity >= 1

  function handleIncrement() {
    if (lineIndex >= 0) setQuantity(lineIndex, quantity + 1)
    else addLine({ productId: product.id, quantity: 1, optionIds: [], notes: null })
  }

  function handleDecrement() {
    // `setQuantity` con 0 borra la línea sola (ver `lib/cart.tsx`): no hace
    // falta un branch acá para "si llega a 0, sacala" — el control vuelve a
    // ser "+" solo porque `quantity` pasa a 0 en el próximo render.
    if (lineIndex >= 0) setQuantity(lineIndex, quantity - 1)
  }

  // Las dos instancias del control de sumar (ver el comentario grande de
  // arriba): `variant="photo"` es la de siempre, absoluta sobre la esquina de
  // la foto; `variant="edge"` es nueva, de flujo normal al final de la fila,
  // solo para la forma horizontal. Nunca se ven las dos a la vez.
  function renderQuickAdd(variant: 'photo' | 'edge') {
    if (isSoldOut) return null

    const positionClass =
      variant === 'photo'
        ? 'absolute right-2 bottom-2 z-10 @min-[14rem]:hidden'
        : 'relative z-10 hidden shrink-0 self-center @min-[14rem]:flex'

    if (needsOptions) {
      return (
        <Link
          href={productHref}
          aria-label={`Ver opciones de ${product.name}`}
          className={cn(iconButtonClass('primary'), 'shadow-raise', positionClass)}
        >
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        </Link>
      )
    }

    return (
      // Columna, no fila: ver el comentario de geometría de arriba. El grupo
      // entero se anuncia como una unidad ("cantidad de X"), aunque hoy solo
      // tenga un botón visible — así no hay que agregar `role="group"` recién
      // cuando aparece el stepper, y coincide con cómo lo hace el `Stepper`
      // compartido.
      <div
        role="group"
        aria-label={`Cantidad de ${product.name} en el carrito`}
        className={cn('flex flex-col items-center gap-0.5', positionClass)}
      >
        {isStepper ? (
          // Este `<div>` es lo único que se MONTA cuando `quantity` pasa de 0
          // a 1 (el "+" de abajo ya estaba ahí, ver el comentario grande de
          // arriba) — por eso `animate-rise` se reproduce una sola vez, al
          // aparecer, y no en cada +1/-1 posterior.
          <div className="animate-rise flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={handleDecrement}
              aria-label={`Quitar una unidad de ${product.name}`}
              className={cn(iconButtonClass('surface'), 'shadow-raise')}
            >
              <Minus className="size-4" aria-hidden />
            </button>
            {/* `aria-live` va en ESTE span, que no se remonta con la cantidad
                — si estuviera en el que tiene `key={quantity}`, cada cambio
                destruye el nodo antes de que el lector de pantalla llegue a
                anunciarlo. */}
            <span
              aria-live="polite"
              className="tabular bg-card text-foreground border-border shadow-raise inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[10px] leading-none font-bold"
            >
              {/* `key={quantity}` reinicia `animate-bump` en cada +1/-1, igual
                  que el contador de `cart-view.tsx` y `store-dock.tsx`: el
                  momento autorizado ("agregar al carrito") también es cada
                  vez que este número sube. */}
              <span key={quantity} className="animate-bump">
                {quantity}
              </span>
            </span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleIncrement}
          disabled={isStepper && quantity >= MAX_QUICK_ADD_QUANTITY}
          aria-label={isStepper ? `Agregar otra unidad de ${product.name}` : `Agregar ${product.name} al carrito`}
          className={cn(iconButtonClass('primary'), 'shadow-raise disabled:opacity-35 disabled:hover:bg-primary')}
        >
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    // El `@container` (mide el ANCHO DE LA CELDA de grilla que le tocó) vive
    // en el Panel; las clases `@min-[14rem]:` que deciden fila-vs-columna van
    // todas en el `<div>` de ADENTRO, nunca en el propio Panel. Una consulta
    // de contenedor no puede aplicarse al elemento que la declara —sería
    // circular, cambiaría su propio ancho al decidir su propio layout— así
    // que el navegador la ignora en silencio ahí. Puesto en el Panel, el "+"
    // y la miniatura cambiaban de tamaño (heredado de un hijo que sí mira bien
    // al Panel como ancestro) pero la fila nunca pasaba a horizontal:
    // verificado en el navegador a 1440px, la tarjeta quedaba con la foto
    // achicada y el texto amontonado debajo en vez de al costado.
    <Panel className="@container relative overflow-hidden">
      <div
        className={cn(
          'flex flex-col',
          // Cómoda/amplia: fila en vez de columna, con aire alrededor de las
          // partes (`p-3`) y entre ellas (`gap-3`) — en compacta la foto sigue
          // a sangre, sin ese padding, así que el "p-3" recién entra acá.
          '@min-[14rem]:flex-row @min-[14rem]:items-stretch @min-[14rem]:gap-3 @min-[14rem]:p-3',
        )}
      >
        <div
          className={cn(
            'relative',
            // Miniatura fija y centrada verticalmente: si el nombre + la
            // descripción ocupan más alto que la foto, la foto queda al medio
            // en vez de pegada arriba con un hueco debajo.
            //
            // `w-[4.5rem]`/`h-[4.5rem]` y NO `size-*`: a propósito NO escala
            // con `--spacing`. Medido en la celda más angosta real (263px @
            // 320px de viewport, cómoda): con el "+" ahora en el borde de la
            // fila (ver `renderQuickAdd`) en vez de sobre la foto, una
            // miniatura de 8rem que además CRECE con la densidad dejaba
            // ~20px de columna de texto — "Clasica" se leía "Cla". 4.5rem
            // fijo le devuelve a la columna de texto los ~90px que necesita.
            //
            // El ALTO es distinto sin foto: a 4.5rem cuadrados, el nombre de
            // respaldo (centrado) chocaba contra la pastilla de minutos —
            // "Doble Cheddar" se leía "Cheddar" a secas, verificado en el
            // navegador. Sin foto no hay botón abajo (se mudó al borde de la
            // fila), así que no cuesta nada dejarlo más alto y angosto en vez
            // de cuadrado: 7rem le da al nombre lugar de sobra para sus 3
            // líneas sin tocar la pastilla, y el ancho —lo que le come
            // columna al texto— no cambia.
            '@min-[14rem]:w-[4.5rem] @min-[14rem]:shrink-0 @min-[14rem]:self-center',
            product.imageUrl ? '@min-[14rem]:h-[4.5rem]' : '@min-[14rem]:h-[7rem]',
          )}
        >
          <PhotoFrame
            ratio="square"
            fallbackLabel={product.name}
            className={cn(
              // Redondeada solo hace falta en la forma horizontal: en la
              // vertical la foto sangra hasta el borde del Panel y es SU
              // `overflow-hidden` el que le da la esquina redonda.
              '@min-[14rem]:rounded-lg',
              // Sin foto, el marco deja de ser cuadrado y pasa a llenar la
              // altura real del envoltorio (7rem, ver arriba) en vez de
              // recortarse a su propio ancho.
              !product.imageUrl && '@min-[14rem]:aspect-auto @min-[14rem]:h-full',
              // Sin foto Y con el stepper activo (forma vertical): el nombre
              // de respaldo reserva la columna derecha en vez de competir con
              // el control por el mismo lugar — la regla dura es "sin foto es
              // el nombre en grande", no "el nombre a veces tapado". `pr-13`
              // son EXACTAMENTE las 13 unidades de espaciado que el control
              // ocupa en esa esquina (`size-11` del botón + `right-2` de
              // margen), así que escala con la densidad igual que el control
              // mismo — medido en el DOM: a 126px de foto (compacta, 320px de
              // viewport) el hueco que deja el `pr-13` es del mismo ancho que
              // el stepper que se apila ahí, ni un px de más ni de menos. La
              // tintura de la marca (`bg-primary/10`, la misma que ya usa el
              // fallback) va en el `<PhotoFrame>` para que la columna
              // reservada NO se vea gris (el `bg-muted` que trae por defecto):
              // la columna sigue siendo "el color de marca", solo que el
              // NOMBRE no entra ahí. `@min-[14rem]:pr-0` cancela todo esto en
              // la forma horizontal, donde el control ya no vive sobre la
              // foto (ver `renderQuickAdd('edge')` más abajo) y esta reserva
              // sería una pérdida de columna de texto sin ningún control al
              // que protegerle el lugar.
              !product.imageUrl && isStepper && 'bg-primary/10 pr-13 @min-[14rem]:pr-0',
            )}
          >
            {product.imageUrl ? (
              <Image
                src={product.imageUrl}
                alt=""
                fill
                // Vertical: la foto ocupa media celda (grilla de dos
                // columnas, con el tope de `--content-max` de por medio).
                // Horizontal: es una miniatura de ancho fijo (`4.5rem`, ver
                // arriba), mucho más chica — de ahí el segundo valor.
                sizes="(min-width: 640px) 18rem, (min-width: 320px) 45vw, 4.5rem"
                className={cn('object-cover', isSoldOut && 'grayscale')}
              />
            ) : undefined}
          </PhotoFrame>

          {isSoldOut ? (
            <StatusPill tone="neutral" className="absolute top-2 left-2 z-10">
              Agotado
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" className="tabular absolute top-2 left-2 z-10">
              <Clock className="size-3" aria-hidden />
              {product.prepMinutes}′
            </StatusPill>
          )}

          {renderQuickAdd('photo')}
        </div>

        <Link
          href={productHref}
          className={cn(
            'after:absolute after:inset-0 flex min-w-0 flex-1 flex-col gap-1 p-3',
            // El padding de acá es el de la forma vertical (separa el texto
            // de la foto que sangra arriba). En horizontal ese aire ya lo
            // puso el `<div>` de fila (`@min-[14rem]:p-3`, arriba), así que
            // acá se saca para no duplicarlo. `justify-center` solo entra en
            // horizontal: ahí el bloque de texto casi siempre mide menos que
            // la foto (4.5rem, o 7rem sin foto — ver el envoltorio de arriba),
            // y centrado en vez de pegado arriba reparte el aire sobrante
            // arriba Y abajo en lugar de dejarlo todo abajo.
            '@min-[14rem]:justify-center @min-[14rem]:p-0',
          )}
        >
          <div className="flex flex-col gap-0.5">
            <h3
              className={cn(
                'display clamp-2 text-sm font-semibold',
                isSoldOut ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {product.name}
            </h3>
            {product.description ? (
              // Solo en la forma horizontal: la vertical ya usa sus dos
              // líneas disponibles para el nombre y el precio, no entra una
              // tercera.
              <p className="text-muted-foreground hidden text-xs @min-[14rem]:line-clamp-2">
                {product.description}
              </p>
            ) : null}
          </div>
          {/* Vertical: el precio queda pegado al pie de la tarjeta
              (`mt-auto`), igual que siempre. Horizontal: el precio pasa a ser
              la última línea del bloque de texto —ni pegado abajo ni
              flotando solo con aire vacío al lado— y el `gap-1` del Link de
              arriba es lo único que lo separa del nombre/descripción. El
              control de sumar vive aparte, en el borde derecho de la fila
              (`renderQuickAdd('edge')`, después de este Link). */}
          <div className="mt-auto pt-1 @min-[14rem]:mt-0 @min-[14rem]:pt-0">
            <Price
              cents={product.priceCents}
              currency={currency}
              className={cn('text-sm font-semibold', isSoldOut ? 'text-muted-foreground' : 'text-primary')}
            />
          </div>
        </Link>

        {renderQuickAdd('edge')}
      </div>
    </Panel>
  )
}
