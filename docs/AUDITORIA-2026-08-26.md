# Auditoría técnica de Burger Shop

**Fecha:** 26 de agosto de 2026
**Alcance:** arquitectura, seguridad, pagos, máquina de estados, cache y calidad de código.
**Modo:** solo lectura. No se modificó ningún archivo del repo.
**Stack:** Next 16.3 · React 19.2 · Supabase (PG 17) · Mercado Pago Checkout Pro · ~14.900 líneas TS/TSX · 17 tablas.

Todo hallazgo lleva `archivo:línea` y, cuando fue posible, verificación en runtime contra el stack local de Supabase (`set local role` + claims de JWT simulados dentro de transacciones con `ROLLBACK`).

---

## Estado de implementación

**Implementado el 26/08/2026.** Los 4 críticos, los 20 altos y la mayoría de los
medios están cerrados y verificados contra el stack local. Verde: `typecheck`,
`eslint`, `build` (26 rutas) y `npm test` (296 tests en 27 suites, de las cuales
12 corren contra Postgres y se saltean solas sin Docker).

Además del informe original se cerraron cuatro cosas que aparecieron
implementando, y que valen la pena porque ninguna era visible desde el código:

- **La conciliación no podía conciliar.** El cron detectaba el pedido atascado
  pero el puerto de pagos no tenía búsqueda por `external_reference`, así que no
  podía aplicar el pago perdido — solo avisar. Se agregó
  `findPaymentsByExternalReference`.
- **La entrega al POS era por evento, no por endpoint.** Un endpoint caído hacía
  que el que sí había respondido recibiera el pedido de nuevo. Se agregó
  `order_event_deliveries` con claim, backoff y dead-letter por destino.
- **`db:reset -- --orders` nunca había funcionado**, por dos bugs distintos:
  una columna `fulfillment` que no existe y `idempotency_key` faltante.
- **`[auth.email] enable_signup` no es lo que dice el comentario del CLI.** Mapea
  a `GOTRUE_EXTERNAL_EMAIL_ENABLED`, o sea el proveedor de email entero: en
  `false` apaga el magic link para usuarios existentes. Se introdujo cerrando
  S-11 y se detectó probando el login. Documentado en las trampas de CLAUDE.md.

### Lo que quedó abierto, y por qué

| Hallazgo | Estado | Qué falta |
|---|---|---|
| **P-07** rate limit en `/api/orders` | Parcial | Hay un limitador en memoria por IP y teléfono. No alcanza en producción: cada instancia de Vercel tiene su propia memoria. Necesita Vercel WAF o un store compartido, más Turnstile. |
| **S-06** rate limit del magic link | Parcial | Ídem: throttle propio en memoria. La causa raíz (Auth ve la IP del servidor, no del cliente) se mitiga pero no se elimina. |
| **S-10** CSP completa | Parcial | `frame-ancestors`, `X-Frame-Options`, `Referrer-Policy` (con `no-referrer` en `/pedido/*`), `nosniff` y `Permissions-Policy` están activos. `script-src`/`style-src` necesitan un nonce por request en `proxy.ts`, porque el tema de la tienda se inyecta como `<style>` inline. |
| **F-14** modo de los toasts | Parcial | Los colores ya son los del local (el `<style>` del tema alcanza al portal de sonner). El modo claro/oscuro lo fija el layout raíz, que no sabe en qué tienda está: alinearlo pide un `Toaster` por árbol de rutas. |
| **F-03** preload manual de fuentes | Parcial | Las 10 caras de marca ya no se precargan en todas las rutas. El `<link rel="preload">` selectivo no se pudo hacer: `next/font` no expone la URL del archivo hasheado. |
| **A-17** `noUncheckedIndexedAccess` | Diferido | Rompe decenas de archivos. Es un cambio propio, no un arreglo de auditoría. |
| **A-02** commit e historial | Del usuario | El árbol quedó listo (un solo lockfile, `.gitignore`, CI). Commitear es decisión suya. |
| **P-18** WhatsApp Cloud | Bloqueado por Meta | Las plantillas `order_confirmed`/`order_cancelled` no existen aprobadas. El adapter devuelve `skipped` a propósito en vez de mandar el texto de "pedido listo" para otro evento, que sería contenido falso. Por `wa.me` funcionan las tres. |
| **Resend** | Falta la key | El código está; falta `RESEND_API_KEY` en el entorno. `npm run resend:setup` valida y prende el SMTP de Auth sin arriesgar el 500 documentado. |

---

## Índice

