# T2 — Núcleo de rate limiting — dev log (backend)

Agente: `senior-backend-engineer`. Archivos: `src/models/rate-limit.model.ts`
(nuevo) y `src/lib/errors.ts` (ensanchado, ver actualización de cierre más
abajo — el hilo principal me dio la propiedad de ese archivo a mitad de tarea).

**Este documento tiene dos partes**: la entrega inicial (secciones 1 a 6,
como quedaron escritas quedan como registro) y una **actualización de cierre**
al final con las tres decisiones que pidió el hilo principal después de leer el
reporte inicial. Leé la actualización de cierre primero si solo te interesa el
estado final.

## Qué se implementó

Una única función, `consumeRateLimit`, que habla con `public.consume_rate_limit`
(RPC ya aplicada en `supabase/migrations/20260829150000_rate_limits.sql`) vía
`createAdminClient()`.

```ts
consumeRateLimit(input: {
  bucket: RateLimitBucket
  subject: string          // valor CRUDO — se hashea acá adentro
  limit: number
  windowSeconds: number
}): Promise<RateLimitDecision>   // { allowed, remaining, retryAfterSeconds }
```

Esta es la firma que me dieron como "ya fijada" para que T3/T4 la importen, y es
la que implementé. **Difiere de la firma descrita en `01-tasks.md` §T2**, que
pedía un parámetro `onError: 'allow' | 'deny'` — ver la sección "Discrepancia"
más abajo, es el punto más importante de este log.

## Decisiones

### 1. Hasheo del sujeto

`subject` nunca llega crudo a Postgres. Se normaliza con
`.trim().toLowerCase()` y se firma con `signHmacSha256` de
`src/services/crypto/hmac.ts`, usando `CREDENTIALS_ENCRYPTION_KEY` como
secreto (la misma clave que ya cifra las credenciales de Mercado Pago).

**Ojo con el helper elegido**: hay dos HMAC en el repo.
`src/lib/crypto/secrets.ts` expone `hmacSha256(value)` (la que usa
`store_pending_changes.code_hash`), pero devuelve **base64url**, no hex. El
criterio de aceptación de T2 pide explícitamente "hex de 64 chars" (así lo dice
también el comentario de la migración: *"HMAC en hex, NUNCA el valor
crudo"*), así que usé `signHmacSha256` de `src/services/crypto/hmac.ts` (la
que ya firma los webhooks de POS/MP), que sí devuelve
`.digest('hex')`. Ambas leen la misma clave, pero por rutas distintas: la de
`secrets.ts` la lee internamente vía `serverEnv()`, la de `services/crypto/hmac.ts`
la recibe como parámetro — por eso mi función lee
`serverEnv().CREDENTIALS_ENCRYPTION_KEY` y se la pasa.

### 2. Normalización — decisión deliberada de NO reimplementar E.164 acá

El plan (`01-tasks.md` y el prompt de lanzamiento) pide "email en minúsculas y
trim; teléfono en E.164". Implementé solo `.trim().toLowerCase()`, aplicado
igual sin importar el bucket, y **no** reimplementé la lógica de E.164.

Motivo: la normalización de teléfono argentino ya vive en `phoneSchema`
(`src/models/schemas/order.schema.ts`), con las trampas de Córdoba
documentadas ahí (el "15" que a veces es parte real del número). Reimplementar
esa lógica acá —sin acceso a esos comentarios ni a los tests que la cubren—
es duplicar una regla de negocio no trivial en dos lugares que se van a
desincronizar. Como el criterio de aceptación #2 solo pide que
`"  Foo@Bar.COM "` y `"foo@bar.com"` caigan en el mismo balde, `trim +
toLowerCase` alcanza para pasarlo sin tocar la lógica de teléfono.

**Consecuencia para T3/T4**: quien llame `consumeRateLimit` para un bucket de
teléfono (`order:phone`) tiene que pasar el valor ya normalizado por
`phoneSchema` (que además es el paso obligatorio para poder mandar WhatsApp,
así que en la práctica ya está disponible en ese punto del flujo). Si se
pasara el string crudo del formulario, dos formas del mismo teléfono
(`011 15-5555-4444` vs `+54 9 11 5555-4444`) caerían en baldes distintos y el
límite de 5 pedidos/10min por teléfono se podría esquivar variando el
formato. **Test que necesita esto probado con datos reales**: ninguno nuevo
en Postgres — es una responsabilidad del llamador, así que el test relevante
es de integración en T3 (verificar que `order:phone` usa el teléfono ya
normalizado, no el crudo del body).

