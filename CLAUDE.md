@AGENTS.md

# Burger Shop

Pedidos online para hamburgueserías. Reemplaza el flujo actual (mensaje a
WhatsApp → alguien contesta → comprobante de pago → "ya está listo") por una web
mobile-first donde el cliente arma el pedido, paga con Mercado Pago y sigue el
estado solo.

Es un **SaaS multi-tienda**: cada local tiene su slug, su identidad visual, su
cuenta de Mercado Pago y su staff.

Plan completo: `~/.claude/plans/hidden-bouncing-adleman.md`

---

## Stack

| Pieza | Versión / nota |
|---|---|
| Next.js | 16.3.3, App Router. **El middleware se llama `proxy.ts`** |
| React | 19.2 |
| Tailwind | v4 (config en CSS, no en JS) |
| shadcn/ui | base `radix`, preset Nova. Componentes en `src/components/ui/` |
| Zod | v4 — `z.url()`, no `z.string().url()`. Los errores son `error.issues` |
| Supabase | Postgres 17 + Auth + Storage. Local en `127.0.0.1:54321` |
| Pagos | Mercado Pago Checkout Pro |

## Comandos

```bash
npm run dev            # Next en :3000
npm run build
npm run typecheck      # tsc --noEmit
npm run lint
npm test               # vitest. Los tests de tests/db/ se saltean sin Docker.

npm run db:start       # levanta el stack local (necesita Docker)
npm run db:reset       # RESET TOTAL: migraciones + seed + tipos + usuarios
npm run db:reset -- --orders   # lo mismo + 5 pedidos de prueba para QC
npm run db:bootstrap   # solo recrear usuarios (idempotente)
npm run db:types       # regenerar database.types.ts
npm run db:stop
```

**`db:reset` se lleva puestos los usuarios.** `supabase db reset` recrea el
schema `auth` completo, así que borra el platform admin y su TOTP enrolado. Por
eso `scripts/db-reset.sh` corre el bootstrap inmediatamente después: sin eso te
quedás sin poder entrar a ningún panel. **Hay que volver a enrolar el TOTP cada
vez.** (Eso hoy funciona porque `[auth.mfa.totp]` tiene `enroll_enabled` y
`verify_enabled` en `true`; con esos flags en `false` —como estaban— el
backoffice era imposible de probar en local: `is_platform_admin()` exige `aal2`
y sin enrolamiento nunca se llega, así que devolvía cero filas.)

Credenciales de desarrollo que deja el bootstrap:

| Quién | Dónde | Cómo |
|---|---|---|
| Cliente | `/la-birra` | nada |
| Dueño del local | `/admin/acceso` | magic link a `<DEV_EMAIL>+dueno-la-birra@…` (o Mailpit si no seteaste `DEV_EMAIL`). El bootstrap NO manda invitación: eso lo hace el alta desde el backoffice |
| Plataforma | `/backoffice/login` | `<DEV_EMAIL>+admin@…` / `burger-dev-1234` + TOTP |

---

## Arquitectura: MVC sobre App Router

App Router no es MVC, así que el mapeo es explícito y **se respeta**:

```
src/
  models/       M — ÚNICO lugar que habla con Postgres. Schemas Zod + queries.
  controllers/  C — casos de uso. Server Actions y route handlers delegan acá.
  views/        V — componentes de presentación. CERO data fetching.
  app/          Routing fino: la page llama a un controller y renderiza una view.
  services/     Adapters externos detrás de interfaces (MP, WhatsApp, POS).
  lib/          Clientes Supabase, dinero, color, tema, utils.
```

**Regla dura**: `app/**/page.tsx` no importa `@supabase/*` **nunca**. El acceso
a Postgres vive solo en `models/`.

**Cuándo hace falta un controller.** Una page puede llamar a un modelo
directamente para una lectura plana. El controller existe cuando hay algo que
orquestar: combinar varios modelos, validar entrada, hablar con un servicio
externo, revalidar cache, o resolver sesión y permisos. Un controller que solo
reenvía a un modelo es indirección sin valor — no lo agregues para cumplir con
la forma.

### Controllers: lecturas y acciones van en archivos SEPARADOS

```
<nombre>.controller.ts   lecturas. `import 'server-only'`. Lo usan Server Components.
<nombre>.actions.ts      Server Actions. `'use server'` en la PRIMERA LÍNEA del archivo.
                         Lo importan los Client Components.
```

No es una preferencia de orden: **Next rechaza el build** si un Client Component
importa un módulo con `'use server'` en línea dentro de una función. Ver trampas.

Un archivo `.actions.ts` **solo puede exportar funciones async**. Nada de tipos,
constantes, schemas ni helpers sincrónicos: eso vive en el controller y se
importa desde las acciones. Importar está bien, exportar no.

Que un `.actions.ts` importe modelos que arrastran `server-only` es correcto:
esos archivos se compilan del lado del servidor y al cliente solo le llega una
referencia RPC.

`src/models/types.ts` es el vocabulario compartido del dominio: solo tipos, sin
runtime. Si algo cambia de forma, se cambia ahí y TypeScript señala qué tocar.

---

## Reglas que no se negocian

### Dinero
Todo son **centavos enteros** (`bigint` en Postgres, `number` en TS). Nunca
float: `0.1 + 0.2 !== 0.3` y en un total de pedido eso es plata real. La única
conversión a decimal ocurre en el borde con Mercado Pago.
Helpers en `src/lib/money.ts`.

### El precio lo pone el servidor
El cliente manda **IDs y cantidades, nunca precios**. El carrito guarda en
`localStorage` solo `{productId, quantity, optionIds, notes}`; los precios que
muestra el checkout vienen de una consulta al servidor y no vuelven nunca. El
total se recalcula siempre contra la base (`priceCart()` en `order.model.ts`).

