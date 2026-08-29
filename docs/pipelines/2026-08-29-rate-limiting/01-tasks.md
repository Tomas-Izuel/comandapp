# Rate limiting — desglose de tareas

Pipeline: `2026-08-29-rate-limiting` · Etapa 01 · **Consume `00-architecture.md`. Nada arranca sin aprobación.**

---

## Mapa de propiedad de archivos

El corte es por directorio y **es disjunto**. Dos agentes sobre el mismo archivo se
pisan sin aviso.

| Archivo | Dueño exclusivo |
|---|---|
| `supabase/migrations/**` | **T0 — hilo principal.** Ningún agente. |
| `src/models/types.ts` | **T1 — hilo principal**, antes de repartir. |
| `src/lib/errors.ts`, `src/lib/rate-limit-policy.ts`, `src/models/rate-limit.model.ts` | T2 |
| `src/app/api/orders/route.ts`, `src/app/api/orders/lookup/route.ts`, `src/app/api/orders/[token]/route.ts` | T3 |
| `src/controllers/admin.actions.ts`, `src/controllers/staff.actions.ts`, `src/controllers/platform.actions.ts`, `src/models/courier.model.ts`, `src/models/platform.model.ts` | T4 |
| `next.config.ts`, `src/views/admin/catalogo/image-upload.ts` | T5 |
| `src/views/admin/acceso/request-link-form.tsx`, `src/views/courier/request-link-form.tsx`, `src/views/storefront/checkout-form.tsx`, `src/views/admin/repartidores/invite-courier-form.tsx`, `src/views/admin/shared/confirm-with-code.tsx`, `src/views/backoffice/store-detail.tsx` | T6 |
| Config de plataforma (Vercel WAF, dashboard de Supabase) | **T7 — hilo principal + usuario.** Sin código. |
| `tests/**` | **T8 — `test-engineer`.** Nadie más. |

**T5 es dueño de `src/views/admin/catalogo/image-upload.ts`, T6 NO lo toca.** Es el
único archivo de `views/` que no es de T6 y el único punto de colisión posible.

> **Contexto de plan (leer antes de empezar cualquier tarea): Hobby en Vercel, Free en
> Supabase.** Eso significa tres cosas operativas: **(a) el WAF tiene un solo tiro de
> rate limit**, así que la capa de aplicación es la defensa principal y no el
> complemento; **(b) al exceder un límite de Hobby no hay factura, hay corte de hasta 30
> días**, así que prevenir es la única palanca; **(c) los crons de Vercel no funcionan en
> Hobby** — el scheduler es pg_cron desde Supabase y **ninguna tarea puede apoyarse en
> `vercel.json`**. Todo está justificado en §5.7 de `00-architecture.md`.

Paralelismo: **T2 y T5 arrancan juntos.** T3, T4 y T6 esperan a T2. T7 es independiente
y puede ir en paralelo con todo. T8 va al final.

---

## T0 — Schema: tabla de baldes y RPC de consumo

**Lane**: `schema` · **Dueño**: hilo principal · **Ningún agente escribe esto.**

**Objetivo.** Dar un contador compartido, atómico y multi-tenant, con el mismo criterio
de privilegios que `store_pending_changes`.

**Qué tiene que contener la migración** (descrito, no escrito — ver §5.6 de
`00-architecture.md`):

- Tabla `public.rate_limits` con `bucket text`, `subject text` (**HMAC en hex, nunca el
  valor crudo**), `window_start timestamptz`, `count int not null default 0 check
  (count >= 0)`, **PK compuesta `(bucket, subject, window_start)`**.
- Índice btree en `window_start`, solo para que el barrido diario no haga seq scan.
- `enable row level security` **sin ninguna policy**; `revoke all from anon,
  authenticated`; `grant select, insert, update, delete to service_role` **explícito**
  (el `alter default privileges` debería alcanzar, pero el bug que documenta
  `20260825120500_grants.sql` es demasiado caro para asumirlo).
- RPC `public.consume_rate_limit(p_bucket text, p_subject text, p_window_seconds int,
  p_limit int)` → `(allowed boolean, count int, retry_after_seconds int)`:
  `security definer`, `set search_path = ''`, `window_start` calculado **adentro** de la
  función, incremento en **una sola sentencia** `insert ... on conflict ... do update
  set count = rate_limits.count + 1 returning count`.
- `revoke execute on function public.consume_rate_limit(...) from public, anon,
  authenticated` + `grant execute to service_role`.
- `create or replace` de `public.cleanup_old_records` (última firma vigente en
  `20260828235210_store_pending_changes.sql`) sumando el borrado de `rate_limits` con
  `window_start < now() - interval '1 day'`. **Ningún cron nuevo, y ninguno de Vercel**:
  en Hobby los crons son diarios y una expresión más frecuente falla el deploy, así que
  el scheduler es **pg_cron**. `cleanup_old_records()` es SQL puro, o sea que pg_cron la
  llama **directo, sin pg_net, sin HTTP y sin `CRON_SECRET`**. Una corrida diaria alcanza.
  La instalación de `pg_cron` (hoy disponible pero **no instalada**, confirmado por MCP) y
  el agendado son del hilo principal, coordinados con la migración de los otros crons.
