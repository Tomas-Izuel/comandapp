'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CircleAlert, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createStoreAction } from '@/controllers/platform.actions'
import { RESERVED_SLUGS } from '@/models/schemas/platform.schema'

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED_SLUG_SET = new Set<string>(RESERVED_SLUGS)

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Alta de tienda: el flujo central del backoffice. Crea la tienda, su
 * branding por default, el usuario del dueño y le empuja la invitación por
 * mail, todo en una sola operación (`createStoreWithOwner`). Acá solo se
 * deja explícito que esa invitación va a salir — si no llega, el detalle de
 * la tienda tiene un botón para reenviarla.
 */
export function StoreCreateForm() {
  const router = useRouter()
  const nameErrorId = useId()
  const slugErrorId = useId()
  const ownerEmailErrorId = useId()
  const formErrorId = useId()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [description, setDescription] = useState('')
  const [phoneE164, setPhoneE164] = useState('')
  const [whatsappPhoneE164, setWhatsappPhoneE164] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [pending, startTransition] = useTransition()

  const slugTouched = slug.length > 0
  const slugFormatValid = SLUG_PATTERN.test(slug) && slug.length >= 2 && slug.length <= 60
  // La lista está duplicada a propósito (ver RESERVED_SLUGS en platform.schema.ts):
  // avisar acá antes de que la base rechace con el mensaje del CHECK.
  const slugReserved = slugFormatValid && RESERVED_SLUG_SET.has(slug)
  const slugValid = slugFormatValid && !slugReserved

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    startTransition(async () => {
      const result = await createStoreAction({
        slug,
        name,
        ownerEmail,
        description: toNullable(description),
        phoneE164: toNullable(phoneE164),
        whatsappPhoneE164: toNullable(whatsappPhoneE164),
        address: toNullable(address),
        timezone: 'America/Argentina/Buenos_Aires',
        currency: 'ARS',
      })

      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      toast.success('Tienda creada', {
        description: `Le mandamos una invitación a ${ownerEmail} con un link directo al panel.`,
      })
      router.push(`/backoffice/tiendas/${result.data.storeId}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nombre del local</Label>
          <Input
            id="name"
            name="name"
            autoComplete="off"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? nameErrorId : undefined}
          />
          {fieldErrors.name ? (
            <p id={nameErrorId} className="text-destructive text-xs">
              {fieldErrors.name[0]}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug">Slug (URL pública)</Label>
          <Input
            id="slug"
            name="slug"
            autoComplete="off"
            spellCheck={false}
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            aria-invalid={(slugTouched && !slugValid) || fieldErrors.slug ? true : undefined}
            aria-describedby={slugErrorId}
            placeholder="mi-local"
          />
          <p
            id={slugErrorId}
            className={slugTouched && !slugValid ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
          >
            {fieldErrors.slug?.[0] ??
              (slugTouched && !slugFormatValid
                ? 'Minúsculas, números y guiones, sin espacios'
                : slugReserved
                  ? 'Esa dirección está reservada por la plataforma: elegí otra'
                  : `pedidos.app/${slug || 'mi-local'} — no se puede cambiar después`)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ownerEmail">Email del dueño</Label>
        <Input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          required
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          aria-invalid={fieldErrors.ownerEmail ? true : undefined}
          aria-describedby={ownerEmailErrorId}
        />
        <p id={ownerEmailErrorId} className="text-muted-foreground text-xs">
          {fieldErrors.ownerEmail?.[0] ??
            'Le mandamos una invitación con un link directo al panel apenas se cree la tienda. Vos nunca vas a ver ni definir su contraseña.'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Descripción (opcional)</Label>
        <Textarea
          id="description"
          name="description"
          autoComplete="off"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phoneE164">Teléfono (opcional)</Label>
          <Input
            id="phoneE164"
            name="phoneE164"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phoneE164}
            onChange={(e) => setPhoneE164(e.target.value)}
            placeholder="+54 9 11…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsappPhoneE164">WhatsApp (opcional)</Label>
          <Input
            id="whatsappPhoneE164"
            name="whatsappPhoneE164"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={whatsappPhoneE164}
            onChange={(e) => setWhatsappPhoneE164(e.target.value)}
            placeholder="+54 9 11…"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Dirección (opcional)</Label>
        <Input
          id="address"
          name="address"
          autoComplete="off"
          maxLength={200}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

      {error ? (
        <Alert variant="destructive" id={formErrorId}>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Button type="submit" size="lg" disabled={pending || (slugTouched && !slugValid)}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Dar de alta la tienda
        </Button>
      </div>
    </form>
  )
}