**`cartItemSchema` y `createOrderSchema` son `.strict()`, y eso es parte del
modelo de seguridad, no un detalle.** Por defecto Zod *descarta* las claves que
no conoce: un cliente que mandara `unitPriceCents` recibiría un 200 y el campo
se tiraría en silencio. Seguro pero mudo — nadie se enteraría. Con `.strict()`
es un 400 que nombra la clave, así que si algo empieza a mandar precios se ve.

Verificado: `{"items":[{...,"unitPriceCents":1}]}` → `400 Unrecognized key`.

### Un pedido, una vez: idempotencia

`createOrderSchema` exige `idempotencyKey` (UUID que genera el browser al
confirmar) y hay un **índice único** en `orders(store_id, idempotency_key)`.

El chequeo vive en la base, no en la app: un `if` en el servidor pierde la
carrera cuando llegan dos requests simultáneos. `createOrder` busca la clave
antes de insertar y, si el índice rechaza el insert con `23505`, devuelve el
pedido que ganó en vez de un error.

La clave se **reusa en cada reintento** del mismo intento de compra y se descarta
al modificar el carrito o al crear el pedido con éxito. Si se regenerara en cada
click, la idempotencia no serviría para nada.

Verificado: 8 requests en paralelo con la misma clave → **un** pedido, **una**
fila. Sin esto, un doble tap con mala señal metía dos pedidos en la cocina y
creaba dos preferencias de pago.

### La máquina de estados de cocina

```
pending    → confirmed | cancelled
confirmed  → preparing | cancelled
preparing  → ready | confirmed | cancelled
ready      → delivered | preparing | cancelled
delivered  → terminal
cancelled  → terminal
```

`ALLOWED_TRANSITIONS` en `order.schema.ts` es la fuente única en TypeScript; la
UI la importa para no ofrecer botones que van a fallar. El CHECK de la tabla
valida que el estado *exista*; esto valida que se pueda *llegar* ahí.

**La misma tabla está además en un trigger** (`private.enforce_order_rules`), y
eso no es redundancia: la versión de TypeScript se puede saltear pegándole a
PostgREST con la sesión del staff, y la de Postgres no. El trigger aplica a
`service_role` también, porque "de un estado terminal no se sale" es una
invariante del dominio y no un permiso: es lo que evita que un pago que llega
tarde resucite un pedido que la cocina ya canceló. Si cambiás la tabla, se cambia
en los dos lados — hay un test en `tests/db/` que compara.

Se permite **un paso atrás** dentro de la cocina: un toque equivocado en una
cocina llena está garantizado, y obligar a rehacer el pedido es peor que dejar
corregir.

Dos reglas que no son de estado sino de negocio:
- **Un pedido online impago no pasa a `confirmed`.** La comida no sale sin plata
  asegurada. El de pago en el local sí, porque ahí el cobro es presencial.
- El update lleva `.eq('status', from)`: si otro operario cambió el estado entre
  la lectura y la escritura, devuelve **409** en vez de pisar su cambio en
  silencio. Dos personas en el mostrador en hora pico no es un caso raro.

### Errores: dominio vs. interno

`src/lib/errors.ts` separa dos cosas que un `catch` genérico mezcla:

- **`DomainError`** es una condición de negocio y su mensaje **es** interfaz:
  "Esta tienda no está disponible", "Elegí al menos 1 opción de Punto de
  cocción". El cliente lo ve y puede actuar.
- **Cualquier otra excepción** es una falla nuestra. Se loguea en el servidor y
  el cliente recibe algo genérico. Sin esta distinción, un `catch` que devuelve
  `err.message` termina mandando el detalle de una constraint de Postgres al
  browser.

`zodToApiError` devuelve **solo** el primer mensaje y el campo, nunca el array
`issues`: eso expone rutas internas y, con `.strict()`, el nombre de la clave
rechazada. Un `unrecognized_keys` ni se nombra — un cliente legítimo no puede
producirlo, así que el detalle solo le sirve a quien está sondeando el endpoint.

### Los tres clientes de Supabase
| Archivo | Rol | Cuándo |
|---|---|---|
| `lib/supabase/client.ts` | browser, respeta RLS | auth del staff, Realtime |
| `lib/supabase/server.ts` | servidor como el usuario, respeta RLS | todo lo de staff y backoffice |
| `lib/supabase/admin.ts` | **bypassea RLS** | crear pedidos, buscar por token, webhook de MP, credenciales, cron |

`admin.ts` nunca se usa en respuesta directa a algo que mandó el browser sin
validar antes con Zod.

### RLS es la autorización real
`proxy.ts` solo refresca la sesión: **no autoriza**. Cada page y server action
de `/admin` y `/backoffice` verifica de nuevo. La defensa real vive en Postgres.

### Los grants son por COLUMNA, no por tabla

Un grant de tabla es todo-o-nada, y una policy `FOR ALL` no distingue qué
columna se escribe. Con eso, la sesión de un staff —que tiene la publishable key
en el browser— alcanzaba para pegarle a PostgREST directo y hacer cosas que la
app nunca ofrece:

```
PATCH /rest/v1/stores?id=eq.1  {"status":"active"}      -- revertir una suspensión
PATCH /rest/v1/stores?id=eq.1  {"slug":"admin"}         -- secuestrar una ruta
PATCH /rest/v1/orders?id=eq.9  {"payment_status":"approved","total_cents":1}
```

Verificado a mano: devolvía 1 fila. Las reglas existían, pero en TypeScript.