1. [Resumen ejecutivo](#resumen-ejecutivo)
2. [Método y alcance](#método-y-alcance)
3. [Decisiones clave](#decisiones-clave-qué-está-bien-y-qué-hay-que-revisar)
4. [Pagos y máquina de estados](#pagos-y-máquina-de-estados)
5. [Seguridad, auth y RLS](#seguridad-auth-y-rls)
6. [Arquitectura, schema y calidad de código](#arquitectura-schema-y-calidad-de-código)
7. [Frontend, UX y accesibilidad](#frontend-ux-y-accesibilidad)
8. [¿Cache tipo Redis?](#hace-falta-una-capa-de-cache-tipo-redis-sobre-supabase)
9. [Documentación que contradice el código](#documentación-que-contradice-el-código)
10. [Lo que está bien](#lo-que-está-bien-y-no-hay-que-tocar)
11. [Plan priorizado](#plan-priorizado)

---

## Resumen ejecutivo

**Veredicto:** la base del sistema está bien pensada. El precio lo pone el servidor, la idempotencia vive en un índice único, la autorización está en RLS con helpers en un schema privado, el backoffice exige `aal2` en Postgres y no en la pantalla, y el dinero es siempre centavos enteros. Eso es lo difícil de arreglar después, y está bien hecho. `tsc` y `eslint` pasan limpios.

Lo que falta es el **cierre del ciclo del dinero** y la **coherencia entre lo que Postgres permite y lo que la app cree que permite**. Cuatro problemas justifican frenar antes de tomar el primer pedido real:

1. **El webhook de Mercado Pago confirma cualquier pedido sin verificar tienda ni monto.** Un tenant con su propia cuenta de MP puede marcar como pagado un pedido de otra tienda pagando $1 (P-01).
2. **El staff puede saltear la app y escribir directo en Postgres** vía PostgREST: reactivar su tienda suspendida, cambiar el slug a `admin`, marcar pedidos online como pagados o poner `total_cents = 1`. Verificado en runtime. La máquina de estados y las reglas de negocio existen solo en TypeScript (S-01, S-02).
3. **Si el cliente no completa el pago en MP, no hay camino de vuelta.** El carrito se vacía antes de redirigir, las tres `back_urls` van al mismo lugar y el tracking no tiene botón para pagar. Cada fallo de red o tarjeta es una venta perdida y un pedido fantasma (F-01).
4. **Las métricas se truncan en silencio a 1000 filas** (PostgREST `max_rows`): dashboard, ticket promedio y métricas de plataforma serán incorrectos apenas el negocio funcione (A-01). Y el repo tiene un solo commit, sin CI ni tests (A-02).

Después de eso, la segunda ola es toda del ciclo de pago: reembolsos y contracargos que nunca llegan al pedido, pedidos `pending` que no expiran, doble cobro por reintento, webhook que responde 200 aunque falle, y un outbox hacia el POS que hoy nadie dispara.

**Sobre Redis:** no. El problema no es latencia de Postgres sino redundancia de queries (la misma tienda se lee tres veces por request, el carrito hace un fetch por línea). Se resuelve con `React.cache()` y con `'use cache'` + `cacheTag` de Next 16 para catálogo y branding. Detalle en la sección de cache.

| Severidad | Cantidad |
|---|---:|
| Crítico | 4 |
| Alto | 20 |
| Medio | 34 |
| Bajo | 11 |
| Mejora | 3 |
| **Total** | **72** |

Varios hallazgos fueron encontrados de forma independiente por dos o tres revisores distintos; en esos casos se consolidó en uno solo y se indica en el texto.

---

## Método y alcance

Se leyó el 100% de `src/` (excepto `components/ui/*`, que es shadcn generado y se verificó sin ediciones manuales), las 7 migraciones, `seed.sql`, `config.toml`, la plantilla del magic link, los scripts y la configuración del repo. Se cargaron las skills del proyecto (`supabase`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `web-design-guidelines`, `impeccable`) como checklist, y se consultó Context7 para verificar la API actual de `mercadopago` 3.4, `@supabase/ssr` 0.12, supabase-js 2.112, Next 16 (`'use cache'`, `updateTag`, `after()`) y React 19.

La revisión se repartió en cuatro lentes (pagos y estados, seguridad y RLS, arquitectura y código, frontend y UX) y el lead volvió a leer el núcleo de pedidos y pagos para verificar cada hallazgo crítico.

**Severidad:**

- **Crítico**: plata o datos de otro tenant en riesgo hoy.
- **Alto**: pérdida de ventas, operación rota o control de seguridad que depende de que nadie lo intente.
- **Medio**: deuda que va a doler con escala o que contradice el diseño declarado.
- **Bajo**: corrección puntual.
- **Mejora**: oportunidad, no defecto.

---

## Decisiones clave: qué está bien y qué hay que revisar

### Acertadas

- Centavos enteros en todo el dominio; conversión decimal solo en el borde con MP.
- Cliente manda IDs y cantidades; `.strict()` en los schemas como señal de sondeo.
- Idempotencia con índice único `(store_id, idempotency_key)` y manejo de `23505`.
- RLS en las 17 tablas, helpers en `private` con `search_path=''`, `aal2` exigido en la policy y no en la UI.
- Snapshot de nombre/precio/grupo en `order_items`; el historial sobrevive al ABM del catálogo.
- Cocina y dinero como dos relojes (`status` vs `payment_status`).
- Webhook: firma primero, re-consulta a MP, dedupe por `provider_payment_id`.
- Puertos/adapters para pagos, notificaciones y POS; outbox por trigger.
- Resend en todos los entornos por la restricción documentada de Supabase Auth.
- Branding en OKLCH con contraste garantizado por `ensureContrast()`.

### A revisar

- **Reglas de negocio en TS con grants de tabla completa.** Contradice "RLS es la autorización real". Hacen falta grants por columna y un trigger de transiciones.
- **El pedido se crea antes de pagar y nunca expira.** Sin vencimiento de preferencia ni cron de limpieza.
- **Creación de pedido con N inserts sin transacción** en vez de una función SQL. Las funciones `private.estimate_eta` / `next_short_code` ya existen y no se usan.
- **Agregaciones en TypeScript sobre filas crudas** en vez de SQL: se topan con `max_rows`.
- **Webhook como único camino a "pagado"**, sin reconciliación.
- **Modelo owner/staff en la base pero no en la app**: cualquier encargado cambia las credenciales de cobro.
- **Credenciales de MP en texto plano**: es el activo más sensible y el menos protegido.
- **Zona horaria**: `stores.timezone` existe y casi nadie lo usa; la hora pico cae en el día siguiente.
- **El staff hace login desde un Server Action**: el rate limit por IP de Auth ve siempre la IP de Vercel.
- **Vocabulario de estados** de CLAUDE.md (`pending_payment/paid`) no coincide con el código (`pending/confirmed`).

---

## Pagos y máquina de estados

> El vocabulario real de estados es `pending → confirmed → preparing → ready → delivered` (+ `cancelled`). Coinciden `ORDER_STATUSES`, el CHECK de Postgres y `private.active_order_count`. `ALLOWED_TRANSITIONS` coincide con la tabla de CLAUDE.md. Postgres solo valida que el estado exista, no las transiciones.

### P-01 · CRÍTICO · El webhook confirma un pedido sin verificar tienda, monto ni moneda

- **Dónde:** `src/controllers/checkout.controller.ts:169-183`, `src/models/order.model.ts:499-512` (`getOrderIdByToken` sin `store_id`), `order.model.ts:705-743` (`markOrderPaid`).
- **Qué pasa:** `confirmMercadoPagoPayment` valida la firma con el secreto de la tienda `store_id` del query string y consulta el pago con el token de esa tienda (correcto). Después resuelve el pedido por `external_reference` *sin filtrar por tienda* y `markOrderPaid` nunca compara `amountCents` con `orders.total_cents` ni lee `currency_id`.
- **Impacto:** El dueño de la tienda A crea con su cuenta de MP una preferencia por $1 con `external_reference` = token de un pedido de la tienda B (lo obtiene de la URL de seguimiento de un pedido propio de $1 en B, o de cualquier link compartido por WhatsApp), la paga, y el pedido de $30.000 de B queda `approved`/`confirmed`: la cocina de B lo prepara sin haber cobrado. Dentro de una misma tienda, protege también contra pagos parciales y errores de integración: hoy un `approved` de cualquier monto aprueba cualquier total. Encontrado por los tres revisores de forma independiente.
- **Cambiar:** En `confirmMercadoPagoPayment`/`markOrderPaid` exigir `order.store_id = storeId`, `amount_cents ≥ total_cents`, `currency_id = order.currency`, `payment_method = 'online'`. Si no coincide: registrar en `payments` con `status='mismatch'`, no tocar `orders`, alertar. Guardar `store_id` en `payments`. Ideal: función SQL en una transacción.

### P-02 · ALTO · Reembolsos, contracargos y rechazos nunca llegan al pedido

- **Dónde:** `checkout.controller.ts:172` (`if (snapshot.status !== 'approved') return`), `mercadopago.adapter.ts:46-62`.
- **Qué pasa:** `mapStatus` mapea bien `refunded/charged_back → 'refunded'` y `rejected/cancelled → 'rejected'`, pero el controller descarta todo lo que no sea `approved`. `orders.payment_status` admite esos valores y la UI tiene la etiqueta "Reembolsado", pero ningún código los escribe. Se ignora `transaction_amount_refunded` (reembolso parcial).
- **Impacto:** Un contracargo deja el pedido `approved` para siempre: la cocina lo ve pagado, el dashboard lo suma como venta, y nadie se entera hasta que MP descuenta la plata.
- **Cambiar:** Insertar siempre la fila en `payments` con el status real; actualizar `orders.payment_status` para `refunded/charged_back/rejected`; emitir `order.payment_status_changed` al outbox; notificar al local. Documentar qué hace la cocina con un pedido reembolsado.

### P-03 · ALTO · Cancelar un pedido pago no reembolsa; un pago puede aprobar un pedido ya cancelado

- **Dónde:** `order.model.ts:614-660` (`updateOrderStatus`), `order.model.ts:735-741` (`markOrderPaid`), `views/admin/kds/order-card.tsx:100,291`.
- **Qué pasa:**
  - `confirmed/preparing/ready → cancelled` es legal con `payment_status='approved'`; solo cambia `status`, no llama a `PaymentRefund` (existe en el SDK), no registra nada. La plantilla `order_cancelled` existe y nadie la envía.
  - `markOrderPaid` calcula `nextStatus = status === 'pending' ? 'confirmed' : status`: si la cocina canceló mientras el cliente estaba en Checkout Pro, queda `cancelled` + `approved`: cobrado, cancelado, sin reembolso ni alerta.
  - El update de `markOrderPaid` no lleva `.eq('status', leído)`: si la cocina cancela un `pending` entre el select y el update, el webhook pisa `cancelled` con `confirmed` y resucita un estado terminal.
- **Impacto:** El local se queda con plata de un pedido que no entregó; el cliente reclama por WhatsApp, que es justo el flujo que el producto quería eliminar. El caso 2 es frecuente: el cliente tarda minutos en pagar y la cocina cierra.
- **Cambiar:** En `markOrderPaid`, si el pedido está `cancelled` o la tienda ya no acepta: registrar el pago y disparar reembolso automático (o marcar `needs_refund` y alertar). Al cancelar un pedido online `approved`: decisión explícita (reembolsar vía SDK o "reembolso manual pendiente"). Update con predicado de estado o en SQL. Enviar `order_cancelled`.

### P-04 · ALTO · Un pedido `pending` nunca expira, la preferencia tampoco, y el ETA se congela al crear en vez de al pagar

- **Dónde:** `mercadopago.adapter.ts:90-111` (sin `expires`/`expiration_date_to`), `order.model.ts:342-469`, `checkout.controller.ts:169-183`.
- **Qué pasa:** La fila `orders` se crea con `status='pending'` antes de pagar, con `eta_at` ya calculado. El link de pago no vence. `markOrderPaid` no re-chequea `accepting_orders`, `store.status` ni la antigüedad. No hay job que cancele `pending` viejos. CLAUDE.md dice que el ETA se congela "al confirmarse el pago"; el código lo congela al crear.
- **Impacto:** Un cliente abre el link a las 23:40 con el local cerrado, paga, el pedido pasa a `confirmed` con un ETA de hace 4 horas y nadie lo cocina. Los `pending` abandonados acumulan filas, ocupan `short_code` (el índice único excluye solo `delivered/cancelled`) e inflan métricas (P-13).
- **Cambiar:** `expires: true` + `expiration_date_to` (~20-30 min) en la preferencia; cron que pase `pending` viejos a `cancelled`; en `markOrderPaid` recalcular el ETA y aplicar el flujo de reembolso de P-03 si la tienda cerró.

### P-05 · ALTO · El webhook responde 200 aunque falle la confirmación: MP no reintenta, el pago se pierde y no hay reconciliación

- **Dónde:** `src/app/api/webhooks/mercadopago/route.ts:56-62`.
- **Qué pasa:** El `try/catch` traga cualquier error y devuelve `{ ok: true }`. El comentario justifica el 200 para errores permanentes, pero aplica igual a los transitorios: Supabase caído dos segundos, timeout en `fetchPayment`, cold start. El pago está aprobado en MP y el pedido queda `pending` para siempre. No existe ningún job que consulte `Payment.search({ external_reference })` para pedidos `pending` con `preference_id`.
- **Impacto:** Cliente que pagó, cocina que nunca ve el pedido. Es el peor caso del producto y hoy solo queda un `console.error`.
- **Cambiar:** Distinguir permanentes (`DomainError`, token ausente → 200) de transitorios (→ 5xx para que MP reintente). Agregar `/api/cron/reconcile`: pedidos online `pending` con `preference_id` y más de 15 min → consultar MP → `markOrderPaid` o `rejected`. Es también el lugar natural para cancelar abandonados (P-04).

### P-06 · ALTO · Doble pago: cada reintento crea una preferencia nueva y no hay detección de dos pagos para un pedido

- **Dónde:** `checkout.controller.ts:119-141`, `order.model.ts:362-363, 692-703, 721-733`.
- **Qué pasa:** El path idempotente de `createOrder` devuelve el pedido existente, pero `submitOrder` sigue igual con `createCheckout` + `attachPreference`, que pisa `preference_id`. Cada preferencia tiene su propio `init_point`. El cliente con dos pestañas (reintento con mala señal: el escenario que se quiso cubrir) puede pagar dos veces: dos filas en `payments` con distinto `provider_payment_id`, el `unique` no lo frena, y el pedido queda `approved`.
- **Impacto:** Cobro duplicado al cliente; reclamo y contracargo asegurados.
- **Cambiar:** Si el pedido ya tiene `preference_id`, reusarla (`Preference.get`) en vez de crear otra. En `markOrderPaid`, si ya hay un pago `approved` para ese `order_id`, registrar el nuevo como `duplicate` y reembolsar (o alertar). El path idempotente debería rechazar si el pedido está `cancelled`.

### P-07 · ALTO · Creación anónima de pedidos sin rate limit: los "pagás al retirar" entran a la cocina como confirmados

- **Dónde:** `src/app/api/orders/route.ts:65-90`, `order.model.ts:373-374` (`initialStatus = isOnline ? 'pending' : 'confirmed'`), `proxy.ts:49`. No hay rate limiting en ningún lugar del repo.
- **Qué pasa:** Con `in_store_payment_enabled`, un pedido nace `confirmed`, aparece en el KDS y suma al multiplicador de demanda. La única verificación es el formato E.164 del teléfono. La idempotencia no ayuda: cada request trae su propio UUID. El `GET /api/orders` de cotización también es anónimo y pega a la base con el cliente admin.
- **Impacto:** 200 requests desde un script llenan la cocina de pedidos falsos en hora pico, inflan el ETA para clientes reales y agotan los short codes. En modo online, spam de preferencias contra la API de MP con el token del local. Encontrado por dos revisores.
- **Cambiar:** Rate limit por IP y por teléfono en `POST` y `GET /api/orders` (Vercel WAF / `@vercel/firewall` / Upstash), Turnstile en el checkout al menos para `in_store`, límite de pedidos `in_store` abiertos por teléfono por tienda, y guardar `x-forwarded-for` en `orders` para poder bloquear después.

### P-08 · ALTO · El cron del outbox no está programado en ningún lado y el handler solo acepta `POST`

- **Dónde:** `src/app/api/cron/outbox/route.ts:13`. No existe `vercel.json` ni `vercel.ts`; ningún `cron` en `package.json`, `scripts/` ni `config.toml`.
- **Qué pasa:** Nada dispara el cron. Si el deploy es Vercel (CLAUDE.md menciona `gru1`), Vercel Cron invoca con **GET**; el handler devolvería 405 aun configurándolo. Ningún `order_events` se despacharía nunca.
- **Impacto:** Toda la integración POS (la razón de ser del outbox) está muerta en producción hasta que alguien lo note. *A confirmar* el target de deploy.
- **Cambiar:** `vercel.json`/`vercel.ts` con `crons` y exportar `GET` (Vercel manda `Authorization: Bearer $CRON_SECRET`), o `pg_cron` + `pg_net` desde Supabase.

### P-09 · MEDIO · `createOrder` no es transaccional: cabecera, ítems y opciones son inserts separados con delete compensatorio

- **Dónde:** `order.model.ts:377-468`.
- **Qué pasa:** Insert de `orders`, luego un insert *por ítem* en loop, luego `order_item_options`. Si algo falla, `delete` de la cabecera. Problemas: (a) el delete puede fallar (Supabase caído es la causa más probable del fallo anterior) y queda un pedido `confirmed` sin ítems visible en el KDS; (b) el trigger ya insertó `order.created` en el outbox y Realtime ya publicó el INSERT antes de que existan los ítems; (c) 10+N round-trips en serie en el hot path mobile.
- **Cambiar:** Función SQL `private.create_order(jsonb)` vía `.rpc()` con el cliente admin, en una transacción, que use las funciones `next_short_code`/`estimate_eta` que ya existen y devuelva el pedido. Alternativa mínima: insert en batch de ítems.

### P-10 · MEDIO · Outbox: sin lock, `last_attempt_at` ignorado, head-of-line blocking, dead-letter silencioso, firma sin timestamp

- **Dónde:** `src/services/pos/webhook.adapter.ts:28-36, 59-63, 75-155`; `orders.sql:145-149`; `cron/outbox/route.ts:17`.
- **Qué pasa:**
  - El comentario dice que "`order_events` no tiene columna de último intento"; **sí la tiene** (`last_attempt_at`, `orders.sql:148`). El adapter no la lee ni la escribe; el backoff se calcula contra `created_at`, así que a partir del 7.º intento todos los reintentos quedan pegados.
  - Sin claim/lock: dos ejecuciones concurrentes entregan duplicado.
  - `limit 50` por `created_at` y luego `continue` en app: si los 50 más viejos están en backoff (un POS caído), los eventos nuevos de las otras tiendas nunca se procesan (starvation entre tenants).
  - `attempts ≥ 8` desaparece del select sin marca ni alerta.
  - Si un endpoint de dos falla, el evento entero reintenta; `x-burger-delivery-id` es `randomUUID()` por intento, inútil para deduplicar.
  - HMAC solo del body, sin timestamp ni nonce: replay indefinido contra el POS.
  - ``authHeader !== `Bearer ${CRON_SECRET}` `` no es comparación en tiempo constante (hay `timingSafeEqual` a mano en `hmac.ts`).
- **Cambiar:** Claim atómico (`for update skip locked` en una función SQL), backoff con `last_attempt_at` filtrado en SQL, columna `dead_at` + alerta, entrega por endpoint (`order_event_deliveries`), `event.id` como delivery-id, timestamp en el manifest firmado, despacho por tienda en paralelo, índice `(created_at) where delivered_at is null`.

### P-11 · MEDIO · `public_token` se genera con `random()`, que no es criptográfico

- **Dónde:** `init_schema.sql:30-45` (`private.random_token`), `functions.sql:87` (short code, mismo generador).
- **Qué pasa:** CLAUDE.md habla de "~119 bits" y dice que el token "es lo único que da acceso a un pedido". Son bits de espacio, no de entropía: `random()` es xoroshiro128**, y la doc de Postgres dice que no es seguro criptográficamente. Los `short_code` (salidas públicas del mismo PRNG) se cantan en el mostrador. `pgcrypto` está instalado y no se usa para esto.
- **Cambiar:** `extensions.gen_random_bytes()` mapeado al alfabeto, o generar en la app con `crypto.randomBytes`. `orderTokenSchema` no cambia.

### P-12 · MEDIO · `payments.raw` guarda la respuesta completa de MP (PII del pagador) legible por todo el staff

- **Dónde:** `mercadopago.adapter.ts:135`, `order.model.ts:727`, `rls.sql:183-191`.
- **Qué pasa:** `Payment.get` devuelve `payer` (email, DNI), `card` (first_six/last_four, titular) y `api_response` con headers. Va a `jsonb` sin filtrar y cualquier `store_member` lo lee vía PostgREST. Ley 25.326.
- **Cambiar:** Guardar un subconjunto (`id, status, status_detail, transaction_amount, currency_id, date_approved, payment_method_id, payment_type_id, live_mode, external_reference`); si hace falta el raw, en una tabla sin grant a `authenticated`.

### P-13 · MEDIO · Dashboard y backoffice cuentan pedidos `pending` impagos como ingresos

- **Dónde:** `order.model.ts:763-779` (`salesByDay` suma todo; `billable` excluye solo `cancelled`), `platform.model.ts:103,140`.
- **Qué pasa:** Los online abandonados en `pending` (que nunca expiran) se suman como facturación. Los reembolsados también, porque `payment_status` nunca cambia (P-02).
- **Cambiar:** Filtrar por `payment_status='approved'` (o `status not in ('pending','cancelled')` para `in_store`) y restar reembolsos. Mejor aún, en SQL (A-01).

### P-14 · BAJO · Firma del webhook: sin ventana de `ts`, sin lowercase de `data.id`, `request-id` vacío en el manifest

- **Dónde:** `mercadopago.adapter.ts:139-165`.
- **Qué pasa:** El manifest coincide con la doc oficial para el caso normal. Tres desvíos: MP pide `data.id` alfanumérico en minúsculas (hoy son numéricos, no rompe); si falta `x-request-id` se omite el segmento, no se manda vacío; no se valida que `ts` esté dentro de ~5 min (replay indefinido; impacto bajo porque re-consulta a MP, pero cada replay consume la API con el token de la tienda).
- **Cambiar:** `dataId.toLowerCase()`, manifest con segmentos presentes, rechazar `|now − ts| > 5 min`.

### P-15 · BAJO · Preferencia: `statement_descriptor` con el código de 4 chars, sin `binary_mode` explícito ni `metadata`

- **Dónde:** `mercadopago.adapter.ts:90-111`.
- **Qué pasa:** En el resumen de la tarjeta aparece "A7K2" en vez del nombre del local: contracargos por "no reconozco este cargo". `binary_mode` no se decide (los `in_process` quedan pendientes; el sistema lo soporta, pero debería ser explícito). `metadata` vacío: `{ store_id, order_token }` ayuda a conciliar desde el panel de MP.
- **Cambiar:** `statement_descriptor: store.name` (máx. 22 chars), `metadata`, decisión consciente sobre `binary_mode`.

### P-16 · BAJO · `optionIds` duplicados se cobran (o descuentan) dos veces; `Math.max(0, …)` oculta precios negativos

- **Dónde:** `order.model.ts:224-236, 251-253`.
- **Qué pasa:** `[5, 5]` cuenta 2 en `chosenByGroup` y suma el delta dos veces; con `max_select ≥ 2` pasa. Con delta negativo ("sin cebolla −$100") doble descuento. El clamp a 0 esconde configuraciones donde los descuentos superan el precio.
- **Cambiar:** Unicidad en `cartItemSchema` (`Set` o `.refine`) y fallar ruidoso si `unitPriceCents < 0`.

### P-17 · BAJO · Detalles de dinero, ETA y errores

- `order.model.ts:368`: `(min_order_cents / 100).toFixed(2) + currency` en un `DomainError` visible → "7800.00 ARS" en vez de "$ 7.800". Usar `formatCents`.
- `order.model.ts:310`: `Math.ceil(base * multiplier)` con float: `20 × 1.1 = 22.000000000000004 → 23`. Calcular en enteros (bps) o en SQL.
- `functions.sql:116-167`: `private.estimate_eta` y `active_order_count` son código muerto que duplica la fórmula de `estimateEta` en TS.
- `checkout.controller.ts:103`: `new Error('Esta tienda no está disponible')` es genérico, no `DomainError` → 500 con mensaje genérico en vez de 400 con el mensaje.
- `order.model.ts:404`: cualquier `23505` se asume colisión de idempotencia; puede ser colisión de `short_code` (`next_short_code` no es atómico) → error genérico. Inspeccionar la constraint.
- `src/app/api/orders/[token]/route.ts`: sin `Cache-Control: no-store` explícito ni `Referrer-Policy: no-referrer` en `/pedido/[token]`; la URL contiene la única credencial del pedido.
- `money.ts:42`: `decimalToCents` sin `assertCents`.

### P-18 · MEJORA · La confirmación por WhatsApp nunca se dispara; no hay observabilidad de pagos

- **Dónde:** Único `notify()` del repo: `kitchen.actions.ts:106` (`order_ready`). `order_confirmed` y `order_cancelled` existen en `notifier.port.ts:10` y en `buildMessage` sin uso.
- **Qué pasa:** Sin email, el cliente no recibe ninguna confirmación fuera de la página de seguimiento; contradice la tabla de CLAUDE.md. Todos los fallos de pagos, POS y notificaciones son `console.error` o filas en tablas que nadie mira.
- **Cambiar:** Mandar `order_confirmed` al crear/aprobar; job diario de reconciliación; vista "pedidos con problemas" en backoffice (online `pending` > N min, `payments` no `approved`, eventos muertos, notificaciones `failed`).

---

## Seguridad, auth y RLS

> La arquitectura de autorización (RLS + `private.*` + `aal2`) está bien planteada y se verificó en runtime. Los agujeros dependen de que el staff use *solo* la UI: el browser del staff tiene la publishable key y una sesión válida (`lib/supabase/client.ts` existe para Realtime), así que puede pegarle a PostgREST directo, y ahí las reglas de negocio que viven en TypeScript no existen.

### S-01 · ALTO · El staff puede reactivar una tienda suspendida, cambiar el slug y borrar la tienda vía PostgREST

- **Dónde:** `rls.sql:84-87` (`stores_staff_all for all`), `grants.sql:20` (`grant insert, update, delete on stores to authenticated`), `store.schema.ts:6-8` (la exclusión de `status` vive solo en Zod).
- **Qué pasa:** Verificado en runtime con rol `authenticated`, claims del dueño de `la-birra`, aal1:

  ```
  update public.stores set status='suspended', slug='admin' where id=1 returning …
   id | slug  |  status
    1 | admin | suspended        ← 1 fila
  ```

  El `delete` falló solo por `orders on delete restrict`; en una tienda sin pedidos se borra entera. Y lo puede hacer cualquier `store_member`, no solo el `owner`.
- **Impacto:** La suspensión de plataforma es cosmética: se revierte con un `PATCH /rest/v1/stores`. Cambio de slug a `admin`/`api`/`backoffice` (secuestro de ruta, agravado con la iteración de subdominios). Encontrado por dos revisores.
- **Cambiar:** Grants por columna: `revoke update on stores from authenticated; grant update (name, description, phone_e164, whatsapp_phone_e164, address, timezone, currency, accepting_orders, in_store_payment_enabled, min_order_cents, demand_threshold_orders, demand_multiplier) on stores to authenticated;` y sacar `insert, delete`. Lista negra de slugs con CHECK (ya prevista en CLAUDE.md).

### S-02 · ALTO · El staff puede marcar un pedido online como pagado y cambiar el total desde PostgREST; la máquina de estados vive solo en TypeScript

- **Dónde:** `rls.sql:157-160` (`orders_staff_update`), `grants.sql:30` (`grant select, update on orders`), reglas en `order.model.ts:630-645`, `markPaidInStore` en `:673-686`.
- **Qué pasa:** Verificado en runtime:

  ```
  update public.orders set payment_status='approved', total_cents=1 where id=1 returning …
   id | payment_status | total_cents
    1 | approved       |           1
  ```

  El grant cubre todas las columnas: `payment_status`, `payment_ref`, `total_cents`, `status`, `public_token`, `customer_*`, `idempotency_key`, `store_id`. No hay trigger de transición: `delivered → pending` es legal en la base. `markPaidInStore` tampoco filtra por `payment_status='pending'` ni estado no terminal.
- **Impacto:** Un encargado marca pedidos online como cobrados sin que entre plata, borra el rastro contable, resucita pedidos entregados; el trigger `log_order_status_change` emite `order.paid` al POS con un pago inexistente. El modelo declarado es "RLS es la autorización real": acá la autorización de *qué* se puede cambiar no está en Postgres. Encontrado por dos revisores.
- **Cambiar:** `grant update (status) on orders to authenticated` (y mover `markPaidInStore` a `admin.ts` detrás de `requireStoreMembership`). Trigger `before update` `private.enforce_order_transition()` con la misma tabla de `ALLOWED_TRANSITIONS`, la regla "online impago no confirma" y bloqueo de `total_cents/subtotal_cents/store_id/public_token/idempotency_key` para todo rol salvo `service_role`. Así la fuente única pasa a ser Postgres.

### S-03 · ALTO · Cualquier `staff` (no solo `owner`) puede reemplazar las credenciales de Mercado Pago del local

- **Dónde:** `admin.actions.ts:118-141` (`savePaymentCredentialsAction`), `admin.controller.ts:54-71`.
- **Qué pasa:** La única guardia es `requireStoreMembership(storeId)`, que devuelve `role` y nadie lo mira: `grep "role === 'owner'"` solo aparece en `shell.tsx:54` para mostrar "Dueño". El upsert va con el cliente admin (bypass RLS), así que la distinción owner/staff que la base sí tiene (`pos_endpoints_owner_all`, `store_members_owner_manage`) no aplica.
- **Impacto:** Un encargado carga su access token y su webhook secret: todos los cobros online del local van a su cuenta de MP. El dueño ve "conectado •••• 1234" y no se entera. Mismo problema, menor, en ajustes y apariencia. Encontrado por dos revisores.
- **Cambiar:** `if (role !== 'owner') throw new DomainError(…, { status: 403 })`; definir qué puede un `staff` (KDS, cobrar en local) y qué solo un `owner` (ajustes, apariencia, pagos, ¿catálogo?) y reflejarlo en `requireStoreMembership({ role })` y en policies (`is_store_owner`). Auditar quién cambió credenciales.

### S-04 · MEDIO · `updateOrderStatusAction` confía en los datos de notificación que manda el browser: relay de mail y WhatsApp

- **Dónde:** `kitchen.actions.ts:90-153` (`notifyOnReady`), origen en `views/admin/kds/order-card.tsx:129-155`.
- **Qué pasa:** El server action recibe del cliente `customerPhoneE164`, `customerEmail`, `customerName`, `items`, `totalCents`, `publicToken`, `storeName`, sin Zod (solo `status` se valida), y con eso manda WhatsApp Cloud API y mails con el `from` de la plataforma. `getOrderWithStoreById` existe para esto y no se usa acá. `updateOrderStatusSchema` existe en `order.schema.ts:174` sin uso.
- **Impacto:** Un staff logueado usa la plataforma como relay de spam/phishing: destinatario, "tienda", ítems, montos y link arbitrarios. Consume cuota de Resend/Meta y quema la reputación del dominio de envío compartido por todos los locales. Arquitectónicamente, la vista dicta datos de negocio. Encontrado por los tres revisores.
- **Cambiar:** El action recibe `{ storeId, orderId, status }`; tras el update, lee el pedido con `getOrderWithStoreById` y arma las vars en el servidor. Elimina el tipo `NotifyOnReady` duplicado con `EmailVars`.

### S-05 · MEDIO · `products.category_id` puede apuntar a una categoría de otra tienda: defacement del menú ajeno

- **Dónde:** `rls.sql:108-111` (`products_staff_all` solo valida `is_store_member(store_id)`), `catalog.model.ts:244-276`, `catalog.model.ts:93-106` (`fetchCatalogTree` embebe `products` por `category_id`).
- **Qué pasa:** Verificado en runtime: staff de la tienda 1 hizo `update products set category_id = <categoría de otra tienda>` → 1 fila. El menú público de la tienda B muestra nombre, foto y precio del producto de A. `priceCart` lo rechaza al comprar (por `.eq('store_id')`), así que no hay fraude de precio, pero sí defacement. IDs secuenciales, enumerables.
- **Cambiar:** Verificar pertenencia de `categoryId` en `createProduct/updateProduct`; FK compuesta `(store_id, category_id) references categories(store_id, id)` (requiere `unique (store_id, id)`); en `getMenu` filtrar `products` por `store_id` además del embed.

### S-06 · MEDIO · El magic link se pide desde un Server Action: el rate limit por IP de Supabase ve siempre la IP de Vercel

- **Dónde:** `admin.actions.ts:55-72` (`signInWithOtp` server-side), `config.toml:215` (`sign_in_sign_ups = 30` por IP / 5 min), `:207` (`email_sent = 100`/h).
- **Qué pasa:** Auth ve todas las solicitudes viniendo de la(s) IP(s) del servidor. 30 requests en 5 minutos agotan el bucket para *todos* los dueños de *todos* los locales (único método de login del panel), y con Resend conectado consumen el `email_sent` global. No hay throttle propio ni captcha.
- **Cambiar:** Hacer `signInWithOtp` desde el browser (la IP es la del cliente), o mantenerlo server-side con rate limit propio por IP real + email, y habilitar Turnstile en Auth. Mantener `shouldCreateUser: false`.

### S-07 · MEDIO · `upsertBrandingAction` no pasa el input por `brandingSchema`; las URLs de imagen no tienen CHECK; la documentación afirma lo contrario

- **Dónde:** `admin.actions.ts:95-100`, `store.model.ts:159-184` (inserta `input.*` tal cual), `store.model.ts:32-49` (`toBranding` castea sin re-parsear), `init_schema.sql:126-129`. Comentarios en `[store]/layout.tsx:31`, `pedido/[token]/page.tsx:39`, `theme.ts:11` dicen "ya validado por brandingSchema".
- **Qué pasa:** CLAUDE.md: "Todo valor que termina dentro del `<style>` pasa por brandingSchema". En realidad **lo que salva al `<style>` son los CHECK de Postgres** (hex regex, enum de fuentes, `numeric(3,2)` acotado) y que `hexToOklch` tira con hex inválido. Verificado: la inyección CSS no es posible hoy. Pero `logo_url`, `logo_dark_url`, `favicon_url`, `hero_image_url` aceptan cualquier `text` (`javascript:`, `data:`). Hoy no se renderizan (F-08); el día que alguien las ponga en `<link rel="icon">` o `url()` hereda datos sin sanear. Además un hex inválido llega a Postgres y vuelve como "No pudimos procesar…" en vez de un mensaje útil. Encontrado por dos revisores.
- **Cambiar:** `brandingSchema.parse(input)` en `upsertBranding`; `safeParse` con fallback a `DEFAULT_BRANDING` en `toBranding`; guardar `path` del bucket en vez de URL (como ya hace `products.image_path`); corregir los comentarios y CLAUDE.md.

### S-08 · MEDIO · Access token y webhook secret de MP, y `pos_endpoints.secret`, en texto plano; sandbox no se bloquea en producción

- **Dónde:** `init_schema.sql:176-185`, `orders.sql:183-192`, `admin.actions.ts:127-137` (`is_sandbox = startsWith('TEST-')`, nunca consultado), `mercadopago.adapter.ts:17-29`.
- **Qué pasa:** El aislamiento por grants está bien (verificado: `authenticated` → `permission denied`), pero cualquier lectura de la base (backup, `pg_dump`, Studio, MCP de Supabase, secret key filtrada) expone los tokens de producción de *todos* los locales: permiten refunds y operar la cuenta de MP del comercio. Además una tienda puede cargar credenciales TEST en producción y "cobrar" con tarjetas de prueba; `fetchPayment` no chequea `live_mode`. Verificado que el token no se loguea. Encontrado por los tres revisores.
- **Cambiar:** Supabase Vault (`vault.create_secret`) o AES-GCM con clave en env, descifrado solo en el adapter; guardar `access_token_last4` para la UI en vez de leer el token entero para mostrar 4 dígitos; rechazar `live_mode=false` en producción; validar el token al guardarlo con `/users/me`.

### S-09 · MEDIO · MFA TOTP deshabilitado en el stack local: el backoffice no se puede probar ni QA-ear

- **Dónde:** `config.toml:332-334` (`[auth.mfa.totp] enroll_enabled = false / verify_enabled = false`).
- **Qué pasa:** Verificado: `GOTRUE_MFA_TOTP_ENROLL_ENABLED=false` en el contenedor, y el platform admin tiene 0 factores. `mfa.enroll` falla, `/backoffice/mfa` no completa, `is_platform_admin()` nunca da `true`: el backoffice entero es invisible en desarrollo. CLAUDE.md y el bootstrap dicen "hay que volver a enrolar el TOTP cada vez", cosa que hoy no puede pasar. El camino `aal2` (`requireBackofficeSession`, `redirectIfAlreadyAuthorized`) está sin ejercitar.
- **Cambiar:** `enroll_enabled = true`, `verify_enabled = true`, reiniciar el stack. Confirmar en el proyecto hosted que TOTP está habilitado (a confirmar: sin acceso al dashboard).

### S-10 · MEDIO · Sin headers de seguridad

- **Dónde:** `next.config.ts` (solo `images`).
- **Qué pasa:** Sin `headers()`: nada impide embeber `/admin` (KDS con botones de un toque) o `/backoffice` en un iframe (clickjacking); sin CSP ni `Referrer-Policy` (el token del pedido viaja en la URL). HSTS depende del dominio custom (a confirmar).
- **Cambiar:** `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` (y `no-referrer` en `/pedido/*`), `X-Content-Type-Options: nosniff`, `Permissions-Policy`, CSP con nonce para el `<style>` del tema vía `proxy.ts`.

### S-11 · MEDIO · Registro público abierto en Auth

- **Dónde:** `config.toml:180, 229` (`enable_signup = true`).
- **Qué pasa:** Verificado: `POST /auth/v1/signup` con la publishable key → HTTP 200 (crea usuario y sesión). El producto no tiene registro self-service (los usuarios los crea el backoffice con `auth.admin.createUser`). `shouldCreateUser: false` protege el formulario, no el endpoint. Un usuario basura obtiene rol `authenticated`: más superficie que `anon` (grants de escritura en catálogo, aunque RLS lo frena en 0 filas) y llena `auth.users`.
- **Cambiar:** `enable_signup = false` en `config.toml` y en el dashboard hosted. Los `createUser` del admin API siguen funcionando.

### S-12 · MEDIO · `bootstrap-dev.mjs` puede correr contra producción con contraseña conocida

- **Dónde:** `scripts/bootstrap-dev.mjs:20-26, 51-52, 95-99`.
- **Qué pasa:** Toma `SUPABASE_URL`/`SECRET_KEY` de `.env.local` y crea un `platform_admin` con `burger-dev-1234`. Sin guarda de host: tras un `vercel env pull .env.local` (patrón común), `npm run db:bootstrap` crea un platform admin con contraseña pública en producción y sin TOTP enrolado: quien llegue primero a `/backoffice/mfa` se queda con el segundo factor. `minimum_password_length = 6` no ayuda.
- **Cambiar:** Abortar si el hostname no es `127.0.0.1`/`localhost` salvo `ALLOW_REMOTE_BOOTSTRAP=1`; exigir `PLATFORM_ADMIN_PASSWORD` explícito para hosts remotos; documentar el alta de admin en producción como SQL + enrolamiento inmediato.

### S-13 · BAJO · Open redirect latente en `/admin/login/confirm?next=`

- **Dónde:** `src/app/admin/login/confirm/route.ts:22, 31`.
- **Qué pasa:** `new URL(next, origin)` con `next=https://evil.tld` o `//evil.tld` resuelve afuera. Solo tras `verifyOtp` exitoso y el `token_hash` lo tiene el destinatario, así que hoy es poco explotable; el día que `next` entre a la plantilla queda un open redirect con sesión recién creada.
- **Cambiar:** Aceptar solo rutas relativas (`startsWith('/') && !startsWith('//')`), caer a `/admin`.

### S-14 · BAJO · `platform_audit_log.ip` y `user_agent` nunca se cargan

- **Dónde:** `platform.model.ts:297-321` (`recordAudit` recibe `ip` opcional; ningún caller lo pasa; `user_agent` ni está en la firma).
- **Cambiar:** En las actions, `headers()` → `x-forwarded-for` / `user-agent` → `recordAudit`. Para un backoffice que suspende locales, la IP es lo primero que se pide en un incidente.

### S-15 · BAJO · `stores_public_read` expone todas las columnas a `anon` y el objeto `store` completo viaja al cliente

- **Dónde:** `rls.sql:34-36`, `grants.sql:12`, `store.model.ts:62` (`select('*, store_branding(*)')`), `StoreChrome store={store}`.
- **Qué pasa:** `anon` lee `phone_e164`, `demand_threshold_orders`, `demand_multiplier`… Los parámetros de demanda exponen la lógica del ETA a un competidor.
- **Cambiar:** Grant por columna para `anon` o vista `security_invoker` para el storefront; pasar al cliente solo lo que la vista usa.

### S-16 · BAJO · Bucket `product-images`: listado anónimo habilitado y sin cuota por tienda

- **Dónde:** `storage.sql:20-22` (`product_images_public_read for select to anon, authenticated`).
- **Qué pasa:** Un bucket público sirve archivos sin policy de SELECT; la policy explícita habilita además `POST /storage/v1/object/list` para `anon`. Nombres `{store_id}/{uuid}.jpg`, así que el daño es enumeración. Sin cuota: 5 MB × N ilimitado por staff. Lo que está bien: path scoping por `store_id`, sin SVG, 5 MB, `upsert: false`.
- **Cambiar:** Sacar la policy de SELECT para `anon`; cuota por tienda si Storage se cobra por uso.

### S-17 · BAJO · Sesiones sin `timebox`/`inactivity_timeout`; password policy mínima

- **Dónde:** `config.toml:185-189, 302-306`.
- **Cambiar:** 12+ caracteres con requisitos, `timebox = "24h"`, `inactivity_timeout = "8h"`, leaked-password protection en hosted. Para un usuario que suspende tiendas, la sesión no puede vivir mientras rote el refresh token.

### S-18 · MEJORA · IDs sin Zod en actions; `from/to` inválidos tiran 500; policies correlacionadas; owner/staff sin usar

- **Dónde:** `catalog.actions.ts` (todos los IDs), `kitchen.actions.ts:90`, `admin.actions.ts`; `app/admin/(app)/pedidos/page.tsx:7-13` (`new Date('basura').toISOString()` → `RangeError`); `rls.sql:113-147, 162-205`.
- **Cambiar:** Validar IDs y fechas con Zod (`z.iso.date()`); desnormalizar `store_id` en `order_items` (como ya se hizo en `order_events`) para policies planas cuando crezcan; usar el `role` en la app (ver S-03).

---

## Arquitectura, schema y calidad de código

### A-01 · CRÍTICO · Las agregaciones sobre `orders` se truncan en silencio a 1000 filas (PostgREST `max_rows`)

- **Dónde:** `order.model.ts:754-758` (`getStoreDashboard`), `:788-792` (top productos), `platform.model.ts:96-104` (`getPlatformMetrics`), `:136-140` (`listPlatformStores`). `config.toml:18`: `max_rows = 1000` (mismo default en hosted).
- **Qué pasa:** Se traen 30 días de pedidos crudos y se agrega en TypeScript. PostgREST corta la respuesta en `max_rows` sin error. Un local con más de ~33 pedidos/día pasa las 1000 filas en 30 días; la plataforma completa las pasa casi de entrada.
- **Impacto:** Facturación, ticket promedio, pedidos por estado y métricas de plataforma serán incorrectos **sin aviso**, justo cuando el negocio empiece a funcionar.
- **Cambiar:** Agregar en Postgres: función `store_dashboard(store_id, since)` con `date_trunc('day', created_at at time zone s.timezone)` y `count/sum` por RPC; para plataforma, `count(*) filter (where …)`. Resuelve a la vez P-13 y A-10.

### A-02 · CRÍTICO · Todo el proyecto está sin commitear, sin CI y sin un solo test

- **Dónde:** `git log` = 1 commit ("Initial commit from Create Next App"); 37 entradas en `git status`; no existe `.github/`; `find … -name '*.test.*'` vacío.
- **Qué pasa:** ~15.000 líneas de código productivo sin historial ni verificación automática.
- **Impacto:** No hay forma de bisecar un bug, revertir, ni de que `tsc`/`eslint`/`build` corran solos antes de mergear. Para un producto que cobra plata es la deuda más barata de pagar y la más cara de no pagar.
- **Cambiar:** Commitear ya; elegir un gestor (A-18); workflow mínimo `typecheck + lint + build` + `supabase db start && db reset` para validar migraciones; tests del `test-engineer` sobre `priceCart`, transiciones, webhook y RLS.

### A-03 · ALTO · Storefront: la tienda se lee tres veces por request, la ficha de producto carga el menú completo y el carrito hace un fetch por línea

- **Dónde:** `app/[store]/layout.tsx:9,24` + `page.tsx:10` (metadata, layout, page → `getStoreForSlug` ×3; `getStoreBySlug` en `store.model.ts:75` no está en `React.cache()`); `storefront.controller.ts:60-69` (`getProductDetail` carga `getMenu` para el nombre de la categoría); `checkout.controller.ts:101-107` (`priceCart` y `estimateEta` en serie, y `priceCart` re-lee `stores`); `views/storefront/use-priced-cart.ts:52-87` (un `fetch` a `/api/orders` por línea).
- **Qué pasa:** Un page view de `/[store]` son 4 queries (3 iguales). Un carrito de 4 líneas: 4 requests × (store + priceCart(store + products) + estimateEta(store + count)) = 20 queries, más 5 del quote del checkout. Cada tap de +/- relanza el fetch de esa línea. Ningún `React.cache()` fuera de `resolveAdminSession`. Encontrado por dos revisores.
- **Impacto:** Latencia percibida en el paso previo al pago y carga innecesaria en hora pico, cuando el server también atiende webhooks y KDS.
- **Cambiar:** `React.cache(getStoreBySlug)` y `React.cache(getMenu)`; pasar `storeRow` a `priceCart`/`estimateEta`; `Promise.all` del conteo de activos con el pricing; nombre de categoría con un join en `getProductForStore`; una cotización para todo el carrito con errores por ítem en la respuesta. Ver sección de cache.

### A-04 · ALTO · Cada request del panel hace 3-4 llamadas HTTP a Auth (`getUser()`) y chequea membresía dos veces

- **Dónde:** `admin.controller.ts:21-34` → `getUser` + `listStoresForCurrentUser` (`store.model.ts:94`, otro `getUser`) + `requireStoreMembership` (`store.model.ts:117`, otro); la page llama un modelo que vuelve a `requireStoreMembership` (`catalog.model.ts:132`); `catalog.actions.ts` lo llama en las 12 acciones y `createCategory/createProduct` lo repiten adentro (`catalog.model.ts:222,245`); el KDS pollea cada 30 s vía `fetchActiveOrdersAction`.
- **Qué pasa:** `getUser()` es un round-trip a Auth (no valida localmente). Con 500 KDS abiertos son 500 × (2-3 llamadas a Auth) cada 30 s: el rate limit de Auth es por proyecto, no por tienda.
- **Cambiar:** `getCurrentUser = cache(…)` en `lib/supabase/server.ts` (o `getClaims()`, que valida el JWT localmente como ya hace `proxy.ts`) y `requireStoreMembership = cache(…)`. Decidir **un** lugar para el chequeo de membresía: la acción o el modelo, no ambos.

### A-05 · ALTO · Borrar una categoría hace invisibles sus productos también en el panel de admin; la UI promete lo contrario

- **Dónde:** `init_schema.sql:215` (`category_id … on delete set null`), `catalog.model.ts:93-106` (`fetchCatalogTree` parte de `categories` y embebe `products`), `views/admin/catalogo/category-list.tsx:242` ("quedan sin categoría, no se borran").
- **Qué pasa:** El producto queda con `category_id = null` y el árbol se construye desde categorías: no aparece ni en `getMenu` ni en `getAdminCatalog`. Para el dueño, desapareció.
- **Cambiar:** Bloquear el borrado de categorías con productos (`DomainError`) o que `getAdminCatalog` traiga los huérfanos en una categoría virtual "Sin categoría".

### A-06 · ALTO · `confirmed_at` queda `NULL` para pedidos con pago en el local

- **Dónde:** `functions.sql:212-238` (`stamp_order_status_times` es solo `BEFORE UPDATE`), `order.model.ts:374` (`in_store` nace `confirmed` en el INSERT).
- **Qué pasa:** Nunca pasa por un UPDATE a `confirmed`. `prepAccuracy` los excluye (`order.model.ts:781`) y el KDS cae a `createdAt`. Latente también para `paid_at`. Encontrado por dos revisores.
- **Cambiar:** Trigger también `BEFORE INSERT` (o estampar en la función SQL de creación).

### A-07 · MEDIO · Duplicación: cuatro `toResult`, tres `toStore`, tres `logNotification`, dos adaptadores de `issues`, ocho formateadores de fecha, tres mapas de etiquetas de estado

- **Dónde:** `admin.actions.ts:20-40`, `catalog.actions.ts:39-59`, `kitchen.actions.ts:40-57`, `platform.controller.ts:36-53` (cuatro traducciones error→`ActionResult` con **tres mensajes genéricos distintos**); `store.model.ts:12-30`, `platform.model.ts:18-36`, `order.model.ts:64-82`; `whatsapp-link.adapter.ts:35-55`, `whatsapp-cloud.adapter.ts:10-30`, `email/log.ts:40-60`; `api/orders/route.ts:78` y `lookup/route.ts:19`; `CONFLICT_FIELD` como literal en `kitchen.actions.ts:28` y `order-card.tsx:45`; fechas en `my-orders`, `order-tracking`, `history-list`, `order-card`, `sales-chart`, `store-table`, `audit-table`, `store-detail`; etiquetas en `order-status.tsx:16`, `order.model.ts:663`, `board.tsx:13` + `order-card.tsx:29-38`; `TERMINAL_STATUSES` redefinido en `order-tracking.tsx:12` como `Set<string>`.
- **Impacto:** La próxima regla transversal ("loguear con request id", "409 → refrescar", "fecha en TZ del local") hay que recordarla en 4-8 lugares.
- **Cambiar:** `lib/action-result.ts` con un único `toActionResult(err, context)` (sin `'use server'`); `models/mappers/store.mapper.ts`; `services/notifications/log.ts` parametrizado por canal; `zodToApiError` aceptando `ZodError`; `lib/dates.ts` con `formatInStoreTz`; etiquetas y `TERMINAL_STATUSES` exportados desde `order.schema.ts`.

### A-08 · MEDIO · Controllers que solo reenvían a un modelo (indirección que CLAUDE.md prohíbe)

- **Dónde:** `checkout.controller.ts:155-161` (`getOrderStatus`, `lookupOrders`), `platform.controller.ts:128-150` (`getDashboardMetrics`, `getStoresList`, `getAuditLog`), `storefront.controller.ts:35-47` (`getStoreForSlug`, `getStoreBrandingForTheme`).
- **Cambiar:** Que las pages importen el modelo directo, o que el controller aporte algo (`React.cache`, `cacheTag`, composición).

### A-09 · MEDIO · Backoffice: cargar una tienda carga toda la plataforma, con N+1 a Auth y paginación completa de `listUsers`

- **Dónde:** `platform.controller.ts:143-146`, `platform.actions.ts:39`; `platform.model.ts:125-181` (`auth.admin.getUserById` por dueño en serie, `:165-168`); `:190-208` (`findOrCreateUserByEmail` pagina todo `listUsers`).
- **Cambiar:** `getPlatformStoreById(id)`; guardar `email` en `store_members` al crear o una vista `private` sobre `auth.users`.

### A-10 · MEDIO · Zona horaria: "hoy" y "por día" se calculan en UTC; el pico del viernes a la noche cae en el sábado

- **Dónde:** `order.model.ts:766` (`created_at.slice(0,10)` = día UTC), `app/admin/(app)/pedidos/page.tsx:7-23` (``new Date(`${date}T00:00:00`)`` en TZ del proceso, UTC en Vercel), `views/admin/dashboard/sales-chart.tsx:14-18` (`new Date('2026-08-25')` se parsea como medianoche UTC y se imprime como 24/08 en el cliente), `order-tracking.tsx:15,55,63`, `history-list.tsx:75`, `my-orders.tsx:12`, `backoffice/*.tsx` (formateadores `es-AR` sin `timeZone`). Único lugar correcto: `order-card.tsx:109`. `date-fns` está instalado y no se usa.
- **Qué pasa:** Un pedido a las 22:30 de Argentina es `01:30Z` del día siguiente: suma al sábado en el dashboard, no aparece en "hoy" hasta las 21:00, y los ticks del gráfico quedan corridos un día. `OrderTracking` se renderiza en SSR: el server imprime "01:30" y el cliente hidrata "22:30" → mismatch de hidratación. Encontrado por dos revisores.
- **Impacto:** El producto se juzga viernes a domingo a la noche; las métricas de ese horario están en el día equivocado.
- **Cambiar:** `store.timezone` en todo formateador; agrupar en SQL con `at time zone` (A-01); límites del filtro en la TZ del local; parsear `'YYYY-MM-DD'` como fecha local en el chart.

### A-11 · MEDIO · Retención: `order_events`, `platform_audit_log` y `payments.raw` crecen sin límite

- **Dónde:** `orders.sql:118-155`, `init_schema.sql:62-77`.
- **Cambiar:** Purge por cron de eventos entregados > 30 días; recortar `raw` (P-12); índice BRIN sobre `created_at` cuando crezcan. Particionar es prematuro.

### A-12 · MEDIO · Constraints faltantes, `short_code` nullable y literales mágicos

- **Dónde:** `payments.status` (`orders.sql:123`), `order_events.type` (`:140`), `notifications.template` (`:169`), `stores.currency` (`init_schema.sql:92`) son `text` sin CHECK; `orders.short_code` nullable aunque un trigger lo garantiza (obliga a `row.short_code ?? ''` en `order.model.ts:112,143`); `payment_ref: 'in_store'` como sentinela (`:677`); `'mercadopago'` literal en 3 lugares; `board.tsx:89` re-enumera estados en vez de usar `ACTIVE_STATUSES`.
- **Cambiar:** CHECKs alineados con los enums de Zod (y un test que compare ambos); `short_code text not null`; constantes exportadas.

### A-13 · MEDIO · Código muerto y dependencias sin uso

- **Dónde:** `private.estimate_eta`, `private.active_order_count` (`functions.sql:116-167`); `updateOrderStatusSchema`; templates `order_confirmed`/`order_cancelled`; índices `orders_payment_ref_idx` y `orders_preference_id_idx` sin query que los use (a confirmar si son para la reconciliación). Deps con cero imports en `src`: `date-fns`, `react-hook-form`, `@hookform/resolvers`, `next-themes` (solo `components/ui/sonner.tsx`). `shadcn` (CLI) en `dependencies`.
- **Cambiar:** Usar o borrar. La función SQL es justamente lo que haría atómico `createOrder`; `react-hook-form` + `zodResolver` con el mismo schema del server resolvería F-05.

### A-14 · MEDIO · Observabilidad: solo `console.error`, sin correlación ni superficie para el operador

- **Dónde:** 10 `console.error` repartidos; fallos de Resend/WhatsApp en `notifications.status='failed'`, del POS en `order_events.last_error`, de pagos en ninguna parte. Ninguna pantalla ni alerta los muestra.
- **Cambiar:** `lib/log.ts` estructurado (`{ level, context, storeId, orderId, requestId }`); en el dashboard del local, conteo de notificaciones fallidas y eventos POS pendientes; en backoffice, pedidos online `pending` viejos.

### A-15 · MEDIO · Awaits secuenciales independientes y `after()` sin aprovechar

- **Dónde:** `checkout.controller.ts:101-107`, `:184-191` (dos lecturas para un dato), `platform.model.ts:87-104` (3 counts en serie), `:129-155`, `order.model.ts:754-792`. Envío de mail/WhatsApp `await`eado dentro de la acción (`kitchen.actions.ts:106-119`) y del webhook.
- **Cambiar:** `Promise.all` donde no hay dependencia; `after()` (estable en Next 16) para responder y notificar después sin dejar promesas sueltas.

### A-16 · MEDIO · Orquestación que vive en el modelo

- **Dónde:** `order.model.ts:342` (`createOrder` lee tienda, chequea idempotencia, cotiza, estima ETA e inserta), `platform.model.ts:210-258` (`createStoreWithOwner` con Auth + audit).
- **Cambiar:** Según el contrato del repo eso es controller o, mejor, una función SQL transaccional invocada por el modelo (P-09).

### A-17 · BAJO · Varios de calidad

- `select('*')` en 7 lugares; los de `.insert().select('*')` son defendibles, `listPlatformStores`/`listAudit` no.
- 9 `as unknown as` para embeds de PostgREST: aceptable, pero `QueryData<typeof query>` de supabase-js los tipa.
- Parámetro booleano posicional `sendReceiptEmail(order, store, paymentPending)`.
- `proxy.ts:16-17` usa `process.env.X!` (los dos únicos `!` del repo).
- `productImageUrl` duplicado cliente/servidor (`catalog.model.ts:160`, `image-upload.ts:9`).
- `eslint.config.mjs` no codifica las reglas de arquitectura: `no-restricted-imports` (pages → `@supabase/*`, views → `*.model`) las haría mecánicas.
- `tsconfig` sin `noUncheckedIndexedAccess` (varios `issues[0]`, `stores[0]`).
- `createAdminClient()` instancia un cliente nuevo en cada llamada (6+ por `createOrder`); con `persistSession:false` puede ser singleton de módulo.

### A-18 · MEDIO · DX: tres lockfiles, gestor ambiguo, tipos generados fuera del repo

- **Dónde:** `bun.lock`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package-lock.json` (el más nuevo), ninguno trackeado. Scripts y CLAUDE.md usan `npm`. `database.types.ts` se regenera en `db:reset` y no está trackeado: un clone limpio no tipa sin Docker.
- **Cambiar:** Borrar `bun.lock`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; commitear `package-lock.json` y `database.types.ts`; `"packageManager"`/`engines` en `package.json`; regenerar tipos en CI contra las migraciones para detectar drift. Verificado que hoy `database.types.ts` coincide con las migraciones.

---

## Frontend, UX y accesibilidad

> 36 de 99 archivos `.tsx` son `'use client'`. Sin `key={index}`, sin componentes dentro de componentes, sin barrel imports fuera de shadcn. La idempotencia y el "precio lo pone el servidor" están correctamente implementados del lado cliente.

### F-01 · CRÍTICO · No hay camino de vuelta al pago: si Mercado Pago falla o el cliente abandona, perdió el carrito y no puede pagar

- **Dónde:** `views/storefront/checkout-form.tsx:139-154` (`saveOrderRef`, `saveCustomer`, `clear()` y recién después `window.location.href = redirectUrl`); `mercadopago.adapter.ts:103-104` (`back_urls` success/pending/failure las tres al mismo `/pedido/[token]`); `models/types.ts:165-185` (`OrderPublicView` sin `checkoutUrl`); `order-tracking.tsx` (sin botón "Pagar"); `shared/order-status.tsx:94-101` (aviso como texto plano, sin acción); `order-tracking.tsx:12-13` (polling cada 5 s indefinido para `pending`).
- **Qué pasa:**
  1. El carrito se vacía *antes* de navegar a MP. Si la navegación cross-origin falla por señal (el escenario declarado como el 90% del tráfico), el cliente queda en `/checkout` con "Tu carrito está vacío". El pedido existe en `pending`, aparece en `/mis-pedidos` como "Esperando el pago", y no hay forma de retomarlo.
  2. Si MP redirige por `failure` o `pending`, aterriza en el tracking con la barra gris y ninguna acción. Tiene que rearmar todo; el segundo pedido es *otro* pedido y el `pending` viejo queda huérfano.
  3. "El pago fue rechazado" es inalcanzable: el webhook nunca marca `rejected` (P-02).
  4. Un `pending` abandonado con la pestaña abierta pollea al server cada 5 s para siempre.
- **Impacto:** Es el punto exacto donde se convierte la venta. Cada fallo de red o de tarjeta equivale a un carrito perdido y un pedido fantasma. Es la regresión más cara posible frente al WhatsApp que se quiere reemplazar.
- **Cambiar:** Exponer `checkoutUrl` mientras `status === 'pending' && paymentMethod === 'online'` y un botón primario "Ir a pagar" en el tracking (regenerando preferencia si venció, P-04); vaciar el carrito recién al ver `approved` (la idempotencyKey ya protege contra duplicados); `back_urls.failure` distinto; polling con backoff (5 → 30 → 60 s) y pausa en `visibilitychange`.

### F-02 · ALTO · Cero `loading.tsx`, `error.tsx` ni `not-found.tsx` en todo `src/app`

- **Dónde:** `find src/app -name 'loading.tsx' -o -name 'error.tsx' -o -name 'not-found.tsx'` → 0. `notFound()` se llama en 4 lugares.
- **Qué pasa:** Sin `loading.tsx` la page bloquea hasta que resuelven todos los `await`; sin `error.tsx` una excepción de Supabase muestra el "Application error" genérico en inglés y sin tema; sin `not-found.tsx` un slug inexistente muestra el 404 de Next. En la navegación catálogo → producto → carrito → checkout no hay ningún indicador de carga: en 3G el usuario toca y no pasa nada durante 1-3 s.
- **Impacto:** Doble tap y sensación de "está roto"; un 404 en inglés rompe "el cliente está en la web de la hamburguesería".
- **Cambiar:** `[store]/loading.tsx` con skeleton de etiquetas (el `LabelBand` vacío ya es un skeleton natural), `not-found.tsx` y `error.tsx` tematizados, `app/not-found.tsx` raíz; ídem en `/admin/(app)`.

### F-03 · ALTO · 12 tipografías declaradas en el root layout: todas se precargan en todas las rutas

- **Dónde:** `lib/fonts.ts:31-58`, `app/layout.tsx:37`. Verificado: ninguna declaración lleva `preload: false`.
- **Qué pasa:** El comentario dice que "el navegador solo descarga las que el CSS usa". La doc de `next/font` dice lo contrario: el root layout precarga en todas las rutas y `preload` es `true` por defecto → un `<link rel="preload" as="font">` por familia en cada página, incluidos `/admin` y `/backoffice`. A confirmar midiendo el HTML renderizado, pero es el comportamiento documentado.
- **Impacto:** Decenas o cientos de KB forzados en el primer viewport de un cliente en 3G, para fuentes que ese local no usa, compitiendo con la foto del producto.
- **Cambiar:** `preload: false` en todas menos Geist/Geist Mono, y un `<link rel="preload">` manual solo para `font_heading`/`font_body` de la tienda en `[store]/layout.tsx`.

### F-04 · ALTO · Targets táctiles por debajo de 44 px en el camino de compra y en el panel

- **Dónde:** `components/ui/button.tsx` (preset Nova: `default` h-8 = 32 px, `sm` 28, `lg` 36, `icon` 32, `icon-sm` 28); `cart-view.tsx:80-98` (+/- del carrito `icon-sm` = **28 px**), `:107-114` (quitar, 32 px); `my-orders.tsx:86-91` (36 px); `category-list.tsx:199-207` (expandir: target = ícono de 16 px); `history-list.tsx:41-53`, `shell.tsx:78-91` (pills ≈ 28-32 px); `product-row.tsx:47-52` (`Checkbox` de 16 px como único control de disponibilidad).
- **Qué pasa:** Solo los botones con `h-11`/`h-12` explícito llegan a 44 px. PRODUCT.md: "una mano, en la calle… targets grandes". WCAG 2.5.8 (24 px) se cumple; el objetivo declarado no. Errar en "−" a 28 px borra la línea (`cart.tsx:188`).
- **Cambiar:** Subir los defaults de `Button` del proyecto (`default` h-10/h-11, `icon` size-11) o `size-11` explícito en el carrito como ya hace `product-detail.tsx:241,253`. Confirmar antes de eliminar una línea desde "−".

### F-05 · ALTO · Formularios admin sin labels asociados ni errores por campo; el login sin label; `react-hook-form` instalado y sin usar

- **Dónde:** `product-drawer.tsx:143-206` (todos los `<Label>` sin `htmlFor`, `<Input>` sin `id`), `settings-form.tsx:32-40`, `branding-form.tsx:104-149`, `login-form.tsx:55-66` (único input sin label ni `aria-label`); `settings-form.tsx:191-193` ("Revisá los campos marcados: name, phoneE164", claves internas, ningún campo marcado). Los schemas Zod (`storeSettingsInputSchema`, `brandingSchema`) solo corren en server.
- **Qué pasa:** WCAG 1.3.1 / 3.3.1 / 3.3.2 / 4.1.2: un lector de pantalla anuncia "editar texto" sin nombre; los errores no se asocian al input. Validación cliente nula: el dueño se entera del teléfono mal recién tras el round-trip, con un toast.
- **Cambiar:** `id`/`htmlFor` (o `useId`), `aria-invalid` + `aria-describedby`, `fieldErrors` mapeados a etiquetas humanas. Decidir: `react-hook-form` + `zodResolver` con el **mismo** schema del server, o quitar las deps (A-13).

### F-06 · ALTO · Opacidad sobre `primary-foreground` rompe la garantía de contraste del sistema

- **Dónde:** `store-hero.tsx:13,18` (`/80`, `/85`), `brand-preview.tsx:35` (`opacity-90`).
- **Qué pasa:** `ensureContrast` corrige `--primary-foreground` hasta 4.5:1 *justo*; con 80% de opacidad el ratio cae por debajo. CLAUDE.md, textual: "No rompas eso con opacidades sobre texto". Es el primer viewport, al sol, y es la dirección del local (dato operativo).
- **Cambiar:** Usar el token tal cual o derivar `--primary-foreground-muted` con `ensureContrast(…, 4.5)` en `buildThemeCss`.

### F-07 · ALTO · KDS: sin alerta de pedido nuevo; refetch completo por cada evento sin coalescer

- **Dónde:** `grep "Audio|Notification(|vibrate|document.title" src/views/admin` → vacío; `kds/board.tsx:66-78` (cada `postgres_changes` dispara `poll()` sin debounce, con el polling de 30 s en paralelo); `board.tsx:87-93` (cambio de estado no optimista).
- **Qué pasa:** PRODUCT.md: el dueño necesita "enterarse cuando entra un pedido sin tener la pantalla abierta". Hoy aparece en silencio. En hora pico, 10 updates en 2 s = 10 Server Actions secuenciales (Next las serializa por cliente) que devuelven la lista completa y re-renderizan todas las cards. Bien: cleanup de canal e intervalo, filtro `store_id`, `key` estable, 409 → refetch.
- **Cambiar:** Sonido + `document.title` con contador + Web Notifications al subir `orders.length`; debounce ~500 ms en `poll()`; aplicar el payload del evento para inserts; `useOptimistic` con rollback para el cambio de estado.

### F-08 · MEDIO · Los assets de marca (logo, portada, favicon) se suben pero nunca se muestran

- **Dónde:** `branding-form.tsx:57-81` sube `logo_url`, `logo_dark_url`, `favicon_url`, `hero_image_url`; `grep` de esas columnas en `views/storefront` y `app` → vacío; `generateMetadata` no setea `icons`.
- **Qué pasa:** El dueño carga su logo y la vitrina no cambia. PRODUCT.md promete "logo, colores, tipografía, portada". Puede ser decisión del "programa de etiqueta", pero entonces el formulario miente. Relacionado con S-07: esas URLs no están validadas para el día que se rendericen.
- **Cambiar:** Renderizar (favicon vía `metadata.icons`, logo en `StoreChrome`, portada en `StoreHero`) con la URL validada, o quitar los campos hasta que se usen.

### F-09 · MEDIO · Borrado de imagen antes de guardar: cancelar el drawer deja al producto apuntando a un archivo inexistente

- **Dónde:** `product-image-field.tsx:34-42` (`deleteProductImage(previousPath)` inmediato), `product-drawer.tsx:101` (el path nuevo se persiste al guardar).
- **Qué pasa:** Cambiar foto → cancelar → la fila sigue con el `image_path` viejo, ya borrado → `next/image` 404 en la carta. Y para productos nuevos que nunca se guardan quedan huérfanos al revés.
- **Cambiar:** Borrar el archivo viejo en la server action de update, cuando el nuevo path quedó persistido, o en un cron de huérfanos.

### F-10 · MEDIO · Inputs de dinero: float intermedio, "0" pegajoso, formato inconsistente

- **Dónde:** `product-drawer.tsx:54,102`, `option-groups-editor.tsx:20-22,265,318,369`, `settings-form.tsx:152-153`.
- **Qué pasa:** La conversión pasa por float pero `Math.round` + `step={1}` la salvan (sin bug de centavos, aunque contra la regla). `Number(e.target.value || 0)` en inputs controlados: borrar para tipear muestra "0" con el cursor delante. `option-groups-editor.tsx:369` muestra `+500` sin `$` ni separador.
- **Cambiar:** Draft como string y convertir en submit (`inputMode="numeric"`); `formatCentsCompact` en el editor de opciones y en el mensaje de mínimo del modelo (P-17).

### F-11 · MEDIO · Kicker/eyebrow arriba de títulos, prohibido sin excepciones por CLAUDE.md

- **Dónde:** `app/admin/login/page.tsx:19-22` ("PANEL DEL LOCAL" sobre "Entrar"), `order-tracking.tsx:53-54` (nombre del local sobre "Pedido #K7QX"), `my-orders.tsx:71-74`, `store-hero.tsx:13-16` (dirección/"PEDIDOS ONLINE" sobre el nombre; el contrato lo llama "línea de productor", pero estructuralmente es el mismo patrón: a decidir por el director), `prep-accuracy.tsx:24-31` (label chica sobre número grande: mini hero-metric).
- **Cambiar:** Fundir el kicker en el título ("Pedido #K7QX en La Birra") o bajarlo debajo como spec.

### F-12 · MEDIO · Monoespaciada como disfraz fuera de medición, y el texto más chico de la app (11 px) donde más se lee

- **Dónde:** `store-chrome.tsx:21` (nombre del local en nav), `checkout-form.tsx:167,234,245,278` (h2 de sección), `kds/board.tsx:115,137` (columnas), `backoffice/shell.tsx:34,47`, `catalog-list.tsx:17`, `product-detail.tsx:143,165,235`, `states.tsx:41`. `text-[0.6875rem]` uppercase mono para la dirección y el aviso de cerrado.
- **Qué pasa:** CLAUDE.md: "Monoespaciada solo para medición (precios, minutos)". Hoy es la voz de casi todo texto secundario.
- **Cambiar:** Reservar `font-mono` a `SpecRow`, códigos, precios y minutos; headings en la sans del body; piso de 12 px.

### F-13 · MEDIO · Errores del checkout no asociados a los inputs; filtros del historial sin semántica; drawer sin descripción

- **Dónde:** `checkout-form.tsx:191-229` (`<p class="text-destructive">` sin `id`/`aria-describedby`; `aria-invalid` sí), `history-list.tsx:41-53` (sin `aria-pressed`/`role="tab"`), `product-detail.tsx:156-159` (`DrawerContent` sin `DrawerDescription`, a confirmar el warning en consola).
- **Cambiar:** `id` + `aria-describedby`; `aria-pressed` o migrar a `Tabs` de shadcn (instalado, sin uso).

### F-14 · MEDIO · Los toasts siguen el modo del sistema operativo, no la marca: `sonner` lee `next-themes` sin `ThemeProvider`

- **Dónde:** `components/ui/sonner.tsx:3,8` (`useTheme()` sin provider → `"system"`), `app/layout.tsx:41` (`<Toaster>` fuera de `[data-store-theme]`).
- **Qué pasa:** En una tienda clara con el celular en modo oscuro, "Hamburguesa agregada al carrito" aparece como toast oscuro con la paleta neutra de shadcn: la única superficie que se ve "de la plataforma" en la cara del cliente. `next-themes` viaja al bundle para devolver `undefined`.
- **Cambiar:** `theme` explícito desde el layout de la tienda o un `Toaster` dentro de `[store]/layout.tsx`; quitar `next-themes`.

### F-15 · MEDIO · Reduced motion: kill global que también apaga el feedback útil

- **Dónde:** `globals.css:182-190` (`animation-duration: 0.01ms !important` para `*`).
- **Qué pasa:** Con `prefers-reduced-motion`, el `Loader2 animate-spin` de "Confirmando…" queda congelado (el estado pending pierde su señal) y el pulso del tramo activo de `OrderProgressLine` desaparece sin alternativa: queda idéntico a "hecho".
- **Cambiar:** Excluir `.animate-spin` (o indicador estático) y dar al tramo activo un estilo sin movimiento.

### F-16 · MEDIO · Colores hardcodeados fuera del sistema de tokens y spinner permanente en el KDS

- **Dónde:** `kds/board.tsx:116` (`text-emerald-600`, `RotateCw animate-spin` permanente + "Actualizando cada 30s"), `pagos/payment-form.tsx:73` (`amber-*`), `emails/order-receipt.tsx:71-72` (`borderLeft 4px` con acento, default rechazado por el craft floor).
- **Qué pasa:** Motion decorativa continua en una superficie Operate; si el canal Realtime cae, el operario ve un spinner infinito que sugiere "cargando" cuando está en modo degradado pero funcional.
- **Cambiar:** Tokens semánticos; punto estático + texto; spinner solo durante el `poll()`.

### F-17 · BAJO · Varios de React y detalle

- `cart.tsx:120-127`, `checkout-form.tsx:56-64`, `my-orders.tsx:25-46`: `setState` en efecto para hidratar `localStorage` (correcto para evitar mismatch; `useSyncExternalStore` eliminaría el render en blanco). Claves sin versión: una migración futura solo puede vaciar, no migrar. `cart.tsx:129-132` escribe inmediatamente después de leer.
- `kds/order-card.tsx:56-63`: `useState(() => minutesSince(iso))` con `Date.now()` en SSR → mismatch potencial sin `suppressHydrationWarning`.
- `checkout-form.tsx:86`: `<a href>` en vez de `Link` (full reload).
- Plurales: "Carrito, 1 ítems" (`store-chrome.tsx:28`), "Agregamos los 1 ítems" (`reorder-handler.tsx:76`).
- `settings-form.tsx:87`: `useMemo` para `Math.ceil(10 * x)`.
- `kds/board.tsx:115,120`: `top-[85px]`/`top-[110px]` acoplados a la altura del header, que cambia si el email hace wrap.
- `sales-chart.tsx:3`: `recharts` (~100 KB gz) sin `next/dynamic`; contenido a `/admin/dashboard`.
- `whatsapp-link.adapter.ts:20,23`: emoji 🍔 en el texto del WhatsApp (voz del producto, no ícono de UI).

### F-18 · MEJORA · `alt=""` en la ficha de producto; HEIC de iPhone

- `product-detail.tsx:123`: la imagen es el contenido principal, `alt={product.name}` sería más honesto (en la lista, `alt=""` es defendible).
- `image-upload.ts:20`: `createImageBitmap` falla con HEIC en Chrome/Firefox; el `accept` lo filtra en la mayoría de los casos (a confirmar en dispositivo).

---

## ¿Hace falta una capa de cache tipo Redis sobre Supabase?

**No. A esta escala Redis/Upstash es complejidad prematura; el problema real es redundancia de queries, no latencia de Postgres.**

Volumen esperado: cientos de pedidos/día por local; con 500 locales, ~50.000 pedidos/día ≈ 0,6 escrituras/s promedio con picos de decenas/s. El catálogo de un local son decenas de filas. Postgres en un plan chico de Supabase sirve esto con índices y sin sudar. Redis agregaría otro servicio, otra credencial, invalidación distribuida y la posibilidad de servir un precio viejo: exactamente lo que el producto prohíbe.

### Qué hay hoy

- Ninguna page usa `force-dynamic`, `unstable_cache`, `'use cache'` ni `cacheTag`; `revalidatePath` solo en `platform.actions.ts`. Pero **todo es dinámico igual**: `lib/supabase/server.ts:14` llama `cookies()` y todos los modelos (incluido el catálogo público) usan ese cliente, así que cada request del storefront anónimo renderiza y consulta desde cero.
- `/[store]`: 4 queries (3 veces la misma tienda + menú). Ficha de producto: 5. Carrito: 5 queries *por línea* más 5 del quote. `POST /api/orders`: 10+N round-trips en serie. Panel: 3-4 `getUser()` HTTP por request (A-03, A-04).
- El único `React.cache()` del repo es `resolveAdminSession`.
- **Pooling**: supabase-js habla HTTP con PostgREST; la app no abre conexiones Postgres. Supavisor/PostgREST poolean del lado de Supabase. Sí es desprolijo que `createAdminClient()` instancie un cliente nuevo por llamada; con `persistSession:false` puede ser singleton de módulo sin violar `server-no-shared-module-state`.

### Qué sí conviene, en orden

1. **Dedupe por request (gratis, hoy mismo).** `React.cache()` en `getStoreBySlug`, `getMenu`, `getCurrentUser`, `requireStoreMembership`. Elimina 2 de 4 queries del storefront y 2-3 llamadas a Auth por request de admin. Pasar `storeRow` a `priceCart`/`estimateEta` en vez de que lo re-lean.
2. **Cache entre requests de catálogo y branding con Next 16** (`'use cache'` + `cacheTag`). Requiere `cacheComponents: true` en `next.config.ts` (hoy ausente) y un cliente **sin cookies** para lecturas públicas (`lib/supabase/public.ts` con la publishable key): `'use cache'` no puede envolver una función que llame `cookies()`. Tags `store:${slug}` y `menu:${storeId}`, `cacheLife('hours')` como techo. Invalidar con **`updateTag`** (no `revalidateTag`: en Server Actions da read-your-own-writes, verificado en la doc) desde las 12 acciones de catálogo, ajustes, apariencia y `setStoreStatusAction`. `unstable_cache` está reemplazado en Next 16: no usarlo.
3. **Opcional**: LRU en memoria (`server-cache-lru`) para `store_payment_credentials` por `storeId` con TTL corto: se leen en cada checkout y webhook. Con Fluid Compute se comparte entre invocaciones.
4. **Mover agregaciones a SQL** (dashboard, métricas): es la única "optimización" que además arregla el bug de `max_rows` (A-01) y la zona horaria (A-10).

### Qué nunca cachear

- `priceCart` / `estimateEta`: precio y demora al momento del checkout; el ETA depende del conteo de pedidos activos *ahora*.
- `getOrderByToken` / `getOrdersByTokens` / `getActiveOrders`: estado del pedido y KDS.
- Credenciales sin TTL corto; nada que dependa de sesión de staff.
- Disponibilidad de producto *al crear el pedido*. Que el menú cacheado muestre un producto que `priceCart` va a rechazar es correcto: el menú es sugerencia, el servidor decide.

### Cuándo reconsiderar Redis

Rate limiting distribuido de `/api/orders` y del magic link (hoy no hay ninguno; Vercel WAF o una tabla con ventana lo cubren primero), locks para el cron si se vuelve multi-instancia (una función SQL con `skip locked` lo cubre), o si se abandona Vercel/Fluid y hace falta cache compartida entre procesos. Ninguna es de este año.

---

## Documentación que contradice el código

Estas discrepancias importan porque CLAUDE.md es el contrato que los agentes de implementación siguen al pie de la letra.

| Dónde dice | Qué dice | Qué es |
|---|---|---|
| CLAUDE.md "Estados" y "Multiplicador" | `pending_payment → paid → …`; `status in ('paid','preparing')` | `pending → confirmed → …`; `confirmed, preparing` (`order.schema.ts:15-31`, `functions.sql:126`) |
| CLAUDE.md "Multiplicador" | El ETA se congela "al confirmarse el pago" | Se congela al crear el pedido (`order.model.ts:372-393`) |
| CLAUDE.md "Branding" | "Todo valor que termina dentro del `<style>` pasa por brandingSchema" | El schema no se ejecuta; protegen los CHECK de Postgres (S-07) |
| CLAUDE.md "Identificadores" | `public_token` "~119 bits" | Espacio, no entropía: `random()` no es CSPRNG (P-11) |
| CLAUDE.md "Email" | Sin email, "WhatsApp es el único canal" | `order_confirmed` nunca se envía (P-18) |
| CLAUDE.md / bootstrap | "Hay que volver a enrolar el TOTP cada vez" | TOTP está deshabilitado en `config.toml`; no se puede enrolar (S-09) |
| `webhook.adapter.ts:69-73` | "`order_events` no tiene columna de último intento" | `last_attempt_at` existe en `orders.sql:148` (P-10) |
| `fonts.ts:19-21` | "El navegador solo descarga las que el CSS usa" | `next/font` precarga todas desde el root layout (F-03) |
| `category-list.tsx:242` | Los productos "quedan sin categoría, no se borran" | Desaparecen del admin (A-05) |
| `scripts/bootstrap-dev.mjs:152` | Inserta `fulfillment: 'pickup'` | La columna no existe en `orders`; `db:reset -- --orders` debería fallar (a confirmar en runtime) |
| `order.model.ts:280-282` | `private.estimate_eta` "no es callable desde PostgREST a propósito" | Es código muerto que duplica la fórmula en TS (A-13) |

---

## Lo que está bien y no hay que tocar

- **Precio server-side real**: `priceCart` recalcula todo contra la base filtrando `products.store_id`, valida disponibilidad, pertenencia de opciones, `min/max_select`. El browser manda solo IDs; `.strict()` en ambos schemas. Límites de cantidad hacen imposible el overflow.
- **Idempotencia**: UUID generado al confirmar, persistido por tienda, descartado al mutar el carrito, índice único, búsqueda previa + `23505`. Verificado que el cliente lo implementa como dice CLAUDE.md.
- **Webhook**: firma antes que nada, HMAC en tiempo constante con largo chequeado, `false` sin secreto, re-consulta a MP, dedupe por `provider_payment_id`. Eventos fuera de orden no importan porque siempre se lee el estado actual.
- **Dinero**: centavos enteros, `sumCents` con `assertCents`, conversión decimal solo en el borde con `Math.round`, `bigint` con CHECK.
- **RLS**: habilitado en las 17 tablas; todas las policies con `TO` + predicado; `USING` + `WITH CHECK`; helpers `private.*` con `search_path=''`, sin `USAGE` para `authenticated` (verificado: `permission denied for schema private`); PostgREST no expone el schema. `is_platform_admin()` exige `aal2` *y* fila en `platform_admins`: un dueño de local con TOTP enrolado ve 0 filas (verificado). `anon` no lee `orders` ni credenciales.
- **Los tres clientes** de Supabase bien separados; `server-only` en `admin.ts` y `env.server.ts`; `proxy.ts` con `getClaims()` (patrón exacto de la doc actual). Secretos no trackeados (verificado con `git check-ignore` y `git ls-files`).
- **Magic link**: `shouldCreateUser: false`, respuesta constante exista o no el email, `verifyOtp` con `token_hash`, callback en Route Handler.
- **Concurrencia en cocina**: `.eq('status', from)` → 409 y la UI refresca; `ALLOWED_TRANSITIONS` compartido entre modelo y UI; cocina y dinero como dos relojes.
- **Errores**: `DomainError` vs interno consistente; `zodToApiError` sin `issues` ni nombre de clave. Notificaciones nunca rompen el flujo de pago; idempotency key de Resend.
- **Schema**: snapshots en `order_items`, `on delete set null` en producto/opción, `restrict` en tienda, índices con `store_id` adelante, `timestamptz`, triggers de `updated_at`.
- **Frontend**: doble tap bloqueado, líneas viejas del carrito con error contenido por fila, reorder validado contra la carta vigente, tema sin flash, `next/image` con `sizes`, compresión de imagen en cliente, confirmaciones destructivas con slug tipeado, un solo helper de dinero, superficies del navegador tematizadas.
- `tsc` y `eslint` limpios; ningún `console.log`; ningún `any` sin justificar; ninguna función de 200+ líneas; ninguna page importa `@supabase/*`; ningún `.actions.ts` exporta algo que no sea función async.

---

## Plan priorizado

Orden sugerido. Es una secuencia real: cada fase asume la anterior. Nada de esto se implementó; el informe es de solo lectura.

### Fase 1 — Antes del primer pedido real

- P-01: `store_id`, monto y moneda en el webhook.
- S-01 / S-02: grants por columna en `stores` y `orders` + trigger de transiciones en Postgres.
- S-03: `role === 'owner'` para credenciales de pago.
- F-01: botón "Ir a pagar" en el tracking; no vaciar el carrito antes de `approved`; `back_urls` distintas.
- P-05: 5xx en errores transitorios del webhook + cron de reconciliación.
- P-08: programar el cron (`vercel.json`, `GET`).
- A-02: commitear, un solo gestor, CI mínimo.
- S-09 / S-11 / S-12: TOTP local on, `enable_signup = false`, guarda de host en el bootstrap.

### Fase 2 — Cierre del ciclo del dinero

- P-02 refunds/chargebacks/rejected · P-03 cancelación con reembolso y update condicionado · P-04 expiración de pendientes y de preferencia, ETA al pagar · P-06 reuso de preferencia y detección de doble pago.
- P-09 `create_order` como función SQL transaccional (usa `next_short_code`/`estimate_eta` ya existentes; resuelve A-06 y el `23505` ambiguo).
- A-01 agregaciones en SQL con `at time zone` (resuelve P-13 y A-10).
- S-04 `notifyOnReady` reconstruido en servidor · S-08 credenciales en Vault + chequeo de `live_mode`.
- P-07 / S-06 rate limit en `/api/orders` y en el magic link (o login desde el browser).
- Tests del `test-engineer` sobre `priceCart`, transiciones, webhook y RLS.

### Fase 3 — Rendimiento y estructura

- A-03 / A-04 `React.cache()`, una cotización por carrito, `getClaims`, un solo lugar para membresía.
- Cache de catálogo/branding con `'use cache'` + `updateTag` y cliente sin cookies.
- A-07 consolidar `toActionResult`, `toStore`, log de notificaciones, fechas y etiquetas · A-08 quitar controllers pass-through · A-13 borrar código y deps muertos.
- P-10 outbox con lock, `last_attempt_at`, dead-letter, entrega por endpoint, timestamp firmado.
- S-05 FK compuesta categoría/tienda · S-07 `brandingSchema.parse` · S-10 headers de seguridad · A-05 huérfanos de categoría.

### Fase 4 — Frontend y accesibilidad

- F-02 `loading`/`error`/`not-found` · F-03 fuentes con `preload: false` · F-04 targets de 44 px · F-05 labels y errores por campo (decidir `react-hook-form`) · F-06 contraste sin opacidades · F-07 alerta de pedido nuevo en KDS.
- F-08 a F-16: assets de marca, borrado de imagen, inputs de dinero, kickers, mono, toasts, reduced motion, tokens.
- Resto de bajos y mejoras; actualizar CLAUDE.md con el vocabulario real y las defensas reales.

---

*Auditoría de solo lectura sobre `/Volumes/SSD/Work/burger-shop`, 26 de agosto de 2026. Cuatro revisiones independientes (pagos y estados; seguridad y RLS; arquitectura y código; frontend y UX) consolidadas y verificadas por el lead. Las pruebas de RLS se corrieron contra el stack local dentro de transacciones con `ROLLBACK`. Todo lo marcado "a confirmar" no se pudo verificar sin acceso al proyecto hosted o a un dispositivo real. Versión web: https://claude.ai/code/artifact/3d5f2b82-1675-4a3d-ad66-d2319934b125*
