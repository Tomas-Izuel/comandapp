import 'server-only'

import { createCertisendBankAccountValidator } from './certisend.adapter'
import { createManualBankAccountValidator } from './manual.adapter'
import type { BankAccountValidator } from './bank-account-validator.port'

export type { BankAccountLookup, BankAccountValidator } from './bank-account-validator.port'

let cached: BankAccountValidator | null = null

/**
 * Fábrica por env, igual que `getNotifier()` (`WHATSAPP_PROVIDER`) y
 * `getGeocoder()`.
 *
 * `BANK_VALIDATION_PROVIDER` NO vive en `src/lib/env.server.ts` (ver el
 * comentario largo en `certisend.adapter.ts`): se lee `process.env`
 * directo acá, contenido a este módulo.
 *
 * Default `'manual'`: sin la variable configurada —el estado de hoy, y el que
 * va a seguir siendo mientras no haya un proveedor contratado (D0/D7)— el
 * sistema funciona ENTERO. El adapter no-op alcanza para el "checksum +
 * declaración + código" que es el camino de primera clase, no un degradado.
 */
export function getBankAccountValidator(): BankAccountValidator {
  if (cached) return cached
  cached =
    process.env.BANK_VALIDATION_PROVIDER === 'certisend'
      ? createCertisendBankAccountValidator()
      : createManualBankAccountValidator()
  return cached
}

/**
 * ¿Hay un proveedor de verdad configurado? Distinto de "el adapter no tira":
 * el manual NUNCA tira, pero tampoco resuelve nada. Esto es lo que usa
 * `getBankAccountStatus` (`admin.controller.ts`) para decidir si el panel
 * muestra la sección de contraste automático — con `false` (el caso normal
 * hoy), esa sección ni se renderiza, en vez de mostrar un botón que nunca va
 * a hacer nada.
 */
export function hasBankAccountValidator(): boolean {
  return (
    process.env.BANK_VALIDATION_PROVIDER === 'certisend' &&
    Boolean(process.env.CERTISEND_API_URL) &&
    Boolean(process.env.CERTISEND_TOKEN_SUSC) &&
    Boolean(process.env.CERTISEND_TOKEN_API)
  )
}
