# 03-tests — Entrega A (Clientes)

Agente: `test-engineer`. Rama `feat/clientes-y-cupones`. Corrí en paralelo con
`code-reviewer`. Stack local (Docker) arriba durante toda la corrida, así que
los doce casos de T1A se probaron contra Postgres real, no mockeados.

## Veredicto

**SUITE GREEN.** `npm test` completo: **83 archivos, 1023 tests, 0 fallas, 4
skips** (preexistentes, ajenos a este slice — `next-config-routing.test.ts`).
Nada de `tests/db/` se salteó: Docker estuvo arriba toda la corrida.

## Archivos agregados

| Archivo | Qué cubre |
|---|---|
| `tests/db/store-customers.test.ts` | Los 12 casos de T1A contra Postgres real + la garantía del KDS (SECURITY DEFINER) + idempotencia de la baja por token a nivel de base. 25 tests. |
| `tests/models/customer.schema.test.ts` | `unsubscribeTokenSchema` (alfabeto, largo, confundibles 0/1/i/l/o), `customerNotesSchema` (borde 2000/2001), `customerDirectoryRpcSchema` (forma del `jsonb` no tipado). 19 tests. |
| `tests/models/customer.model.test.ts` | `getCustomerDirectory`, `updateCustomerNotes`, `setCustomerOptOut`, `findCustomerByUnsubscribeToken`, `optOutByToken` — con `@/lib/supabase/server` y `@/lib/supabase/admin` mockeados. 16 tests. |
| `tests/controllers/customers.controller.test.ts` | `getCustomerDirectoryForStore` — el gate `role: 'owner'` como defensa en profundidad. 2 tests. |
| `tests/controllers/customers.actions.test.ts` | Las dos acciones del dueño: gate de rol, Zod, `revalidatePath`. 7 tests. |
| `tests/controllers/unsubscribe.actions.test.ts` | Las dos acciones públicas de `/baja/[token]`: rate limit, 404 uniforme, nunca tira. 7 tests. |
| `tests/views/clientes-format.test.ts` | `relativeLastOrderLabel` (bordes 0/1/2 días) y `firstToken`. 9 tests. |
| `tests/views/clientes-whatsapp-message.test.ts` | Las cuatro reglas duras del copy de WhatsApp + el borde de 30 días. 7 tests. |
| `tests/lib/clientes-source-scan.test.ts` | Los criterios "grepeables" de T2A (sin `@supabase` en `app/**`, sin `wa.me` a mano, `ownerOnly: true` en el rail). 5 tests. |

## Los 12 casos de T1A (`tests/db/store-customers.test.ts`)

Todos contra Postgres real, con `set local role authenticated`/`anon` y JWT
claims reales cuando corresponde — nunca `service_role` para probar lo que
ve el browser del staff.

1. **Pedido no facturable → `orders_count = 0`; facturable → `1`.** Cubierto.
2. **`in_store` delivered y luego reembolsado → `total_spent_cents` BAJA.**
   Verificado el hueco real de `order_is_billable` para `in_store`
   (`private.order_is_customer_spend` lo tapa).
3. **Online `approved` y luego `cancelled` → deja de contar**, aunque
   `payment_status` siga en `'approved'` (el otro hueco).
4. **Dos nombres, mismo teléfono → una fila.**
5. **`display_name` = el del pedido FACTURABLE más reciente** — ver hallazgo
   abajo.
6. **Email se conserva** aunque un pedido posterior no lo traiga.
7. **Dos teléfonos, mismo mail → dos filas.**
8. **Mismo teléfono, dos tiendas → dos filas**, cada una con su propio
   `unsubscribe_token`, y **la baja en una no afecta a la otra**.
9. **`store_customer_directory`**: `authenticated` no-dueño → `42501` (probado
   con un outsider Y con un staff de la MISMA tienda); `service_role` (sin
   `auth.uid()`) → falla igual; el dueño real ve su padrón ordenado por
   gastado desc.
10. **`store_customers` sin grants**: `anon` y `authenticated` (dueño real
    incluido) → `permission denied for table store_customers`, nunca cero
    filas silenciosas.
11. **`unsubscribe_token`** sale del alfabeto de 31 símbolos de
    `private.random_token` (sin `0/1/i/l/o`), largo 24, único.
12. **Backfill idempotente**: `private.recalc_store_customer` corrido dos
    veces da el mismo resultado.
13. **El camino feliz nunca tira dentro del trigger**: sin email, con
    comillas simples y unicode en el nombre, y con cero pedidos previos —
    los tres insertan sin error.

Más la garantía que no estaba en la lista pero se pidió explícitamente: **un
STAFF (no dueño) cambiando `status` con el cliente de SESIÓN dispara el
trigger igual**, porque `private.sync_store_customer()` es `SECURITY
DEFINER`. Probado como `authenticated` real, no como `postgres`.

## Hallazgo reportado, corregido por el hilo principal, y cómo quedó

