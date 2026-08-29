import { redirect } from 'next/navigation'
import { resolveAdminSession, getPaymentConnectionStatus } from '@/controllers/admin.controller'
import { serverEnv } from '@/lib/env.server'
import { PageFrame } from '@/views/admin/page-frame'
import { PaymentForm } from '@/views/admin/pagos/payment-form'

export default async function AdminPaymentsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  const status = await getPaymentConnectionStatus(session.store.id)
  const webhookUrl = `${serverEnv().NEXT_PUBLIC_SITE_URL}/api/webhooks/mercadopago?store_id=${session.store.id}`

  return (
    <PageFrame
      title="Pagos"
      description="Cada local cobra con su propia cuenta de Mercado Pago. Sin esto, nadie puede pagar online — el pago al retirar sigue funcionando igual."
      width="form"
    >
      <PaymentForm storeId={session.store.id} status={status} webhookUrl={webhookUrl} />
    </PageFrame>
  )
}