- Regenerar `src/lib/supabase/database.types.ts` con `npm run db:types`.

**Criterios de aceptación** (todos exigen base real → `tests/db/`, ver T8):

1. `anon` y `authenticated` reciben `permission denied` al hacer `select`, `insert` o
   `update` sobre `rate_limits` vía PostgREST con la publishable key.
2. `anon` y `authenticated` reciben `permission denied` al llamar
   `rpc('consume_rate_limit', ...)`. `service_role` la ejecuta bien.
3. `consume_rate_limit` con `p_limit = 3` devuelve `allowed = true` en las 3 primeras
   llamadas y `allowed = false` en la 4ª, dentro de la misma ventana.
4. **N llamadas concurrentes con el mismo `(bucket, subject)` producen `count = N`
   exactamente** — una sola fila, sin pérdida por carrera. Es la invariante entera de
   la tarea: si esto falla, el limitador no existe.
5. Dos `subject` distintos con el mismo `bucket` no se pisan; dos `bucket` distintos con
   el mismo `subject` tampoco.
6. Al cruzar el borde de la ventana, el contador arranca de nuevo (`window_start`
   nuevo, fila nueva).
7. `cleanup_old_records` borra filas con `window_start` de hace más de un día y **deja
   intactas** las de la ventana actual, y sigue borrando `order_events` y
   `platform_audit_log` como antes (no romper la firma existente).

**Fuera de alcance**: `pg_cron`, particionado, cualquier policy de RLS.

**Skills obligatorias**: `supabase-postgres-best-practices`
(`.claude/skills/supabase-postgres-best-practices/references/`, en particular
`schema-constraints.md`, `query-partial-indexes.md`, `security-privileges.md`,
`lock-short-transactions.md`), `supabase`.

---

## T1 — Contratos

**Lane**: `shared` · **Dueño**: hilo principal, **antes** de despachar T2–T6.

**Objetivo.** Que los cinco agentes hablen el mismo vocabulario. Sin esto, cinco
agentes inventan cinco formas de `RateLimitDecision`.

**Qué se fija en `src/models/types.ts`** (solo tipos, sin runtime):

- `RateLimitBucket` — unión literal cerrada con los 12 buckets de la tabla de §5.3.
- `RateLimitDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number }`.

**Y se declara, escrito, la firma exacta que T3/T4 van a importar** (T2 la implementa,
nadie la reinventa):

```
// src/models/rate-limit.model.ts
consumeRateLimit(input: {
  bucket: RateLimitBucket
  subject: string          // valor CRUDO; el modelo lo hashea antes de tocar Postgres
  limit: number
  windowSeconds: number
}): Promise<RateLimitDecision>
```

```
// src/lib/errors.ts
class RateLimitError extends DomainError   // status 429 + retryAfterSeconds
```

```
// src/lib/rate-limit-policy.ts
RATE_LIMIT_POLICY: Record<RateLimitBucket, { limit: number; windowSeconds: number }>
```

**Criterio de aceptación**: `npm run typecheck` limpio con los tipos agregados y ningún
consumidor todavía.

---

## T2 — Núcleo de rate limiting

**Lane**: `backend` · **Agente**: `senior-backend-engineer`

**Dueño exclusivo de**: `src/models/rate-limit.model.ts` (nuevo),
`src/lib/rate-limit-policy.ts` (nuevo), `src/lib/errors.ts`.

**No tocar**: nada de `src/app/`, nada de `src/controllers/`, nada de `src/views/`,
`next.config.ts`, `supabase/**`, `tests/**`.

**Objetivo.** Una única puerta a los baldes, y un error 429 que encaje en el contrato de
errores que ya existe.

**Qué hace**:

1. `consumeRateLimit` en `src/models/rate-limit.model.ts`. Es un **modelo**, no un
   controller: es acceso a Postgres y nada más. Usa `createAdminClient()` y llama
   `rpc('consume_rate_limit', ...)`.
2. **El `subject` se hashea en Node antes de llegar a Postgres**, con HMAC-SHA256 vía
   `src/services/crypto/hmac.ts` y `CREDENTIALS_ENCRYPTION_KEY`, exactamente como
   `store_pending_changes.code_hash`. Normalizar antes de hashear (email en minúsculas
   y trim; teléfono en E.164) para que dos formas del mismo valor caigan en el mismo
   balde.
3. **Kill-switch**: si `RATE_LIMIT_ENABLED` está en `false`, devuelve
   `{ allowed: true, remaining: Infinity, retryAfterSeconds: 0 }` **sin tocar la base**.
   Va declarado en `src/lib/env.server.ts` (opcional, default `true`).
4. **Fail-open / fail-closed por parámetro, no por default**: la función acepta
   `onError: 'allow' | 'deny'` y el llamador decide. Si la RPC falla, loguea `error` y
   aplica lo que pidió el llamador. Nunca propaga el error de Postgres al cliente.
