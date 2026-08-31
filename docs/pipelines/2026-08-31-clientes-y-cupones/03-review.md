# Code review — Entrega A (Clientes)

Rama `feat/clientes-y-cupones` contra `main` (todo el slice está sin commitear
todavía: `git status` muestra los archivos de T0A/T1A/T2A/T3A como
modificados/untracked, no hay commits nuevos sobre `main`).

## Veredicto: **PASA**

*(Actualizado tras el fix del hilo principal sobre el Hallazgo 1 — ver
"Re-verificación" más abajo. El resto de este documento, salvo esa sección y
esta cabecera, queda tal como se escribió en la primera pasada.)*

El bloqueante que impedía commitear (§Hallazgo 1, `display_name` sin filtrar
por facturable) está corregido en la migración con un `coalesce` de tres
ramas, lo revisé de nuevo específicamente y cierra el hallazgo sin abrir uno
nuevo. No quedan bloqueantes. Quedan cuatro ítems de deuda anotada, no
bloqueantes, listados en "Los tres puntos pedidos, dictaminados" y en el nuevo
punto 4 de esa sección (metadata de tabs del panel).

## Alcance revisado

`git status --short`:

```
 M src/app/legal/privacidad/page.tsx
 M src/app/legal/terminos/page.tsx
 M src/lib/rate-limit-policy.ts
 M src/lib/supabase/database.types.ts
 M src/models/schemas/platform.schema.ts
 M src/models/types.ts
 M src/views/admin/shell.tsx
?? src/app/admin/(app)/clientes/
?? src/app/baja/
?? src/controllers/customers.actions.ts
?? src/controllers/customers.controller.ts
?? src/controllers/unsubscribe.actions.ts
?? src/models/customer.model.ts
?? src/models/schemas/customer.schema.ts
?? src/views/admin/clientes/
?? src/views/unsubscribe/
?? supabase/migrations/20260901120000_clientes.sql
```

11 archivos nuevos + 7 modificados, ~850 líneas nuevas contando la migración.
Leí el diff completo (no solo el stat), el código final de cada archivo nuevo,
`00-architecture.md` (§5.1 a §5.12), `01-tasks.md` (T0A–T3A), los tres
`02-development-*.md`, y crucé contra `CLAUDE.md`/`PRODUCT.md`. Corrí las
skills `supabase-postgres-best-practices`, `supabase`, `impeccable`
(`craft-floor.md`) y `web-design-guidelines` como lentes de auditoría.

---

## Hallazgos

### 1. [RESUELTO — ver re-verificación] `display_name` no filtraba por "facturable": contradecía §5.2 y el criterio de aceptación T1A #4

> **Estado: corregido y re-verificado.** Ver "Re-verificación del Hallazgo 1"
> al final de este documento. Se deja el hallazgo original completo abajo
> porque documenta el escenario de falla y sigue siendo la referencia para
> entender por qué el `coalesce` de tres ramas tiene esa forma.

**`supabase/migrations/20260901120000_clientes.sql:169` (estado original, ya corregido)**

```sql
coalesce((array_agg(o.customer_name order by o.created_at desc))[1], ''),
```

`private.recalc_store_customer` recalcula `display_name` tomando el
`customer_name` del pedido **más reciente por `created_at`, sin filtrar por
`order_is_customer_spend`**. Pero `orders_count`, `total_spent_cents`,
`cancelled_orders_count`, `first_order_at` y `last_order_at` sí llevan el
filtro `filter (where private.order_is_customer_spend(...))`. Es una
inconsistencia dentro de la misma sentencia: unas columnas del mismo `select`
respetan el predicado de "plata gastada" y una no.

Esto contradice `00-architecture.md` §5.2 de forma literal — la tabla de los
"tres conflictos resueltos" dice explícitamente: *"Mismo teléfono, dos
nombres → `display_name` = el nombre del **pedido facturable más
reciente**."* — y el criterio de aceptación T1A #4 en `01-tasks.md`: *"Dos
pedidos del mismo teléfono con nombres distintos → una sola fila,
`display_name` = el del pedido **facturable** más reciente."*

