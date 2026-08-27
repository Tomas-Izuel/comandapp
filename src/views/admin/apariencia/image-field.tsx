'use client'

import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { productImagePublicUrl, uploadProductImage } from '@/views/admin/catalogo/image-upload'

/**
 * No hay bucket propio para branding: se reutiliza `product-images` con el
 * mismo path `{store_id}/{archivo}` (las RLS solo miran ese primer segmento,
 * no si el archivo "es" un producto). Mismo helper de compresión que el ABM
 * de catálogo, sin duplicar la lógica.
 */
export function ImageField({
  label,
  hint,
  storeId,
  value,
  onChange,
  aspect = 'square',
}: {
  label: string
  hint?: string
  storeId: number
  value: string | null
  onChange: (url: string | null) => void
  /** 'wide' es la portada (16:9): un cuadrado ahí no avisa que la foto se recorta distinto. */
  aspect?: 'square' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const inputId = useId()

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    const result = await uploadProductImage(storeId, file)
    setUploading(false)
    if (!result.ok) {
      toast.error('No se pudo subir la imagen', { description: result.error })
      return
    }
    onChange(productImagePublicUrl(result.path))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'border-border bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-lg border',
            aspect === 'wide' ? 'aspect-video h-16 w-28' : 'h-16 w-16',
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className={cn('h-full w-full', aspect === 'wide' ? 'object-cover' : 'object-contain')} />
          ) : (
            <Upload className="text-muted-foreground size-4" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="gap-1.5"
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {value ? 'Cambiar' : 'Subir'}
            </Button>
            {value ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} className="gap-1.5">
                <X className="size-3.5" />
                Quitar
              </Button>
            ) : null}
          </div>
          {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  )
}