5. `RateLimitError extends DomainError` en `src/lib/errors.ts`, con `status = 429` y
   `retryAfterSeconds`. `toApiError` la reconoce y **devuelve también el header
   `Retry-After`** — hay que ensanchar el tipo de retorno de `toApiError` para poder
   llevar headers, sin romper a los llamadores actuales.
6. `RATE_LIMIT_POLICY` en `src/lib/rate-limit-policy.ts`, con los 12 buckets y sus
   números tal cual la tabla de §5.3 de `00-architecture.md`. **Este archivo no importa
   nada de red**: son constantes y punto.

**Contratos a honrar**: los tipos que fija T1. `DomainError` conserva su semántica
actual (mensaje = interfaz). `zodToApiError` no se toca.

**Criterios de aceptación**:

1. `consumeRateLimit` **nunca** manda a Postgres el email, el teléfono ni ningún valor
   crudo: lo que viaja como `p_subject` es siempre un hex de 64 chars. Verificable
   espiando el argumento de la llamada.
2. Normalización: `"  Foo@Bar.COM "` y `"foo@bar.com"` producen el **mismo** subject.
3. Con `RATE_LIMIT_ENABLED=false` no se hace ninguna llamada a Supabase.
4. Si la RPC tira, con `onError: 'allow'` devuelve `allowed: true` y loguea `error`;
   con `onError: 'deny'` devuelve `allowed: false`. En los dos casos **no** propaga la
   excepción.
5. Un `RateLimitError` pasado por `toApiError` da `status: 429`, el mensaje del dominio
   tal cual, y un header `Retry-After` con segundos enteros ≥ 1.
6. `toApiError` sobre un `DomainError` común y sobre un `Error` cualquiera se comporta
   **exactamente** como hoy (mensaje genérico + 500 en el segundo caso).

**Dependencias**: T1. Puede escribirse contra la firma de la RPC descrita en T0 antes de
que la migración exista.

**Fuera de alcance**: cablear ningún llamador. Eso es T3 y T4.

**Skills obligatorias**: `supabase`
(`.claude/skills/supabase/`), `context7` (MCP) antes de usar cualquier API de
`@supabase/supabase-js`, `vercel:nextjs` para el runtime de route handlers.

---

## T3 — Cablear el camino de pedidos

**Lane**: `backend` · **Agente**: `senior-backend-engineer`

**Dueño exclusivo de**: `src/app/api/orders/route.ts`,
`src/app/api/orders/lookup/route.ts`, `src/app/api/orders/[token]/route.ts`.

**No tocar**: `src/lib/errors.ts`, `src/models/rate-limit.model.ts`,
`src/controllers/**`, `src/views/**`, `next.config.ts`, `supabase/**`, `tests/**`.

**Objetivo.** Sacar el `Map` en memoria y poner los límites de negocio reales, sin
romper una sola venta.

**Qué hace**:

1. **Borrar el limitador en memoria completo** de `src/app/api/orders/route.ts`
   (`rateLimitBuckets`, `checkRateLimit`, el barrido oportunista del 1%). Es placebo y
   su comentario ya lo dice.
2. En `POST /api/orders`, **después** de que `createOrderSchema` valide (necesitamos el
   teléfono normalizado) y **antes** de `submitOrder`:
   - `order:phone` sobre `customerPhone`, `onError: 'allow'`. Si se excede →
     `RateLimitError` con *"Estás mandando pedidos muy seguido. Esperá un minuto y probá
     de nuevo."*
   - `order:store` sobre el `store_id`: **se consume y se loguea, pero NO bloquea nunca.**
     Un `log.warn` con `{ bucket, storeId, count }` cuando pasa el límite y sigue de
     largo. **Esto es deliberado y no es un olvido**: bloquear pedidos pagos de un local
     que está vendiendo bien es peor que cualquier abuso que este balde detecte.
   - **No se consume balde si la `idempotencyKey` ya existe.** Un reintento del mismo
     intento de compra —el caso que la idempotencia existe para proteger— no puede
     gastar cupo. Hay que resolver el orden con `submitOrder`/`createOrder` sin duplicar
     la búsqueda de la clave.
3. En `GET /api/orders` (cotización): **sin límite de aplicación.** Lo cubre el WAF. Es
   una lectura que dispara cada cambio de carrito y un round trip extra a Postgres por
   tecla es exactamente lo que no se quiere.
4. En `POST /api/orders/lookup`: consumir **`lookup:ip`** (20/60s), `onError: 'allow'`.
   **Bajó del WAF a la aplicación porque en Hobby no hay regla disponible** (§5.1). Es la
   única excepción a "no poner límites de aplicación en lecturas", y se justifica porque
   el endpoint acepta **50 tokens por request**: una query de rate limit que evita 50
   lookups es un cambio favorable.
5. En `GET /api/orders/[token]`: **sin límite**, riesgo aceptado explícitamente (§5.7) —
   el seguimiento poletea cada 5-60s y agregarle una query por request sería peor que el
   problema. Sí agregar `log.warn` cuando `getOrderByToken` devuelve `null` (token
   inexistente), con la IP truncada y **sin el token**: es el disparador que puede hacer
   que este riesgo se revise.
6. Todo 429 sale por `RateLimitError` + `toApiError`, con `Retry-After`.