### 3. Kill-switch: `RATE_LIMIT_ENABLED`

Implementado leyendo `process.env.RATE_LIMIT_ENABLED` **directo**, no vía
`serverEnv()`, porque esa variable no está declarada en
`src/lib/env.server.ts` y ese archivo me lo marcaron de solo lectura.

**Pedido al hilo principal**: agregar a `serverSchema` en `src/lib/env.server.ts`:

```ts
/**
 * Kill-switch de emergencia para el rate limiting. En `false` apaga los
 * baldes sin tocar la base — ver `src/models/rate-limit.model.ts`.
 */
RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
```

Cuando se agregue, `isRateLimitingEnabled()` en `rate-limit.model.ts` debería
pasar de `process.env.RATE_LIMIT_ENABLED !== 'false'` a
`serverEnv().RATE_LIMIT_ENABLED !== 'false'`, para que la variable pase por la
validación de arranque como el resto. Es un cambio de una línea, lo dejo
señalado con un comentario en el archivo para que no se pierda.

Con `RATE_LIMIT_ENABLED=false`, la función devuelve
`{ allowed: true, remaining: Infinity, retryAfterSeconds: 0 }` **antes** de
llamar `hashSubject` o `createAdminClient()` — no se toca la base ni se
calcula el HMAC. Verificable por criterio de aceptación #3.

### 4. Fail-open / fail-closed — DISCREPANCIA IMPORTANTE, necesito una decisión

Este es el punto que más quiero que se revise.

- **`01-tasks.md` §T2** especifica que `consumeRateLimit` acepta un parámetro
  `onError: 'allow' | 'deny'` y que **el llamador decide** por superficie. Esto
  calza con `00-architecture.md` §5.3, que pide fail-open para `order:*` y
  `magic_link:*`, pero **fail-closed para `payment_change:*`** (toca
  credenciales de cobro).
- El prompt de lanzamiento que recibí fijó una firma **sin** ese parámetro
  (`{ bucket, subject, limit, windowSeconds } → Promise<RateLimitDecision>`) y
  pidió en su lugar: *"Fail-open vs fail-closed: decidí y dejalo escrito en un
  comentario"* — es decir, una única política, hardcodeada en el modelo.

