# Suite de tests — etapa 03

Pipeline unificado: `2026-08-29-rate-limiting` + `2026-08-29-subdominio-por-local`.
Agente: `test-engineer`. Corre después de T2–T6 (rate limiting) y T2–T7
(subdominio), en paralelo con `code-reviewer`.

**Veredicto: SUITE GREEN.**

```
npm test        → 48 archivos, 487 tests, 0 fallos
npm run lint    → 0 errores, 0 warnings
npm run typecheck → limpio
```

Docker estaba levantado, así que `tests/db/` corrió de verdad (no se
salteó).

---

## Estado de partida y diagnóstico de los 11 rojos

`npm test` en el commit de partida daba **333 pasan, 11 fallan**, en 4
archivos. Se diagnosticó cada uno antes de tocar nada:

| Archivo | Fallos | Diagnóstico | Acción |
|---|---|---|---|
| `tests/controllers/require-backoffice-session.test.ts` | 2 | **Preexistente** (verificado contra `46d1d4e`, sin diff en `tests/` desde ahí). El mock de `@/models/platform.model` no reexportaba `BackofficeSessionExpiredError`; el `instanceof` de `platform.controller.ts` tiraba `TypeError` en vez de evaluar `false`. Mock shape incompleto, no un bug de `src/`. | Arreglado: el mock ahora reexporta la clase (un doble local, no la real — evita arrastrar el árbol de imports de `platform.model.ts`). Sumé además un test nuevo para el camino de sesión vencida (`BackofficeSessionExpiredError` → `/backoffice/login?error=sesion_vencida`), que no tenía cobertura. |
| `tests/models/platform-owner-invite.model.test.ts` | 5 | **Preexistente**, mismo commit de referencia. El mock de `createClient()` no incluía `auth.getClaims()`, que `requirePlatformAdmin()` ya llamaba (código de `46d1d4e`, no de esta rama) para el corte de sesión de 12hs. | Arreglado: el mock ahora expone `auth.getClaims` devolviendo `{ data: { claims: null }, error: null }` — la forma real de la API (`{data:{claims},error}`, no un objeto pelado) y el fallback documentado ("sin `amr` no se corta") que es justo el comportamiento que este archivo necesita para no meterse con la lógica de expiración. |
| `tests/services/owner-invite-email.adapter.test.ts` | 1 | **Preexistente**, mismo commit. El test esperaba `idempotencyKey: 'store-owner-invite/99'`; el código en `src/` produce `store-owner-invite/99/<hash del inviteUrl>`. Diagnóstico: **el código tiene razón, el test quedó viejo.** El comentario largo en `owner-invite.tsx` explica el porqué: una clave atada solo al `storeId` hace que la SEGUNDA invitación real (alta + reenvío, mismo storeId, link distinto) llegue a Resend con la MISMA clave pero un cuerpo distinto → Resend responde `409 invalid_idempotent_request` en vez de mandar el mail. Rompía el reenvío legítimo. | Reescribí el test para afirmar la propiedad (mismo `inviteUrl` → misma clave y dedupe; `inviteUrl` distinto → clave distinta; namespaced por `storeId`), no el string literal de una implementación de hash interna. No toqué `src/`. |
| `tests/services/admin-request-magic-link.actions.test.ts` | 3 | **Nuevos y esperados** (T4 borró el `Map` en memoria que este archivo probaba). | Reescrito contra `consumeRateLimit` mockeado: orden de los 4 baldes, corte temprano, `onError:'deny'`, presupuesto compartido (criterio 1b), y las respuestas indistinguibles preservadas. |

Los 8 preexistentes están efectivamente arreglados del lado de los **tests**
(mocks incompletos o desactualizados), no del lado de `src/`. No hay ningún
hallazgo que rutear de esta parte.

---

## Rate limiting — qué se cubrió

### `tests/db/` (Docker real)

