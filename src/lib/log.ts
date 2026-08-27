import 'server-only'

/**
 * Log estructurado del servidor.
 *
 * Antes había diez `console.error` sueltos con formatos distintos y nada más:
 * los fallos de Mercado Pago, Resend y el POS del local terminaban en filas de
 * tablas que ninguna pantalla mostraba. Con plata en juego, "se loguea" tiene
 * que significar "se puede buscar".
 *
 * En producción sale una línea de JSON por evento, que es lo que los drains de
 * Vercel y cualquier agregador saben parsear. En desarrollo sale legible.
 *
 * Nunca meter acá el access token de Mercado Pago, el `public_token` de un
 * pedido ni el secreto de un POS: un log es un lugar donde los secretos viven
 * para siempre y con más lectores de los que uno cree.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = {
  storeId?: number | null
  orderId?: number | null
  /** Para correlacionar todo lo que pasó en un mismo request. */
  requestId?: string | null
  [key: string]: unknown
}

const isProduction = process.env.NODE_ENV === 'production'

function emit(level: Level, context: string, message: string, fields?: LogFields, error?: unknown) {
  // Los extras se arman aparte de `level`/`context`/`message` justamente para
  // que el camino de desarrollo no tenga que volver a sacarlos: esos tres ya van
  // en el prefijo de la línea y repetirlos en el objeto solo ensucia la consola.
  const extras: Record<string, unknown> = { ...(fields ?? {}) }

  if (error !== undefined) {
    extras.error =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) }
  }

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log

  if (isProduction) {
    // `timestamp` lo agrega la plataforma; duplicarlo solo gasta bytes.
    sink(JSON.stringify({ level, context, message, ...extras }))
    return
  }

  const hasExtras = Object.keys(extras).length > 0
  sink(`[${context}] ${message}`, ...(hasExtras ? [extras] : []))
}

export const log = {
  debug: (context: string, message: string, fields?: LogFields) => emit('debug', context, message, fields),
  info: (context: string, message: string, fields?: LogFields) => emit('info', context, message, fields),
  warn: (context: string, message: string, fields?: LogFields) => emit('warn', context, message, fields),
  /**
   * El error va aparte del resto de los campos para que siempre salga con su
   * stack, incluso cuando quien loguea se olvida de incluirlo.
   */
  error: (context: string, message: string, error?: unknown, fields?: LogFields) =>
    emit('error', context, message, fields, error),
}
