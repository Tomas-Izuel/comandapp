import { describe, expect, it } from 'vitest'
import {
  asAnon,
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  sql,
} from './helpers'

/**
 * `supabase/migrations/20260826120400_signup_allowlist.sql`.
 *
 * Con `enable_signup = true`, `POST /auth/v1/signup` con la publishable key
 * queda abierto a cualquiera; la allowlist (tabla + hook `before_user_created`
 * + trigger de auto-provisión) es lo único que evita que ese endpoint cree
 * usuarios `authenticated` a mano alzada, o peor, se adelante a registrar la
 * dirección del platform admin antes de su primer login con Google.
 *
 * IMPORTANTE (confirmado en la migración, no re-testeado acá): la Admin API
 * (`POST /auth/v1/admin/users` con la secret key) se saltea el hook por
 * completo. Este archivo prueba SQL contra Postgres, no HTTP contra GoTrue,
 * así que ese camino queda fuera de este slice — ver el informe final.
 */

function allowlistInsert(email: string, provider: string, role: string): string {
  return `insert into public.signup_allowlist (email, provider, role) values ('${email}', '${provider}', '${role}');`
}

function hookCall(email: string, provider: string): string {
  return `select private.before_user_created(jsonb_build_object(
    'user', jsonb_build_object(
      'email', '${email}',
      'app_metadata', jsonb_build_object('provider', '${provider}')
    )
  ));`
}

const HOOK_CALL_NO_EMAIL = `select private.before_user_created(jsonb_build_object(
  'user', jsonb_build_object('app_metadata', jsonb_build_object('provider', 'google'))
));`

describe.skipIf(!dbAvailable)('private.before_user_created — hook de Auth', () => {
  // Se llama directo por SQL, como `postgres` (superusuario): eso salta el
  // `revoke ... from anon, authenticated` a propósito, porque acá se está
  // probando la LÓGICA del hook. Que ese revoke efectivamente frene a los
  // roles del browser es otra cosa, y tiene su propio describe más abajo.

  it('email que no está en la allowlist: rechaza', () => {
    const out = inTransaction(hookCall('nadie@example.com', 'google'))
    expect(JSON.parse(out)).toMatchObject({ error: { http_code: 403 } })
  })

  it('email en la allowlist con el provider correcto: deja pasar ({})', () => {
    const email = 'admin-ok@example.com'
    const out = inTransaction(allowlistInsert(email, 'google', 'platform_admin'), hookCall(email, 'google'))
    expect(out).toBe('{}')
  })

  it(
    'email en la allowlist pero con OTRO provider: rechaza — es la defensa contra ' +
      'adelantarse con POST /auth/v1/signup (provider "email") a una dirección anotada como "google" ' +
      'y quedarse con la cuenta del platform admin antes del primer login',
    () => {
      const email = 'admin-otroprovider@example.com'
      // La lista lo espera con 'google'; el signup que se está bloqueando llega con 'email'.
      const out = inTransaction(allowlistInsert(email, 'google', 'platform_admin'), hookCall(email, 'email'))
      expect(JSON.parse(out)).toMatchObject({ error: { http_code: 403 } })
    },
  )

  it('evento sin email: rechaza', () => {
    const out = inTransaction(HOOK_CALL_NO_EMAIL)
    expect(JSON.parse(out)).toMatchObject({ error: { http_code: 403 } })
  })

  it('evento con email vacío: rechaza', () => {
    const out = inTransaction(hookCall('', 'google'))
    expect(JSON.parse(out)).toMatchObject({ error: { http_code: 403 } })
  })

  it(
    'el mensaje de rechazo es EL MISMO en los tres motivos — distinguirlos convertiría el ' +
      'endpoint en un oráculo para averiguar qué dirección administra la plataforma',
    () => {
      const email = 'oraculo@example.com'
      // Comparamos los outputs entre sí, nunca contra un string hardcodeado:
      // así el test sigue siendo válido si algún día se reescribe la copia.
      const out = inTransaction(
        allowlistInsert(email, 'google', 'platform_admin'),
        hookCall('no-existe-oraculo@example.com', 'google'), // motivo 1: no está en la lista
        hookCall(email, 'email'), // motivo 2: está, pero con otro provider
        HOOK_CALL_NO_EMAIL, // motivo 3: sin email
      )
      const [notAllowlisted, wrongProvider, noEmail] = out.split('\n')
      expect(notAllowlisted).toBe(wrongProvider)
      expect(wrongProvider).toBe(noEmail)
    },
  )
})

