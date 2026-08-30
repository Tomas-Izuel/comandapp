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
| React | 19.2.8 |
| Tailwind | v4 (config en CSS, no en JS) |
| shadcn/ui | base `radix`, preset Nova. Componentes en `src/components/ui/` |
| Zod | v4 — `z.url()`, no `z.string().url()`. Los errores son `error.issues` |
| Supabase | Postgres 17 + Auth + Storage. `@supabase/ssr` 0.12, `supabase-js` 2.112. Local en `127.0.0.1:54321` |
| Pagos | Mercado Pago Checkout Pro (`mercadopago` 3.4) |
| Mail | Resend 6 + `@react-email/components` 1 (las plantillas son TSX) |
| Tests | vitest 3.2. Node ≥ 20.9, npm 11 |

Las que aparecen en la UI y conviene conocer antes de agregar una alternativa:
`react-hook-form` + `@hookform/resolvers` (todos los formularios), `recharts`
(gráficos del dashboard), `leaflet` (mapa del local en Ajustes), `@dnd-kit/core`
(reordenar el catálogo), `vaul` (la hoja del producto), `sonner` (toasts),
`lucide-react` (íconos).

## Comandos

```bash
npm run dev            # Next en :3000
npm run build
npm run typecheck      # tsc --noEmit
npm run lint
npm start              # servidor de producción, después de build
npm test               # vitest. Los tests de tests/db/ se saltean sin Docker.
npm run test:watch     # vitest en watch

npm run db:start       # levanta el stack local (necesita Docker)
npm run db:reset       # RESET TOTAL: migraciones + seed + tipos + usuarios
npm run db:reset -- --orders   # lo mismo + 5 pedidos de prueba para QC
npm run db:bootstrap   # solo recrear usuarios (idempotente)
npm run db:types       # regenerar database.types.ts
npm run db:stop

npm run resend:setup   # valida key, dominio y remitente; --enable toca el SMTP
```

## Variables de entorno

`.env.example` está comentado en detalle; acá van solo las que sorprenden.

| Variable | Qué hace |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Origen del **apex**, siempre. Nunca el de una tienda: de acá se derivan el link del panel y el subdominio de cada local |
| `NEXT_PUBLIC_STORE_HOST_MODE` | `path` (default) o `subdomain`. Solo cambia cómo se **generan** las URLs, no el routing |
| `RATE_LIMIT_ENABLED` | Kill-switch del limitador. Solo el literal `false` apaga |
| `CREDENTIALS_ENCRYPTION_KEY` | AES-256 en base64. Cifra las credenciales de MP **y** firma el `subject` de los baldes de rate limiting |
| `CRON_SECRET` | Lo comparan los handlers de cron en tiempo constante. También vive en Vault, para pg_cron |
| `PLATFORM_ADMIN_GOOGLE_EMAIL` | Solo si tu cuenta de Google difiere de `DEV_EMAIL`. Google devuelve la dirección canónica, así que sembrar la versión con `+admin` no matchea nunca y el síntoma es un 403 mudo |
| `DEV_EMAIL` | Tu casilla real. El bootstrap deriva `vos+admin@…` y `vos+dueno-la-birra@…` |

**No hay credenciales de Mercado Pago en el entorno**: son por tienda, cifradas
en `store_payment_credentials`. Lo único global es la clave que las cifra.

**Cuidado con qué archivo lee cada cosa.** `next dev` lee `.env.local`; el CLI de
Supabase, que es quien sustituye los `env(...)` de `config.toml`, no lo lee igual.
Las variables de Google hacen falta en los dos lados por eso mismo.

---

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
  services/     Adapters externos detrás de interfaces (MP, WhatsApp, POS, geocoding).
  lib/          Clientes Supabase, dinero, color, tema, utils.
  emails/       Plantillas de mail en TSX (react-email).
