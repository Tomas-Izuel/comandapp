# T5 — Rewire de las URLs absolutas de salida

**Lane**: backend · **Agente**: senior-backend-engineer · **Estado**: hecho.

Depende de T4 (`src/lib/urls.ts`, ya integrado). Este documento es la
verificación de que los 9 call sites listados en `00-architecture.md` §3.2 /
`01-tasks.md` §T5 quedaron migrados, y qué decidí en los dos o tres puntos que
el contrato no cerraba al 100%.

## Bloqueante de arranque, resuelto

El header de T5 en `01-tasks.md` advertía "no arranca hasta que el slice de
repartidores/métricas esté integrado" porque `src/models/courier.model.ts`
aparecía modificado por otro slice en el momento de escribir el plan. Antes de
tocar nada verifiqué `git status`: `courier.model.ts` estaba limpio (idéntico a
HEAD), y lo único modificado/sin trackear en el working tree era
`src/lib/errors.ts` (otro slice, rate-limiting) y
`src/models/rate-limit.model.ts` (nuevo, mismo slice ajeno). Ninguno de los dos
es mío ni los toqué. No había colisión real: procedí.

## Barrido — tabla completa de call sites

Grep de partida: `grep -rn "NEXT_PUBLIC_SITE_URL" src/`. Nueve usos de runtime
(coinciden exactamente con los que ya había identificado T4/la arquitectura, no
apareció ninguno nuevo) más un uso legítimo en `src/lib/urls.ts` (la propia
autoridad) y dos comentarios de documentación en `src/emails/*` (fuera de
alcance, no son código).

| Archivo:línea (antes) | Qué construía | Decisión | Cómo quedó |
|---|---|---|---|
| `controllers/admin.actions.ts:127` | `emailRedirectTo` del magic link (admin/courier) | **apex** | `apexUrl(SURFACE_CONFIRM_PATH[surface])` |
| `models/courier.model.ts:81` | link de invitación a repartidor (`/admin/acceso/confirm?...&next=/repartidor`) | **apex** | `new URL(apexUrl('/admin/acceso/confirm'))` + mismos `searchParams.set(...)` de antes |
| `models/platform.model.ts:343` | link de invitación a dueño (`/admin/acceso/confirm`) | **apex** | `new URL(apexUrl('/admin/acceso/confirm'))` + mismos `searchParams.set(...)` |
| `app/admin/(app)/pagos/page.tsx:12` | URL de webhook mostrada al dueño | **apex** | `apexUrl(\`/api/webhooks/mercadopago?store_id=${id}\`)` |
| `services/payments/mercadopago.adapter.ts:198` | `notification_url` de la preferencia | **apex** | `apexUrl(\`/api/webhooks/mercadopago?store_id=${storeId}\`)` |
| `services/notifications/email/owner-invite.tsx:66` | prop `siteUrl` del mail de invitación al dueño | **apex** | `apexUrl('/')` |
| `services/notifications/email/courier-invite.tsx:83` | prop `siteUrl` del mail de invitación al repartidor (sin uso en la plantilla hoy) | **apex** | `apexUrl('/')` |
| `controllers/checkout.controller.ts:65` (`toReceiptEmailVars`) | `trackingUrl` del comprobante por mail | **subdominio** | `storeUrl(store.slug, \`/pedido/${order.publicToken}\`)` |
| `controllers/checkout.controller.ts:110` (`sendConfirmedWhatsapp`) | `trackingUrl` de la confirmación por WhatsApp | **subdominio** | `storeUrl(store.slug, \`/pedido/${order.publicToken}\`)` |
| `controllers/kitchen.controller.ts:58` (`dispatchReadyNotification`) | `trackingUrl` de "pedido listo" | **subdominio** | `storeUrl(store.slug, \`/pedido/${order.publicToken}\`)` |
| `controllers/kitchen.controller.ts:108` (`dispatchOnTheWayNotification`) | `trackingUrl` de "salió tu pedido" | **subdominio** | `storeUrl(store.slug, \`/pedido/${order.publicToken}\`)` |
| `services/payments/mercadopago.adapter.ts:176` | `back_urls` de Checkout Pro | **subdominio** | `storeUrl(storeSlug, \`/pedido/${orderToken}\`)` — `storeSlug` es un parámetro NUEVO del port (ver abajo) |

**9/9 usos de runtime migrados.** Ningún archivo de `src/` fuera de
`src/lib/urls.ts` referencia `NEXT_PUBLIC_SITE_URL` directamente para construir
una URL — verificado con
`grep -rn "NEXT_PUBLIC_SITE_URL" src/ | grep -v "src/lib/urls.ts\|src/lib/env.server.ts\|src/lib/env.client.ts"`,
que solo devuelve dos comentarios de documentación en `src/emails/*`
(explícitamente fuera de alcance de T5, ver abajo).

## Cambio de contrato: `PaymentProvider.createCheckout` gana `storeSlug`

