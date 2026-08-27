import 'server-only'

import { serverEnv } from '@/lib/env.server'
import { whatsappCloudAdapter } from './whatsapp-cloud.adapter'
import { whatsappLinkAdapter } from './whatsapp-link.adapter'
import type { Notifier } from './notifier.port'

/** Elige el adapter según `WHATSAPP_PROVIDER`. Default `link`: no depende de que Meta apruebe nada. */
export function getNotifier(): Notifier {
  const env = serverEnv()
  return env.WHATSAPP_PROVIDER === 'cloud' ? whatsappCloudAdapter : whatsappLinkAdapter
}

export type { NotificationResult, NotificationTemplate, NotificationVars, Notifier } from './notifier.port'
export { countFailedNotifications } from './log'
