'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * Navegación GET simple: el rango de fechas vive en la URL, así que un link
 * copiado (o un refresh) mantiene el mismo recorte. El filtro por estado, en
 * cambio, es local — no necesita ida y vuelta al servidor.
 */
export function DateFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const params = useSearchParams()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const next = new URLSearchParams(params.toString())
    const nextFrom = String(formData.get('from') ?? '')
    const nextTo = String(formData.get('to') ?? '')
    if (nextFrom) next.set('from', nextFrom)
    else next.delete('from')
    if (nextTo) next.set('to', nextTo)
    else next.delete('to')
    router.push(`/admin/pedidos?${next.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[0.6875rem] font-medium uppercase tracking-[0.08em]">Desde</span>
        <Input type="date" name="from" defaultValue={from} className="h-11" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[0.6875rem] font-medium uppercase tracking-[0.08em]">Hasta</span>
        <Input type="date" name="to" defaultValue={to} className="h-11" />
      </label>
      <Button type="submit" variant="outline" className="h-11">
        Filtrar
      </Button>
    </form>
  )
}
