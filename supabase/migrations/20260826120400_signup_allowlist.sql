-- Allowlist de registro
--
-- Contexto: hasta esta migracion `[auth].enable_signup` estaba en `false` y esa
-- era toda la defensa contra el registro publico. Funcionaba porque NADIE se
-- registraba solo: al platform admin lo creaba el script de bootstrap y a los
-- duenos de local los crea el backoffice con la Admin API, que ignora ese flag.
--
-- Ahora el platform admin entra al backoffice con Google, y su PRIMER ingreso
-- tiene que crear el usuario: no hay a quien pre-crearlo. Eso obliga a poner
-- `enable_signup = true`, y con eso vuelve a abrirse `POST /auth/v1/signup` con
-- la publishable key — o sea que cualquiera con la key crea un usuario
-- `authenticated`, que es exactamente lo que el flag cerraba.
--
-- La allowlist reemplaza al flag como control de acceso, y es MAS estricta que
-- lo que habia antes: el flag era binario, esto nombra quien puede registrarse
-- y por que proveedor.
--
-- El par (email, provider) es el punto entero. Sin el provider, alguien que
-- conozca la direccion del admin puede adelantarse con
-- `POST /auth/v1/signup {email: <la del admin>, password: <la suya>}` y quedarse
-- con la cuenta ANTES del primer login con Google: el trigger de mas abajo le
-- daria la fila en `platform_admins`, y el segundo factor se lo enrola el
-- primero que llegue. Con el provider fijado en 'google', ese signup llega con
-- `provider = 'email'` y el hook lo rechaza.

create table public.signup_allowlist (
  email      text primary key,
  -- Proveedor EXACTO con el que se permite crear el usuario.
  --   'google' — el platform admin, que se registra solo desde /backoffice/login.
  --   'email'  — los duenos de local, que crea el backoffice con la Admin API.
  provider   text not null check (provider in ('google', 'email')),
  role       text not null check (role in ('platform_admin', 'store_owner')),
  note       text,
  created_at timestamptz not null default now(),
  -- Los emails se comparan en minuscula: Auth no normaliza el case y
  -- 'Tomas@x.com' no puede ser una entrada distinta de 'tomas@x.com'.
  constraint signup_allowlist_email_lowercase_check check (email = lower(email))
);

alter table public.signup_allowlist enable row level security;

-- Sin grants para anon ni authenticated: esta tabla no existe para el browser.
-- (RLS decide que FILAS ves; el grant decide si la TABLA existe.) La escribe
-- solo el servidor, y `supabase_auth_admin` tampoco la lee directo — llega a
-- ella a traves del hook, que es `security definer`.
revoke all on public.signup_allowlist from anon, authenticated;
grant select, insert, update, delete on public.signup_allowlist to service_role;

-- ---------------------------------------------------------------------------
-- Hook `before_user_created`
--
-- Corre DENTRO de Auth, antes de escribir la fila en `auth.users`. Ese es el
-- motivo de ponerlo aca y no en TypeScript: los dos caminos que hay que cerrar
-- —`POST /auth/v1/signup` y `POST /auth/v1/otp` con `create_user: true`, ambos
-- invocables desde cualquier browser con la publishable key— no pasan por
-- nuestro codigo.
--
-- VERIFICADO contra el stack local, no deducido de la doc:
--   POST /auth/v1/signup  email fuera de la lista        -> 403, sin usuario
--   POST /auth/v1/otp     create_user:true, fuera        -> 403, sin usuario
--   POST /auth/v1/signup  email de la lista, provider ok -> 403 igual, porque
--                         la lista lo espera con 'google' y llego 'email'
--   POST /auth/v1/admin/users (secret key)               -> 200: NO PASA POR EL HOOK
--
-- Ese ultimo caso es la parte que importa entender: **la Admin API se saltea el
-- hook**. Por eso `createStoreWithOwner` sigue creando duenos de local sin
-- necesidad de anotarlos aca, y por eso una fila con `role = 'store_owner'` hoy
-- no cambia nada. La columna existe igual para que el trigger de mas abajo diga
-- explicitamente a quien provisiona: si manana un dueno pudiera registrarse
-- solo, el default seguro es que NO sea platform admin.
--
-- Corolario operativo: la allowlist protege el registro publico, no la secret
-- key. Quien tenga `SUPABASE_SECRET_KEY` crea el usuario que quiera, con hook o
-- sin hook. Lo que lo frena para llegar al backoffice es lo otro: la fila en
-- `platform_admins` y el `aal2` que exige `is_platform_admin()`.
--
-- Vive en `private` (la doc de Supabase lo pone en `public`): PostgREST solo
-- expone los schemas configurados, asi que en `private` no hay forma de
-- invocarlo desde la API. Recibe el evento y devuelve `{}` para dejar pasar o
-- `{"error": {...}}` para rechazar.
-- ---------------------------------------------------------------------------

create or replace function private.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email    text;
  v_provider text;
  v_allowed  public.signup_allowlist%rowtype;
  -- Un solo mensaje para los tres motivos de rechazo. Distinguir "no estas en
  -- la lista" de "estas pero con otro proveedor" convierte el endpoint en un
  -- oraculo para averiguar que direccion administra la plataforma. Mismo
  -- criterio que la respuesta uniforme de `requestMagicLinkAction`.
  v_rejection constant jsonb := jsonb_build_object(
    'error', jsonb_build_object(
      'message',   'Esta cuenta no esta habilitada para registrarse.',
      'http_code', 403
    )
  );
begin
  v_email    := lower(nullif(event -> 'user' ->> 'email', ''));
  v_provider := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', '');

  if v_email is null then
    return v_rejection;
  end if;

  select * into v_allowed
    from public.signup_allowlist s
   where s.email = v_email;

  if not found or v_allowed.provider <> v_provider then
    return v_rejection;
  end if;

  return '{}'::jsonb;
end;
$$;

-- `supabase_auth_admin` es el rol con el que Auth llama al hook. Necesita ver
-- el schema y ejecutar la funcion, nada mas: la lectura de la allowlist la hace
-- el `security definer`, asi que Auth nunca puede leer la tabla por su cuenta.
grant usage on schema private to supabase_auth_admin;
revoke execute on function private.before_user_created(jsonb) from public, anon, authenticated;
grant  execute on function private.before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Auto-provision de platform_admins
--
-- El hook puede rechazar, pero no puede escribir la fila de `platform_admins`:
-- corre ANTES de que el usuario exista, asi que todavia no hay `user_id` al que
-- apuntar. Por eso la provision va en un trigger `after insert`.
--
-- Esto NO afloja el control de alta que documenta `init_schema.sql` ("las filas
-- se insertan por SQL a mano"): la decision sigue tomandose por SQL, solo que
-- se toma al escribir la allowlist en vez de al escribir `platform_admins`. El
-- unico camino a la fila sigue siendo que alguien con acceso a la base haya
-- puesto esa direccion en la lista.
--
-- Y seguir en `platform_admins` no alcanza para ver nada: `is_platform_admin()`
-- exige ademas `aal2`, o sea el TOTP enrolado y verificado.
-- ---------------------------------------------------------------------------

create or replace function private.provision_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.signup_allowlist s
     where s.email = lower(new.email)
       and s.role  = 'platform_admin'
  ) then
    insert into public.platform_admins (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function private.provision_platform_admin() from public, anon, authenticated;
grant  execute on function private.provision_platform_admin() to supabase_auth_admin;

create trigger provision_platform_admin_on_signup
  after insert on auth.users
  for each row execute function private.provision_platform_admin();
