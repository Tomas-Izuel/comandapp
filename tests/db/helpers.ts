import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'

/**
 * Estos tests hablan directo con el Postgres del stack local, sin cliente
 * `pg` (no se puede instalar nada). `docker exec -i ... psql` es como se
 * verificó todo esto a mano durante la auditoría, así que es el mismo camino.
 *
 * El script se manda por STDIN (no con `-c`) porque `-c` no soporta
 * metacomandos de psql como `\gset`, que es lo que permite encadenar
 * `insert ... returning id \gset foo_` y reusar `:foo_id` en las sentencias
 * siguientes DENTRO de la misma transacción/conexión. Sin `\gset` no hay forma
 * de armar una fixture (tienda, pedido) y después referenciar su id sin una
 * segunda conexión — y una segunda conexión no ve las filas de una
 * transacción que todavía no hizo commit.
 */
const CONTAINER = 'supabase_db_burger-shop'

function runPsql(script: string): string {
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        // Sin esto un error a mitad de script no corta la ejecución: seguiría
        // mandando sentencias después de un permission denied como si nada.
        '-v',
        'ON_ERROR_STOP=1',
        // -t -A: solo los valores, sin encabezados ni alineación — lo que
        // sale es lo que parsea el test, no una tabla para leer a ojo.
        '-t',
        '-A',
        // -q apaga los avisos de comando ("BEGIN", "INSERT 0 1", "ROLLBACK"):
        // sin esto se mezclan con el resultado real de los SELECT y arruinan
        // el parseo en JS.
        '-q',
      ],
      { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string }
    // El mensaje de Postgres ES la aserción en la mitad de estos tests (por
    // ejemplo "permission denied for table orders"), así que se propaga tal
    // cual llega por stderr, sin envolver ni resumir.
    const detail = (e.stderr ?? '').trim() || (e.stdout ?? '').trim() || e.message
    throw new Error(detail)
  }
}

/** Ejecuta un script (una o varias sentencias separadas por `;`) y devuelve
 * stdout recortado. Tira con el error de Postgres si algo falla. */
export function sql(query: string): string {
  return runPsql(query).trim()
}

function detectDatabase(): boolean {
  try {
    runPsql('select 1;')
    return true
  } catch {
    console.warn(
      `[tests/db] No se pudo conectar a "${CONTAINER}" via docker exec: se saltea toda la suite de Postgres. ` +
        'Corré `npm run db:start` para levantar el stack local.',
    )
    return false
  }
}

/**
 * Se detecta UNA sola vez al cargar el módulo (no en cada test): si Docker no
 * está corriendo, cada archivo de este directorio usa `describe.skipIf` con
 * esto para saltear la suite entera en vez de fallar. `npm test` tiene que
 * poder correr en verde sin Docker.
 */
export const dbAvailable = detectDatabase()

/**
 * Envuelve TODO en `begin; ...; rollback;` y lo ejecuta. Nada de lo que pase
 * acá adentro puede sobrevivir: es la regla más importante de este slice,
 * porque esto corre contra la base de desarrollo del usuario, no contra una
 * de test descartable.
 */
export function inTransaction(...statements: string[]): string {
  return sql(['begin;', ...statements, 'rollback;'].join('\n'))
}

/**
 * Corre `query` (que puede traer su propio setup de fixtures) esperando que
 * falle, y afirma que el mensaje matchea `pattern`.
 *
 * Se envuelve en su PROPIO `begin/rollback`, independiente de que el llamador
 * también use `inTransaction`: si la sentencia que se creía prohibida en
 * realidad tiene éxito —un bug real, no un fallo del test— el rollback la
 * descarta igual. Así este helper nunca puede dejar basura, ni siquiera
 * cuando lo que encuentra es exactamente el tipo de agujero que se está
 * buscando.
 */
export function expectSqlToFail(query: string, pattern: RegExp): void {
  let message: string | null = null
  try {
    sql(['begin;', query, 'rollback;'].join('\n'))
  } catch (err) {
    message = (err as Error).message
  }
  if (message === null) {
    throw new Error(
      `Se esperaba que esta consulta fallara y en cambio tuvo éxito (rollback igual, pero es un bug real):\n${query}`,
    )
  }
  expect(message).toMatch(pattern)
}

type Aal = 'aal1' | 'aal2'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Compone las sentencias para simular una sesión de staff logueado, como hace
 * PostgREST: setea `request.jwt.claims` (lo que leen `auth.uid()`/`auth.jwt()`)
 * y cambia de rol a `authenticated`.
 *
 * Van DENTRO del mismo `begin/rollback` que crea las fixtures — no en una
 * conexión aparte — porque una conexión aparte no vería las filas que la
 * fixture insertó en una transacción todavía no commiteada. `set local role`
 * dura hasta el fin de la transacción; `reset role` lo corta antes por si el
 * script sigue con pasos que necesitan volver a correr como el superusuario.
 */
export function asAuthenticated(userId: string, statements: string[], aal: Aal = 'aal1'): string[] {
  if (!UUID_RE.test(userId)) {
    throw new Error(`asAuthenticated: "${userId}" no es un uuid`)
  }
  return [
    `do $$ begin perform set_config('request.jwt.claims', ` +
      `json_build_object('sub','${userId}','role','authenticated','aal','${aal}')::text, true); end $$;`,
    'set local role authenticated;',
    ...statements,
    'reset role;',
  ]
}

/** Mismo mecanismo que `asAuthenticated`, para el rol `anon` (sin sesión). */
export function asAnon(statements: string[]): string[] {
  return ['set local role anon;', ...statements, 'reset role;']
}

/** UUID nuevo para cada usuario de fixture. */
export function newUserId(): string {
  return randomUUID()
}

/**
 * `auth.users` solo exige `id` (el resto son columnas de Supabase Auth con
 * default o nullable). Es la fila mínima que pide la FK de `store_members` /
 * `platform_admins`.
 */
export function createAuthUserSql(userId: string, email: string): string {
  if (!UUID_RE.test(userId)) {
    throw new Error(`createAuthUserSql: "${userId}" no es un uuid`)
  }
  return `insert into auth.users (id, email) values ('${userId}', '${email.replace(/'/g, "''")}');`
}

/** Slug único por corrida, para no chocar con datos reales de la tienda del
 * usuario ni entre corridas sucesivas del mismo archivo. */
export function uniqueSlug(prefix: string): string {
  return `zz-test-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
