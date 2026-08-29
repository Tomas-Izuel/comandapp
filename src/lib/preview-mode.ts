'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Vista previa de marca: `/[store]?preview=brand`, embebida en un <iframe>
 * desde `/admin/apariencia` (ver `views/admin/apariencia/brand-preview.tsx`).
 *
 * El flag SOLO puede sacar capacidad (deshabilita "hacer el pedido" en
 * `checkout-form.tsx`), nunca sumarla — por eso no lleva ningún chequeo de
 * auth: cualquiera que arme esta URL a mano lo único que logra es no poder
 * pedir en esa carga. No hay una feature nueva que un cliente real pueda
 * activar con esto.
 *
 * --- Por qué esto es más que "leer un query param" -------------------------
 * `?preview=brand` no viaja en los links internos de la vitrina
 * (`product-card.tsx`, `store-chrome.tsx`, `store-dock.tsx`… son de otro
 * slice y no tienen por qué saber de esto). Navegar del catálogo a un
 * producto, o al checkout, es una transición de cliente que arma la URL
 * nueva sin el query param. Sin algo más, el checkout de una vista previa se
 * comportaría como uno real apenas el dueño toca un producto.
 *
 * La solución: al detectar el flag DENTRO de un iframe se graba una marca en
 * `sessionStorage`, y esa marca —no la URL— sostiene el modo vista previa en
 * el resto de la navegación de esta pestaña. `window.self !== window.top` es
 * la guarda que evita que se filtre a una sesión real: un cliente de verdad
 * nunca entra a `/[store]` DENTRO de un iframe, así que la marca persistida
 * nunca se lee para él aunque, por compartir dominio con `/admin`, comparta
 * pestaña y `sessionStorage` con una visita anterior al panel en esa misma
 * pestaña.
 */

export const PREVIEW_QUERY_PARAM = 'preview'
export const PREVIEW_QUERY_VALUE = 'brand'
const PREVIEW_SESSION_KEY = 'burger-shop.preview-mode'

/**
 * Discriminador del mensaje que `brand-preview.tsx` manda por `postMessage`.
 * Sin esto, `preview-bridge.tsx` reaccionaría a CUALQUIER mensaje que le
 * llegue a `window` (otra feature, una extensión del navegador, React
 * DevTools) con tal de que pase el chequeo de origen.
 */
export const PREVIEW_BRANDING_MESSAGE_TYPE = 'burger-shop:preview-branding'

export function usePreviewMode(): boolean {
  const searchParams = useSearchParams()
  const fromQuery = searchParams.get(PREVIEW_QUERY_PARAM) === PREVIEW_QUERY_VALUE

  // Arranca en `fromQuery` a secas: eso ya coincide entre servidor y cliente
  // (la ruta es dinámica de punta a punta — `getStoreBySlug` usa el cliente
  // de Supabase con cookies — así que `useSearchParams()` no varía entre el
  // render inicial del servidor y la hidratación). `sessionStorage` y
  // `window.top` no existen en el servidor: se leen recién en el efecto,
  // mismo patrón que `CartProvider` usa para no pisar el HTML hidratado.
  const [persisted, setPersisted] = useState(false)

  useEffect(() => {
    let embedded: boolean
    try {
      embedded = window.self !== window.top
    } catch {
      // Un iframe CROSS-origin tira SecurityError al leer `window.top`. Acá
      // siempre es same-origin, pero si alguna vez no lo fuera, "no
      // embebido" es la lectura seguridad-first: nunca activa de más.
      embedded = false
    }

    if (!embedded) return

    if (fromQuery) {
      try {
        window.sessionStorage.setItem(PREVIEW_SESSION_KEY, '1')
      } catch {
        // Sin sessionStorage (modo privado agresivo): la vista previa sigue
        // andando para ESTA carga vía `fromQuery`, solo no sobrevive a una
        // navegación interna que pierda el query param.
      }
    }

    try {
      // Mismo patrón que `CartProvider`: `sessionStorage` no existe en el
      // server, así que recién se puede leer acá, después del primer render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersisted(window.sessionStorage.getItem(PREVIEW_SESSION_KEY) === '1')
    } catch {
      setPersisted(false)
    }
  }, [fromQuery])

  return fromQuery || persisted
}