```

Rutas de nivel raíz que **no** cuelgan de `/[store]`, y el motivo:

| Ruta | Qué es |
|---|---|
| `/mis-pedidos` | Pública, sin auth. Lista lo que hay en el `localStorage` del cliente. Cada fila puede ser de otra tienda, así que resuelve el base path fila por fila contra el `Host` |
| `/pedido/[token]` | Seguimiento de UN pedido. Lo único que autoriza es el token |
| `/repartidor` | Portal del repartidor. El gate está en `page.tsx` y **no** en `layout.tsx`: el layout envuelve también `/repartidor/acceso` y ahí sería un loop de redirects |
| `/legal/terminos`, `/legal/privacidad` | Públicas y estáticas. Son de la **plataforma**, no de un local, así que no llevan tema de marca. La de privacidad describe el comportamiento real: si cambian las claves de `localStorage`, el proveedor de pago o el de email, queda desactualizada |

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
ready      → delivered | on_the_way | preparing | cancelled
on_the_way → delivered | ready | cancelled
delivered  → terminal
cancelled  → terminal
```

`ALLOWED_TRANSITIONS` en `order.schema.ts` es la fuente única en TypeScript; la
UI la importa para no ofrecer botones que van a fallar. El CHECK de la tabla
valida que el estado *exista*; esto valida que se pueda *llegar* ahí.

`on_the_way` es el tramo de delivery y tiene **dos guardas en el trigger** que no
son de estado: el pedido tiene que ser `delivery_method = 'delivery'` **y** tener
`courier_id`. `ready → delivered` se mantiene igual, porque es el camino de todo
pedido de retiro y el de un delivery que el cliente termina pasando a buscar.

En `ALLOWED_TRANSITIONS`, el orden del array de `ready` **no es cosmético**: el
KDS elige el botón primario con un `.find()` sobre él, así que `delivered` va
primero para que un pedido de retiro no ofrezca "Salió a repartir".

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
| `stores` | Todo **menos** `id`, `slug`, `status`, `created_at`, `updated_at`, `courier_collects_payment` y `online_payment_enabled` |
| `orders` | **Solo** `status`. El ciclo del dinero, y la asignación de repartidor, son del servidor |

Los grants de `stores` se fueron otorgando **columna por columna** en varias
migraciones (`hardening`, `auto_advance`, `store_links`, `store_coordinates`,
`delivery`), así que la lista de lo permitido está repartida: para saber si una
columna nueva es escribible desde el browser hay que buscar su `grant update`,
no asumirlo. Dos casos que quedaron **fuera a propósito**:

- `courier_collects_payment` se otorgó con el resto del bloque de delivery y se
  **revocó después** (`20260829000433_...`): decide si el repartidor cobra en la
  puerta, o sea que es política de caja. Hoy se cambia solo por
  `service_role`, detrás del flujo de confirmación por código.
- `online_payment_enabled` **nunca** se otorgó: es una columna derivada que
  mantiene un trigger, no un flag que el local prenda.

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
- `private.sync_store_online_payment` — mantiene `stores.online_payment_enabled`
  en sync con el access token de Mercado Pago. Es una columna **derivada**: la
  fuente de verdad sigue siendo `store_payment_credentials`, que no tiene un
  solo grant para `anon` ni `authenticated` (ahí vive el token, cifrado). El
  flag existe porque la vitrina necesita responder "¿esta tienda puede cobrar
  online?" sin acercar el secreto al borde. **No tiene `grant update` para
  `authenticated`**, igual que `status` y `slug`.

  El corolario está en `src/lib/store-availability.ts`: una tienda `active` y
  con `accepting_orders = true` puede igual no tener **ningún** medio de pago
  —ni Mercado Pago ni pago al retirar— y ése es el estado por defecto de todo
  local recién dado de alta. `canTakeOrders()` es el gate real de la vitrina;
  `acceptingOrders` solo dice qué decidió el dueño.

### RPCs: lo que no se puede hacer desde la app

Todas viven en `public` (PostgREST solo expone schemas configurados), son
`SECURITY DEFINER`, y **cada una revoca `EXECUTE` de `public, anon` y lo otorga
explícitamente**: Postgres le da EXECUTE a PUBLIC por defecto a toda función
nueva, así que una `SECURITY DEFINER` en `public` sin revoke es un endpoint
abierto. Las que atiende un usuario logueado verifican el permiso **en el
cuerpo** (`is_store_member` / `is_platform_admin`).

