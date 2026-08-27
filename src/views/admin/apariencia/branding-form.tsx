'use client'

import { useId, useState, useTransition, useMemo } from 'react'
import { Controller, useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { upsertBrandingAction } from '@/controllers/admin.actions'
import { BODY_FONTS, HEADING_FONTS, brandingSchema, type Branding } from '@/models/schemas/branding.schema'
import { FONT_LABELS } from '@/lib/fonts'
import { ColorField } from './color-field'
import { ImageField } from './image-field'
import { BrandPreview } from './brand-preview'

const THEME_MODE_LABEL: Record<Branding['theme_mode'], string> = {
  light: 'Claro',
  dark: 'Oscuro',
  system: 'Según el dispositivo',
}

/** Claves válidas de `Branding`: filtra un fieldError fuera de banda (ej. un futuro 409). */
const BRANDING_FIELD_KEYS: Record<keyof Branding, true> = {
  logo_url: true,
  logo_dark_url: true,
  favicon_url: true,
  hero_image_url: true,
  color_primary: true,
  color_primary_foreground: true,
  color_accent: true,
  color_background: true,
  color_foreground: true,
  radius_rem: true,
  font_heading: true,
  font_body: true,
  theme_mode: true,
}

export function BrandingForm({
  storeId,
  storeName,
  initialBranding,
}: {
  storeId: number
  storeName: string
  initialBranding: Branding
}) {
  const [pending, startTransition] = useTransition()
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Branding>({
    // Ver el comentario equivalente en product-drawer.tsx: `radius_rem` usa
    // `z.coerce.number()`, que hace que Zod infiera `unknown` como tipo de
    // entrada para ese campo y rompe la inferencia automática del resolver.
    resolver: zodResolver(brandingSchema) as Resolver<Branding>,
    defaultValues: initialBranding,
  })

  const headingSelectId = useId()
  const bodySelectId = useId()
  const modeSelectId = useId()
  const radiusId = useId()
  const [radiusDraft, setRadiusDraft] = useState(() => String(initialBranding.radius_rem))

  // `useWatch` sobre el formulario entero devuelve un parcial en los tipos de
  // react-hook-form, y el preview necesita un `Branding` completo para poder
  // derivar el tema. Se mergea sobre el inicial descartando los `undefined`: un
  // spread crudo los propagaría y el preview se quedaría sin color justo
  // mientras el dueño está eligiéndolo.
  const watched = useWatch({ control })
  const branding = useMemo<Branding>(() => {
    const defined = Object.fromEntries(
      Object.entries(watched ?? {}).filter(([, value]) => value !== undefined),
    ) as Partial<Branding>
    return { ...initialBranding, ...defined }
  }, [initialBranding, watched])

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await upsertBrandingAction(storeId, values)
      if (!result.ok) {
        toast.error('No se pudo guardar la apariencia', { description: result.error })
        setError('root', { type: 'server', message: result.error })
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in BRANDING_FIELD_KEYS) setError(field as FieldPath<Branding>, { type: 'server', message: messages[0] })
        }
        return
      }
      toast.success('Apariencia guardada')
    })
  })

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Portada</h2>
          <p className="text-muted-foreground -mt-2 text-sm">
            Es lo primero que ve alguien que entra a tu carta: una franja horizontal a sangre, con tu nombre y logo
            encima. Es parte central de cómo se ve tu web ahora, no un detalle.
          </p>
          <Controller
            control={control}
            name="hero_image_url"
            render={({ field }) => (
              <div className="flex flex-col gap-1">
                <ImageField
                  label="Foto de portada"
                  aspect="wide"
                  hint="Horizontal, 16:9 o más ancha (mínimo recomendado 1600×900). Se recorta al centro si es más angosta. Sin foto, la franja usa tu color de marca sólido."
                  storeId={storeId}
                  value={field.value}
                  onChange={field.onChange}
                />
                {errors.hero_image_url ? (
                  <p role="alert" className="text-destructive text-xs">
                    {errors.hero_image_url.message}
                  </p>
                ) : null}
              </div>
            )}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Logos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="logo_url"
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <ImageField label="Logo" storeId={storeId} value={field.value} onChange={field.onChange} />
                  {errors.logo_url ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errors.logo_url.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
            <Controller
              control={control}
              name="logo_dark_url"
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <ImageField
                    label="Logo (fondo oscuro)"
                    // Honesto con lo que el sistema hace hoy (F-08): el modo
                    // oscuro todavía no elige este logo en ningún lado de la
                    // vitrina, así que no prometemos un swap que no existe.
                    hint="Se guarda para cuando el modo oscuro elija logo propio. Hoy la vitrina usa siempre el logo de arriba."
                    storeId={storeId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  {errors.logo_dark_url ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errors.logo_dark_url.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
            <Controller
              control={control}
              name="favicon_url"
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <ImageField label="Favicon" storeId={storeId} value={field.value} onChange={field.onChange} />
                  {errors.favicon_url ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errors.favicon_url.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Colores</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="color_primary"
              render={({ field }) => (
                <ColorField label="Color de marca" value={field.value} onChange={field.onChange} error={errors.color_primary?.message} />
              )}
            />
            <Controller
              control={control}
              name="color_primary_foreground"
              render={({ field }) => (
                <ColorField
                  label="Texto sobre el color de marca"
                  value={field.value}
                  onChange={field.onChange}
                  against={branding.color_primary}
                  error={errors.color_primary_foreground?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="color_accent"
              render={({ field }) => (
                <ColorField label="Acento" value={field.value} onChange={field.onChange} error={errors.color_accent?.message} />
              )}
            />
            <Controller
              control={control}
              name="color_background"
              render={({ field }) => (
                <ColorField label="Fondo" value={field.value} onChange={field.onChange} error={errors.color_background?.message} />
              )}
            />
            <Controller
              control={control}
              name="color_foreground"
              render={({ field }) => (
                <ColorField
                  label="Texto"
                  value={field.value}
                  onChange={field.onChange}
                  against={branding.color_background}
                  error={errors.color_foreground?.message}
                />
              )}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Tipografía y modo</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={headingSelectId}>Tipografía de títulos</Label>
              <Controller
                control={control}
                name="font_heading"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={headingSelectId} className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HEADING_FONTS.map((font) => (
                        <SelectItem key={font} value={font}>
                          {FONT_LABELS[font]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={bodySelectId}>Tipografía de texto</Label>
              <Controller
                control={control}
                name="font_body"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={bodySelectId} className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BODY_FONTS.map((font) => (
                        <SelectItem key={font} value={font}>
                          {FONT_LABELS[font]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={modeSelectId}>Modo</Label>
              <Controller
                control={control}
                name="theme_mode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={modeSelectId} className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(THEME_MODE_LABEL) as Branding['theme_mode'][]).map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {THEME_MODE_LABEL[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={radiusId}>Redondeo de esquinas</Label>
              <Controller
                control={control}
                name="radius_rem"
                render={({ field }) => (
                  <Input
                    id={radiusId}
                    inputMode="decimal"
                    value={radiusDraft}
                    aria-invalid={!!errors.radius_rem}
                    aria-describedby={errors.radius_rem ? `${radiusId}-error` : undefined}
                    onChange={(e) => {
                      const raw = e.target.value
                      setRadiusDraft(raw)
                      if (raw.trim() === '') {
                        field.onChange(0)
                        return
                      }
                      const parsed = Number(raw)
                      // Redondeo a 2 decimales sin arrastrar el float del input: el
                      // paso de 0.05 es la única precisión que expone el form.
                      if (Number.isFinite(parsed)) field.onChange(Math.round(Math.min(2, Math.max(0, parsed)) * 100) / 100)
                    }}
                    className="h-10"
                  />
                )}
              />
              {errors.radius_rem ? (
                <p id={`${radiusId}-error`} role="alert" className="text-destructive text-xs">
                  {errors.radius_rem.message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {errors.root ? (
          <p role="alert" className="text-destructive text-sm">
            {errors.root.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar apariencia
        </Button>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="text-muted-foreground mb-2 text-[0.6875rem] font-medium tracking-[0.08em] uppercase">Vista previa</p>
        <BrandPreview branding={branding} storeName={storeName} />
      </div>
    </form>
  )
}