Seguí la firma del prompt de lanzamiento por ser la marcada como "ya fijada,
que T3 y T4 van a importar", y con `Promise<RateLimitDecision>` sin variante
de error no hay dónde expresar `onError` de todos modos. Implementé
**fail-open global**: si la RPC tira, si `consume_rate_limit` no devuelve fila,
o si falta `CREDENTIALS_ENCRYPTION_KEY`, se loguea con `log.error` y se
devuelve `{ allowed: true, remaining: input.limit, retryAfterSeconds: 0 }`.
Justificación: es la regla de calibración explícita del repo ("en el camino de
compra, un falso positivo es peor que un falso negativo") y es la política
correcta para 11 de los 13 buckets de la tabla de §5.3.

**Pero con esta firma, `payment_change:store` y `payment_change:*` no pueden
ser fail-closed.** Si Postgres tiene un hipo justo cuando alguien pide cambiar
las credenciales de cobro de una tienda, el límite de 3/hora se salta en vez
de bloquear. El plan es explícito en que esa ruta debería fallar cerrado.

**Necesito que el hilo principal decida uno de estos dos caminos** antes de
que T4 cablee `payment_change:*`:

1. Reabrir la firma para agregar `onError: 'allow' | 'deny'` (con default
   `'allow'` para no tocar los demás llamadores), tal como pedía
   `01-tasks.md` — yo lo agrego en una edición de una línea si se aprueba.
2. Aceptar fail-open global y que T4 implemente el fail-closed de
   `payment_change:*` en su propia capa (por ejemplo, no atrapando un error
   que le devuelva `consumeRateLimit` — pero con la firma actual no hay tal
   error que atrapar, así que en la práctica esto requeriría que T4 llame la
   RPC por su cuenta para ese bucket puntual, duplicando lógica).

No tomé la decisión unilateralmente porque cambia el contrato que ya les di a
T3/T4 como "fijado", y una firma en desuso el mismo día que se fija es peor que
preguntar.

## Contratos expuestos (para T3/T4)

```ts
// src/models/rate-limit.model.ts
export async function consumeRateLimit(input: {
  bucket: RateLimitBucket   // src/models/types.ts, ya existía
  subject: string           // CRUDO — email/teléfono ya normalizado a E.164/IP/id como string
  limit: number
  windowSeconds: number
}): Promise<RateLimitDecision>  // { allowed, remaining, retryAfterSeconds }, ya existía en types.ts
```

- No lanza excepción nunca (fail-open interno cubre RPC caída, fila vacía, y
  falta de `CREDENTIALS_ENCRYPTION_KEY`).
- `remaining` nunca negativo (criterio #4 de `01-tasks.md`, aplica igual con
  esta firma).
- No arma `RateLimitError` ni decide mensajes: eso es responsabilidad de quien
  llama (T3/T4), usando `RateLimitError` de `src/lib/errors.ts` y los límites
  de `RATE_LIMIT_POLICY` (`src/lib/rate-limit-policy.ts`), ambos ya existentes.

## Lo que NO toqué (y por qué)

- `src/models/types.ts`, `src/lib/rate-limit-policy.ts`, `src/lib/errors.ts`,
  `supabase/migrations/**` — ya estaban hechos, marcados de solo lectura.
- **`toApiError` (`src/lib/errors.ts`) no agrega el header `Retry-After`.** El
  criterio de aceptación #5 de `01-tasks.md` pide que un `RateLimitError` a
  través de `toApiError` dé `status: 429` **y** un header `Retry-After`, pero
  la implementación actual de `toApiError` devuelve `{ body, status }` sin
  ningún campo de headers — no distingue `RateLimitError` de un `DomainError`
  común. Como `errors.ts` está fuera de mi alcance, lo dejo reportado acá en
  vez de tocarlo: falta ensanchar el tipo de retorno de `toApiError` para
  poder llevar headers (tal como pedía el punto 5 de `01-tasks.md`), y el
  route handler que arme la respuesta 429 (T3/T4) necesita ese dato para
  poder devolver `Retry-After` en algún lado — hoy `RateLimitError.retryAfterSeconds`
  existe en la excepción pero `toApiError` lo descarta.

## Qué necesita probarse contra Postgres real (para `tests/db/`)

- `consume_rate_limit` incrementando de forma atómica bajo llamadas
  concurrentes (N requests simultáneas con el mismo `(bucket, subject)` deben
  dejar `count = N` exacto) — ya cubierto conceptualmente por el mismo patrón
  que `claim_store_pending_change`, pero vale un test propio dado que es una
  tabla nueva.
- `grant`/`revoke` de la función: `anon` y `authenticated` deben recibir
  `42501` al invocar `consume_rate_limit` vía PostgREST; solo `service_role`
  puede.
- RLS de `public.rate_limits`: sin policies, cualquier lectura desde
  `anon`/`authenticated` debe devolver 0 filas (o `permission denied`, dado que
  además no tienen grant de tabla).
- Que `window_start` se calcule dentro de la función (no lo mande el
  llamador): pasar el mismo `p_bucket`/`p_subject` dos veces con distinta
  hora del sistema debe dar ventanas distintas de forma determinística según
  `floor(epoch / window_seconds)`.

Todo lo anterior no se puede probar con mocks de `supabase-js` porque depende
de comportamiento real de Postgres (upsert atómico, grants, RLS).

## Verificación

- `npm run typecheck` — limpio.
- `npm run lint` — limpio (los 6 warnings preexistentes en `tests/**` no son
  míos, confirmado corriendo lint también con mi archivo stasheado).
- `npm test` — 8 tests fallan, pero **son preexistentes**: confirmado
  corriendo la suite completa con `rate-limit.model.ts` stasheado (mismo
  resultado, 8 failed / 336 passed). Ningún archivo de test importa
  `rate-limit.model.ts` todavía —eso es trabajo de `test-engineer` una vez que
  T3/T4 lo cableen.

## Pendientes / seguimiento (de la entrega inicial — resueltos abajo)

1. ~~Decidir fail-open/fail-closed por parámetro~~ → **resuelto**, ver
   actualización de cierre, punto 1.
2. **Sigue pendiente** (del hilo principal, a propósito): agregar
   `RATE_LIMIT_ENABLED` a `src/lib/env.server.ts`. Ver punto 3 de la
   actualización de cierre.
3. ~~`toApiError` no lleva `Retry-After`~~ → **resuelto**, ver actualización de
   cierre, punto 2.

---

## Actualización de cierre

El hilo principal revisó el reporte inicial y respondió con las tres
decisiones de abajo. Se aplicaron las dos primeras; la tercera queda
explícitamente afuera de mi alcance.

### 1. `onError: 'allow' | 'deny'`, repuesto — el prompt de lanzamiento estaba mal

Confirmado: mi prompt de lanzamiento simplificó de más y `01-tasks.md` tenía
razón. Firma final de `consumeRateLimit` en `src/models/rate-limit.model.ts`:

```ts
export async function consumeRateLimit(input: {
  bucket: RateLimitBucket
  subject: string
  limit: number
  windowSeconds: number
  onError?: 'allow' | 'deny'   // default 'allow'
}): Promise<RateLimitDecision>
```

Comportamiento en el `catch` (RPC caída, fila vacía, o falta
`CREDENTIALS_ENCRYPTION_KEY`):
- `onError: 'allow'` (default) → `{ allowed: true, remaining: input.limit, retryAfterSeconds: 0 }`. No se cuenta la llamada contra el límite.
- `onError: 'deny'` → `{ allowed: false, remaining: 0, retryAfterSeconds: FAIL_CLOSED_RETRY_AFTER_SECONDS }`, con `FAIL_CLOSED_RETRY_AFTER_SECONDS = 10`: como el valor real de `Retry-After` iba a salir de la ventana en Postgres —que es justo lo que falló— se usa una constante corta en vez de inventar un número basado en `windowSeconds`, que podría ser de horas.

**El razonamiento de qué bucket usa cuál, tal como lo escribió el hilo
principal, quedó como comentario largo arriba de la función** (no como lógica:
`consumeRateLimit` no conoce el bucket→política, eso lo decide el llamador).
Resumen:

- La regla "falso positivo peor que falso negativo" está calibrada para el
  camino de compra, y ahí casi siempre da `'allow'` por un motivo no obvio:
  esos baldes protegen operaciones que TAMBIÉN necesitan Postgres (crear un
  pedido, buscar por token, confirmar un cambio de pagos) — si la base no
  responde, la operación de fondo falla igual, así que negar por el rate
  limiter no cambia nada.
- Se invierte en `magic_link:*` porque `signInWithOtp` lo atiende Supabase
  Auth, un servicio aparte de esta tabla: puede seguir mandando mails aunque
  la RPC falle. Con `'allow'`, un error transitorio de Postgres abre la puerta
  a quemar los 30 mensajes/hora de todo el proyecto — el ataque que
  `magic_link:global` vino a frenar. `'deny'` ahí cuesta casi nada: si la base
  no responde, `/admin` no sirve para nada aunque el link entre.

**Guía para T3/T4** (quién pasa qué, dejado como comentario en el archivo):
`onError: 'deny'` en `magic_link:email`, `magic_link:email:day`,
`magic_link:ip`, `magic_link:global` y `payment_change:store`. `'allow'`
(default) en todo el resto — incluido `order:*`, donde negar por un fallo de
infraestructura no protege nada que Postgres no vaya a frenar solo.

Esto reemplaza al punto 4 de la entrega inicial ("DISCREPANCIA IMPORTANTE"):
ya no hay tal discrepancia, `payment_change:*` puede ser fail-closed.

### 2. `Retry-After` en `toApiError` — implementado en `src/lib/errors.ts`

El hilo principal me dio la propiedad de `src/lib/errors.ts` para este punto
puntual (no redefiní `RateLimitError`, que ya estaba ahí como contrato — solo
ensanché `toApiError`).

Cambio: `toApiError` pasó de devolver `{ body: ApiErrorBody; status: number }`
(tipo inline) a un tipo nombrado `ApiErrorResult` con un tercer campo opcional:

```ts
export type ApiErrorResult = {
  body: ApiErrorBody
  status: number
  headers?: Record<string, string>
}
```

`headers` es opcional a propósito: los 8 call sites existentes (todos en
`src/app/api/**/route.ts`) desestructuran `const { body, status } =
toApiError(...)` y siguen compilando sin tocarlos — verificado, ninguno se
editó.

Dentro de `toApiError`, se agregó una rama para `isRateLimitError(err)` **antes**
de la rama de `isDomainError(err)` — importa el orden: `RateLimitError extends
DomainError`, así que si se chequeara `isDomainError` primero, la rama de
`RateLimitError` nunca se alcanzaría. Esa rama arma
`headers: { 'Retry-After': String(Math.max(1, Math.ceil(err.retryAfterSeconds))) }`.

El `Math.max(1, ...)` es defensivo: `consumeRateLimit` puede devolver
`retryAfterSeconds: 0` en el camino de éxito (edge case: `count <= limit`, o
sea `allowed: true`, así que nadie arma un `RateLimitError` con eso) — pero
también en el fail-open (`onError: 'allow'` en el catch), que tampoco arma
`RateLimitError` porque `allowed` da `true`. El único camino real hacia
`RateLimitError` es `allowed: false`, que en Postgres siempre da
`retryAfterSeconds >= 1` (calculado con `greatest(0, ceil(...))`, y en fail-closed
da la constante `FAIL_CLOSED_RETRY_AFTER_SECONDS = 10`). El `Math.max(1, ...)`
queda igual como cinturón de seguridad: el criterio de aceptación de T2 pide
explícitamente "segundos enteros ≥ 1", y `Retry-After: 0` ni siquiera es un
valor válido de la especificación HTTP.

**Verificado**: `npm run typecheck` y `npm run lint` limpios después del
cambio (ver la sección de Verificación final más abajo).

### 3. Kill-switch `RATE_LIMIT_ENABLED` — se deja como está, a propósito

El hilo principal confirmó que agrega la variable a `src/lib/env.server.ts` él
mismo (ese archivo lo está tocando otro agente en paralelo ahora mismo, y
tocarlo desde acá también hubiera generado conflicto). **No hice ningún cambio
en `rate-limit.model.ts` para este punto**: sigue leyendo
`process.env.RATE_LIMIT_ENABLED` directo, con el comentario ya existente que
dice que es temporal y qué línea cambiar (`serverEnv().RATE_LIMIT_ENABLED
!== 'false'`) el día que la variable exista ahí.

La forma propuesta (`z.enum(['true', 'false']).default('true')`) quedó
confirmada como la que se va a usar.

## Verificación final (después de las tres correcciones)

- `npm run typecheck` — limpio. Corrido varias veces durante la sesión;
  en un punto intermedio el repo pasó por un estado transitorio raro (otro
  agente haciendo checkouts en la misma working copy — se vio un
  `HEAD detached` momentáneo), pero `git status` confirmó después que
  `rate-limit.model.ts` seguía presente y sin tocar, y el typecheck final se
  corrió ya con el repo estable en `qc-hardening`.
- `npm run lint` — limpio. Mismos 6 warnings preexistentes en `tests/**` (no
  míos: `order.schema.test.ts`, `mercadopago.adapter.test.ts`,
  `owner-invite-email.adapter.test.ts`), cero problemas nuevos.
- No corrí `npm test` de nuevo en esta segunda pasada porque ninguno de los
  dos archivos tocados tiene un test que lo importe todavía (confirmado en la
  entrega inicial: los 8 fallos preexistentes no tienen relación con rate
  limiting, y `errors.ts`/`rate-limit.model.ts` no aparecen en ningún stack
  trace de esos fallos).

## Contrato final para T3/T4 (reemplaza la sección de más arriba)

```ts
// src/models/rate-limit.model.ts
export async function consumeRateLimit(input: {
  bucket: RateLimitBucket
  subject: string                    // CRUDO; teléfono ya en E.164 vía phoneSchema
  limit: number
  windowSeconds: number
  onError?: 'allow' | 'deny'         // default 'allow' — ver guía de buckets arriba
}): Promise<RateLimitDecision>       // { allowed, remaining, retryAfterSeconds }, nunca tira

// src/lib/errors.ts
export type ApiErrorResult = { body: ApiErrorBody; status: number; headers?: Record<string, string> }
export function toApiError(err: unknown, context: string): ApiErrorResult
// Un RateLimitError da status 429 + headers: { 'Retry-After': '<segundos ≥ 1>' }.
// Los route handlers que ya usan toApiError pueden seguir ignorando `headers`
// sin romper; el que arme la respuesta 429 debería copiarlos a la Response.
```
