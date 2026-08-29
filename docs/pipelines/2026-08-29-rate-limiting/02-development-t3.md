# T3 — Cablear el camino de pedidos — dev log (backend)

Agente: `senior-backend-engineer`. Archivos tocados (los tres, y únicamente
estos): `src/app/api/orders/route.ts`, `src/app/api/orders/lookup/route.ts`,
`src/app/api/orders/[token]/route.ts`.

Consume el contrato de T2 tal como quedó en su actualización de cierre
(`02-development-backend-t2.md`): `consumeRateLimit({ bucket, subject, limit,
windowSeconds, onError? })` y `toApiError` con `headers` opcional (`Retry-After`
para `RateLimitError`).

**Este documento tiene dos partes**, igual que el de T2: la entrega inicial
(como quedó escrita, sirve de registro de qué se evaluó y por qué) y una
**actualización de cierre** al final, con el candado `order:idempotency` ya
cableado después de que el hilo principal agregó el vocabulario que faltaba.
Si solo te interesa el estado final, andá directo a esa sección.

## Qué se implementó

### `POST /api/orders`

1. **Se borró el limitador en memoria completo**: `rateLimitBuckets`,
   `checkRateLimit`, `clientIp` (ya no hace falta acá — ver más abajo por qué),
   el barrido oportunista del 1% y el `rateLimited()` genérico. Nada de eso
   sobrevivió.
2. Orden final: `request.json()` → `createOrderSchema.safeParse` (acá se
   normaliza el teléfono a E.164 vía `phoneSchema`) → `enforceOrderRateLimits`
   → `submitOrder`. Los límites corren **después** de validar y **antes** de
   crear el pedido, tal como pide §5.3/T3.
3. `order:phone`: bucket `'order:phone'`, `subject: input.customerPhone` (ya
   normalizado, nunca el string crudo del form), límite y ventana desde
   `RATE_LIMIT_POLICY['order:phone']` (5 / 10 min). Si `!allowed`, tira
   `RateLimitError('Estás mandando pedidos muy seguido. Esperá un minuto y
   probá de nuevo.', retryAfterSeconds)` — `onError` no se pasa, así que queda
   en `'allow'` (default), que es lo que pide la guía de T2 para todo `order:*`.
4. `order:store`: bucket `'order:store'`, límite 300/10min, **nunca bloquea**.
   Si se excede, `log.warn('POST /api/orders', 'order:store por encima del
   umbral...', { storeSlug, count })` y se sigue de largo sin tocar el flujo.
   **Decisión: el `subject` es el `storeSlug`, no el `store_id` numérico** que
   dice la tabla de §5.3. Motivo: en este punto del handler no hay ningún
   `store_id` resuelto sin pagar una consulta extra a `stores` (createOrder la
   va a hacer de nuevo un instante después, así que sería una segunda lectura
   solo para esto). `consumeRateLimit` hashea el sujeto con HMAC-SHA256 antes
   de que toque Postgres, así que en la tabla es texto opaco de cualquier
   forma, y el slug identifica la tienda igual de bien — es inmutable para
   `authenticated` (los grants de `CLAUDE.md` solo dejan tocar `slug` a la
   plataforma). Como este bucket **nunca bloquea** (es un detector de
   anomalía, no un límite), la precisión de la clave importa menos que en
   `order:phone`. Si el hilo principal prefiere `store_id` literal para poder
   cruzar estos logs con otras tablas por id, es un cambio de una línea
   (resolver `getStoreBySlug(input.storeSlug)` antes de este chequeo), pero
   agrega un round trip a Postgres en el camino de compra por algo que nunca
   frena nada.
5. `toApiError` ahora devuelve `headers`; el catch de `POST` los reenvía:
   `NextResponse.json(errorBody, { status, headers })`.

### `GET /api/orders` (cotización)

Sin ningún límite de aplicación, tal como pide el punto 3 de la tarea. Se
borró también el límite `quote:ip` que tenía el código viejo (120/min). Queda
cubierto por el WAF.

### `POST /api/orders/lookup`