Hoy:

| Tabla | Qué puede escribir `authenticated` |
|---|---|
| `stores` | Todo **menos** `status` y `slug` (son de la plataforma) |
| `orders` | **Solo** `status`. El ciclo del dinero es del servidor |

Consecuencia práctica: **toda escritura de dinero o de estado de tienda va con
`createAdminClient()` detrás de un chequeo de permiso explícito en el servidor.**
`markPaidInStore` y `setStoreStatus` son los dos ejemplos. Si escribís algo con
el cliente RLS y te da `permission denied`, la pregunta no es "qué grant falta"
sino "¿esto lo tendría que poder hacer el browser del staff?".

### Lo que se agrega en Postgres, no en TypeScript

Cuando una regla es una **invariante del dominio** (no un permiso), va en la
base, porque ahí no hay camino que la esquive:

- `private.enforce_order_rules` — transiciones legales, "online impago no
  confirma", y columnas inmutables (`total_cents`, `public_token`,
  `idempotency_key`, `store_id`, `currency`, `payment_method`, `created_at`).
- `payments_one_approved_per_order_idx` — un solo pago aprobado por pedido. Es la
  defensa contra el doble cobro: el segundo insert rebota con `23505` y la app lo
  registra como `duplicate` y lo reembolsa.
- `products_category_same_store_fkey` — FK compuesta `(store_id, category_id)`:
  una categoría de otra tienda no entra ni por PostgREST.
- `private.before_user_created` — quién puede **registrarse**. Corre dentro de
  Auth, antes de escribir en `auth.users`, así que cubre `POST /auth/v1/signup` y
  `POST /auth/v1/otp` con `create_user:true` — los dos invocables desde cualquier
  browser con la publishable key, ninguno de los dos pasa por nuestro código. La
  Admin API **sí** lo saltea (verificado), y por eso el backoffice sigue creando
  dueños de local sin anotarlos en la lista.
- `stores_slug_not_reserved_check` — lista negra de slugs, duplicada a propósito
  en `RESERVED_SLUGS` de `platform.schema.ts`: la base garantiza que no entre, el
  schema hace que el mensaje se entienda. Si agregás uno, va en los dos lados.

### RPCs: lo que no se puede hacer desde la app

Todas viven en `public` (PostgREST solo expone schemas configurados), son
`SECURITY DEFINER`, y **cada una revoca `EXECUTE` de `public, anon` y lo otorga
explícitamente**: Postgres le da EXECUTE a PUBLIC por defecto a toda función
nueva, así que una `SECURITY DEFINER` en `public` sin revoke es un endpoint
abierto. Las que atiende un usuario logueado verifican el permiso **en el
cuerpo** (`is_store_member` / `is_platform_admin`).

| RPC | Para | Por qué no en TS |
|---|---|---|
| `create_order` | service_role | Atomicidad: cabecera + ítems + opciones en una transacción |
| `store_dashboard`, `platform_metrics`, `platform_stores` | authenticated | PostgREST corta en `max_rows` (1000) **sin error**: agregar en TS truncaba la facturación en silencio |
| `claim_event_deliveries`, `settle_event_delivery` | service_role | `for update skip locked`: sin eso dos crons entregan duplicado |
| `expire_pending_orders`, `cleanup_old_records` | service_role | Barrido masivo |

### Crons

**Los invoca pg_cron desde Postgres, no Vercel Cron**, y el motivo es un
bloqueante de plan, no una preferencia. De la doc de Vercel, textual: *"Hobby
accounts are limited to daily cron jobs. This cron expression would run more
than once per day"* — y el efecto no es que corran lento: **el deploy falla**.

Bajarlos a una vez por día tampoco era opción, porque rompe el producto:
`reconcile` es la única red cuando se pierde el webhook de Mercado Pago, así
que el cliente paga y la cocina se entera al otro día.

Los handlers **no cambiaron**: siguen exportando `GET` y comparando
`CRON_SECRET` en tiempo constante. Lo único que cambió es quién los llama.
Volver a Vercel Cron el día que se pase a Pro es borrar los schedules y
devolver las entradas a `vercel.json`.

| Ruta | Cada | Quién lo dispara | Para qué |
|---|---|---|---|
| `/api/cron/outbox` | 2 min | pg_cron | Entregar `order_events` al POS del local |
| `/api/cron/reconcile` | 10 min | pg_cron | Recuperar pagos cuyo webhook se perdió, y expirar los abandonados |
| `/api/cron/auto-advance` | 2 min | pg_cron | Auto-comenzar y auto-listo, opt-in por tienda |
| `/api/cron/cleanup` | diario | **Vercel Cron** | Retención de `order_events`, `platform_audit_log` y `rate_limits` |

El de conciliación existe porque el webhook era el **único** camino a "pagado":
si fallaba por algo transitorio, el cliente había pagado y la cocina no se
enteraba nunca.

**`app_base_url` y `cron_secret` viven en Vault**, no en la migración: una es
distinta por entorno y la otra es un secreto. Sin cargarlas, los jobs fallan con
un mensaje que nombra la clave que falta — a propósito, porque la alternativa
(devolver null) arma la URL `null/api/cron/outbox` y sale como un 404 que no
menciona Vault en ningún lado.

**`net.http_get` es asíncrono**: encola y vuelve, así que el job nunca ve el
status code. Es aceptable porque los tres handlers son idempotentes y el
próximo tick reintenta, pero significa que cuando un barrido "no hizo nada" hay
que mirar `net._http_response`, no los logs de la app.

**Trampa**: pg_net crea SIEMPRE su propio schema `net` y ahí viven `http_get` y
`http_post`, sin importar el `with schema` que se le pase. Llamarlas como
`extensions.http_get` da `function does not exist`.

