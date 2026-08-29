'use client'

import { useId, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2, UserPlus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/surfaces'
import { PanelHeading } from '@/views/admin/page-frame'
import { inviteCourierAction } from '@/controllers/staff.actions'
import { inviteCourierSchema, type InviteCourierInput } from '@/models/schemas/courier.schema'

const DEFAULTS: InviteCourierInput = { displayName: '', email: '' }

/**
 * Claves válidas de `InviteCourierInput`: mismo criterio que
 * `PRODUCT_FIELD_KEYS` en `product-drawer.tsx` — un `fieldErrors` del
 * servidor con una clave que el form no tiene (ej. un futuro `conflict`) no
 * tiene dónde mostrarse y ya queda cubierto por el mensaje de `root`.
 */
const FIELD_KEYS: Record<keyof InviteCourierInput, true> = {
  displayName: true,
  email: true,
}

export function InviteCourierForm({ storeId, onInvited }: { storeId: number; onInvited: () => void }) {
  const [pending, startTransition] = useTransition()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteCourierInput>({
    resolver: zodResolver(inviteCourierSchema),
    defaultValues: DEFAULTS,
  })

  const nameId = useId()
  const emailId = useId()
  const nameErrorId = `${nameId}-error`
  const emailErrorId = `${emailId}-error`

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await inviteCourierAction(storeId, values)
      if (!result.ok) {
        setError('root', { type: 'server', message: result.error })
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in FIELD_KEYS) setError(field as keyof InviteCourierInput, { type: 'server', message: messages[0] })
        }
        return
      }
      toast.success(`Invitación enviada a ${values.displayName}`)
      reset(DEFAULTS)
      onInvited()
    })
  })

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeading
        title="Invitar repartidor"
        description="El nombre lo ve el cliente en el seguimiento del pedido, ej. «Martín está llevando tu pedido»."
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={nameId}>Nombre</Label>
          <Input
            id={nameId}
            {...register('displayName')}
            placeholder="Como lo va a ver el cliente"
            aria-invalid={!!errors.displayName || undefined}
            aria-describedby={errors.displayName ? nameErrorId : undefined}
            className="h-10"
          />
          {errors.displayName ? (
            <p id={nameErrorId} role="alert" className="text-destructive text-xs">
              {errors.displayName.message}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            id={emailId}
            type="email"
            autoComplete="off"
            {...register('email')}
            placeholder="repartidor@ejemplo.com"
            aria-invalid={!!errors.email || undefined}
            aria-describedby={errors.email ? emailErrorId : undefined}
            className="h-10"
          />
          {errors.email ? (
            <p id={emailErrorId} role="alert" className="text-destructive text-xs">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={pending} className="h-10 gap-2 sm:w-fit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          Invitar
        </Button>
      </form>

      {errors.root?.message ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {errors.root.message}
        </p>
      ) : null}
    </Panel>
  )
}
