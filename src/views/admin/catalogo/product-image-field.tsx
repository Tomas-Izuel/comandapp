'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhotoFrame } from '@/views/shared/surfaces'
import {
  productImagePublicUrl,
  uploadProductImage,
  type UploadPhase,
} from '@/views/admin/catalogo/image-upload'

const PHASE_LABEL: Record<UploadPhase, string> = {
  compressing: 'Preparando la foto…',
  uploading: 'Subiendo…',
}

// Hitos de la barra: no hay progreso real por byte (ver image-upload.ts), así
// que la barra avanza por etapa conocida en vez de mentir con un porcentaje.
const PHASE_PROGRESS: Record<UploadPhase, number> = {
  compressing: 35,
  uploading: 80,
}

/**
 * A diferencia de apariencia (que guarda URLs completas), acá se guarda el
 * `imagePath` relativo del bucket: es lo que espera `products.image_path`.
 *
 * Es lo PRIMERO del formulario de producto, no lo último: la foto es la
 * decisión que más vende, y tratarla como el último campo de un formulario
 * largo es tratarla como opcional cuando no lo es.
 *
 * El preview muestra los DOS recortes que el cliente ve, porque son distintos
 * y los dos se publican: la ficha de producto usa 4:3 y la fila de la carta
 * recorta CUADRADO. Mostrar uno solo es la trampa clásica de este campo — el
 * dueño encuadra para el preview, publica, y en la carta (que es donde más se
 * mira) la hamburguesa aparece cortada. Si cambia el `ratio` de
 * `product-row.tsx` o de `product-detail.tsx`, cambia acá.
 *
 * No borra el archivo reemplazado ni el quitado acá (F-09): este campo solo
 * cambia el `imagePath` del form en memoria, y el drawer se puede cancelar.
 * Borrar de una era el bug — cambiar foto y cancelar dejaba la fila apuntando
 * a un archivo que ya no existía, 404 en la carta. El borrado del archivo
 * viejo tiene que pasar recién cuando el guardado se confirma, del lado del
 * servidor (`updateProduct` conoce el `image_path` anterior antes de
 * pisarlo; acá no hay forma de saberlo sin volver a leerlo). Reportado al
 * dueño de `catalog.model.ts`: falta ese borrado en `updateProduct`, y un
 * producto nuevo que se sube y nunca se guarda deja un huérfano en el bucket
 * hasta que exista un cron de limpieza.
 */
export function ProductImageField({
  storeId,
  path,
  onChange,
}: {
  storeId: number
  path: string | null
  onChange: (path: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<UploadPhase | null>(null)
  // Preview local inmediato (F-08): el dueño tiene que ver el encuadre real
  // ANTES de que termine de subir, no después. Se arma con la foto elegida,
  // no con la que ya viaja al bucket.
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  async function handleFile(file: File | undefined) {
    if (!file) return

    if (localPreview) URL.revokeObjectURL(localPreview)
    const objectUrl = URL.createObjectURL(file)
    setLocalPreview(objectUrl)

    setPhase('compressing')
    const result = await uploadProductImage(storeId, file, setPhase)
    setPhase(null)

    if (!result.ok) {
      toast.error('No se pudo subir la foto', { description: result.error })
      URL.revokeObjectURL(objectUrl)
      setLocalPreview(null)
      return
    }
    onChange(result.path)
  }

  function handleRemove() {
    if (localPreview) URL.revokeObjectURL(localPreview)
    setLocalPreview(null)
    onChange(null)
  }

  const remoteUrl = path ? productImagePublicUrl(path) : null
  const previewUrl = localPreview ?? remoteUrl
  const uploading = phase !== null

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label={previewUrl ? 'Cambiar foto del producto' : 'Subir foto del producto'}
        className="focus-visible:ring-ring/50 border-border block w-full overflow-hidden rounded-lg border text-left transition-opacity duration-(--dur-fast) focus-visible:ring-3 focus-visible:outline-none disabled:opacity-70"
      >
        <PhotoFrame ratio="wide">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center">
              <ImagePlus className="size-6" strokeWidth={1.5} aria-hidden />
              <span className="text-sm font-medium">Subí una foto</span>
              <span className="text-xs">Así se va a ver, recortada, en la carta</span>
            </div>
          )}
        </PhotoFrame>

        {previewUrl ? (
          <div className="border-border flex items-center gap-3 border-t px-3 py-2.5">
            <PhotoFrame ratio="square" className="size-14 shrink-0 rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            </PhotoFrame>
            <p className="text-muted-foreground text-xs">
              Arriba, la ficha del producto. Acá al lado, el recorte cuadrado de la fila de la carta — es
              donde más se mira. Si el plato queda cortado, subí la foto más centrada.
            </p>
          </div>
        ) : null}

        {uploading ? (
          <div className="bg-card/95 flex items-center gap-2 border-t px-3 py-2 backdrop-blur">
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-muted-foreground text-xs">{PHASE_LABEL[phase]}</span>
              <div
                className="bg-muted h-1 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-label="Subiendo foto"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={PHASE_PROGRESS[phase]}
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-(--dur-base)"
                  style={{ width: `${PHASE_PROGRESS[phase]}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </button>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="gap-1.5"
        >
          {previewUrl ? 'Cambiar foto' : 'Subir foto'}
        </Button>
        {previewUrl ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleRemove} disabled={uploading} className="gap-1.5">
            <X className="size-3.5" />
            Quitar
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">Recomendado: siempre. Bebidas y guarniciones pueden quedar sin foto.</p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Sin esto, elegir el MISMO archivo dos veces seguidas (ej. después
          // de un error) no dispara `change` la segunda vez.
          e.target.value = ''
          void handleFile(file)
        }}
      />
    </div>
  )
}