Son **17**. Las que importan:

| RPC | Para | Por qué no en TS |
|---|---|---|
| `create_order` | service_role | Atomicidad: cabecera + ítems + opciones en una transacción |
| `store_dashboard`, `platform_metrics`, `platform_stores` | authenticated | PostgREST corta en `max_rows` (1000) **sin error**: agregar en TS truncaba la facturación en silencio |
| `claim_event_deliveries`, `settle_event_delivery` | service_role | `for update skip locked`: sin eso dos crons entregan duplicado |
| `claim_order_events`, `settle_order_event` | service_role | Outbox previo al fan-out por endpoint. Siguen vivas |
| `expire_pending_orders`, `cleanup_old_records`, `advance_auto_orders` | service_role | Barrido masivo |
| `consume_rate_limit` | service_role | Incremento atómico del balde. La ventana la calcula Postgres, no el llamador |
| `claim_store_pending_change` | service_role | Consumir el código de 6 dígitos y contar el intento en la misma transacción |
| `courier_queue`, `courier_advance_order` | authenticated | **El repartidor no tiene ni un grant sobre `orders`.** Todo su acceso pasa por acá, filtrado por `auth.uid()` |
| `store_couriers` | authenticated | Padrón + métricas del dueño. Verifica `is_store_owner()` en el cuerpo |
| `store_courier_availability` | **service_role** | La llama el checkout anónimo para cotizar el ETA, con el admin client |

**Ojo con `store_couriers` y `store_courier_availability`, que parecen la misma
familia y no lo son.** La primera se llama con el cliente **de sesión**: es
`SECURITY DEFINER` pero verifica `is_store_owner()` leyendo `auth.uid()`, que con
`service_role` no existe, así que llamarla con el admin client falla siempre. La
segunda es al revés, y por eso es la única de courier que no le llega a
`authenticated`.

Varias se **redefinieron** en migraciones posteriores (`create_order` en la de
delivery, `platform_stores` cinco veces, `cleanup_old_records` cuatro). La
vigente es la de la migración más nueva; buscar la primera definición y editarla
es un cambio que no se aplica.

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
| `/api/cron/cleanup` | diario, 04:30 UTC | **Vercel Cron** | Retención de `order_events`, `platform_audit_log`, `rate_limits` y `store_pending_changes` |

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

## Rate limiting

Baldes de ventana fija en Postgres (`rate_limits`), no en memoria del proceso: en
Vercel cada instancia tiene su propia memoria, así que un limitador en RAM no
limita nada. La tabla tiene RLS prendida y **cero policies**, con `grant` solo
para `service_role`; todo pasa por la RPC `consume_rate_limit`, que incrementa
con `insert ... on conflict do update` y **calcula la ventana adentro** — el
llamador nunca manda `window_start`.

**`subject` es siempre un HMAC**, nunca el valor crudo. `hashSubject()` en
`rate-limit.model.ts` normaliza (`trim().toLowerCase()`) y firma con
`CREDENTIALS_ENCRYPTION_KEY`. Sin esa clave tira, no degrada: un balde que no
puede identificar al sujeto no es un balde.

Los límites viven todos juntos en `src/lib/rate-limit-policy.ts`:

| Balde | Límite | Dónde |
|---|---|---|
| `magic_link:email` / `:email:day` / `:ip` / `:global` | 2/15min · 5/24h · 10/15min · 15/1h | `admin.actions.ts` |
| `lookup:ip` | 20/60s | `/api/orders/lookup` |
| `order:idempotency` / `order:phone` / `order:store` | 1/10min · 5/10min · 300/10min | `/api/orders` |
| `courier_invite:store` / `:email` | 10/1h · 3/1h | `staff.actions.ts` |
| `owner_invite:store` / `:admin` | 5/1h · 20/1h | `platform.actions.ts` |
| `payment_change:store` | 3/1h | `admin.actions.ts` |
| `support:store` / `:day` | 1/2min · 10/24h | `admin.actions.ts` |