`src/services/payments/payment.port.ts`: el objeto de parámetros de
`createCheckout` suma `storeSlug: string`, al lado de `storeName`, con un
comentario que explica el porqué (arma `back_urls`, que tiene que caer en el
mismo origen donde vive el carrito del cliente — si no, `clearResolvedOrderCart`
corre en el origen equivocado y no vacía nada, §2.2 de `00-architecture.md`).

Único call site: `createCheckoutForOrder` en `checkout.controller.ts`, que ya
tenía `store: Store` en scope — solo agregué `storeSlug: store.slug` al objeto
que arma.

`mercadopago.adapter.ts` desestructura `storeSlug` en `createCheckout` y lo usa
para `trackingUrl = storeUrl(storeSlug, ...)`. `const env = serverEnv()` de esa
función quedó sin usos (era solo para `NEXT_PUBLIC_SITE_URL`) y lo saqué junto
con el import de `serverEnv` — no queda ningún otro consumo de `env` en ese
archivo (verificado con grep).

## Otro cambio de firma, menor: `sendConfirmedWhatsapp`

En `checkout.controller.ts`, `sendConfirmedWhatsapp(order, store)` tomaba
`store: Pick<Store, 'name'>`. Como ahora arma el `trackingUrl` con
`storeUrl(store.slug, ...)`, el pick pasó a `Pick<Store, 'name' | 'slug'>`. Los
dos call sites (`submitOrder`, que pasa `store: Store` completo desde
`createOrder`, y `applyApprovedPayment`, que pasa `data.store: Store` desde
`getOrderWithStoreById`) ya satisfacen el tipo más ancho sin tocarlos.

## Decisiones que el contrato no cerraba al 100%

- **`apexUrl('/')` para el prop `siteUrl` de los mails de invitación**: la
  plantilla (`src/emails/store-owner-invite.tsx`, que NO toqué — está en la
  lista de "fuera de alcance") arma `${siteUrl}/admin/acceso` concatenando a
  mano. `apexUrl('/')` devuelve el origen sin barra final (mismo criterio que
  documenta `normalizePath` en `urls.ts`: `''`/`'/'` no agregan nada), así que
  la concatenación de la plantilla sigue dando `https://apex/admin/acceso`
  exactamente como antes. Alternativa descartada: `apexUrl('')` es idéntica en
  el resultado (mismo branch de `normalizePath`), preferí `'/'` porque se lee
  como "la raíz del apex" en el call site.
- **Los links de invitación (`courier.model.ts`, `platform.model.ts`) siguen
  construyendo un `URL` y usando `searchParams.set`**, en vez de armar la
  query string a mano y pasársela entera a `apexUrl`. Preferí esto porque el
  código que arma los params (`token_hash`, `type`, `next`) no cambió — solo
  cambió de dónde sale el origen base (`new URL(apexUrl('/admin/acceso/confirm'))`
  en vez de `new URL('/admin/acceso/confirm', serverEnv().NEXT_PUBLIC_SITE_URL)`).
  Es el diff mínimo que preserva el comportamiento exacto (incluido el
  `next=/repartidor` de la variante courier) sin reescribir la lógica de
  armado de query.
- **No até el reemplazo de `mercadopago.adapter.ts` a un cambio de
  comportamiento del `binary_mode`/`expires`/etc.** — nada de esa lógica se
  tocó, solo las dos líneas de URL.

## Criterios de aceptación (spec del `test-engineer`) — estado

No corro tests (no soy su dueño), pero dejo trazado contra qué debería
verificar cada uno, ya que T4 no dejó una suite para `urls.ts` en runtime real
de request:

1. **Modo `subdomain`, `back_urls` al subdominio de la tienda del pedido, los
   tres (`success/pending/failure`)**: los tres campos de `back_urls` en
   `mercadopago.adapter.ts` usan la misma variable `trackingUrl` (ya era así
   antes de mi cambio, no lo toqué), así que los tres apuntan siempre al mismo
   valor de `storeUrl(storeSlug, ...)`. Necesita `NEXT_PUBLIC_STORE_HOST_MODE=subdomain`
   para ejercitarse — no corre en local (T4, §2.6 de `00-architecture.md`).
2. **`notification_url` en modo `subdomain` apunta a `https://apex/...`, host
   distinto al de `back_urls`**: `apexUrl(...)` nunca lee `hostMode()` (T4 lo
   verificó por construcción: no hay rama que lo haga), así que esto se
   cumple sin condicional en el adapter.
3. **Modo `path`: sin regresión** — `storeUrl` en modo `path` reproduce
   `<apex>/<slug><path>`, que es exactamente lo que hacía
   `${NEXT_PUBLIC_SITE_URL}/pedido/${token}` cuando `NEXT_PUBLIC_SITE_URL` era
   el apex y no había subdominio (comportamiento de hoy, sin variable seteada).