**Escenario concreto de falla:** un cliente hace un pedido pagado en el local
como "Juan Pérez" (facturable). Al día siguiente arranca un pedido online,
tipea apurado "juan" (sin apellido) y lo abandona sin pagar (`pending`, no
facturable). El `INSERT` de ese segundo pedido dispara igual el trigger
(`AFTER INSERT ... FOR EACH ROW`, sin condición de estado), y como el
`array_agg` que arma `display_name` no filtra por facturable, el padrón pasa a
mostrar "juan" al dueño — un cliente que le pagó $8.000 aparece con el nombre
mal tipeado de un pedido que nunca se cobró. Peor: `buildCustomerWhatsappMessage`
(T2A) usa `firstToken(displayName)` para armar el saludo de reactivación, así
que el mensaje de WhatsApp le queda "¡Hola juan!" en minúscula a un cliente que
sí se identificó bien la primera vez.

**Ya confirmado por un test independiente:** `test-engineer` escribió
`tests/db/store-customers.test.ts:108` ("`display_name` toma el nombre del
pedido FACTURABLE más reciente...") con la expectativa correcta y dejó el
comentario *"HALLAZGO ... hoy esto da 'Pedro' en vez de 'Juan'"* — coincide
exactamente con lo que encontré leyendo la migración, así que no es una lectura
aislada mía.

**Arreglo sugerido (no lo implemento, es una migración y ese archivo es del
hilo principal):** el `array_agg(o.customer_name order by o.created_at desc)`
necesita el mismo `filter (where private.order_is_customer_spend(...))` que ya
llevan las demás columnas, con un fallback al agregado sin filtrar solo para
el caso "cero pedidos facturables todavía" (que es el único caso legítimo para
mostrar el nombre de un pedido no facturable — está cubierto por el `email` de
la misma fila, que si no tiene filtro es porque el plan tampoco lo pide para
`email`, ver Hallazgo 2 más abajo por qué esa asimetría sí es correcta).

---

### 2. [Sin acción de código — nit informativo] La asimetría `display_name` vs. `email` en el plan es real, no un descuido

Aclaración para quien arregle el Hallazgo 1: `email` **no** lleva el filtro de
facturable en `recalc_store_customer` (`coalesce((array_agg(o.customer_email
order by o.created_at desc) filter (where o.customer_email is not null))[1],
...)`), y eso está bien — §5.2 solo dice *"email = el último mail no nulo
visto"*, sin condición de facturable. No confundir las dos columnas al
corregir el Hallazgo 1: solo `display_name` necesita el filtro nuevo.

---

### 3. [Mayor — decisión pedida explícitamente] "Tus derechos" en `/legal/privacidad` queda en tensión con "el padrón no se borra nunca"

**`src/app/legal/privacidad/page.tsx:138-145`** (sección sin tocar por T3A,
intacta desde antes de este feature):

> *"Podés pedirnos acceder, corregir o borrar tus datos escribiéndonos a...
> Esto se enmarca en la Ley 25.326."*

**Mi lectura, precisada:** el texto no es falso, pero después de este feature
queda impreciso de una forma concreta y verificable, no solo "incómodo de
honrar". La sección nueva, dos párrafos arriba (`"El padrón del local"`), dice
que la fila *"se conserva mientras el local use la plataforma"* y no promete
un plazo de borrado — decisión de producto correcta y bien escrita (el
comentario del archivo la defiende con el argumento correcto: borrar la fila
pierde la baja de marketing). Pero "borrar" en la sección de derechos, sin
matiz, es una promesa que la implementación **no puede sostener** salvo que la
persona directamente no vuelva a comprarle a ese local:

- `display_name` y `email` del padrón **se reconstruyen enteros desde
  `orders`** en cada evento de pedido (`private.recalc_store_customer`
  recalcula el agregado completo, no lo incrementa). Si a mano se vaciara el
  nombre/mail de una fila de `store_customers` para "honrar" un pedido de
  borrado, **el próximo pedido de ese mismo teléfono los vuelve a escribir**
  desde `orders.customer_name`/`customer_email` — que en sí mismos no se
  tocan ni se pueden tocar por este mecanismo. No es que sea trabajoso honrar
  el pedido de borrado: es que la fila **no se sostiene borrada** si la
  persona sigue siendo cliente. La arquitectura ya llega a esta misma
  conclusión en otro lugar (§5.3.3: *"la próxima compra la recrearía
  limpia"*) — acá se aplica a un derecho que el texto legal promete sin esa
  salvedad.
- El verdadero registro (`orders.customer_name/phone/email`, uno por pedido)
  no tiene ningún mecanismo de borrado ni antes ni después de este feature:
  es el historial contable del local, y de ahí es de donde el padrón se
  reconstruye.

**Decisión:** el texto **no alcanza tal cual**, pero esto es algo para
**decidir antes de anunciar el feature puertas afuera, no antes de
commitear**. Es una sección preexistente que T3A correctamente no tocó por
instrucción del plan (§5.12.5.1), y precisarla bien es una decisión de
producto/legal — no algo que un dev agent deba improvisar ni algo que
bloquee integrar Entrega A. Sugerencia concreta para esa iteración de texto,
sin inventar un camino de autoservicio que no existe: mantener "corregir" tal
cual (es cierto: nombre, nota y baja se pueden ajustar a mano por ese canal) y
calificar "borrar" con la salvedad real — que el padrón de un cliente que
sigue comprándole a ese local se reconstruye desde su historial de pedidos en
cada compra nueva, así que un borrado ahí no es durable mientras la relación
comercial siga activa. Es la misma honestidad que ya se aplicó en el párrafo
de retención de esa misma sección nueva — falta extenderla a "Tus derechos".

---

### 4. [Menor] La tab "Cupones" en `/admin/clientes` es un link muerto mientras Entrega B no esté integrada

**`src/views/admin/clientes/clientes-tabs.tsx:19`**

```ts
{ href: '/admin/clientes/cupones', label: 'Cupones' },
```

Documentado y aceptado explícitamente en el propio código (línea 9 del
comentario) y en el informe de T2A: *"es un link muerto hasta que ese slice se
integre, esperado."* Si Entrega A se commitea y se despliega a producción
antes que Entrega B, el dueño de cualquier local va a ver una tab "Cupones"
que da 404. No es una regla dura violada (no hay ningún dato ni capacidad
expuesta de más), pero si el plan de despliegue permite que A salga sola a
producción, vale la pena esconder la tab hasta que T4B exista, en vez de
mostrar un 404 a un usuario real. Deuda anotada, no bloqueante — asumo que A y
B se integran juntas antes de deploy, dado que `01-tasks.md` dice "B no
arranca hasta que A esté integrada", lo cual sugiere que ambas se completan
antes de un release visible al dueño.

---

### 5. [Nit — arquitectura, ya señalado por el propio T3A] `unsubscribe.actions.ts` mezcla lectura y escritura en un `.actions.ts`

**`src/controllers/unsubscribe.actions.ts`** — `getUnsubscribeTargetAction`
(lectura, la consume `src/app/baja/[token]/page.tsx`, un Server Component) y
`confirmUnsubscribeAction` (escritura, la consume el Client Component
`unsubscribe-button.tsx` y el route handler de one-click) viven en el mismo
archivo `.actions.ts`.

**Veredicto pedido explícitamente — dictamen:** no rompe ninguna regla dura.
El archivo solo exporta funciones async (cumple el requisito técnico real de
Next: un módulo con `'use server'` en la primera línea solo puede exportar
async functions); los helpers síncronos (`humanizeRetryAfter`, `clientIp`,
`consumeUnsubscribeBudget`) **no están exportados**, así que no violan esa
regla tampoco. Y no agrega capacidad: `getUnsubscribeTargetAction` expone
exactamente la misma información que ya sale por el `GET` de la página, está
detrás del mismo balde de rate limiting (`unsubscribe:ip`) que la escritura, y
no acepta ningún parámetro que la lectura por HTML no tuviera ya.

Dicho eso, **es una desviación real de la convención documentada**
(`.controller.ts` con `server-only` para lecturas que consume un Server
Component, `.actions.ts` para lo que consume un Client Component) y el propio
T3A la señaló sin animarse a tocarla por no ser dueño de `controllers/`. Mi
recomendación: mover `getUnsubscribeTargetAction` a un `unsubscribe.controller.ts`
nuevo con `import 'server-only'` (calcando `customers.controller.ts`, que en
este mismo slice hace exactamente esa separación bien), y dejar
`confirmUnsubscribeAction` sola en `unsubscribe.actions.ts`. Es un refactor de
minutos y no bloquea el commit de hoy, pero conviene resolverlo antes de que
Entrega B agregue más superficie a este mismo archivo.

---

### 6. [Nit] Comentario redundante en el `INSERT` del backfill vs. `recalc_store_customer`

No es un hallazgo de código, es solo una observación de mantenibilidad: el
backfill (`supabase/migrations/20260901120000_clientes.sql:427-439`) y el
trigger llaman a la misma función `private.recalc_store_customer`, así que el
Hallazgo 1 se corrige en un solo lugar y automáticamente arregla tanto el
camino en vivo como el backfill. Se confirmó así en la re-verificación: no
hizo falta tocar el `do $$` del backfill aparte.

---

### 7. [Menor — preexistente, fuera de alcance] Solo `/admin/clientes` declara `metadata`; el resto del panel muestra "Pedidos" en la pestaña del navegador

Reportado por el hilo principal al verificar el fix del Hallazgo 1 en browser:
`/admin/clientes` declara su `metadata` (`{ title: 'Clientes' }`), pero
`/admin/repartidores`, `/admin/pagos` y `/admin/ajustes` **no** lo hacen, así
que el tab del navegador queda con el título de `/admin/pedidos` (heredado,
probablemente el primer `metadata` que se declaró en el layout compartido) sin
importar en qué sección del panel esté parado el dueño.

No es de este slice — arreglarlo toca un layout compartido de `/admin/(app)/`
que ninguna tarea de T0A–T3A tiene como dueño, y no lo introduce esta rama:
ya pasaba antes con las tres secciones existentes. Lo dejo anotado para que no
se lea como una regresión de Entrega A y para que quede a mano si en algún
momento se decide una pasada de `metadata` sobre todo `/admin`.

---

## Los tres puntos pedidos, dictaminados

1. **`unsubscribe.actions.ts` con lectura + escritura** → ver Hallazgo 5. Se
   acepta funcionalmente (no viola ninguna regla dura, no agrega capacidad),
   pero recomiendo el refactor a `.controller.ts` para la lectura antes de que
   Entrega B siga creciendo ese archivo. No bloqueante.
2. **"Tus derechos" en `/legal/privacidad`** → ver Hallazgo 3. El texto no
   alcanza tal cual: falta la salvedad de que el padrón se reconstruye desde
   `orders` en cada compra nueva, así que "borrar" no es durable mientras el
   cliente siga comprando. Recomiendo precisarlo en una iteración chica de
   texto, sin inventar un camino de autoservicio. No bloqueante para este
   commit, pero sí antes de anunciar el feature puertas afuera.
3. **Criterios visuales sin verificar en browser (rail de 9 ítems, scroll
   horizontal)** → no lo dupliqué. Leyendo el código: el rail pasa de 8 a 9
   ítems reusando el mismo `<nav>` de `AdminShell` sin cambiar anchos ni
   breakpoints, y ninguna fila/columna nueva de `customer-row.tsx` usa un
   ancho fijo en `px` que pudiera forzar overflow (todo es `minmax(0, ...)`,
   `truncate`, y `shrink-0` solo en los elementos que ya tienen ancho
   intrínseco chico como `Price` y los botones de 44px). El hilo principal ya
   lo confirmó en browser entre 390 y 500px sin desborde horizontal — queda
   cerrado, no hace falta que lo repita.
4. **Metadata de tab del navegador** (hallazgo nuevo del hilo principal, ver
   Hallazgo 7) → deuda anotada, preexistente en el resto del panel, no
   introducida por esta rama y fuera de alcance de T0A–T3A.

---

## Verificado y correcto (para no reauditar después)

- **Predicado de dinero**: `private.order_is_customer_spend` reusa
  `order_is_billable` y agrega las dos exclusiones exactas de §5.4
  (`in_store` reembolsado, online cancelado post-pago). El trigger, el
  backfill y la RPC usan la misma función — no hay una segunda copia del
  predicado en ningún lado.
- **Centavos enteros**: `total_spent_cents` es `bigint`, `sum(o.total_cents)`
  sobre `bigint`, `avgTicketCents` es división entera en SQL
  (`sc.total_spent_cents / sc.orders_count`, con guarda `> 0`). Ningún float
  en el camino del dinero.
- **Aislamiento multi-tienda**: `store_customers` tiene `unique (store_id,
  phone_e164)`, cero grants para `anon`/`authenticated` (confirmado en la
  migración: `revoke all ... grant ... to service_role` únicamente), y las
  dos escrituras del modelo (`updateCustomerNotes`, `setCustomerOptOut`)
  llevan `.eq('id', customerId).eq('store_id', storeId)` explícito — un
  `customerId` de otra tienda da 404 de dominio, no un cross-tenant write.
- **Cliente de Supabase correcto en cada lugar**: `getCustomerDirectory` usa
  `createClient()` (sesión), nunca admin — verificado contra la trampa
  documentada de `store_couriers`/`auth.uid()`. Las dos escrituras del dueño
  usan `createAdminClient()` detrás de `requireStoreMembership(id, {role:
  'owner'})`. `findCustomerByUnsubscribeToken`/`optOutByToken` usan admin
  client sin sesión, correcto para una ruta pública autorizada solo por
  token.
- **El trigger no puede tirar con datos válidos**: `sync_store_customer` no
  hace casts, no divide, no lee otra tienda; `recalc_store_customer` tiene
  guarda temprana para `store_id`/`phone` nulos o vacíos. `SECURITY DEFINER`
  está justificado y documentado (el KDS mueve `status` con el cliente de
  sesión, que no tiene grant directo sobre `store_customers`).
- **Autorización doble**: el layout de `/admin/clientes` no resuelve sesión
  (confirmado, `layout.tsx` no importa nada de `controllers/`); el
  `page.tsx` hace `resolveAdminSession()` + `redirect` si `role !== 'owner'`;
  el controller repite `requireStoreMembership(storeId, {role: 'owner'})`; la
  RPC repite `is_store_owner()` adentro. Cuatro capas, ninguna redundante
  (cada una cierra un bypass distinto). El ítem del rail está filtrado por
  `ownerOnly: true` y `visibleNavItems`.
- **La ruta pública de baja**: `GET` nunca escribe (`getUnsubscribeTargetAction`
  es de solo lectura); `POST` en `/baja/[token]/one-click` siempre devuelve
  200 vacío, incluso con token inválido o ya usado (`toActionResult` nunca
  deja escapar una excepción); `optOutByToken` es idempotente y conserva la
  fecha original (`.is('marketing_opt_out_at', null)` en el `update`); un
  token inexistente y uno ya dado de baja muestran la misma pantalla genérica
  (`UnsubscribeView`, verificado en runtime por T3A contra Postgres). El
  problema de ruteo que el informe de T3A describe (conflicto `page.tsx` +
  `route.ts` en el mismo path) está resuelto en el árbol actual: verifiqué
  con `find`/`cat` directo sobre el filesystem que hoy solo existen
  `[token]/page.tsx` y `[token]/one-click/route.ts`, sin conflicto.
- **`RESERVED_SLUGS` en paridad**: comparé programáticamente las dos listas
  (`platform.schema.ts` vs. el CHECK de la migración) — 116 slugs de cada
  lado, conjuntos idénticos.
- **`whatsappHref` usado correctamente**: `customer-row.tsx` importa el
  helper de `src/lib/whatsapp.ts` y no arma ninguna URL de `wa.me` a mano
  (grep limpio). El mensaje precargado nunca incluye `totalSpentCents` ni
  ningún monto, `{nombre}` es `firstToken(displayName)`, y el botón se
  deshabilita (no desaparece) tanto sin `email` como con
  `marketingOptOutAt` seteado.
- **Piso de calidad de UI**: sin kicker/eyebrow, sin `Panel` anidado
  (`EmptyState` es un `div` plano, no un `Panel`), sin emoji como ícono
  (`WhatsApp` es un SVG propio), `.tabular` solo en plata/cantidades/fechas,
  botones de contacto en `size-11` (44px), sin `rounded-[...]` de sintaxis
  v3 en ningún archivo nuevo.
- **Copy**: rioplatense, voseo, sin "usted", en las dos páginas legales y en
  los mensajes de WhatsApp. Nada que insinúe métricas o casos de éxito
  inexistentes.
- **Tipos regenerados**: `database.types.ts` incluye `store_customers` y
  `store_customer_directory` con columnas/firma consistentes con la
  migración — `db:types` sí se corrió.
- **Cero fetching en views, cero `@supabase/*` en `app/**/page.tsx`**:
  grepeado en todos los archivos nuevos de T2A y T3A.

---

## Re-verificación del Hallazgo 1 (única sección re-auditada)

El fix quedó en `supabase/migrations/20260901120000_clientes.sql:169-178`,
como un `coalesce` de tres ramas en el `select` de `recalc_store_customer`:

```sql
coalesce(
  (array_agg(o.customer_name order by o.created_at desc)
     filter (where private.order_is_customer_spend(
       o.payment_status, o.payment_method, o.status, o.refunded_at)))[1],
  (array_agg(o.customer_name order by o.created_at desc))[1],
  ''
),
```

**Por qué no alcanzaba con agregar el filtro solo.** Tenía razón en el
diagnóstico pero no había pensado en esta consecuencia: `array_agg(...)
filter (...)` sobre cero filas que matcheen el filtro devuelve `NULL`, no un
array vacío. Un cliente con **cero pedidos facturables** —que tiene fila a
propósito, por diseño (§5.3: *"el que pidió y canceló es un cliente"*)— habría
quedado con `display_name = ''` si el filtro fuera la única rama: la fila se
vería en blanco en el padrón. La segunda rama (el nombre del pedido más
reciente **sin** filtrar) es exactamente el fallback que ese caso necesita, y
la tercera (`''`) es un último recurso inalcanzable en la práctica porque
`having count(*) > 0` garantiza al menos una fila y `customer_name` no admite
`NULL` en `orders` — está bien que quede como red, no como código muerto que
haya que sacar.

**Verificación específica pedida — sin abrir un hallazgo nuevo:**

- **Mismo predicado en las tres ramas.** Las dos primeras usan
  `private.order_is_customer_spend(o.payment_status, o.payment_method,
  o.status, o.refunded_at)` con los mismos cuatro argumentos en el mismo
  orden que el resto de las columnas agregadas en esa sentencia
  (`orders_count`, `total_spent_cents`, `first_order_at`, `last_order_at`).
  No hay una copia divergente del predicado.
- **No hay forma de que una rama devuelva el nombre de otra tienda o de otro
  teléfono.** Las tres ramas leen del mismo `array_agg(o.customer_name ...)`,
  construido sobre el mismo `from public.orders o where o.store_id =
  p_store_id and o.customer_phone_e164 = p_phone` que scopea toda la
  sentencia — ese `where` corre antes que cualquiera de los dos `filter`, así
  que ambas ramas ya están acotadas a exactamente ese `(store_id, phone)`.
  El segundo `array_agg` (la rama sin filtrar) no es un `array_agg` distinto
  sobre un universo más amplio: es el mismo universo (este teléfono, esta
  tienda), sin el filtro adicional de facturable. No hay cross-tenant ni
  cross-phone posible acá.
- **`email` queda como estaba, correctamente sin el filtro** (Hallazgo 2):
  confirmado que el fix no le agregó por error la misma condición a la rama
  de `email`, que según §5.2 no la necesita.
- **El test que estaba rojo ahora pasa**, y hay uno nuevo
  (`tests/db/store-customers.test.ts:148`, "un cliente con SOLO pedidos no
  facturables... tiene fila con `orders_count = 0` Y `display_name` NO
  vacío") que cubre exactamente la tercera rama del `coalesce` — es el caso
  que protege contra volver a romper esto si alguien "simplifica" el
  `coalesce` a dos ramas en el futuro.
- Acepto sin re-correrlas las verificaciones que ya hizo el hilo principal
  (suite completa 83/1023 en verde, `typecheck`/`lint` limpios, la app
  arrancando sin el conflicto de rutas, el flujo de baja completo con curl, y
  el layout mobile entre 390–500px) — no las duplico porque el pedido fue
  re-verificar específicamente el Hallazgo 1.

**Cierra el hallazgo sin abrir uno nuevo.**

## Bloqueantes (resumen)

Ninguno. El Hallazgo 1 —el único bloqueante— está resuelto y re-verificado.

Deuda anotada, no bloqueante, para una próxima iteración:

1. **Hallazgo 3** — el texto de "Tus derechos" en `/legal/privacidad` promete
   un borrado que el padrón no puede sostener si el cliente sigue comprando
   (la fila se reconstruye desde `orders` en cada compra nueva). A decidir
   **antes de anunciar el feature**, no antes de commitear.
2. **Hallazgo 4** — la tab "Cupones" es un link muerto hasta que Entrega B se
   integre. Esperado si A y B se integran juntas antes de un release visible.
3. **Hallazgo 5** — `unsubscribe.actions.ts` mezcla una lectura y una
   escritura en el mismo `.actions.ts`. No viola ninguna regla dura ni agrega
   capacidad; recomendable moverla a un `unsubscribe.controller.ts` antes de
   que Entrega B siga creciendo ese archivo.
4. **Hallazgo 7** — solo `/admin/clientes` declara `metadata` de tab; el
   resto del panel (`repartidores`, `pagos`, `ajustes`) ya tenía este
   problema antes de esta rama. Fuera de alcance de T0A–T3A.