**Contratos a honrar**: `consumeRateLimit` y `RateLimitError` de T2;
`createOrderSchema`/`orderLookupSchema` sin cambios; `toApiError`/`zodToApiError`
siguen siendo la única traducción a HTTP.

**Criterios de aceptación**:

1. `POST /api/orders` con el **mismo teléfono** más de 5 veces en 10 min devuelve
   **429**, con `Retry-After` y un mensaje en castellano que dice qué hacer.
2. El pedido nº 6 **no crea** fila en `orders` ni preferencia en Mercado Pago.
3. **N requests en paralelo con la misma `idempotencyKey` siguen produciendo un solo
   pedido y una sola fila** (la invariante existente no se rompe) **y consumen a lo sumo
   un cupo del balde**.
4. Superar `order:store` **no** devuelve 429: devuelve 201 y deja un `log.warn`.
5. Dos tiendas distintas no comparten balde: agotar `order:store` de la tienda A no
   afecta ni un pedido de la tienda B. **(Aislamiento multi-tenant — probar explícito.)**
6. Con `RATE_LIMIT_ENABLED=false`, `POST /api/orders` se comporta exactamente como antes
   del cambio.
7. Si la RPC de rate limit falla, el pedido **se crea igual** (fail-open) y queda un
   `log.error`.
8. `POST /api/orders/lookup` más de 20 veces en un minuto desde la misma IP devuelve 429.
9. Ningún log de este archivo contiene el teléfono, el email ni el `public_token`.

**Dependencias**: T2 (firma), T0 (para correr de verdad).

**Fuera de alcance**: tocar `checkout.controller.ts`, `order.model.ts` o la RPC
`create_order`. Si hace falta un cambio ahí para el punto 3, **se reporta, no se hace**.

**Skills obligatorias**: `vercel:nextjs` (route handlers, `after()`), `supabase`,
`context7` (MCP).

---

## T4 — Cablear los caminos de mail

**Lane**: `backend` · **Agente**: `senior-backend-engineer`

**Dueño exclusivo de**: `src/controllers/admin.actions.ts`,
`src/controllers/staff.actions.ts`, `src/controllers/platform.actions.ts`,
`src/models/courier.model.ts`, `src/models/platform.model.ts`.

**No tocar**: `src/app/**`, `src/views/**`, `src/lib/errors.ts`,
`src/models/rate-limit.model.ts`, `src/services/notifications/**`, `next.config.ts`,
`supabase/**`, `tests/**`.

**Objetivo.** Que ningún camino que provoca un mail quede sin límite, y que el magic
link deje de poder tirar abajo el acceso de todas las tiendas.

**Qué hace**:

1. **Magic link** (`requestMagicLinkAction`, `admin.actions.ts:106`): borrar
   `magicLinkAttempts` y `isMagicLinkThrottled`. Consumir, en orden,
   `magic_link:email` (**2/15min**), `magic_link:email:day` (**5/día**),
   `magic_link:ip` (**10/15min**) y **`magic_link:global` (15/hora, clave constante)**,
   todos con `onError: 'allow'`.

   **El balde global es la pieza nueva y hay que entender por qué existe.** Supabase
   impone **30 mensajes/hora para todo el proyecto** con SMTP propio, y esa cuota la
   comparten el magic link anónimo *y* las invitaciones del backoffice. Sin tope global,
   un anónimo con dos emails conocidos la agota —y con una sola tienda en QC, los emails
   que existen son dos—. Con el global en 15/hora, **el endpoint anónimo no puede gastar
   más de la mitad de la cuota del proyecto y la otra mitad queda reservada para los
   caminos autenticados**, que son los que nunca pueden fallar. Es un presupuesto, no un
   límite de abuso. **La respuesta al cliente no cambia nunca**: sigue siendo
   `{ ok: true }` exista o no el email y se haya limitado o no — hoy eso evita que el
   formulario sea un oráculo de quién tiene panel en qué local, y ese comportamiento se
   preserva tal cual. El rechazo se ve en `log.warn`, no en la pantalla.
2. **Soporte** (`requestPaymentSupportAction`, `admin.actions.ts:497`): borrar el `Map`
   `supportRequests` y mover el límite a `support:store` + `support:store:day`. Ya tira
   `DomainError` con 429; pasa a `RateLimitError`.
3. **Código de cambio de pagos** (`requestPaymentCredentialsChangeAction`,
   `requestCourierPaymentPolicyChangeAction`, `resendPendingChangeCodeAction`): consumir
   `payment_change:store` **antes** de `startPendingChange`, con **`onError: 'deny'`**
   (fail-closed: es el camino que toca credenciales de cobro). Ojo: **cada llamada manda
   dos mails**, así que el balde de 3/hora son 6 mails/hora.
4. **Invitación de repartidor** (`inviteCourierAction`, `resendCourierInviteAction` en
   `staff.actions.ts`; `inviteCourier`, `resendCourierInvite` en `courier.model.ts`):
   consumir `courier_invite:store` y `courier_invite:email` (clave = `store_id` +
   email). El límite va en las **actions**, no en los modelos, porque ahí está la
   sesión resuelta y `requireStoreMembership` ya corrió.
