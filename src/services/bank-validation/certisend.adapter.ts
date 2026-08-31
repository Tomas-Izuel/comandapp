import 'server-only'

import { z } from 'zod'
import { log } from '@/lib/log'
import type { BankAccountLookup, BankAccountValidator } from './bank-account-validator.port'

/**
 * Certisend / Sysworld Servicios S.A. (marketplace ApiLanding), producto
 * investigado bajo el nombre `Fintech_AR_CBU_GOLD`.
 *
 * *** VEREDICTO: NO VIABLE HOY. Este adapter está escrito contra el contrato
 * reportado, pero APAGADO. Nadie lo invoca salvo que alguien setee
 * `BANK_VALIDATION_PROVIDER=certisend` a mano (ver `index.ts`), y el sistema
 * entero funciona sin él (D0/D7). ***
 *
 * Motivos del descarte, investigados el 2026-08-30/31
 * (`docs/pipelines/2026-08-30-transferencia-bancaria/00-architecture.md`
 * §3.4):
 *   - El endpoint responde `401 security tokens not defined.` sin
 *     `token-susc`/`token-api`, y el producto GOLD ya NO figura en el
 *     catálogo autoservicio 2026 (el backend vivo solo expone
 *     `cbu-validation`, que valida el CBU pero no devuelve titular).
 *   - Sin sandbox, sin precio publicado, sin SLA.
 *   - Los dos secretos viajan por query string: quedan en logs de proxy, de
 *     Cloudflare y en el `Referer`.
 *   - Su propia status page marcó el componente que sirve este lookup
 *     ("BD Certisend & VWCore") en 0,000 % de uptime durante los 90 días
 *     corridos hasta el 30/08/2026.
 *
 * Se escribe igual, mapeado contra la FORMA reportada del payload
 * (`titular.nombre`, `cuenta.nro_cbu`, `respuesta.descripcion` =
 * "ALIAS ENCONTRADO"), confirmada por identidad de esquema con BDC Conecta
 * (que documenta públicamente el mismo lookup con `nombre`, `cuit`,
 * `tipoPersona` y la cadena exacta `"respuestaDescripcion": "ALIAS
 * ENCONTRADO"`). Así, el día que exista un contrato firmado, activar el
 * proveedor es una variable de entorno y no un refactor — pero el campo del
 * CUIT del titular NO está confirmado contra un payload real (nunca hubo
 * sandbox para probarlo): se mapea como mejor esfuerzo desde
 * `titular.cuit`, y hay que corregirlo contra la respuesta real el día que
 * haya credenciales.
 *
 * `CERTISEND_API_URL`, `CERTISEND_TOKEN_SUSC` y `CERTISEND_TOKEN_API` NO
 * viven en `src/lib/env.server.ts`: ese archivo es un contrato de T0 fuera de
 * la propiedad exclusiva de este slice (T1, ver `01-tasks.md`). Se leen acá
 * adentro, contenidas a este módulo — reportado en el dev log como candidato
 * a centralizar el día que alguien toque ese archivo por otro motivo.
 */

const TIMEOUT_MS = 5_000

const responseSchema = z.object({
  titular: z
    .object({
      nombre: z.string().nullable().optional(),
      cuit: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .nullable()
    .optional(),
  cuenta: z
    .object({
      nro_cbu: z.string().nullable().optional(),
      estado: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  respuesta: z
    .object({
      descripcion: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

function credentials(): { url: string; tokenSusc: string; tokenApi: string } | null {
  const url = process.env.CERTISEND_API_URL
  const tokenSusc = process.env.CERTISEND_TOKEN_SUSC
  const tokenApi = process.env.CERTISEND_TOKEN_API
  if (!url || !tokenSusc || !tokenApi) return null
  return { url, tokenSusc, tokenApi }
}

async function lookup(query: { cbu?: string; alias?: string }): Promise<BankAccountLookup | null> {
  const creds = credentials()
  if (!creds) return null

  try {
    const endpoint = new URL(creds.url)
    endpoint.searchParams.set('cbu', query.cbu ?? query.alias ?? '')
    // Los dos tokens viajan por query string porque así responde el
    // endpoint real (verificado con `curl`): es una de las razones por las
    // que este proveedor está descartado, no una elección de este adapter.
    endpoint.searchParams.set('token-susc', creds.tokenSusc)
    endpoint.searchParams.set('token-api', creds.tokenApi)

    const response = await fetch(endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return null

    const body: unknown = await response.json()
    const parsed = responseSchema.safeParse(body)
    if (!parsed.success) return null

    // `includes('ENCONTRADO')` a secas es un falso positivo garantizado:
    // 'NO ENCONTRADO' contiene 'ENCONTRADO' como substring, así que la
    // respuesta negativa se leía como positiva. Se exige la palabra y se
    // descarta explícitamente la negación.
    //
    // Ante cualquier descripción que no reconozcamos se devuelve `null`
    // ("no pudimos comprobar"), nunca un match: este adapter alimenta un
    // veredicto sobre la cuenta donde el local cobra, y equivocarse hacia
    // "coincide" es el único error que no se puede cometer.
    const description = (parsed.data.respuesta?.descripcion ?? '').toUpperCase()
    const found = /(?<!\bNO\s)\bENCONTRADO\b/.test(description) && !/\bNO\s+ENCONTRADO\b/.test(description)
    if (!found) return null

    const cuit = parsed.data.titular?.cuit
    return {
      cbu: parsed.data.cuenta?.nro_cbu ?? null,
      alias: query.alias ?? null,
      holderName: parsed.data.titular?.nombre ?? null,
      holderTaxId: cuit == null ? null : String(cuit),
      bankCode: null,
      accountStatus: parsed.data.cuenta?.estado ?? null,
    }
  } catch (err) {
    // NUNCA loguear `body` ni ningún campo de la respuesta: puede traer el
    // nombre y el CUIT de una persona (00-architecture.md §5.3, §6.3). Solo
    // el hecho de que falló.
    log.error('bank-validation.certisend', 'no se pudo contrastar el titular', err)
    return null
  }
}

export function createCertisendBankAccountValidator(): BankAccountValidator {
  return {
    lookupByAlias: (alias) => lookup({ alias }),
    lookupByCbu: (cbu) => lookup({ cbu }),
  }
}
