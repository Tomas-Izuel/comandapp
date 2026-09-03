/**
 * Cuándo se considera que una escena animada de la landing está "en pantalla"
 * como para arrancar. Un solo lugar para las tres demos (`hero-flow`,
 * `versus-race`, `events-demo`): antes cada una traía su propio `threshold`
 * bajo (0.3 / 0.4), así que el usuario llegaba scrolleando y la escena ya
 * había arrancado —a veces hasta terminado— con el bloque asomando apenas
 * por el borde inferior del viewport. El dueño del producto pidió que
 * arranquen recién con el bloque al menos 60% en pantalla.
 *
 * LA TRAMPA, y por qué NO alcanza con `threshold: 0.6` a secas:
 * `entry.intersectionRatio` es la fracción DEL ELEMENTO que se ve, no la
 * fracción del viewport que el elemento ocupa. Un bloque MÁS ALTO que el
 * viewport —hero-flow y versus-race lo son en mobile, ~375×812— nunca llega a
 * cubrir el 60% de SU PROPIA altura: siempre hay una porción tapada arriba o
 * abajo. Con un threshold ingenuo el observer no cruza el umbral jamás y la
 * animación no arranca NUNCA en un celular. La condición correcta es "el
 * bloque ocupa buena parte de lo que el usuario está mirando ahora": el ratio
 * del elemento llega a 60% (el caso común, bloques chicos) O la porción
 * VISIBLE del elemento ya cubre el 60% del alto del viewport (el caso de un
 * bloque más alto que la pantalla, que nunca dispara la primera condición).
 *
 * El array de thresholds —no un número suelto— es necesario para que el
 * observer reevalúe mientras se scrollea: un `threshold` único solo notifica
 * la vez que se CRUZA ese valor exacto, así que un bloque que pasa de 0% a
 * 40% de un salto (scroll rápido) no dispara nunca si el threshold pedido no
 * cae justo en el medio. Con el array, cualquier cambio de ratio de más de un
 * paso dispara el callback y `isSceneVisible` decide con el dato fresco.
 */

const SCENE_ENTER_RATIO = 0.6

/** 0, 0.05, 0.1, …, 1 — grano fino para que el observer reevalúe seguido mientras se scrollea. */
export const SCENE_VISIBILITY_THRESHOLDS: number[] = Array.from({ length: 21 }, (_, index) => index / 20)

/**
 * `true` cuando el bloque está lo bastante en pantalla como para que el
 * usuario lo esté mirando de verdad. Se prueban las DOS condiciones de la
 * trampa de arriba porque ninguna sola cubre los dos tamaños de bloque
 * posibles (más chico que el viewport / más alto que el viewport).
 *
 * `rootBounds` es la altura real del root del observer (el viewport, cuando
 * no se pasa `root`); se cae a `window.innerHeight` solo si el navegador no
 * lo informó, que es el caso más robusto y no un atajo.
 */
export function isSceneVisible(entry: IntersectionObserverEntry): boolean {
  if (entry.intersectionRatio >= SCENE_ENTER_RATIO) return true
  const viewportHeight = entry.rootBounds?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight)
  if (viewportHeight <= 0) return false
  return entry.intersectionRect.height >= viewportHeight * SCENE_ENTER_RATIO
}
