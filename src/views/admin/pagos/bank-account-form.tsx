'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, Landmark, Loader2, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  requestBankAccountChangeAction,
  lookupBankHolderAction,
  setBankAccountActiveAction,
  deleteBankAccountAction,
} from '@/controllers/admin.actions'
import { ConfirmWithCode, type ConfirmWithCodeHandle } from '@/views/admin/shared/confirm-with-code'
import { ConfirmDeleteButton } from '@/views/admin/catalogo/confirm-delete-button'
import { CBU_LENGTH, isValidCbu, isValidAlias, bankNameForCbu, normalizeCbu, normalizeAlias } from '@/lib/cbu'
import type { BankAccountStatus, BankHolderProbe } from '@/controllers/admin.controller'
import type { BankAccountInput } from '@/models/schemas/store.schema'

/**
 * Toggle de "cuenta activa": local a esta pantalla a propósito. El de
 * `views/admin/ajustes/fields.tsx` está documentado como compartido SOLO entre
 * las dos páginas de Ajustes que arrastran un `useForm` con barra de guardado
 * — este toggle no guarda nada por lotes, pega directo al servidor apenas se
 * toca (mismo patrón que `AcceptingOrdersToggle`), así que es una pieza
 * distinta aunque se vea parecida.
 */
function ActiveToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'has-[:focus-visible]:ring-ring/50 flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors has-[:focus-visible]:ring-3',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted cursor-pointer',
      )}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} />
      <span className="text-sm font-medium">Cuenta activa</span>
    </label>
  )
}

type ProbeState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'done'; result: BankHolderProbe }
  | { step: 'failed'; message: string }

/**
 * "Contrastar titular": botón aparte, nunca en cada tecla — pedirle al
 * proveedor en cada cambio del CBU sería spamear un servicio pago por un
 * dato que todavía se está terminando de tipear. Solo se monta cuando
 * `validatorAvailable` (00-architecture.md §3.4: hoy siempre `false`, así que
 * en la práctica esta sección no aparece — pero se construye completa para el
 * día que haya un proveedor contratado).
 */
function HolderContrast({
  storeId,
  cbu,
  alias,
  holderTaxId,
  disabled,
}: {
  storeId: number
  cbu: string
  alias: string
  holderTaxId: string
  disabled: boolean
}) {
  const [probe, setProbe] = useState<ProbeState>({ step: 'idle' })
  const [pending, startTransition] = useTransition()

  function handleProbe() {
    setProbe({ step: 'loading' })
    startTransition(async () => {
      // Sin el CUIT que el dueño tipeó no hay con qué comparar del lado del
      // proveedor: `admin.actions.ts` calcula `match` a partir de ESTE campo,
      // no de un CUIT guardado antes.
      const result = await lookupBankHolderAction(storeId, {
        cbu: cbu || undefined,
        alias: alias || undefined,
        holderTaxId: holderTaxId || undefined,
      })
      if (!result.ok) {
        setProbe({ step: 'failed', message: result.error })
        return
      }
      setProbe({ step: 'done', result: result.data })
    })
  }

  const canProbe = holderTaxId !== '' && (cbu !== '' || alias !== '')

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Contrastar titular</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleProbe}
          disabled={disabled || pending || !canProbe}
          className="gap-2"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Contrastar contra el banco
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Compara el CUIT que cargaste contra el que tiene la cuenta. No te devolvemos ningún nombre: si no coincide, es
        información para vos, no un rechazo.
        {canProbe ? null : ' Hace falta el CUIT del titular para poder contrastar.'}
      </p>
      {probe.step === 'failed' ? (
        <p role="alert" className="text-destructive text-xs">
          {probe.message}
        </p>
      ) : null}
      {probe.step === 'done' ? (
        <p role="status" className="text-xs">
          {probe.result.match === 'match' ? (
            <span className="text-primary font-medium">El CUIT que cargaste coincide con el de la cuenta.</span>
          ) : probe.result.match === 'mismatch' ? (
            <span className="text-destructive font-medium">El CUIT de esa cuenta no coincide con el que cargaste.</span>
          ) : (
            <span className="text-muted-foreground">No pudimos comprobar el titular.</span>
          )}
        </p>
      ) : null}
    </div>
  )
}

