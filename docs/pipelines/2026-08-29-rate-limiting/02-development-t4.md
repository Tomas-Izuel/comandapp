# T4 — Cablear los caminos de mail — dev log (backend)

Agente: `senior-backend-engineer`. Archivos tocados: `src/controllers/admin.actions.ts`,
`src/controllers/staff.actions.ts`, `src/controllers/platform.actions.ts`. **No se tocó**
`src/models/courier.model.ts` ni `src/models/platform.model.ts`: ver "Por qué los dos
modelos quedaron intactos" más abajo.

## Qué se implementó

Los 5 caminos de mail de `01-tasks.md` §T4, sobre el contrato de T2
(`consumeRateLimit`/`RateLimitError`/`RATE_LIMIT_POLICY`, ya commiteado):

1. **Magic link** (`requestMagicLinkAction`, `admin.actions.ts`): se borró el `Map`
   `magicLinkAttempts`/`isMagicLinkThrottled`. Nueva función privada
   `checkMagicLinkBudget(email, ip)` que consume, **en orden y con corte apenas
   alguno bloquea**, `magic_link:email` → `magic_link:email:day` → `magic_link:ip` →
   `magic_link:global` (clave constante `'global'`). Los cuatro con
   `onError: 'deny'`.
2. **Soporte** (`requestPaymentSupportAction`): se borró el `Map` `supportRequests`.
   Nueva función privada `consumeSupportBudget(storeId)` que consume
   `support:store` (1/2min) y `support:store:day` (10/día), ambos `onError`
   default (`'allow'`). Sigue tirando 429, ahora vía `RateLimitError` en vez del
   `DomainError({status:429})` que había.
3. **Cambio de credenciales de pago** (`requestPaymentCredentialsChangeAction`,
   `requestCourierPaymentPolicyChangeAction`, `resendPendingChangeCodeAction`):
   las tres consumen `payment_change:store` con `onError: 'deny'`, **inmediatamente
   antes de `startPendingChange`** (después de validar el token de Mercado Pago /
   el body, para no gastar cupo en un request que ya iba a fallar por otro motivo).
4. **Invitación de repartidor** (`inviteCourierAction`, `resendCourierInviteAction`
   en `staff.actions.ts`): `inviteCourierAction` consume `courier_invite:store`
   (clave `storeId`) y `courier_invite:email` (clave `` `${storeId}:${email}` ``).
   `resendCourierInviteAction` consume **solo** `courier_invite:store` — ver
   "Decisiones" punto 3.
5. **Invitación de dueño** (`createStoreAction`, `resendOwnerInviteAction` en
   `platform.actions.ts`): `resendOwnerInviteAction` consume `owner_invite:store`
   (clave `storeId`) y `owner_invite:admin` (clave `userId` del platform admin).
   `createStoreAction` consume **solo** `owner_invite:admin` — ver "Decisiones"
   punto 4.
6. Todos los 429 visibles (soporte, cambio de pagos, invitaciones) llevan mensaje
   en español rioplatense con cuándo reintentar, vía un helper local
   `humanizeRetryAfter(seconds)` (duplicado, no exportado, en los 3 archivos —
   ver "Por qué duplicado y no compartido").
7. Se borraron los dos `Map` (`magicLinkAttempts`/`isMagicLinkThrottled` y
   `supportRequests`). Verificado: `grep` de esos identificadores en los 3
   archivos no devuelve nada.

La respuesta de `requestMagicLinkAction` **no cambió**: sigue siendo `{ ok: true,
data: undefined }` en el éxito, el throttle, y el email desconocido — ahora el
`log.warn` que marca el rechazo lleva `{ bucket: budget.bucket }` (el nombre del
balde, p. ej. `'magic_link:global'`) en vez del `{ ip }` que llevaba el código
viejo, porque ningún log nuevo puede llevar PII (regla del repo) y el nombre del
balde alcanza para diagnosticar qué se agotó.

## Discrepancia con `01-tasks.md` que resolví a favor del comentario ya commiteado en `rate-limit.model.ts`

**`01-tasks.md` §T4, punto 1, dice literal**: "Consumir, en orden, `magic_link:email`
(2/15min), `magic_link:email:day` (5/día), `magic_link:ip` (10/15min) y
`magic_link:global` (15/hora, clave constante), **todos con `onError: 'allow'`**."