5. **Invitación de dueño** (`createStoreAction`, `resendOwnerInviteAction` en
   `platform.actions.ts`): consumir `owner_invite:store` y `owner_invite:admin` (clave =
   `user_id` del platform admin).
6. Todos los mensajes de 429, en castellano rioplatense, dicen qué hacer y cuándo
   volver. Nunca "Too many requests".

**Contratos a honrar**: `consumeRateLimit`/`RateLimitError` de T2;
`toActionResult` ya pasa el mensaje de un `DomainError` tal cual, **no hay que
tocarlo**; `requireStoreMembership` / `requirePlatformAdmin` corren **antes** que
cualquier consumo de balde (no gastamos cupo por una request que ni siquiera está
autorizada).

**Criterios de aceptación**:

1. 3 llamadas a `requestMagicLinkAction` con el mismo email en 15 min: **solo 2 llegan a
   `signInWithOtp`**. Las 3 devuelven `{ ok: true }` y son **indistinguibles** desde el
   cliente.
1b. Agotado `magic_link:global`, un pedido anónimo con un email **distinto y nunca
   usado** tampoco llega a `signInWithOtp` — y una invitación desde el backoffice **sí
   sigue funcionando**, porque no consume ese balde. Es la invariante entera del
   presupuesto: el anónimo no puede dejar sin cuota al camino autenticado.
2. El límite del magic link es **por email, no por instancia**: el contador sobrevive a
   que cambie el proceso. (Es lo que hoy falla y es el punto de toda la tarea.)
3. `resendCourierInviteAction` más de 10 veces en una hora para la misma tienda devuelve
   429 y **no llama a Resend**.
4. Los baldes de invitación de la tienda A no afectan a la tienda B.
   **(Aislamiento multi-tenant.)**
5. `requestPayment*ChangeAction` con la RPC de rate limit caída **rechaza** (fail-closed)
   y no crea `store_pending_changes` ni manda mail.
6. Ningún camino cambió su chequeo de autorización: `inviteCourier` sigue exigiendo
   `owner`, soporte sigue aceptando cualquier staff, invitación de dueño sigue exigiendo
   platform admin + `aal2`.
7. No queda ni un `Map` de throttle en estos archivos.
8. Ningún `log` nuevo contiene un email, un teléfono ni un token.

**Dependencias**: T2 (firma), T0 (para correr de verdad).

**Fuera de alcance**: arreglar la plantilla del magic link que ignora `emailRedirectTo`
(el repartidor aterriza en `/admin`), agregar dedupe a las invitaciones, o hacer que las
invitaciones escriban en `notifications`. **Los tres son bugs reales encontrados en la
auditoría: se reportan, no se arreglan acá.**

**Skills obligatorias**: `supabase` (Auth, `signInWithOtp`, Admin API),
`context7` (MCP) antes de afirmar cualquier API de `@supabase/supabase-js` o de `resend`,
`vercel:nextjs` (Server Actions).

---

## T5 — Cerrar el vector de imágenes por configuración

**Lane**: `shared` · **Agente**: `senior-backend-engineer`

**Dueño exclusivo de**: `next.config.ts`, `src/views/admin/catalogo/image-upload.ts`.

**No tocar**: absolutamente nada más. En particular **ningún otro archivo de
`src/views/`** (esos son de T6) y ningún componente que renderice `<Image>`.

**Objetivo.** Que `/_next/image` deje de aceptar orígenes ajenos y query strings
arbitrarios, y que una foto se transforme una vez en su vida. **Esta es la tarea que de
verdad resuelve el vector que preocupa al dueño, no es un rate limiter, y en Hobby es la
P0 #1 de todo el plan.**

**Por qué es lo primero.** En Hobby el techo son **5.000 transformaciones/mes**, y al
excederlo las imágenes nuevas devuelven **402 y se muestra el `alt`** hasta que pase el
mes. Con `minimumCacheTTL` en su default de 4h, una sola tienda de 40 productos proyecta
**~105.840 transformaciones/mes** (588 variantes × 6 revalidaciones/día × 30) contra ese
techo de 5.000: **21× por encima, sin ningún atacante**. O sea que el catálogo se apaga
solo, en días, aunque nadie ataque nada. Con el TTL en un año son **588 una sola vez**.

**Qué hace**, en `next.config.ts`, dentro del bloque `images` y de `remotePatterns`:

1. Agregar **`search: ''`** a **cada** entrada de `remotePatterns`. Verificado contra
   `node_modules/next/dist/shared/lib/match-remote-pattern.js`: sin esa clave, cualquier
   query string en la URL de origen matchea, y cada variante es una cache key facturable
   distinta.
2. Reemplazar `hostname: '*.supabase.co'` por **`'xyjracoaufarsnhurhdc.supabase.co'`**,
   literal. **Sigue siendo un literal estático**: no derivarlo de `process.env` bajo
   ninguna circunstancia — el comentario que ya está en el archivo explica que ese camino
   dejó `remotePatterns` vacío y rompió toda foto de producto sin un solo error en el
   servidor. Las dos entradas de `127.0.0.1` / `localhost` del stack local quedan.