export function BankAccountForm({ storeId, status }: { storeId: number; status: BankAccountStatus }) {
  const router = useRouter()
  const account = status.account

  const [cbu, setCbu] = useState(account?.cbu ?? '')
  const [alias, setAlias] = useState(account?.alias ?? '')
  const [holderName, setHolderName] = useState(account?.holderName ?? '')
  const [holderTaxId, setHolderTaxId] = useState(account?.holderTaxId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const confirmRef = useRef<ConfirmWithCodeHandle>(null)

  const [isActive, setIsActive] = useState(account?.isActive ?? true)
  const [togglingActive, startToggleTransition] = useTransition()

  const cbuError = useId()
  const aliasError = useId()
  const holderNameError = useId()
  const holderTaxIdError = useId()

  // Mismo módulo puro que corre en el servidor (T1.1): sin esto, una regex
  // aparte en la vista termina divergiendo del checksum real y el formulario
  // acepta o rechaza cosas distintas de lo que va a aceptar o rechazar el
  // servidor dos segundos después.
  const cbuDigits = normalizeCbu(cbu)
  const cbuComplete = cbuDigits.length === CBU_LENGTH
  const cbuValid = cbuComplete && isValidCbu(cbuDigits)
  const cbuChecksumBad = cbuComplete && !cbuValid
  const bankName = cbuValid ? bankNameForCbu(cbuDigits) : null

  const aliasTrimmed = alias.trim()
  const aliasNormalized = normalizeAlias(aliasTrimmed)
  const aliasBad = aliasTrimmed !== '' && !isValidAlias(aliasNormalized)
  const onlyAlias = aliasTrimmed !== '' && cbuDigits.length === 0

  const holderNameBad = holderName.trim().length > 0 && holderName.trim().length < 2
  const hasIdentifier = cbuDigits.length > 0 || aliasTrimmed !== ''

  const canSubmit =
    !submitting &&
    hasIdentifier &&
    !cbuChecksumBad &&
    !aliasBad &&
    holderName.trim().length >= 2

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSubmitting(true)
    confirmRef.current?.start()
  }

  function handleToggleActive(next: boolean) {
    startToggleTransition(async () => {
      const result = await setBankAccountActiveAction(storeId, next)
      if (!result.ok) {
        toast.error('No pudimos actualizar la cuenta', { description: result.error })
        return
      }
      setIsActive(next)
      toast.success(next ? 'Cuenta reactivada' : 'Cuenta pausada')
      router.refresh()
    })
  }

  async function handleDelete() {
    const result = await deleteBankAccountAction(storeId)
    if (result.ok) {
      toast.success('Borraste la cuenta bancaria')
      setCbu('')
      setAlias('')
      setHolderName('')
      setHolderTaxId('')
      router.refresh()
    }
    return result
  }

  const input: BankAccountInput = {
    cbu,
    alias,
    holderName,
    holderTaxId,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border flex items-start gap-3 rounded-lg border p-4">
        <Landmark className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.08em] uppercase">Estado</p>
          {account ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={
                  isActive
                    ? 'bg-primary/10 text-primary rounded-pill px-2.5 py-0.5 text-xs font-medium'
                    : 'bg-muted text-muted-foreground rounded-pill px-2.5 py-0.5 text-xs font-medium'
                }
              >
                {isActive ? 'Activa' : 'Pausada'}
              </span>
              {account.bankName ? <span className="text-muted-foreground text-xs">{account.bankName}</span> : null}
            </div>
          ) : (
            <p className="mt-1.5 text-sm">
              Todavía no cargaste una cuenta bancaria. Con una activa, sumás transferencia como forma de pago: el
              cliente ve el CBU y transfiere directo a tu cuenta, sin que nosotros ni Mercado Pago toquemos esa
              plata. Hace falta el CBU o CVU (o al menos un alias) y el nombre del titular.
            </p>
          )}
        </div>
        {account ? (
          <div className="flex shrink-0 items-center gap-1">
            <ActiveToggle checked={isActive} onChange={handleToggleActive} disabled={togglingActive} />
            <ConfirmDeleteButton
              itemLabel="la cuenta bancaria"
              description="El cliente deja de ver este CBU y no va a poder elegir transferencia. Los pedidos por transferencia ya confirmados no se ven afectados."
              onConfirm={handleDelete}
            />
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm">
        Este CBU (o alias) y el nombre del titular se le muestran al cliente en la pantalla de su pedido para que
        transfiera. Cambiarlos redirige ahí en más todos los cobros por transferencia — por eso pedimos un código
        antes de guardar.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-cbu">CBU o CVU</Label>
          <Input
            id="bank-cbu"
            value={cbu}
            onChange={(e) => setCbu(normalizeCbu(e.target.value).slice(0, CBU_LENGTH))}
            placeholder="22 dígitos"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            aria-invalid={cbuChecksumBad || !!fieldErrors.cbu?.[0]}
            aria-describedby={cbuError}
            className="tabular h-10 font-mono text-sm"
          />
          {fieldErrors.cbu?.[0] ? (
            <p id={cbuError} role="alert" className="text-destructive flex items-center gap-1.5 text-xs">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              {fieldErrors.cbu[0]}
            </p>
          ) : cbuChecksumBad ? (
            <p id={cbuError} role="alert" className="text-destructive flex items-center gap-1.5 text-xs">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              Revisá el CBU o CVU: los dígitos verificadores no dan.
            </p>
          ) : cbuValid ? (
            <p id={cbuError} className="text-primary flex items-center gap-1.5 text-xs">
              <CircleCheck className="size-3.5 shrink-0" aria-hidden />
              CBU con formato válido{bankName ? ` — ${bankName}` : ''}.
            </p>
          ) : onlyAlias ? (
            <p id={cbuError} className="text-warning-foreground flex items-center gap-1.5 text-xs">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              Sin CBU no podemos detectar un error de tipeo en el alias: si está mal escrito, no nos vamos a enterar
              hasta que un cliente transfiera a otra cuenta.
            </p>
          ) : (
            <p id={cbuError} className="text-muted-foreground text-xs">
              {cbuDigits.length}/{CBU_LENGTH} dígitos. Cubre CBU y CVU por igual.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-alias">Alias (opcional)</Label>
          <Input
            id="bank-alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value.slice(0, 20))}
            placeholder="mi.local.pagos"
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            aria-invalid={aliasBad || !!fieldErrors.alias?.[0]}
            aria-describedby={aliasError}
            className="h-10 text-sm"
          />
          {fieldErrors.alias?.[0] ? (
            <p id={aliasError} role="alert" className="text-destructive text-xs">
              {fieldErrors.alias[0]}
            </p>
          ) : aliasBad ? (
            <p id={aliasError} role="alert" className="text-destructive text-xs">
              El alias tiene que tener de 6 a 20 caracteres (letras, números, punto o guion).
            </p>
          ) : (
            <p id={aliasError} className="text-muted-foreground text-xs">
              Se muestra al lado del CBU como comodidad para el cliente.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-holder">Titular declarado</Label>
          <Input
            id="bank-holder"
            value={holderName}
            onChange={(e) => setHolderName(e.target.value.slice(0, 120))}
            placeholder="Como figura en tu cuenta"
            autoComplete="off"
            required
            disabled={submitting}
            aria-invalid={holderNameBad || !!fieldErrors.holderName?.[0]}
            aria-describedby={holderNameError}
            className="h-10 text-sm"
          />
          {fieldErrors.holderName?.[0] ? (
            <p id={holderNameError} role="alert" className="text-destructive text-xs">
              {fieldErrors.holderName[0]}
            </p>
          ) : holderNameBad ? (
            <p id={holderNameError} role="alert" className="text-destructive text-xs">
              Escribí el nombre completo del titular.
            </p>
          ) : (
            <p id={holderNameError} className="text-muted-foreground text-xs">
              Es lo que declarás vos. Lo ve el cliente al lado del CBU.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-tax-id">CUIT del titular (opcional)</Label>
          <Input
            id="bank-tax-id"
            value={holderTaxId}
            onChange={(e) => setHolderTaxId(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="11 dígitos, sin guiones"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            aria-invalid={!!fieldErrors.holderTaxId?.[0]}
            aria-describedby={holderTaxIdError}
            className="tabular h-10 font-mono text-sm"
          />
          {fieldErrors.holderTaxId?.[0] ? (
            <p id={holderTaxIdError} role="alert" className="text-destructive text-xs">
              {fieldErrors.holderTaxId[0]}
            </p>
          ) : (
            <p id={holderTaxIdError} className="text-muted-foreground text-xs">
              Nunca se le muestra al cliente. Solo sirve para contrastar contra el banco si en algún momento hay un
              proveedor conectado.
            </p>
          )}
        </div>

        {status.validatorAvailable ? (
          <HolderContrast
            storeId={storeId}
            cbu={cbuDigits}
            alias={aliasNormalized}
            holderTaxId={holderTaxId}
            disabled={submitting}
          />
        ) : null}

        {error && !Object.keys(fieldErrors).length ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {!hasIdentifier ? (
          <p className="text-muted-foreground text-xs">Cargá un CBU, un CVU o un alias — hace falta al menos uno.</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Al confirmar te vamos a mandar un código de 6 dígitos al mail de tu cuenta para autorizar el cambio —
            antes de que se guarde nada.
          </p>
        )}

        <Button type="submit" disabled={!canSubmit} className="h-10 w-fit gap-2">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {account ? 'Actualizar cuenta bancaria' : 'Cargar cuenta bancaria'}
        </Button>
      </form>

      <ConfirmWithCode
        ref={confirmRef}
        storeId={storeId}
        title="Confirmá la cuenta bancaria"
        description="Cambiar el CBU o el titular redirige a dónde transfieren todos los clientes que paguen por transferencia."
        requestChange={() => requestBankAccountChangeAction(storeId, input)}
        onRequestFailed={(result) => {
          setError(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          setSubmitting(false)
        }}
        onCancel={() => setSubmitting(false)}
        onConfirmed={() => {
          toast.success(account ? 'Cuenta bancaria actualizada' : 'Cuenta bancaria cargada')
          setIsActive(true)
          setSubmitting(false)
          router.refresh()
        }}
      />
    </div>
  )
}