**Fail-open es el default, y las excepciones tienen motivo.** Casi todos los
baldes protegen operaciones que igual necesitan Postgres, así que si la base no
responde negar el pedido no protege nada y sí corta ventas. Van **fail-closed**
los cuatro de `magic_link:*` —Supabase Auth es un servicio aparte que puede
seguir mandando mails aunque nuestra base esté caída, y ahí se queman los 30
mensajes/hora del proyecto entero— y `payment_change:store`, que toca las
credenciales de cobro.

Dos baldes que **no devuelven 429** y no es un bug: `order:store` se consume y
solo loguea (es un termómetro del local, no un freno a sus ventas), y
`order:idempotency` bloqueado significa "esto es un reintento del mismo pedido",
así que saltea los otros baldes y sigue al camino normal, que ya es idempotente.
El catálogo y la cotización (`GET /api/orders`) **no tienen límite de
aplicación** a propósito: eso es trabajo del WAF.

`Retry-After` lo calcula Postgres como los segundos que faltan para que rote la
ventana, viaja en `RateLimitError.retryAfterSeconds` y sale como header,
clampeado a un mínimo de 1 (`Retry-After: 0` no es válido). En Server Actions no
hay header: se humaniza el texto con `humanizeRetryAfter()`, que está
**triplicado** a propósito en los tres archivos de acciones, porque un
`.actions.ts` solo puede exportar funciones async.

**Kill-switch**: `RATE_LIMIT_ENABLED`. Solo el literal `'false'` apaga; vacío o
cualquier otra cosa deja el limitador prendido. Apagado devuelve `remaining =
limit`, no `Infinity` — `JSON.stringify(Infinity)` es `null` y eso rompía al
cliente. Es para una urgencia (una calibración cortando ventas reales), no para
desarrollo.

La limpieza no tiene cron propio: es un borrado más dentro de
`cleanup_old_records`, a un día.

---

## Modelo de datos

21 tablas en `supabase/migrations/`. Convenciones: `bigint identity` como PK,
centavos, `timestamptz` siempre, snake_case, índice en **toda** FK.

- **Plataforma**: `platform_admins`, `platform_audit_log`, `signup_allowlist`
- **Tienda**: `stores`, `store_branding`, `store_members`, `store_payment_credentials`
- **Catálogo**: `categories`, `products`, `option_groups`, `options`
- **Pedidos**: `orders`, `order_items`, `order_item_options`, `payments`
- **Integración**: `order_events` (outbox), `order_event_deliveries` (un intento
  por endpoint POS), `notifications`, `pos_endpoints`
- **Operación**: `rate_limits` (baldes; `subject` es un HMAC, nunca el valor
  crudo), `store_pending_changes` (cambios sensibles esperando confirmación)

**El delivery no agregó ni una tabla**: son columnas sobre `stores`, `orders` y
`store_members`. Buscar una tabla `couriers` o `deliveries` no lleva a ningún
lado.

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
```
retiro:    pending → confirmed → preparing → ready → delivered
delivery:  pending → confirmed → preparing → ready → on_the_way → delivered
```
(+ `cancelled` desde cualquier estado no terminal.)

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

## Delivery y repartidores

Opt-in por tienda (`stores.delivery_enabled`). Todo el envío son **columnas**
sobre tablas que ya existían: siete en `stores` (tarifa, mínimo, gratis desde,
minutos normales, minutos con la flota ocupada, si el repartidor cobra), tres en
`store_members` (`display_name`, `is_active`, `invited_at`) y diez en `orders`
(`delivery_method`, `delivery_fee_cents`, la dirección desglosada, los minutos de
viaje congelados, `courier_id`, `assigned_at`, `on_the_way_at`).

**Tarifa plana por tienda: no hay zonas ni distancia.** `src/lib/delivery.ts` es
un módulo puro y **sin `server-only` a propósito**, para que la misma función que
cotiza en el formulario de Ajustes sea la que cobra en el servidor. El browser
manda método y dirección, nunca un costo: `createOrder` recalcula el fee desde
cero. El mínimo se evalúa sobre el **subtotal**, no sobre el total con envío —
cobrar el envío para llegar al mínimo que habilita el envío es circular.

Que la flota esté ocupada **alarga el ETA pero no apaga el delivery**
(`allCouriersBusy` nunca toca `available`): decisión de producto, un local
prefiere un pedido que tarda a un pedido que no entra.