Se agregó `lookup:ip`: bucket `'lookup:ip'`, `subject` = IP de
`x-forwarded-for` (primer valor, sin normalizar más que `trim`), límite 20/60s
desde `RATE_LIMIT_POLICY['lookup:ip']`, `onError` default `'allow'`. Si se
excede, `RateLimitError('Estás consultando tus pedidos muy seguido. Esperá un
momento y volvé a intentar.', retryAfterSeconds)`. Mismo manejo de `headers`
en el catch.

### `GET /api/orders/[token]`

Sin ningún límite, tal como pide el punto 5 de la tarea (riesgo aceptado en
§5.7). Se agregó el `log.warn` que pide ese mismo punto cuando
`getOrderStatus` devuelve `null`: `{ ip: truncateIp(clientIp(request)) }`,
**sin el token** (es la única credencial del pedido) y **con la IP truncada**
(`203.0.x.x` para IPv4, `2001:db8::` para IPv6 — se corta antes del tercer
octeto/hexteto). El parámetro del handler pasó de `_request` (no usado) a
`request` porque ahora hace falta leer el header.

## Discrepancia con el criterio de aceptación #3 — reportada, no resuelta

**Este es el punto más importante de este reporte.**

Criterio #3 pide: *"N requests en paralelo con la misma `idempotencyKey`
siguen produciendo un solo pedido y una sola fila (la invariante existente no
se rompe) y consumen a lo sumo un cupo del balde."*

La primera mitad (**un solo pedido, una sola fila**) sigue intacta: no toqué
`createOrder`, la RPC `create_order` ni el índice único
`orders_idempotency_idx`. Esa invariante la garantiza Postgres, no este
archivo, y nada de lo que hice interfiere con eso.

