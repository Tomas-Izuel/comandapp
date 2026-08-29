'use client'

import { useId, useState, useTransition } from 'react'
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDeleteButton } from './confirm-delete-button'
import { ProductImageField } from './product-image-field'
import { OptionGroupsEditor } from './option-groups-editor'
import { createProductAction, deleteProductAction, updateProductAction } from '@/controllers/catalog.actions'
import { productInputSchema, type ProductInput } from '@/models/schemas/catalog.schema'
import type { MenuCategory, MenuProduct } from '@/models/types'

/** Claves válidas de `ProductInput`, para no pisar un campo que el form no tiene. */
const PRODUCT_FIELD_KEYS: Record<keyof ProductInput, true> = {
  categoryId: true,
  name: true,
  description: true,
  imagePath: true,
  priceCents: true,
  prepMinutes: true,
  isAvailable: true,
  position: true,
}

function toFormValues(product: MenuProduct | null, defaultCategoryId: number | null, defaultPosition: number): ProductInput {
  if (!product) {
    return {
      categoryId: defaultCategoryId,
      name: '',
      description: '',
      imagePath: null,
      priceCents: 0,
      prepMinutes: 10,
      isAvailable: true,
      position: defaultPosition,
    }
  }
  return {
    categoryId: product.categoryId,
    name: product.name,
    // '' en vez de null: un <textarea> sin registrar no acepta un valor DOM
    // nulo. `setValueAs` en el register de abajo lo vuelve a convertir a
    // null al validar, que es lo que espera `productInputSchema`.
    description: product.description ?? '',
    imagePath: product.imagePath,
    priceCents: product.priceCents,
    prepMinutes: product.prepMinutes,
    isAvailable: product.isAvailable,
    position: product.position,
  }
}

/**
 * Input numérico con borrador en string, separado del valor validado.
 *
 * Un input controlado por un `number` fuerza "0" apenas se borra el campo
 * para tipear de nuevo (F-10): `Number('') === 0` y el cursor queda detrás de
 * un cero que nadie tipeó. Acá se ve el string tal cual lo escribe el dueño;
 * la conversión a entero (centavos o minutos) pasa por `Math.round` — nunca
 * queda un float a mitad de camino — y solo se aplica cuando el string es un
 * número válido.
 */
function DraftNumberField({
  id,
  value,
  onValueChange,
  scale = 1,
  errorId,
  invalid,
  ...props
}: {
  id: string
  value: number
  onValueChange: (n: number) => void
  scale?: number
  errorId?: string
  invalid?: boolean
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(() => String(value / scale))

  return (
    <Input
      id={id}
      inputMode="decimal"
      value={draft}
      aria-invalid={invalid || undefined}
      aria-describedby={errorId}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') {
          onValueChange(0)
          return
        }
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) onValueChange(Math.round(parsed * scale))
      }}
      {...props}
    />
  )
}