### El repartidor no puede leer `orders`

Ni una policy, ni un grant, **ni siquiera SELECT**. Todo su acceso es
`courier_queue()` y `courier_advance_order()`, dos `SECURITY DEFINER` que filtran
por `auth.uid()`. `courier_advance_order` acepta exactamente dos destinos
(`on_the_way`, `delivered`) y hace `for update` + predicado de estado en el
UPDATE, así que dos toques simultáneos dan `40001` en vez de pisarse.

**Consecuencia directa: a la cola del repartidor no le llega Realtime.** La
publicación es sobre `public.orders` y Realtime respeta RLS, así que el canal
dice `SUBSCRIBED` y no dispara nunca. El portal va con **polling cada 20s**, y
ése es el único camino de refresco — si alguien "arregla" el polling poniendo
Realtime, la pantalla deja de actualizarse en silencio.

La asignación de repartidor es del servidor: `courier_id` no está en el grant de
columnas de `orders`, así que va con `createAdminClient()` detrás de
`requireStoreMembership`. Y el update lleva `.eq('store_id', storeId)` explícito:
el trigger valida que el repartidor sea de la tienda, pero no que el **pedido** lo
sea, y ahí corre el admin client.

Un repartidor se **desactiva**, nunca se borra: `courier_id` es
`ON DELETE SET NULL` y borrar la fila pierde el rastro contable de quién entregó
qué.

### Detalles que se pagan caro

- **Un delivery que llega a `ready` no avisa nada.** El "ya está listo" es para
  retiro; el aviso del delivery es `order_on_the_way`, y lo dispara el repartidor
  al salir. Avisar en `ready` manda al cliente a buscar un pedido que va camino a
  su casa.
- **`orders_total_is_subtotal_plus_delivery_check`** es la red contra la trampa
  de abajo: `total = subtotal + delivery_fee`. Convierte "envío regalado en
  silencio" en un `23514`.
- **La cascada de columnas enumeradas a mano.** `create_order`, `store_couriers` y
  `platform_stores` enumeran columnas una por una. Una columna nueva de pedido que
  no se agregue en las tres **desaparece sin error**.
- Las métricas del padrón cortan "hoy" por el **timezone del local**, no UTC: un
  turno de hamburguesería cruza la medianoche UTC y el arqueo quedaría partido en
  dos días.
- `avgDeliveryMinutes` mide `delivered_at - on_the_way_at`, no desde la creación,
  y excluye los pedidos sin `on_the_way_at` en vez de contarlos como cero.
- El KDS usa `listCouriersForAssignment` y **no** la RPC `store_couriers`: esa
  exige ser dueño y el KDS lo opera cualquier staff.

---

## Cambios sensibles: confirmación por código

Cambiar el access token de Mercado Pago redirige **todos** los cobros online del
local, y `courier_collects_payment` decide si el repartidor maneja efectivo. La
única guardia era tener la sesión abierta, o sea una tablet olvidada en el
mostrador.

`store_pending_changes` mete un segundo factor puntual: el dueño pide el cambio,
recibe un código de 6 dígitos **en el email de `auth.users`** —nunca en uno que
venga del request— y lo confirma. Se guarda el HMAC del código, no el código; el
TTL es de 10 minutos; los intentos se cuentan **en la base** (máximo 5) dentro de
`claim_store_pending_change`, porque contarlos en la app pierde la carrera. El
payload viaja como `jsonb` con los secretos ya cifrados en AES-256-GCM.

Lo aprueba el **mismo dueño que lo pidió** (`requested_by` tiene que coincidir),
no la plataforma: es una confirmación de identidad, no una escalación de permiso.

---

## Geocoding

Nominatim / OpenStreetMap, sin API key ni facturación
(`src/services/geocoding/`), detrás del puerto `Geocoder` como todo servicio
externo. Es `server-only` porque la política de uso exige `User-Agent` propio, va
con timeout de 5s, `countrycodes=ar`, cache de un día y validación Zod por
elemento (`lat`/`lon` llegan como string). **Ante cualquier error devuelve `[]`,
nunca tira.**

