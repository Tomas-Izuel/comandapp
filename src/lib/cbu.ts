/**
 * Validación de CBU/CVU y de alias, sin red y sin dependencias.
 *
 * SIN `server-only` A PROPÓSITO, igual que `src/lib/delivery.ts`: el
 * formulario de `/admin/pagos` valida en vivo mientras el dueño tipea (browser)
 * y `bankAccountInputSchema` valida en el servidor — tiene que ser la MISMA
 * función en los dos lados, no dos implementaciones que puedan divergir.
 *
 * Fuente y verificación completas en
 * `docs/pipelines/2026-08-30-transferencia-bancaria/00-architecture.md` §3.1.
 * Resumen: BCRA/CIMPRA, Boletín 016 "Estándares recomendados para el
 * intercambio de información entre empresas y entidades financieras", cap. 4
 * (https://www.bcra.gob.ar/archivos/Pdfs/Medios_pago/SNP3016.pdf), y el texto
 * ordenado "SNP – Servicios de Pago" (https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-snp-spd.pdf)
 * para el formato de alias y el código de PSP de un CVU.
 *
 * Lo que ESTO valida: que el CBU/CVU está bien tipeado (el dígito verificador
 * cierra). Lo que NO valida, y nunca puede validar sin un proveedor externo:
 * que la cuenta exista, esté activa, o sea de quien el dueño dice. El propio
 * boletín del BCRA lo dice: el objetivo es "mejorar la calidad de captura de
 * los datos", no verificar identidad.
 */

/** Un CBU y un CVU tienen la misma longitud: el mismo campo cubre los dos. */
export const CBU_LENGTH = 22

/**
 * Reglas oficiales exactas del alias (texto ordenado §3.7.2.1.i, Com. "A" 8114,
 * vigencia 09/10/2024): 6 a 20 caracteres, solo `0-9 A-Z a-z . -`, sin
 * distinguir mayúsculas de minúsculas. (La cifra de 14 caracteres que aparece
 * en documentación vieja es de la Com. "A" 6044 de 2016, ampliada después.)
 */
export const ALIAS_PATTERN = /^[A-Za-z0-9.-]{6,20}$/

const CBU_SHAPE = /^\d{22}$/

// El ponderador del BCRA se define de derecha a izquierda (unidad ×3, decena
// ×1, centena ×7, unidad de mil ×9, y ciclo). Estos dos arrays ya están en el
// orden en que se recorren los dígitos de IZQUIERDA A DERECHA, que es como
// llega el string.
const BLOCK1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3]
const BLOCK2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]

/**
 * Dígito verificador de un bloque.
 *
 * El `% 10` EXTERIOR es obligatorio y no es cosmético. El texto del BCRA dice
 * "el resto se deducirá de 10", lo que daría literalmente 10 cuando el resto
 * de la suma es 0 — un dígito verificador de dos cifras es imposible. El
 * comportamiento real es DV = 0, verificado empíricamente con el prefijo de
 * CVU de Prex (`00000130`: el bloque base `0000013` suma 10, resto 0, DV real
 * 0). Un implementador que omita este `% 10` exterior rechaza CBU/CVU
 * perfectamente válidos, y el bug solo se manifiesta contra un puñado de
 * entidades — exactamente el tipo de error que no aparece probando con
 * cualquier CBU al azar.
 */
function checkDigit(digits: string, weights: number[]): number {
  const sum = digits
    .split('')
    .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0)
  return (10 - (sum % 10)) % 10
}

/**
 * ¿El CBU/CVU está bien tipeado? Valida longitud y los DOS dígitos
 * verificadores (posición 8 para el bloque 1, posición 22 para el bloque 2).
 *
 * Estructura (posiciones 1-indexadas):
 *   1-3   entidad (o `000` si es un CVU)
 *   4-7   sucursal (o código de PSP, si es CVU)
 *   8     DV del bloque 1
 *   9-21  tipo y número de cuenta
 *   22    DV del bloque 2
 */
export function isValidCbu(value: string): boolean {
  if (!CBU_SHAPE.test(value)) return false

  const block1 = value.slice(0, 7)
  const dv1 = Number(value[7])
  const block2 = value.slice(8, 21)
  const dv2 = Number(value[21])

  return checkDigit(block1, BLOCK1_WEIGHTS) === dv1 && checkDigit(block2, BLOCK2_WEIGHTS) === dv2
}

/**
 * Un CVU se distingue de un CBU por los tres primeros dígitos (`000`): son
 * los mismos 22 dígitos y el mismo algoritmo, la diferencia es de qué tipo de
 * entidad es el código en las posiciones 4-7 (banco vs. PSP).
 *
 * NO valida el checksum: es una pregunta de FORMA ("¿es un CVU?"), no de
 * validez. Un string de 22 dígitos que empieza con `000` pero tiene un DV
 * mal es un CVU inválido, no "no es un CVU".
 */
export function isCvu(value: string): boolean {
  return CBU_SHAPE.test(value) && value.slice(0, 3) === '000'
}

/** Las posiciones 1-3, tal cual, sin interpretar si es entidad o PSP. `null` si la forma no es la de un CBU/CVU. */
export function cbuEntityCode(value: string): string | null {
  return CBU_SHAPE.test(value) ? value.slice(0, 3) : null
}

