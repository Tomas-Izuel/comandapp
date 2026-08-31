import 'server-only'

/**
 * Puerto de validación de titular de cuenta bancaria.
 *
 * Copia literal de la forma de `src/services/geocoding/geocoder.port.ts`, que
 * resolvió las mismas preguntas: el proveedor es una decisión que puede
 * cambiar (hoy ninguno, ver `index.ts`) y el resto de la app no tiene por qué
 * enterarse.
 *
 * *** ESTE PUERTO SE LLAMA SOLO SOBRE EL CBU DEL PROPIO LOCAL, TIPEADO POR SU
 * PROPIO DUEÑO, EN SU PROPIO PANEL. NUNCA sobre un CBU que venga de un
 * cliente. *** Es lo que mantiene el feature fuera del alcance de la Ley
 * 25.326: el titular de una cuenta ajena es un dato personal de un tercero
 * sin base legal para consultarlo, pero el titular de la CUENTA PROPIA DEL
 * COMERCIANTE cae bajo la relación contractual que ya tenemos con él
 * (`docs/pipelines/2026-08-30-transferencia-bancaria/00-architecture.md`
 * §3.5, §5.3, §6.4).
 *
 * El resultado es una PROPUESTA que se contrasta, nunca una verdad que se
 * persiste — más estricto todavía que el geocoder: acá ni siquiera el
 * `BankAccountLookup` completo sobrevive más allá de la Server Action que lo
 * llama. Lo único que se guarda en la base es el veredicto
 * (`'match' | 'mismatch' | 'unavailable'`) y un timestamp. El nombre del
 * titular que devuelva un proveedor real es un dato personal de un tercero y
 * **no se persiste nunca**: ni en la base, ni en un log, ni en el payload que
 * llega al browser.
 */

export type BankAccountLookup = {
  /** El CBU/CVU tal como lo devolvió el proveedor, si lo devolvió. */
  cbu: string | null
  alias: string | null
  /**
   * Puede venir enmascarado según el proveedor. NUNCA sale de la Server
   * Action que llama a este puerto: se usa solo para eventualmente
   * comparar, no para mostrar.
   */
  holderName: string | null
  holderTaxId: string | null
  /** Código de entidad/PSP que haya devuelto el proveedor, si lo devuelve. */
  bankCode: string | null
  accountStatus: string | null
}

export interface BankAccountValidator {
  /** Devuelve `null` si no encontró nada o si algo falló: nunca tira. */
  lookupByAlias(alias: string): Promise<BankAccountLookup | null>
  lookupByCbu(cbu: string): Promise<BankAccountLookup | null>
}