Lo usa un solo lugar: el mapa de `/admin/ajustes`, detrás de
`requireStoreMembership` para que la Server Action no sea un proxy de geocoding
abierto. Y el resultado es una **propuesta**: lo que se persiste en
`stores.latitude/longitude` es el pin que el dueño confirma, no lo que devolvió
el geocoder.

---

## Subdominio por local

**Implementado.** `la-birra.comandapp.ar` en vez de `comandapp.ar/la-birra`, con
la URL **enmascarada**: es un rewrite interno, nunca un redirect.

**El rewrite NO vive en `proxy.ts`.** Vive en `next.config.ts`, en la fase
`beforeFiles` de `rewrites()`. `proxy.ts` sigue haciendo solo lo que hacía:
refrescar la sesión de Supabase, cero lógica de host. Los dos motivos son que
`beforeFiles` es la única fase que pisa un archivo de página real, y que una tabla
de rewrites es **dato**, o sea testeable en CI sin levantar un servidor
(`tests/lib/next-config-routing.test.ts`).

```
la-birra.comandapp.ar/carrito  →  sirve internamente  /la-birra/carrito
```

**Todo el gating es por el header `Host`, nunca por variable de entorno.** El
dominio está hardcodeado en `next.config.ts` a propósito: ese archivo se evalúa
antes de que Next cargue los `.env`. Como en `localhost` y en `*.vercel.app` el
host nunca matchea `comandapp.ar`, el rewrite y los redirects quedan **inertes
solos**, sin un `if` de entorno. Por eso el path-based sigue funcionando y los
preview deployments —que el wildcard no cubre— se prueban igual que siempre.

El rewrite es una **allowlist de cuatro rutas** (`/`, `/carrito`, `/checkout`,
`/producto/:id`), no un catch-all. `/pedido/*` y `/mis-pedidos` quedan afuera
adrede: el `localStorage` del cliente es por origen, así que un pedido guardado
desde el apex no se ve desde el subdominio.

Hay además redirects 308 en los dos sentidos: del apex al subdominio para esas
mismas cuatro formas, y del subdominio al apex para `/admin/*`, `/backoffice/*` y
`/repartidor/*`.

### El panel vive en el apex, y ahora es el runtime el que lo garantiza

`comandapp.ar/admin`, `comandapp.ar/backoffice` y `comandapp.ar/repartidor`. Los
subdominios de tienda sirven **solo tráfico anónimo**, y los tres redirects de
arriba lo fuerzan en vez de dejarlo como convención.

El motivo es de seguridad. Si el panel viviera en `la-birra.comandapp.ar/admin` y
alguien alguna vez scopeara la cookie de sesión al dominio padre
(`.comandapp.ar`), **cualquier local podría leer la sesión de cualquier otro**.
Estamos a salvo por defecto —`@supabase/ssr` no setea el atributo `domain`, así
que las cookies quedan host-only— pero es una línea de código de distancia del
desastre. Con el panel en el apex el error deja de ser posible, en vez de quedar
prohibido.

### Las dos variables NO controlan el routing

`NEXT_PUBLIC_SITE_URL` (siempre el origen del **apex**, nunca el de una tienda) y
`NEXT_PUBLIC_STORE_HOST_MODE` (`path` | `subdomain`, default `path`) deciden
únicamente **cómo se generan** las URLs en `src/lib/urls.ts`. El routing es puro
`Host`. Son dos mecanismos distintos y conviene tenerlo presente: con el DNS
wildcard vivo y el modo en `path`, los 308 siguen mandando al subdominio mientras
las URLs emitidas apuntan al apex. No rompe nada, pero agrega un salto.

`NEXT_PUBLIC_STORE_HOST_MODE` **solo se setea en Production**, y recién cuando el
wildcard esté con el DNS en Vercel. En local y en Preview no se toca.

En `urls.ts`: `apexUrl()` para todo lo que es panel, magic link, `notification_url`
de Mercado Pago e invitaciones; `storeUrl(slug, path)` para lo que es vitrina;
`storeBasePath(slug, host)` para los hrefs internos, que devuelve `''` o
`/${slug}` según desde dónde se esté sirviendo. El apex **no** está hardcodeado
ahí: se deriva del hostname de `NEXT_PUBLIC_SITE_URL`.

