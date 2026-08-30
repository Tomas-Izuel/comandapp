import { PageFrame } from '@/views/admin/page-frame'
import { SettingsTabs } from '@/views/admin/ajustes/settings-tabs'

/**
 * Marco común de las tres sub-rutas de Ajustes: el título fijo y la sub-nav
 * de tabs. Es solo estructura — NO resuelve sesión. Regla dura del repo: el
 * layout no autoriza, cada `page.tsx` de abajo lo hace de nuevo con
 * `resolveAdminSession()` (mismo criterio que el resto de `/admin`, ver
 * `(app)/layout.tsx`). Si algún día esto necesita datos de sesión, van en la
 * page, nunca acá.
 */
export default function AjustesLayout({ children }: LayoutProps<'/admin/ajustes'>) {
  return (
    <PageFrame title="Ajustes" width="form">
      <div className="flex flex-col gap-6">
        <SettingsTabs />
        {children}
      </div>
    </PageFrame>
  )
}