Implementé **`onError: 'deny'`** en los cuatro, no `'allow'`. Motivo: el propio
código ya commiteado de `consumeRateLimit` (`src/models/rate-limit.model.ts`,
comentario largo sobre la línea 78) documenta la política **ya decidida** después
de que T2 encontrara y elevara esta misma discrepancia (ver
`02-development-backend-t2.md`, sección "Actualización de cierre", punto 1):
`magic_link:*` invierte la regla general porque `signInWithOtp` lo atiende
Supabase Auth —un servicio aparte de esta tabla— que puede seguir mandando mails
aunque la RPC de acá falle; con `'allow'` ahí, un hipo transitorio de Postgres
abre la puerta a quemar la cuota de 30 mensajes/hora de todo el proyecto, que es
justo el ataque que `magic_link:global` vino a frenar. El mensaje de lanzamiento
de esta tarea (recibido del hilo principal) confirma la misma decisión de forma
explícita: *"`onError` por camino, ya decidido: `'deny'` (fail-closed) en los
cuatro baldes de `magic_link:*` y en `payment_change:store`. `'allow'` (el
default) en todo el resto."*

`01-tasks.md` quedó con el texto de antes de que se resolviera la discrepancia.
No lo edité (no es mi archivo); lo señalo acá para que quede trazado. Si el hilo
principal prefiere `'allow'` para `magic_link:*` después de todo, es un cambio de
un solo argumento por sitio (4 en `admin.actions.ts`).

## Decisiones

### 1. `checkMagicLinkBudget` corta apenas un balde bloquea, no consume los cuatro siempre

Si `magic_link:email` ya está agotado, la función devuelve sin tocar
`magic_link:ip` ni `magic_link:global`. Es deliberado y no una optimización
menor: `magic_link:global` es el PRESUPUESTO compartido con las invitaciones
autenticadas (CLAUDE.md). Si cada reintento contra un email ya bloqueado
igual consumiera el balde global, un atacante que solo sabe UN email podría
drenar la mitad de la cuota del proyecto mandando el mismo pedido en loop —
exactamente lo que el balde global vino a evitar. Con el corte, un email ya
frenado deja de gastar cupo compartido después del primer rechazo.

Efecto en el criterio de aceptación 1b (probado con Postgres real, no acá):
un email **nuevo** sí atraviesa sus propios baldes (email/día/ip, todos en
cero para ese sujeto) y llega al de `global`, que si ya está en el límite lo
frena ahí — el orden importa para que esto funcione tal como lo describe el
criterio.

### 2. `payment_change:store` se consume DESPUÉS de validar el input, no apenas se autoriza