---

## Modelo de datos

21 tablas en `supabase/migrations/`. Convenciones: `bigint identity` como PK,
centavos, `timestamptz` siempre, snake_case, índice en **toda** FK.

- **Plataforma**: `platform_admins`, `platform_audit_log`, `signup_allowlist`
- **Tienda**: `stores`, `store_branding`, `store_members`, `store_payment_credentials`
- **Catálogo**: `categories`, `products`, `option_groups`, `options`
- **Pedidos**: `orders`, `order_items`, `order_item_options`, `payments`
- **Integración**: `order_events` (outbox), `notifications`, `pos_endpoints`
- **Operación**: `rate_limits` (baldes; `subject` es un HMAC, nunca el valor crudo)

### Los dos identificadores del pedido
- `short_code` — 4 chars, para cantar en el mostrador. Se repite entre días.
  **No autentica nada.**
- `public_token` — 24 chars de un alfabeto de 31. Va en la URL y en el
  `localStorage` del cliente. Es lo único que da acceso a un pedido, así que se
  genera con `extensions.gen_random_bytes` (CSPRNG) y rejection sampling para
  eliminar el sesgo del módulo. **Ojo con el argumento de los "119 bits": ese es
  el tamaño del ESPACIO, no la entropía.** Antes salía de `random()`, que es un
  PRNG determinístico que la doc de Postgres marca como no apto para
  criptografía — y los `short_code` (mismo generador) se cantan en el mostrador,
  o sea que había salidas públicas del PRNG.

### Multiplicador de demanda
Cada producto tiene `prep_minutes`:

```
base    = MAX(prep_minutes) de los ítems    -- el pedido se entrega junto, no se suma
activos = orders con status in ('confirmed','preparing')   -- COOKING_STATUSES
mult    = activos >= store.demand_threshold_orders ? store.demand_multiplier : 1
eta     = ceil(base * mult)
```

La multiplicación va con `scaleUpInt()` de `src/lib/money.ts`, no con
`Math.ceil(base * mult)`: `20 * 1.1` da `22.000000000000004` en float, o sea un
minuto de más.

El ETA se **congela** en la fila del pedido (`base_prep_minutes`,
`demand_multiplier`, `eta_minutes`, `eta_at`) para que el número no le salte al
cliente mientras espera. Se calcula al crear el pedido y se **recalcula al
aprobarse el pago**: entre las dos cosas puede pasar media hora, y un ETA de
hace media hora no le sirve a nadie.

### Estados
`pending → confirmed → preparing → ready → delivered` (+ `cancelled`)

Ése es el ciclo de la **cocina**. El del **dinero** es `payment_status`
(`pending | approved | rejected | refunded`) y es un reloj aparte: con pago en el
local un pedido puede estar `ready` y todavía impago.

`ALLOWED_TRANSITIONS` en `order.schema.ts` es la fuente única en TypeScript, y
desde `20260826120000_hardening.sql` **la misma tabla vive en un trigger de
Postgres** (`private.enforce_order_rules`) que aplica a todos los roles,
`service_role` incluido. No es redundancia: que los estados terminales sean
terminales incluso para el servidor es lo que evita que un pago que llega tarde
resucite un pedido que la cocina ya canceló.

---

## Tres niveles de acceso

| Quién | Dónde | Cómo entra | Qué puede |
|---|---|---|---|
| Cliente | `/[store]`, `/pedido/[token]` | Nada | Ver catálogo, comprar, seguir SU pedido |
| Staff del local | `/admin` | Magic link, **por invitación** desde el backoffice | Todo lo de SU tienda |
| Plataforma | `/backoffice` | **Google** o contraseña, + **TOTP** siempre | Crear/suspender tiendas, métricas globales |

### Por qué el backoffice es seguro
Staff y plataforma comparten el mismo proyecto de Supabase Auth. La pregunta
obvia: ¿no se puede saltear el TOTP pidiendo un magic link?

No: **la exigencia de `aal2` vive en las RLS, no en la pantalla de login.**
`private.is_platform_admin()` pide `auth.jwt()->>'aal' = 'aal2'`, así que una
sesión sin segundo factor verificado ve cero filas. No hay puerta de atrás
porque hay una sola puerta y está en Postgres.

Google no afloja nada de eso: es un **primer** factor, igual que la contraseña.
La sesión que deja el callback queda en `aal1` y no ve una fila hasta enrolar el
TOTP.

Además:
- `/admin/acceso` usa **`shouldCreateUser: false`**. Sin eso, el formulario de
  magic link es un registro público.
- `platform_admins` **no tiene UI de alta**: la fila la escribe un trigger, y
  solo para un email anotado a mano en `public.signup_allowlist` con
  `role = 'platform_admin'`. La decisión se sigue tomando por SQL — cambió
  *cuándo* se toma, no *quién* la toma.
- Todo lo que pasa por el backoffice queda en `platform_audit_log`.

---

## Branding por tienda

`store_branding` (1:1 con `stores`) guarda el kit de marca. `buildThemeCss()` en
`src/lib/theme.ts` lo convierte en las variables CSS que shadcn ya usa
(`--primary`, `--background`, `--radius`…) y el layout de `/[store]` lo inyecta
como un `<style>` scopeado. Sin JS, sin flash, y todos los componentes se
adaptan solos.

Los colores se guardan en hex y se convierten a **OKLCH** (`src/lib/color.ts`),
que es perceptualmente uniforme: permite derivar hover, ring y superficies a
partir de un solo color de marca sin que el naranja quede lavado y el azul
oscuro con el mismo ajuste.