3. Declarar **`qualities: [75]`** explícito.
4. Declarar **`minimumCacheTTL: 31536000`**. Justificarlo en el comentario: los paths son
   UUID v4 con `upsert: false`, así que **el contenido de una URL nunca cambia** y la
   advertencia estándar sobre invalidación no aplica; cambiar la foto crea una URL nueva.
5. **No** tocar `formats` (AVIF duplicaría el techo por foto de 14 a 28) **ni
   `deviceSizes`/`imageSizes`**. Recortar anchos es la próxima perilla si el dashboard
   muestra que hace falta, **no ahora**: cambia el `srcset` real y puede degradar la foto
   en pantallas grandes, y con el TTL arreglado las 588 transformaciones iniciales son el
   12% del cupo mensual. Dejarlo anotado como comentario, no aplicarlo.

Y en `image-upload.ts`: pasar `cacheControl: '31536000'` en el `upload` a Storage, para
que el objeto de origen diga lo mismo que el config.

**Criterios de aceptación** (verificables con `curl` contra un build local):

1. `/_next/image?url=<foto real de nuestro storage>&w=828&q=75` → **200**.
2. La misma URL con `&v=1` pegado a la URL **de origen** → **400**.
   *(Hoy devuelve 200 y factura una transformación. Este es el agujero.)*
3. `/_next/image?url=https://<otro-proyecto>.supabase.co/storage/v1/object/public/x/a.jpg&w=828&q=75`
   → **400**. *(Hoy devuelve 200.)*
4. `q` distinto de 75 no genera una variante nueva (Next lo colapsa al valor permitido).
5. **Toda foto de producto y todo asset de branding sigue viéndose** en `/[store]`,
   `/[store]/producto/[id]` y `/pedido/[token]`, en producción y en el stack local por
   `127.0.0.1:54321`. **Esta es la regresión que hay que evitar a toda costa**: si las
   fotos dejan de verse, la premisa del diseño entero se apaga y el síntoma (imagen rota)
   no menciona la config en ningún lado.
6. `next build` y `npm run typecheck` limpios.
7. Dejar en el comentario del archivo la cuenta de §2.1 (techo de Hobby vs. proyección
   con el TTL default). Es el tipo de trampa que este repo documenta en el código: sin la
   cuenta escrita, el próximo que vea `minimumCacheTTL: 31536000` lo va a bajar
   "por prolijidad" y va a apagar el catálogo sin enterarse.

**Dependencias**: ninguna. **Arranca primera, en paralelo con T0 y T2.**

**Fuera de alcance**: los `<img>` crudos del admin que bajan el JPEG completo en cajas de
44-64px (`product-row.tsx`, `apariencia/image-field.tsx`), la cuota de Storage por
tienda, los archivos huérfanos, y el `WITH CHECK` faltante en
`product_images_staff_update`. **Todo reportado en §7 de `00-architecture.md`, nada se
toca acá.**

