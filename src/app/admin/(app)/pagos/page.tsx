import { redirect } from 'next/navigation'
import { resolveAdminSession, getPaymentConnectionStatus, getBankAccountStatus } from '@/controllers/admin.controller'
import { apexUrl } from '@/lib/urls'
import { PageFrame, PanelHeading } from '@/views/admin/page-frame'
import { PaymentForm } from '@/views/admin/pagos/payment-form'
import { BankAccountForm } from '@/views/admin/pagos/bank-account-form'

export default async function AdminPaymentsPage() {
  const session = await resolveAdminSession()
  if (session.status !== 'ok') redirect('/admin/acceso')

  // Las dos lecturas son independientes (tablas distintas, sin dependencia
  // entre sí), así que van en paralelo en vez de esperar una a la otra.
  const [status, bankAccountStatus] = await Promise.all([
    getPaymentConnectionStatus(session.store.id),
    getBankAccountStatus(session.store.id),
  ])
  // Server-to-server: el webhook queda siempre en el apex, independiente del
  // wildcard de subdominio (00-architecture.md §3.2).
  const webhookUrl = apexUrl(`/api/webhooks/mercadopago?store_id=${session.store.id}`)

  return (
    <PageFrame
      title="Pagos"
      description="Cada local elige cómo cobrar: Mercado Pago online, al retirar en el mostrador, o transferencia bancaria directa. Sin al menos uno, la vitrina no puede tomar pedidos."
      width="form"
    >
      <div className="flex flex-col gap-8">
        <PaymentForm storeId={session.store.id} status={status} webhookUrl={webhookUrl} />

        <div className="border-border border-t pt-8">
          <PanelHeading
            title="Transferencia bancaria"
            description="El cliente transfiere directo a tu cuenta y vos marcás el pedido como pagado cuando ves la plata acreditada."
          />
          <BankAccountForm storeId={session.store.id} status={bankAccountStatus} />
        </div>
      </div>
    </PageFrame>
  )
}
