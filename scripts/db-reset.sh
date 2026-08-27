#!/usr/bin/env bash
#
# Reset completo de la base para post-testing / QC.
#
# `supabase db reset` recrea la base entera: schema, migraciones, seed Y el
# schema `auth`. O sea que se lleva puestos todos los usuarios, incluido el
# platform admin y su TOTP enrolado. Por eso el bootstrap corre inmediatamente
# después: si no, quedás sin poder entrar a ningún panel.
#
# Uso:
#   npm run db:reset            reset + usuarios
#   npm run db:reset -- --orders  reset + usuarios + pedidos de prueba
#
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker no está corriendo. Abrí Docker Desktop y volvé a intentar."
  exit 1
fi

if ! npx supabase status >/dev/null 2>&1; then
  echo "→ El stack local no está levantado. Arrancándolo..."
  npx supabase start
fi

echo "→ Recreando la base (migraciones + seed)..."
npx supabase db reset

echo "→ Regenerando tipos de TypeScript desde el schema..."
npx supabase gen types typescript --local --schema public > src/lib/supabase/database.types.ts

echo "→ Recreando usuarios de desarrollo..."
node --env-file=.env.local scripts/bootstrap-dev.mjs "$@"

# `db reset` recrea la base pero NO relee supabase/config.toml: eso se lee al
# arrancar los contenedores. Si cambiaste site_url, SMTP o una plantilla de mail
# y no ves el efecto, es por esto.
echo
echo "Nota: si cambiaste supabase/config.toml, hace falta"
echo "      npm run db:stop && npm run db:start  (un reset no lo relee)"