**Skills obligatorias**: `vercel:nextjs` y el doc local
`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
(AGENTS.md: **este Next no es el de tu memoria**), `context7` (MCP) para `next/image`,
`supabase` para las opciones de `storage.upload`.

---

## T6 — El 429 que ve la persona

**Lane**: `frontend` · **Agente**: `frontend-react-craftsman`

**Dueño exclusivo de**: `src/views/admin/acceso/request-link-form.tsx`,
`src/views/courier/request-link-form.tsx`, `src/views/storefront/checkout-form.tsx`,
`src/views/admin/repartidores/invite-courier-form.tsx`,
`src/views/admin/shared/confirm-with-code.tsx`, `src/views/backoffice/store-detail.tsx`.

**No tocar**: `src/views/admin/catalogo/image-upload.ts` (**es de T5**), ningún otro
archivo de `views/`, nada de `controllers/`, `models/`, `app/`, `lib/`.

**Objetivo.** Que quien choca un límite entienda qué pasó y qué hacer. Un 429 mudo en el
checkout es una venta perdida igual que un bloqueo.

**Qué hace**:

1. En `checkout-form.tsx`: manejar el 429 de `POST /api/orders` como un mensaje visible
   arriba del formulario, **sin borrar el carrito ni la `idempotencyKey`** — la clave se
   reusa en el reintento, que es justamente lo que la idempotencia necesita. El botón
   queda habilitado (la persona tiene que poder reintentar cuando pase el minuto), pero
   con el mensaje presente.
2. En los formularios de invitación, reenvío y código: mostrar el mensaje del
   `ActionResult` tal cual (ya viene del `DomainError`), sin inventar copy propio.
3. En los dos `request-link-form.tsx`: **no cambia nada**. El magic link devuelve
   siempre el mismo mensaje por diseño. Se listan acá solo para dejar explícito que **no
   hay que "mejorarlos"** agregando un estado de "límite alcanzado": eso convertiría el
   formulario en un oráculo de qué emails existen.
4. Nada de `alert`, nada de emoji, nada de kicker. El mensaje usa el patrón de error que
   la superficie ya tiene.

**Contratos a honrar**: `ActionResult` de `src/models/types.ts` sin cambios; las
primitivas de `src/views/shared/surfaces.tsx` (`Panel`, `ActionBar`, `StatusPill`…) —
**nadie inventa una pieza nueva**; targets de 44px; el mundo visual ya está decidido y
**no se reabre** (nada de `context.mjs` ni `concept-seed.mjs`).

**Criterios de aceptación**:

1. Un 429 en el checkout muestra un mensaje legible en castellano rioplatense, con
   `aria-live`, y **el carrito sigue intacto**.
2. Reintentar después del `Retry-After` funciona y **no crea un pedido duplicado**.
3. Los dos formularios de magic link se comportan **idénticamente** con email
   inexistente, email válido y límite alcanzado.
4. Cero data fetching en views (regla dura del repo).
5. El hook de `impeccable` no reporta hallazgos nuevos.

**Dependencias**: T3 y T4 (para probar contra un 429 real; el markup se puede escribir en
paralelo).

**Skills obligatorias**: `impeccable` — **antes de editar**, leer
`.claude/skills/impeccable/reference/craft-floor.md`; para `/admin` y `/backoffice`
además `.claude/skills/impeccable/reference/operate.md` y el brief de superficie en
`.impeccable/surfaces/`. Al cerrar: `web-design-guidelines`.
Y `vercel-react-best-practices` para todo lo de React/Next.

---

## T7 — Configuración de plataforma (Hobby / Free)

**Lane**: `shared` · **Dueño**: hilo principal **+ el usuario**. Sin código, ningún agente.

**Objetivo.** Las dos capas que no viven en el repo, con el presupuesto real: **3 reglas
custom en Vercel, de las cuales 1 sola puede ser de rate limit.**

### A. Vercel WAF — tres reglas, y ni una más

`vercel link` primero (hoy no hay `.vercel/project.json`, así que **no se pudo verificar
que no haya reglas publicadas**; confirmarlo con `vercel firewall overview` antes de
tocar nada).

| # | Regla | Acción | Por qué esta |
|---|---|---|---|
| RL-1 | `storefront-flood` — request de página de vitrina | **rate_limit 300/60s por `ip`** | **El único tiro de rate limit, y va acá.** Es la única superficie de alto volumen que la aplicación no puede defender barato (un límite ahí sería un round trip a Postgres en el camino de lectura más caliente), y es donde el recurso más escaso del stack —el Postgres free tier de CPU compartida— se agota primero: `/[store]` es SSR puro, 3 queries por visita, sin cache. |
| D-1 | `webhook-unsigned` — `path pre /api/webhooks/mercadopago` **Y** `header[x-signature]` `nex` | **deny** | Cada request sin firma cuesta hoy un round trip a `store_payment_credentials`. Cero falso positivo: MP siempre manda `x-signature`. **No limitar por IP**: MP notifica desde un set chico de IPs y limitarlas puede tirar un pago real. |
| D-2 | `cron-unauthenticated` — `path pre /api/cron/` **Y** `header[authorization]` `nex` | **deny** | Cero falso positivo: el invocador legítimo (ahora **pg_net desde Supabase**) siempre manda el Bearer. Es la de menor valor marginal y **la primera que se cambia** si aparece algo mejor. |

**Lo que NO entra y qué lo cubre**: la protección de `/_next/image` la hace **T5 por
configuración** (Next devuelve 400 antes de transformar, así que una regla de WAF ahí
sería defensa en profundidad y no vale un slot de 3); `POST /api/orders` y
`/api/orders/lookup` los cubre **T3 en la aplicación**, con claves mejores que la IP;
`GET /api/orders/[token]` queda **sin límite, riesgo aceptado** (§5.7).

**Señal para mudar RL-1 a `/_next/image`**: si después de T5 el dashboard de Image
Optimization sigue mostrando transformaciones creciendo. Mirarlo en la primera semana.

**Procedimiento, no negociable** (skill `vercel:vercel-firewall`): cada regla se publica
en `--action log` → **el usuario** revisa el dashboard filtrado por rule ID → `deny` /
`rate_limit` con `environment = preview` → producción.
**`vercel firewall publish --yes` lo corre el usuario, nunca un agente.**

**Y una advertencia que vale por toda la sección**: RL-1 es la **única** regla de rate
limit que tenemos. Si se rompe (por ejemplo cuando aterrice el plan de subdominios y el
slug pase del path al host), **nos quedamos sin ninguna y nada lo va a avisar.** Anotar
la dependencia en el plan de subdominios.

### B. Dashboard de Supabase (plan Free)

1. **Ir a Authentication → Rate Limits y ver si el límite de email es editable en Free.**
   **Esta es la verificación más importante de la tarea** (pregunta abierta 1 de
   `00-architecture.md`):
   - **Si es editable**: subirlo de 30/hora a ~150/hora. Con un solo local sobra, y
     `magic_link:global` de T4 pasa a ser holgura.
   - **Si NO es editable**: 30/hora es techo duro, y entonces **`magic_link:global` es lo
     único que separa a un anónimo de dejar sin magic link a todos los paneles.** En ese
     caso hay que **avisarle a T4 que ese balde subió a P0** y considerar bajarlo de 15 a
     10/hora para dejar más reserva a las invitaciones del backoffice.
   `config.toml` no se toca: configura **solo** el stack local y son dos cosas separadas.
2. **Prender CAPTCHA (Turnstile) en el login del backoffice.** Gratis, no depende del
   plan, y es la única defensa posible de una superficie que **no pasa por Vercel** (el
   login y el TOTP van del browser a Supabase directo).
3. **Mirar** el límite de MFA challenge/verify (15/hora por IP) y decidir si sube. Dos
   admins en la misma oficina comparten IP. No tocarlo a ciegas.
4. **Confirmar que el hook `before_user_created` está registrado en el dashboard.** Si
   está prendido en local y no en hosted, producción queda con el registro abierto (ya
   documentado en `CLAUDE.md`; se verifica de paso).
5. **Anotar para el QC**: los proyectos Free se pausan a los 7 días de inactividad. Si
   hay un hueco entre pruebas, hay que reactivarlo a mano.

**Criterios de aceptación**: `vercel firewall overview` muestra las 3 reglas publicadas y
activas; una prueba manual contra un preview confirma el 429 de RL-1 y el 403 de D-1; el
dashboard de Supabase muestra el CAPTCHA activo y el límite de email verificado (con su
respuesta anotada, sea cual sea).

## T8 — Suite

**Lane**: `shared` · **Agente**: `test-engineer` · **Dueño exclusivo de `tests/**`.**

Nadie más escribe tests, y `test-engineer` no escribe producción: un test que revela un
bug real es un hallazgo que vuelve al agente que corresponda.

**Lo que solo se puede probar contra una base real → `tests/db/`:**

- `tests/db/rate-limits-grants.test.ts` — T0 criterios 1 y 2 (grants y `execute`), con la
  publishable key contra PostgREST, en el mismo estilo que
  `tests/db/anon-grants.test.ts` y `tests/db/grants-orders.test.ts`.
- `tests/db/consume-rate-limit.test.ts` — T0 criterios 3 a 6. **El de concurrencia
  (criterio 4) es el que importa**: N llamadas en paralelo → `count = N`, una sola fila.
  Mismo patrón que `tests/db/payments-one-approved.test.ts` y
  `tests/db/create-order-rpc.test.ts`.
- `tests/db/cleanup-rate-limits.test.ts` — T0 criterio 7, incluyendo que
  `cleanup_old_records` **sigue** barriendo `order_events` y `platform_audit_log`.

**Unitarios / de contrato:**

- `tests/models/rate-limit.model.test.ts` — T2: hasheo del subject (nunca valor crudo),
  normalización, kill-switch, fail-open/fail-closed.
- `tests/lib/errors.test.ts` (ampliar el existente) — T2: `RateLimitError` → 429 +
  `Retry-After`; **y que `DomainError` y `Error` se comporten exactamente igual que
  antes** (test de no-regresión).
- `tests/services/orders-route-rate-limit.test.ts` — T3: 429 por teléfono, `order:store`
  que **no** bloquea, aislamiento entre tiendas, idempotencia intacta bajo límite,
  kill-switch.
- `tests/services/admin-request-magic-link.actions.test.ts` (ampliar el existente) —
  T4: 3 de 4 llegan a `signInWithOtp`, las 4 respuestas indistinguibles.
- `tests/services/invite-rate-limit.test.ts` — T4: invitaciones de repartidor y de
  dueño, aislamiento entre tiendas, fail-closed en `payment_change`.

**Lo que NO se testea**: las reglas de WAF (son config de plataforma, se verifican a mano
en el dashboard) y `next.config.ts` (se verifica con `curl` contra un build, ver los
criterios de T5).

**Criterio de salida**: `npm test` verde con Docker levantado, `npm run typecheck` y
`npm run lint` limpios. Sin eso no se commitea nada.

---

## Orden de ejecución

```
T5 (imágenes / next.config.ts)   ──────────────┐   P0 #1. No depende de NADIE.
shared                                          │   Arranca sola, ya.
                                                │
T1 (contratos, hilo principal)                  │
        │                                       │
        ├────────────┐                          │
        ▼            ▼                          │
   T0 (schema)     T2 (núcleo)                  │
   hilo principal  backend                      │
        │            │                          │
        └──────┬─────┘                          │
               ▼                                │
        ┌──────┴──────┐                         │
        ▼             ▼                         │
      T3 (pedidos)  T4 (mail)                   │
      backend       backend                     │
        └──────┬──────┘                         │
               ▼                                │
             T6 (UX 429)  ◀────────────────────┘
             frontend
               │
               ▼
             T8 (suite)  →  code-reviewer  →  commit

T7 (WAF + Supabase) corre en paralelo con todo y lo publica el usuario.
```

**Un acople entre T7 y T4 que no se ve en el diagrama**: el paso **T7.B.1** (¿es editable
el límite de email de Auth en el plan Free?) **decide la calibración de
`magic_link:global` en T4**. Si la respuesta llega antes de que T4 arranque, mejor; si no,
T4 implementa con 15/hora y el número se ajusta después — es una constante en
`rate-limit-policy.ts`, no un cambio de diseño.
