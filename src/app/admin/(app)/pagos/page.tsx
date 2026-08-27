import { redirect } from 'next/navigation'
import { resolveAdminSession, getPaymentConnectionStatus } from '@/controllers/admin.controller'
import { serverEnv } from '@/lib/env.server'
import { PaymentForm } from '@/views/admin/pagos/payment-form'

export default async function AdminPaymentsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const status = await getPaymentConnectionStatus(session.store.id)
  const webhookUrl = `${serverEnv().NEXT_PUBLIC_SITE_URL}/api/webhooks/mercadopago?store_id=${session.store.id}`

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pagos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cada local cobra con su propia cuenta de Mercado Pago. Sin esto, nadie puede pagar online — el pago al
          retirar sigue funcionando igual.
        </p>
      </div>
      <PaymentForm storeId={session.store.id} status={status} webhookUrl={webhookUrl} />
    </div>
  )
}