**Esto es una superficie de inyección de CSS.** Todo valor que termina dentro
del `<style>` pasa por `brandingSchema`: hex estricto, número acotado, enum
cerrado de tipografías. Nunca texto libre.

---

## Email: Resend en todos los entornos

**Resend no es opcional, y el motivo no es el rate limit.** De la documentación
de Supabase, textual:

> *"Unless you configure a custom SMTP server for your project, Supabase Auth
> will refuse to deliver messages to addresses that are not part of the
> project's team."*

Sin SMTP propio, Auth **solo entrega a miembros de tu equipo de Supabase**. El
dueño de un local no está en ese equipo, así que su magic link no sale nunca —
no llega tarde, no sale. Eso mata la única puerta de entrada a `/admin`.

Además: el servicio interno está declarado *"for demonstration purposes only"*
con disponibilidad *best-effort*, y **Supabase no tiene API de envío de mail**:
solo manda los de Auth. El comprobante y el "pedido listo" necesitan un
proveedor igual, así que usar el built-in dejaría dos sistemas de mail en vez
de uno.

Resend se usa **también en local**, así que lo que probás es exactamente lo que
se envía, plantilla incluida.

**`supabase/config.toml` configura SOLO el stack local.** El SMTP del proyecto
hosted se configura en el dashboard (Authentication → Emails), no desde este
archivo. Poner Resend acá no configura producción: solo rompe el desarrollo.

Por eso el bloque `[auth.email.smtp]` está **comentado**. Con él prendido y sin
`RESEND_API_KEY`, Auth devuelve **HTTP 500** y el magic link no sale ni por
Resend ni por Mailpit. Apagado, el CLI captura todo en Mailpit
(`http://127.0.0.1:54324`) y **la plantilla propia igual se aplica**, así que se
ve el mail real sin depender de internet. Para probar la entrega real de Resend
en local: cargar la key, descomentar el bloque y reiniciar el stack.

En producción, el usuario de SMTP en Resend es literalmente `resend` y la
contraseña es la API key.

**Dos trampas de rate limit, en dos lugares distintos:**

1. **Local** (`supabase/config.toml`): `[auth.rate_limit] email_sent` estaba en
   `2`, y mientras el SMTP estuvo deshabilitado ese límite era **inerte**. Al
   prender Resend pasa a aplicar. Está en 100.
2. **Proyecto hosted**: al conectar SMTP propio, Supabase impone **30
   mensajes/hora** por defecto para proteger la reputación de un remitente
   nuevo. Se sube en Rate Limits del dashboard. El `config.toml` **no** afecta
   esto: son dos configuraciones separadas.

### Dos clases de mail, dos mecanismos

| Qué | Quién lo manda | Dónde vive |
|---|---|---|
| Magic link del panel | Supabase Auth, por SMTP | `supabase/templates/magic-link.html` |
| Comprobante y "pedido listo" | La app, por la API de Resend | `src/services/notifications/email/` |

La plantilla del magic link usa `{{ .TokenHash }}`, **no** `{{ .Token }}`: es lo
que consume `/admin/acceso/confirm` vía `verifyOtp`. La plantilla por defecto de
Supabase apunta a otra ruta y el link no entra a ningún lado.

### El email del cliente es opcional

`orders.customer_email` es nullable a propósito: un campo más en el checkout es
fricción real en mobile. Si el cliente lo deja, recibe comprobante y aviso de
listo **además** del WhatsApp; si no, WhatsApp es el único canal. Una vez que lo
completó se guarda en `localStorage` (`burger-shop.customer`, junto con nombre y
teléfono) y no se le vuelve a pedir.

**Sin `RESEND_API_KEY` el adapter devuelve `skipped`, nunca tira.** Que no salga
un comprobante no puede romper un pedido que ya se pagó. Mismo principio que el
adapter de WhatsApp.

### Desarrollo

Resend solo entrega a la dirección de tu cuenta hasta que verifiques un dominio,
así que las direcciones inventadas se descartan en silencio. Poné `DEV_EMAIL` en
`.env.local` con tu casilla real: el bootstrap deriva `vos+admin@…` y
`vos+dueno-la-birra@…` con plus-addressing. Sin `DEV_EMAIL`, el script avisa y
cae a los `@burgershop.test`, que solo sirven con Mailpit.

**Por defecto el magic link cae en Mailpit (`http://127.0.0.1:54324`), y eso no
es un bug.** El bloque `[auth.email.smtp]` está comentado a propósito: así el
flujo completo se prueba sin internet y sin cuenta de Resend, con la plantilla
propia igual aplicada. Si el link "no llega", lo primero es abrir Mailpit.

Para que salga de verdad a tu casilla:

```bash
npm run resend:setup            # verifica la key, el dominio y manda un mail de prueba
npm run resend:setup -- --enable   # además descomenta el SMTP de Auth
npm run db:stop && npm run db:start   # config.toml NO se relee con db reset
```

El script existe por la trampa: **con el bloque activo y sin `RESEND_API_KEY`
válida, Auth devuelve HTTP 500 y el magic link deja de salir incluso por
Mailpit.** O sea que el intento de mejorar la entrega apaga la única puerta a
`/admin`, y el síntoma no menciona el SMTP en ningún lado. Por eso valida
primero: key contra la API de Resend, estado del dominio del remitente, y un
mail de prueba real — recién entonces toca `config.toml`.

Y no confundir los dos mecanismos: con la key sola ya salen el comprobante y el
"pedido listo" (los manda **la app** por la API). El bloque SMTP es solo para el
magic link, que lo manda **Supabase Auth**.

