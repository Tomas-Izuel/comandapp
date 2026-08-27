/**
 * Prende Resend, verificando ANTES de romper nada.
 *
 * El orden importa. `[auth.email.smtp]` de `supabase/config.toml` viene
 * comentado a propósito: con el bloque activo y sin `RESEND_API_KEY` válida,
 * Supabase Auth devuelve **HTTP 500** y el magic link no sale ni por Resend ni
 * por Mailpit. O sea que el intento de mejorar la entrega termina apagando la
 * única puerta a `/admin`, y el síntoma (500 al pedir el link) no dice en
 * ningún lado que el problema es el SMTP.
 *
 * Por eso este script valida la key contra la API de Resend, avisa si el
 * dominio del remitente no está verificado, manda un mail de prueba real, y
 * solo entonces ofrece descomentar el bloque.
 *
 * Uso:
 *   node --env-file=.env.local scripts/resend-setup.mjs            # solo verifica
 *   node --env-file=.env.local scripts/resend-setup.mjs --enable   # verifica y prende el SMTP
 *
 * Después de --enable hay que reiniciar el stack: `npm run db:stop && npm run db:start`.
 * Un `db reset` NO relee config.toml.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG_PATH = 'supabase/config.toml'
const ENABLE = process.argv.includes('--enable')

const API_KEY = process.env.RESEND_API_KEY?.trim()
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim()
const FROM_NAME = process.env.RESEND_FROM_NAME?.trim()
const DEV_EMAIL = process.env.DEV_EMAIL?.trim()

const ok = (m) => console.log(`✓ ${m}`)
const warn = (m) => console.log(`!  ${m}`)
const info = (m) => console.log(`   ${m}`)
function fail(m, hint) {
  console.error(`\n✗ ${m}`)
  if (hint) console.error(`  ${hint}`)
  console.error('')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Lo que tiene que estar en .env.local
// ---------------------------------------------------------------------------

if (!API_KEY) {
  fail(
    'Falta RESEND_API_KEY.',
    'Sacala de https://resend.com/api-keys y ponela en .env.local (está en .gitignore).',
  )
}
if (!API_KEY.startsWith('re_')) {
  warn('La API key no empieza con "re_": revisá que no hayas pegado otra cosa.')
}
if (!FROM_EMAIL) {
  fail(
    'Falta RESEND_FROM_EMAIL.',
    'Es la dirección desde la que sale el mail, y su dominio tiene que estar verificado en Resend.',
  )
}

const fromDomain = FROM_EMAIL.split('@')[1]
if (!fromDomain) fail(`RESEND_FROM_EMAIL no parece un email: ${FROM_EMAIL}`)

// ---------------------------------------------------------------------------
// 2. ¿La key sirve, y el dominio está verificado?
//
// Esto es lo que separa "configurado" de "funcionando": con el dominio sin
// verificar, Resend acepta el request y descarta el mail en silencio salvo que
// vaya a la dirección de tu propia cuenta. Nadie se enteraría.
// ---------------------------------------------------------------------------

async function resend(path, init = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* Resend puede devolver texto plano en un 5xx */
  }
  return { status: res.status, ok: res.ok, json, text }
}

console.log('\nVerificando Resend…\n')

const domains = await resend('/domains')

if (domains.status === 401 || domains.status === 403) {
  fail('Resend rechazó la API key (401/403).', 'Generá una nueva en https://resend.com/api-keys.')
}
if (!domains.ok) {
  fail(`La API de Resend respondió ${domains.status}.`, domains.text?.slice(0, 200))
}

ok('La API key es válida.')

const list = domains.json?.data ?? []
const match = list.find((d) => d.name === fromDomain)

