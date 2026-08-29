'use client'

import { useEffect, useId, useMemo, useRef, useTransition } from 'react'
import { Controller, useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { upsertBrandingAction } from '@/controllers/admin.actions'
import {
  BODY_FONTS,
  DENSITY_OPTIONS,
  HEADING_FONTS,
  brandingSchema,
  type Branding,
  type Density,
} from '@/models/schemas/branding.schema'
import { FONT_LABELS } from '@/lib/fonts'
import { cn } from '@/lib/utils'
import { PanelHeading } from '@/views/admin/page-frame'
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
  density: true,
  font_heading: true,
  font_body: true,
  theme_mode: true,
}

/**
 * Puntos con nombre a lo largo del rango 0–2rem de `brandingSchema`. El
 * dueño arrastra un número que no significa nada ("0.65"); lo que entiende es
 * la palabra más cercana. No son los únicos valores posibles —el slider sigue
 * siendo continuo, paso 0.05— son las etiquetas que ese continuo va mostrando.
 */
const RADIUS_NAMES: { value: number; label: string }[] = [
  { value: 0, label: 'Recto' },
  { value: 0.25, label: 'Apenas' },
  { value: 0.65, label: 'Suave' },
  { value: 1.2, label: 'Redondeado' },
  { value: 2, label: 'Pastilla' },
]

function radiusLabel(value: number): string {
  return RADIUS_NAMES.reduce((closest, step) =>
    Math.abs(step.value - value) < Math.abs(closest.value - value) ? step : closest,
  ).label
}

/** Muestras vivas del radio elegido, en tres siluetas distintas (foto, chip,
 *  botón) para que se vea que el mismo número se comporta distinto según la
 *  forma — el slider solo no enseña nada, la esquina real sí. */
const RADIUS_SAMPLES = [
  { className: 'bg-primary h-11 w-11', label: 'Foto' },
  { className: 'bg-muted h-11 w-16', label: 'Chip' },
  { className: 'bg-primary h-8 w-20', label: 'Botón' },
] as const

/**
 * Copy y muestra viva por nivel de densidad. `sampleGap` no es el factor real
 * de `DENSITY_SCALE` (1 / 1.1 / 1.22 en theme.ts) — esa diferencia es demasiado
 * chica para notarse en una tarjeta de 3 líneas. Es un gap exagerado a
 * propósito para que "más aire" se VEA más aire acá mismo, sin esperar a leer
 * el teléfono de al lado. El teléfono es el que muestra el efecto real.
 */
const DENSITY_META: Record<Density, { label: string; description: string; sampleGap: string }> = {
  compact: {
    label: 'Compacta',
    description: 'Más productos a la vista. La carta entra en menos scroll.',
    sampleGap: '0.125rem',
  },
  cozy: {
    label: 'Cómoda',
    description: 'El equilibrio. Es lo que recomendamos.',
    sampleGap: '0.375rem',
  },
  roomy: {
    label: 'Amplia',
    description: 'Todo respira. Se lee mejor a distancia y con una sola mano.',
    sampleGap: '0.75rem',
  },
}

