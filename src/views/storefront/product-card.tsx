'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Check, Clock, Plus } from 'lucide-react'
import { Panel, PhotoFrame, StatusPill, iconButtonClass } from '@/views/shared/surfaces'
import { Price } from '@/views/shared/money'
import { useCart } from '@/lib/cart'
import { useAddFeedback } from '@/views/storefront/use-add-feedback'
import { storeHref, useStoreBasePath } from '@/views/storefront/store-base-path'
import { cn } from '@/lib/utils'
import type { MenuProduct } from '@/models/types'

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
  const { addLine } = useCart()
  const { flash, isAdded } = useAddFeedback()
  const basePath = useStoreBasePath()
  const productHref = storeHref(basePath, `/producto/${product.id}`)
  const isSoldOut = !product.isAvailable
  // El número (minSelect) lo manda siempre el servidor; acá solo se decide
  // el camino: sin opciones obligatorias, sumar directo tiene sentido — con
  // ellas, no se puede armar un pedido válido sin pasar por la ficha.
  const needsOptions = product.optionGroups.some((group) => group.minSelect > 0)

  function handleQuickAdd() {
    addLine({ productId: product.id, quantity: 1, optionIds: [], notes: null })
    // El botón ES el aviso: se confirma después de que la línea ya se sumó,
    // nunca antes (ver `use-add-feedback.ts`). Reemplaza al toast de arriba,
    // que salía fuera de la vista del pulgar que acaba de tocar acá.
    flash()
  }

  // Las dos instancias del control de sumar (ver el comentario grande de
  // arriba): `variant="photo"` es la de siempre, absoluta sobre la esquina de
  // la foto; `variant="edge"` es nueva, de flujo normal al final de la fila,
  // solo para la forma horizontal. Nunca se ven las dos a la vez.
  function renderQuickAdd(variant: 'photo' | 'edge') {
    if (isSoldOut) return null

    const positionClass =
      variant === 'photo'
        ? 'shadow-raise absolute right-2 bottom-2 z-10 @min-[14rem]:hidden'
        : 'shadow-raise relative z-10 hidden shrink-0 self-center @min-[14rem]:flex'

    if (needsOptions) {
      return (
        <Link
          href={productHref}
          aria-label={`Ver opciones de ${product.name}`}
          className={cn(iconButtonClass('primary'), positionClass)}
        >
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        </Link>
      )
    }

    return (
      <button
        type="button"
        onClick={handleQuickAdd}
        aria-label={isAdded ? `${product.name} agregado al carrito` : `Agregar ${product.name} al carrito`}
        className={cn(
          iconButtonClass('primary'),
          positionClass,
          'transition-colors duration-(--dur-fast)',
          // Color Y texto cambian con el estado, no solo el ícono: es la
          // confirmación más cara del producto, tiene que notarse aunque el
          // pulgar esté tapando el resto de la pantalla.
          isAdded && 'bg-foreground text-background hover:bg-foreground',
        )}
      >
        {isAdded ? (
          <Check className="size-5" strokeWidth={2.5} aria-hidden />
        ) : (
          <Plus className="size-5" strokeWidth={2.5} aria-hidden />
        )}
      </button>
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
