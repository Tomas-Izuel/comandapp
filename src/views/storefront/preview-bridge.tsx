'use client'

import { useEffect, useState } from 'react'
import { brandingSchema } from '@/models/schemas/branding.schema'
import { buildThemeCss } from '@/lib/theme'
import { PREVIEW_BRANDING_MESSAGE_TYPE, usePreviewMode } from '@/lib/preview-mode'

/**
 * Puente de la vista previa embebida en `/admin/apariencia`: recibe por
 * `postMessage` el branding que el dueño TODAVÍA NO GUARDÓ (está arrastrando
 * el slider de color) y lo aplica encima del tema real con un segundo
 * `<style>` que apunta al MISMO selector que ya usa el layout
 * (`[data-store-theme]`). Misma especificidad, orden de DOM posterior: gana
 * el último. No reimplementa el theming — usa `buildThemeCss()`, la misma
 * función que pinta la vitrina real.
 *
 * Esto es una superficie de inyección de CSS por partida doble: el mensaje
 * viaja por `postMessage`, que cualquier script en cualquier pestaña puede
 * disparar contra `window`, y el resultado termina dentro de un `<style>`.
 * Tres guardas, ninguna opcional:
 *
 *   1. ORIGEN — se ignora cualquier mensaje que no venga de este mismo
 *      origen. Un iframe cargado desde otro dominio, o una pestaña ajena que
 *      encontrara la referencia de esta ventana, no puede mandar nada acá.
 *   2. DISCRIMINADOR DE TIPO — se ignora cualquier mensaje que no declare
 *      explícitamente `type: PREVIEW_BRANDING_MESSAGE_TYPE`. Sin esto,
 *      reaccionaría a cualquier otro `postMessage` que le llegue a `window`
 *      (otra feature, una extensión del navegador).
 *   3. `brandingSchema.safeParse` — el MISMO validador que el modelo corre
 *      antes de guardar en la base. Un mensaje que pasa (1) y (2) pero trae
 *      un campo con basura (`color_primary: "red;}body{display:none"`) se
 *      descarta ACÁ, entero, antes de que `buildThemeCss` vea un solo campo
 *      del payload crudo.
 *
 * Solo hace algo si `usePreviewMode()` es true: fuera de la vista previa no
 * hay un padre escuchando ni nada que aplicar, así que no tiene sentido
 * sumarle un listener de `message` a la sesión de un cliente real.
 */
export function PreviewBridge() {
  const isPreview = usePreviewMode()
  const [overrideCss, setOverrideCss] = useState<string | null>(null)

  useEffect(() => {
    if (!isPreview) return

    function handleMessage(event: MessageEvent) {
      // (1) Origen — nunca confiar en un mensaje de otro origen.
      if (event.origin !== window.location.origin) return

      const data: unknown = event.data
      // (2) Discriminador — ignora cualquier otro tráfico de postMessage.
      if (
        !data ||
        typeof data !== 'object' ||
        (data as { type?: unknown }).type !== PREVIEW_BRANDING_MESSAGE_TYPE
      ) {
        return
      }

      // (3) Nunca el payload crudo: solo lo que sobrevive a brandingSchema.
      const parsed = brandingSchema.safeParse((data as { branding?: unknown }).branding)
      if (!parsed.success) return

      setOverrideCss(buildThemeCss(parsed.data, '[data-store-theme]'))
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isPreview])

  if (!isPreview || !overrideCss) return null

  // CSS ya validado por brandingSchema arriba, mismo patrón que el <style>
  // del layout del lado del servidor.
  return <style dangerouslySetInnerHTML={{ __html: overrideCss }} />
}