4. **HTTPS siempre en modo `subdomain`**: `storeUrl`/`apexUrl` conservan el
   protocolo de `NEXT_PUBLIC_SITE_URL` (T4); en producción esa variable es
   `https://comandapp.ar`, así que esto es una garantía de configuración, no
   del código de T5 — si `NEXT_PUBLIC_SITE_URL` estuviera mal cargada en
   producción, el síntoma se vería en las dos funciones a la vez.
5. **`trackingUrl` de comprobante/WhatsApp/"listo"/"salió" al subdominio de la
   tienda DEL PEDIDO, no al apex ni al de otra tienda**: los cuatro sitios
   pasan `store.slug` resuelto desde el propio pedido
   (`createOrder`/`getOrderWithStoreById`), nunca un slug de otro origen — no
   hay ningún call site que reciba el slug del request en curso.
6. **`emailRedirectTo` al apex para admin y courier, conservando
   `?next=/repartidor`**: `SURFACE_CONFIRM_PATH` (sin tocar) ya incluye el
   query param en el literal de `courier`; `apexUrl` lo concatena tal cual
   porque `normalizePath` no parsea el path, solo valida el `/` inicial.
7. **Invitaciones de dueño y repartidor al apex**: cubierto arriba (courier.model.ts,
   platform.model.ts).
8. **URL de webhook en `/admin/pagos` al apex**: cubierto.
9. **Ningún archivo de `src/` fuera de `urls.ts` referencia
   `NEXT_PUBLIC_SITE_URL`**: verificado con grep, ver arriba.
10. **Notificación que falla no revierte nada**: no toqué ningún `try/catch`
    existente — todos los `sendReceiptEmail`/`sendConfirmedWhatsapp`/
    `sendReadyEmail` conservan exactamente su manejo de errores previo, solo
    cambió de dónde sale la URL que arman.

## Qué necesita una base real / un entorno real para probarse

Nada de esto toca Postgres. Lo que SÍ necesita algo más que vitest:

- Los criterios 1-4 (modo `subdomain` de verdad) no se pueden ejercitar contra
  `next dev` ni contra un preview de Vercel — el flujo local de subdominios
  está fuera de alcance del plan (T4, §2.6). Se prueban con vitest seteando
  `NEXT_PUBLIC_STORE_HOST_MODE=subdomain` en el entorno del test (sin request
  real), y la primera vez que corre de verdad es el smoke test manual en
  producción que pide `00-architecture.md` §7.
- La integración real con Mercado Pago (que `back_urls`/`notification_url`
  sean aceptados y no reboten 400) solo se ve pegándole al sandbox de MP o en
  producción — no hay manera de probarlo con mocks más allá de que el string
  tenga la forma correcta.

## Verificación

- `npm run typecheck` → limpio.
- `npm run lint` → 0 errores, 9 warnings, todos preexistentes y ajenos
  (`src/app/pedido/[token]/page.tsx` — archivo de otro agente, T6/T7 — y
  `tests/**`, del `test-engineer`). No toqué ninguno de esos archivos.
- `npm test` → 8 tests fallando en 3 archivos
  (`tests/controllers/require-backoffice-session.test.ts`,
  `tests/models/platform-owner-invite.model.test.ts`,
  `tests/services/owner-invite-email.adapter.test.ts`), **preexistentes**:
  verificado con `git stash` de mis 9 archivos tocados + `npm test` — los
  mismos 8 tests fallan idénticos sin mi cambio en el árbol (mismos mensajes,
  mismas líneas). No son míos para arreglar: dos son del slice de
  rate-limiting/hardening en vuelo (`getClaims` mockeado incompleto,
  `BackofficeSessionExpiredError` no exportado del mock) y uno es un test de
  `owner-invite-email.adapter.test.ts` que ya esperaba el formato viejo del
  `idempotencyKey` (antes de que otro cambio lo hiciera determinístico por
  contenido) — ninguno tiene que ver con `NEXT_PUBLIC_SITE_URL` ni con
  `apexUrl`/`storeUrl`. Los reporto para que quien integre no los confunda con
  una regresión de T5.

## Qué NO hice (fuera de alcance, explícito)

- No toqué `src/lib/urls.ts` ni ningún env (T4, ya cerrado).
- No toqué `next.config.ts` (T3).
- No toqué `src/views/**`, `src/app/[store]/**`, `src/app/pedido/**` (T6/T7).
- No toqué `src/emails/store-owner-invite.tsx` ni `store-courier-invite.tsx`
  (las plantillas): la prop `siteUrl` que consumen sigue teniendo la misma
  forma (`string`, un origen), solo cambió el valor que le pasa el adapter.
- No toqué la lógica de idempotencia, la máquina de estados, ni ningún
  `try/catch` de resiliencia de notificaciones.
- No arreglé los 8 tests preexistentes que fallan (no son míos, y no son de
  este slice).
- No agregué tests. `tests/**` es del `test-engineer`.
