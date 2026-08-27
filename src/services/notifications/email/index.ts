import 'server-only'

import { serverEnv } from '@/lib/env.server'
import { noopEmailSender } from './noop.adapter'
import { resendEmailSender } from './resend.adapter'
import type { EmailSender } from './email.port'

/**
 * Sin `RESEND_API_KEY` o `RESEND_FROM_EMAIL` no hay forma de mandar nada, así
 * que se entrega el adapter `noop` en vez de dejar que `resendEmailSender`
 * falle en tiempo de request. Mismo principio que `getNotifier()` de
 * WhatsApp: el canal es aditivo, nunca bloqueante.
 */
export function getEmailSender(): EmailSender {
  const env = serverEnv()
  return env.RESEND_API_KEY && env.RESEND_FROM_EMAIL ? resendEmailSender : noopEmailSender
}

export type { EmailSender, EmailTemplate, EmailVars } from './email.port'