`requireOwnerForPaymentChange` corre primero siempre (regla de "autorizar
antes de gastar cupo"). Pero el consumo del balde de rate limit lo puse
después de `assertValidMercadoPagoToken` (en el camino de credenciales) y
después de parsear el body (en el de política de cobro), y no apenas se
resuelve el dueño. Motivo: si el token de Mercado Pago es inválido, la
request iba a fallar de todos modos — cobrarle a esa request parte del cupo
de 3/hora (6 mails/hora reales) por un typo es peor que dejar el chequeo de
input primero. El criterio de aceptación 5 (RPC caída → rechaza, no crea
`store_pending_changes` ni manda mail) se cumple igual: el consumo sigue
siendo estrictamente antes de `startPendingChange`.

### 3. `resendCourierInviteAction` NO consume `courier_invite:email`

El plan dice que el par de baldes (`courier_invite:store` +
`courier_invite:email`) protege "la invitación de repartidor", sin distinguir
alta de reenvío. Pero `resendCourierInviteAction` recibe `courierId`, no un
email: para conseguir el email haría falta repetir en la acción la misma
búsqueda que ya hace `resendCourierInvite` en el modelo
(`store_members` → `auth.admin.getUserById`), duplicando una llamada a la
Admin API de Supabase solo para computar la clave de un rate limit. Elegí
consumir únicamente `courier_invite:store` (10/hora) para el reenvío, que
alcanza sobrado para el criterio de aceptación 3 ("más de 10 veces en una
hora para la misma tienda → 429 y no llama a Resend"): con el balde por
tienda ya en 10/hora, ningún repartidor individual puede recibir más de 10
reenvíos/hora tampoco, porque comparten el mismo balde de tienda.

Si se quiere el balde por email también en el reenvío, la forma correcta es
que `resendCourierInvite` (en `courier.model.ts`) devuelva el email junto con
el resultado, o que la acción reciba el email como parámetro además del
`courierId` — cualquiera de las dos es un cambio de contrato, no algo que
resolví unilateralmente tocando el modelo.

### 4. `createStoreAction` NO consume `owner_invite:store`; solo `resendOwnerInviteAction` lo hace

`owner_invite:store` está keyed por `store_id` (00-architecture.md §5.3), y al
momento de `createStoreAction` la tienda **todavía no existe** — no hay
`store_id` contra el cual consumir el balde antes de crearla. Dos alternativas
que descarté:

- Consumir el balde **después** de que `createStoreWithOwner` devuelve el
  `storeId`: para entonces el mail de invitación ya salió (se manda dentro del
  modelo, fuera de cualquier chequeo), así que el consumo no bloquearía nada —
  sería puro teatro de contabilidad, y si por casualidad diera `allowed: false`
  (imposible en la práctica: la tienda es nueva, el balde arranca en 0),
  tiraría un `RateLimitError` sobre una operación que **ya tuvo éxito**, lo cual
  es peor que no chequear nada.
- Inventar un `store_id` provisorio: no existe tal cosa en el modelo de datos.

En cambio, `createStoreAction` consume `owner_invite:admin` (keyed por el
`userId` del platform admin) **antes** de crear la tienda: es la superficie de
abuso real de este camino ("un admin da de alta tiendas — o sea, invitaciones —
en ráfaga"), y no depende de que la tienda ya exista.
`resendOwnerInviteAction` sí consume ambos baldes, porque ahí el `storeId` ya
es un parámetro válido.

### 5. `requirePlatformAdmin()` se llama explícitamente en `platform.actions.ts`, antes solo corría dentro del modelo

Antes, `createStoreAction`/`resendOwnerInviteAction` delegaban toda la
autorización a `createStoreWithOwner`/`resendOwnerInvite` (que llaman
`requirePlatformAdmin()` puertas adentro). Para consumir `owner_invite:admin`
con la clave correcta (`userId` del admin) hace falta ese dato en la capa de
acciones, así que agregué la llamada ahí también. **No es una autorización
nueva ni un cambio de qué se exige** (criterio de aceptación 6): sigue siendo
exactamente `requirePlatformAdmin()`, la función está memoizada con `cache()`
de React, así que llamarla dos veces en el mismo request no agrega una
consulta extra a Postgres — la segunda lectura (dentro del modelo) resuelve
del caché. El orden se mantiene: autorización primero, balde después, modelo
al final.

### 6. Por qué `humanizeRetryAfter`/`consumeOrThrow` están duplicados en los 3 archivos, no en un módulo compartido

Un archivo con `'use server'` en la primera línea solo puede **exportar**
funciones async — no tipos, constantes ni helpers sincrónicos (regla del
repo, y además una restricción real del compilador de Next: exportar un
símbolo no-función desde un archivo `'use server'` rompe el build). La forma
correcta de compartir un helper así es moverlo a un `.controller.ts` e
importarlo desde las acciones. Pero `admin.controller.ts`,
`staff.controller.ts` y `platform.controller.ts` **no son propiedad de esta
tarea** (no están en la tabla de dueños de archivos de `01-tasks.md`), y tocar
un archivo fuera del carril asignado es exactamente lo que el reparto por
directorio busca evitar. Elegí duplicar los ~15 líneas de
`humanizeRetryAfter` + `consumeOrThrow` como funciones **privadas, no
exportadas** en cada uno de los 3 `.actions.ts` — mismo patrón que ya usaba
este código (`maskEmail`, `clientIp` en `admin.actions.ts` son helpers
sincrónicos/async no exportados que ya vivían así antes de esta tarea).

Si se quiere deduplicar, el movimiento correcto es crear
`src/controllers/rate-limit.controller.ts` (sin `'use server'`, como
`action-result.ts`) con estas dos funciones, e importarlo desde los 3
archivos. Lo dejo señalado en vez de crearlo yo, porque no es un archivo que
tenga dueño en el reparto de esta tarea.

## Por qué `courier.model.ts` y `platform.model.ts` quedaron sin cambios

`01-tasks.md` los lista como propiedad de T4, pero el propio texto de la
tarea es explícito para el caso de repartidores: *"El límite va en las
**actions**, no en los modelos, porque ahí está la sesión resuelta y
`requireStoreMembership` ya corrió."* Apliqué el mismo criterio al caso de
invitación de dueño por simetría (autorización y rate limit viven juntos en
la capa que ya resolvió permisos). Como consecuencia, ninguno de los dos
modelos necesitó una línea nueva — quedan como estaban, con `inviteCourier`,
`resendCourierInvite`, `createStoreWithOwner`, `resendOwnerInvite` intactos.
Si en algún momento se agrega un caller de estos modelos que NO pase por las
acciones de este repo (un cron, un script), ese caller va a necesitar su
propio chequeo de rate limit — hoy no existe ninguno.

## Contratos que expone este trabajo (para quien integre después)

Ninguno nuevo: T4 es puro cableado sobre el contrato de T2
(`consumeRateLimit`, `RateLimitError`, `RATE_LIMIT_POLICY`, `RateLimitBucket`).
No se tocó `src/models/types.ts` ni se agregó ningún tipo. Las 3 funciones
`.actions.ts` (`requestMagicLinkAction`, `inviteCourierAction`,
`createStoreAction`, etc.) mantienen exactamente sus firmas y tipos de
retorno de antes — el rate limiting es invisible a nivel de tipos, solo
cambia qué excepción puede salir de `toActionResult` (`RateLimitError` en vez
de nada, o en vez del `DomainError({status:429})` puntual que ya existía en
soporte).

## Verificación

- `npm run typecheck` — limpio.
- `npm run lint` — limpio en mis 3 archivos. Los 6 warnings preexistentes
  siguen en `tests/**` (`order.schema.test.ts`, `mercadopago.adapter.test.ts`,
  `owner-invite-email.adapter.test.ts`) — no son míos, confirmado corriendo
  lint también con mi diff stasheado (mismos 6 warnings, 0 errores).
- `npm test`: con mi diff, 11 failed / 333 passed (4 archivos con fallas).
  Corrido también con el diff stasheado: **8 failed / 336 passed** (3
  archivos), o sea mi cambio introduce **3 fallas nuevas**, las tres en
  `tests/services/admin-request-magic-link.actions.test.ts`. Es exactamente
  lo esperado: ese archivo testea el `Map` en memoria que borré (mockea
  `signInWithOtp` y cuenta llamadas directas, sin mockear `consumeRateLimit`
  ni `createAdminClient`), así que con el balde real detrás no hay forma de
  que pase sin reescribirlo. Los otros 8 fallos preexistentes
  (`platform-owner-invite.model.test.ts` por un `getClaims` sin mockear, y
  `owner-invite-email.adapter.test.ts` por un `idempotencyKey` con sufijo) no
  tienen relación con esta tarea — confirmado que fallan igual sin mi diff.

## Qué necesita reescribirse en `tests/` (para `test-engineer`)

- **`tests/services/admin-request-magic-link.actions.test.ts` está roto por
  diseño** y necesita reescribirse contra el nuevo mecanismo: mockear
  `consumeRateLimit` (o la RPC `consume_rate_limit` vía el cliente admin
  mockeado) en vez de contar llamadas a `signInWithOtp` para inferir el
  throttle. Los casos que hay que preservar del archivo viejo: la respuesta
  es siempre `{ ok: true, data: undefined }` (éxito, throttle, o email
  desconocido — nunca se distingue desde el cliente), `shouldCreateUser:
  false`, y el `emailRedirectTo`.
- **Criterio 1** ("3 llamadas mismo email en 15 min: solo 2 llegan a
  `signInWithOtp`"): mockear `consumeRateLimit` para que la 3ra llamada al
  bucket `magic_link:email` devuelva `allowed: false`, y verificar que
  `signInWithOtp` no se llamó esa vez.
- **Criterio 1b** (el más importante de la tarea, y el único que de verdad
  necesita Postgres real, no mocks): con `magic_link:global` agotado por
  llamadas previas contra un email A, un pedido con un email B **nunca antes
  usado** también tiene que fallar antes de `signInWithOtp` — esto ejercita
  el conteo real y compartido del balde `global` entre sujetos distintos, que
  un mock de `consumeRateLimit` por test no puede probar de forma
  convincente (mockearía el resultado, no probaría que el conteo es
  compartido). Necesita `tests/db/` contra Postgres real: dos emails
  distintos, mismo `magic_link:global`, verificar que el segundo se frena una
  vez que el primero (u otro previo) agotó el balde de 15/hora. En el mismo
  test de Postgres real, verificar que una invitación (`resendOwnerInvite` o
  `inviteCourier`) sigue funcionando con `magic_link:global` en cero cupo —
  es la prueba directa de que no comparten balde.
- **Criterio 2** ("el límite es por email, no por instancia"): con Postgres
  real, dos "instancias" (dos llamadas a `consumeRateLimit` sin estado
  compartido en memoria, simulando dos lambdas) tienen que ver el mismo
  contador para el mismo email — esto es justamente lo que fallaba antes y
  es el punto entero de la tarea.
- **Criterio 3** (`resendCourierInviteAction` >10/hora → 429, no llama a
  Resend): se puede probar con `consumeRateLimit` mockeado devolviendo
  `allowed: false` en la 11ª llamada — no necesita Postgres real, es lógica
  pura de la acción.
- **Criterio 4** (aislamiento multi-tenant): con Postgres real, dos
  `store_id` distintos consumiendo el mismo bucket (`courier_invite:store`,
  `owner_invite:store`, `payment_change:store`) no se pisan — esto ya lo tiene
  cubierto T2 en su lista de pendientes para `tests/db/`, pero vale repetirlo
  acá porque es el criterio de aceptación explícito de T4.
- **Criterio 5** (`payment_change:store` con la RPC caída → rechaza, no crea
  `store_pending_changes` ni manda mail): mockear `consumeRateLimit` (o el
  cliente admin que usa por debajo) para que tire, y verificar que
  `createPendingChange`/`sendPaymentChangeCode` nunca se llaman. Es lógica de
  la acción, no necesita Postgres real — el fail-closed en sí (qué pasa
  cuando la RPC real de Postgres falla) ya lo prueba T2 a nivel de
  `consumeRateLimit`.
- **Criterio 6** (autorización sin cambios): valdría un test que confirme que
  `requirePlatformAdmin()`/`requireStoreMembership()` siguen tirando ANTES de
  que se consuma cualquier balde — por ejemplo, un staff no-owner que llama
  `inviteCourierAction` debería fallar por autorización sin que
  `consumeRateLimit` se haya llamado ni una vez (se puede verificar con un
  spy que nunca se invocó).
- **Criterio 8** (ningún log con PII): grep estático sobre el diff, no hace
  falta un test de runtime — ya lo verifiqué a mano arriba.

## Bugs fuera de alcance, reportados y no tocados (tal como pedía el lanzamiento)

Ninguno de estos se tocó ni se intentó arreglar:

- La plantilla del magic link ignora `emailRedirectTo`; el repartidor
  aterriza en `/admin` en vez de `/repartidor`.
- Las invitaciones (repartidor y dueño) no tienen dedupe.
- Las invitaciones no escriben en `notifications`.

## Pendiente / seguimiento para el hilo principal

1. Confirmar la política de `onError` para `magic_link:*` (ver sección de
   discrepancia arriba): implementé `'deny'` siguiendo el comentario ya
   commiteado en `rate-limit.model.ts` y el mensaje de lanzamiento de esta
   tarea, no el texto literal de `01-tasks.md` (que quedó desactualizado tras
   la resolución de T2). Si se prefiere `'allow'`, es un cambio de 4
   argumentos en `admin.actions.ts`.
2. Si se quiere deduplicar `humanizeRetryAfter`/`consumeOrThrow` entre los 3
   archivos, hace falta crear `src/controllers/rate-limit.controller.ts` (sin
   dueño hoy en el reparto de T4) — no lo creé por estar fuera de mi
   propiedad de archivos.
3. Si se quiere que `resendCourierInviteAction` también gatee por
   `courier_invite:email`, `resendCourierInvite` (en `courier.model.ts`)
   necesita devolver el email del repartidor, o la acción necesita recibirlo
   como parámetro — cualquiera de las dos es un cambio de contrato que no
   tomé unilateralmente.