export function BrandingForm({
  storeId,
  storeSlug,
  storeName,
  initialBranding,
}: {
  storeId: number
  storeSlug: string
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
  const radiusLabelId = useId()
  const densityLabelId = useId()

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
    <form onSubmit={onSubmit} className="flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-10">
      {/* El form va PRIMERO en el DOM a propósito, aunque visualmente en
          mobile el preview se vea arriba: el orden visual lo resuelve
          `order-*` (abajo), pero el orden de LECTURA tiene que ir h2 → h2 →
          … → h3, nunca h1 → h3 salteando los h2 de las secciones. Un lector
          de pantalla navega por el árbol, no por dónde cayó el CSS.

          `@container`: esta columna es el track `1fr` del grid de ≥lg (el
          otro es el teléfono, fijo en 22rem). Sin esto, las grillas de abajo
          decidían 2 columnas mirando el VIEWPORT (`sm:grid-cols-2`), que a
          ≥lg ya no es el ancho real disponible acá — se le restan el rail
          (15rem) y el teléfono (22rem). Entre 1024px y ~1280px de ventana esa
          cuenta da una columna de ~330px, y forzar 2 columnas de campos que
          no entran ahí hace que el ITEM del grid externo se infle para
          hacerles lugar ("grid blowout"): el formulario termina más ancho
          que su columna y `<main>` — que ya es `overflow-y-auto`, y por regla
          de CSS eso vuelve `overflow-x` implícito `auto` también — saca una
          segunda barra, horizontal. Eso es el "dos scrolls" de Apariencia.
          `container-type: inline-size` corta la propagación ahí: el ancho de
          ESTA columna vuelve a salir siempre del track del grid, nunca del
          contenido, así que ya no hay nada que inflar. Las grillas de abajo
          ahora preguntan por el ancho de ESTE contenedor (`@sm`/`@lg`/`@xl`),
          no por el del viewport. */}
      <div className="@container order-2 flex flex-col gap-10 lg:order-1">
        <section className="flex flex-col gap-4">
          <PanelHeading as="h2" title="Portada" />
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
          <PanelHeading as="h2" title="Logos" />
          {/* Cada `ImageField` (miniatura + botón "Cambiar"/"Subir" + "Quitar")
              no baja de ~254px de contenido mínimo: dos columnas piden
              ~524px. `@xl` (36rem/576px) es el primer escalón de contenedor
              que lo cubre con margen. */}
          <div className="grid gap-4 @xl:grid-cols-2">
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
          <PanelHeading as="h2" title="Colores" />
          {/* Cada `ColorField` shrinkea bien (el input de hex ya trae
              `min-w-0`): dos columnas piden ~320px. `@sm` (24rem/384px)
              alcanza con margen. */}
          <div className="grid gap-4 @sm:grid-cols-2">
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
          <PanelHeading as="h2" title="Tipografía y modo" />
          {/* La celda del radio (slider + 3 muestras de tamaño fijo) es la
              más ancha del grupo, ~220px. Emparejada con un select en la
              misma fila pide ~426px. `@lg` (32rem/512px) cubre eso con
              margen — `@sm` (384px) se quedaba corto justo para esta celda. */}
          <div className="grid gap-4 @lg:grid-cols-2">
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
            <div className="flex flex-col gap-2.5">
              <span id={radiusLabelId} className="text-sm leading-none font-medium">
                Redondeo de esquinas
              </span>
              <Controller
                control={control}
                name="radius_rem"
                render={({ field }) => (
                  <RadiusControl
                    value={field.value}
                    onChange={field.onChange}
                    labelledBy={radiusLabelId}
                    invalid={!!errors.radius_rem}
                  />
                )}
              />
              {errors.radius_rem ? (
                <p role="alert" className="text-destructive text-xs">
                  {errors.radius_rem.message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <PanelHeading as="h2" title="Densidad" />
          <p className="text-muted-foreground -mt-2 text-sm">
            Cuánto aire hay entre fotos, textos y botones en toda la carta. No cambia qué se puede hacer, cambia cuánto entra en
            la pantalla.
          </p>
          <div className="flex flex-col gap-2.5">
            <span id={densityLabelId} className="text-sm leading-none font-medium">
              Aire de la carta
            </span>
            <Controller
              control={control}
              name="density"
              render={({ field }) => (
                <DensityControl
                  value={field.value}
                  onChange={field.onChange}
                  labelledBy={densityLabelId}
                  invalid={!!errors.density}
                />
              )}
            />
            {errors.density ? (
              <p role="alert" className="text-destructive text-xs">
                {errors.density.message}
              </p>
            ) : null}
          </div>
        </section>

        {errors.root ? (
          <p role="alert" className="text-destructive text-sm">
            {errors.root.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="h-10 w-fit gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Guardar apariencia
        </Button>
      </div>

      <BrandPreview branding={branding} storeSlug={storeSlug} storeName={storeName} className="order-1 lg:order-2" />
    </form>
  )
}

/**
 * Slider de 0 a 2rem, paso 0.05 — el rango y precisión exactos de
 * `brandingSchema`. Reemplaza al viejo input de texto: un slider no puede
 * producir un valor fuera de rango ni basura, así que no hace falta ningún
 * clamping a mano.
 *
 * `src/components/ui/slider.tsx` es del chasis (no se toca) y solo reenvía
 * props al ROOT de Radix, no al Thumb — pero el `role="slider"` real, donde
 * un lector de pantalla busca nombre y valor, vive en el THUMB. Por eso el
 * nombre (`aria-labelledby`) y el valor en palabras (`aria-valuetext`) se
 * escriben a mano sobre el nodo `[data-slot="slider-thumb"]` que el
 * componente ya expone: no es tocar el archivo del chasis, es leer un
 * contrato (`data-slot`) que ya publica.
 */
function RadiusControl({
  value,
  onChange,
  labelledBy,
  invalid,
}: {
  value: number
  onChange: (next: number) => void
  labelledBy: string
  invalid: boolean
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const label = radiusLabel(value)

  useEffect(() => {
    const thumb = wrapperRef.current?.querySelector('[data-slot="slider-thumb"]')
    if (!thumb) return
    thumb.setAttribute('aria-labelledby', labelledBy)
    thumb.setAttribute('aria-valuetext', label)
    if (invalid) thumb.setAttribute('aria-invalid', 'true')
    else thumb.removeAttribute('aria-invalid')
  }, [label, labelledBy, invalid])

  return (
    <div className="flex flex-col gap-3">
      <div ref={wrapperRef}>
        <Slider min={0} max={2} step={0.05} value={[value]} onValueChange={([next]) => onChange(next)} />
      </div>

      {/* Muestras vivas: puramente decorativas (sin texto propio), no hace
          falta sacarlas del árbol de accesibilidad — no anuncian nada. */}
      <div className="flex items-end gap-3">
        {RADIUS_SAMPLES.map((sample) => (
          <div key={sample.label} className="flex flex-col items-center gap-1">
            <div
              className={`${sample.className} transition-[border-radius] duration-(--dur-base) ease-(--ease-out-quart)`}
              style={{ borderRadius: `${value}rem` }}
            />
            <span className="text-muted-foreground text-[0.6875rem]">{sample.label}</span>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-medium">{label}</span> · <span className="tabular">{value.toFixed(2)} rem</span>
      </p>
    </div>
  )
}

/**
 * Enum cerrado de 3 valores (ver `DENSITY_OPTIONS` en branding.schema.ts):
 * nunca un número libre, porque un valor intermedio inventado por el dueño
 * podría hundir un target por debajo de 44px y el sistema deja de poder
 * garantizarlo. Cada tarjeta es su propio target de 44px+ (toda la tarjeta es
 * el `<label>`, no solo el punto del radio), con una muestra decorativa arriba
 * que reproduce el mismo gap que esa opción termina aplicando —así "más aire"
 * se ve, no solo se lee. La combinación `RadioGroup` + `Label` que envuelve
 * `RadioGroupItem` es la misma que ya usa el checkout para "cómo pagás": un
 * enum cerrado como tarjetas seleccionables no es un control nuevo acá, es el
 * mismo recurso que el chasis `radio-group.tsx` ya resuelve.
 */
function DensityControl({
  value,
  onChange,
  labelledBy,
  invalid,
}: {
  value: Density
  onChange: (next: Density) => void
  labelledBy: string
  invalid: boolean
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as Density)}
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      // Abajo de @md (28rem/448px) tres columnas le dejan a cada tarjeta
      // menos de 140px, y la descripción más larga ("Más productos a la
      // vista. La carta entra en menos scroll.") se parte en demasiadas
      // líneas. Apiladas en 1 columna leen bien a cualquier ancho.
      className="grid grid-cols-1 gap-2.5 @md:grid-cols-3"
    >
      {DENSITY_OPTIONS.map((option) => {
        const meta = DENSITY_META[option]
        return (
          <Label
            key={option}
            className={cn(
              'border-input has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-ring/50 flex min-h-11 cursor-pointer flex-col gap-2.5 rounded-lg border p-3 font-normal transition-colors duration-(--dur-fast) has-[[data-state=checked]]:ring-2',
              invalid && 'border-destructive',
            )}
          >
            <div aria-hidden className="flex flex-col" style={{ gap: meta.sampleGap }}>
              <span className="bg-muted h-1.5 w-full rounded-pill transition-[background-color] duration-(--dur-base)" />
              <span className="bg-muted h-1.5 w-4/5 rounded-pill transition-[background-color] duration-(--dur-base)" />
              <span className="bg-muted h-1.5 w-full rounded-pill transition-[background-color] duration-(--dur-base)" />
            </div>
            <span className="flex items-center gap-2 text-sm font-medium">
              <RadioGroupItem value={option} />
              {meta.label}
            </span>
            <span className="text-muted-foreground text-xs">{meta.description}</span>
          </Label>
        )
      })}
    </RadioGroup>
  )
}