- **`consume-rate-limit.test.ts`** — el test que importa: **30 llamadas
  concurrentes** (conexiones de Postgres separadas, lanzadas con
  `Promise.all` sobre procesos `docker exec psql` reales — no un `for`
  secuencial) al mismo `(bucket, subject)` dejan `count = 30` exacto en
  **una** fila. Más: límite exacto (3/3 `allowed`, 4ta `false`), aislamiento
  bucket↔subject en las dos direcciones, rollover de ventana (una fila vieja
  con `count=999` no contamina la ventana nueva), parámetros inválidos
  rechazados, y el **gate de idempotencia real** (`order:idempotency` →
  `order:phone`) replicado con 8 conexiones concurrentes: 8 registros en el
  balde de dedupe, **1 solo** cupo gastado en el balde real — la invariante
  exacta que pedía el criterio 2 del brief ("verificado a mano: 8
  concurrentes → `order:idempotency` 8, `order:phone` 1").
- **`rate-limits-grants.test.ts`** — `anon`/`authenticated` reciben
  `permission denied` en `select`/`insert`/`update` de la tabla y en
  `consume_rate_limit()`, incluso con `aal2`; `service_role` funciona.
- **`cleanup-rate-limits.test.ts`** — sin test previo de `cleanup_old_records`
  en todo el repo (riesgo real: `create or replace` reemplaza el cuerpo
  completo). Prueba que sigue barriendo `order_events`/`platform_audit_log` Y
  ahora también `rate_limits`, sin perder ninguno de los tres.

### Unitarios / contrato

- **`tests/models/rate-limit.model.test.ts`** — HMAC nunca crudo (hex de 64
  chars), normalización (trim+lowercase), dos sujetos → dos hashes, kill
  switch (`RATE_LIMIT_ENABLED=false` no llama a la RPC), fail-open/closed por
  `onError`, log sin PII, `remaining` nunca negativo.
- **`tests/lib/errors.test.ts`** (ampliado) — `RateLimitError` → 429 +
  `Retry-After` (entero ≥ 1, redondeado hacia arriba), y no-regresión
  explícita: `DomainError`/`Error` genérico se comportan exactamente igual
  que antes de que existiera `RateLimitError`.
- **`tests/services/orders-route-rate-limit.test.ts`** — orden de baldes
  (`order:idempotency` → `order:phone` → `order:store`), reintento de la
  misma compra nunca gasta cupo real, `order:phone` agotado → 429 con
  `Retry-After` y mensaje en castellano, `order:store` **nunca bloquea** (201
  + `log.warn`), aislamiento multi-tenant (subject = slug, distinto por
  tienda), cero PII en logs, validación de forma antes que cualquier balde.
- **`tests/services/orders-lookup-rate-limit.test.ts`** — `lookup:ip`
  (20/60s), 429 con `Retry-After`, subject = IP.
- **`tests/services/admin-request-magic-link.actions.test.ts`** (reescrito)
  — orden de los 4 baldes, corte apenas uno bloquea (protege el presupuesto
  compartido), los 4 con `onError:'deny'`, criterio 1b completo (`global`
  agotado bloquea incluso un email nunca antes usado), respuestas
  indistinguibles, sin PII en el log de rechazo.
- **`tests/services/invite-rate-limit.test.ts`** — `inviteCourierAction`
  (autorización antes que el balde, orden `store`→`email`, aislamiento
  multi-tenant), `resendCourierInviteAction` (solo `courier_invite:store`,
  por diseño), `requestCourierPaymentPolicyChangeAction`
  (`payment_change:store` con `onError:'deny'` explícito — fail-closed real:
  agotado o con la RPC caída, NO crea `store_pending_changes` ni manda mail),
  `createStoreAction`/`resendOwnerInviteAction` (qué bucket consume cada uno
  y por qué, aislamiento multi-tenant en `owner_invite:store`).

### Lo que NO se agregó como test nuevo (ya cubierto o fuera de alcance)

- El **kill-switch a nivel de ruta HTTP** (`RATE_LIMIT_ENABLED=false` →
  comportamiento idéntico a antes): ya está probado exhaustivamente en
  `rate-limit.model.test.ts` (con la variable en `false`, `consumeRateLimit`
  no llama nunca a la RPC — eso es lo único que puede diferir el
  comportamiento). Duplicarlo en cada route handler no agrega cobertura
  nueva, solo repetición.
- Reglas del WAF y `next.config.ts` de imágenes: son config de plataforma /
  ya verificadas con `curl` por el dev agent (T5), fuera de lo que
  `tests/` puede probar.

---

## Subdominio por local — qué se cubrió

Con el flujo local de subdominios fuera de alcance del plan, **estos tests
son la única verificación previa a producción** (no hay ningún otro entorno
donde el rewrite por host se ejercite antes del primer deploy con el
wildcard DNS andando). Se escribieron completos, no representativos.

- **`tests/lib/next-config-routing.test.ts`** (36 tests) — los 15 criterios
  de `01-tasks.md` §T3 más los 2 del bugfix de anclaje que encontró el dev
  agent, **usando las funciones reales de Next** (`matchHas`, `getPathMatch`
  sobre `path-to-regexp`, `prepareDestination` — las mismas que corre el
  framework en producción, invocadas directo en vez de a través de un
  servidor HTTP). Incluye: la fase `beforeFiles` se afirma explícitamente
  (no solo la existencia de la entrada), los 4 rewrites host→path, que nada
  fuera de las 4 formas matchea (`/_next/*`, `/api/*`, `/pedido/*`,
  `/mis-pedidos`), que `a.b.comandapp.ar` no es una tienda, los 2 grupos de
  redirects (apex↔subdominio, tenant→apex), preview deployments y
  `localhost` inertes, `previewFrameHeaders()` y el redirect comparten el
  mismo criterio de "reservado" (probado por comportamiento, ya que la
  constante no se exporta), **cobertura**: cada `page.tsx` real bajo
  `src/app/[store]/` tiene su entrada de rewrite (y viceversa: ninguna
  entrada de rewrite queda huérfana), y `allowedDevOrigins` sin cambios.
- **`tests/lib/urls.test.ts`** (21 tests) — los 8 criterios de T4 completos:
  `storeUrl`/`apexUrl` en los dos modos, `apexUrl` nunca devuelve host de
  tienda, los 10 casos de `parseStoreHost` (incluidos los dos que más
  importan: `comandapp.ar.evil.com` como sufijo de un dominio ajeno, y
  `evilcomandapp.ar` como texto pegado sin el punto que separa un subdominio
  real — los dos dan `null`), `storeBasePath` en sus 4 casos.
- **`tests/db/reserved-slugs-parity.test.ts`** — mismo patrón que el test que
  compara `ALLOWED_TRANSITIONS` contra el trigger: lee
  `pg_get_constraintdef()` de `stores_slug_not_reserved_check`, compara
  conjunto contra conjunto con `RESERVED_SLUGS` (113 de cada lado hoy, sin
  duplicados), y prueba que la constraint rechaza de verdad (`23514`, no un
  error de Zod) — incluido un slug que solo EMPIEZA como uno reservado
  (`administracion`), que tiene que seguir siendo válido.
- **`tests/services/mercadopago-checkout-urls.test.ts`** — en modo
  `subdomain`, los 3 `back_urls` van al subdominio de la tienda y
  `notification_url` al apex (host distinto, a propósito); las dos son
  siempre `https://`; en modo `path`, sin regresión respecto de hoy.
- **`tests/services/order-tracking-host-coherence.test.ts`** — T7: host de
  la tienda dueña → sin redirect; host de OTRA tienda → 308 permanente al
  subdominio correcto; apex y `localhost` → sin redirect; **token
  inexistente nunca dispara el chequeo de host** (el `public_token` es la
  única credencial del pedido — un redirect condicional a su existencia
  sería un oráculo, así que se prueba explícitamente que el `EmptyState` se
  sirve antes de tocar `headers()`).
- **`tests/lib/proxy-cookies.test.ts`** — la invariante de cookies (§3.5):
  se corre `proxy()` de verdad con un `NextRequest` real y un
  `createServerClient` mockeado que dispara `setAll` (simulando un refresh
  de sesión real); se afirma que **ningún** `Set-Cookie` de la respuesta
  real trae `Domain=`, y que el literal de opciones que `proxy.ts` le pasa a
  `createServerClient` no tiene la clave `cookieOptions`. Mismo candado para
  `src/lib/supabase/server.ts`.
- **`tests/lib/subdomain-source-scan.test.ts`** — los dos barridos de
  fuente: ningún archivo de `src/` fuera de `src/lib/urls.ts` (y los dos
  schemas de env) referencia `NEXT_PUBLIC_SITE_URL` en código vivo; ningún
  archivo de `src/views/storefront/**` o `src/app/[store]/**` arma un `href`
  con el slug interpolado a mano.

### Lo que NO se puede probar en CI (queda como checklist de deploy, no como test)

Del checklist de smoke de `00-architecture.md` §7, obligatorio antes del
primer deploy con subdominios:

- El certificado wildcard de `*.comandapp.ar` emitido y sirviendo.
- El home de una tienda real respondiendo en su subdominio.
- El 308 del apex path-based → subdominio, en producción de verdad.
- La vista previa de marca (`/admin/apariencia?preview=brand`) sigue
  funcionando dentro del iframe.
- Un slug inexistente da 404 real de la app (no un 200 que miente).
- Un pago real de Mercado Pago volviendo al subdominio, con el carrito
  vaciándose (`clearResolvedOrderCart` corriendo en el origen correcto).
- Un magic link real entrando al apex (no al subdominio).

Ninguno de estos se puede ejercitar sin el wildcard DNS y el deploy reales —
está documentado acá para que quede explícito que la ausencia de un test no
es un descuido.

---

## Hallazgos rutedos (bugs reales de `src/` encontrados durante este trabajo)

**Ninguno.** Todo lo que falló al escribir estos tests resultó ser un mock
de test desactualizado o incompleto (ver la sección de diagnóstico arriba),
nunca un defecto del código de producción de `src/`. Los tres agentes de
desarrollo (T2–T6 de rate limiting, T2–T7 de subdominio) ya habían reportado
sus propios hallazgos fuera de alcance en sus dev logs (`02-development-*.md`)
— ninguno de esos requería un test nuevo que no estuviera ya cubierto arriba,
y ninguno se tocó acá (no se escribe código de producción).

---

## Archivos tocados en este stage

Nuevos:

- `tests/db/rate-limits-grants.test.ts`
- `tests/db/consume-rate-limit.test.ts`
- `tests/db/cleanup-rate-limits.test.ts`
- `tests/db/reserved-slugs-parity.test.ts`
- `tests/models/rate-limit.model.test.ts`
- `tests/services/orders-route-rate-limit.test.ts`
- `tests/services/orders-lookup-rate-limit.test.ts`
- `tests/services/invite-rate-limit.test.ts`
- `tests/services/mercadopago-checkout-urls.test.ts`
- `tests/services/order-tracking-host-coherence.test.ts`
- `tests/lib/urls.test.ts`
- `tests/lib/next-config-routing.test.ts`
- `tests/lib/proxy-cookies.test.ts`
- `tests/lib/subdomain-source-scan.test.ts`

Modificados:

- `tests/db/helpers.ts` — agregado `sqlConcurrently()` (concurrencia real vía
  `spawn`, no `execFileSync` secuencial).
- `tests/lib/errors.test.ts` — sección de `RateLimitError`.
- `tests/controllers/require-backoffice-session.test.ts` — mock arreglado +
  test nuevo de sesión vencida.
- `tests/models/platform-owner-invite.model.test.ts` — mock de
  `auth.getClaims` agregado.
- `tests/services/owner-invite-email.adapter.test.ts` — test reescrito
  contra la propiedad, no el string literal.
- `tests/services/admin-request-magic-link.actions.test.ts` — reescrito
  contra `consumeRateLimit`.
- `tests/models/order.schema.test.ts` — limpieza de lint (`_omit` → helper
  `omit()`).
- `tests/services/mercadopago.adapter.test.ts` — limpieza de lint (params
  sin usar).

## Veredicto final

**SUITE GREEN.** `npm test` (487 tests, 48 archivos), `npm run lint` y
`npm run typecheck` limpios. Sin hallazgos para rutear.