/**
 * Tabla de entidades, embebida y versionada en el repo — NO una llamada de
 * red: una consulta más en el checkout/panel para mostrar el nombre de un
 * banco es una dependencia que no se justifica (00-architecture.md §3.1).
 *
 * Semilla: `GET https://api.bcra.gob.ar/cheques/v1.0/entidades` (gratis, sin
 * auth, `Access-Control-Allow-Origin: *`), consultado el 2026-08-31 — 59
 * resultados, verificados contra la respuesta real del endpoint.
 *
 * Esta tabla trae SOLO las entidades adheridas al sistema de cheques: faltan
 * bancos reales (el propio BCRA no publica una tabla más completa de forma
 * gratuita). `bankNameForCbu` devuelve `null` para cualquier código que no
 * esté acá, y la UI tiene que aguantar ese `null` sin drama — no es un banco
 * inexistente, es un banco que esta tabla no cubre todavía.
 */
const ENTITY_NAMES: Record<string, string> = {
  '005': 'The Royal Bank of Scotland N.V.',
  '007': 'Banco de Galicia y Buenos Aires S.A.',
  '011': 'Banco de la Nación Argentina',
  '014': 'Banco de la Provincia de Buenos Aires',
  '015': 'ICBC (Industrial and Commercial Bank of China)',
  '016': 'Citibank N.A.',
  '017': 'Banco BBVA Argentina S.A.',
  '018': 'MUFG Bank, Ltd.',
  '020': 'Banco de la Provincia de Córdoba S.A.',
  '027': 'Banco Supervielle S.A.',
  '029': 'Banco de la Ciudad de Buenos Aires',
  '034': 'Banco Patagonia S.A.',
  '044': 'Banco Hipotecario S.A.',
  '045': 'Banco de San Juan S.A.',
  '060': 'Banco del Tucumán S.A.',
  '065': 'Banco Municipal de Rosario',
  '072': 'Banco Santander Argentina S.A.',
  '079': 'Banco Regional de Cuyo S.A.',
  '083': 'Banco del Chubut S.A.',
  '086': 'Banco de Santa Cruz S.A.',
  '093': 'Banco de La Pampa S.A.',
  '094': 'Banco de Corrientes S.A.',
  '097': 'Banco Provincia del Neuquén S.A.',
  '147': 'Bibank S.A.',
  '150': 'Banco GGAL S.A.',
  '191': 'Banco Credicoop Cooperativo Limitado',
  '198': 'Banco de Valores S.A.',
  '247': 'Banco Roela S.A.',
  '254': 'Banco Mariva S.A.',
  '259': 'Banco BMA S.A.U.',
  '266': 'BNP Paribas',
  '268': 'Banco Provincia de Tierra del Fuego',
  '277': 'Banco Saenz S.A.',
  '281': 'Banco Meridian S.A.',
  '285': 'Banco Macro S.A.',
  '297': 'Banco Banex S.A.',
  '299': 'Banco Comafi S.A.',
  '301': 'Banco Piano S.A.',
  '303': 'Banco Finansur S.A.',
  '305': 'Banco Julio S.A.',
  '306': 'Banco Privado de Inversiones S.A.',
  '309': 'Banco Rioja S.A.U.',
  '310': 'Banco del Sol S.A.',
  '311': 'Nuevo Banco del Chaco S.A.',
  '315': 'Banco de Formosa S.A.',
  '319': 'Banco CMF S.A.',
  '321': 'Banco de Santiago del Estero S.A.',
  '322': 'Banco Industrial',
  '330': 'Nuevo Banco de Santa Fe S.A.',
  '336': 'Banco Bradesco Argentina S.A.U.',
  '338': 'Banco de Servicios y Transacciones S.A.U.',
  '341': 'Banco Masventas S.A.',
  '386': 'Nuevo Banco de Entre Ríos S.A.',
  '389': 'Banco Columbia S.A.',
  '426': 'Banco Bica S.A.',
  '431': 'Banco Coinag S.A.',
  '432': 'Banco de Comercio S.A.',
  '435': 'Banco Sucredito Regional S.A.U.',
  '448': 'Banco Dino S.A.',
}

/**
 * Códigos de PSP para CVU (posiciones 4-7), que el BCRA NO publica en ninguna
 * API gratuita. Se deja SOLO el que está verificado dos veces en
 * `00-architecture.md` §3.1: contra el texto ordenado del BCRA y contra el
 * checksum real de un CVU de Mercado Pago (`0000003100023596996524`, cuyas
 * posiciones 4-7 son literalmente `0003`).
 *
 * A propósito NO se agregan más: la creencia de que "`0031` es Mercado Pago"
 * está ampliamente replicada en la web (se confirmó buscando durante esta
 * implementación) y es la cadena INCLUYENDO el dígito verificador de la
 * posición 8, no el código de PSP real. Publicar un código de PSP mal
 * verificado sería mostrarle al dueño el nombre de un banco equivocado al
 * lado de su propio CBU — peor que no mostrar nada.
 */
const PSP_NAMES: Record<string, string> = {
  '0003': 'Mercado Pago',
}

/**
 * Nombre del banco (CBU) o del PSP (CVU) derivado del código de entidad.
 * `null` si el CBU/CVU no tiene forma válida o si el código no está en la
 * tabla — en los dos casos la UI simplemente no muestra el banco, sin hueco
 * ni error (00-architecture.md, T1.1).
 */
export function bankNameForCbu(value: string): string | null {
  if (!CBU_SHAPE.test(value)) return null
  if (isCvu(value)) return PSP_NAMES[value.slice(3, 7)] ?? null
  return ENTITY_NAMES[value.slice(0, 3)] ?? null
}

/** Saca todo lo que no sea dígito: pegar un CBU copiado con espacios o guiones no tiene que romper la validación. */
export function normalizeCbu(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** `trim()` + minúsculas: el alias no distingue mayúsculas de minúsculas (texto ordenado §3.7.2.1.i). */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidAlias(value: string): boolean {
  return ALIAS_PATTERN.test(value)
}