**`env(...)` de `config.toml` lo sustituye el CLI de Supabase, no Next.** O sea
que esas variables tienen que estar donde el CLI las vea, y el CLI **no** lee
`.env.local` de la misma forma que `next dev`. Si `.env` y `.env.local` no
coinciden, el remitente que termina en el contenedor depende de cuál gane —
verificalo con `docker inspect supabase_auth_burger-shop | grep GOTRUE_SMTP`, no
lo asumas. Y el remitente **tiene** que estar en un dominio verificado en
Resend: una dirección de gmail como `RESEND_FROM_EMAIL` la rechaza Resend, y el
magic link deja de salir sin que nada en la app lo diga.

## Extensibilidad al software de gestión del local

Todavía no sabemos qué POS usan los locales, así que nada se acopla a uno.
Cada cambio de estado inserta una fila en `order_events`, que funciona como
**outbox**. Un cron lee los no entregados y hace POST firmado con HMAC a los
`pos_endpoints` de la tienda, con reintentos vía `attempts`.

Cuando aparezca un POS con API propia se escribe un `PosAdapter` en
`services/pos/` y el ID externo se guarda en `orders.external_ref`.
**El core no se toca.**

Mismo patrón para WhatsApp: `services/notifications/notifier.port.ts` con dos
adapters (`wa.me` manual y Cloud API), elegidos por `WHATSAPP_PROVIDER`.

---

## Cómo se implementa en este repo

**Toda implementación se hace con subagentes en modelo `sonnet`, tantos en
paralelo como el trabajo permita.** No se escribe código de feature en el hilo
principal.

**Esta regla gana sobre cualquier default del entorno.** Algunas
configuraciones de sesión traen un "no uses el Agent tool salvo que el usuario
lo pida": acá el usuario ya lo pidió, en este archivo, para todo el repo. No
hay que volver a preguntarlo por tarea. Si el hilo principal se encuentra
escribiendo código de feature, se equivocó de rol.

Qué agente para qué: `feature-planner` (en plan mode) antes de cualquier
cambio no trivial, `senior-backend-engineer` para `models/`, `controllers/`,
`services/` y `app/api/`, `frontend-react-craftsman` para `views/` y `app/`,
`code-reviewer` como puerta de calidad antes de commitear. El hilo principal
sí escribe migraciones y schema (ver reglas operativas más abajo).

El hilo principal hace tres cosas, y solo tres:

1. **Fija los contratos** antes de repartir. `src/models/types.ts` (vocabulario
   del dominio), las firmas exactas de la capa de modelos, y las primitivas de
   `src/views/shared/`. Sin un contrato escrito antes, cinco agentes inventan
   cinco vocabularios y la integración es una reescritura.
2. **Reparte en slices que no comparten un solo archivo.** El corte es por
   directorio y se declara explícito en el prompt de cada agente: de qué archivos
   es dueño exclusivo y cuáles no puede tocar. Dos agentes sobre el mismo archivo
   se pisan sin aviso.
3. **Integra y verifica.** Lo que un agente reporta no se da por cierto: se
   comprueba. El bug de `service_role` de la sección de trampas apareció así.

### Los agentes usan las skills. Todas.

**No es opcional y no depende de que el agente se acuerde: el prompt de cada
agente tiene que nombrar explícitamente las skills que le corresponden.** Un
agente que no las invoca produce código que compila y contradice el sistema.

Las skills viven en `.claude/skills/` (scope de proyecto), así que cualquier
subagente que corra en este repo las ve.

| Skill | Cuándo es obligatoria |
|---|---|
| `impeccable` | **Toda** UI. Antes de editar: `reference/craft-floor.md`. Superficies de tarea: `reference/operate.md`. Para planificar una superficie: `shape`. |
| `web-design-guidelines` | Antes de cerrar cualquier slice de UI: accesibilidad y Web Interface Guidelines. |
| `frontend-design` | Cuando hay que decidir tratamiento visual dentro del mundo ya elegido. |
| `vercel-react-best-practices` | Todo lo que sea React/Next: componentes, data fetching, bundle, performance. |
| `supabase` | Cualquier cosa que toque Supabase: auth, RLS, Realtime, Storage, SSR, debugging. |
| `supabase-postgres-best-practices` | **Antes** de escribir o cambiar schema, migraciones, RLS, índices, triggers o queries. |
| `context7` (MCP) | Antes de usar la API de cualquier librería. Tu memoria de la API está desactualizada; las docs no. |

Reglas al invocarlas:

- **Los agentes de UI heredan el mundo visual ya decidido.** Leen el contrato de
  dirección y su brief de superficie, y **no vuelven a abrir la decisión de
  identidad**: nada de `context.mjs` ni `concept-seed.mjs` de nuevo. Un agente
  que rerruea el seed produce una segunda identidad y rompe la coherencia del
  producto.
- **Pasales también la ruta explícita** de los archivos de referencia que tienen
  que leer, además del nombre de la skill. Es redundante a propósito: si por lo
  que sea el Skill tool no les está disponible, igual reciben la guía.
- El hook de `impeccable` corre solo después de cada edición de UI y devuelve
  los hallazgos mecánicos. Actuar sobre lo que reporta, no re-auditar a mano.

Reglas operativas:

- **Ningún agente corre `npm install`.** Instalaciones concurrentes corrompen
  `node_modules`. Las dependencias se preinstalan desde el hilo principal.
- **Ningún agente toca migraciones ni resetea la base.** El schema es del hilo
  principal; si un agente encuentra un problema de schema, lo reporta.
- Los agentes de UI heredan el mundo visual ya decidido: leen el contrato de
  dirección y su brief de superficie, y **no vuelven a abrir la decisión de
  identidad**. Un agente que corre `concept-seed` de nuevo produce una segunda
  identidad y rompe la coherencia del producto.