### Slugs reservados

`RESERVED_SLUGS` en `platform.schema.ts` dejó de ser una lista de paths y pasó a
ser una lista de **hostnames** (mail, DNS, entornos, CDN, identidad,
observabilidad, marca). Está espejada en el CHECK `stores_slug_not_reserved_check`
y hay un test de paridad (`tests/db/reserved-slugs-parity.test.ts`) que falla si
las dos listas se separan. Si agregás uno, va en los dos lados.

Con path-based un slug como `admin` era un bug menor —el segmento estático de
Next gana y esa tienda queda inalcanzable—; con subdominios es secuestro de ruta.

### Lo que falta, y es de infra

1. **El SSL wildcard exige los nameservers en Vercel.** Para emitir
   `*.comandapp.ar` automáticamente, Vercel necesita controlar el DNS. Si el DNS
   se queda en NIC.ar hay que cargar un CNAME por tienda a mano — justo lo que el
   wildcard venía a evitar.
2. **El dominio `.ar`**: `.com.ar` lo registra NIC.ar y pide CUIT/CUIL argentino.
   Verificar con ellos las reglas vigentes del segundo nivel `.ar` directo.

**El flujo local con subdominios quedó fuera de alcance**, por decisión del dueño
del producto: en desarrollo se usa el path-based (`localhost:3000/<slug>`). No hay
`/etc/hosts` ni hosts locales. La consecuencia a aceptar con los ojos abiertos es
que el camino de subdominio **no se ejerce en local**: se cubre con los tests de
la tabla de routing, no probándolo a mano.

### Lo que habilita después

Dominio propio por local (`labirra.com.ar` apuntando a la app). Es el mismo
rewrite buscando por dominio en vez de por subdominio, más una columna
`stores.custom_domain`. Es el upsell natural del SaaS.

---

## Cuatro niveles de acceso

| Quién | Dónde | Cómo entra | Qué puede |
|---|---|---|---|
| Cliente | `/[store]`, `/pedido/[token]`, `/mis-pedidos` | Nada | Ver catálogo, comprar, seguir SU pedido |
| Repartidor | `/repartidor` | Magic link, **por invitación del local** | Solo su cola de reparto |
| Staff del local | `/admin` | Magic link, **por invitación** desde el backoffice | Todo lo de SU tienda |
| Plataforma | `/backoffice` | **Google** o contraseña, + **TOTP** siempre | Crear/suspender tiendas, métricas globales |

`store_members.role` es `owner | staff | courier`, y **`courier` no es staff**:
`private.is_store_member()` se endureció a `role in ('owner','staff')`, así que un
repartidor no entra a `/admin` ni puede leer con el cliente de sesión ni su
propia fila de `store_members`. Hay una función aparte, `private.is_store_courier()`,
que además exige `is_active`.

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

`store_branding.density` (`compact | cozy | roomy`, default `cozy`) decide cuánto
aire respira la carta: multiplica `--spacing`, o sea el ritmo entero de Tailwind
dentro de la tienda. **`compact` es 1×, no menos**, así que la densidad solo
agranda y ningún local puede apretar el layout por debajo del piso de calidad
eligiendo un valor. Lo único que además cambia es `--catalog-cols`: `compact`
pone la carta en dos columnas.

### Vista previa de marca

`/[store]?preview=brand` embebido en un iframe desde `/admin/apariencia`, con
`postMessage` para pintar los cambios sin guardar. **No lleva auth, y puede no
llevarla porque el modo preview solo QUITA capacidad**: deshabilita hacer el
pedido. Un modo que solo resta no es una escalación.

La marca se persiste en `sessionStorage` únicamente si `window.self !== window.top`,
para sobrevivir a las navegaciones internas que pierden el query param sin
filtrarse a una pestaña normal. Los redirects apex→subdominio excluyen los
requests con `?preview`, porque si no el iframe se rompe.

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
| Todo el resto | La app, por la API de Resend | `src/emails/` (plantillas) + `src/services/notifications/email/` (envío) |