if (!match) {
  warn(`El dominio "${fromDomain}" no está dado de alta en esta cuenta de Resend.`)
  info('Resend va a entregar SOLO a la dirección de tu propia cuenta y a descartar el resto EN SILENCIO.')
  info(`Dominios dados de alta: ${list.length ? list.map((d) => `${d.name} (${d.status})`).join(', ') : 'ninguno'}`)
} else if (match.status !== 'verified') {
  warn(`El dominio "${fromDomain}" está dado de alta pero su estado es "${match.status}", no "verified".`)
  info('Hasta que verifique, la entrega a direcciones que no sean la de tu cuenta se descarta en silencio.')
} else {
  ok(`El dominio "${fromDomain}" está verificado.`)
}

// ---------------------------------------------------------------------------
// 3. Mail de prueba: la única forma de saber que entrega de verdad
// ---------------------------------------------------------------------------

const testTo = DEV_EMAIL || FROM_EMAIL
if (!DEV_EMAIL) {
  warn('DEV_EMAIL está vacío: el mail de prueba va al remitente.')
  info('Con DEV_EMAIL seteado, `npm run db:bootstrap` crea los usuarios en TU casilla con plus-addressing.')
}

const sent = await resend('/emails', {
  method: 'POST',
  body: JSON.stringify({
    from: FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL,
    to: [testTo],
    subject: 'Burger Shop — prueba de configuración de Resend',
    text:
      'Si estás leyendo esto, Resend entrega de verdad a esta dirección.\n\n' +
      'Lo manda scripts/resend-setup.mjs por la API. El magic link del panel sale por SMTP, ' +
      'que es un mecanismo distinto: se prende con --enable y reiniciando el stack.',
  }),
})

if (!sent.ok) {
  fail(`Resend rechazó el mail de prueba (${sent.status}).`, sent.json?.message ?? sent.text?.slice(0, 200))
}
ok(`Mail de prueba aceptado para ${testTo} (id ${sent.json?.id ?? '?'}). Revisá la casilla.`)

// ---------------------------------------------------------------------------
// 4. Prender el SMTP de Auth (opcional)
//
// Dos mecanismos distintos, y conviene tenerlo claro: el comprobante y el
// "pedido listo" los manda LA APP por la API de Resend (con la key ya alcanza).
// El magic link lo manda SUPABASE AUTH por SMTP, y para eso hace falta este
// bloque.
// ---------------------------------------------------------------------------

if (!ENABLE) {
  console.log('\nTodo verificado. Falta prender el SMTP de Auth para el magic link:')
  info('node --env-file=.env.local scripts/resend-setup.mjs --enable');
  console.log('')
  process.exit(0)
}

const config = readFileSync(CONFIG_PATH, 'utf8')

if (/^\[auth\.email\.smtp\]/m.test(config)) {
  ok('El bloque [auth.email.smtp] ya estaba activo.')
} else {
  const commented = `# [auth.email.smtp]
# enabled = true
# host = "smtp.resend.com"
# port = 465
# user = "resend"
# pass = "env(RESEND_API_KEY)"
# admin_email = "env(RESEND_FROM_EMAIL)"
# sender_name = "env(RESEND_FROM_NAME)"`

  if (!config.includes(commented)) {
    fail(
      'No encontré el bloque [auth.email.smtp] comentado en supabase/config.toml.',
      'Puede que ya lo hayas editado a mano: revisalo y descomentalo vos.',
    )
  }

  const active = commented
    .split('\n')
    .map((line) => line.replace(/^# ?/, ''))
    .join('\n')

  writeFileSync(CONFIG_PATH, config.replace(commented, active))
  ok('Descomenté [auth.email.smtp] en supabase/config.toml.')
}

console.log('')
warn('Falta reiniciar el stack: config.toml NO se relee con `db reset`.')
info('npm run db:stop && npm run db:start')
info('Después: pedí un magic link en /admin/acceso y verificá que llegue a tu casilla, no a Mailpit.')
console.log('')
warn('En el proyecto HOSTED esto no aplica: el SMTP se configura en el dashboard')
info('(Authentication → Emails), y ahí Supabase impone 30 mails/hora por defecto al')
info('conectar SMTP propio. Se sube en Rate Limits. Este archivo solo toca el stack local.')
console.log('')