**Lo que encontré:** `private.recalc_store_customer` (primera versión de
`20260901120000_clientes.sql`) elegía `display_name` del pedido **más
reciente a secas**, sin filtrar por facturable — a diferencia de todos los
demás agregados de la misma sentencia (orders_count, total_spent_cents,
first/last_order_at), que sí filtran. El test
`tests/db/store-customers.test.ts` ("display_name toma el nombre del pedido
FACTURABLE más reciente") lo probó con un cliente cuyo pedido más nuevo es un
online todavía impago con un nombre distinto del pedido facturable anterior:
la fila quedaba con el nombre del intento abandonado ("Pedro") en vez del
cliente real ("Juan"), contradiciendo 00-architecture.md §5.2 y el criterio
de aceptación explícito de T1A. Dejé el test en rojo con la expectativa
correcta en vez de relajar el assert, y lo reporté sin tocar la migración
(no soy dueño de `supabase/migrations/**`).

**Cómo lo corrigió el hilo principal:** no con un filtro liso — eso rompía
otro caso del propio plan (un cliente con CERO pedidos facturables, que
tiene fila a propósito, hubiera quedado con `display_name = ''`, la fila en
blanco). La corrección es un `coalesce` de tres ramas: nombre del pedido
facturable más reciente → si no hay ninguno, el más reciente a secas → `''`
como último recurso.

**Lo que agregué después de la corrección:**
- Actualicé el comentario del test que ya existía (ya no dice "queda rojo
  hasta que se corrija"; ahora explica por qué el assert es ese).
- Sumé el test que faltaba para la otra mitad de la regla: un cliente con
  **solo** pedidos no facturables (probado con uno cancelado) tiene fila con
  `orders_count = 0` **y** `display_name` no vacío — es el caso que rompe si
  alguien "simplifica" el `coalesce` de tres ramas a dos.

Con la corrección aplicada, `tests/db/store-customers.test.ts` da **25/25 en
verde** (era 23/24 antes del fix, con la fila 24 siendo el hallazgo).

## Qué decidí no cubrir, y por qué

- **Render de `AdminShell`, `CustomerDirectoryView`, `CustomerSheet`, etc.**
  `vitest.config.ts` corre en Node, no jsdom (ver `CLAUDE.md`/el contrato de
  este agente): no hay DOM para montar un Client Component. Lo que sí se
  puede probar sin DOM —los helpers puros (`format.ts`,
  `whatsapp-message.ts`) y los invariantes "grepeables" del código fuente
  (sin `@supabase` en `app/**`, sin `wa.me` armado a mano, `ownerOnly: true`
  en el rail)— está cubierto. Lo que necesita un click real (el rail sin
  scroll con 9 ítems, el colapso mobile de la tabla, la animación de la hoja)
  queda para verificación visual con el stack levantado, tal como el propio
  informe de T2A ya lo señala.
- **`/legal/privacidad` y `/legal/terminos` (T3A)**: son `export default
  function` estáticas sin data fetching (confirmado en el informe de T3A).
  No agregué un test de snapshot de contenido porque el criterio real
  ("no promete borrado autoservicio", "no inventa plazos", tono
  rioplatense) es editorial, no estructural — un test que buscara strings
  específicos se rompería con cualquier reescritura honesta del texto y no
  agregaría protección real. Si se quiere un test de "no contiene la
  palabra X", se puede sumar, pero no cubre lo que realmente importa.
- **`GET`/`POST /baja/[token]` end-to-end (route handler + Server Component
  reales)**: no hay harness de test de integración HTTP en este repo (los
  route handlers se prueban llamando directo a la función exportada, como en
  `tests/services/webhook-route.test.ts`). El comportamiento que ese patrón
  cubriría —GET no cambia el estado, POST sí y devuelve 200 vacío, mismo
  200 para token inválido/ya usado— está probado en dos capas: la Server
  Action (`tests/controllers/unsubscribe.actions.test.ts`, con mocks) y el
  UPDATE real con el guard `.is(marketing_opt_out_at, null)`
  (`tests/db/store-customers.test.ts`, con Postgres real). No queda nada de
  lógica de negocio sin cubrir; lo que falta es el "pegamento" de Next
  (`route.ts` devolviendo `NextResponse(null, {status:200})`), que es una
  línea sin ninguna rama que probar.
- **`RATE_LIMIT_POLICY['unsubscribe:ip']` en sí** (30/1h): no hay un test
  genérico de "toda entrada de `RateLimitBucket` tiene una policy" en el
  repo (lo miré, no existe precedente), así que no inventé uno para esta
  entrada sola — sería inconsistente con el resto del suite.

## Un detalle de aislamiento entre archivos de test (no de producción)

`tests/views/clientes-whatsapp-message.test.ts` salía intermitentemente en
rojo según el orden de ejecución: `tests/services/order-tracking-host-coherence.test.ts`
setea `process.env.NEXT_PUBLIC_STORE_HOST_MODE = 'subdomain'` y nunca lo
limpia, y como `env.client.ts` lo lee una sola vez al importar el módulo, el
link que arma `storeUrl()` en el mensaje de reactivación salía como
`https://la-birra.comandapp.ar` en vez de `https://comandapp.ar/la-birra`
cuando ese otro archivo corría antes en el mismo worker. Es el mismo problema
que `tests/lib/urls.test.ts` ya documenta y resetea test por test. Lo fijé
seteando `NEXT_PUBLIC_STORE_HOST_MODE = 'path'` explícito al principio de mi
archivo (mismo patrón que ya usan `urls.test.ts` y
`mercadopago-checkout-urls.test.ts`), y confirmé el suite completo estable en
3 corridas seguidas. No es un bug de producción — `storeUrl()` hace exactamente
lo que le corresponde según el modo configurado — así que no lo anoto como
hallazgo, solo como nota de por qué el test necesitaba el pin.

## Nada para reportar en `src/` más allá del hallazgo ya corregido

Repasé los cinco archivos de T1A, los ocho de T2A y los cuatro de T3A contra
sus criterios de aceptación uno por uno. Fuera del `display_name` (ya
corregido), no encontré otra discrepancia entre lo documentado y lo
implementado que ameritara un test rojo.