describe.skipIf(!dbAvailable)('private.provision_platform_admin — trigger sobre auth.users', () => {
  it('email allowlisted con role = platform_admin: aparece en platform_admins', () => {
    const userId = newUserId()
    const email = `admin-${userId}@example.com`
    const out = inTransaction(
      allowlistInsert(email, 'google', 'platform_admin'),
      createAuthUserSql(userId, email),
      `select email from public.platform_admins where user_id = '${userId}';`,
    )
    expect(out).toBe(email)
  })

  it('email allowlisted con role = store_owner: NO aparece — default seguro contra escalar a admin de plataforma', () => {
    const userId = newUserId()
    const email = `owner-${userId}@example.com`
    const out = inTransaction(
      allowlistInsert(email, 'email', 'store_owner'),
      createAuthUserSql(userId, email),
      `select count(*) from public.platform_admins where user_id = '${userId}';`,
    )
    expect(out).toBe('0')
  })

  it('email que no está en la allowlist: no aparece en platform_admins', () => {
    const userId = newUserId()
    const email = `nadie-${userId}@example.com`
    const out = inTransaction(
      createAuthUserSql(userId, email),
      `select count(*) from public.platform_admins where user_id = '${userId}';`,
    )
    expect(out).toBe('0')
  })

  it('es idempotente: "on conflict do nothing" no explota si la fila ya existe', () => {
    const userId = newUserId()
    const email = `admin-idem-${userId}@example.com`
    const out = inTransaction(
      allowlistInsert(email, 'google', 'platform_admin'),
      createAuthUserSql(userId, email), // el trigger crea la fila acá, en el insert de auth.users
      // El trigger solo corre en el insert de auth.users (no hay forma de
      // reinvocarlo desde SQL para simular una segunda ejecución), así que la
      // forma fiel de probar el "on conflict do nothing" es repetir acá el
      // mismo insert que hace su cuerpo, contra un user_id que ya tiene fila:
      // sin esa cláusula, este segundo insert violaría la PK de
      // platform_admins y abortaría la transacción.
      `insert into public.platform_admins (user_id, email) values ('${userId}', '${email}') on conflict do nothing;`,
      `select count(*) from public.platform_admins where user_id = '${userId}';`,
    )
    expect(out).toBe('1')
  })
})

describe.skipIf(!dbAvailable)('signup_allowlist — grants y RLS', () => {
  it('anon no puede leer public.signup_allowlist (sin grant: la tabla no existe para el browser)', () => {
    expectSqlToFail(
      asAnon(['select count(*) from public.signup_allowlist;']).join('\n'),
      /permission denied for table signup_allowlist/,
    )
  })

  it('authenticated no puede leer public.signup_allowlist', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, `${userId}@example.com`),
        ...asAuthenticated(userId, ['select count(*) from public.signup_allowlist;']),
      ].join('\n'),
      /permission denied for table signup_allowlist/,
    )
  })

  it('public.signup_allowlist tiene RLS habilitada', () => {
    const out = sql(`select relrowsecurity from pg_class where oid = 'public.signup_allowlist'::regclass;`)
    expect(out).toBe('t')
  })

  it('anon no puede invocar private.before_user_created (revoke sobre el schema entero)', () => {
    expectSqlToFail(asAnon([`select private.before_user_created('{}'::jsonb);`]).join('\n'), /permission denied for schema private/)
  })

  it('authenticated no puede invocar private.before_user_created', () => {
    const userId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(userId, `${userId}@example.com`),
        ...asAuthenticated(userId, [`select private.before_user_created('{}'::jsonb);`]),
      ].join('\n'),
      /permission denied for schema private/,
    )
  })
})

describe.skipIf(!dbAvailable)('signup_allowlist — constraints de la tabla', () => {
  it('el email tiene que estar en minúscula (CHECK signup_allowlist_email_lowercase_check)', () => {
    expectSqlToFail(
      `insert into public.signup_allowlist (email, provider, role) values ('Admin@Example.com', 'google', 'platform_admin');`,
      /signup_allowlist_email_lowercase_check/,
    )
  })

  it('provider solo acepta "google" o "email"', () => {
    expectSqlToFail(
      `insert into public.signup_allowlist (email, provider, role) values ('x@example.com', 'facebook', 'platform_admin');`,
      /violates check constraint/,
    )
  })

  it('role solo acepta "platform_admin" o "store_owner"', () => {
    expectSqlToFail(
      `insert into public.signup_allowlist (email, provider, role) values ('x@example.com', 'google', 'superadmin');`,
      /violates check constraint/,
    )
  })
})
