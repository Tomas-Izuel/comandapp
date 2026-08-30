'use client'

import { useId, useTransition } from 'react'
import { useForm, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { updateStoreProfileAction } from '@/controllers/admin.actions'
import { storeProfileInputSchema, type StoreProfileInput } from '@/models/schemas/store.schema'
import { PanelHeading } from '@/views/admin/page-frame'
import { Field, SaveBar, toEmptyToNull } from '@/views/admin/ajustes/fields'
import type { Store } from '@/models/types'

/**
 * `leaflet` toca `window` apenas se importa (detección de features de
 * browser), así que el campo del mapa se carga con `ssr:false`: Next no
 * evalúa ese módulo en el servidor y el build no se entera de que existe.
 * El esqueleto evita el salto de layout mientras se descarga el chunk.
 */
const LocationMapField = dynamic(() => import('@/views/admin/ajustes/location-map-field'), {
  ssr: false,
  loading: () => <MapFieldSkeleton />,
})

function MapFieldSkeleton() {
  return <div className="bg-muted h-72 w-full animate-pulse rounded-lg" aria-hidden />
}

function storeToProfileInput(store: Store): StoreProfileInput {
  return {
    name: store.name,
    // '' en vez de null: los inputs de texto no registrados no aceptan un
    // valor DOM nulo. Se vuelve a convertir a null en `setValueAs`.
    description: store.description ?? '',
    phoneE164: store.phoneE164 ?? '',
    whatsappPhoneE164: store.whatsappPhoneE164 ?? '',
    address: store.address ?? '',
    instagramHandle: store.links.instagramHandle ?? '',
    mapsUrl: store.links.mapsUrl ?? '',
    rappiUrl: store.links.rappiUrl ?? '',
    pedidosYaUrl: store.links.pedidosYaUrl ?? '',
    uberEatsUrl: store.links.uberEatsUrl ?? '',
    latitude: store.latitude,
    longitude: store.longitude,
  }
}

/** Traduce las claves internas del schema a lo que el dueño del local reconoce (F-05). */
const FIELD_LABELS: Record<keyof StoreProfileInput, string> = {
  name: 'Nombre',
  description: 'Descripción',
  phoneE164: 'Teléfono',
  whatsappPhoneE164: 'WhatsApp',
  address: 'Dirección',
  latitude: 'Ubicación en el mapa',
  longitude: 'Ubicación en el mapa',
  instagramHandle: 'Instagram',
  mapsUrl: 'Cómo llegar',
  rappiUrl: 'Rappi',
  pedidosYaUrl: 'PedidosYa',
  uberEatsUrl: 'Uber Eats',
}

/**
 * "El local": datos, dirección + mapa, canales. Antes era el primer tercio de
 * `settings-form.tsx`; se separó de "Pedidos y envío" porque son dos
 * `useForm` independientes con dos acciones nombradas — mezclar el envío en
 * una sola pisaría la config de envío del otro form (00-architecture.md).
 */
export function ProfileForm({ storeId, store }: { storeId: number; store: Store }) {
  const [pending, startTransition] = useTransition()
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StoreProfileInput>({
    // Ver el comentario equivalente en product-drawer.tsx: `z.coerce.number()`
    // hace que Zod infiera `unknown` para el tipo de entrada de esos campos.
    resolver: zodResolver(storeProfileInputSchema) as Resolver<StoreProfileInput>,
    defaultValues: storeToProfileInput(store),
  })

  const nameId = useId()
  const descId = useId()
  const phoneId = useId()
  const whatsappId = useId()
  const addressId = useId()
  const instagramId = useId()
  const mapsUrlId = useId()
  const rappiUrlId = useId()
  const pedidosYaUrlId = useId()
  const uberEatsUrlId = useId()

  const address = useWatch({ control, name: 'address' })

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateStoreProfileAction(storeId, values)
      if (!result.ok) {
        toast.error('No se pudo guardar', { description: result.error })
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in FIELD_LABELS) setError(field as FieldPath<StoreProfileInput>, { type: 'server', message: messages[0] })
        }
        return
      }
      toast.success('Guardaste los datos del local')
    })
  })

  const erroredFields = (Object.keys(errors) as (keyof StoreProfileInput)[]).filter((key) => key in FIELD_LABELS)

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <PanelHeading title="Datos del local" />
        <Field htmlFor={nameId} label="Nombre" error={errors.name?.message} errorId={`${nameId}-error`}>
          <Input
            id={nameId}
            {...register('name')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            className="h-10"
          />
        </Field>
        <Field htmlFor={descId} label="Descripción" errorId={`${descId}-error`}>
          <Textarea id={descId} {...register('description', { setValueAs: toEmptyToNull })} rows={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={phoneId}
            label="Teléfono"
            hint="Formato +54911…"
            error={errors.phoneE164?.message}
            errorId={`${phoneId}-error`}
          >
            <Input
              id={phoneId}
              {...register('phoneE164', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.phoneE164}
              aria-describedby={errors.phoneE164 ? `${phoneId}-error` : undefined}
              className="h-10"
            />
          </Field>
          <Field
            htmlFor={whatsappId}
            label="WhatsApp"
            hint="Al que le llegan los avisos de pedido listo"
            error={errors.whatsappPhoneE164?.message}
            errorId={`${whatsappId}-error`}
          >
            <Input
              id={whatsappId}
              {...register('whatsappPhoneE164', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.whatsappPhoneE164}
              aria-describedby={errors.whatsappPhoneE164 ? `${whatsappId}-error` : undefined}
              className="h-10"
            />
          </Field>
        </div>
        <Field
          htmlFor={addressId}
          label="Dirección"
          hint="Todo pedido es retiro en el local: es lo único que el cliente tiene para saber dónde ir a buscarlo."
          error={errors.address?.message}
          errorId={`${addressId}-error`}
        >
          <Input id={addressId} {...register('address', { setValueAs: toEmptyToNull })} className="h-10" />
        </Field>
        {!address?.trim() ? (
          <p className="text-destructive text-xs">
            Sin dirección cargada el cliente no sabe dónde retirar el pedido. Completala antes de tomar pedidos.
          </p>
        ) : null}
        <LocationMapField storeId={storeId} control={control} />
      </section>

      <section className="flex flex-col gap-4">
        <PanelHeading title="Canales del local" />
        <p className="text-muted-foreground text-sm">
          Lo que cargues acá aparece en la barra flotante al pie de tu carta. Los que dejes vacíos no se muestran.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={instagramId}
            label="Instagram"
            hint="Solo el usuario. La dirección la armamos nosotros."
            error={errors.instagramHandle?.message}
            errorId={`${instagramId}-error`}
          >
            {/*
              Prefijo "@" DENTRO del campo, no un placeholder: lo que se
              guarda es el usuario, y un placeholder desaparece apenas el
              dueño empieza a tipear — el "@" tiene que quedar visible todo
              el tiempo para que no intente pegar la URL entera.
            */}
            <div className="relative">
              <span
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
              >
                @
              </span>
              <Input
                id={instagramId}
                autoCapitalize="none"
                spellCheck={false}
                {...register('instagramHandle', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.instagramHandle}
                aria-describedby={errors.instagramHandle ? `${instagramId}-error` : undefined}
                className="h-10 pl-7"
              />
            </div>
          </Field>
          <Field
            htmlFor={mapsUrlId}
            label="Cómo llegar"
            hint="Link de Google Maps o Apple Maps. Si lo dejás vacío usamos la dirección de arriba."
            error={errors.mapsUrl?.message}
            errorId={`${mapsUrlId}-error`}
          >
            <Input
              id={mapsUrlId}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              {...register('mapsUrl', { setValueAs: toEmptyToNull })}
              aria-invalid={!!errors.mapsUrl}
              aria-describedby={errors.mapsUrl ? `${mapsUrlId}-error` : undefined}
              className="h-10"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-foreground text-sm font-semibold">Pedir por</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              htmlFor={rappiUrlId}
              label="Rappi"
              hint="Link a tu local en Rappi"
              error={errors.rappiUrl?.message}
              errorId={`${rappiUrlId}-error`}
            >
              <Input
                id={rappiUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('rappiUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.rappiUrl}
                aria-describedby={errors.rappiUrl ? `${rappiUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
            <Field
              htmlFor={pedidosYaUrlId}
              label="PedidosYa"
              hint="Link a tu local en PedidosYa"
              error={errors.pedidosYaUrl?.message}
              errorId={`${pedidosYaUrlId}-error`}
            >
              <Input
                id={pedidosYaUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('pedidosYaUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.pedidosYaUrl}
                aria-describedby={errors.pedidosYaUrl ? `${pedidosYaUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
            <Field
              htmlFor={uberEatsUrlId}
              label="Uber Eats"
              hint="Link a tu local en Uber Eats"
              error={errors.uberEatsUrl?.message}
              errorId={`${uberEatsUrlId}-error`}
            >
              <Input
                id={uberEatsUrlId}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                {...register('uberEatsUrl', { setValueAs: toEmptyToNull })}
                aria-invalid={!!errors.uberEatsUrl}
                aria-describedby={errors.uberEatsUrl ? `${uberEatsUrlId}-error` : undefined}
                className="h-10"
              />
            </Field>
          </div>
        </div>
      </section>

      <SaveBar pending={pending} errorMessages={erroredFields.map((key) => FIELD_LABELS[key])} />
    </form>
  )
}