La segunda mitad (**a lo sumo un cupo consumido**) **no la pude implementar
dentro de mi lane**, y lo reporto en vez de forzar una solución, tal como pide
el punto 2 del brief de lanzamiento ("Fuera de alcance: tocar
`checkout.controller.ts`, `order.model.ts` o la RPC `create_order`. Si hace
falta un cambio ahí, se reporta, no se hace").

### Por qué no se puede resolver solo con lo que tengo

Para no cobrar cupo en un reintento hace falta saber, ANTES de decidir si se
consume `order:phone`, si esta `idempotencyKey` ya generó un pedido. Evalué
tres caminos y los tres chocan con un límite explícito del plan:

1. **Consultar `orders` por `(store_id, idempotency_key)` desde acá.** Es
   exactamente "duplicar la búsqueda de la clave" que el brief prohíbe
   nombrando el caso: esa consulta ya existe, sin exportar, como
   `findOrderIdByIdempotencyKey` dentro de `order.model.ts` (función privada,
   no exportada, usada solo para resolver la carrera después de un `23505`).
   Escribir mi propia versión en `route.ts` duplica esa lógica en dos lugares
   que se van a desincronizar el día que cambie el criterio de idempotencia.
2. **Pedirle a `submitOrder`/`createOrder` una señal de "esto ya existía".**
   Hoy ninguno de los dos la da: `createOrder` devuelve `{ order, store }`
   igual para un pedido nuevo que para uno resuelto por la carrera de
   idempotencia, y `SubmitOrderResult` no tiene un campo `created`. Agregarlo
   es un cambio real (aunque chico) en `checkout.controller.ts`/
   `order.model.ts`, que están fuera de mi lane.
3. **Usar `consumeRateLimit` mismo como candado atómico de "¿ya vi esta
   clave?"**, con un bucket ad-hoc (`subject: idempotencyKey`, `limit: 1`) que
   no está en `RATE_LIMIT_POLICY`. Lo descarté: `RateLimitBucket`
   (`src/models/types.ts`) es una unión **cerrada a propósito**, y el propio
   comentario del archivo lo dice explícito — "inventar uno suelto en un
   `string` da un límite que no existe y que nadie configuró". Aunque la
   migración no tiene un `CHECK` sobre la columna `bucket` (es `text` libre) y
   esto funcionaría en tiempo de ejecución, ir en contra de una invariante
   documentada así en un archivo de otro agente (T1) para esquivar un límite
   de lane es exactamente el tipo de atajo que un review tendría que
   rechazar. No lo hice.

Los tres caminos reales requieren tocar un archivo que no es mío. Implementé
lo que se puede resolver enteramente en `route.ts` (el orden
validar→limitar→crear, tal como pide el punto 2 de la tarea) y dejo esto
como hallazgo.

### Impacto real, acotado

- **No hay pedidos duplicados ni plata perdida.** El invariante de negocio que
  importa (una compra, un pedido) sigue protegido por la base, no por esto.
- El costo es puramente de cupo: **un reintento (secuencial o en paralelo) de
  la misma `idempotencyKey` gasta un cupo de `order:phone` por cada intento**,
  igual que un pedido nuevo. Con el límite en 5/10min, esto solo se nota si un
  cliente reintenta la MISMA compra más de 5 veces en la ventana — en ese caso
  extremo, el pedido ya está creado (por el primer intento que pasó), pero un
  reintento tardío puede recibir 429 en lugar de un 200 silencioso. El cliente
  no pierde el pedido: lo tiene, solo que esa respuesta puntual sale como
  error. El frontend (T6) debería tratar el 429 en el flujo de reintento
  consultando el pedido por token si ya lo tiene, no reintentando en loop.
- Para **N pedidos genuinamente en paralelo con clave NUEVA** (el escenario
  literal del criterio #3), cada uno de los N va a intentar consumir
  `order:phone` por su cuenta: si N > 5, los que exceden el límite reciben 429
  aunque terminen resolviendo al mismo pedido vía la carrera de Postgres. Esto
  es lo que un test de concurrencia estricto (8 requests en paralelo, límite
  5) va a encontrar. Ya lo dejo dicho acá para que `test-engineer` no lo
  descubra como sorpresa: **es un hallazgo conocido, no un bug que se me
  escapó.**

### Propuesta concreta para cerrar esto (para el hilo principal)

La opción más barata, sin tocar `order.model.ts`/`checkout.controller.ts`/la
RPC:

1. Agregar `'order:idempotency'` a la unión `RateLimitBucket`
   (`src/models/types.ts`).
2. Agregar una entrada a `RATE_LIMIT_POLICY` (`src/lib/rate-limit-policy.ts`),
   por ejemplo `{ limit: 1, windowSeconds: 600 }` (la misma ventana que
   `order:phone`).
3. En `route.ts` (yo, en un follow-up), antes de `enforceOrderRateLimits`:
   ```ts
   const dedupe = await consumeRateLimit({
     bucket: 'order:idempotency',
     subject: parsed.data.idempotencyKey,
     limit: RATE_LIMIT_POLICY['order:idempotency'].limit,
     windowSeconds: RATE_LIMIT_POLICY['order:idempotency'].windowSeconds,
   })
   if (dedupe.allowed) {
     // primera vez que se ve esta clave en la ventana: recién acá se gasta
     // el cupo real de order:phone/order:store.
     await enforceOrderRateLimits(parsed.data)
   }
   // si no, es un reintento: se salta directo a submitOrder, que ya sabe
   // resolverlo sin crear una fila nueva.
   ```
   Esto funciona porque `consume_rate_limit` es un `insert ... on conflict do
   update` atómico: de N llamadas paralelas con el mismo `(bucket, subject,
   window)`, solo la primera consigue `count == 1` (`allowed: true`); el resto
   ve `count > 1` y sabe que perdió la carrera, sin necesidad de tocar
   `orders`. Es la misma primitiva que ya construyó T2, aplicada a un
   propósito distinto del que se documentó — por eso necesita las dos líneas
   de vocabulario (`types.ts`/`rate-limit-policy.ts`) antes de poder usarse
   sin violar la unión cerrada.
4. Alternativa si se prefiere no tocar el vocabulario de buckets: que
   `createOrder` (`order.model.ts`) devuelva un flag `created: boolean` (`true`
   solo cuando el insert fue el que ganó la carrera de idempotencia, `false`
   cuando se resolvió por `findOrderIdByIdempotencyKey`), y que
   `SubmitOrderResult` lo propague. Con eso, `route.ts` podría, en teoría,
   invertir el orden (crear primero, cobrar cupo solo si `created === true`) —
   pero esto reintroduce el problema de "no crear el pedido si el límite ya
   está agotado" (criterio #2), así que en la práctica la opción 1-3 es
   estrictamente mejor: no requiere decidir un orden distinto.

## Verificación

- `npm run typecheck` — limpio.
- `npm run lint` — limpio en mis 3 archivos. Los 6 warnings que aparecen son
  preexistentes en `tests/**` (no son míos, no los toqué).
- `npm test` — 333 passed / 11 failed. **Los 11 fallos son preexistentes y no
  tocan mis archivos**: los 4 archivos que fallan son
  `tests/controllers/require-backoffice-session.test.ts`,
  `tests/models/platform-owner-invite.model.test.ts`,
  `tests/services/admin-request-magic-link.actions.test.ts` y
  `tests/services/owner-invite-email.adapter.test.ts` — todos del lado de
  `admin.actions.ts`/`platform.model.ts` (lane de T4, presumiblemente en
  progreso en paralelo). Confirmé que **todos** los tests de `orders`
  (`tests/db/order-state-machine.test.ts`,
  `tests/db/expire-pending-orders.test.ts`, `tests/db/grants-orders.test.ts`,
  `tests/db/create-order-rpc.test.ts`, `tests/models/order.schema.test.ts`)
  pasan en verde.

## Qué necesita probarse (para `test-engineer`)

Los 9 criterios de aceptación de T3, uno por uno:

1. **Mismo teléfono, 6 pedidos en 10 min → el 6to da 429** con
   `Retry-After` (header) y mensaje en castellano que dice "esperá un minuto".
   Probable con mocks de `consumeRateLimit` (o contra Postgres real si se
   corre con Docker) — no necesita DB real para el HTTP contract, sí para
   confirmar que el conteo real incrementa (eso ya lo prueba T2 contra
   Postgres).
2. **El pedido nº 6 no crea fila en `orders` ni preferencia en MP.** Se prueba
   mockeando `submitOrder`/`priceCartForStore` y confirmando que NO se llaman
   cuando `consumeRateLimit` devuelve `allowed: false`.
3. **Concurrencia con la misma `idempotencyKey`**: la mitad de este criterio
   (un solo pedido, una fila) **YA la prueba** `tests/db/create-order-rpc.test.ts`
   (contra Postgres real) y no necesita nada nuevo. La otra mitad ("a lo sumo
   un cupo") **hoy no se cumple** por el hallazgo de arriba — recomiendo que
   el test la marque como `.todo()` o documente el gap en vez de fallar en
   rojo sin contexto, y que se re-habilite cuando se implemente la propuesta
   de la sección anterior. Esto necesita Postgres real (la atomicidad del
   incremento es lo que se está probando).
4. **`order:store` no bloquea**: mockear `consumeRateLimit` para que devuelva
   `allowed: false` en `order:store` y confirmar 201 + que se llame
   `log.warn` (se puede espiar `log.warn` con `vi.spyOn`).
5. **Aislamiento multi-tenant**: agotar `order:store` de una tienda no debe
   afectar a otra. Esto se prueba mejor contra Postgres real
   (`tests/db/`): dos `store_id`/slugs distintos, mismo bucket, `subject`
   distinto tras el HMAC → filas distintas en `rate_limits`. Con mocks se
   puede confirmar que el `subject` pasado a `consumeRateLimit` es
   efectivamente el `storeSlug` de cada request y no una constante compartida.
6. **`RATE_LIMIT_ENABLED=false` → comportamiento idéntico al de antes.** Esto
   lo garantiza enteramente `rate-limit.model.ts` (T2): `consumeRateLimit`
   devuelve `unlimited(limit)` sin tocar Postgres. Un test de integración
   contra Postgres real con la env var en `false` confirmaría que **no** se
   escribe ninguna fila en `rate_limits`.
7. **Fail-open**: si `consumeRateLimit` tira/falla, el pedido se crea igual.
   Ya está cubierto por el `onError: 'allow'` default de T2 (no le paso
   `onError` a ninguna de mis dos llamadas de `order:*`), pero vale un test de
   integración que simule la RPC fallando y confirme `log.error` + 201.
8. **`lookup:ip` > 20/60s → 429.** Test directo con mocks de
   `consumeRateLimit` sobre `POST /api/orders/lookup`, o contra Postgres real
   para la ventana fija.
9. **Ningún log de estos 3 archivos lleva teléfono, email ni `public_token`.**
   Se puede grep-linear sobre el código (estático) más un test que capture los
   argumentos de `log.warn`/`log.error` en los casos que los disparan y
   confirme que no aparece `customerPhone`/`customerEmail`/`token` en los
   `fields`. Yo mismo lo revisé a mano: `order:phone` loguea sin el número,
   `order:store` loguea `storeSlug` (no PII), `[token]` loguea la IP truncada
   sin el token.

## Contratos consumidos (sin cambios de mi parte)

- `consumeRateLimit` y `RateLimitError` — tal como los dejó T2 en su
  actualización de cierre (con `onError?`).
- `toApiError` — uso el `headers` que ahora devuelve; no lo modifiqué.
- `createOrderSchema`, `orderLookupSchema`, `phoneSchema` — sin cambios, solo
  los uso.
- `RATE_LIMIT_POLICY` — solo leo `order:phone`, `order:store`, `lookup:ip`.

## Pendiente para el hilo principal

~~Ver la sección "Propuesta concreta para cerrar esto" arriba~~ → **resuelto**,
ver la actualización de cierre debajo.

---

## Actualización de cierre

El hilo principal agregó el vocabulario que faltaba (commiteado, no lo toqué
yo): `'order:idempotency'` en la unión `RateLimitBucket`
(`src/models/types.ts`) y `{ limit: 1, windowSeconds: 10 * 60 }` en
`RATE_LIMIT_POLICY` (`src/lib/rate-limit-policy.ts`). Con eso ya no hace falta
el bucket ad-hoc que descarté en la entrega inicial (punto 3 de "por qué no se
puede resolver solo con lo que tengo") ni tocar ningún archivo fuera de mi lane.

### El gate, cableado en `enforceOrderRateLimits`

`src/app/api/orders/route.ts` ahora consume `order:idempotency` **antes** que
`order:phone`/`order:store`, con `subject: input.idempotencyKey` y `limit: 1`:

```ts
const dedupeDecision = await consumeRateLimit({
  bucket: 'order:idempotency',
  subject: input.idempotencyKey,
  limit: dedupePolicy.limit,
  windowSeconds: dedupePolicy.windowSeconds,
})
if (!dedupeDecision.allowed) return // reintento: no gasta cupo real
// ... acá sí se consumen order:phone y order:store
```

Por qué esto SÍ satisface "a lo sumo un cupo" (a diferencia del bucket ad-hoc
que había descartado): `consume_rate_limit` incrementa con `insert ... on
conflict do update set count = count + 1` en una sola sentencia, que Postgres
resuelve serializando por el lock de la fila `(bucket, subject, window_start)`.
De N requests concurrentes con la misma `idempotencyKey`, la base entrega los
incrementos en orden estricto: exactamente una ve `count == 1` (`allowed:
true` porque `1 <= limit`) y el resto ve `count >= 2` (`allowed: false`
porque `count > limit`). La que gana es la única que sigue a `order:phone`/
`order:store` y paga cupo real; todas las demás vuelven directo a
`submitOrder`, que las resuelve por la carrera de idempotencia existente en
`create_order` (sin tocarla) y les devuelve el mismo pedido. No hay ventana
donde dos requests puedan ver `count == 1` a la vez: es la misma primitiva
atómica que ya prueba `tests/db/create-order-rpc.test.ts` para el índice de
`orders`, aplicada acá al conteo en vez de al insert.

No abre un bypass de `order:phone`: reusar una `idempotencyKey` nunca crea un
pedido nuevo (eso lo sigue arbitrando el índice único de `orders`, intacto),
así que un atacante no puede generar pedidos ilimitados reciclando la misma
clave — solo puede volver a pedir el mismo pedido, que ya existe.

### Los dos cuidados que pidió el hilo principal

1. **`onError` en el dedupe queda en default (`'allow'`)**: no lo paso
   explícito, y dejé el motivo en el comentario del código — si la RPC falla,
   todas las requests ven "primera vez" y pagan los baldes reales, degradado
   pero correcto para el camino de compra (nadie se queda sin cupo por un
   hipo de Postgres).
2. **Un reintento (`dedupeDecision.allowed === false`) nunca puede recibir
   429**: el `return` temprano salta `order:phone` y `order:store` enteros,
   así que no hay ningún camino donde un reintento dispare `RateLimitError`.
   Verificado leyendo el flujo: la única función que arma un `RateLimitError`
   dentro de `enforceOrderRateLimits` está DESPUÉS de ese `return`.

### Criterio de aceptación #3 — CUMPLIDO

Con el gate cableado, las dos mitades del criterio quedan satisfechas:

- **Un solo pedido, una sola fila** — sin cambios, lo sigue garantizando el
  índice único de `orders` (no tocado).
- **A lo sumo un cupo del balde** — ahora sí, por la atomicidad de
  `order:idempotency` explicada arriba: de N requests paralelas con la misma
  clave, como mucho una consume `order:phone`/`order:store`.

Retiro la recomendación de `.todo()` que había dejado para este criterio: ya
es un test real, no un gap documentado.

### Verificación (después del cableado)

- `npm run typecheck` — limpio.
- `npm run lint` — limpio en mis 3 archivos; mismos 6 warnings preexistentes
  en `tests/**` (no son míos).
- `npm test` — mismo resultado que antes del cableado: 333 passed / 11
  failed, los 11 preexistentes en el lane de T4
  (`require-backoffice-session.test.ts`, `platform-owner-invite.model.test.ts`,
  `admin-request-magic-link.actions.test.ts`,
  `owner-invite-email.adapter.test.ts` — ninguno toca `orders`). Todos los
  tests de `orders` (`tests/db/order-state-machine.test.ts`,
  `tests/db/expire-pending-orders.test.ts`, `tests/db/grants-orders.test.ts`,
  `tests/db/create-order-rpc.test.ts`, `tests/models/order.schema.test.ts`)
  siguen en verde.

### Qué necesita probarse — reemplaza el punto 3 de la sección anterior

**Concurrencia con la misma `idempotencyKey` (contra Postgres real,
`tests/db/` o un test de integración con el stack levantado):**

- N requests en paralelo (`Promise.all`, con N > `order:phone.limit` para que
  el test sea exigente — por ejemplo N=8 contra un límite de 5) con la misma
  `idempotencyKey`, mismo teléfono, mismo `storeSlug` nuevo (nunca usado
  antes) deben terminar en: **un solo pedido creado** (fila única en
  `orders`, ya cubierto por `create-order-rpc.test.ts`) y **`rate_limits`
  con como mucho una fila de `count == 1` para `(bucket='order:phone',
  subject=hash(teléfono))`** dentro de la ventana — es decir, el balde real
  quedó en 1, no en N. Se puede verificar consultando `public.rate_limits`
  directo (con `service_role`) después de la ráfaga.
- Un test más chico y determinístico: dos llamadas SECUENCIALES a
  `consume_rate_limit('order:idempotency', hash(key), 600, 1)` con la misma
  clave — la primera debe dar `allowed=true, count=1`; la segunda,
  `allowed=false, count=2`. Esto prueba la primitiva sola, sin pasar por HTTP.
- Confirmar que un reintento (segunda llamada con la misma `idempotencyKey`,
  ya sea concurrente o después de que el primer pedido se creó) nunca produce
  un 429 en `POST /api/orders`: debe dar 201 con el mismo `token`/`shortCode`
  que la primera respuesta.

El resto de la guía de testing (puntos 1, 2, 4-9) de la sección anterior sigue
vigente sin cambios.

### Contratos consumidos, actualizado

Se suma a la lista de la entrega inicial: `RATE_LIMIT_POLICY['order:idempotency']`
(`{ limit: 1, windowSeconds: 600 }`, agregado por el hilo principal en
`src/lib/rate-limit-policy.ts`) y el valor `'order:idempotency'` de
`RateLimitBucket` (`src/models/types.ts`). Ninguno de los dos archivos lo
edité yo.
