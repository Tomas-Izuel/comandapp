/**
 * Bootstrap de desarrollo.
 *
 * `supabase db reset` recrea la base entera, incluido el schema `auth`. O sea:
 * borra todos los usuarios. Este script vuelve a dejar el entorno usable en un
 * solo paso, y es idempotente: correrlo dos veces no rompe nada.
 *
 * Lo que hace:
 *   1. Crea el usuario del platform admin y su fila en `platform_admins`.
 *      (Esa fila se puebla solo por SQL/script a propósito: no hay UI de alta.)
 *   2. Crea el dueño de cada tienda del seed y lo mete en `store_members`.
 *   3. Con --orders, carga pedidos de prueba en varios estados para que el
 *      panel de cocina no arranque vacío durante el QC.
 *
 * Uso:  node --env-file=.env.local scripts/bootstrap-dev.mjs [--orders]
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SECRET) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. ¿Corriste con --env-file=.env.local?')
  process.exit(1)
}

/**
 * Guard de host: este script NO puede correr contra producción por accidente.
 *
 * Lee la URL y la secret key de `.env.local`, y crea un platform admin con una
 * contraseña que está escrita en el repo. El patrón `vercel env pull .env.local`
 * es habitual, así que un `npm run db:bootstrap` después de eso creaba un admin
 * de plataforma con contraseña pública en producción — y sin TOTP enrolado, o
 * sea que el segundo factor se lo queda el primero que llegue a /backoffice/mfa.
 *
 * La contraseña por defecto solo se acepta en local. Contra cualquier otro host
 * hay que pasar `ALLOW_REMOTE_BOOTSTRAP=1` Y una contraseña explícita: dos
 * gestos deliberados, no uno.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])
const targetHost = (() => {
  try {
    return new URL(SUPABASE_URL).hostname
  } catch {
    console.error(`NEXT_PUBLIC_SUPABASE_URL no es una URL válida: ${SUPABASE_URL}`)
    process.exit(1)
  }
})()
const isLocalTarget = LOCAL_HOSTS.has(targetHost)

if (!isLocalTarget && process.env.ALLOW_REMOTE_BOOTSTRAP !== '1') {
  console.error(`\n✗ Este script apunta a un host remoto (${targetHost}) y está pensado para desarrollo local.`)
  console.error('  Si de verdad querés correrlo ahí, seteá ALLOW_REMOTE_BOOTSTRAP=1 y PLATFORM_ADMIN_PASSWORD.')
  console.error('  Para dar de alta un admin en producción, hacelo por SQL y enrolá el TOTP en el momento.\n')
  process.exit(1)
}

if (!isLocalTarget && !process.env.PLATFORM_ADMIN_PASSWORD) {
  console.error(`\n✗ Contra un host remoto (${targetHost}) hay que pasar PLATFORM_ADMIN_PASSWORD.`)
  console.error('  La contraseña por defecto de este script está en el repo: no sirve fuera de tu máquina.\n')
  process.exit(1)
}

/**
 * Direcciones de desarrollo.
 *
 * Con Resend conectado, los mails salen a internet de verdad — y hasta que el
 * dominio esté verificado, Resend solo entrega a la dirección de tu cuenta. Los
 * `@burgershop.test` de antes se descartan silenciosamente.
 *
 * Por eso: si `DEV_EMAIL` está seteado, se derivan las direcciones con
 * plus-addressing sobre TU casilla real (`vos+admin@...`), que llegan a un
 * inbox que podés abrir. Sin `DEV_EMAIL` se usan los `.test`, que solo sirven
 * con Mailpit.
 */
const DEV_EMAIL = process.env.DEV_EMAIL?.trim()

function devAddress(tag) {
  if (!DEV_EMAIL) return `${tag}@burgershop.test`
  const [local, domain] = DEV_EMAIL.split('@')
  if (!domain) {
    fail(`DEV_EMAIL no parece un email: ${DEV_EMAIL}`)
  }
  return `${local}+${tag}@${domain}`
}

const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? devAddress('admin')
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? 'burger-dev-1234'

/**
 * Dirección con la que se entra al backoffice POR GOOGLE, que casi nunca es la
 * misma que `ADMIN_EMAIL`.
 *
 * `devAddress('admin')` usa plus-addressing (`vos+admin@…`) para que el mail
 * llegue a una casilla que podés abrir. Pero Google devuelve siempre la
 * dirección canónica —sin el `+admin`—, así que una allowlist sembrada con la
 * versión plus-addressed nunca matchea el login real y el registro rebota con
 * 403 sin explicar por qué.
 */