## Diseño

El mundo visual es **el estándar de la categoría, ejecutado completo**: la app de
pedido propia de una marca. La vara son las apps de cadena (McDonald's, Mostaza,
Starbucks) y las webs de pedido que contrata un local (Toast, Square, Slice).
**Marca propia, nunca marketplace**: la plataforma no se muestra en la cara del
cliente.

Fue una elección deliberada del dueño del producto (2026-08-26), tomada contra
seis direcciones alternativas. Eso significa que **la convención es el
compromiso**: se usa entera y sin rarezas de contrabando. Si una convención de la
categoría existe porque funciona —el riel de categorías, la barra de carrito
fija, la hoja de producto que sube desde abajo, el stepper de cantidad—, se usa
tal cual. La identidad del local vive en el **color, la tipografía, el radio y la
foto**, que es de donde viene la identidad en este mundo.

**La foto es el motor de venta.** Este negocio vende hambre: la comida se ve
antes que el texto. El mundo anterior (programa de etiqueta de cerveza artesanal)
falló exactamente ahí —foto en una franja de 7rem, portada del local sin
renderizar, nombres en caja alta condensada, specs monoespaciadas— y no vuelve.

**`/admin` y `/backoffice` NO heredan esta composición.** Comparten tokens,
tipografía y controles, pero son **Operate**: la vara ahí son los KDS de cocina y
los paneles de administración. Densidad y poder retomar el hilo después de una
interrupción por encima de expresión. Ver `.impeccable/surfaces/`.

El contrato de dirección vive en `src/app/layout.tsx` y se emite como comentario
HTML en el markup para que sobreviva al build y se pueda auditar el render
contra lo prometido. `PRODUCT.md` tiene la verdad de producto; los briefs por
superficie están en `.impeccable/surfaces/`. **`DESIGN.md` se escribe al final,
desde lo construido** — un reglamento escrito antes se defiende de la realidad
en vez de describirla.

### Primitivas compartidas

`src/views/shared/surfaces.tsx` es la gramática: `Panel`, `SectionHeading`,
`PhotoFrame`, `Stepper`, `ActionBar`, `CategoryRail`, `CategoryChip`,
`OptionRow`, `StatusPill`, `StepMark`. Más `Price` (money), `EmptyState` /
`ClosedNotice` / `MenuSkeleton` (states), y `OrderSteps` / `PaymentNotice`
(order-status). **Todo compone estas piezas; nadie reinventa una.**

### Tokens

En `globals.css`, fuera del tema del local porque no son de marca:
- Espaciado `--space-1..8`; columna de lectura `--content-max`; `--sticky-offset`.
- Profundidad `--elev-flat|raise|lift|pop` → `shadow-flat|raise|lift|pop`. Con
  desplazamiento **y** desenfoque: un halo sin offset es decoración, no depth.
- Motion `--dur-fast|base|slow` y `--ease-out-expo|quart|back`. Una sola familia
  de easing en todo el producto.
- Utilidades `.tabular`, `.display`, `.clamp-2`, `.rail`, `.action-bar`.

**Tailwind v4**: una variable en valor arbitrario va `rounded-(--radius)`, **no**
`rounded-[--radius]` (sintaxis v3, silenciosamente no emite CSS). Cuando existe
el token en `@theme`, usá la utilidad: `rounded-lg`, `shadow-raise`.

### Motion

**Un solo momento autorizado: agregar al carrito.** La hoja del producto baja, la
barra de carrito entra desde el pie con resorte la primera vez, y el contador
late si ya existía. Nada entra al hacer scroll — una carta que se revela de a
poco es una carta que tarda. Todos los keyframes arrancan desde un estado **ya
visible**, así que con `prefers-reduced-motion` el resultado final es idéntico y
nada queda oculto por JS.

### Reglas duras del piso de calidad

- **Prohibido el kicker/eyebrow arriba de un título.** Sin excepciones.
- Nada de tarjetas anidadas (`Panel` adentro de `Panel`), ni la plantilla de
  métrica-héroe en los dashboards, ni una grilla de tarjetas icono+título+texto
  como **estructura de página**. Una carta de productos es contenido, no eso.
- Nada de emoji ni glifos unicode como íconos: `lucide-react` o SVG propio.
- Monoespaciada solo para **medición** (precios, minutos), nunca de disfraz.
- Nada de texto con gradiente, ni `border-left` de color de más de 1px, ni
  sombras duras sin blur.
- Targets de 44px mínimo en todo lo que se toca con el pulgar.
- Las superficies que no dibujamos —selección, caret, scrollbar, anillo de foco,
  numerales tabulares— están tematizadas en `globals.css`. No las dejes en
  default.
- Toda foto de producto va en `PhotoFrame`: relación de aspecto fija para que la
  carta forme columna aunque las fotos vengan de distintos celulares. **Sin foto
  no es un hueco gris**: es el nombre en grande sobre el color de la marca.

**El contraste está garantizado por el sistema, no por el buen gusto del local.**
`ensureContrast()` en `src/lib/color.ts` mide ratio WCAG real y corrige la
lightness hasta pasar 4.5:1. Blanco sobre el naranja por defecto da 2.80 sin
corregir; corregido da 4.86. No rompas eso con opacidades sobre texto.

## Estilo

- **Idioma**: UI y comentarios en español rioplatense. Nombres de código en inglés.
- **Comentarios**: explican el *por qué*, no el *qué*. Si el código ya lo dice,
  no se comenta. Los que hay marcan decisiones no obvias y trampas.
