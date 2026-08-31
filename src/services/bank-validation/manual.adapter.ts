import 'server-only'

import type { BankAccountValidator } from './bank-account-validator.port'

/**
 * El adapter no-op. Es el que queda CONFIGURADO POR DEFECTO y, hoy, el único
 * que corre en producción (decisiones D0/D7,
 * `docs/pipelines/2026-08-30-transferencia-bancaria/00-architecture.md` §3.4,
 * §8): no se contrató ningún proveedor de validación.
 *
 * Con esto, `holderMatch` resuelve siempre a `'unavailable'` y el flujo sigue
 * siendo checksum (`src/lib/cbu.ts`) + declaración del dueño + código de 6
 * dígitos — el "si no es viable, doble verificación y listo" que pidió el
 * dueño del producto. Es un camino de PRIMERA CLASE, no un degradado: nada en
 * el sistema asume que el proveedor va a contestar.
 */
export function createManualBankAccountValidator(): BankAccountValidator {
  return {
    async lookupByAlias() {
      return null
    },
    async lookupByCbu() {
      return null
    },
  }
}