Son **ocho** plantillas, no dos, y van por dos canales distintos. Las que
pertenecen a un pedido pasan por el puerto `EmailSender` y **dejan fila en
`notifications`** (necesitan `order_id`):

1. `order-receipt` — comprobante al confirmarse el pedido.
2. `order-ready` — pedido listo para retirar. Un delivery **no** lo recibe.

Las otras seis no tienen pedido, así que no dejan fila:

3. `store-owner-invite` — alta o reenvío del dueño desde el backoffice.
4. `store-courier-invite` — invitación o reposición de link al repartidor.
5. `store-payment-change-code` — el código de 6 dígitos del cambio sensible.
6. `store-payment-change-notice` — "alguien pidió este cambio", informativo.
7. `store-payment-support` — pedido de soporte desde la pantalla de Pagos.
8. `_shared` — no es una plantilla, son los bloques comunes.

**`store-payment-change-code` es la única que tira en vez de degradar.** Todas
las demás devuelven `skipped` sin `RESEND_API_KEY`, porque un mail que no sale no
puede romper un pedido pagado. Ésa no: es un segundo factor, y un segundo factor
que "se saltea en silencio" no es un segundo factor.

El comentario de `email.port.ts` que dice "dos plantillas nada más" es cierto
**para ese puerto** y engañoso a nivel carpeta.

**La idempotencia del mail de invitación deriva del hash del `inviteUrl`, no del
`courierId`.** Una clave por entidad hace que Resend devuelva
`409 invalid_idempotent_request` en la segunda invitación al mismo repartidor —
verificado contra la API real.

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

### Cada tanda deja rastro en `docs/pipelines/`

Una carpeta por corrida, nombrada `<fecha>-<feature>`, con un archivo por etapa:

```
docs/pipelines/2026-08-29-subdominio-por-local/
  00-architecture.md   el plan del feature-planner: problema, pushback,
                       alternativas, decisión. Se aprueba ANTES de repartir.
  01-tasks.md          el corte en slices, con el dueño de cada archivo.
  02-development-*.md  un archivo por agente/slice. Lo escribe el agente.
  03-review.md         el veredicto del code-reviewer.
  03-tests.md          el informe del test-engineer.
```

No es burocracia: `00-architecture.md` es donde queda escrito **por qué** se
descartó lo otro, y es lo que evita reabrir una decisión ya tomada tres semanas
después. Cuando una decisión de ahí se vuelve permanente, sube a este archivo;
el pipeline guarda el razonamiento completo, CLAUDE.md guarda la conclusión.

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

## Trampas conocidas

- **Next 16 renombró `middleware.ts` a `proxy.ts`.** El viejo nombre no se carga.
  Y `proxy.ts` **no hace routing**: el rewrite por host vive en `next.config.ts`.
- **`next.config.ts` se evalúa ANTES de que Next cargue los `.env`.** Por eso el
  dominio está hardcodeado ahí y el gating es por header `Host`, no por variable.
  Una `process.env` en ese archivo llega vacía y el síntoma es un rewrite que
  nunca matchea.
- **Realtime respeta RLS, así que un canal sin permiso de SELECT no falla: se
  queda mudo.** Dice `SUBSCRIBED` y no dispara nunca. Es exactamente lo que pasa
  con la cola del repartidor, que por eso va con polling.
- **`create_order`, `store_couriers` y `platform_stores` enumeran las columnas a
  mano.** Una columna nueva de pedido que no se agregue en las tres desaparece
  **sin error**. El CHECK `total = subtotal + delivery_fee` existe justamente
  para que ese olvido explote en vez de regalar el envío en silencio.
- **Varias RPC están redefinidas en migraciones posteriores.** `platform_stores`
  cinco veces, `cleanup_old_records` cuatro, `create_order` y `store_couriers`
  dos. Editar la primera definición no cambia nada: manda la más nueva.
- **`store_couriers` se llama con el cliente de SESIÓN, no con el admin.** Es
  `SECURITY DEFINER` pero verifica `is_store_owner()` leyendo `auth.uid()`, que
  con `service_role` no existe: con el admin client falla siempre.
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