- **Mobile-first** siempre: el 90% de los pedidos entra desde un celular,
  muchas veces con una mano y mala señal.

---

## Próxima iteración: subdominio por local

**Decidido, no implementado.** `burgerx.<marca>.ar` en vez de `<marca>.ar/burgerx`.

La arquitectura ya está lista sin esfuerzo extra: todo resuelve por
`getStoreBySlug(slug)` y las rutas son `/[store]/*`, así que **ninguna página
cambia**. Es un rewrite por `Host` en `proxy.ts`:

```
burgerx.marca.ar/carrito  →  reescribe internamente a  /burgerx/carrito
```

El path-based tiene que seguir funcionando: los preview deployments de Vercel
**no** quedan cubiertos por el dominio wildcard, y ese fallback es lo único que
permite probar ramas.

### Decisión tomada: el panel va en el apex

`<marca>.ar/admin` y `<marca>.ar/backoffice`. Los subdominios de tienda sirven
**solo tráfico anónimo**.

El motivo es de seguridad, no de gusto. Si el panel viviera en
`burgerx.marca.ar/admin` y alguien alguna vez scopeara la cookie de sesión al
dominio padre (`.marca.ar`), **cualquier local podría leer la sesión de
cualquier otro**. Hoy estamos a salvo por defecto —`@supabase/ssr` no setea el
atributo `domain`, así que las cookies quedan host-only— pero es una línea de
código de distancia del desastre. Con el panel en el apex, el error deja de ser
posible en vez de quedar prohibido.

### Bloqueantes a resolver antes

1. **El SSL wildcard exige los nameservers en Vercel.** Para emitir
   `*.<marca>.ar` automáticamente, Vercel necesita controlar el DNS. Si el DNS
   se queda en NIC.ar, hay que cargar un CNAME por tienda a mano — justo lo que
   el wildcard venía a evitar.
2. **El dominio `.ar`**: `.com.ar` lo registra NIC.ar y pide CUIT/CUIL argentino.
   Verificar con ellos las reglas vigentes del segundo nivel `.ar` directo.
3. **Slugs reservados.** `stores.slug` es único pero nada impide registrar un
   local con slug `admin`, `api`, `www` o `backoffice`. Hoy es un bug menor (el
   segmento estático de Next gana sobre `[store]`, así que esa tienda queda
   inalcanzable); **con subdominios pasa a ser secuestro de ruta.** Hace falta
   una lista negra en `platform.schema.ts` y un CHECK en la migración.

### Lo que habilita después

Dominio propio por local (`burgerx.com.ar` apuntando a la app). Es el mismo
rewrite buscando por dominio en vez de por subdominio, más una columna
`stores.custom_domain`. Es el upsell natural del SaaS.

## Trampas conocidas

- **Next 16 renombró `middleware.ts` a `proxy.ts`.** El viejo nombre no se carga.
- **Supabase no expone tablas nuevas al Data API automáticamente.** Sin
  `grant select ... to anon` el catálogo devuelve vacío aunque las RLS estén
  perfectas: RLS decide qué *filas* ves, el GRANT decide si la *tabla* existe.
  Ver `20260825120500_grants.sql`.
- **`service_role` TAMPOCO recibe privilegios sobre las tablas que crea una
  migración.** Bypassear RLS no sirve de nada si el GRANT no existe. Sin el
  bloque de `service_role` en la migración de grants, crear un pedido y el
  webhook de Mercado Pago fallan con `42501 permission denied for table orders`.
  Costó un bug bloqueante encontrarlo: si agregás una tabla, verificá con
  `curl` usando la secret key antes de darla por buena.
- **`SECURITY DEFINER` en `public` es callable por `anon`.** Por eso los helpers
  viven en el schema `private`. Cuando una función TIENE que estar en `public`
  (porque PostgREST solo expone los schemas configurados), hay que
  `revoke execute ... from public, anon` y otorgar a mano — y si la llama un
  usuario logueado, verificar el permiso en el cuerpo.
- **`[auth.email] enable_signup` de `config.toml` NO es "permitir registros por
  email".** El comentario que genera el CLI dice eso, pero mapea a
  `GOTRUE_EXTERNAL_EMAIL_ENABLED`, que es el interruptor del **proveedor de email
  entero**. En `false`, Auth responde `422 email_provider_disabled` a cualquier
  `signInWithOtp`, **incluido el de un usuario que ya existe**: apaga el magic
  link, que es la única puerta a `/admin`. No confundir con
  `[auth].enable_signup` (`GOTRUE_DISABLE_SIGNUP`), que es otro interruptor
  distinto — y que **hoy está en `true`**: ver la allowlist de registro.
- **La allowlist de registro no se configura sola en el proyecto hosted.** El
  hook `before_user_created` de `config.toml` aplica SOLO al stack local; en
  producción se registra en Authentication → Hooks del dashboard. Si acá está
  prendido y allá no, producción queda con `enable_signup = true` y sin
  allowlist, o sea con el registro abierto.
- **`config.toml` no se relee con `db reset`.** Los cambios de `[auth.*]` piden
  `npx supabase stop && npx supabase start`. Verificalo con
  `docker inspect supabase_auth_burger-shop` en vez de asumir que aplicó.
- **UPDATE en RLS necesita también policy de SELECT**, y `USING` + `WITH CHECK`.
- **Teléfonos**: el `15` de celular solo se saca si sobran dígitos. En Córdoba
  (351) el "15" aparece dentro del número real y sacarlo lo destruye.
- **La región de Supabase es inmutable.** El proyecto va en São Paulo
  (`sa-east-1`); las funciones de Vercel en `gru1` para no cruzar el continente.