export function ProductDrawer({
  storeId,
  currency,
  categories,
  product,
  defaultCategoryId,
  defaultPosition,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: number
  currency: string
  categories: MenuCategory[]
  product: MenuProduct | null
  defaultCategoryId: number | null
  defaultPosition: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  // El padre remonta este componente con una `key` distinta por producto (ver
  // category-list.tsx): así el form arranca de cero al abrir con un producto
  // distinto, sin sincronizar estado a mano en un efecto.
  const [currentProductId, setCurrentProductId] = useState<number | null>(product?.id ?? null)
  const [pending, startTransition] = useTransition()

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<ProductInput>({
    // `productInputSchema` usa `z.coerce.number()`: el tipo de "entrada" que
    // infiere Zod para esos campos es `unknown` (acepta cualquier cosa antes
    // de coercionar), lo que rompe la inferencia automática del resolver. El
    // form igual valida contra el mismo schema que el servidor; el cast solo
    // le devuelve al form los tipos ya coercionados que la UI necesita.
    resolver: zodResolver(productInputSchema) as Resolver<ProductInput>,
    defaultValues: toFormValues(product, defaultCategoryId, defaultPosition),
  })

  const nameId = useId()
  const descId = useId()
  const categorySelectId = useId()
  const priceId = useId()
  const prepId = useId()
  const priceErrorId = `${priceId}-error`
  const prepErrorId = `${prepId}-error`
  const nameErrorId = `${nameId}-error`
  const rootErrorId = useId()

  const mode = currentProductId === null ? 'create' : 'edit'
  const name = useWatch({ control, name: 'name' })
  const isAvailable = useWatch({ control, name: 'isAvailable' })

  const onSubmit = handleSubmit((values) => {
    // F-11: en el mostrador la señal va y viene. Cortar acá evita un
    // `fetch` que tarda minutos en fallar y devuelve "guardado fallido" sin
    // explicar por qué — mejor decir la causa real de una.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('root', { type: 'server', message: 'Estás sin conexión. Tu cambio sigue acá, probá cuando vuelva la señal.' })
      return
    }
    startTransition(async () => {
      if (currentProductId === null) {
        const result = await createProductAction(storeId, values)
        if (!result.ok) {
          applyServerErrors(result)
          return
        }
        setCurrentProductId(result.data)
        onSaved()
        toast.success('Producto creado. Ahora podés agregar sus modificadores.')
        return
      }

      const result = await updateProductAction(storeId, currentProductId, values)
      if (!result.ok) {
        applyServerErrors(result)
        return
      }
      onSaved()
      toast.success('Producto guardado')
      onOpenChange(false)
    })

    function applyServerErrors(result: { error: string; fieldErrors?: Record<string, string[]> }) {
      setError('root', { type: 'server', message: result.error })
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        // Solo campos que el form conoce: una clave fuera de banda (ej. un
        // futuro `conflict` de 409) no tiene dónde mostrarse y ya quedó
        // cubierta por el mensaje general de `root`.
        if (field in PRODUCT_FIELD_KEYS) setError(field as keyof ProductInput, { type: 'server', message: messages[0] })
      }
    }
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      {/*
        `lg:max-w-3xl` (48rem) — mismo número que `--admin-max-form`, el ancho
        que el chasis usa para columnas de lectura del panel: no es
        casualidad, es el mismo criterio ("suficiente para un formulario, no
        una página"). Este era el formulario más pesado del panel (foto +
        precio + prep + grupos de opciones) apretado en 32rem; el editor de
        modificadores es lo que más gana, porque queda a todo el ancho nuevo
        del drawer en vez de compartirlo con la foto (ver el grid de abajo).
      */}
      <DrawerContent className="w-full sm:max-w-lg lg:max-w-3xl">
        <DrawerHeader>
          <DrawerTitle>{mode === 'create' ? 'Nuevo producto' : 'Editar producto'}</DrawerTitle>
          <DrawerDescription>El precio y el tiempo de preparación los ve el cliente antes de pedir.</DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          <form id="product-form" onSubmit={onSubmit} className="flex flex-col gap-4 pb-6">
            {/*
              ≥lg: foto a la izquierda, el resto del form a la derecha. En
              32rem (el ancho viejo del drawer) esto hubiera dejado ambas
              columnas apretadas; con el drawer en 48rem (`lg:max-w-3xl` en
              `DrawerContent`) cada una respira. La foto sigue siendo el
              primer campo del DOM — el orden de lectura y de tab no cambia,
              solo la posición — porque sigue siendo la decisión que más
              vende (ver brief de superficie) y no se trata como opcional
              por no ir "arriba de todo" en esta disposición.
            */}
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[16rem_1fr] lg:items-start lg:gap-6">
              <div className="flex flex-col gap-1.5">
                <Label>Foto</Label>
                <Controller
                  control={control}
                  name="imagePath"
                  render={({ field }) => (
                    <ProductImageField storeId={storeId} path={field.value} onChange={field.onChange} />
                  )}
                />
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={nameId}>Nombre</Label>
                  <Input
                    id={nameId}
                    {...register('name')}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? nameErrorId : undefined}
                    className="h-10"
                  />
                  {errors.name ? (
                    <p id={nameErrorId} role="alert" className="text-destructive text-xs">
                      {errors.name.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={descId}>Descripción</Label>
                  <Textarea
                    id={descId}
                    {...register('description', { setValueAs: (v: string) => (v.trim() === '' ? null : v) })}
                    rows={2}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={categorySelectId}>Categoría</Label>
                  <Controller
                    control={control}
                    name="categoryId"
                    render={({ field }) => (
                      <Select
                        value={field.value === null ? 'none' : String(field.value)}
                        onValueChange={(v) => field.onChange(v === 'none' ? null : Number(v))}
                      >
                        <SelectTrigger id={categorySelectId} className="h-10 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin categoría</SelectItem>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={String(category.id)}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={priceId}>Precio</Label>
                    <Controller
                      control={control}
                      name="priceCents"
                      render={({ field }) => (
                        <DraftNumberField
                          id={priceId}
                          value={field.value}
                          onValueChange={field.onChange}
                          scale={100}
                          min={0}
                          step={1}
                          invalid={!!errors.priceCents}
                          errorId={errors.priceCents ? priceErrorId : undefined}
                          className="h-10"
                        />
                      )}
                    />
                    {errors.priceCents ? (
                      <p id={priceErrorId} role="alert" className="text-destructive text-xs">
                        {errors.priceCents.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={prepId}>Minutos de preparación</Label>
                    <Controller
                      control={control}
                      name="prepMinutes"
                      render={({ field }) => (
                        <DraftNumberField
                          id={prepId}
                          value={field.value}
                          onValueChange={field.onChange}
                          min={0}
                          max={240}
                          step={1}
                          invalid={!!errors.prepMinutes}
                          errorId={errors.prepMinutes ? prepErrorId : undefined}
                          className="h-10"
                        />
                      )}
                    />
                    {errors.prepMinutes ? (
                      <p id={prepErrorId} role="alert" className="text-destructive text-xs">
                        {errors.prepMinutes.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Botón real de tamaño táctil (44px, F-04): el Checkbox de Radix no es un
                    input nativo, así que un <label> alrededor no lo activa al hacer click
                    en el texto. Acá el botón entero es el control; el Checkbox de adentro
                    es solo el indicador visual. */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setValue('isAvailable', !isAvailable, { shouldValidate: true })}
                  aria-pressed={isAvailable}
                  className="flex h-11 w-fit items-center justify-start gap-2 px-2"
                >
                  <Checkbox checked={isAvailable} onCheckedChange={() => {}} tabIndex={-1} className="pointer-events-none" />
                  <span className="text-sm font-normal">Disponible para pedir</span>
                </Button>

                {errors.root ? (
                  <p id={rootErrorId} role="alert" className="text-destructive text-sm">
                    {errors.root.message}
                  </p>
                ) : null}
              </div>
            </div>
          </form>

          <div className="border-border border-t pt-4 pb-6">
            <p className="mb-3 text-sm font-medium">Modificadores</p>
            <OptionGroupsEditor
              key={currentProductId ?? 'new'}
              storeId={storeId}
              currency={currency}
              productId={currentProductId}
              initialGroups={product?.optionGroups}
            />
          </div>
        </ScrollArea>

        <DrawerFooter className="flex-row justify-between border-t pt-4">
          <div>
            {mode === 'edit' && currentProductId !== null ? (
              <ConfirmDeleteButton
                itemLabel={`"${name}"`}
                description="Deja de verse en la carta. Los pedidos que ya lo tienen no cambian: guardan el nombre y el precio de cuando se pidieron."
                size="sm"
                onConfirm={async () => {
                  const result = await deleteProductAction(storeId, currentProductId)
                  if (result.ok) {
                    onSaved()
                    onOpenChange(false)
                  }
                  return result
                }}
              />
            ) : null}
          </div>
          <div className="flex gap-2">
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {mode === 'create' && currentProductId !== null ? 'Listo' : 'Cancelar'}
              </Button>
            </DrawerClose>
            <Button type="submit" form="product-form" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