const GOOGLE_ADMIN_EMAIL = (process.env.PLATFORM_ADMIN_GOOGLE_EMAIL ?? DEV_EMAIL ?? '').trim().toLowerCase()

const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } })

const log = (...a) => console.log(...a)
const fail = (msg, error) => {
  console.error(`\n✗ ${msg}`)
  if (error) console.error(`  ${error.message ?? error}`)
  process.exit(1)
}

/** Crea el usuario si no existe; si ya está, devuelve el que hay. */
async function ensureUser(email, { password } = {}) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (!error) return data.user

  // El código de "ya existe" cambió entre versiones, así que se detecta por
  // mensaje además de por código: si no, un segundo run explota.
  const exists =
    error.code === 'email_exists' ||
    /already been registered|already exists/i.test(error.message ?? '')
  if (!exists) fail(`No se pudo crear el usuario ${email}`, error)

  // listUsers pagina y no hay "buscar por email", así que se recorre.
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (listError) fail('No se pudo listar usuarios', listError)
    const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (list.users.length < 200) break
  }
  fail(`El usuario ${email} existe pero no se pudo encontrar`)
}

async function main() {
  const withOrders = process.argv.includes('--orders')

  // ---- 1. platform admin ---------------------------------------------------
  const admin = await ensureUser(ADMIN_EMAIL, { password: ADMIN_PASSWORD })
  const { error: paError } = await db
    .from('platform_admins')
    .upsert({ user_id: admin.id, email: ADMIN_EMAIL }, { onConflict: 'user_id' })
  if (paError) fail('No se pudo insertar en platform_admins', paError)
  log(`✓ platform admin: ${ADMIN_EMAIL}`)

  // ---- 1b. allowlist de registro ------------------------------------------
  //
  // `db reset` también se lleva puesta esta tabla, y sin la fila el primer
  // ingreso con Google rebota con 403 (`before_user_created` rechaza todo lo
  // que no esté acá). El usuario de arriba lo crea la Admin API, que se saltea
  // el hook — por eso el panel con contraseña sigue andando aunque falte esto,
  // y por eso el síntoma aparece recién cuando probás Google.
  if (GOOGLE_ADMIN_EMAIL) {
    const { error: alError } = await db
      .from('signup_allowlist')
      .upsert(
        { email: GOOGLE_ADMIN_EMAIL, provider: 'google', role: 'platform_admin', note: 'bootstrap de desarrollo' },
        { onConflict: 'email' },
      )
    if (alError) fail('No se pudo sembrar signup_allowlist', alError)
    log(`✓ allowlist de registro: ${GOOGLE_ADMIN_EMAIL} (google)`)
  } else {
    log('· allowlist de registro: sin sembrar (falta DEV_EMAIL o PLATFORM_ADMIN_GOOGLE_EMAIL).')
    log('  El ingreso con Google va a devolver 403 hasta que agregues tu dirección.')
  }

  // ---- 2. dueños de las tiendas del seed ----------------------------------
  const { data: stores, error: storesError } = await db.from('stores').select('id, slug, name')
  if (storesError) fail('No se pudieron leer las tiendas', storesError)
  if (!stores?.length) fail('No hay tiendas. ¿Corriste `npx supabase db reset` con el seed?')

  const owners = []
  for (const store of stores) {
    const email = devAddress(`dueno-${store.slug}`)
    const owner = await ensureUser(email)
    const { error: memberError } = await db
      .from('store_members')
      .upsert({ store_id: store.id, user_id: owner.id, role: 'owner' }, { onConflict: 'store_id,user_id' })
    if (memberError) fail(`No se pudo vincular el dueño de ${store.slug}`, memberError)
    owners.push({ email, store })
    log(`✓ dueño de "${store.name}" (/${store.slug}): ${email}`)
  }

  // ---- 3. pedidos de prueba ------------------------------------------------
  if (withOrders) {
    const store = stores[0]
    const { data: products } = await db
      .from('products')
      .select('id, name, price_cents, prep_minutes')
      .eq('store_id', store.id)
      .order('position')
      .limit(4)

    if (!products?.length) fail('No hay productos para armar pedidos de prueba')

    // Cubre los casos que importan en QC, incluido el que sólo existe por el
    // pago en el local: un pedido LISTO y todavía IMPAGO.
    const scenarios = [
      { status: 'pending',   payment_method: 'online',   payment_status: 'pending',  nombre: 'Ana (sin pagar)' },
      { status: 'confirmed', payment_method: 'online',   payment_status: 'approved', nombre: 'Bruno (pago)' },
      { status: 'preparing', payment_method: 'online',   payment_status: 'approved', nombre: 'Carla (en plancha)' },
      { status: 'ready',     payment_method: 'online',   payment_status: 'approved', nombre: 'Diego (listo)' },
      { status: 'ready',     payment_method: 'in_store', payment_status: 'pending',  nombre: 'Elena (listo, IMPAGO)' },
    ]

    let created = 0
    for (const [i, s] of scenarios.entries()) {
      const product = products[i % products.length]
      const quantity = 1 + (i % 2)
      const subtotal = product.price_cents * quantity

      // `idempotency_key` es NOT NULL y tiene indice unico por tienda. Se deriva
      // del escenario en vez de sortearse, asi que correr el bootstrap dos veces
      // no duplica los pedidos de QC: el segundo insert rebota con 23505 y se
      // saltea. Sin esto el flag --orders fallaba en el primer pedido.
      const idempotencyKey = `qc-seed-${store.id}-${i}`

      const { data: order, error: orderError } = await db
        .from('orders')
        .insert({
          store_id: store.id,
          status: s.status,
          payment_method: s.payment_method,
          payment_status: s.payment_status,
          customer_name: s.nombre,
          customer_phone_e164: `+54911555540${10 + i}`,
          idempotency_key: idempotencyKey,
          subtotal_cents: subtotal,
          total_cents: subtotal,
          base_prep_minutes: product.prep_minutes,
          demand_multiplier: 1,
          eta_minutes: product.prep_minutes,
          eta_at: new Date(Date.now() + product.prep_minutes * 60_000).toISOString(),
        })
        .select('id, short_code, public_token')
        .single()

      if (orderError?.code === '23505') {
        log(`· pedido de QC "${s.nombre}" ya existe, se saltea`)
        continue
      }
      if (orderError) fail(`No se pudo crear el pedido de prueba "${s.nombre}"`, orderError)

      const { error: itemError } = await db.from('order_items').insert({
        order_id: order.id,
        product_id: product.id,
        name_snapshot: product.name,
        unit_price_cents: product.price_cents,
        quantity,
        total_cents: subtotal,
        prep_minutes: product.prep_minutes,
      })
      if (itemError) fail('No se pudo crear el ítem del pedido de prueba', itemError)

      created++
      log(`✓ pedido ${order.short_code} — ${s.nombre}  /pedido/${order.public_token}`)
    }
    log(`✓ ${created} pedidos de prueba`)
  }

  // ---- resumen -------------------------------------------------------------
  if (!DEV_EMAIL) {
    log(`
⚠  DEV_EMAIL no está seteado.
   Con Resend conectado, las direcciones @burgershop.test no se entregan.
   Poné en .env.local:   DEV_EMAIL=vos@tudominio.com
   y volvé a correr:     npm run db:bootstrap`)
  }

  log(`
──────────────────────────────────────────────────────────────
 Entorno listo. Arrancá con:  npm run dev
──────────────────────────────────────────────────────────────

 CLIENTE (sin login)
   http://localhost:3000/${stores[0].slug}

 PANEL DEL LOCAL — entra por magic link, no por contraseña
   Este script no manda invitación (eso lo hace el alta desde el backoffice):
   pedí un link en  http://localhost:3000/admin/acceso
   Email:  ${owners[0].email}
   ${DEV_EMAIL
     ? 'El magic link sale por Resend a tu casilla real. Revisá tu inbox\n   (y el spam la primera vez, hasta que el dominio caliente).'
     : 'Sin DEV_EMAIL seteado: los mails van a Mailpit, no a internet.\n   Abrilo en  http://127.0.0.1:54324'}

 BACKOFFICE DE PLATAFORMA — contraseña + TOTP obligatorio
   http://localhost:3000/backoffice/login
   Email:       ${ADMIN_EMAIL}
   Contraseña:  ${ADMIN_PASSWORD}

   La primera vez te va a mandar a /backoffice/mfa a enrolar el
   authenticator. Eso NO es un paso opcional que puedas saltear:
   las RLS exigen aal2, así que sin TOTP verificado la base
   devuelve cero filas y el backoffice se ve vacío.
   Escaneá el QR con Google Authenticator / 1Password / Authy.
──────────────────────────────────────────────────────────────
`)
}

main()
