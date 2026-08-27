import type { ActionResult } from '@/models/types'

/**
 * La señal de conflicto de concurrencia, sin nada de servidor adentro.
 *
 * Vive aparte de `action-result.ts` porque el tablero de cocina —un Client
 * Component— necesita reconocer un 409 para refrescar en vez de mostrar un toast
 * genérico, y `action-result.ts` es `server-only` (arrastra el logger). Tenerlos
 * juntos hacía que el bundle del cliente importara `server-only` y el build
 * fallara: el error aparecía recién al compilar, no al tipar.
 */

/**
 * Clave de `fieldErrors` que la UI usa como señal fuera de banda de "esto fue un
 * 409, no un error cualquiera": `ActionResult` no tiene campo de status HTTP.
 * Al verla, la pantalla no avisa y sigue: refresca, porque el dato que tenía
 * quedó viejo (otro operario tocó el pedido primero).
 */
export const CONFLICT_FIELD = 'conflict'

/** `true` si el resultado viene de un conflicto de concurrencia (409). */
export function isConflict(result: ActionResult<unknown>): boolean {
  return !result.ok && result.fieldErrors?.[CONFLICT_FIELD] !== undefined
}
