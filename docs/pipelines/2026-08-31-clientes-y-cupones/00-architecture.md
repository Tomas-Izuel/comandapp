# Clientes y cupones — arquitectura

> **Estado: APROBADO** por el dueño del producto (2026-08-31), con las diez
> preguntas de §9 contestadas y dos requisitos nuevos incorporados en esa ronda:
> el cupo de campaña de **15 mails/día como palanca comercial** (§5.10.3) y la
> **verificación por código de 6 dígitos para crear o modificar un cupón**
> (§5.11.3), que revierte lo que la primera versión de este documento proponía.
>
> **No queda ninguna pregunta abierta.** La última ronda (2026-08-31) cerró la
> asimetría del código de confirmación, cambió el modelo de consumo del cupón de
> *contar* a **reservar** (§5.7.2, el cambio más profundo de todo el feature) y
> descartó el segmento de reactivación en favor del WhatsApp precargado (§5.5.1).
> El registro completo está en §9.
>
> El corte en slices está en `01-tasks.md`.
>
> Autor: `feature-planner`. Fecha: 2026-08-31.
> Migración más nueva al momento de escribir: `20260831120000_transferencia_bancaria.sql`.

---

## 1. Problema y contexto

### 1.1 Lo que se pidió (textual)

**Clientes:**
- Nuevo apartado que registra los clientes para el admin (no auth, con la info
  que agregan para el pedido).
- Vista de clientes: una tabla ordenada con el cliente que mayor plata gastó
  históricamente hacia abajo. *"Yo me la imagino en pedidos (`/admin/pedidos`)
  en otra tab, pero si lo encontrás mejor en otro lado podemos debatirlo."*
- La tabla muestra el mail (si lo cargó) con un `mailto:`, el botón de mandar
  mensaje de WhatsApp, nombre, pedidos, etc. *"Podemos explorar qué otra data
  puede ser útil."*

**Cupones:**
- El admin puede crear cupones.
- Los cupones pueden ser por rango de fechas o por cantidad de usos.
- Promociones de los cupones con el nuevo apartado de clientes: permite definir
  si a todos los clientes, a los mejores X, a los que gastaron más de tanto, etc.
- Los cupones son enviados por mail.

**Dos definiciones posteriores del dueño, ya cerradas y no reabiertas acá:**

1. **El cupón se puede restringir por método de pago**, multi-select con checks.
2. **Código compartido, uno por cupón.** Textual: *"no nos metemos en eso por
   ahora, si se filtra problema del usuario"*. O sea: nada de código único por
   destinatario, nada de allowlist verificada al canjear. **El targeting es
   lista de distribución, no control de acceso.** La exposición de un código
   filtrado está calculada en §5.9.3.

**Y dos definiciones más de la ronda de aprobación (2026-08-31), que cambian el
diseño y no solo lo confirman:**

3. **El cupo de campaña es de 15 mails por día**, y es una **palanca comercial**,
   no una constante de seguridad. Textual: *"Limitemos campañas de mails a 15
   cupones por día, si lo desean extender un mail de comandapp para negociar otro
   plan (maybe ventas@comandapp.ar)"*. Consecuencias en §5.10.3, §5.10.3.1 y
   §5.10.6 — incluido el problema nuevo de que **un cupón puede vencer antes de que
   la campaña termine de mandarse**.
4. **Crear o modificar un cupón pide el código de 6 dígitos por mail.** Textual:
   *"crear o modificar cupones pide la verificación de código por mail"*. **Esto
   revierte lo que la primera versión de este documento proponía**, que era
   explícitamente que un cupón no cruzaba a `store_pending_changes`. Mecanismo
   completo en §5.11.3, con una desviación propuesta (apagar no pide código) que
   queda **aprobada** en la ronda final: *"No apagar se apaga sin codigo"*.

**Y tres definiciones de la ronda final (2026-08-31), de las cuales una rehace el
modelo de datos:**

5. **El uso del cupón se RESERVA, no se cuenta.** Textual: *"Se bloquea al crear el
   pedido, se descuenta temporalmente, si el pedido no se completa se libera"*. Ni
   la redención permanente que este documento proponía ni un "liberar si nunca se
   cobró": es un modelo de **reserva con confirmación**, de tres estados, y es más
   fino que las dos. Rehace `coupon_redemptions`, agrega dos contadores y dos
   triggers, y cambia el CHECK del tope. Todo en §5.7.2 y §5.9.2.
6. **La reactivación es WhatsApp, no un segmento.** Textual: *"Reactivarlos es un
   mensaje de whatsapp, mas personal. Boton para ir a watsapp con el mensaje pre
   cargado"*. No hay cuarto `segment_kind`; el botón del padrón lleva mensaje
   precargado (§5.5.1).
7. **La asimetría del código está aprobada.** Textual: *"No apagar se apaga sin
   codigo"*. Pausar, desactivar, bajar un tope y acortar la vigencia van **sin**
   código (§5.11.3).

El registro completo, con qué coincidió con lo recomendado y qué no, está en §9.

### 1.2 Qué es esto realmente

Son **dos features**, no una, y conviene nombrarlas por lo que son antes de
diseñarlas:

1. **Un CRM de una sola tabla.** El producto ya tiene los datos (nombre,
   teléfono, email opcional) esparcidos en `orders`, una fila por pedido. Lo que
   falta no es capturarlos: es **darles identidad** —"estas 7 filas son la misma
   persona"— y **agregarlos**. Eso es un padrón de clientes.
2. **Un motor de descuentos.** Un cupón es un objeto que modifica el total de un
   pedido. En este repo eso significa tocar la ecuación del dinero, que hoy tiene
   un CHECK en Postgres cuidándola, y tocar `create_order`, que es la función más
   sensible del sistema.

La tercera cosa que el pedido contiene sin nombrarla es **un sistema de envío
masivo de mail promocional**, que no es lo mismo que los ocho mails
transaccionales que el producto ya manda. Ahí está el 80% del riesgo real
(§3.4, §4.1, §5.10).

### 1.3 Restricciones vinculantes (de `CLAUDE.md`, no se negocian)

| Restricción | Consecuencia directa acá |
|---|---|
| `app/**/page.tsx` no importa `@supabase/*` | Todo acceso a Postgres en `models/` |
| Lecturas y acciones en archivos separados | `customers.controller.ts` / `marketing.actions.ts` |
| Un `.actions.ts` solo exporta funciones async | `humanizeRetryAfter` se vuelve a duplicar |
| Dinero en centavos enteros, nunca float | El % se calcula con enteros, no con `Math.round(x*0.15)` |
| El precio lo pone el servidor | El cliente manda el **código**, nunca el descuento |
| Invariantes en Postgres, permisos en RLS | Los topes del cupón van en CHECK, no en un `if` |
| Grants por COLUMNA | Las tablas nuevas: **cero** grants para `authenticated` (§5.11) |
| `/admin` no hereda la composición del cliente | Superficie **Operate**: densidad y retomar el hilo |
| Mobile-first | El padrón se lee en un celular parado en la caja |
| PostgREST corta en `max_rows = 1000` **sin error** | El padrón se lee por RPC, no por tabla |
| `create_order` enumera columnas a mano | Una columna nueva de pedido que falte ahí **desaparece sin error** |

---

## 2. El sistema real, verificado

### 2.1 Estado del proyecto linkeado (Supabase MCP, 2026-08-31)

`list_tables` devuelve **24 tablas** en `public`, no 21 (`CLAUDE.md` está
desactualizado en ese número: le faltan `store_hours`, `store_hours_overrides` y
`store_bank_accounts`). `get_advisors(security)` no reporta nada nuevo relevante:
cuatro `rls_enabled_no_policy` en INFO (`rate_limits`, `signup_allowlist`,
`store_payment_credentials`, `store_pending_changes` — todas deliberadas, son
tablas de solo-`service_role`) y los WARN de siempre por `SECURITY DEFINER`
llamable por `authenticated`, que en este repo es el patrón aceptado con chequeo
de permiso en el cuerpo.

**Esto importa para el diseño:** las tres tablas nuevas de este feature van a
sumarse a esa lista de `rls_enabled_no_policy` en INFO, y eso es correcto, no una
regresión. Se documenta acá para que nadie lo "arregle" agregando policies.

### 2.2 Lo que ya existe y se reusa tal cual

Nada de esto se reinventa. Es la mitad del argumento de por qué este feature es
más chico de lo que parece:

| Pieza | Dónde | Para qué acá |
|---|---|---|
| `phoneSchema` | `order.schema.ts:136` | **La clave de identidad ya está normalizada.** Devuelve siempre `+549` + 10 dígitos, y respeta la trampa del `15` de Córdoba (solo lo saca si sobran dígitos) |
| `private.order_is_billable(...)` | `20260826120100_rpc.sql:32` | El predicado canónico de "esto es plata". Base de "plata gastada" (§5.4) |
| `private.random_token(24)` | `20260825120200_functions.sql` | CSPRNG + rejection sampling. Genera el token de baja del mail |
| `private.set_updated_at()` | idem | Trigger de `updated_at` |
| `private.is_store_owner()` | `20260828130000_delivery.sql` | El gate de todas las RPC nuevas |
| `consume_rate_limit` + `RATE_LIMIT_POLICY` | `rate-limits.sql`, `rate-limit-policy.ts` | Baldes nuevos, mecanismo idéntico |
| `claim_event_deliveries` (patrón) | `outbox_deliveries.sql` | `for update skip locked` para drenar la campaña |
| `private.invoke_app_cron` + pg_cron | `pg_cron_scheduling.sql` | El cron nuevo, sin tocar `vercel.json` |
| `EmailSender` / adapters de Resend | `services/notifications/email/` | El canal. Ojo: el puerto es por PEDIDO (§5.10.4) |
| `PageFrame` / `PanelHeading` | `views/admin/page-frame.tsx` | El marco de las dos pantallas |
| `SettingsTabs` (patrón) | `views/admin/ajustes/` | La sub-nav de tabs de una sección |
| `Panel`, `StatusPill`, `Price`, `EmptyState` | `views/shared/` | La gramática. Nadie inventa una primitiva |
| `store_pending_changes` | `store_pending_changes.sql` | **NO se usa acá.** Ver §5.11.3 |

### 2.3 Los cinco lugares que enumeran columnas a mano

Trampa documentada en `CLAUDE.md`, verificada en las migraciones. Un cupón agrega
**dos columnas a `orders`** (§5.8), así que hay que revisar los cinco:

| Función | Vigente en | ¿Toca? |
|---|---|---|
| `public.create_order` | `20260829170000_scheduled_orders_and_hours.sql:467` | **SÍ.** Inserta las dos columnas nuevas y consume el cupón |
| `public.store_dashboard` | `20260829170000_...:869` | **SÍ.** Suma `total_cents`, que ya refleja el descuento — pero le falta "cuánto regalé" (§5.8.3) |
| `public.platform_stores` | `20260831120000_transferencia_bancaria.sql:579` | **NO.** Enumera columnas de `stores`, no de `orders`, y su `revenue` sale de `sum(o.total_cents)`, que ya es el total con descuento |
| `public.courier_queue` | `20260828130000_delivery.sql:534` | **SÍ, una clave.** Devuelve `subtotalCents`/`totalCents` armados a mano. `totalCents` ya es correcto (es lo que el repartidor cobra); falta `discountCents` para que pueda explicarlo en la puerta |
| `public.store_couriers` | `20260828130000_delivery.sql` + `courier_stats.sql` | **A verificar en la migración.** Sus métricas de arqueo salen de `total_cents`, que ya es correcto |

**Y la trampa tiene una segunda mitad que no está en `CLAUDE.md`: el camino de
LECTURA en TypeScript también enumera.** `ORDER_WITH_ITEMS_SELECT` empieza con
`'*'`, así que las columnas nuevas llegan de PostgREST solas — pero `toOrder()`,
el tipo `Order`, el `Pick<>` de `OrderPublicView` y `toOrderPublicView()` mapean
campo por campo. Una columna que falta ahí **existe en la fila y nunca llega a la
vista, sin ningún error**. La tabla completa está en §5.14.3.

### 2.4 La ecuación del dinero, hoy

```
orders_total_is_subtotal_plus_delivery_check:
  total_cents = subtotal_cents + delivery_fee_cents          -- 20260828130000_delivery.sql:199
```

Y en `order.model.ts:707`, en TypeScript:

```
const totalCents = priced.subtotalCents + deliveryFeeCents
```

Los dos son la misma regla escrita dos veces a propósito: el CHECK existe porque
`create_order` enumera columnas y olvidarse de pasar `delivery_fee_cents`
**regalaba el envío sin ningún error**. Un descuento agrega un término a esa
ecuación, así que el CHECK **tiene** que cambiar. §5.8.2 explica por qué eso
amplía la red en vez de romperla.

### 2.5 Mercado Pago arma su propio total

`mercadopago.adapter.ts:192` y `checkout.controller.ts:237`: MP suma
`unit_price × quantity` de cada item de la preferencia. Por eso el envío viaja
**como un item más** llamado "Envío". El adapter además tiene una cota defensiva:
si `totalCents < suma de items`, tira.

Eso significa que **un descuento no puede simplemente restarse de `totalCents`**:
rompería esa cota, o peor, MP le cobraría al cliente el precio sin descuento y el
webhook llegaría con un monto que no coincide → `mismatch` para siempre, cliente
pagó y el pedido nunca se confirma. §5.8.4 lo resuelve.

---

## 3. Investigación

### 3.1 Padrón de clientes sin cuenta: cómo lo resuelve la categoría

Consultado: doc de desarrolladores y centro de ayuda de **Square** (Customers
API, `keep-records`, `duplicated-customers`, grupos y filtros, Customer
Insights), soporte de **Toast** (Guestbook, Guest Report, Marketing Audience,
Loyalty FAQ), blog de **Olo** (identidad del comensal anónimo, LTV). De
**ChowNow** y **Slice** no hay nada técnico público.

**La clave de identidad.**

| Plataforma | Clave documentada | ¿Usa la tarjeta? |
|---|---|---|
| Square | Cascada: `customer_id` explícito → del pedido → **inferencia difusa** por dirección, email y medio de pago. Para el dedupe del integrador nombra **teléfono, email, `reference_id`** | Sí ("payment source") |
| Toast | **email O teléfono**, al menos uno obligatorio | Sí, pero como *alias* del contacto |
| Olo | **Token de tarjeta** como espina dorsal, deliberadamente | Sí, primaria |

El dato que más informa el diseño es **por qué** Square y Olo llegan a la
tarjeta. Olo lo explica: ~80% de los pedidos de restaurante entran tipeados a
mano en el POS sin ningún identificador, y solo ~18% de las transacciones son
digitales. **Ése no es nuestro problema:** este checkout **exige teléfono**, y
`phoneSchema` ya lo normaliza. Meter huella de tarjeta agregaría una superficie
de PII a cambio de cero. Y donde Square sí nombra claves canónicas —para que el
integrador no duplique— la primera de la lista es el teléfono.

Toast hace explícito el modelo que elegimos: *"Multiple credit cards can be
linked to a single loyalty account, but only one email or phone number and one
customer profile can be used per account."* Contacto = clave; el resto = alias.

**Los conflictos de merge, y esto valida las tres decisiones de §5.2.** Square,
textual: *"If profile names are dissimilar or if two profiles have different
email or phone numbers, they won't be identified as duplicates automatically,
but you can still manually merge them."* O sea: **mismo teléfono con dos
nombres, y dos teléfonos con un mail, NO se detectan como duplicados.** Merge
solo manual, y *"A merge can't be undone."* La automatización de Square es
deliberadamente angosta: *"Square will never automatically merge two profiles
that both have loyalty accounts."*

Y el contraejemplo, que es la advertencia: en Toast hay reportes de operadores
de **dos clientes distintos, con dos teléfonos distintos, colapsados en un solo
perfil, sin forma de separarlos** — y un cliente canjeando los puntos del otro.
La lección es directa: **sobre-matchear es estrictamente peor que
sub-matchear**, porque el merge es irreversible y el radio de daño es plata.
Por eso §5.2 no fusiona nunca por email: dos teléfonos con la misma casilla son
dos clientes, y el costo aceptado —el mismo `mailto:` dos veces— es reversible.

**Las métricas de la lista.** Square ordena y filtra por: última visita, gasto
promedio, gasto total, cantidad de compras. Toast **muestra** una lista larga
(última fecha, cantidad, gasto promedio por ticket, propina promedio, gasto de
por vida, canal, % de tipos de entrega, lealtad, productos más pedidos,
feedback).

**Pero el hallazgo más filoso es la diferencia entre lo que Toast muestra y lo
que deja filtrar:** los campos de segmentación son última compra, cantidad de
pedidos, gasto promedio por ticket, propina promedio, canal, tipo de entrega,
lealtad y tags. **El gasto de por vida se muestra y NO se puede filtrar.** El
propio producto de Toast dice que el gasto histórico es un número de reporte, no
uno operativo. Olo lo firma: *"Guest lifetime value is not a marketing metric.
It is a business intelligence metric"*, y los insumos accionables son
*"frequency, recency, and spending"*.

Los dos conjuntos filtrables convergen en **cuatro**: última compra, cantidad de
pedidos, gasto total, ticket promedio. Son exactamente las cuatro de §5.5. El
dueño pidió el orden por gasto histórico y se respeta —es la columna de
ordenamiento— pero el set que acompaña no es una lista de deseos: es lo que dos
vendors independientes decidieron que sirve.

⚠️ **Hueco declarado:** no se pudo conseguir opinión de operadores reales
(nada sustantivo en Reddit; la comunidad de Toast devuelve 403 a fetch
automatizado). El "sirve vs. es ruido" de arriba está inferido del
**comportamiento de los vendors** —qué automatizan y qué dejan filtrar—, no de
citas de usuarios. Se declara en vez de inventarse.

**"Gasto de por vida" no tiene definición autoritativa en ningún lado.** Es el
área peor documentada de todo el tema, y conviene decirlo:

- La única definición dura de Square es de *Customer Insights*, no de la columna
  del padrón: *"the average amount customers spent... **including tax and tip**"*
  y *"**All insights are based on credit and debit card transactions only. Cash
  transactions aren't included**"*. Bruto, con impuesto y propina, solo tarjeta.
  ⚠️ **Reembolsos, anulaciones y cancelaciones no se mencionan en ningún lado.**
- El objeto `Customer` de la API de Square **no tiene ni un campo agregado**: ni
  gasto, ni visitas, ni última compra. Señal de diseño: Square los calcula del
  libro de pedidos al leer, no los persiste.
- Toast muestra "Lifetime spend" y no lo define. Su única frase definitoria es
  sobre el denominador: *"Guestbook only includes order totals attached to a
  guest profile"*, y tuvo que escribir una FAQ porque los operadores no entendían
  por qué el total del padrón no coincide con el de ventas.

**Dos consecuencias que este diseño adopta:** (1) la definición es nuestra, así
que **hay que decirla en la interfaz** —§5.4 la fija y el panel la explica en una
línea—; y (2) el padrón nunca va a sumar lo mismo que la facturación del
dashboard, porque hay pedidos que no matchean. Eso se dice, no se esconde.

**Segmentos por defecto: Square es el único con números publicados.**

| Grupo | Default documentado |
|---|---|
| **Regulars** | *"customers who've visited your business **three times in the last six months**"* |
| **Lapsed** | *"customers who **were regulars**, but haven't visited in the **last six weeks**"* |

**Lo estructural, y vale robarlo: el "Lapsed" de Square está condicionado a
haber sido "Regular" antes.** Un cliente de una sola vez que no vuelve **no**
está "lapsed". Eso evita el modo de falla de una regla de sola recencia, que se
llena de tráfico que nunca iba a repetir.

⚠️ Square **no** tiene grupos "Loyal", "At risk" ni "New" por defecto —esos
nombres circulan en blogs de terceros, no en su doc— y no publica umbral para
"top spenders" ni "frequent visitors". Toast tiene cuatro auto-segmentos (All,
Big Spenders, Lapsed, Regulars) y **no publica un número para ninguno**. Olo
nombra RFM y no define nada.

**Cómo pega en el diseño:** los tres segmentos que pidió el dueño (`all`,
`top_n`, `min_spent`) son más simples que los de Square y **están bien así para
v1**, porque son explícitos: el dueño elige el número y lo ve. Un "Lapsed"
automático necesitaría un umbral que ni Square ni Toast se animan a publicar
para una vertical genérica, y la ventana de 6 semanas de Square está calibrada
para retail, no para la cadencia de una hamburguesería. La columna "Última
compra" de §5.5 le da al dueño la información cruda para decidir el umbral él
mismo, que es lo honesto mientras no haya datos de uso (`PRODUCT.md`: *"No
existe ningún dato de uso... Nada de eso puede inventarse"*). Un segmento
`inactive_days` **quedó descartado por el dueño del producto**: la reactivación no
es una campaña, es un mensaje de WhatsApp uno a uno (§5.5.1). La columna "Última
compra" es entonces el insumo completo, no un paso intermedio.

### 3.2 Cupones: cómo los modela la categoría

Consultado: Admin GraphQL de **Shopify** (`DiscountCode*`,
`DiscountCustomerGetsValueInput`, `discountRedeemCodeBulkAdd`) + su centro de
ayuda; **Square** (Online coupons, vanity codes, descuentos de POS, y sus hilos
de comunidad con respuesta de staff); **Toast** (Supported Discounts for Online
Ordering, single-use promo codes); **Stripe** (coupons, idempotencia, guía de
fraude de promociones); **WooCommerce**; **Talon.One** y **Voucherify** para
formato de código; **Klaviyo**, **Braze** e **Iterable** para el envío.

**La forma del valor.** Shopify: `percentage: Float` *"between 0.00 - 1.00"*, y
`discountAmount: { amount: Decimal, appliesOnEachItem: Boolean }`.

Tres lecturas, una de las cuales es un rechazo:

- **Se rechaza el porcentaje como float.** Con la regla de centavos enteros de
  este repo, un `Float` de porcentaje reintroduce exactamente el bug que
  `CLAUDE.md` ya documenta (`20 * 1.1 = 22.000000000000004`). Dato que refuerza:
  **Square eligió *strings*** para sus porcentajes (`"7.25"` = 7,25%),
  esquivando el float a propósito. §5.7.1 usa `int` 1..100 y aritmética entera,
  que es más simple que las dos.
- **Se roba el resumen materializado.** Shopify persiste `summary` /
  `shortSummary`: la regla es dato de máquina, la frase para el comerciante se
  computa una vez. Acá eso es `describeDiscount()` en `src/lib/coupon.ts` (§5.14),
  un módulo puro y **sin `server-only`**, para que la misma función que arma
  "15% hasta $3.000" en el formulario sea la que lo escribe en el mail.
- **`appliesOnEachItem` es una ambigüedad real** que Shopify obliga a resolver:
  un monto fijo con más de una línea es "$5 por hamburguesa" o "$5 repartidos".
  **Acá no aplica y por eso no existe la columna**: el descuento de §5.7.1 se
  aplica **al subtotal del pedido**, nunca por línea. Se deja dicho para que
  nadie lo agregue "porque Shopify lo tiene".

**Topes de uso.** Shopify: `usageLimit: Int` (null = ilimitado) global,
`appliesOncePerCustomer: Boolean` por cliente, y `asyncUsageCount: Int!` —
*"updated asynchronously and can be different than the actual usage count"*.
Ese último campo es una confesión: el contador de Shopify **no es exacto**.

**Combinabilidad, y el dato histórico que justifica el alcance.** Shopify tiene
tres booleanos y un máximo de 5 códigos de producto/pedido + 1 de envío por
pedido; dos descuentos de 10% apilados dan **20%, no 19%** (los dos calculan
sobre el subtotal original). **Pero combinar descuentos dentro de un pedido
recién salió alrededor de marzo de 2024: Shopify corrió una década de comercio
global con un código por pedido.** Toast, en su producto de online ordering:
*"Only one promo code or discount can be applied to a single check"* salvo un
flag, no disponible para descuentos de ítem. Square: *"Customers can only use
one online coupon code at a time"*.

**Eso es la evidencia dura de que "un cupón por pedido" (§5.7.2,
`unique (order_id)`) es un v1 respetable y no un recorte**, y de que la
combinabilidad es la parte cara.

**Toast es el análogo más cercano, y eligió el teléfono.** Es el hallazgo más
transferible de toda la investigación, porque Toast es un POS de restaurante con
pedido online de invitado, o sea nuestro caso exacto:

> *"A single-use promo code can only be used once by each guest."*

Se **rastrea por número de teléfono del comensal**, y Toast **pide el teléfono
antes de aceptar el código**. Si ya se usó, avisa que el código no vale más.

Eso es estrictamente mejor que Shopify, que rechaza **tarde**: un miembro de la
comunidad describe el runtime como *"if you try to apply a limited discount code
with a guest user, it will work until an email is provided"* — el cliente ve el
descuento y lo pierde recién al tipear el mail. Es el reclamo número uno en cada
hilo. **Nuestro checkout ya tiene el teléfono antes del cupón**, así que el
rechazo temprano de Toast sale gratis, y por eso el tope de §5.7.1 se llama
`max_redemptions_per_phone`: no es una aproximación de "por cliente", es lo que
el análogo más cercano del rubro realmente implementa.

**El techo de Square, que es la mejor guía de prioridades.** Square Online no
tiene tope por cliente —staff, enero 2024: *"it is not possible to set the limit
as one use, however, this feature is on the roadmap"*— y **no tiene generación
masiva de códigos únicos**; el workaround oficial de un moderador es
*"un-check Unlimited and add 1 for the number available. **You'll have to make
one for each customer, though.**"* El tope **global** sí existe.

Leído con cuidado: **Square envió el contador global y salteó el por-identidad.**
Eso confirma el orden de §5.7.1: `max_redemptions` es `not null` (obligatorio) y
`max_redemptions_per_phone` es el secundario.

Y Square aporta dos reglas que Shopify no tiene y que sí adoptamos o
descartamos con motivo:
- **"Set maximum discount value"** — el tope absoluto de un porcentaje. Es
  `max_discount_cents` de §5.7.1, y es lo que evita el 30% sobre un pedido de
  catering.
- **Valor máximo de ticket** (Toast también lo tiene: Min/Max Check Value) —
  "10% off, pero no en un pedido de $900". **No se incluye en v1**: con
  `max_discount_cents` el techo de plata ya está puesto, y es un campo menos en
  un formulario que ya tiene nueve.

Detalle chico y real: **los códigos de Square son insensibles a mayúsculas**
(documentado). Acá el `code` se normaliza a mayúsculas en el schema y el CHECK
es `^[A-Z0-9]{4,16}$`, que da el mismo resultado con una regla en vez de dos.

**"Clientes específicos" no es autorización, y esto cierra el tema (§4.4).**
`DiscountCustomerSelection` de Shopify acepta clientes o segmentos, y **Shopify
nunca documenta el mecanismo de enforcement**. Lo que hay: los clientes *"can be
identified when they check out using a valid email address or phone number"*; un
segmento **no puede contener compradores nuevos** (*"New customers checking out
for the first time don't yet have a customer profile... so they won't be included
in the customer segment until after their first order is complete"*); tope duro
de **100 clientes específicos por código**; y comerciantes reportándolo como bug,
de febrero 2024 a enero 2025, **sin una sola respuesta de staff**. El consejo
estándar es "usá una app de terceros", y existe una categoría entera de apps de
Shopify cuya razón de ser es que esto no funciona.

**Conclusión: la elegibilidad es un match posterior sobre un handle
auto-declarado y falsificable. No es autenticación, y no tiene solución.** Es
exactamente lo que el dueño decidió no construir, y la investigación dice que
tenía razón: la alternativa "código compartido + allowlist" que se descartó no
habría comprado seguridad, solo una cuesta de UX (rechazo tardío) y la ilusión de
control.

**Los códigos filtrados: el caso Honey es el mecanismo definitivo.** La extensión
de Honey capturaba códigos **al tipearlos** y los redistribuía: *"The moment you
type in a coupon code, Honey immediately sends that coupon code directly to their
servers."* Se filtraron códigos de empleado (confirmado por el CEO de Made In
Cookware), de influencers, VIP y militares. 181.000 tiendas en la base, 35.000
con consentimiento; 20+ demandas colectivas en diciembre 2024. Hoy existe una
categoría de apps de Shopify para bloquear ~150 extensiones de ese tipo.

**La lección estructural: cualquier código que un humano tipea en un checkout,
en un dispositivo que no controlás, es público en horas.** Eso mata el secreto
como mecanismo, y es la razón por la que §5.9.3 calcula el peor caso y §5.7.1
hace obligatorio el tope global. Los topes no son una comodidad: son la única
defensa.

Enumeración, también documentada: *"If your codes follow predictable patterns
(e.g., SAVE10, SAVE15, SAVE20), bots can extrapolate the entire series"*, y los
bots *"test thousands of code combinations per second"*. Las dos fuentes
prescriptivas de formato convergen: **Voucherify** pide 8–12 caracteres
alfanuméricos, sin prefijos predecibles, excluyendo confundibles (0/O);
**Talon.One** usa largo 4–20 con **default 8** y **excluye por defecto
`1IO02ZS6G`**, además de evitar `%`, `$` y `&` porque terminan en URLs.

**Cómo pega:** el `^[A-Z0-9]{4,16}$` de §5.7.1 permite un código corto y
hablable en el mostrador, que es un requisito real de esta vertical (el dueño
canta el código por teléfono). Pero un código **elegido por el dueño** no es
enumerable-resistente por sí solo, así que:
- La hoja de creación ofrece un botón **"Generar"** que produce 8 caracteres de
  un alfabeto sin confundibles con CSPRNG, y ése es el default.
- Se rechaza un código con patrón obvio secuencial? No: sería un lint arbitrario.
  En cambio la validación del cupón **está detrás de un balde de rate limiting**
  —control explícito de Stripe: *"rate-limit the promo-code validation
  endpoint"*— para que el espacio no se pueda caminar. Ver Q8 en §9: hoy
  `GET /api/orders` **no tiene límite de aplicación a propósito**, y el cupón lo
  convierte en un oráculo de códigos.
- Y vale la advertencia de `CLAUDE.md` sobre `public_token`: **con un alfabeto
  acotado, el espacio NO es la entropía** salvo que el generador sea CSPRNG con
  rejection sampling. `private.random_token` ya lo es; el generador del código
  tiene que usar el mismo camino, no `Math.random()`.

**La carrera del último uso: pasó en Stripe, y hay número de caso.**
[HackerOne #1717650](https://hackerone.com/reports/1717650), "Promotion code can
be used more than redemption limit", 2022-09-30, divulgado 2023-02-13,
**Closed/Resolved**, debilidad **TOCTOU race condition**. Repro:
`max_redemptions = 1`, dos Payment Links, aplicar el cupón en los dos, mandar
los dos rápido → **los dos pasan**. El reportante: *"can certainly be scaled
using burp."* Dos más, de la misma forma: Instacart #157996 (2016, resuelto, con
recompensa — cupón canjeado repetidamente y los ahorros **acumulándose**) y
Reverb #759247 (2019, **High**, resuelto — una gift card de $25 canjeada **siete
veces, $175**, con Turbo Intruder).

**Ése es el mejor argumento de todo el documento: `max_redemptions` en una
empresa de pagos no era atómico.** El mecanismo de Shopify tampoco es un
contador sino un *hold*: *"the discount code is held against its usage limit
until the payment completes or fails"*, con el efecto lateral documentado de que
**un checkout abandonado retiene el cupo indefinidamente** — que es justo el
problema que este producto ya resolvió para los pedidos con
`expire_pending_orders`, y que acá se evita por construcción porque el uso se
consume **al crear el pedido**, no al reservar.

Y la solución en la que converge cada write-up serio es exactamente la de
§5.9.2: **un UPDATE condicional atómico, no read-check-write**, más un log de
canjes con `order_id` y un `UNIQUE` para el tope por identidad —
*"This database-level constraint survives retry logic failures"* — con el
remate: *"application-level checks provide no protection"*. Acá eso son tres
cosas: el `for update` sobre la fila del cupón, el CHECK
`reserved_count + redeemed_count <= max_redemptions` que ni `service_role` esquiva, y el
`unique (order_id)` de `coupon_redemptions`.

**Doble canje en reintentos.** Consenso: la clave de idempotencia de la fila de
canje **es el id del pedido**, escrito en la misma transacción que el pedido.
Stripe advierte además que *"if the request conflicts with another request
that's executing concurrently, we don't save the idempotent result"*. Traducido
a este repo: el `idempotencyKey` que ya existe colapsa los reintentos **a nivel
pedido**, y una redención atada a `order_id` **hereda esa idempotencia gratis**.
Una clave de idempotencia propia del cupón sería una segunda cosa que puede
discrepar con la primera. Por eso §5.9.2 pone el bloque del cupón **después** del
`return` temprano de `create_order` y no inventa una clave nueva.

**La matemática del total: tres vendors independientes separan el descuento del
envío.**

- **Shopify**: "Amount off" (% o fijo) *"don't apply to shipping costs"*; envío
  gratis es un **tipo de descuento aparte**.
- **WooCommerce**, la frase más clara: *"Coupons do not affect shipping since
  they can only apply to cart items"*, y concretamente *"if a customer has a
  coupon covering the entire cost of the products in their cart but your store
  charges a $10 shipping fee, they will still pay the $10 shipping fee."*
- **Stripe**: `amount_off` — *"Amount that will be taken off the **subtotal**"*.

Orden de operaciones documentado por Shopify: descuentos de producto sobre los
ítems → descuentos de pedido sobre **el subtotal revisado** → descuentos de
envío al final.

Sin impuestos, eso colapsa exactamente en la ecuación de §5.8.2. **Y valida la
decisión de §5.7.1 de que el descuento nunca toque el envío**, que se había
tomado por un argumento propio (el envío es lo que el local le paga al
repartidor): la categoría entera lo hace igual, y para "envío gratis" tiene un
mecanismo separado — que acá ya existe, `delivery_free_from_cents`.

**El clampeo está documentado, y por componente, no sobre el total.** Shopify:
*"If the specified amount is greater then the cart total, the order is free."* Y
el argumento de seguridad lo da la guía de fraude de Stripe: los atacantes
combinan códigos *"to push a transaction toward zero cost or, if your system
issues store credit, negative cost."* **Un solo clamp sobre el gran total deja
que un descuento grande de subtotal se coma el envío; dos clamps no.** Es
precisamente el par de CHECKs de §5.8.2 (`discount ≤ subtotal` + la ecuación),
y ahora tiene respaldo externo.

**El hueco que la categoría no documenta y hay que decidir acá: ¿el mínimo de
envío se evalúa sobre el subtotal antes o después del descuento?** ⚠️ Shopify no
lo documenta (sus mínimos se miden *"before shipping, taxes, and duties"*, pero
pre- vs. post-**descuento** es silencio); la afirmación de que usa pre-descuento
viene solo de vendors que venden el parche. DoorDash y Uber Eats tampoco lo
publican.

**Es la misma circularidad que `src/lib/delivery.ts` ya documentó** ("cobrar el
envío para llegar al mínimo que habilita el envío es circular"), un nivel más
abajo. Decisión propuesta, y va como **Q9** en §9 porque es plata: **el mínimo
del pedido y el mínimo de envío se evalúan sobre el subtotal SIN descuento; el
umbral de envío gratis, sobre el subtotal CON descuento.** Razón: los mínimos
protegen al local de un pedido que no le conviene cocinar, y un cupón no cambia
lo que cuesta cocinarlo; el envío gratis en cambio es un regalo, y regalar el
envío por un subtotal que el cupón infló es pagar dos veces la misma promoción.

**Abuso, con números.** Ravelin: *"53% of merchants experienced increased promo
abuse in the past year"*; un solo fraudster acumuló **£50.000 en créditos de
Uber** publicando su código de referido en Reddit. Los controles que Stripe
enumera y que acá aplican: *"**Limit promo codes to one per verified identity,
not one per email address**"* (por eso el tope es por teléfono y §4.5 dice que es
blando), rate-limit del endpoint de validación (Q8), y ojo con
`user+tag@domain.com`. El evento cuantificado más grande del registro público:
PayPal cerró **4,5 millones de cuentas** creadas por granjas de bots que
cosechaban un incentivo de $10 (Q4 2021).

⚠️ **Hueco declarado:** no parece existir un post-mortem de ingeniería
first-party de un incidente de código viral sin tope. Los artefactos verificables
de pérdida son los tres de HackerOne, el caso Air Canada (código de 50% filtrado
por un contratista, **$36.000** en pasajes, condena) y el de PayPal.

**Códigos únicos por destinatario: qué hace la industria (para el registro).**
Aunque el dueño lo cerró, conviene dejar asentado qué se descartó. La industria
usa único-por-destinatario para todo lo targeteado: Klaviyo (*"no 2 recipients
will have the same code... they limit oversharing"*), Talon.One (*"Personal codes
restrict redemption to specified customer integration IDs"*). Costo real:
gestión del pool. Braze *"A failed message still consumes the code"* y
*"Entering or re-entering a Canvas step consumes a new code"*; Shopify genera de
a **250 por llamada**, asincrónico, y su guía dice **desacoplar la generación de
la distribución** porque generar en el momento del envío es el camino de falla
documentado. Y el hueco de Shopify que en Postgres es trivial: **`usageLimit`
vive en el descuento, no en el código**, así que N códigos únicos comparten un
pool y un destinatario codicioso puede comerse dos.

Si algún día se reabre, el camino es `unique (coupon_id, code)` + contador por
código — la misma forma que este repo ya usó para
`orders(store_id, idempotency_key)`.

### 3.3 Mercado Pago no tiene una primitiva de cupón que nos sirva

Verificado por dos caminos independientes: el MCP de Mercado Pago
(`search_documentation`, MLA, es) y la referencia de `create-preference`.

- **El body de la preferencia de Checkout Pro no tiene `discount`, `coupon`,
  `coupon_code` ni `promotion`.** Confirmado leyendo la referencia.
- **El total es derivado, no enviado**: *"El valor total de la preferencia será
  la suma del valor `price` de cada ítem listado."* No hay un `total_amount` con
  el que se pueda discrepar.
- **MP documenta el descuento como una NOTA, no como un campo.** Su propio
  ejemplo de preferencia contiene literalmente
  `"additional_info": "Discount 12.00"` — texto libre. Es MP diciendo que el
  descuento es tuyo y lo calculás vos.
- `COUPON_AMOUNT` y `EFFECTIVE_COUPON_AMOUNT` existen, pero son **columnas de
  los reportes de liquidación** y describen los cupones de **campañas de MP**
  (propias o cofinanciadas). Definición textual: *"Solo se descuenta del monto
  bruto... si está provisto por el vendedor."* Corolario útil para conciliar: si
  descontamos bajando el precio de los ítems, **el descuento es invisible para
  MP** — ve una venta más chica y nada más. **La fila de `orders` es el único
  registro de que hubo descuento.**

Tres mecanismos de descuento de MP que existen y son la herramienta equivocada:

1. **`discounts.payment_methods[].new_total_amount`** — real, pero pertenece a la
   **Orders API de QR presencial**, no a Checkout Pro, y es un descuento por
   *medio de pago* (`debit_card`/`credit_card`/`account_money`/`prepaid_card`), no
   un cupón.
2. **Descuento por medio de pago del panel de MP** — porcentual, del comercio,
   mostrado en el checkout de MP. No es un código y no es por cliente.
3. **API de cupones de Wallet Connect** (`POST /v2/wallet_connect/coupons`) — es
   un endpoint de validación de cupón de verdad, pero exige un `x-payer-token`
   que se obtiene al final del flujo de vinculación de cuenta, o sea **un usuario
   de MP autenticado y vinculado**. Fuera de alcance para un Checkout Pro de
   invitado.

**Dato que sí sirve, aunque no lo usemos hoy:** MP tiene un lugar propio para el
envío, `shipments: { cost, mode: "not_specified" }`, que *"muestra el valor del
envío en tu checkout como un ítem separado del valor total"*. O sea que la
separación subtotal / envío que este producto ya tiene existe también en el modelo
de MP. Hoy el repo manda el envío como un item llamado "Envío" y funciona; migrar
a `shipments.cost` es una mejora aparte, **no de este feature**, y se anota para
que no se pierda.

**Trampa que NO nos aplica:** hay dos advertencias de que `unit_price` debe ser
entero, pero están marcadas `[mlc, mco]` (Chile y Colombia, monedas sin
decimales). En MLA los decimales son válidos y el repo ya manda decimales vía
`centsToDecimal`.

⚠️ **Hueco declarado: no se pudo confirmar si MP rechaza un `unit_price`
negativo.** Ninguna de las dos búsquedas encontró una afirmación autoritativa en
un sentido ni en el otro. §5.8.4 resuelve el diseño **sin depender de esa
respuesta**.

**Conclusión:** el cupón es 100% nuestro. MP no participa, y el descuento tiene
que quedar reflejado en la suma de lo que le mandamos.

### 3.4 Resend: los números del free tier son la cota dura del feature

Verificado contra `resend.com/pricing`,
`resend.com/docs/knowledge-base/account-quotas-and-limits`, la referencia de la
API, y el estado real de la cuenta vía el MCP de Resend.

**Estado real de la cuenta (2026-08-31):** dos dominios verificados
(`comandapp.ar`, creado 2026-08-28, y `tomasizuel.com`), región `sa-east-1`, envío
habilitado en los dos, tracking de apertura y click **apagado** en los dos. Cero
contactos, cero broadcasts, cero templates, cero supresiones. Métricas del mes:
49 enviados, 49 entregados, 0 bounces, 0 quejas.

| Límite (free) | Valor | Qué implica acá |
|---|---|---|
| Mails transaccionales | **100/día, 3.000/mes** (reset 00:00 UTC) | **La cota que define la arquitectura del envío** |
| Broadcasts | **No se miden por volumen**, solo por contactos: 1.000 | Tentador, y descartado (§5.10.1) |
| `POST /emails/batch` | **100 mails por llamada**; soporta `react`, `headers`, `tags`, idempotencia; **NO** soporta adjuntos | Un batch = todo el cupo del día |
| Batch: fallo parcial | **No existe.** La llamada es atómica: un destinatario inválido hace fallar el batch entero | Hay que validar cada dirección ANTES de encolar |
| Rate limit de API | 10 req/s por equipo | Irrelevante a esta escala |
| Idempotencia | header `Idempotency-Key`, 1–256 chars, **TTL 24h**. Misma clave + mismo payload → devuelve el id original. Misma clave + **payload distinto** → `409 invalid_idempotent_request` | Es la trampa ya documentada en `CLAUDE.md` para `courier-invite`. Acá obliga a congelar los chunks (§5.10.3) |
| Retención de logs | 30 días | El log de envío es nuestro, no de Resend |
| Reputación | Resend corta con **bounce ≥ 4%** o **quejas ≥ 0,08%** (más estricto que el 0,3% de Gmail) | §4.2 |
| IP dedicada | No existe en free ni en Pro | No es una salida |

**Tres hallazgos que cambian el diseño, no solo lo informan:**

1. **`/emails` y `/emails/batch` NO inyectan `List-Unsubscribe` ni
   `List-Unsubscribe-Post`.** Resend lo dice explícito: *"Resend does not manage
   contact lists for transactional emails"*. Los headers los ponemos nosotros y
   el endpoint de baja lo hospedamos nosotros. Los Broadcasts sí los inyectan.
   RFC 8058 nos obliga entonces a: POST al URL de baja devuelve 200/202 en blanco,
   GET renderiza una página normal, y la baja tiene efecto **en 48 horas**.
2. **La lista de supresión de Resend es de CUENTA, no de destinatario-por-uso**, y
   **aplica también a `/emails`**: una dirección suprimida se descarta **en
   silencio** (aparece como `suppressed`, no como error de API). Consecuencia
   directa y grave: **si la baja de marketing se implementara agregando el mail a
   la lista de supresión de Resend, ese cliente dejaría de recibir el comprobante
   de su pedido y el "pedido listo".** La baja de marketing tiene que vivir en
   nuestra base. Está en §5.3 como columna, y en §6.4 como riesgo.
3. **Marketing exige baja; transaccional no.** Resend lo separa explícitamente y
   lo enmarca en CAN-SPAM/CASL. Localmente aplica la Ley 25.326, que
   `/legal/privacidad` ya cita.

Además, Resend recomienda **aislar la reputación por subdominio** cuando el perfil
de engagement difiere. Hoy `comandapp.ar` manda el magic link, que `CLAUDE.md`
describe como *"la única puerta a `/admin`"*. Mandar promociones desde ese mismo
dominio pone esa puerta detrás de la reputación del tráfico promocional, y el
modo de falla es silencioso. Es la **pregunta abierta Q4** de §9.

---

## 4. Pushback

Cinco cosas del pedido que hay que mirar de frente. Ninguna es un "no": son un
"sí, pero no así".

### 4.1 "Los cupones son enviados por mail" es el requisito más débil del pedido

El pedido asume que el mail es el canal. Los números dicen otra cosa:

- El email del cliente es **opcional a propósito** (`orders.customer_email` es
  nullable, decisión de producto documentada en `CLAUDE.md`: "un campo más en el
  checkout es fricción real en mobile"). En un padrón real de hamburguesería, la
  fracción con email cargado va a ser **una minoría**. Una campaña "a todos los
  clientes" le llega a los que dejaron mail, que no son "todos".
- El free tier de Resend son **100 mails por día** para todo el proyecto, y esos
  100 son los mismos que usan el comprobante y el "pedido listo". Una campaña de
  100 destinatarios consume el cupo del día entero y **deja sin comprobante a los
  pedidos de esa noche**.
- `PRODUCT.md` dice, sobre el canal del cliente: *"La comunicación con el cliente
  después de la compra sigue pasando por WhatsApp, porque es donde el cliente ya
  está."* El mail nunca fue el canal principal de este producto.

**Lo que propongo, y no está en el pedido:**

1. El envío por mail **se construye igual**, porque es lo que se pidió y porque es
   el único canal masivo que el producto puede automatizar hoy sin depender de que
   Meta apruebe plantillas de WhatsApp.
2. Pero el envío lleva **presupuesto diario explícito**, y el dueño del producto
   lo fijó en **15 mails de campaña por día** de los 100 (§5.10.3). Los ~85
   restantes quedan **reservados para el mail transaccional**: un pedido pagado no
   puede quedarse sin comprobante porque una promo se comió la cuota. Es el
   razonamiento de `magic_link:global` en `rate-limit-policy.ts` —no es un límite
   de abuso, es un presupuesto—, pero acá el número es **más chico que lo que la
   seguridad del cupo requiere**, y a propósito: es una palanca comercial
   (§5.10.5). Con 15/día el riesgo de que una promo deje un pedido sin comprobante
   deja de existir casi por completo, y en cambio **el argumento de este §4.1 se
   vuelve más fuerte, no más débil**: una campaña a 142 clientes tarda diez días,
   así que el mail no puede ser el canal de una promoción con fecha.
3. Y el padrón expone, al lado de cada cliente, **el botón de WhatsApp que el
   dueño ya pidió**. Ése es el canal que de verdad llega. Que sea manual (uno a
   uno, `wa.me`) es una limitación conocida del producto, no de este feature.
4. **Fuera de alcance, propuesto para después:** el código del cupón también puede
   mostrarse en la vitrina (un banner en `/[store]`), que es el canal de costo
   cero y alcance total. No lo diseño acá para no inflar el scope, pero es la
   forma más barata de que un cupón sirva de algo.

### 4.2 El padrón crea un dataset de PII que el producto hoy no declara, y le manda promociones

Hoy `/legal/privacidad` dice, textual: *"Tu pedido y sus datos de contacto quedan
asociados al local que lo recibe. Ese local ve los datos de contacto de sus
propios pedidos, para poder prepararlo y entregártelo."*

Después de este feature eso es **falso por omisión**: el local va a tener un
padrón consolidado con nombre, teléfono, mail, **cuánta plata gastó cada persona**
y cuándo fue la última vez, y va a poder mandarle publicidad. `CLAUDE.md` es
explícito en que esa página *"describe el comportamiento real"* y queda
desactualizada si esto cambia.

Lo que hay que tocar, y es parte del scope, no un extra (§5.12):

- Sección nueva en `/legal/privacidad`: el padrón, qué contiene, quién lo ve, y
  cómo darse de baja.
- Sección nueva en `/legal/terminos`: un cupón es una oferta **del local**, con
  sus condiciones y su vencimiento; la plataforma no lo financia ni lo garantiza.
- **Aviso en el checkout, al lado del campo de email.** Éste es el punto de
  consentimiento y hoy no existe.

**La pregunta que no puedo decidir sola:** ¿checkbox de consentimiento, o aviso +
baja de un click? El checkbox es más defendible legalmente; el aviso es lo que hace
la categoría y no agrega fricción a un campo que ya es opcional. Mi recomendación
es aviso + baja, y está en **Q1** de §9.

### 4.3 La tab en `/admin/pedidos` es el lugar equivocado. Propongo una sección propia

El dueño lo dejó abierto explícitamente, así que acá va el argumento.

`/admin/pedidos` hoy es una superficie **operativa en vivo** que contesta dos
preguntas con horizonte de horas: "¿qué tengo programado?" y "¿qué pasó en este
rango de fechas?". Tiene un **filtro de fechas en el header de la página** que
scopea todo lo que hay abajo, y ya son dos secciones apiladas (`ScheduledOrdersTray`
+ `OrderHistoryList`), decisión tomada en el brief de esa superficie
(`.impeccable/surfaces/src-views-admin-pedidos-scheduled-tray-tsx.md`) justamente
para evitar tabs sobre tabs, porque el historial ya tiene sus propios chips de
estado.

Meter el padrón ahí rompe tres cosas:

1. **El filtro de fechas empieza a mentir.** El padrón es histórico por
   definición ("el que más gastó **históricamente**"). O el filtro no le aplica —y
   entonces un control del header afecta a la mitad de la página— o le aplica y
   deja de ser el padrón que se pidió.
2. **Son dos trabajos distintos.** `/admin/pedidos` se abre en hora pico, entre
   interrupciones, para operar. El padrón se abre un martes a la tarde para
   decidir una promo. Mezclarlos hace que la pantalla de la hora pico cargue una
   tabla que nadie va a mirar en hora pico.
3. **Cupones necesita un lugar propio igual**, y cupones y clientes se hablan
   entre sí (el segmento de la campaña se calcula sobre el padrón). Dejarlos en
   dos secciones lejanas es el peor de los dos mundos.

**Recomendación: una sección nueva en la nav, `Clientes`, con dos tabs.**

```
/admin/clientes            → tab "Padrón"   (la tabla de clientes)
/admin/clientes/cupones    → tab "Cupones"  (cupones + campañas)
```

Mismo patrón exacto que `/admin/ajustes`: un `layout.tsx` con `PageFrame` y una
sub-nav de tabs, y cada `page.tsx` resolviendo sesión de nuevo (el layout **no**
autoriza — regla dura del repo).

**Alternativa evaluada y descartada: llamar la sección "Marketing"** (que es como
la nombran Square y Toast) con tabs "Clientes" y "Cupones". Descartada por dos
razones: el dueño nombró la cosa "clientes" y es lo que el staff va a buscar en el
rail; y "Marketing" es vocabulario de plataforma en un producto cuya posición
declarada es que la plataforma no se muestra. Un dueño de hamburguesería no entra
a "Marketing", entra a "Clientes".

Costo: el rail pasa de 8 ítems a 9. A 240px de ancho eso sigue entrando sin
scroll. (Nota al margen: el comentario de `shell.tsx` dice "siete secciones" y ya
son ocho — el comentario está desactualizado desde `/admin/repartidores`.)

### 4.4 El código compartido convierte el targeting en decoración, y eso ya está aceptado

El dueño lo cerró: *"si se filtra, problema del usuario"*. No se debate. Lo que sí
corresponde es **dejar registrada la exposición máxima**, para que la decisión
quede documentada como informada y no como un descuido.

Con código compartido, los segmentos ("los mejores 10", "los que gastaron más de
$X") deciden únicamente **a quién se le manda el mail**. Cualquiera con el código
lo usa. **El único freno real son los topes.** El cálculo del peor caso está en
§5.9.3, y es el motivo por el cual §5.9 propone que **`max_redemptions` sea
obligatorio** en la creación del cupón —no nullable como "sin límite"— y que el
default del tope por cliente sea 1.

### 4.5 "Tope de usos por cliente" es un freno blando, y la UI no puede decir otra cosa

Sin identidad verificable, el tope por cliente se cuenta contra el **teléfono
normalizado que la persona tipeó en el checkout**. Eso es suplantable con dos
teclas. Se modela igual, porque frena el caso real (la misma persona usando el
cupón cuatro veces sin mala intención), pero:

- El copy del panel dice **"por teléfono"**, no "por cliente":
  *"Máximo por teléfono: 1 uso"*, con un helper: *"Se cuenta contra el teléfono
  del pedido. Alguien que ponga otro número puede volver a usarlo."*
- El tope que de verdad acota la plata es el **global** (`max_redemptions`), y por
  eso es obligatorio.

---

## 5. Arquitectura recomendada

### 5.1 Vocabulario nuevo (`src/models/types.ts`)

Todo concepto nuevo aterriza acá primero. Solo tipos, sin runtime.

```
StoreCustomer          id, storeId, phoneE164, displayName, email|null,
                       ordersCount, totalSpentCents, avgTicketCents,
                       cancelledOrdersCount, firstOrderAt, lastOrderAt,
                       daysSinceLastOrder|null, marketingOptOutAt|null,
                       notes|null
                       — avgTicketCents y daysSinceLastOrder los DERIVA la RPC,
                         no son columnas (§5.5)

CustomerDirectory      { customers: StoreCustomer[], totals: {...} }

CouponDiscountType     'percentage' | 'fixed'
CouponStatus           'draft' | 'active' | 'paused'          -- persistido
CouponState            CouponStatus | 'scheduled' | 'expired' | 'exhausted'
                       — DERIVADO en TS, nunca persistido (§5.7.2)

Coupon                 id, storeId, name, code, discountType,
                       percent|null, amountOffCents|null, maxDiscountCents|null,
                       minSubtotalCents, startsAt|null, endsAt|null,
                       maxRedemptions, maxRedemptionsPerPhone|null,
                       redemptionsCount, paymentMethods|null, status,
                       createdAt, updatedAt

CouponAppliedQuote     { status: 'applied', code, label, discountCents }
                     | { status: 'rejected', code, reason }
                       — lo que devuelve la cotización (§5.9.1)

CampaignSegment        { kind: 'all' }
                     | { kind: 'top_n', topN: number }
                     | { kind: 'min_spent', minSpentCents: number }

CampaignPreview        { inSegment, withEmail, optedOut, willSend,
                         daysNeeded, lastSendDate, couponEndsAt|null,
                         fitsBeforeExpiry }
                       — las cuatro últimas existen por el cupo de 15/día
                         (§5.10.3.1)

CouponCampaign         id, storeId, couponId, couponCode, segment, subject,
                       message, status, recipientsTotal, sentCount,
                       failedCount, skippedCount, createdAt, startedAt|null,
                       finishedAt|null

CampaignStatus         'queued' | 'sending' | 'sent' | 'stopped' | 'failed'
                       — `stopped` = la OFERTA dejó de valer (cupón vencido,
                         agotado o pausado). Distinto de `failed`, que es que
                         falló lo NUESTRO y conviene reintentar (§5.10.3.1)

CouponChangeKind       'create' | 'activate' | 'escalate' | 'reduce'
                       — las dos del medio piden código de 6 dígitos (§5.11.3)

CouponRedemptionRow    { orderId, shortCode, customerName, discountCents,
                         orderTotalCents, createdAt }
                       — una fila de la lista de canjes del cupón (§5.14.4)

CouponStats            { redemptions, discountedCents, revenueCents }
                       — los tres agregados de §5.14.5

CouponDetail           Coupon & { stats: CouponStats,
                                  recentRedemptions: CouponRedemptionRow[],
                                  totalRedemptions: number }
```

Y tres tipos existentes cambian de forma (§5.14.3 — todos enumeran a mano, así que
TypeScript va a señalar qué tocar):

- **`Order`** suma `discountCents: number` y `couponCodeSnapshot: string | null`.
- **`OrderPublicView`** (que es un `Pick<Order, ...>`) suma esas dos claves al
  `Pick`. Sin eso el cliente no ve su propio descuento.
- **`PricedCart` / `PriceQuote`** suman el término del descuento y el resultado
  del cupón (§5.9.1).
- **`EmailVars`** (`email.port.ts`) suma `discountCents` y `couponCode`, para que
  el comprobante cierre.

### 5.2 La identidad del cliente: el teléfono normalizado, scopeado a la tienda

**Clave: `(store_id, customer_phone_e164)`.**

Por qué el teléfono y no el email:

- `customer_phone_e164` es **`not null`** en `orders`; `customer_email` es
  nullable a propósito. Una clave que puede faltar no es una clave.
- Ya viene **normalizado y canónico**: `phoneSchema` (`order.schema.ts:136`)
  devuelve siempre `+549` + 10 dígitos, y respeta la trampa del `15` de Córdoba
  (solo lo saca cuando sobran dígitos, con el regex `^(\d{2,4})15(\d{6,8})$` y
  solo si el resultado queda en 10). O sea: **no hay que normalizar nada nuevo, ni
  en Postgres ni en TS.** Es el hallazgo que hace este diseño barato.
- Es el canal que el producto realmente usa (WhatsApp).

Por qué scopeado a la tienda: **el aislamiento multi-tienda no se negocia.** Un
padrón global diría que una persona compró en el competidor, y `store_id` es parte
de la identidad de todo dato de este producto.

**Los tres conflictos, resueltos explícitamente:**

| Caso | Decisión | Por qué |
|---|---|---|
| Mismo teléfono, dos nombres | `display_name` = el nombre del **pedido facturable más reciente**. Last-write-wins | La gente corrige sus propios typos. El nombre más nuevo es la mejor apuesta, y guardar los dos obliga a que alguien elija |
| Mismo teléfono, dos mails | `email` = el **último mail no nulo** visto. Un pedido posterior sin mail **no borra** el que había | Perder un contacto porque alguien salteó un campo opcional es una regresión |
| Dos teléfonos, un mail | **Dos filas.** El teléfono es la clave, el mail es un atributo | Deduplicar por mail fusionaría una familia que comparte casilla en un solo cliente, y rompería el tope de usos por teléfono. El costo aceptado: el mismo `mailto:` puede aparecer dos veces en la tabla |
| Un teléfono, cero pedidos facturables | La fila **existe** con `orders_count = 0` | Un cliente que hizo un pedido y lo canceló es un cliente. Aparece al final de la tabla, que está ordenada por plata |

### 5.3 `store_customers`: tabla materializada, escrita por un trigger

**Decisión: tabla, no vista ni RPC de agregación.**

**Opción A — vista / RPC que agrega `orders` al vuelo.** Cero drift, cero
backfill, cero trigger.
- **Descartada por una sola razón que alcanza sola: no tiene dónde guardar
  estado que no se deriva de los pedidos.** La baja de marketing
  (`marketing_opt_out_at`), el token de baja (`unsubscribe_token`) y la nota del
  local (`notes`) no son función de `orders`. Sin ellos el feature no cumple con
  §4.2, o sea que no se puede lanzar.
- Argumento secundario: el orden es por plata gastada, que un agregado no puede
  indexar. Con 20.000 pedidos y una tabla ordenada por un agregado calculado, cada
  apertura del padrón es un scan del historial del local. (El corte silencioso de
  `max_rows` **no** es un argumento contra A, porque una RPC que devuelve `jsonb`
  ya lo esquiva — igual que `store_dashboard`.)

**Opción B — tabla escrita desde `create_order`.**
- Descartada. `create_order` es la función que `CLAUDE.md` señala como la trampa
  de las columnas enumeradas a mano: agregar lógica ahí es agregar un segundo
  lugar donde olvidarse. Y peor: **el agregado también tiene que cambiar cuando
  el pago se aprueba, cuando el pedido se cancela y cuando se reembolsa**, y
  ninguno de esos caminos pasa por `create_order`. Serían cuatro call sites.

**Opción C — vista materializada + `REFRESH` por cron.**
- Descartada. Necesita índice único para `CONCURRENTLY`, tampoco guarda estado, y
  la staleness entre ticks es un bug real: mandarle una promo a alguien que se dio
  de baja hace tres minutos es exactamente lo que la baja tiene que impedir.

**Recomendada: Opción D — tabla + trigger en Postgres.**

```
private.sync_store_customer()
  AFTER INSERT OR UPDATE OF (payment_status, status, customer_name,
                             customer_email, refunded_at)
  ON public.orders  FOR EACH ROW
```

Y **recalcula el agregado completo** para ese `(store_id, phone)` leyendo
`orders`, en vez de deducirlo de `new`/`old`. Es el mismo criterio —y el mismo
comentario— que `private.sync_store_transfer_payment` ya usa: *"se recalcula desde
la tabla en vez de deducirlo de new/old: un `exists` no puede quedar
desincronizado por un camino que no previmos, y una deducción sí."* Acá vale más
todavía, porque los caminos que mueven un pedido son muchos (webhook de MP,
`markPaidInStore`, `markPaidByTransfer`, el KDS, `courier_advance_order`, el cron
de conciliación, el de expiración).

Costo del recálculo: los pedidos de **un teléfono** en **una tienda** son un
puñado de filas, y hay índice para eso (§5.3.2). No es un agregado de la tienda
entera.

Por qué en Postgres y no en TypeScript: **"el padrón es una función de los
pedidos" es una invariante del dominio, no un permiso.** Un trigger cubre a
`service_role` también, que es donde vive toda la escritura de pedidos.

#### 5.3.1 Columnas

```sql
create table public.store_customers (
  id                    bigint generated always as identity primary key,
  store_id              bigint not null references public.stores(id) on delete cascade,
  phone_e164            text   not null,

  display_name          text   not null,
  email                 text,

  -- Agregados. Los mantiene private.sync_store_customer().
  orders_count          int    not null default 0 check (orders_count >= 0),
  total_spent_cents     bigint not null default 0 check (total_spent_cents >= 0),
  cancelled_orders_count int   not null default 0 check (cancelled_orders_count >= 0),
  first_order_at        timestamptz,
  last_order_at         timestamptz,

  -- Estado que NO se deriva de orders. Es la razón de que esto sea una tabla.
  marketing_opt_out_at  timestamptz,
  unsubscribe_token     text   not null unique default private.random_token(24),
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (store_id, phone_e164)
);
```

- **PK `bigint identity` + `unique (store_id, phone_e164)`**, no PK compuesta:
  convención del repo, y `campaign_recipients` necesita una FK a esto.
- `unsubscribe_token` con `private.random_token(24)`: mismo CSPRNG y mismo
  rejection sampling que `public_token`. Es lo único que autoriza `/baja/[token]`
  (§5.12.2), así que no puede salir de `random()`.
- **`avg_ticket_cents` NO es columna.** Es `total_spent / orders_count`: una
  división de dos columnas que ya están ahí. Guardarla es invitar al drift a
  cambio de nada. La deriva la RPC.
- **`preferred_delivery_method` NO entra.** Evaluada y descartada: no cambia
  ninguna decisión que el dueño tome. Es ruido con nombre de métrica.
- **Producto/categoría más pedida NO entra en v1.** Descartada para la tabla:
  obliga al trigger a hacer un join con `order_items` en cada movimiento de
  pedido, y no habilita ninguna acción que el padrón permita hoy. Candidata al
  detalle por cliente en una entrega posterior.

#### 5.3.2 Índices

```sql
create index store_customers_store_id_idx        on public.store_customers (store_id);
create index store_customers_store_spent_idx     on public.store_customers (store_id, total_spent_cents desc);
create index store_customers_store_email_idx     on public.store_customers (store_id, email)
  where email is not null and marketing_opt_out_at is null;

-- En orders: lo que el trigger necesita para recalcular sin scanear.
create index orders_store_customer_phone_idx     on public.orders (store_id, customer_phone_e164);
```

- El segundo es el orden de la tabla (el requisito literal del dueño).
- El tercero es **parcial** por los dos predicados del segmento de campaña
  ("tiene mail" y "no se dio de baja"), que es la única consulta que lo usa:
  índice chico, y es la doctrina de `orders_active_idx`.
- `unsubscribe_token` ya tiene índice por el `unique`.
- El de `orders` es el único índice nuevo sobre una tabla grande. Es `btree`
  compuesto, se crea en una tabla que hoy tiene una fila en producción, y no hace
  falta `CONCURRENTLY`.

#### 5.3.3 Backfill

Al final de la migración, un `insert ... select` que arma el padrón desde todos
los pedidos existentes, con `on conflict (store_id, phone_e164) do update`. Hoy
son 1 fila en el proyecto hosted y unas pocas en el seed local, así que es
instantáneo — pero se escribe idempotente igual, porque es lo que permite volver a
correrlo si un bug del trigger deja el padrón torcido.

### 5.4 "Plata gastada": el predicado exacto

El repo ya tiene el predicado canónico, y se reusa:

```sql
private.order_is_billable(payment_status, payment_method, status)
  = payment_status = 'approved'
 or (payment_method = 'in_store' and status not in ('pending','cancelled'))
```

**Pero para el padrón no alcanza, y hay que decir por qué.** Tiene dos huecos que
en el dashboard son un error de redondeo y acá cambian quién aparece primero en
la tabla:

1. **Un pedido `in_store` reembolsado sigue dando `true`**, porque la segunda
   cláusula no mira `payment_status`. Un cliente al que se le devolvió todo
   figuraría como el que más gastó.
2. **Un pedido online pagado y después cancelado por la cocina sigue dando
   `true`**, porque `payment_status` queda en `'approved'` hasta que alguien
   reembolsa (el pedido entra a la cola de `needs_refund_at`). No es plata que el
   local se quedó por comida que entregó.

**Predicado del padrón:**

```sql
private.order_is_billable(o.payment_status, o.payment_method, o.status)
  and o.status         <> 'cancelled'
  and o.payment_status <> 'refunded'
  and o.refunded_at is null
```

En palabras: **plata que el local efectivamente se quedó, por un pedido que
efectivamente entregó o va a entregar.**

- `total_cents`, no `subtotal_cents`: lo que el cliente pagó incluye el envío. Es
  el mismo criterio que `store_dashboard` y `platform_stores`.
- Todo en centavos enteros (`bigint`). `total_spent_cents` es un `sum()` de
  `bigint`.
- Los programados cuentan desde que son facturables, igual que en el dashboard.
- `cancelled_orders_count` cuenta `status = 'cancelled'` sin más condiciones: es
  una señal operativa (el que reserva y no aparece), no plata.

**Lo que NO hago, y es deliberado: no toco `private.order_is_billable`.** Corregir
esos dos huecos ahí cambiaría, en el mismo deploy, la facturación que muestran
`store_dashboard`, `platform_metrics` y `platform_stores` — que son los números
con los que la plataforma mira a sus locales. Es un cambio legítimo pero es **otro
cambio**, con su propio riesgo y su propia conversación. Queda como **Q6** en §9.

### 5.5 Qué se muestra en la tabla, y qué es ruido

La tabla es Operate: densidad, y que se pueda retomar el hilo. Seis columnas,
ordenada por plata desc, y nada más:

| Columna | Dato | Por qué está |
|---|---|---|
| **Cliente** | `displayName` + `phoneE164` en segunda línea, chico | Es cómo lo identifica el local |
| **Gastado** | `totalSpentCents` (`Price`, `.tabular`) | **La columna que el dueño pidió**, y el orden de la tabla |
| **Pedidos** | `ordersCount` (`.tabular`) | El contexto de la anterior: $50.000 en 2 pedidos no es lo mismo que en 20 |
| **Ticket prom.** | `avgTicketCents` (`Price`, `.tabular`) | Derivado. Es lo que decide si al cliente le conviene un % o un monto fijo |
| **Última compra** | "hace 3 días" + fecha en `.tabular` | La única señal de churn, y el disparador natural de una campaña de reactivación |
| **Contacto** | Botón WhatsApp + `mailto:` (icon buttons, 44px) | El pedido literal del dueño |

Lo que **no** es columna, y dónde vive:

- `cancelledOrdersCount`: solo aparece —como `StatusPill` de aviso en la fila— si
  es `>= 2`. Un cancelado es ruido; tres es un patrón.
- `marketingOptOutAt`: un `StatusPill` "Sin promos" en la celda de contacto, que
  además desactiva el `mailto:`. El dueño tiene que **ver** la baja, no
  descubrirla cuando el mail no sale.
- `notes`: no es columna. Se edita en una hoja (`vaul`, ya está en el stack) al
  tocar la fila.
- `firstOrderAt`: en la hoja de detalle. No cabe en la tabla y no dispara nada.

Encima de la tabla, **tres números en una línea de texto, no tarjetas**: "142
clientes · 38 con email · 9 sin comprar hace más de 30 días". Nada de plantilla de
métrica-héroe (prohibida por el piso de calidad) y nada de grilla de tarjetas.

Búsqueda por nombre o teléfono con `SearchField` (ya existe en `surfaces.tsx`),
del lado del cliente sobre las filas ya cargadas: el padrón de un local entra en
una sola lectura.

#### 5.5.1 El botón de WhatsApp lleva mensaje precargado, y ES la reactivación

Decisión del dueño del producto (2026-08-31), textual: *"Reactivarlos es un mensaje
de whatsapp, mas personal. Boton para ir a watsapp con el mensaje pre cargado"*.
Por eso **no** hay un cuarto segmento de campaña (§8): la reactivación no es un
envío masivo.

**El helper ya existe y se usa tal cual:** `whatsappHref(phoneE164, text?)` en
`src/lib/whatsapp.ts:17` — acepta el texto y normaliza el E.164 a dígitos.
**No se arma la URL a mano.** (`store-dock.tsx` la arma a mano; su propio
comentario dice que es deuda y candidato a adoptar el helper. Es deuda, no
ejemplo.)

**Tres mensajes, elegidos por lo que la fila ya sabe.** No es un editor de
plantillas: son tres textos y el contexto decide cuál se precarga.

| Cuándo | Mensaje precargado |
|---|---|
| `daysSinceLastOrder >= 30` | *"¡Hola {nombre}! Somos de {local}. Hace un rato que no te vemos por acá — si te dan ganas, la carta está en {link}"* |
| Hay un cupón `active` y el dueño elige "Mandar cupón" | *"¡Hola {nombre}! Somos de {local}. Te dejamos un código para tu próximo pedido: **{CODIGO}** ({descuento}). {link}"* |
| Default | *"¡Hola {nombre}! Somos de {local}."* |

`{nombre}` es **solo el primer token** de `displayName` (la gente escribe "Juan
Pérez" y nadie saluda por apellido). `{descuento}` sale de `describeDiscount()`,
la misma función que arma la etiqueta en el panel y en el mail. `{link}` es
`storeUrl(slug)`.

**Cuando hay un cupón activo, se puede mandar ESE cupón desde acá**: el botón abre
un menú con los cupones `active` del local, y el elegido entra en el texto. Es el
único camino por el que un cupón llega a un cliente sin gastar cupo de mail — y a
15 mails por día (§5.10.3), es el que más va a usarse.

**Cuatro reglas del copy, y las cuatro son duras:**

1. **Nunca la plata del cliente.** *"Gastaste $84.000 con nosotros"* es invasivo y
   no se escribe, aunque el dato esté en la fila.
2. **Nunca un hecho que no tenemos.** *"Sabemos que te gustan las dobles"* — el
   producto no registra eso en v1. `PRODUCT.md` prohíbe insinuar datos que no
   existen.
3. **Suena a persona, no a sistema.** Sin "Estimado cliente", sin "usted", sin
   mayúsculas de asunto. Español rioplatense.
4. **Arranca editable, y eso es una propiedad, no un accidente.** El prefill de
   `wa.me` cae en el campo de texto de WhatsApp: el dueño lo lee, lo retoca y
   recién ahí manda. Es lo que hace que un texto genérico sea aceptable — no es lo
   que se envía, es el punto de partida.

**Lo que se pierde, y se acepta: un WhatsApp no deja registro.** No hay
`campaign_recipients` para algo que se abre en otra app: el producto no puede saber
si el dueño mandó el mensaje, ni cuándo, ni qué terminó escribiendo. **Consecuencia
concreta: el dueño puede escribirle dos veces al mismo cliente y el padrón no se lo
va a decir.**

Se descartó la alternativa —un "¿lo mandaste?" al volver, o un registro optimista
al hacer click— por el mismo criterio que ya se aplicó en otras partes de este
documento: **un registro que depende de que el dueño vuelva y confirme es un
registro que miente**, y un registro que miente sobre a quién le hablaste es peor
que no tener registro. La baja (`marketing_opt_out_at`) igual se respeta: el botón
de WhatsApp **también** se atenúa en una fila dada de baja, porque la baja es del
cliente y no del canal.

### 5.6 `/admin/clientes` y `/admin/clientes/cupones`: las superficies

Modo **Operate** en las dos. Briefs a escribir en `.impeccable/surfaces/`.

```
src/app/admin/(app)/clientes/layout.tsx      PageFrame "Clientes" + tabs. NO autoriza.
src/app/admin/(app)/clientes/page.tsx        Padrón.   resolveAdminSession + role==='owner'
src/app/admin/(app)/clientes/cupones/page.tsx Cupones. idem
```

Nav (`src/views/admin/shell.tsx`): un ítem nuevo, **`ownerOnly: true`**, entre
"Métricas" y "Apariencia" (el orden del rail va de lo operativo a lo de gestión):

```
{ href: '/admin/clientes', label: 'Clientes', icon: Users, ownerOnly: true }
```

`Users` de `lucide-react`. Nada de emoji ni glifos unicode.

**Padrón** (`/admin/clientes`): la línea de tres números, `SearchField`, y la tabla
de §5.5 con `width="table"` en `PageFrame` (mismo criterio que
`/admin/pedidos`). Estados: sin clientes todavía (`EmptyState` que enseña —
*"Acá van a aparecer los clientes cuando entren los primeros pedidos"*), sin
resultados de búsqueda, y la tabla con contenido. En mobile la tabla colapsa a
filas apiladas: nombre + gastado arriba, el resto abajo.

**Cupones** (`/admin/clientes/cupones`): dos secciones apiladas con
`PanelHeading`, no tabs anidadas (misma decisión y mismo motivo que el brief de la
bandeja de programados):

1. **Cupones** — lista con código, nombre, el descuento en palabras
   ("15% hasta $3.000"), `StatusPill` con el `CouponState` derivado, usos
   ("7 / 50"), vigencia. Acciones por fila: pausar/activar, duplicar, y
   **"Mandar por mail"**, que es lo que abre la campaña. Botón primario:
   "Crear cupón".
2. **Campañas** — el log: cupón, segmento en palabras ("Los mejores 10"), cuándo,
   y el resultado ("17 enviados · 1 falló"). Solo lectura.

El formulario de cupón es **una hoja (`vaul`), no un modal**: el piso de calidad
dice "modal como primera idea es pereza", pero acá hay foco protegido real (un
formulario con siete campos donde cada uno es plata) y la hoja desde abajo es el
patrón que el producto ya usa. Los campos, en este orden: nombre interno, código
(con un botón **"Generar"** al lado, que es el default recomendado — §5.7.1),
tipo de descuento (`RadioGroup`), valor, tope de descuento (solo si es %),
mínimo de subtotal, vigencia (desde/hasta), tope de usos total, tope por
teléfono, y métodos de pago (§5.9.4). Arriba del botón de guardar, **el peor caso
en pesos**, calculado en vivo (§5.9.3).

La hoja de detalle de un cupón ya creado muestra además los tres agregados y los
últimos canjes (§5.14.4), que es la mitad del valor de haberlo creado.

**El flujo del cupón tiene dos tiempos, y no es un detalle de UI: es lo que hace
tolerable el código de 6 dígitos** (§5.11.3).

```
"Guardar borrador"  →  el cupón existe, status = draft, NO expone nada,
                       se edita todas las veces que haga falta, gratis
"Activar"           →  pide el código por mail  →  status = active
```

Al pie de la hoja, un aviso que se actualiza mientras el dueño tipea:
*"Este cambio se aplica al instante"* o *"Este cambio pide un código por mail"*,
según `requiresConfirmation()`. **Nadie descubre el segundo factor después de
apretar guardar.** Y "Pausar" nunca lo pide: está siempre a un click.

El flujo de campaña es un **paso de confirmación con la cuenta a la vista**, no un
botón que manda: elegir segmento → el servidor devuelve `CampaignPreview` → se
muestra la cuenta completa → recién ahí "Mandar". Un envío que no se puede deshacer
no se dispara con un click.

Con el cupo de 15/día (§5.10.3) esa cuenta tiene que incluir **el tiempo**, porque
es la variable que sorprende:

```
142 clientes en el segmento
 17 con email          3 se dieron de baja
────────────────────────────────────────────
Se manda a 17 · 2 días · último mail el 02/09
El cupón vence el 05/09  ✓ entra
```

Cuando no entra, el bloqueo de §5.10.3.1 y la oferta comercial de §5.10.6
aparecen **acá**, en el mismo lugar donde el dueño acaba de leer el número de
días. Es el único momento en que esa oferta no es mueble.

### 5.7 Cupones: modelo de datos

#### 5.7.1 `coupons`

```sql
create table public.coupons (
  id                    bigint generated always as identity primary key,
  store_id              bigint not null references public.stores(id) on delete cascade,

  name                  text   not null,          -- etiqueta interna del dueño
  code                  text   not null,          -- CHECK: ^[A-Z0-9]{4,16}$

  discount_type         text   not null check (discount_type in ('percentage','fixed')),
  percent               int,                      -- 1..100, solo si percentage
  amount_off_cents      bigint,                   -- > 0, solo si fixed
  max_discount_cents    bigint,                   -- tope del %, null = sin tope

  min_subtotal_cents    bigint not null default 0 check (min_subtotal_cents >= 0),

  starts_at             timestamptz,
  ends_at               timestamptz,

  max_redemptions       int    not null check (max_redemptions > 0),
  max_redemptions_per_phone int default 1 check (max_redemptions_per_phone is null
                                                 or max_redemptions_per_phone > 0),
  -- DOS contadores, no uno (§5.9.2: el uso se RESERVA, no se cuenta).
  -- Los mantiene private.sync_coupon_counters() recalculando desde el libro
  -- mayor; nadie los escribe a mano.
  reserved_count        int    not null default 0 check (reserved_count >= 0),
  redeemed_count        int    not null default 0 check (redeemed_count >= 0),

  payment_methods       text[],                   -- null = todos

  status                text   not null default 'draft'
                          check (status in ('draft','active','paused')),

  created_by            uuid   references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (store_id, code),
  unique (store_id, id)                           -- para la FK compuesta de §5.7.2
);
```

Los CHECK que hacen el trabajo:

```sql
-- El tipo y el valor no pueden contradecirse.
coupons_shape_check:
  (discount_type = 'percentage'
     and percent between 1 and 100
     and amount_off_cents is null)
  or (discount_type = 'fixed'
     and amount_off_cents > 0
     and percent is null
     and max_discount_cents is null)   -- un tope sobre un monto fijo no significa nada

-- LA defensa contra la carrera del último uso. Ni service_role la esquiva.
-- Sobre la SUMA, porque una reserva ocupa cupo igual que un canje (§5.9.2).
coupons_within_cap_check:
  reserved_count + redeemed_count <= max_redemptions

-- El multi-select no puede quedar vacío ni traer basura.
coupons_payment_methods_check:
  payment_methods is null
  or (array_length(payment_methods, 1) between 1 and 3
      and payment_methods <@ array['online','in_store','transfer']::text[])

coupons_window_check:
  ends_at is null or starts_at is null or ends_at > starts_at

coupons_code_check:
  code ~ '^[A-Z0-9]{4,16}$'
```

Decisiones dentro de esa forma, con su razón:

- **`percent int` (1..100), no basis points ni `numeric`.** Una hamburguesería no
  necesita 12,5%. Un `numeric` invita a que llegue un float a TypeScript; un `int`
  deja toda la aritmética en enteros. Menos unidades que explicar.
- **`max_redemptions` es `not null`.** Consecuencia directa de §4.4: con código
  compartido, el tope global es la única cota de plata. Un cupón sin tope es un
  cheque en blanco esperando que alguien lo publique en Twitter. Si el dueño
  quiere "muchos", pone 1.000.
- **`max_redemptions_per_phone` nullable, default 1.** `null` = sin tope por
  teléfono. Se llama `_per_phone` y no `_per_customer` a propósito (§4.5): el
  nombre de la columna tiene que decir la verdad sobre lo que cuenta.
- **`status` es `draft | active | paused`, y nada más.** `expired` y `exhausted`
  **no se persisten**: se derivan de `ends_at` y de los dos contadores. Un estado
  guardado que un cron tiene que dar vuelta es un estado que miente entre ticks —
  misma doctrina que `canTakeOrders()` y `couponState()` en TS.
- **No hay `applies_to`.** El descuento aplica **siempre y solo al subtotal, nunca
  al envío.** Descartado a propósito: el envío es lo que el local le paga al
  repartidor, descontarlo significa que el local pone plata de su bolsillo por el
  viaje. Confirmado por el dueño del producto (2026-08-31).

  **Pero hay que ser honestos con lo que NO reemplaza.**
  `stores.delivery_free_from_cents` es un **ajuste permanente de la tienda**: "el
  envío es gratis a partir de $X, siempre". No expresa *"envío gratis este finde
  con el código FINDE"*, que es una promoción con código, con fecha y con tope —
  o sea otra cosa. **Ese eje falta**, y el día que se pida no es una columna más
  en `coupons`: es un **cuarto término en la ecuación del dinero**
  (`total = subtotal − discount − delivery_discount + delivery_fee`), con su
  propio CHECK, su propio clamp contra `delivery_fee_cents`, y una decisión nueva
  sobre qué pasa cuando el cupón cubre el envío de un pedido de retiro (que no
  tiene envío). Se anota acá para que no se subestime.
- **No hay BXGY ("llevá 2 pagá 1")** ni cupones por producto/categoría. Fuera de
  alcance explícito: obliga a que el cupón conozca el catálogo y que el descuento
  se calcule por línea, y no es lo que se pidió.
- **El código lo elige el dueño, pero el default es generado.** `^[A-Z0-9]{4,16}$`
  permite un código corto y **hablable en el mostrador**, que es un requisito real
  de esta vertical: el dueño lo canta por teléfono. Pero un código elegido a mano
  tiende al patrón enumerable (`PROMO10`, `PROMO15`…), que la investigación
  documenta como el vector de "coupon glittering" (§3.2). Por eso la hoja ofrece
  un botón **"Generar"**: 8 caracteres de un alfabeto sin confundibles (los dos
  proveedores especializados consultados excluyen por defecto `1IO02ZS6G`), con
  **CSPRNG y rejection sampling** — el mismo camino que `private.random_token`,
  nunca `Math.random()`. Vale la advertencia que `CLAUDE.md` ya hace para
  `public_token`: **con un alfabeto acotado, el tamaño del espacio NO es la
  entropía** si el generador no es criptográfico.
- El código se normaliza a mayúsculas en el schema, así que la comparación es
  exacta y el efecto es el mismo que la insensibilidad a mayúsculas que Square
  documenta — con una regla en vez de dos.

#### 5.7.2 `coupon_redemptions` — el libro mayor, con tres estados

**El uso no se cuenta: se RESERVA.** Decisión del dueño del producto
(2026-08-31), textual: *"Se bloquea al crear el pedido, se descuenta
temporalmente, si el pedido no se completa se libera"*. Reemplaza lo que la
primera versión de este documento proponía (una redención permanente que no se
liberaba nunca), y es un modelo más fino que ése y que la alternativa de "liberar
si nunca se cobró".

```sql
create table public.coupon_redemptions (
  id                  bigint generated always as identity primary key,
  store_id            bigint not null,
  coupon_id           bigint not null,
  order_id            bigint not null references public.orders(id) on delete cascade,
  customer_phone_e164 text   not null,
  discount_cents      bigint not null check (discount_cents >= 0),

  -- Los tres momentos. Nace 'reserved' SIEMPRE: nadie inserta un 'redeemed'.
  status              text   not null default 'reserved'
                        check (status in ('reserved', 'redeemed', 'released')),
  released_reason     text   check (released_reason is null
                                    or released_reason in ('expired', 'cancelled_unpaid')),

  created_at          timestamptz not null default now(),
  redeemed_at         timestamptz,
  released_at         timestamptz,

  unique (order_id),

  constraint coupon_redemptions_coupon_same_store_fkey
    foreign key (store_id, coupon_id)
    references public.coupons (store_id, id) on delete restrict
);

create index coupon_redemptions_coupon_idx       on public.coupon_redemptions (coupon_id);
create index coupon_redemptions_order_idx        on public.coupon_redemptions (order_id);
create index coupon_redemptions_store_idx        on public.coupon_redemptions (store_id);
-- Parcial: el tope por teléfono cuenta SOLO lo que ocupa cupo. Una reserva
-- liberada no consumió la cuota de esa persona.
create index coupon_redemptions_coupon_phone_idx on public.coupon_redemptions (coupon_id, customer_phone_e164)
  where status in ('reserved', 'redeemed');
-- Los que ocupan cupo, para el recálculo del contador.
create index coupon_redemptions_live_idx on public.coupon_redemptions (coupon_id, status)
  where status in ('reserved', 'redeemed');
```

**Una reserva liberada NO se borra: se marca.** `status = 'released'` con su
`released_reason` y su `released_at`. El libro mayor tiene que poder contestar
*"acá hubo una reserva que no se concretó"*, porque es la única forma de
explicarle al dueño por qué el cupón dice 12 canjes y él contó 15 pedidos.

Y `unique (order_id)` se mantiene: la fila es una por pedido y lo que se mueve es
su `status`. Un pedido cuya reserva se liberó **no puede volver a reservar** — el
pedido ya está muerto (expirado o cancelado), así que es correcto.

Las decisiones que son invariantes, no detalles:

1. **`unique (order_id)` = "un cupón por pedido".** La regla de no acumulación
   vive en un índice único, no en un `if`. No hay stacking porque la base no lo
   permite. Y es la segunda red contra un doble consumo del mismo pedido: si el
   bloque del cupón corriera dos veces, el segundo insert rebota con `23505`.
2. **FK compuesta `(store_id, coupon_id)`.** Es el patrón
   `products_category_same_store_fkey`: **un cupón de otra tienda no entra ni por
   PostgREST.** (La migración de delivery descartó una FK compuesta *sobre
   `orders`* porque volvía ambiguo el embed `stores ( * )` del que dependen el
   seguimiento público y el webhook de MP. Acá la FK está en una tabla nueva sin
   embeds, así que ese riesgo no aplica.)
3. **`on delete restrict` hacia `coupons`.** Un cupón con canjes o reservas no se
   puede borrar: borrarlo destruye el rastro contable de un descuento que la plata
   real ya refleja. Los cupones se **pausan**, nunca se borran — misma doctrina que
   "un repartidor se desactiva, nunca se borra".
4. **`customer_phone_e164` denormalizado, no `customer_id`.** Dos razones: el tope
   por teléfono se cuenta acá adentro de la transacción de `create_order`, y en ese
   momento **la fila de `store_customers` todavía no existe** (su trigger corre
   AFTER INSERT de `orders`). Contra el teléfono se cuenta sin depender del orden
   de los triggers. Y `store_customers` puede borrarse en un pedido de baja de
   datos sin perder el libro mayor.

#### 5.7.2.1 Los dos contadores, y el CHECK que sobrevive a las liberaciones

**Ésta es la parte delicada del cambio.** Un contador que solo cuenta
confirmaciones deja pasar el tope mientras hay pedidos en vuelo: cien pedidos
simultáneos con un cupón de cincuenta usos entran **todos**, porque ninguno está
confirmado todavía. **La reserva es lo que ocupa el cupo.**

Se descartaron dos formas antes de la elegida:

- **Un solo `redemptions_count` = reservados + confirmados.** El CHECK funciona,
  pero el panel pierde la capacidad de distinguir "12 canjes" de "12 pedidos en
  vuelo", que es justamente lo que el dueño necesita ver (§5.7.2.3).
- **Sin contadores, contando filas del libro mayor dentro de la RPC.** Descartada
  por una razón dura: **un CHECK no puede referenciar otra tabla**, así que el tope
  dejaría de ser una invariante de base y volvería a depender de que el código de
  la RPC sea correcto. Eso es exactamente lo que §5.9.2 existe para no hacer.

**Elegido: dos contadores en `coupons`, y el CHECK sobre la suma.**

```
reserved_count + redeemed_count <= max_redemptions
```

| Momento | `reserved_count` | `redeemed_count` |
|---|---|---|
| Reservar | +1 | — |
| Confirmar | −1 | +1 |
| Liberar | −1 | — |

**Los contadores NO se escriben a mano en ningún lado.** Los mantiene un trigger
que **recalcula desde el libro mayor**:

```
private.sync_coupon_counters()
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.coupon_redemptions
  FOR EACH ROW
```

`reserved_count = count(*) where status='reserved'`,
`redeemed_count = count(*) where status='redeemed'`, para ese cupón.

Es el mismo criterio —y el mismo comentario— que `sync_store_transfer_payment` y
`sync_store_customer` ya usan: *recalcular desde la tabla, nunca deducir de
`new`/`old`*. Acá compra tres cosas: el libro mayor es la única fuente de verdad,
los contadores **no pueden driftear por construcción**, y cualquier camino futuro
que toque el libro mayor mantiene los contadores solo.

**La garantía, escrita con precisión, porque es lo que hay que poder afirmar:**

> En todo momento, `reserved_count + redeemed_count <= max_redemptions`. Como
> `redeemed_count` es **monótono creciente** (una confirmación nunca se deshace),
> el cupón **nunca puede producir más de `max_redemptions` canjes concretados**, y
> nunca puede tener más de `max_redemptions` reservas vivas. Liberar baja
> `reserved_count` y libera cupo, pero **no puede bajar `redeemed_count`**, así que
> la garantía de plata no depende de las liberaciones.

#### 5.7.2.2 El candado, y el off-by-one que se lleva puesto a quien no lo lea

El CHECK solo no alcanza, y ya está explicado en §5.9.2: sin un lock, dos
transacciones concurrentes no ven la fila no-commiteada de la otra, cada trigger
recalcula 49, las dos pasan, y una de las dos revienta con un `23514` crudo
después de haber hecho todo el trabajo.

Por eso el **BEFORE INSERT** toma el lock él mismo:

```
private.enforce_coupon_redemption()
  BEFORE INSERT ON public.coupon_redemptions  FOR EACH ROW
  · perform 1 from public.coupons where id = new.coupon_id for update;
  · valida: status='active' · ventana · reserved_count + redeemed_count < max_redemptions
```

Que el lock viva **en el trigger** y no solo en `create_order` es deliberado:
así **todo** camino de inserción se serializa sobre la fila del cupón, y la
garantía deja de depender de que el llamador se acuerde. `create_order` toma el
mismo lock antes, y eso no es redundante: es lo que convierte al perdedor de la
carrera en un `DomainError` legible ("Ese cupón ya se agotó") en vez de un error
de constraint.

⚠️ **El off-by-one.** El BEFORE INSERT valida con los contadores **de antes** de
la fila que se está insertando, así que la comparación es **estrictamente menor**:

```
reserved_count + redeemed_count  <  max_redemptions      -- en el trigger BEFORE
reserved_count + redeemed_count  <= max_redemptions      -- en el CHECK de la tabla
```

Con `<=` en el trigger, el cupón admite `max_redemptions + 1` reservas y el CHECK
las rechaza con un error crudo. Es el bug más fácil de escribir de todo el feature
y necesita su caso en `tests/db/`.

#### 5.7.2.3 "Se completa" y "no se completa", con predicados que la base evalúa

**Se completa = `status = 'delivered'`.** Es la confirmación de la **cocina**, no
del dinero, y el motivo es concreto: un pedido `in_store` está impago hasta que
alguien cobra, así que atar la confirmación al pago dejaría la reserva abierta toda
la cocción. `delivered` es terminal (`ALLOWED_TRANSITIONS`) y significa que la
comida salió, para los tres métodos de pago.

**No se completa = el pedido murió sin que nunca hubiera plata.** El predicado, y
es una sola línea porque el repo ya lo dejó servido:

```
status = 'cancelled'  AND  paid_at IS NULL
```

**Eso cubre los dos caminos con un solo predicado, verificado leyendo el código:**
`public.expire_pending_orders` **no borra, hace `set status = 'cancelled'`** (y ya
tiene su propia guarda de no cancelar nada con un pago aprobado registrado). Así
que el barrido de abandonados y la cancelación manual del mostrador terminan en el
mismo estado, y **no hay que tocar `expire_pending_orders` ni el cron**. Lo mismo
para el camino de transferencia abandonada, que también termina en `cancelled`.

`paid_at IS NULL` es "nunca hubo plata": lo setean los tres caminos de aprobación
(`markOrderPaid`, `markPaidInStore`, `markPaidByTransfer`).

**Qué NO libera, y por qué:**

| Caso | ¿Libera? | Por qué |
|---|---|---|
| Expirado sin pagar | **Sí** | Nunca hubo plata ni comida |
| Cancelado con `paid_at IS NULL` | **Sí** | Idem |
| Cancelado **después** de cobrado | **No** | Hubo plata. El camino es el reembolso, que es otro reloj |
| `payment_status = 'refunded'` | **No** | Ver abajo |
| Pagado y en la cocina, sin `delivered` todavía | **No libera ni confirma** | Queda `reserved`, y es correcto: el cupón está comprometido con ese pedido |

**`refunded` no libera, y es una decisión con argumento.** Tres razones: (a)
preserva la propiedad anti-farmeo — "pedir, pagar, pedir reembolso" no devuelve el
uso; (b) el ciclo de la reserva está atado a la **cocina** (por la decisión de
arriba), y un reembolso es un evento del **dinero**: mezclar los dos relojes es
exactamente lo que `PRODUCT.md` prohíbe; (c) si el local quiere devolver el uso,
sube el tope, que es un campo. **La regla queda simple y explicable: solo se libera
lo que nunca tuvo plata.**

**Quién libera y quién confirma: Postgres, no la app.** Una liberación que depende
de que un handler corra es una liberación que se pierde.

```
private.sync_coupon_reservation()
  AFTER UPDATE OF status ON public.orders  FOR EACH ROW
  · new.status = 'delivered'                        → la fila pasa a 'redeemed'
  · new.status = 'cancelled' and new.paid_at is null → 'released' + reason
```

Dispara con **quien sea** que mueva el estado: el KDS, el portal del repartidor, el
webhook de MP, `courier_advance_order`, los crons, `service_role`.

**Y NO va adentro de `private.enforce_order_rules`**, aunque ahí vivan las reglas
de transición. Son dos cosas distintas: `enforce_order_rules` es un **BEFORE que
valida y levanta**; esto es un **AFTER que proyecta a otra tabla**. Meterlos juntos
haría que un fallo de escritura del libro mayor aborte una transición de estado
legítima. Es el mismo corte que ya existe con `sync_store_customer`, que también es
un AFTER aparte.

⚠️ Y con el mismo riesgo, que hay que nombrar: **un error en este AFTER aborta la
transición de estado del pedido.** Así que el cuerpo no llama nada externo y solo
hace un `update` sobre una fila que la FK garantiza que existe. Mismo tratamiento
que §6.4 ya le da al trigger del padrón.

#### 5.7.2.4 Qué número ve el dueño

El copy tiene que decir la verdad: **mientras hay pedidos en vuelo, el número no
es el de canjes concretados.**

- **En la lista de cupones**, la columna "Usos" muestra el **cupo ocupado**:
  `reserved + redeemed` sobre `max_redemptions` (*"7 / 50"*). Es el número que
  decide si al siguiente cliente le va a andar el cupón, que es la pregunta
  operativa.
- **En la hoja del cupón**, el desglose en una línea de texto:
  *"12 canjes · 2 reservados · quedan 36 de 50"*.
  "Reservados" con un helper al lado: *"pedidos con el cupón que todavía no se
  entregaron"*.
- **Los "liberados" NO van en el titular**: son diagnóstico. Van como `StatusPill`
  en su fila de la lista de canjes, con el motivo.
- **Las tres métricas de §5.14.5 cuentan SOLO `redeemed`.** "Facturación generada"
  sobre un pedido reservado que todavía puede morir es un número falso.

#### 5.7.3 `coupon_campaigns` y `campaign_recipients`

```sql
create table public.coupon_campaigns (
  id                bigint generated always as identity primary key,
  store_id          bigint not null references public.stores(id) on delete cascade,
  coupon_id         bigint not null references public.coupons(id) on delete restrict,

  -- La DEFINICIÓN del segmento, para que el dueño vea qué pidió y pueda repetirlo.
  segment_kind      text   not null check (segment_kind in ('all','top_n','min_spent')),
  segment_top_n     int    check (segment_top_n is null or segment_top_n > 0),
  segment_min_spent_cents bigint check (segment_min_spent_cents is null
                                        or segment_min_spent_cents >= 0),

  subject           text   not null,
  message           text,                          -- máx 500, palabras del dueño

  status            text   not null default 'queued'
                      check (status in ('queued','sending','sent','stopped','failed')),
  -- Por qué se cortó, cuando status = 'stopped' (§5.10.3.1). Enum cerrado y no
  -- texto libre: es lo que la pantalla traduce a una frase, y un texto libre
  -- terminaría mostrándose crudo.
  stopped_reason    text   check (stopped_reason is null
                                  or stopped_reason in ('coupon_expired',
                                                        'coupon_exhausted',
                                                        'coupon_paused')),
  recipients_total  int    not null default 0,
  sent_count        int    not null default 0,
  failed_count      int    not null default 0,
  skipped_count     int    not null default 0,

  created_by        uuid   references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create table public.campaign_recipients (
  id             bigint generated always as identity primary key,
  campaign_id    bigint not null references public.coupon_campaigns(id) on delete cascade,
  store_id       bigint not null,
  customer_id    bigint references public.store_customers(id) on delete set null,

  email          text   not null,                  -- congelado, tal como se manda
  chunk_index    int    not null,                   -- estable: de acá sale la clave de idempotencia

  status         text   not null default 'queued'
                   check (status in ('queued','sent','failed','skipped')),
  attempts       int    not null default 0,
  last_attempt_at timestamptz,
  last_error     text,
  provider_ref   text,
  sent_at        timestamptz,

  unique (campaign_id, email)
);

create index coupon_campaigns_store_idx    on public.coupon_campaigns (store_id);
create index coupon_campaigns_coupon_idx   on public.coupon_campaigns (coupon_id);
create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index campaign_recipients_customer_idx on public.campaign_recipients (customer_id);
-- La cola del cron. Parcial: los pendientes son una minoría del log histórico.
create index campaign_recipients_pending_idx on public.campaign_recipients (chunk_index, id)
  where status = 'queued';
```

- `unique (campaign_id, email)`: nadie recibe dos veces el mismo mail en la misma
  campaña, aunque dos filas del padrón compartan casilla (§5.2).
- `chunk_index` **persistido, no calculado**. Es lo que hace que la clave de
  idempotencia de Resend sea estable entre reintentos (§5.10.3). Si el chunk se
  recalculara con una query en vivo, un reintento con la membresía cambiada
  produce el mismo key con otro payload → `409 invalid_idempotent_request`. Es la
  trampa exacta que `courier-invite.tsx` ya documenta, acá al revés.
- `status = 'skipped'` existe para un caso concreto: el cliente se dio de baja
  **entre el encolado y el envío**. El drenaje lo re-chequea (§5.10.3).

### 5.8 El invariante del dinero

#### 5.8.1 Columnas nuevas en `orders`

```sql
alter table public.orders
  add column if not exists discount_cents       bigint not null default 0,
  add column if not exists coupon_code_snapshot text;
```

- `discount_cents`: entero, en centavos, `>= 0`. **Nunca negativo, nunca float.**
- `coupon_code_snapshot`: el código tal como se canjeó. Doctrina de snapshot, la
  misma que `order_items.name_snapshot`: el comprobante, el KDS y el historial
  tienen que poder decir **qué** cupón se usó incluso si el cupón después se
  renombra. Y sobrevive a un `on delete set null` que nunca va a pasar porque los
  cupones no se borran.
- **Ningún grant nuevo.** `orders` tiene `revoke update from authenticated` +
  `grant update (status)` y nada más, así que estas dos columnas quedan fuera del
  alcance del browser del staff sin agregar un solo `revoke`.
- Las dos entran a la lista de **columnas inmutables** de
  `private.enforce_order_rules`. `discount_cents` es plata; el snapshot es
  identidad de esa plata.

#### 5.8.2 El CHECK nuevo, y por qué NO es una regresión

```sql
alter table public.orders drop constraint orders_total_is_subtotal_plus_delivery_check;

alter table public.orders
  add constraint orders_total_is_subtotal_minus_discount_plus_delivery_check
    check (total_cents = subtotal_cents - discount_cents + delivery_fee_cents),
  add constraint orders_discount_within_subtotal_check
    check (discount_cents <= subtotal_cents);
```

El CHECK viejo existía por un motivo preciso, escrito en su propia migración:
`create_order` enumera columnas, y olvidarse de `delivery_fee_cents` **regalaba
el envío en silencio**. El CHECK convertía ese olvido en un `23514` en el primer
pedido de prueba.

**El CHECK nuevo conserva esa propiedad y la extiende.** Un `create_order` que
calcula un descuento pero se olvida de pasar `discount_cents` produce
`total ≠ subtotal − 0 + fee` → `23514`. Un `create_order` que se olvida del
envío, lo mismo que antes. La red es **estrictamente más grande**, no más chica:
cubre tres términos en vez de dos.

El segundo CHECK (`discount ≤ subtotal`) es el que evita el caso que el primero
solo no ataja: un cupón de monto fijo más grande que el carrito. Sin él,
`total = 5.000 − 8.000 + 2.000 = −1.000` lo atajaría `total_cents >= 0`… pero con
un envío suficientemente caro el total queda **positivo** y el local termina
pagándole al cliente por comer. Con el CHECK, es un `23514`. El clamp en TS
(`min(descuento, subtotal)`) es lo que hace que eso nunca llegue a la base; el
CHECK es lo que garantiza que si el clamp se rompe, se entera.

**Y entra sin backfill.** Toda fila existente tiene `discount_cents = 0` por el
`default`, así que `total = subtotal − 0 + fee` es exactamente el CHECK viejo.
Cero filas violan la constraint nueva. El `drop` + `add` es atómico dentro de la
migración.

#### 5.8.3 Las funciones que enumeran, y qué hacer con cada una

| Función | Cambio |
|---|---|
| `create_order` | Insertar `discount_cents`, `coupon_code_snapshot`. Y consumir el cupón (§5.9.2). **`coalesce((p_order->>'discount_cents')::bigint, 0)`** — ver §7.1, es lo que permite un solo deploy |
| `store_dashboard` | Sumar `discountCents` al `jsonb`: `sum(o.discount_cents)` sobre los billable de la ventana. Sin ese número, el dueño no puede contestar "¿me sirvió el cupón?", que es la única razón para tener cupones |
| `courier_queue` | Agregar la clave `discountCents`. `totalCents` ya es lo correcto (es lo que el repartidor cobra); el desglose es para que pueda contestar "¿y el descuento?" en la puerta sin llamar al local |
| `platform_stores` | **No se toca.** Enumera columnas de `stores`; su `revenue` es `sum(o.total_cents)`, que ya refleja el descuento |
| `store_couriers` | Verificar en la migración. Sus métricas salen de `total_cents`, que ya es correcto — pero hay que **mirarlo**, no asumirlo |

#### 5.8.4 El descuento en el borde de Mercado Pago

`checkout.controller.ts:createCheckoutForOrder` arma los items de la preferencia:
uno por línea del pedido, más "Envío" si hay. MP suma esos items para su total.

**Un descuento no puede restarse de `totalCents` y listo**: rompería la cota
defensiva del adapter (`totalCents < suma de items` → tira) o, sin ella, MP le
cobraría al cliente el precio de lista y el webhook llegaría con un monto que no
coincide → `mismatch` permanente, cliente pagó y el pedido nunca se confirma.

**Decisión: cuando el pedido tiene descuento, la preferencia se manda con UN
SOLO item; cuando no lo tiene, no cambia nada.**

```
si discountCents === 0:   items = [una línea por producto] + ['Envío' si hay]     ← IGUAL QUE HOY
si discountCents  >  0:   items = [{ name: `Pedido ${shortCode} — ${storeName}`,
                                     quantity: 1,
                                     unitPriceCents: order.totalCents }]
```

Por qué así, y no con un item de precio negativo:

- **El camino sin cupón queda intacto.** Hoy funciona, hoy está probado, y el 100%
  de los pedidos de hoy pasan por ahí. Un cambio que solo se activa cuando hay
  descuento tiene el radio de explosión más chico posible.
- **La suma coincide por construcción**, así que no depende de un comportamiento
  de MP que no pudimos confirmar (§3.3). Cero incógnitas bloqueando el slice.
- La investigación además desaconseja el item negativo por una razón que no es
  técnica: **una línea negativa hace que la preferencia no coincida con la vista
  del pedido en el KDS**, y quien concilia después tiene que interpretarla.
- Lo que se pierde: el detalle línea por línea en el checkout de MP, **para los
  pedidos con cupón nada más**. El cliente ya vio ese detalle en nuestro resumen,
  que es donde lo mira. Es una pérdida chica y acotada.

Y la cota defensiva del adapter pasa de `totalCents < itemsTotal` a
`totalCents !== itemsTotal`, que es **más fuerte**: hoy tolera que el total sea
*mayor* que los items (nadie lo aprovecha hoy) y con descuento eso sería
exactamente el bug de "MP le cobra de más al cliente". Con la igualdad estricta,
cualquier discrepancia de armado explota en el primer pedido de prueba en vez de
convertirse en un `mismatch` permanente.

**Nota, no bloqueante:** vale probar el `unit_price` negativo contra el sandbox
(el MCP de Mercado Pago permite crear usuario de prueba y credenciales). Si lo
acepta, mantener el detalle de líneas + una línea de descuento es más lindo y se
puede cambiar después. **No es un prerrequisito de nada.**

### 5.9 Validación, consumo y restricción por método de pago

#### 5.9.1 Dos fases, las dos en el servidor

**Fase 1 — cotización** (`GET /api/orders` → `priceCartForStore`). El browser
manda `couponCode` y `paymentMethod` junto con el carrito. El servidor valida y
devuelve:

```
PriceQuote.coupon: CouponAppliedQuote | null
  { status: 'applied',  code, label: '15% (−$1.234)', discountCents }
  { status: 'rejected', code, reason: 'Ese cupón ya venció.' }
```

**Un cupón inválido NO puede hacer fallar la cotización.** Un código viejo en el
`localStorage` no puede dejar el carrito sin precio: se cotiza igual, con
`discountCents = 0`, y el rechazo viaja como dato al lado del total. Por eso es un
campo del quote y no un `throw`.

**Fase 2 — commit** (`POST /api/orders` → `createOrder` → RPC). El browser manda
el **código**, nunca el monto. El descuento se recalcula desde cero adentro de la
transacción. **El número de la Fase 1 no viaja a la Fase 2**, exactamente como el
costo de envío: el cliente manda el método, el servidor pone el precio.

`createOrderSchema` suma un campo, y sigue siendo `.strict()`:

```
couponCode: z.string().trim().toUpperCase().max(16).optional()
            .transform(v => v === '' ? undefined : v)
```

`.strict()` acá no es cosmético, es el mismo modelo de seguridad de siempre: si
algún día un cliente empieza a mandar `discountCents`, es un 400 que nombra la
clave, no un 200 mudo.

**Y aplicar, cambiar o quitar el cupón DESCARTA la `idempotencyKey`.** Es el punto
más fácil de olvidar de todo el feature, y el modo de falla es silencioso:

> El cliente confirma sin cupón → el pedido se crea → **la respuesta se pierde**
> (mala señal, que es el caso normal de este producto) → el cliente aplica el cupón
> y vuelve a confirmar → el `return` temprano de idempotencia de `create_order`
> encuentra la clave y le devuelve **el pedido sin descuento**, con un 200 y sin un
> solo error. El cliente pagó de más y nadie se enteró.

El repo ya tiene la regla y el mecanismo: `discardIdempotencyKey()` se llama en
`addLine` (`src/lib/cart.tsx:226`), `removeLine` (:243), `setQuantity` (:251) y
`clear` (:264) — o sea **cada vez que cambia el contenido del carrito**, con el
comentario *"El carrito cambió: el intento de compra en curso, si había uno, es
otro pedido ahora"*. **Un cupón cambia la plata, así que es exactamente el mismo
caso.** Se agrega la llamada en las tres operaciones del cupón: aplicar, cambiar y
quitar.

**Dónde vive el código aplicado.** El carrito guarda hoy un envelope versionado
`{ v: 1, lines }` en `burger-shop.cart.<slug>`, con
`CartLine = { productId, quantity, optionIds, notes }` (`src/lib/cart.tsx:53-58`).
Agregar el cupón es un **bump a `v: 2`** con `couponCode: string | null` al lado de
`lines`.

Dos cuidados en ese bump:
- **Leer un envelope `v: 1` no puede tirar ni vaciar el carrito.** Se lee y se
  promueve en el lugar, con `couponCode: null`. Alguien con el carrito armado desde
  antes del deploy no pierde el pedido.
- El código guardado es **texto que el cliente tipeó**, o sea que puede estar
  vencido, pausado o no existir cuando vuelva. La cotización lo resuelve sola: cae
  en `coupon.status = 'rejected'` (§5.9.1) y **no rompe nada**. Ésa es la razón por
  la que un cupón inválido no puede hacer fallar el quote.

#### 5.9.2 El consumo atómico va adentro de `create_order`

Es el único lugar posible: es la transacción donde se inserta el pedido, y
`create_order` **ya recibe el método de pago**. Orden exacto de las operaciones:

```
1. select por (store_id, idempotency_key)  →  si existe, RETURN. (YA ESTÁ ASÍ)
2. ... el bloque de programados que ya existe ...
3. si p_order->>'coupon_code' no es null:
   3.1  select ... from public.coupons
          where store_id = v_store_id and code = v_code
          for update                      -- lock de UNA fila de cupón
   3.2  validar: existe · status='active' · starts_at/ends_at · min_subtotal
        · payment_methods contiene el método
        · reserved_count + redeemed_count < max_redemptions   -- ESTRICTO (§5.7.2.2)
        · conteo por teléfono < max_redemptions_per_phone
   3.3  v_discount := clamp(calcular, 0, subtotal)
   3.4  verificar que total_cents == subtotal - v_discount + delivery_fee   → si no, error
4. insert into orders (... discount_cents, coupon_code_snapshot ...)
5. insert into coupon_redemptions (... status = 'reserved' ...)
   -- el BEFORE INSERT vuelve a tomar el lock y valida el tope (§5.7.2.2)
   -- el AFTER recalcula reserved_count desde el libro mayor (§5.7.2.1)
6. ... items y opciones, como ya está ...
```

**No hay `update coupons set ... + 1` en ningún lado.** El contador lo mantiene
`private.sync_coupon_counters()` recalculando desde el libro mayor: `create_order`
inserta **una** fila de reserva y los contadores se acomodan solos. Es lo que hace
que ningún camino futuro pueda mover el cupo sin dejar rastro en el libro mayor.

Y lo que se inserta es una **reserva**, no un canje: la confirmación y la
liberación las hace `private.sync_coupon_reservation()` cuando el pedido llega a
`delivered` o muere sin plata (§5.7.2.3).

Los cuatro puntos que hacen que esto sea correcto:

- **El paso 1 es lo que salva la idempotencia.** `create_order` ya vuelve temprano
  cuando encuentra la clave, **antes** de tocar el cupón. Un reintento del mismo
  intento de compra devuelve el pedido que ganó y **consume cero usos**. El bloque
  del cupón va después de ese `return`, y eso es una condición del diseño, no un
  detalle de implementación. **Necesita test en `tests/db/`.**
- **`for update` sobre la fila del cupón, no un advisory lock ni un lock de
  tienda.** Dos personas usando el último uso a la vez se serializan en esa fila:
  la primera gana, la segunda **espera** y después recibe un `coupon_exhausted`
  limpio. Con solo el CHECK, la segunda fallaría con un `23514` crudo después de
  haber hecho todo el trabajo. Y el alcance del lock es un cupón, no la tienda:
  no serializa la creación de pedidos del local en hora pico (el mismo criterio
  que el advisory lock de programados documenta).
- **`coupons_within_cap_check` es el backstop.** Si la lógica de la RPC estuviera
  mal, el `update` que hace el trigger de contadores rebota con `23514` y se lleva
  puesta la transacción entera, pedido incluido. **El tope no depende de que el
  código de la RPC sea correcto**, y ésa es toda la razón de que los contadores
  vivan en `coupons` y no se cuenten al leer (§5.7.2.1).
- **El paso 3.4 es la red del CHECK, adentro de la función.** Verifica que el total
  que el llamador calculó en TS coincida con el descuento que la base acaba de
  calcular. Si no coinciden, es un bug de TS y hay que enterarse ahí, no descubrir
  después que el CHECK de la tabla lo atajó con un mensaje de constraint.

**Aritmética del descuento, en enteros:**

```
percentage:  d = floor(subtotal * percent / 100)
             si max_discount_cents no es null:  d = min(d, max_discount_cents)
fixed:       d = amount_off_cents
siempre:     d = min(d, subtotal)          -- el clamp de §5.8.2
```

`floor`, no `ceil`. **Ojo: `scaleUpInt()` de `src/lib/money.ts` NO sirve acá** —
hace `Math.ceil`, que está bien para un ETA (redondear un minuto para arriba es
honesto) y mal para un descuento (redondear el regalo para arriba es plata del
local). Hace falta un helper nuevo en `money.ts`:
`percentOfCentsDown(cents, percent)`. Y la misma fórmula, en SQL, adentro de la
RPC. Están escritas dos veces a propósito, igual que `ALLOWED_TRANSITIONS`: la de
TS es para que la UI muestre el número antes de comprar, la de Postgres es la que
cobra. **Necesitan un test de paridad.**

#### 5.9.3 Exposición máxima de un código filtrado

El número que §4.4 pide dejar registrado. Con un cupón de 15% con tope de $3.000,
mínimo de subtotal $10.000, `max_redemptions = 50` y `max_redemptions_per_phone = 1`:

```
peor caso = max_redemptions × min(max_discount_cents, subtotal × percent/100)
          = 50 × $3.000
          = $150.000 de descuento total
```

Con `max_discount_cents` en `null` el techo lo pone el carrito más caro que alguien
arme: `50 × 15% × (carrito sin límite)` **no tiene cota**. Por eso:

- `max_redemptions` es **`not null`** (§5.7.1).
#### El peor caso en PLATA no cambió con las reservas, pero apareció otro

**En plata, el techo es el mismo:** solo un canje **confirmado** cuesta dinero, y
`redeemed_count` es monótono y acotado por `max_redemptions` (§5.7.2.1). Una
reserva liberada no descontó nada.

**Pero el modelo de reserva abre un ataque nuevo, y no es una fuga de plata: es una
negación de servicio sobre la promoción.** Alguien crea N pedidos con el cupón sin
pagarlos: las reservas **ocupan el cupo** hasta que el barrido las libera (45
minutos, el default de `expire_pending_orders`), y mientras tanto el cupón le dice
"agotado" a los clientes reales. En una promo de un viernes a la noche, 45 minutos
de cupón muerto es la promoción entera.

**Está acotado por dos cosas que ya existen, y por eso no hace falta un mecanismo
nuevo:**
- **`max_redemptions_per_phone`, default 1.** Un teléfono puede sostener **una**
  reserva de ese cupón (el índice parcial cuenta `reserved` y `redeemed`, §5.7.2).
  Para ocupar 50 lugares hacen falta **50 teléfonos distintos**.
- **`order:phone` (5 pedidos / 10 min)** y **`order:store`** como termómetro.

O sea: el ataque es real pero cuesta 50 números de teléfono, y el efecto se
autolimpia en 45 minutos. Se acepta a conciencia. La mitigación si algún día pasa
es bajar el default de expiración para pedidos con cupón, y **no** está en el
alcance de esta entrega.

- La hoja de creación **muestra el peor caso calculado en vivo**, en pesos, arriba
  del botón de guardar: *"Peor caso: hasta $150.000 en descuentos."* Es un cálculo
  puro sobre lo que el dueño acaba de tipear, y es la diferencia entre una
  decisión informada y un formulario.
- Si el tipo es `percentage` y `max_discount_cents` está vacío, ese texto dice
  *"Peor caso: sin tope. Poné un tope de descuento."* — advertencia, no bloqueo.

#### 5.9.3.1 Los mínimos se evalúan SIN descuento; el envío gratis, CON descuento

Cerrado por el dueño del producto (Q9, con la recomendación de este documento).
Nadie en la categoría lo documenta —Shopify mide sus mínimos *"before shipping,
taxes, and duties"* pero calla sobre pre- vs. post-descuento; DoorDash y Uber Eats
tampoco publican nada—, así que es una decisión propia y hay que dejarla escrita.

| Umbral | Se mide sobre | Por qué |
|---|---|---|
| `stores.min_order_cents` (mínimo del pedido) | subtotal **sin** descuento | Protege al local de un pedido que no le conviene cocinar, y un cupón no cambia lo que cuesta cocinarlo |
| `stores.delivery.min_order_cents` (mínimo para envío) | subtotal **sin** descuento | Idem: el viaje cuesta lo mismo con cupón que sin cupón |
| `coupons.min_subtotal_cents` (mínimo del cupón) | subtotal **sin** descuento | Es la condición de entrada del propio cupón: medirla contra el subtotal ya descontado sería circular |
| `stores.delivery.free_from_cents` (envío gratis) | subtotal **CON** descuento | Es un **regalo**, no una protección. Regalar el envío por un subtotal que el cupón infló es pagar dos veces la misma promoción |

Es la misma circularidad que `src/lib/delivery.ts` ya resolvió un nivel más
arriba —*"cobrar el envío para llegar al mínimo que habilita el envío es
circular"*— aplicada un nivel más abajo.

Consecuencia práctica que la UI tiene que decir bien: un carrito de $10.000 con un
cupón de $3.000 y un mínimo de envío de $9.000 **sí** puede pedir envío (el
subtotal sin descuento es $10.000), pero si el envío gratis arranca en $8.000
**no** lo consigue, porque el subtotal con descuento es $7.000. Los dos números
salen del servidor en la misma cotización, así que la pantalla nunca tiene que
calcularlo.

#### 5.9.4 La restricción por método de pago

**Representación: `payment_methods text[]`, nullable. `null` = todos los métodos.**

Por qué array y no tres booleanos: la UI es un multi-select sobre un enum cerrado
que ya existe (`paymentMethodSchema`), el operador `<@` da la validación de
pertenencia gratis, y el CHECK de `array_length >= 1` hace que **"ningún método"
sea inrepresentable** — que es exactamente lo que hay que garantizar. Con tres
booleanos hace falta un CHECK de tres términos para prohibir el todo-false, y una
columna más el día que aparezca un cuarto método.

`null` y no `array['online','in_store','transfer']` para "todos": un cupón sin
restricción no debería tener que enumerar los métodos que existen hoy. Si mañana
aparece un cuarto, todos los cupones "sin restricción" lo incluyen solos.

**Los nombres en la UI.** El dominio no tiene "efectivo", y la UI no puede
inventarlo:

| Valor | Etiqueta | Helper |
|---|---|---|
| `online` | **Mercado Pago** | "Pago online por adelantado" |
| `transfer` | **Transferencia** | "El cliente transfiere y sube el comprobante" |
| `in_store` | **Pago al recibir** | "En el local al retirar, o en la puerta si es delivery" |

**"Pago al recibir", nunca "efectivo".** `in_store` significa cobro presencial y
el sistema no sabe con qué se paga; y en delivery interviene
`courier_collects_payment`, que decide si el repartidor maneja plata. Prometerle
"efectivo" al cliente es una promesa que el producto no puede sostener.

**Métodos que el local no cobra hoy.** El local tiene tres flags:
`onlinePaymentEnabled` (derivada, la mantiene un trigger sobre las credenciales de
MP), `transferPaymentEnabled` (derivada, la mantiene un trigger sobre
`store_bank_accounts`) e `inStorePaymentEnabled` (decisión del dueño).

La hoja de creación **muestra los tres checkboxes y deshabilita los que el local
no puede cobrar, con el motivo inline y un link a `/admin/pagos`**:
*"Conectá Mercado Pago para usar esto"* · *"Cargá una cuenta bancaria"* ·
*"Habilitá el pago en el local"*.

- No los oculta: ocultar hace pensar que el producto no lo puede hacer.
- No los deja habilitados con una advertencia: un cupón restringido a un método
  que nadie puede pagar es plata muerta, y el dueño se entera cuando un cliente le
  escribe.

**Si el local apaga ese método después.** El cupón **no se toca** — ningún cron da
vuelta una decisión del dueño. Pero la lista de cupones muestra un `StatusPill` de
aviso derivado en la lectura (*"Restringido a un medio que hoy no cobrás"*), misma
doctrina que `canTakeOrders()`: el estado se calcula al leer, no se persiste. Y el
checkout nunca deja pasar esa combinación, porque el método no se ofrece.

**El cliente cambia de método después de aplicar el cupón.** Es el caso que hay
que resolver bien, y el mecanismo ya existe: la cotización se re-dispara con cada
cambio de carrito **y de método** (`use-priced-cart.ts` + el `GET`), y el
`couponCode` viaja en la misma request. Entonces:

1. El cliente cambia a "Pago al recibir" con un cupón de solo-Mercado Pago
   aplicado.
2. El mismo round trip que recotiza devuelve
   `coupon: { status: 'rejected', reason: 'Ese cupón vale solo pagando con Mercado Pago.' }`
   y un total **sin** el descuento. El total que se muestra siempre sale del
   servidor.
3. La UI **no borra el cupón en silencio**: deja la línea de descuento visible,
   tachada, con el motivo al lado. El cliente tiene que ver **por qué** subió el
   total. Un total que sube sin explicación es la peor cosa que puede pasar en un
   checkout.
4. `POST` revalida igual. El peor caso es un 400 con el mismo mensaje. **Nunca se
   concede un descuento que el servidor no volvería a conceder.**

**Mensajes de `DomainError` (son interfaz, y están escritos acá para que nadie los
improvise):**

| Situación | Mensaje |
|---|---|
| No existe / `draft` / `paused` | "Ese código no existe o ya no está disponible." |
| Todavía no arrancó | "Ese cupón todavía no arrancó." |
| Venció | "Ese cupón ya venció." |
| Tope global alcanzado | "Ese cupón ya se agotó." |
| Tope por teléfono alcanzado | "Ya usaste ese cupón." |
| Subtotal insuficiente | "Ese cupón es para pedidos de $X o más. Te faltan $Y." |
| Método de pago no habilitado | "Ese cupón vale solo pagando con {métodos}." |

**"No existe" y "está pausado" dan el mismo mensaje a propósito.** Decirle a quien
está sondeando códigos que uno *existe pero está pausado* es información gratis
sobre el espacio de códigos del local. Es el mismo criterio con el que
`zodToApiError` no nombra la clave rechazada por `unrecognized_keys`.

### 5.10 Segmentos, campañas y el envío

#### 5.10.1 `/emails/batch`, no Broadcasts. Y hay que argumentarlo

Los Broadcasts de Resend son la respuesta tentadora: **no se miden por volumen**
(solo por contactos, 1.000 en free), e inyectan solos el `List-Unsubscribe`, el
URL de baja y el bookkeeping de la opt-out. Contra los 100/día de `/emails`, la
comparación parece cerrada.

**Y aun así, no.** Cuatro razones, en orden de peso:

1. **Obliga a copiar el padrón a Resend.** Un Broadcast se manda a un *Segment* de
   *Contacts*, así que hay que empujar nombre, mail (y para segmentar, la plata
   gastada como Contact Property) de cada cliente de cada local a un tercero. Eso
   es una escalación de privacidad que el feature no necesita, que habría que
   declarar en `/legal/privacidad`, y que crea una segunda fuente de verdad de un
   dato que ya vive en nuestro Postgres.
2. **Los Contacts de Resend son globales por dirección de mail; nuestros tenants
   son tiendas.** Dos locales con el mismo cliente colisionan en el mismo contacto,
   y el flag `unsubscribed` de un contacto es **de la cuenta**: una baja del local
   A silenciaría al local B. Eso contradice de frente el aislamiento multi-tienda,
   que es la restricción más dura del producto.
3. **Un Broadcast apunta a un Segment.** Un SaaS multi-tienda necesita un segment
   por tienda (o uno por tienda × segmento), contra un límite de segments por plan.
   No escala con el modelo de negocio.
4. El cuerpo de un Broadcast es una plantilla con merge variables: cero lógica por
   destinatario.

**Con `/emails/batch` ganamos:** el padrón y la baja quedan en Postgres, donde ya
está el token; `react` está soportado, así que la novena plantilla de
`src/emails/` funciona igual que las otras ocho; y el chunk de 100 coincide con el
tope del batch.

**Lo que perdemos y hay que construir:** los headers de baja y el endpoint.
`/emails` **no** inyecta `List-Unsubscribe`. Son dos headers por mail y una ruta
pública (§5.12.2). Es barato, y deja la baja autoritativa en nuestra base — que
después de leer el punto 2 de arriba es una ventaja, no una concesión.

#### 5.10.2 El segmento: definición guardada, lista congelada. Las dos cosas

- **La definición** vive en `coupon_campaigns` (`segment_kind`, `segment_top_n`,
  `segment_min_spent_cents`): es lo que el dueño pidió, y le permite ver y repetir
  la campaña.
- **La lista** se congela en `campaign_recipients` al momento de encolar.

Por qué congelar: el envío es un **evento con un resultado**. Reevaluar el segmento
después dejaría al log sin poder contestar "¿a quién le llegó?", que es la única
pregunta para la que el log existe (y la que hay que poder contestar si alguien
reclama). Y evita el doble mail a quien cruza el umbral en medio del envío.

Los tres segmentos, y nada más:

| `segment_kind` | Predicado sobre `store_customers` |
|---|---|
| `all` | todos los de la tienda |
| `top_n` | `order by total_spent_cents desc limit segment_top_n` |
| `min_spent` | `total_spent_cents >= segment_min_spent_cents` |

En los tres, **el encolado filtra además** `email is not null` y
`marketing_opt_out_at is null`. Los tres números se muestran antes de mandar
(`CampaignPreview`): *"42 en el segmento · 17 con email · 3 se dieron de baja · se
manda a 17"*. **Los clientes sin email no desaparecen en silencio: se cuentan y se
dicen.** Es la información que le dice al dueño que el mail no es el canal (§4.1).

#### 5.10.3 El drenaje: cron, presupuesto y la clave de idempotencia

**El envío es diferido, no sincrónico desde la Server Action.** La acción crea la
campaña, congela los destinatarios con `status='queued'` y `chunk_index`
asignado, y **vuelve**. Razones: una Server Action que manda 100 mails espera el
round trip de Resend adentro de una request de Vercel; y si el cupo del día no
alcanza, no hay nada que hacer sincrónicamente más que fallar.

**Cron nuevo: `/api/cron/campaigns`, cada 5 minutos, disparado por pg_cron.**

```sql
select cron.schedule('app-campaigns', '*/5 * * * *',
  $job$ select private.invoke_app_cron('/api/cron/campaigns'); $job$);
```

pg_cron y **no** `vercel.json`: en Hobby, una entrada de cron más frecuente que
diaria **hace fallar el deploy**. Está documentado en `CLAUDE.md` y ya resuelto —
el handler exporta `GET` y compara `CRON_SECRET` en tiempo constante, igual que los
otros cuatro.

Cada tick:

1. **RPC `claim_campaign_recipients(p_budget int)`** — `service_role`, con
   `for update skip locked`, el patrón exacto de `claim_event_deliveries`. Sin eso,
   dos ticks solapados mandan el mismo mail dos veces. Devuelve como máximo un
   chunk, y **nunca más de lo que queda del presupuesto del día**.
2. **Re-chequea la baja adentro de la RPC.** Un destinatario cuyo
   `marketing_opt_out_at` dejó de ser nulo entre el encolado y ahora se marca
   `skipped` y no se manda. Es lo que hace que la baja tenga efecto inmediato en
   vez de "dentro de las 48 horas" que exige RFC 8058.
3. Un `resend.batch.send()` con los ≤100 del chunk.
4. Settle: `sent` + `provider_ref`, o `attempts+1` + `last_error`.

**El presupuesto diario: 15.** Decisión del dueño del producto, textual:
*"Limitemos campañas de mails a 15 cupones por día, si lo desean extender un mail
de comandapp para negociar otro plan"*.

**Lectura adoptada, y se dice explícita porque el texto es ambiguo: son 15 MAILS
de campaña por día, no 15 cupones distintos creados por día.** El razonamiento:
el único recurso que hay que racionar es la cuota de mail de Resend, y crear un
cupón cuesta una fila. Un tope de "15 cupones creados" no protegería nada y no
sería una palanca comercial —nadie paga más para poder crear el cupón nº16—;
un tope de 15 mails sí, porque es exactamente lo que limita el alcance de una
promoción. Y desde el requisito del código de 6 dígitos (§5.11.3), la *creación*
de cupones ya tiene su propio freno. Si la lectura correcta era la otra, el
cambio es de una constante y de un balde, pero el diseño de acá no aplica.

Constante nueva `CAMPAIGN_DAILY_BUDGET = 15`, contada en Postgres (un `count` de
`campaign_recipients` con `sent_at >= hoy 00:00 UTC` — **la ventana de Resend es
UTC**, no la del local; las fechas que se le muestran al dueño se formatean en la
zona del local, y el desfase de unas horas no cambia ningún conteo). Los ~85
restantes quedan para el mail transaccional.

**Y esto cambia el tamaño del chunk, que no es un detalle.** Con 80/día tenía
sentido un chunk de 100 (el tope del batch de Resend). Con 15/día un chunk de 100
**nunca se puede mandar**. El chunk pasa a ser
`min(CAMPAIGN_DAILY_BUDGET, 100) = 15`, o sea **un chunk = un día = una llamada al
batch**. Queda más limpio que antes: la unidad de reintento, la unidad de
presupuesto y la unidad de idempotencia son la misma cosa.

**Consecuencia, y hay que mirarla de frente: una campaña a 142 clientes tarda diez
días.** Eso no es un cuello de botella accidental: es la palanca que empuja la
conversación comercial (§5.10.5). Pero abre un problema de diseño real, que es el
punto siguiente.

#### 5.10.3.1 El cupón puede vencer antes de que la campaña termine de mandarse

Con diez días de drenaje y un cupón que vence el viernes, la mitad del segmento
recibe un código que ya no sirve. Es el peor resultado posible para la marca:
peor que no mandar nada.

**Se resuelve en dos capas, y la primera es la que importa.**

**Capa 1 — prevención: la campaña que no puede terminar NO se puede empezar.**
`campaign_segment_preview` devuelve, además de los cuatro conteos:

```
willSend        17
daysNeeded      ceil(willSend / CAMPAIGN_DAILY_BUDGET)
lastSendDate    hoy + (daysNeeded − 1)          -- en la zona del local
couponEndsAt    el ends_at del cupón
```

Y la pantalla lo dice **antes** de confirmar, con las dos fechas enfrentadas:
*"Se manda a 142 personas. Con el cupo de 15 por día son 10 días: el último mail
sale el 10/09. **El cupón vence el 05/09.**"*

Si `lastSendDate > couponEndsAt`, la acción **rechaza** con un `DomainError` que
nombra las tres salidas, porque un error que no dice qué hacer no sirve:
*"Con este cupo, el último mail sale el 10/09 y el cupón vence el 05/09. Estirá la
vigencia hasta el 10/09, mandá a menos gente, o escribinos para ampliar el cupo."*

Es un bloqueo y no una advertencia, y el motivo es que el daño es diferido e
invisible: el dueño aprieta "Mandar", ve que arrancó bien, y el problema aparece
recién el día seis cuando ya no está mirando. Con `ends_at` en `null` no hay nada
que comparar y no se bloquea nada.

Lo que **no** se bloquea, pero sí se dice: `max_redemptions` menor que la cantidad
de destinatarios. Mandarle un cupón de 50 usos a 142 personas es práctica normal
—la tasa de canje es de un dígito—, así que la pantalla lo informa
(*"Cupón para 50 usos, se manda a 142 personas"*) y no opina.

**Capa 2 — el drenaje verifica antes de cada chunk.** Con la prevención puesta,
esto solo se dispara cuando el dueño causó el cambio o cuando el cupón tuvo éxito.
`claim_campaign_recipients` chequea el estado del cupón **antes de reclamar el
chunk** (no por destinatario: el chunk es la unidad):

| Estado del cupón al drenar | Qué hace |
|---|---|
| `active` y en ventana y con cupo | Manda el chunk |
| Vencido (`ends_at` pasó) | **Corta la campaña** |
| Agotado (`reserved_count + redeemed_count >= max_redemptions`) | **Corta la campaña** |
| `paused` por el dueño | **Corta la campaña** |

**Cortar** significa: los destinatarios que quedan pasan a `skipped`, y la campaña
a un estado terminal **nuevo**, `stopped`, con el motivo. `stopped` y no `failed`,
porque son dos cosas distintas y piden dos acciones distintas del dueño: `failed`
es que **nuestra** infraestructura falló y conviene reintentar; `stopped` es que
**la oferta dejó de ser válida** y no hay nada que reintentar. El `status` de
`coupon_campaigns` pasa entonces a
`queued | sending | sent | stopped | failed`.

**No se manda un mail avisando que la campaña se cortó**, y es deliberado: el
único caso que llega acá es uno que el dueño causó (pausó el cupón) o uno que
quería (se agotó porque funcionó, y lo va a ver como "50 de 50 canjes" en el
detalle del cupón). Gastar cupo transaccional en avisar de algo que el panel ya
muestra, en un feature cuyo problema central es el cupo, sería incoherente. **La
prevención de la capa 1 es lo que hace que esto sea aceptable**: sin el bloqueo
previo, `stopped` sería un final sorpresa y sí haría falta avisar.

**Fallo parcial.** El batch de Resend es **atómico**: un destinatario inválido
hace fallar la llamada entera. Por eso:

- Cada dirección se valida con Zod (`z.email()`) **al encolar**, no al mandar. Una
  dirección inválida nace `skipped`, nunca llega al batch.
- Si el batch falla igual, el chunk entero suma `attempts` y `last_error`, y se
  reintenta en el próximo tick. A los **3 intentos** las filas pasan a `failed` y
  la campaña queda `failed` con el conteo. No se reintenta para siempre.

**La clave de idempotencia, que es el detalle que más fácil se rompe:**

```
`campaign/${campaignId}/${chunkIndex}/${sha256(ids del chunk, ordenados).slice(0,16)}`
```

Mismo contenido → mismo key → Resend devuelve los ids originales y **no manda de
nuevo** (ventana de 24h). Eso es exactamente lo que un reintento de cron necesita.

**Pero:** misma clave con payload distinto → `409 invalid_idempotent_request`.
Es la trampa que `courier-invite.tsx` ya documenta, y la lección de ese archivo se
aplica textual: **la clave deriva del CONTENIDO, no de la entidad.** Por eso el
sufijo es un hash de los ids de destinatario que realmente van en el payload, y no
solo el `chunkIndex`.

Sin ese sufijo el modo de falla es concreto y silencioso: un destinatario se da de
baja entre dos ticks, el paso 2 lo saca del chunk, el payload cambia, la clave no,
y **ese chunk devuelve 409 para siempre** — la campaña se cuelga sin que nada
diga por qué.

Los tres corolarios, para que no se pierdan en la implementación:

1. `chunk_index` se asigna **al encolar** y no cambia nunca. Es lo que ancla el
   presupuesto y el orden.
2. El **contenido** del chunk sí puede cambiar (una baja), y el hash lo absorbe.
   Ésa es la diferencia entre las dos partes de la clave.
3. Un reintento por `attempts` manda **el mismo payload**, así que la clave
   coincide y Resend dedupea de verdad — que es exactamente el caso que la
   idempotencia tiene que cubrir.

**Y con el cupo en 15, el chunk es de 15, no de 100** (§5.10.3): un chunk = un
día = una llamada al batch. La unidad de presupuesto, la de reintento y la de
idempotencia son la misma, que es lo que hace que este razonamiento sea chico.

#### 5.10.4 La novena plantilla, y por qué no deja fila en `notifications`

`src/emails/store-coupon-campaign.tsx`, con los bloques de `_shared.tsx`. Contenido:
el nombre del local, el mensaje del dueño, **el código en grande**, el descuento en
palabras, la vigencia, el link a la vitrina, y el pie de baja.

El envío va en `src/services/notifications/email/campaign.tsx`, un canal aparte
del puerto `EmailSender` — **exactamente por el mismo motivo que
`owner-invite.tsx`, `courier-invite.tsx` y `payment-change.tsx`**: el contrato de
`email.port.ts` es `{ storeId, orderId, ... }` porque las dos plantillas que sirve
son sobre un pedido, y `notifications` tiene `order_id not null`. **Una campaña no
tiene pedido, así que no hay fila que insertar.** El log de la campaña es
`campaign_recipients`, que además guarda lo que `notifications` no tiene:
`chunk_index` y `attempts`.

Resiliencia: **degrada, no tira.** Sin `RESEND_API_KEY` el envío devuelve `skipped`
y la campaña queda `failed` con el motivo. Mismo principio que el comprobante. La
única plantilla del repo que tira sin key es
`store-payment-change-code`, porque es un segundo factor — una promo no lo es.

**Y los dos headers que Resend no pone:**

```
'List-Unsubscribe':      `<{apexUrl}/baja/{token}>`
'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
```

Por destinatario, con **su** token. `headers` per-email está soportado en batch.

#### 5.10.5 El remitente de campaña es un subdominio aparte

Decidido por el dueño (Q4, aprobada): la campaña sale de **`promos.comandapp.ar`**,
no del dominio que manda el magic link.

El motivo es que hoy `comandapp.ar` manda el magic link, que `CLAUDE.md` describe
como *"la única puerta a `/admin`"*. Resend corta con **bounce ≥ 4%** o **quejas
≥ 0,08%** (más estricto que el 0,3% de Gmail), y el perfil de engagement de una
promoción no se parece al de un mail de login. Sin aislar, una campaña con malos
números degrada la reputación de la que depende el acceso al panel, **y el modo de
falla es silencioso**.

**Es un paso operativo, no código** (§7.4): registrar el dominio en Resend, cargar
los registros DNS, y setear `RESEND_CAMPAIGN_FROM_EMAIL`. Queda un slot libre en
el free tier (hay dos dominios verificados de tres).

**Fallback cuando la variable no está seteada: la campaña sale igual, desde
`RESEND_FROM_EMAIL`, con un `log.warn`.** Degrada, no tira, y va al revés que el
código de 6 dígitos a propósito:

- El código de 6 dígitos **tira** porque es un segundo factor: si no sale, el dueño
  se queda con un formulario esperando un código que nunca va a llegar, y no hay
  camino alternativo.
- La campaña **degrada** porque el riesgo que la variable mitiga es *estadístico y
  acumulativo* (reputación), no binario. Bloquear una promoción por una variable
  faltante es un costo cierto para evitar un riesgo que, a 15 mails por día,
  tarda mucho en materializarse. Y el `log.warn` es lo que hace que el paso
  operativo pendiente sea visible en vez de olvidado.

`promos` es un hostname de la plataforma, así que entra en `RESERVED_SLUGS`
(§5.12.1) por el mismo criterio que `mail` y `bounces` ya están ahí.

#### 5.10.6 Cuando 15 por día no alcanza: la vía comercial

El cupo de 15/día **es** la palanca (§5.10.3). Cuando muerde, tiene que haber una
puerta, y el repo ya tiene el patrón exacto: `store-payment-support`, el pedido de
soporte que se dispara desde la pantalla de Pagos, con sus baldes
`support:store` (1/2min) y `support:store:day` (10/24h). **Se reusa esa forma, no
se inventa otra.**

**Dónde aparece la oferta: en el preview de la campaña, y SOLO cuando
`daysNeeded > 1`.** No en el header de la sección, no permanente.

El argumento es de diseño, no de implementación: una oferta siempre visible se
vuelve mueble y se deja de ver; una que aparece **exactamente en el momento en que
el dueño acaba de leer "son 10 días"** es una conversación que empieza sola. Es el
mismo instante en que el bloqueo de §5.10.3.1 puede estar rechazándole la campaña,
así que el `DomainError` de ese bloqueo ya nombra esta salida como tercera opción.

**Qué lleva el mail, para que la conversación empiece con datos y no con "quiero
más mails".** Plantilla nueva, la décima: `store-campaign-quota-request`.

| Dato | Por qué |
|---|---|
| Local, slug y mail del dueño | Con quién hablar |
| Clientes en el padrón, y cuántos con email | El tamaño real de su lista |
| Destinatarios de la campaña que quiso mandar | La demanda concreta |
| Días que tarda con el cupo actual | El dolor, cuantificado |
| Cupones activos y canjes del último mes | Si ya le está funcionando |
| Mensaje libre del dueño (máx 500) | Contexto |

Va a `SALES_EMAIL` (variable de entorno; `ventas@comandapp.ar` a confirmar como
dirección — §7.4). **Plantilla nueva y no parametrizar `store-payment-support`**,
por dos razones: el payload es distinto (lleva seis números, no un mensaje suelto)
y el destino es otro, así que parametrizar convertiría el asunto y el ruteo en un
switch dentro de una plantilla que hoy hace una sola cosa bien.

Degrada, no tira: si no sale, el panel muestra el mail de ventas para que el dueño
escriba a mano. Un pedido comercial que no sale no rompe nada.

**Baldes nuevos, con los números de `support:*`** (§5.13): `campaign_quota:store`
1/2min y `campaign_quota:store:day` 5/24h. Baldes propios y no reusar
`support:store`: son dos intenciones distintas, y un pedido de soporte de Pagos no
tiene por qué comerse el cupo de un pedido de ventas.

`ventas` entra en `RESERVED_SLUGS` (§5.12.1): la lista dejó de proteger paths para
proteger **hostnames**, y ya tiene `soporte`, `support`, `ayuda` y `contacto` por
el mismo motivo.

### 5.11 Autorización, grants y qué va en Postgres

#### 5.11.1 Todo es del `owner`

El padrón, los cupones y las campañas son **solo del dueño**. Tres razones, cada
una suficiente:

- **Un cupón es plata** y una campaña **habla en nombre de la marca**. Mismo
  criterio que hizo `ownerOnly` a `/admin/repartidores` y a la sección de Pagos.
- **El padrón es el peor dataset del local para que se filtre**: nombre, teléfono,
  mail y cuánto gastó cada cliente, todo junto y exportable con un scroll. El staff
  del mostrador ya ve los datos de contacto de **los pedidos que está atendiendo**
  —need-to-know, y eso no cambia—, pero no necesita el padrón consolidado.
- `courier` no es staff (`private.is_store_member` está endurecida a
  `role in ('owner','staff')`), así que un repartidor no llega ni al borde.

El gate es doble, como en todo `/admin`: la nav no muestra el ítem
(`ownerOnly: true`), y **cada `page.tsx` chequea `role === 'owner'` de nuevo**. El
layout no autoriza.

#### 5.11.2 Grants: `authenticated` no escribe **nada**, y tampoco lee

```sql
revoke all on public.store_customers      from anon, authenticated;
revoke all on public.coupons              from anon, authenticated;
revoke all on public.coupon_redemptions   from anon, authenticated;
revoke all on public.coupon_campaigns     from anon, authenticated;
revoke all on public.campaign_recipients  from anon, authenticated;

grant select, insert, update, delete on public.store_customers     to service_role;
grant select, insert, update, delete on public.coupons             to service_role;
grant select, insert, update, delete on public.coupon_redemptions  to service_role;
grant select, insert, update, delete on public.coupon_campaigns    to service_role;
grant select, insert, update, delete on public.campaign_recipients to service_role;

alter table ... enable row level security;   -- las cinco
```

**Cero policies. Cero columnas otorgadas.** Y hay que decir por qué esto no es
pereza sino la respuesta correcta a la pregunta que la doctrina de grants por
columna obliga a hacerse: *"¿esto lo tendría que poder hacer el browser del
staff?"*.

En `coupons` **no hay una sola columna** que el browser deba poder escribir: cada
una es plata (`percent`, `amount_off_cents`, `max_discount_cents`,
`min_subtotal_cents`) o alcance (`starts_at`, `ends_at`, `max_redemptions`,
`payment_methods`, `status`). Otorgar cualquiera de ellas es abrir un `PATCH
/rest/v1/coupons` que edita un descuento — exactamente el agujero que la sección
de grants de `CLAUDE.md` existe para no repetir. Y `coupon_redemptions` es el
libro mayor: nadie lo escribe salvo la transacción del pedido.

Tampoco hay `select` para `authenticated`, y eso también es deliberado: las
lecturas van por RPC o por admin client, igual que `/admin/pagos` lee la cuenta
bancaria. Menos superficie.

`service_role` sí necesita el grant explícito: la trampa documentada es que
**Supabase no le da privilegios sobre las tablas que crea una migración**, y sin
esto el primer insert falla con `42501 permission denied` sin mencionar los grants
en ningún lado. (El `alter default privileges` de `20260825120500_grants.sql` ya lo
cubre, pero se escribe explícito igual: es lo que hicieron
`store_bank_accounts` y `rate_limits`.)

Consecuencia esperada: las cinco tablas van a aparecer en `get_advisors` como
`rls_enabled_no_policy` **en INFO**. Es correcto (§2.1). No se arregla.

#### 5.11.3 Crear y activar un cupón pide el código de 6 dígitos

Decisión del dueño del producto (2026-08-31), textual: *"crear o modificar cupones
pide la verificación de código por mail"*.

**Esto revierte lo que la primera versión de este documento proponía** (que un
cupón no cruzaba a `store_pending_changes`, porque reduce el ingreso del propio
local en vez de redirigirlo a otra cuenta). Es decisión del dueño del producto y
no se debate. Lo que sigue es el mecanismo, no el argumento en contra.

##### `store_pending_changes` se reusa tal cual

Ya tiene resuelto todo lo difícil, y **nada de eso se reimplementa**:

- HMAC-SHA256 del código con `CREDENTIALS_ENCRYPTION_KEY`, nunca el código.
- TTL de 10 minutos.
- Los intentos se cuentan **en la base**, dentro de `claim_store_pending_change`
  (máximo 5). Contarlos en la app pierde la carrera.
- El mail sale a la dirección de `auth.users` del dueño, **nunca a una que venga
  en el request**: es lo que impide que una sesión robada se redirija el código.
- `requested_by` tiene que coincidir al confirmar: es confirmación de identidad,
  no escalación de permiso.
- Cero policies y cero grants para `authenticated`; solo `service_role`.

**`claim_store_pending_change` sirve sin tocarla. Verificado:** su firma es
`(p_id, p_store_id, p_user_id)` y busca **por `id`**, no por `kind`. Un `kind`
nuevo no la afecta en nada.

**Dos cambios en la tabla, y el segundo no es opcional:**

1. El CHECK de `kind` suma `'coupon'`. Ya se ensanchó una vez (migración de
   transferencia) con el patrón de drop-por-introspección, que es el que hay que
   repetir: un `if not exists` sobre el nombre encuentra el constraint viejo, se
   saltea el `add`, y deja en pie la lista corta.

2. **Columna nueva `subject_id bigint` (nullable)**, y el índice parcial
   `store_pending_changes_live_idx` pasa de `(store_id, kind)` a
   `(store_id, kind, subject_id)`.

El (2) es un bug encontrado leyendo el código, no una preferencia. El índice
actual documenta su propio propósito: *"el pendiente vivo de esta tienda para este
tipo de cambio, **para invalidarlo cuando se pide uno nuevo**"*. Con los tres
`kind` que existen hoy hay a lo sumo **una** cosa de cada clase por tienda (una
cuenta de MP, una cuenta bancaria, un flag), así que "invalidar el anterior" es
correcto. **Con cupones no lo es:** el dueño activa el cupón A, después va y
activa el B, y la invalidación por `(store_id, 'coupon')` **le mata el código de A
sin decirle nada** — y el síntoma es "tipeé el código que me llegó y no funciona",
que es indistinguible de un bug del segundo factor.

Con `subject_id = coupon_id` la invalidación queda scopeada. Para los tres `kind`
existentes queda `null` y el comportamiento no cambia. **Ojo en la query de
invalidación:** es `.is('subject_id', null)`, nunca `.eq('subject_id', null)`.

##### Dónde vive el borrador: híbrido, y por qué ninguna opción pura alcanza

**(a) el cupón entero como `jsonb` en el payload, y se escribe en `coupons` recién
al confirmar.** Uniforme para crear y para modificar. Pero el borrador no existe
como entidad: no se ve ni se edita en el panel, y meter un formulario de nueve
campos en una tabla cuya retención es de **un día** significa que un código
vencido tira el trabajo a la basura.

**(b) el cupón se crea `draft` y el código lo activa.** Simple, y el borrador
queda visible y editable. **Pero no cubre modificar un cupón activo:** los valores
nuevos tienen que esperar en algún lado, y escribirlos en `coupons` para después
"activar" ya cambió el cupón. La única forma de que (b) cubra edición es pausar el
cupón mientras espera el mail, o sea sacar de circulación una promoción viva.

**Recomendado: (b) para crear y activar, (a) para editar un cupón activo.**

| Acción | Dónde espera | ¿Código? |
|---|---|---|
| Crear | `coupons` con `status = 'draft'` | **No.** Un draft no expone nada |
| Editar un draft | En la fila, directo | **No.** Cuantas veces quiera |
| **Activar** (`draft → active`) | `store_pending_changes`, payload `{ couponId }` | **Sí** |
| Editar un activo **aumentando exposición** | `store_pending_changes`, payload = la forma nueva completa | **Sí.** El cupón sigue vivo con los valores viejos hasta confirmar |
| Editar un activo **sin aumentar exposición** | — | **No**, se aplica al instante |
| **Pausar / desactivar** | — | **No.** Ver la asimetría |
| Reactivar (`paused → active`) | `store_pending_changes`, payload `{ couponId }` | **Sí** |
| Borrar un cupón con 0 canjes | — | **No.** Solo quita |

Ése es el reparto que hace que el costo normal sea **un código por cupón** y no
uno por edición.

##### Un `draft` no canjea nunca, y eso es invariante de Postgres

Si un `draft` pudiera canjearse, el código sería decorativo: el cupón funcionaría
antes de confirmarse.

La validación de §5.9.2 ya exige `status = 'active'` **adentro de `create_order`**,
o sea ya en Postgres. Pero `create_order` es *un* camino, y la doctrina del repo
es que una invariante no puede apoyarse en que el único camino conocido siga
siendo el único (es el mismo argumento con el que la tabla de transiciones vive en
TS **y** en un trigger). Entonces, además:

```
private.enforce_coupon_redemption()
  BEFORE INSERT ON public.coupon_redemptions  FOR EACH ROW
```

Levanta si el cupón de esa fila no está `active`, está fuera de su ventana, o ya
alcanzó `max_redemptions`. Aplica a **todos los roles, `service_role` incluido**,
igual que `private.enforce_order_rules`.

##### La asimetría: apagar NUNCA pide código

Requerir el código para **pausar** un cupón es peligroso, y conviene escribir el
escenario completo: un código se filtró —§3.2 documenta el mecanismo, Honey
capturaba códigos al tipearlos y los redistribuía—, está sangrando plata, y el
dueño **no puede apagarlo hasta que llegue un mail**. Un mail que sale por Resend,
que es el recurso escaso de todo este feature, y que puede tardar, caer en spam o
no salir.

El repo ya tiene el principio escrito, para la vista previa de marca: *"el modo
preview solo QUITA capacidad... Un modo que solo resta no es una escalación."*

**El criterio es objetivo**, y es el cálculo de exposición que ya existe en
§5.9.3: un cambio pide código **si y solo si puede aumentar `worstCaseCents`, o
ensanchar quién / cuándo / cómo se canjea.**

**Escala — pide código:** activar o reactivar · subir `percent` o
`amount_off_cents` · subir `max_discount_cents` **o ponerlo en `null`** · subir
`max_redemptions` · subir `max_redemptions_per_phone` **o ponerlo en `null`** ·
bajar `min_subtotal_cents` · estirar `ends_at` **o ponerlo en `null`** · adelantar
`starts_at` · agregar un método de pago **o poner `payment_methods` en `null`** ·
cambiar el `code`.

**No escala — inmediato:** pausar · bajar el porcentaje o el monto · bajar
`max_discount_cents` · bajar `max_redemptions` · subir `min_subtotal_cents` ·
acortar `ends_at` · atrasar `starts_at` · quitar un método de pago · cambiar
`name` (etiqueta interna, invisible para el cliente) · borrar un cupón sin canjes.

Los `null` caen del lado que escala porque `null` significa "sin tope" / "todos
los métodos" / "sin vencimiento": es el valor **más amplio**, no el más chico. Es
el error más fácil de cometer implementando esto.

**Dónde vive el criterio.** `requiresConfirmation(current, next): boolean` en
`src/lib/coupon.ts`, el módulo puro **sin `server-only`**. La misma función corre
en dos lados: en la hoja, para avisarle al dueño **antes** de guardar, y en la
Server Action, que es la autoridad. Es una regla de proceso/permiso, no una
invariante de dominio, así que TS + chequeo en el servidor es el lugar correcto
según el corte de `CLAUDE.md` — y no hay camino de escritura desde el browser que
la esquive, porque `coupons` no tiene un solo grant para `authenticated` (§5.11.2).

⚠️ **Esto contradice la letra de lo que pidió el dueño** ("crear o **modificar**"),
y por eso se preguntó en vez de resolverse por omisión. **Aprobada por el dueño del
producto en la ronda final (2026-08-31)**, textual: *"No apagar se apaga sin
codigo"*. Queda cerrada.

##### El mail: se parametriza la plantilla existente, no hay una nueva

`store-payment-change-code` **ya está parametrizada por `kind`** vía
`CHANGE_LABELS`, que hoy tiene tres entradas. Se agrega la cuarta:

```
coupon: 'un cupón de descuento'
```

Y con eso el código del cupón hereda **gratis** lo que el requisito pide: es la
única de las ocho plantillas que **tira en vez de degradar** cuando falta
`RESEND_API_KEY`, porque *"un segundo factor que se saltea en silencio no es un
segundo factor"*. Ídem `store-payment-change-notice`, el aviso informativo, que sí
degrada.

Cero plantillas nuevas por este requisito, y cero filas en `notifications` (que
exige `order_id`): ese canal ya está fuera del puerto `EmailSender` por el mismo
motivo.

⚠️ **Lo que hay que revisar al implementar:** las dos plantillas están
parametrizadas por `kind`, pero **el copy que las rodea puede estar escrito para
pagos** ("los cobros", "tu cuenta", "quien tenga acceso a tu dinero"). Si lo está,
el arreglo es **generalizar el copy**, no forkear la plantilla. Es una revisión de
texto, no de estructura, y es la clase de cosa que se pasa por alto porque compila.

##### El costo de fricción, dicho en voz alta

Activar un cupón pasa a costar un ida y vuelta por mail, y corregir hacia arriba
uno activo, otro. Cinco cosas lo bajan al mínimo:

1. **El borrador es gratis e ilimitado.** Todo se edita antes de pedir el código,
   así que el flujo normal es **un código por cupón**, no uno por edición. Es la
   razón principal por la que se eligió (b) para crear.
2. **Un solo código por sesión de edición.** El payload lleva la forma nueva
   **completa**, así que cambiar tres campos que escalan cuesta un código, no tres.
3. **La hoja avisa antes.** `requiresConfirmation` corre mientras el dueño tipea:
   al pie dice *"Este cambio se aplica al instante"* o *"Este cambio pide un código
   por mail"*. Nadie descubre el segundo factor después de apretar guardar.
4. **Si el código vence o se agotan los intentos, no queda nada a medias.** El
   pending change se descarta y el cupón conserva sus valores viejos; un draft
   sigue siendo draft. Nunca hay un cupón mitad-modificado.
5. **Apagar no cuesta nada**, que es justo donde la fricción sería peligrosa en
   vez de molesta.

#### 5.11.4 Las RPC nuevas

Todas en `public` (PostgREST solo expone los schemas configurados),
`SECURITY DEFINER`, `set search_path = ''`, y **cada una revoca `EXECUTE` de
`public, anon` y lo otorga explícito** — Postgres le da EXECUTE a PUBLIC por
defecto y una `SECURITY DEFINER` en `public` sin revoke es un endpoint abierto.

| RPC | Rol | Verifica | Por qué no en TS |
|---|---|---|---|
| `store_customer_directory(p_store_id)` | `authenticated` | `is_store_owner()` **en el cuerpo** | PostgREST corta en `max_rows = 1000` **sin error**, y el padrón está ordenado por plata: la truncada esconde justo la cola. Es el motivo por el que existen `store_dashboard` y `platform_stores`. Además deriva `avgTicket` y `daysSince` una vez |
| `campaign_segment_preview(p_store_id, p_kind, p_top_n, p_min_spent)` | `authenticated` | `is_store_owner()` | Los cuatro conteos del preview en una transacción, sobre el mismo snapshot |
| `enqueue_campaign(...)` | **`service_role`** | — (el permiso lo chequeó la acción) | Crear la campaña + congelar N destinatarios + asignar `chunk_index` es una transacción o no es nada |
| `claim_campaign_recipients(p_budget)` | **`service_role`** | — | `for update skip locked` + presupuesto del día. Sin eso dos ticks mandan duplicado |
| `settle_campaign_recipient(...)` | **`service_role`** | — | Cierra la fila y actualiza los contadores de la campaña juntos |
| `create_order` (redefinida) | `service_role` | — | Ya era así |

**La trampa que hay que nombrar, porque el repo ya la pisó una vez.**
`store_customer_directory` y `campaign_segment_preview` verifican
`is_store_owner()` leyendo `auth.uid()`, así que **se llaman con el cliente de
SESIÓN, nunca con el admin client** — con `service_role` no hay `auth.uid()` y
fallan siempre. Es idéntico a `store_couriers`, y `CLAUDE.md` ya lo documenta como
trampa conocida. Las tres de `service_role` son al revés.

**Y el nombre.** La RPC se llama `store_customer_directory`, **no**
`store_customers`, que es el nombre de la tabla. Postgres lo permitiría (distintos
namespaces) pero PostgREST expondría `/rest/v1/store_customers` y
`/rest/v1/rpc/store_customers`, y en un repo que ya tiene `store_couriers` vs.
`store_courier_availability` como par confuso documentado, no hace falta agregar
otro.

#### 5.11.5 Qué es invariante (Postgres) y qué es permiso (RLS/grants)

**Postgres, porque no hay camino que lo esquive:**

- `coupons_within_cap_check` — el tope de usos no se pasa ni para `service_role`
- `unique (order_id)` en `coupon_redemptions` — un cupón por pedido, sin stacking
- FK compuesta `(store_id, coupon_id)` — un cupón de otra tienda no se canjea
- `orders_total_is_subtotal_minus_discount_plus_delivery_check`
- `orders_discount_within_subtotal_check`
- `discount_cents` y `coupon_code_snapshot` en la lista de inmutables de
  `private.enforce_order_rules`
- `coupons_payment_methods_check` — el multi-select no puede quedar vacío
- `coupons_shape_check`, `coupons_code_check`, `unique (store_id, code)`
- `private.sync_store_customer()` — el padrón es una función de los pedidos
- `unique (store_customers.unsubscribe_token)`

**RLS/grants, porque es permiso:** quién lee el padrón (nadie desde el browser:
RPC con `is_store_owner()`), quién escribe un cupón (nadie desde el browser:
`service_role` detrás de `requireStoreMembership(id, { role: 'owner' })`).

### 5.12 Impacto en lo existente

#### 5.12.1 `RESERVED_SLUGS`

Tres valores nuevos, por dos motivos distintos:

| Slug | Por qué |
|---|---|
| `baja` | **Path.** `/baja/[token]` es una ruta de nivel raíz: un local con ese slug queda inalcanzable en path-based, y con subdominios es secuestro de ruta |
| `promos` | **Hostname.** `promos.comandapp.ar` es el remitente de campaña (§5.10.5). Mismo criterio que `mail`, `bounces` y `track`, que ya están |
| `ventas` | **Hostname / identidad de mail.** `ventas@comandapp.ar` es la vía comercial (§5.10.6). La lista ya tiene `soporte`, `support`, `ayuda` y `contacto` por lo mismo |

Van a `RESERVED_SLUGS` en `platform.schema.ts` **y** al CHECK
`stores_slug_not_reserved_check`. Hay test de paridad
(`tests/db/reserved-slugs-parity.test.ts`) que falla si las dos listas se separan
— es una feature, no un obstáculo.

Vale agregar también **`sales`**, por simetría con el par `support`/`soporte` que
ya está: si mañana el mail comercial se llama `sales@`, el slug ya está tomado.

`clientes` y `cupones` **no** hacen falta: viven bajo `/admin/`, que ya está
reservado.

#### 5.12.2 `/baja/[token]`: la ruta pública de baja

Nueva, de nivel raíz, sin auth. Lo único que autoriza es el token — mismo modelo
que `/pedido/[token]`.

- `GET` → una página que dice de qué local es, y un botón "Darme de baja". No da
  de baja con un GET: los escáneres de link de los clientes de mail hacen GET de
  todo, y una baja por prefetch es una baja que el cliente no pidió.
- `POST` (RFC 8058, one-click) → setea `marketing_opt_out_at = now()` y devuelve
  **200 en blanco**, que es lo que el estándar exige.
- Sin tema de marca: es una página de la **plataforma**, igual que `/legal/*`.
- Balde `unsubscribe:ip` (§5.13): es un endpoint público que recibe tokens, o sea
  una superficie de sondeo. Mismo criterio que `lookup:ip`.
- Es idempotente: darse de baja dos veces no cambia nada.

#### 5.12.3 Los textos legales

- **`/legal/privacidad`** — sección nueva "El padrón del local": qué guarda el
  local (nombre, teléfono, mail si lo dejaste, cuántos pedidos hiciste y cuánto
  gastaste, la fecha del último), que es **por local** y no se comparte entre
  locales, que se usa para mandar promos si dejaste mail, y **cómo darse de baja**.
  Además hay que enmendar la sección "Los emails", que hoy dice que el mail se usa
  solo para el comprobante y el aviso de listo.
- **`/legal/terminos`** — sección nueva: un cupón es una oferta **del local**, con
  sus condiciones, su vencimiento y su tope de usos; el local puede pausarlo; la
  plataforma no lo financia ni garantiza que esté disponible.
- **`checkout-form.tsx`** — el aviso al lado del campo de email. Es el punto de
  consentimiento y hoy no existe. Copy cerrado (sin checkbox):
  *"Si dejás tu email, además del comprobante el local puede mandarte promos. Te
  podés dar de baja desde cualquier mail."*

**Los tres NO van en la misma entrega, y no es un detalle de planificación.**

| Texto | Entrega | Por qué |
|---|---|---|
| `/legal/privacidad` | **A** | El padrón existe desde A, y desde A hay una baja que funciona. La página describe el comportamiento real y en A el comportamiento real ya cambió |
| `/legal/terminos` | **A** | Va con el otro legal. Describe una capacidad que llega en B, y eso es a lo sumo **prematuro** |
| El aviso del checkout | **B** | Es un **consentimiento**, no una descripción. Decirle a un cliente en A *"el local puede mandarte promos"* cuando no existe forma de mandar una promo es **decirle algo falso**, y encima le pide algo a cambio de nada |

Ésa es la asimetría que decide el corte: un texto legal adelantado es prematuro; un
aviso de consentimiento adelantado es una afirmación falsa a un cliente.

#### 5.12.4 La nav y el shell

Un ítem nuevo en `NAV_ITEMS` de `src/views/admin/shell.tsx` (§5.6). El comentario
del archivo que dice "siete secciones" ya estaba desactualizado (son ocho) y pasa a
nueve: hay que corregirlo, no dejarlo mintiendo.

#### 5.12.5 `cleanup_old_records`

Se re-declara **completa** (`create or replace` reemplaza el cuerpo entero:
mantener los cuatro borrados que ya tiene **no es opcional**) y se le agrega uno:
`campaign_recipients` con `sent_at < now() - interval '90 days'`, o
`status = 'skipped'` y `created_at` viejo.

**El padrón NO se purga.** `store_customers` es el registro comercial del local, no
log. Y borrar una fila **pierde la baja**, que es lo peor que puede pasar: el
cliente se dio de baja, la fila se borra por retención, vuelve a comprar, la fila
se recrea sin la baja, y le llega una promo que había rechazado.

**Y `coupon_redemptions` tampoco se purga**: es el libro mayor de descuentos, con
las filas `released` incluidas (§5.7.2). Es contabilidad, no log.

#### 5.12.5.1 La limitación aceptada: hoy no hay camino para borrar un cliente

Se evaluó y se descartó una lista de supresión por hash del teléfono —que
permitiría borrar la fila y conservar la baja— por el mismo criterio de siempre:
es un mecanismo nuevo, con su propia tabla y su propio HMAC, para un caso que
todavía no ocurrió. **La decisión del dueño es no construirla.** Pero se escribe
como decisión informada, no como omisión, porque tiene un costo real:

- **La fila queda con nombre, teléfono, mail y plata gastada por tiempo
  indefinido**, mientras el local use la plataforma. No hay retención, no hay
  vencimiento, no hay un cron que la toque.
- **No hay camino de producto para atender un pedido de supresión de datos.** El
  canal que `/legal/privacidad` ya ofrece —escribir al mail de contacto, en el
  marco de la Ley 25.326— sigue siendo verdadero, pero se atiende **a mano, por
  SQL, por el operador de la plataforma**. No hay UI, ni para el dueño del local ni
  para el cliente.
- **Y atenderlo tiene un efecto lateral que hay que conocer antes de ejecutarlo:**
  borrar la fila **borra la baja con ella**. Si ese cliente vuelve a comprar, la
  fila se recrea desde el trigger, sin `marketing_opt_out_at`, y vuelve a ser
  destinatario de campañas. O sea que el borrado no es una operación limpia: es una
  que **puede** terminar en un mail que la persona ya había rechazado. Quien lo
  ejecute tiene que anotar la baja en algún lado, y hoy ese "algún lado" no existe
  en el producto.

**Lo que esto obliga en el texto: `/legal/privacidad` no puede prometer un borrado
que el producto no tiene.** La sección de derechos que ya existe se mantiene (es un
canal manual y es cierto), **no se agrega nada que suene a autoservicio**, y la
retención se describe con honestidad: *"mientras el local use la plataforma"*. Sin
plazos inventados.

### 5.13 Rate limiting

Baldes nuevos en `src/lib/rate-limit-policy.ts` (y en `RateLimitBucket` de
`types.ts`):

| Balde | Límite | `onError` | Por qué |
|---|---|---|---|
| `coupon_create:store` | 20 / 1h | **fail-open** | Crear un cupón necesita Postgres de todos modos: si la base no responde, negar no protege nada y sí frena a un dueño legítimo. Es el default del repo |
| `coupon_change:store` | 10 / 1h | **fail-closed** (`'deny'`) | El código de 6 dígitos (§5.11.3). Ver abajo |
| `coupon_change:store:day` | 20 / 24h | **fail-closed** | Idem, ventana larga |
| `campaign_send:store` | 3 / 24h | **fail-closed** (`'deny'`) | Es el balde que gasta la cuota compartida de mail y habla en nombre de la marca a clientes reales. Mismo criterio que `magic_link:*`: **Resend es un servicio aparte que sigue funcionando con nuestra base caída**, así que fail-open acá puede quemar el presupuesto del día y la reputación con él. Y no se pierde nada de valor haciendo que el dueño reintente en un minuto |
| `campaign_quota:store` | 1 / 2min | fail-open | El pedido de ampliación de cupo (§5.10.6). Números calcados de `support:store` |
| `campaign_quota:store:day` | 5 / 24h | fail-open | Idem `support:store:day`, más ajustado (10 → 5): pedir más volumen cinco veces en un día ya es mucho |
| `unsubscribe:ip` | 30 / 1h | fail-open | `/baja/[token]` es público y recibe tokens: superficie de sondeo. Laxo por el CGNAT móvil, mismo criterio que `receipt:ip` |
| `coupon_check:ip` | 30 / 10min | **fail-open** | Se consume **solo cuando el código NO EXISTE**, no en cada cotización. Ver abajo |

**Los dos baldes del código de 6 dígitos.** `payment_change:store` es 3/1h y
fail-closed, y ése es el número para una credencial de cobro. Un cupón no es eso:
**crear cupones es trabajo normal**, y un tope de 3/hora haría inusable una tarde
de armar promociones. De ahí 10/1h.

Pero van **fail-closed igual**, y no por la plata: **porque son un segundo
factor**, y el criterio de `CLAUDE.md` para fail-closed es que el balde proteja
algo que sigue funcionando con la base caída. Acá aplica textualmente: **Supabase
Auth y Resend son servicios aparte**, así que con Postgres caído el mail del código
puede seguir saliendo, y un balde fail-open se convierte en un generador ilimitado
de mails de segundo factor contra la cuota de 100/día. El balde diario (20/24h)
existe por lo mismo: 10/hora × 24 son 240 mails teóricos, muy por encima de lo que
el cupo tolera.

Con la ergonomía de §5.11.3 —el borrador es gratis, un código por cupón— 10/1h y
20/24h no se tocan en uso normal. **El reenvío de código
(`resendPendingChangeCodeAction`) consume estos mismos baldes**, que es donde un
tope por hora realmente hace falta.

**El balde que cambia una decisión ya tomada, y por eso se explica entero.** Hoy
`GET /api/orders` **no tiene límite de aplicación a propósito**: dispara con cada
cambio de carrito, y un round trip extra a Postgres por tecla es exactamente lo
que no se quiere. `CLAUDE.md` lo deja explícito: *"El catálogo y la cotización no
tienen límite de aplicación a propósito: eso es trabajo del WAF."*

**El cupón rompe ese razonamiento**, porque agrega a esa misma request una
pregunta de sí-o-no sobre un secreto: *"¿existe el código XXXX?"*. Sin límite, la
cotización es un oráculo con el que se camina el espacio de códigos a la velocidad
de la red — y la guía de fraude de Stripe nombra el control con esas palabras:
*"rate-limit the promo-code validation endpoint"* (§3.2).

**El balde se consume SOLO cuando el código NO EXISTE.** No en cada cotización con
cupón: solo cuando la respuesta es "ese código no existe". Es una condición más
fina que la de la primera versión de este documento, y hay que explicar por qué,
porque la versión anterior tenía un bug de producto.

**Lo que estaba mal.** La cotización **no tiene debounce**: el `useEffect` de
`src/views/storefront/use-priced-cart.ts:99-178` dispara con cada cambio de
`lines` y lo único que hace es cancelar la anterior con `AbortController` — el
comentario de `src/app/api/orders/route.ts:30-32` lo dice explícito. Entonces, con
el balde consumiéndose en cada cotización que trae cupón, **un cliente con el cupón
aplicado gasta un token por cada toque al `+`**, y a los treinta toques queda
rate-limiteado **de su propio checkout**. Y con CGNAT móvil varios clientes reales
comparten IP de salida — el mismo argumento con el que `unsubscribe:ip` y
`receipt:ip` son laxos.

**Cobrar solo el fallo ataca el sondeo y le sale gratis al cliente legítimo.** La
enumeración *es* preguntar por códigos que no existen: es la única señal que el
atacante necesita y la única que el cliente honesto no produce. Un cupón válido
—incluso vencido o pausado, que son códigos reales que alguien pudo recibir de un
amigo— no consume nada.

**El límite queda holgado igual (30 / 10 min)**, y no por prudencia genérica: quien
tipea mal su propio código gasta tokens de verdad, y el cliente que se equivoca tres
veces en el mostrador no puede quedar sin poder comprar. Con solo los fallos
contando, 30 es mucho para un humano y poco para un script.

**Fail-open**, con el criterio del repo: fail-closed se reserva para baldes que
protegen algo que sigue funcionando con la base caída (los `magic_link:*`, porque
Auth es un servicio aparte) o que tocan plata y credenciales
(`payment_change:store`, `bank_account_change:store`). Este balde no es ninguna de
las dos: **si Postgres no responde, la cotización entera no funciona** —`priceCart`
lee de Postgres— así que negar no protege nada, y el falso positivo le cae a
alguien que está por comprar. Es el mismo razonamiento, palabra por palabra, que
`receipt:ip` y `receipt:order`.

**Cómo queda acotada la excepción, para el que lea la regla y encuentre el
balde.** `CLAUDE.md` dice, textual: *"El catálogo y la cotización no tienen límite
de aplicación a propósito: eso es trabajo del WAF."* Eso **sigue siendo cierto**,
y el balde no lo contradice, porque la condición es dura y verificable: **se
consume si y solo si la request trae `couponCode`**. Una cotización de carrito
—que es la que dispara con cada tecla y la que la regla protege— no toca Postgres
para rate limiting ni una vez. Lo que se limita no es la cotización: es la
pregunta sobre un secreto que el cupón agregó a la misma request. Cuando esta
excepción suba a `CLAUDE.md`, tiene que subir con la condición, no sin ella.

**Lo que deliberadamente NO agrego: un balde global de campañas** al estilo
`magic_link:global`. El presupuesto diario ya vive en Postgres, se cuenta adentro
de `claim_campaign_recipients` en la misma transacción que reclama, y es atómico.
Un segundo mecanismo para el mismo trabajo son dos números que se pueden
desincronizar.

### 5.14 Trazabilidad bidireccional: del pedido al cupón y del cupón al pedido

Requisito del dueño: *"en pedidos debería poder verse el cupón aplicado a la
compra, y desde los cupones ver la compra que lo usó"*.

**Un cupón por pedido: sí, decidido**, y garantizado por `unique (order_id)` en
`coupon_redemptions` (§5.7.2). La investigación lo respalda: Shopify corrió una
década con un código por pedido, y Toast y Square siguen ahí.

#### 5.14.1 Las dos direcciones NO usan el mismo mecanismo, y es a propósito

**Pedido → cupón: las columnas congeladas en `orders`. Sin join.**

`orders.coupon_code_snapshot` y `orders.discount_cents` (§5.8.1) son la respuesta
completa. Tres razones, y la tercera es la que decide:

1. **Sobreviven a la edición del cupón.** Un pedido de hace dos meses tiene que
   seguir diciendo qué código se usó y cuánta plata descontó, aunque el dueño
   después haya cambiado el porcentaje, renombrado el código o pausado el cupón.
   Es el mismo criterio con el que el ETA ya se congela (`base_prep_minutes`,
   `demand_multiplier`, `eta_minutes`) y con el que `order_items.name_snapshot`
   guarda el nombre del producto: **el dato histórico no puede depender de una
   fila que alguien puede editar.**
2. Son inmutables en `private.enforce_order_rules`, así que nadie los reescribe.
3. **Y la razón técnica que cierra el tema: `getOrderHistory` y
   `getScheduledOrders` leen con el cliente de SESIÓN** (`createClient()`), o sea
   respetando grants. `coupon_redemptions` **no tiene grant para
   `authenticated`** (§5.11.2), así que un embed de PostgREST desde `orders` hacia
   la tabla de canjes **fallaría con `42501`** en la pantalla de Pedidos. Cambiar
   eso significaría abrir un grant sobre el libro mayor de descuentos para que el
   browser del staff pueda leerlo — exactamente la pregunta que la doctrina de
   grants obliga a contestar con un "no".

**Cupón → pedidos: `coupon_redemptions`, por RPC.** Es la tabla de canjes, con
`coupon_id`, `order_id`, `discount_cents` y `created_at`. La FK al cupón vive
**acá**, y es la que permite navegar.

#### 5.14.2 Por qué NO hay `orders.coupon_id`

Sería la tercera copia de la misma arista. `coupon_redemptions` con
`unique (order_id)` **ya es** funcionalmente una FK 1:1 opcional desde `orders`,
y además registra el monto y el momento del canje, que una columna no registra.

Agregar `orders.coupon_id` costaría, concretamente: una columna más que enumerar
en `create_order`, una más en la lista de inmutables del trigger, una más que
considerar en el régimen de grants por columna de `orders`, y una segunda fuente
de verdad que puede discrepar con la tabla de canjes. A cambio de una navegación
que la pantalla operativa **no necesita**, porque lee el snapshot.

**Dónde sí se navega del pedido al cupón:** en el detalle del cupón, al revés
(§5.14.4), y eso ya funciona. Si algún día hace falta ir de un pedido puntual a la
ficha del cupón, la RPC de lectura del pedido puede resolver el `coupon_id` desde
`coupon_redemptions` con el admin client — un round trip en una pantalla de
detalle, no en un listado de 200 filas.

#### 5.14.3 La trampa de enumerar, que acá es DOBLE

Toda columna nueva de pedido hay que agregarla en `create_order`, **y además en
todo lo que lee el pedido para mostrarlo**. Una columna que falta en la lectura
desaparece **sin ningún error**. Verificado en el código, los cinco lugares:

| Lugar | Cómo enumera | Qué hacer |
|---|---|---|
| `ORDER_WITH_ITEMS_SELECT` / `..._AND_STORE_SELECT` (`order.model.ts:259`) | Empiezan con **`'*'`** | **Nada.** Las dos columnas nuevas llegan solas. Es la única buena noticia de esta tabla |
| `toOrder()` (`order.model.ts:125`) | **Campo por campo, a mano** | Mapear `discountCents` y `couponCodeSnapshot`. **Si falta, el dato existe en la fila y nunca llega a la vista** |
| `Order` en `types.ts:468` | Enumerado | Dos campos nuevos |
| `OrderPublicView` (`types.ts:580`) | **`Pick<Order, ...>` enumerado a mano** | Agregar `'discountCents'` y `'couponCodeSnapshot'` al `Pick`. Sin esto el cliente no ve su propio descuento (§5.14.4) |
| `toOrderPublicView()` (`order.model.ts:206`) | Enumerado | Idem |

Más, en Postgres: `create_order` (inserta), `store_dashboard` (suma
`discountCents`), `courier_queue` (una clave más). `platform_stores` no se toca
(§2.3, §5.8.3).

#### 5.14.4 Las superficies

**1. En el pedido — dentro del desglose de importes que ya existe.** No hay
tarjeta nueva ni panel nuevo para un dato de una línea (y una tarjeta anidada
estaría prohibida por el piso de calidad). La línea aparece **solo si
`discountCents > 0`**, entre subtotal y envío, con el código como etiqueta:

```
Subtotal                    $ 12.400
Descuento  BIENVENIDO       −$ 1.860
Envío                       $  1.500
────────────────────────────────────
Total                       $ 12.040
```

El signo menos y el código en la misma línea. `.tabular` para las cifras, como
todo importe del producto. Va en:
- `views/admin/pedidos/history-list.tsx` (el desglose de la fila expandida).
- **El KDS** (`views/admin/kds/`): **sí**, y no es opcional. Un pedido `in_store`
  se cobra en el mostrador, y quien cobra tiene que ver **por qué** el total no
  es el subtotal. Sin eso, el encargado cobra el total correcto y no puede
  explicarlo, que es media regresión al flujo que vinimos a reemplazar.
- `courier_queue` → el portal del repartidor, por lo mismo: cobra en la puerta.

**2. En el cupón — los canjes, con link al pedido.** En la hoja de detalle del
cupón:
- **Los últimos 20 canjes**, cada uno con `short_code` (link a
  `/admin/pedidos?...`), fecha, cliente y cuánto descontó.
- Y **arriba, los agregados** (§5.14.5), que son la respuesta real a "¿sirvió?".

**Ni paginación completa ni contar filas en el cliente**, y el motivo es el de
siempre: **PostgREST corta en `max_rows = 1000` sin error**. Un cupón de 1.500
canjes leído como tabla mostraría 1.000 y diría "1.000 canjes" con total
convicción. Por eso los conteos salen de la RPC (que agrega en Postgres) y la
lista es explícitamente "los últimos 20", con el número real al lado:
*"7 de 43 canjes"*. Paginación completa es scope de una segunda etapa; el dueño de
un local no audita 1.500 canjes de a 20 en una hoja.

**3. El cliente ve su descuento: SÍ, en los dos lugares.** No es discutible:
**el descuento cambia el total que el cliente pagó, así que un comprobante que no
lo nombra es un comprobante que no cierra.** Alguien que ve "Total $12.040" con
ítems que suman $12.400 y un envío de $1.500 tiene razón en desconfiar.

- **`order-receipt`** (y `order-ready` no, que no lleva importes): `EmailVars`
  suma `discountCents` y `couponCode`, y la plantilla agrega la línea al mismo
  desglose. Es un cambio en `email.port.ts` + `order-receipt.tsx`.
- **`/pedido/[token]`** (`views/storefront/order-tracking.tsx`): la misma línea en
  el resumen, vía `OrderPublicView`.
- **`checkout-form.tsx`**: la línea aparece en el resumen antes de pagar, y
  cuando el cupón pasa a `rejected` queda **tachada con el motivo al lado**
  (§5.9.4), nunca desaparece en silencio.

#### 5.14.5 Lo que la traza habilita: las métricas del cupón

Con los canjes trazados, tres agregados salen casi gratis de la misma RPC que ya
lee `coupon_redemptions`, y son lo único que le dice al dueño si la promoción
sirvió:

| Métrica | Cómo |
|---|---|
| **Canjes** | `count(*)` de `coupon_redemptions` **con `status = 'redeemed'`**. Sirve además para verificar que `redeemed_count` no se desincronizó del libro mayor |
| **Descontado** | `sum(discount_cents)` **de los `redeemed`** — lo que el local regaló de verdad |
| **Facturación generada** | `sum(o.total_cents)` de los pedidos `redeemed` que además son facturables (el predicado de §5.4) — lo que el local cobró gracias al cupón |

**Las tres cuentan SOLO `redeemed`**, nunca `reserved`. "Facturación generada" sobre
un pedido reservado que todavía puede morir es un número falso, y es el número con
el que el dueño va a decidir si repite la promoción. Los reservados se muestran
aparte (§5.7.2.4), donde se entiende qué son.

Tres números en una línea de texto arriba de la lista de canjes:
*"43 canjes · $64.000 descontados · $312.000 facturados"*. Nada de tarjetas de
métrica ni de la plantilla de métrica-héroe.

**Van en la Entrega B, no en una segunda etapa.** Son tres agregados en una RPC
que de todos modos hay que escribir para listar los canjes, y sin ellos el feature
no puede contestar la única pregunta que justifica haberlo construido. Lo que **sí**
queda para después: comparar contra un período sin cupón, medir clientes nuevos vs.
recurrentes, y atribución por campaña. Eso es analítica de verdad y necesita datos
que hoy no existen.

#### 5.14.6 Un cupón con canjes NO se borra

Misma doctrina que los repartidores (`courier_id` es `ON DELETE SET NULL`
justamente para no perder el rastro contable de quién entregó qué):

- `coupon_redemptions.coupon_id` es **`ON DELETE RESTRICT`**. Un `DELETE` sobre un
  cupón canjeado **falla en la base** con `23503`. No es una convención de la UI:
  es la base la que no lo permite, para `service_role` incluido.
- El panel ofrece **"Pausar"** (`status = 'paused'`: deja de canjearse, sigue
  visible, sigue reportando) y nada más, en cuanto el cupón tiene **cualquier** fila
  en el libro mayor.
- **Un cupón sin ninguna fila en el libro mayor SÍ se puede borrar.** Es el caso
  real de un borrador con el código mal tipeado. La condición es
  **`reserved_count === 0 && redeemed_count === 0` y además cero filas
  `released`** — o sea, que nunca nadie lo haya tocado. **Los `released` cuentan
  para prohibir el borrado**, aunque no ocupen cupo: son el rastro de que el cupón
  estuvo en la calle, y borrarlo destruye la explicación de por qué un pedido
  cancelado tenía un descuento. El `RESTRICT` de la FK ya lo hace imposible en la
  base (mira las filas, no los contadores); la condición en TS es para que el botón
  no se ofrezca, y el `DomainError` para cuando alguien lo llama igual:
  *"Este cupón ya se usó: se puede pausar, no borrar."*
- **Y si se borrara igual (no se puede, pero por si alguien afloja el
  `RESTRICT`):** los pedidos que lo usaron **no pierden nada**, porque el código y
  el monto están congelados en `orders` (§5.14.1). Lo único que se perdería es la
  navegación cupón → pedidos. Ése es precisamente el punto de haber denormalizado.

### 5.15 Mapa de componentes

```
POSTGRES  (hilo principal, dos migraciones)
├── store_customers                     tabla + índices + trigger + backfill
├── private.sync_store_customer()       el padrón como función de los pedidos
├── store_customer_directory()          RPC, authenticated, is_store_owner()
├── coupons / coupon_redemptions        tablas + CHECKs + FK compuesta
│                                       DOS contadores; libro mayor de 3 estados
├── private.sync_coupon_counters()      recalcula desde el libro mayor (§5.7.2.1)
├── private.sync_coupon_reservation()   confirma en delivered, libera en
│                                       cancelled sin paid_at (§5.7.2.3)
├── coupon_campaigns / campaign_recipients
├── orders.discount_cents, .coupon_code_snapshot
├── CHECK del total (drop + add)        §5.8.2
├── enforce_order_rules                 + dos columnas inmutables
├── create_order                        + descuento + consumo atómico
├── store_dashboard                     + discountCents
├── courier_queue                       + discountCents
├── campaign_segment_preview() / enqueue_campaign()
├── claim_campaign_recipients() / settle_campaign_recipient()
├── coupon_detail()                     RPC: los 3 agregados + últimos 20 canjes
├── private.enforce_coupon_redemption() un draft no canjea NUNCA (§5.11.3)
├── store_pending_changes               kind += 'coupon'; columna subject_id;
│                                       el índice live SE DROPEA Y SE RECREA
├── cleanup_old_records                 + campaign_recipients
├── stores_slug_not_reserved_check       + 'baja' (A) + 'promos','ventas','sales' (B)
└── cron.schedule('app-campaigns', ...)

MODELS
├── customer.model.ts        getCustomerDirectory, updateCustomerNotes,
│                           setCustomerOptOut, findCustomerByUnsubscribeToken
├── coupon.model.ts          listCoupons, getCouponDetail, createCoupon,
│                           updateCoupon, setCouponStatus, deleteUnusedCoupon,
│                           validateCouponForCart
├── campaign.model.ts        previewSegment, enqueueCampaign, listCampaigns,
│                           claimCampaignRecipients, settleCampaignRecipient
├── order.model.ts           priceCart + descuento; createOrder pasa couponCode;
│                           **toOrder() y toOrderPublicView() mapean las dos
│                           columnas nuevas** (§5.14.3 — si falta, desaparece
│                           sin error)
├── schemas/customer.schema.ts, schemas/coupon.schema.ts
└── types.ts                 §5.1 (+ Order, OrderPublicView, PricedCart)

CONTROLLERS
├── customers.controller.ts  server-only. Lecturas de /admin/clientes
├── marketing.actions.ts     'use server'. Cupones y campañas (owner)
├── unsubscribe.actions.ts   'use server'. La baja pública, sin auth
└── checkout.controller.ts   priceCartForStore lleva el cupón; sendReceiptEmail
                             pasa discountCents/couponCode

SERVICES
├── emails/store-coupon-campaign.tsx    la novena plantilla
├── emails/store-campaign-quota-request.tsx  la décima (§5.10.6)
├── emails/order-receipt.tsx            + la línea de descuento (§5.14.4)
├── notifications/email/email.port.ts   EmailVars + discountCents, couponCode
├── notifications/email/payment-change.tsx   CHANGE_LABELS += coupon (§5.11.3).
│                                       NO hay plantilla nueva de código
└── notifications/email/campaign.tsx    batch + idempotencia + headers de baja
                                        + remitente de promos con fallback

VIEWS
├── admin/clientes/                     directory-table, customer-sheet
├── admin/clientes/cupones/             coupon-list, coupon-sheet, campaign-log,
│                                       campaign-sheet, payment-method-checks,
│                                       redemption-list
├── admin/pedidos/history-list.tsx      la línea de descuento en el desglose
├── admin/kds/                          idem: quien cobra tiene que poder explicarlo
├── courier/                            idem: cobra en la puerta
├── storefront/checkout-form.tsx        el campo de cupón, la línea del resumen,
│                                       y el aviso de promos del email (Entrega B)
├── storefront/order-tracking.tsx       la línea de descuento
└── unsubscribe/                        la página de baja

APP
├── admin/(app)/clientes/{layout,page}.tsx
├── admin/(app)/clientes/cupones/page.tsx
├── baja/[token]/page.tsx
└── api/cron/campaigns/route.ts

LIB
├── cart.tsx                 envelope v:2 con couponCode; discardIdempotencyKey()
│                           en aplicar / cambiar / quitar cupón (§5.9.1)
├── whatsapp.ts              SIN CAMBIOS: whatsappHref(phone, text?) ya acepta
│                           el texto precargado (§5.5.1)
├── money.ts                 percentOfCentsDown()
├── rate-limit-policy.ts     ocho baldes (§5.13)
├── env.server.ts            RESEND_CAMPAIGN_FROM_EMAIL, SALES_EMAIL (opcionales)
└── coupon.ts                módulo PURO sin server-only: couponState(),
                             describeDiscount(), worstCaseCents(),
                             requiresConfirmation(), campaignDaysNeeded().
                             Sin server-only a propósito, igual que delivery.ts:
                             la misma función que muestra el peor caso en el
                             formulario es la que describe el cupón en el mail,
                             y la que le avisa si el cambio va a pedir código.
```

---

## 6. Cuestiones transversales

### 6.1 Aislamiento multi-tienda

Cinco tablas nuevas, `store_id` en las cinco, y el aislamiento cerrado en tres
capas independientes:

1. **Grants**: `authenticated` no tiene acceso a ninguna. No hay PostgREST que
   sondear.
2. **RPC**: las de lectura verifican `is_store_owner(p_store_id)` en el cuerpo. Una
   `SECURITY DEFINER` sin ese chequeo es un lector del padrón del competidor
   pasando otro id.
3. **FK compuesta** `(store_id, coupon_id)` en `coupon_redemptions`: un cupón de
   otra tienda no se canjea ni con `service_role`.

Y en el código: toda escritura con admin client lleva `requireStoreMembership` y
`.eq('store_id', storeId)` **explícito** — el mismo criterio que la asignación de
repartidor documenta ("el trigger valida que el repartidor sea de la tienda, pero
no que el **pedido** lo sea").

El padrón es **por tienda**. La misma persona en dos locales son dos filas, dos
tokens de baja y dos opt-outs independientes. Una baja en un local no silencia al
otro, y ésa es la razón número dos de §5.10.1.

### 6.2 Autoridad del precio

El cliente manda el **código**. Nunca el descuento, nunca el total.
`createOrderSchema` sigue siendo `.strict()`, así que un `discountCents` que llegue
es un 400 que lo nombra.

El descuento se calcula **dos veces**: en la cotización (para mostrar) y adentro de
la transacción de `create_order` (para cobrar). El número de la primera **no viaja
a la segunda**. Es el mismo patrón que el costo de envío, que ya funciona así.

Y hay tres redes por debajo: el chequeo de coherencia del paso 3.4 de §5.9.2, el
CHECK del total, y el CHECK de `discount ≤ subtotal`.

### 6.3 Datos personales

El feature crea el dataset más sensible del producto y le manda publicidad. Lo que
lo hace defendible:

- **Baja de un click, en cada mail**, con `List-Unsubscribe` +
  `List-Unsubscribe-Post` (Resend no los pone en `/emails`) y efecto inmediato: el
  drenaje re-chequea la baja antes de cada batch.
- **La baja vive en NUESTRA base, nunca en la lista de supresión de Resend.** Es la
  trampa del §3.4: la supresión de Resend es de cuenta y **también aplica a
  `/emails`**, así que suprimir a alguien que se dio de baja de las promos lo
  dejaría **sin comprobante de su pedido y sin el aviso de "pedido listo"**, en
  silencio. Nadie toca `add-suppression` desde este feature.
- **Solo el `owner` ve el padrón** (§5.11.1).
- **El padrón no se purga**, porque purgarlo pierde la baja (§5.12.5).
- **Los tres textos legales se actualizan en el mismo slice**, no después
  (§5.12.3).
- El mensaje libre del dueño va adentro de una plantilla TSX de react-email, que
  escapa el contenido: no es una superficie de inyección de HTML en el mail.

### 6.4 Modos de falla y rollback

| Falla | Qué pasa | Recuperación |
|---|---|---|
| Resend caído / sin key | La campaña queda `failed` con el motivo. **Ningún pedido se rompe** | El dueño reintenta. Los `queued` los toma el próximo tick |
| Batch rechazado (una dirección mala) | El chunk entero suma `attempts`; a los 3 pasa a `failed` | Las direcciones se validan al encolar, así que esto es raro |
| Cron no corre (pg_cron caído, Vault sin cargar) | La campaña queda `queued` para siempre, **visible en el panel como "pendiente"** | Igual que los otros cuatro crons. `net._http_response`, no los logs de la app |
| Cupo diario agotado | El drenaje no manda más hoy. El panel muestra el avance y la fecha estimada | Automático mañana |
| Trigger del padrón con bug | El padrón queda torcido; **los pedidos no se tocan** (el trigger es `AFTER`, y un error ahí sí abortaría el insert — ver abajo) | El backfill de §5.3.3 es idempotente: se vuelve a correr |
| Cupón mal calculado | El CHECK del total rebota con `23514`. **El pedido no se crea** | Se ve en el primer pedido de prueba, que es el punto |
| Carrera del último uso | La segunda espera en el `for update` y recibe "Ese cupón ya se agotó." | Ninguna. Es el comportamiento correcto |
| **El cupón vence a mitad de campaña** | La campaña pasa a `stopped` con `stopped_reason`; los que faltan quedan `skipped`. **No se manda un código muerto** | El bloqueo previo de §5.10.3.1 hace que esto solo pase si el dueño pausó el cupón o si se agotó porque funcionó |
| **Un pedido con cupón queda abandonado** | La reserva ocupa cupo hasta que `expire_pending_orders` lo cancela (45 min); ahí el trigger la **libera** | Automática. Nadie interviene |
| **Un pedido con cupón se cancela después de pagado** | La reserva **NO se libera** (§5.7.2.3): hubo plata. El camino es el reembolso | Ninguna, es el comportamiento correcto |
| **Un pedido pagado nunca llega a `delivered`** | La reserva queda `reserved` para siempre: **ocupa cupo y no se libera** (el predicado exige `paid_at is null`) | Es correcto — el cupón está comprometido con ese pedido. Se ve en el panel como "reservados" |
| **Error en `sync_coupon_reservation`** | **Aborta la transición de estado del pedido**, igual que el trigger del padrón | Por eso el cuerpo no llama nada externo y solo hace un `update` sobre una fila que la FK garantiza |
| **Contadores desincronizados del libro mayor** | Imposible por construcción: se recalculan desde el libro mayor, no se incrementan (§5.7.2.1) | El test compara `count(*)` contra los contadores |
| **DoS sobre la promo** (reservas que ocupan cupo sin pagarse) | El cupón dice "agotado" a clientes reales hasta que el barrido libera | Acotado por `max_redemptions_per_phone` (default 1) y `order:phone`: hacen falta 50 teléfonos (§5.9.3) |
| **No llega el mail del código de 6 dígitos** | La acción **tira** con un `DomainError` legible (herencia de `store-payment-change-code`). El cupón queda `draft` o con sus valores viejos: **nada a medias** | Reenviar el código, que consume `coupon_change:*` |
| **Se agotan los 5 intentos del código** | `claim_store_pending_change` devuelve cero filas. Los tres casos (vencido, consumido, sin intentos) son indistinguibles a propósito | Pedir el cambio de nuevo. El cupón nunca cambió |
| **Falta `RESEND_CAMPAIGN_FROM_EMAIL`** | La campaña sale desde el dominio de siempre, con `log.warn` | Cargar la variable (§7.4). No bloquea |
| **Falta `SALES_EMAIL`** | El pedido de cupo no sale; el panel muestra la dirección para escribir a mano | Cargar la variable |

**Un riesgo del trigger que hay que nombrar:** un `AFTER INSERT` que tira **aborta
la transacción del pedido**. O sea que un bug en `sync_store_customer` deja de
poder crear pedidos. Mitigación obligatoria: el cuerpo del trigger es un
`insert ... on conflict do update` sobre datos que ya están validados por los
CHECK de `orders`, sin llamadas a nada externo, y **el `store_customers.display_name`
sale de `coalesce(o.customer_name, '')`** para que un nombre nulo (imposible hoy,
pero) no dispare un `not null` violation en cascada. Hay que probarlo en
`tests/db/` con un pedido normal y con un pedido de un teléfono nuevo.

**Rollback.** Las dos migraciones son aditivas menos el swap del CHECK del total.
Revertir la Entrega B significa: volver el CHECK viejo (posible solo si
`discount_cents = 0` en todas las filas — o sea, solo si nadie usó un cupón), y
volver `create_order` a la definición anterior. Si ya hay cupones canjeados, el
rollback del CHECK **no es posible sin perder datos**, y lo correcto es dejar las
columnas y apagar la feature desde el panel (todos los cupones a `paused`). Eso es
un rollback funcional sin migración, y hay que decirlo antes de necesitarlo.

### 6.5 Cache y revalidación

`/admin/clientes` y `/admin/clientes/cupones` son Server Components que leen por
RPC en cada request: no hay cache que invalidar. Las acciones que escriben llaman
`revalidatePath('/admin/clientes')` (y `/cupones`), igual que el resto de `/admin`.

Un cupón nuevo o pausado **no necesita revalidar la vitrina**: el cupón no se
muestra en el catálogo, se tipea en el checkout, y el checkout cotiza contra el
servidor en cada cambio. Nada que invalidar del lado del cliente.

### 6.6 Observabilidad

- `log.warn` cuando un balde de campaña se pasa, con `storeId`.
- `log.error` en cada fallo de batch, con `campaignId`, `chunkIndex` y el mensaje
  de Resend — **nunca el body completo de la respuesta**, misma regla que
  `resend.adapter.tsx`.
- El estado de la campaña es visible en el panel del dueño. No hace falta mirar
  logs para saber si salió.
- `log.warn` cuando la campaña pasa a `stopped`, con `campaignId`, `couponId` y
  `stopped_reason`. Es el único final que el dueño no eligió explícitamente.
- Contador diario consumido: expuesto en el panel de campañas
  (*"Hoy quedan 9 de 15 mails de campaña"*). Con el cupo en 15 esto pasa de ser
  informativo a ser **necesario**: es lo que explica por qué una campaña a 142
  personas tarda diez días, y es donde aparece la oferta comercial de §5.10.6.
- **`GET /usage` de Resend** (`resend.usage.get()`) devuelve el cupo real de la
  cuenta (`emails.daily/monthly {used, limit, resets_at}`). Con el presupuesto en
  15 sobre un techo de 100, la constante ya no está pegada al límite de la cuenta,
  así que llamarlo es menos urgente que antes — pero sigue siendo la forma de
  detectar que el mail transaccional se está comiendo el cupo. Mejora, no
  bloqueante.

---

## 7. Seguridad de la migración, y el corte en dos entregas

### 7.1 Dos entregas, y el orden importa

**Entrega A — Clientes.** `store_customers`, el trigger, el backfill, la RPC del
padrón, `/admin/clientes` con el **WhatsApp precargado** (§5.5.1), `/baja/[token]`,
`'baja'` en `RESERVED_SLUGS`, y **los dos textos legales** (privacidad y términos).

**El aviso de promos del checkout NO va en A** (§5.12.3): es un consentimiento, y
en A no existe forma de mandar una promo. Va en B. Consecuencia práctica del corte:
**`checkout-form.tsx` no lo toca ningún slice de A**, así que A y B no comparten un
solo archivo.

**Entrega B — Cupones y campañas.** Todo lo demás:

- Las cinco tablas de cupón/campaña, el CHECK del total, `create_order`.
- **El modelo de reserva completo** (§5.7.2): el libro mayor de tres estados, los
  dos contadores, y los tres triggers (`enforce_coupon_redemption`,
  `sync_coupon_counters`, `sync_coupon_reservation`).
- **El aviso de promos del checkout** y el envelope del carrito en `v: 2` con el
  descarte de la `idempotencyKey` (§5.9.1).
- **Toda** la trazabilidad de §5.14: las dos columnas congeladas en `orders`, el
  mapeo en `toOrder`/`toOrderPublicView`/`Order`/`OrderPublicView`, la línea de
  descuento en el desglose de Pedidos, el KDS, el portal del repartidor, el
  comprobante por mail y `/pedido/[token]`, más la RPC `coupon_detail` con los tres
  agregados.
- **El código de 6 dígitos** (§5.11.3): `kind += 'coupon'`, la columna
  `subject_id` y el índice recreado en `store_pending_changes`, la cuarta entrada
  de `CHANGE_LABELS`, el trigger `enforce_coupon_redemption`.
- **La vía comercial** (§5.10.6): la décima plantilla y sus dos baldes.
- `promos`, `ventas` y `sales` en `RESERVED_SLUGS` — `baja` va en A.

**Ojo con una tentación de recorte:** la línea de descuento en el comprobante y en
el seguimiento **no es "pulido de UI" que se pueda dejar para una tercera
entrega**. Es aritmética: sin ella, el cliente recibe un mail donde los números no
suman. Va con el resto de B o B no sale.

Por qué partirlo:

1. **B depende de A**: el segmento de la campaña se calcula sobre el padrón.
2. **A sirve sola el día que sale.** El dueño abre `/admin/clientes` y ve quién le
   compra. Cero features a medio hacer.
3. **B es la mitad riesgosa**: es la que toca `orders`, `create_order` y el CHECK
   del total. Sacar A primero deja el padrón backfilleado y observado antes de que
   una campaña se apoye en él.
4. **La baja tiene que existir antes del primer mail promocional.** Va en A, con
   el resto de lo de PII, y para cuando B pueda mandar algo ya está probada.

### 7.2 Aditividad, y por qué cada entrega es UN deploy

`CLAUDE.md`: las migraciones y el deploy de Vercel arrancan con el mismo push y
corren **en paralelo**, así que hay una ventana en la que uno está y el otro no.
Mientras las migraciones sean aditivas da igual quién gane.

**Entrega A es puramente aditiva.** Tabla nueva, índices nuevos (incluido el de
`orders`, que es un btree compuesto sobre una tabla que hoy tiene una fila),
trigger nuevo, RPC nueva, un valor más en un CHECK de lista negra. El código viejo
corriendo contra el schema nuevo no nota nada. **Un deploy.**

**Entrega B también es UN deploy, y esto es lo que hay que hacer bien:**

- `orders.discount_cents` entra con `not null default 0` → aditivo, sin backfill.
- El swap del CHECK del total es `drop` + `add` **atómico dentro de la migración**,
  y **toda fila existente lo satisface** (`total = subtotal − 0 + fee` es el CHECK
  viejo). Cero downtime, cero backfill.
- **`create_order` conserva la firma `(jsonb, jsonb)`** y lee las claves nuevas con
  `coalesce`:

  ```sql
  coalesce((p_order ->> 'discount_cents')::bigint, 0)
  ```

  **Esto es lo que hace que sea un solo deploy.** El código VIEJO (que todavía
  corre en Vercel mientras la migración ya aplicó) llama a la función NUEVA sin
  mandar `discount_cents`, el `coalesce` lo pone en 0, el CHECK se satisface, y el
  pedido entra normal. Si en cambio la función exigiera la clave, **todo pedido
  entrando en esa ventana fallaría**, en viernes a la noche, sin que nada lo
  anuncie. Es la línea más importante de esta sección.
- La redefinición completa de `private.enforce_order_rules` sigue la doctrina del
  repo: `create or replace` reemplaza el cuerpo entero, así que **hay que
  re-declarar las reglas que ya están** (inmutables, transiciones, online impago,
  guardas de `on_the_way`, repartidor de la tienda), no solo agregar las dos
  columnas nuevas. Mismo cuidado que la migración de transferencia documenta.
- Lo mismo para `cleanup_old_records`: se re-declara con **los cinco** borrados.

### 7.3 Trampas concretas de estas dos migraciones

1. **`create or replace` reemplaza el cuerpo entero.** Vale para
   `enforce_order_rules`, `create_order`, `store_dashboard`, `courier_queue` y
   `cleanup_old_records`. Editar la primera definición de una función redefinida no
   cambia nada: **manda la de la migración más nueva.** `platform_stores` ya está
   redefinida cinco veces; `cleanup_old_records`, cuatro.
2. **`grant` para `service_role` explícito.** Supabase no le da privilegios sobre
   tablas nuevas. El síntoma es `42501 permission denied for table coupons` sin
   mencionar grants. Verificar con `curl` y la secret key antes de dar la migración
   por buena, como dice `CLAUDE.md`.
3. **`ADD CONSTRAINT IF NOT EXISTS` no existe en Postgres.** Todo constraint va en
   un `do $$ ... if not exists (select 1 from pg_constraint where conname = ...)`.
   Ya es el patrón de `20260831120000_transferencia_bancaria.sql`.
4. **El CHECK del total se dropea por INTROSPECCIÓN, no por nombre.** El nombre
   `orders_total_is_subtotal_plus_delivery_check` está en la migración de delivery,
   pero el patrón que la migración de transferencia estableció —buscar en
   `pg_constraint` por `pg_get_constraintdef(oid) like '%...%'`— es más seguro y
   ya está probado. Un `if not exists` sobre el nombre nuevo encontraría el viejo
   en pie y dejaría dos CHECKs contradictorios.
5. **`private.sync_store_customer` es `AFTER INSERT` y un error ahí aborta el
   pedido.** Ver §6.4. Es el riesgo más caro de la Entrega A.
6. **`pg_net` crea siempre su schema `net`.** El cron nuevo usa
   `private.invoke_app_cron`, que ya lo resuelve. Llamar `extensions.http_get` da
   `function does not exist`.
7. **El cron nuevo necesita `app_base_url` y `cron_secret` en Vault**, que ya están
   cargados para los otros tres. No hace falta cargar nada nuevo.
8. **`store_couriers`**: verificar si enumera columnas de `orders` que un descuento
   afecte. Sus métricas salen de `total_cents`, que ya es correcto, pero hay que
   **mirarlo**, no asumirlo.
9. **`store_pending_changes_live_idx` se DROPEA y se recrea** con la columna nueva
   (§5.11.3). Un `create index if not exists` con el mismo nombre y otra
   definición **no hace nada y no avisa**: el índice viejo queda, la invalidación
   sigue siendo por `(store_id, kind)`, y el bug de "activé el cupón B y se murió
   el código del A" queda vivo con la columna nueva presente y sin usar.
10. **El CHECK de `kind` de `store_pending_changes` va con drop-por-introspección**,
    no con `if not exists` sobre el nombre. Es el mismo patrón (y el mismo motivo)
    que la migración de transferencia documenta para `payments_provider_check`.

### 7.4 Pasos operativos, que no son código

Ninguno de estos los hace un agente ni el pipeline: son del hilo principal o del
dueño, una vez por entorno. Se listan porque el modo de falla de olvidarlos es
silencioso.

| Paso | Cuándo | Si no se hace |
|---|---|---|
| **Registrar `promos.comandapp.ar` en Resend** y cargar sus DNS | Entrega B, antes de la primera campaña | La campaña sale desde `comandapp.ar` con un `log.warn` (§5.10.5). No se rompe nada, pero el magic link queda expuesto a la reputación promocional |
| `RESEND_CAMPAIGN_FROM_EMAIL` | Idem | Fallback al remitente de siempre |
| `SALES_EMAIL` (¿`ventas@comandapp.ar`?) | Entrega B | El pedido de ampliación de cupo no tiene a dónde ir. **La dirección está a confirmar** |
| `CAMPAIGN_DAILY_BUDGET` | Entrega B | Default 15 en código. Es constante, no variable, salvo que se quiera cambiar sin deploy |
| Vault: nada nuevo | — | `app_base_url` y `cron_secret` ya están para los otros tres crons |
| Subir el límite de mail del proyecto hosted si hace falta | Ya hecho o no | Supabase impone 30/hora al conectar SMTP propio; eso aplica **solo al magic link**, no a lo que manda la app |

**Y una verificación que sí es del hilo principal**, porque es la trampa
bloqueante que `CLAUDE.md` documenta: después de aplicar cada migración, pegarle
con `curl` y la secret key a las tablas nuevas para confirmar que `service_role`
tiene grant. El síntoma de que falta es `42501 permission denied for table
coupons`, y no menciona los privilegios en ningún lado.

---

## 8. Lo que queda deliberadamente fuera de alcance

Nombrado para que no se cuele después como "ya que estamos":

- **Código único por destinatario.** Cerrado por el dueño (§1.1).
- **Cupones por producto o categoría, y BXGY.** Obligan al cupón a conocer el
  catálogo y a calcular el descuento por línea.
- **Descuento sobre el envío.** Ya existe `delivery_free_from_cents` (§5.7.1).
- **Acumular dos cupones.** Prohibido por `unique (order_id)`.
- **Exportar el padrón a CSV.** Es la función que convierte una fuga de sesión en
  una fuga de padrón completo. Si se pide, se piensa aparte.
- **Un banner del cupón en la vitrina.** Es lo más barato y efectivo (§4.1), y
  merece su propio brief de superficie.
- **Campañas por WhatsApp automáticas.** Depende de que Meta apruebe plantillas.
  El padrón deja el botón manual, que es lo que el producto puede hacer hoy.
- **Detalle por cliente con historial de pedidos y producto más pedido.** La hoja
  de detalle de v1 tiene nota y baja, nada más.
- **Corregir `private.order_is_billable`.** Es un cambio a la facturación que ve la
  plataforma. **Q6** en §9.
- **Paginación completa de los canjes de un cupón.** v1 muestra los últimos 20 con
  el total real al lado (§5.14.4). Nadie audita 1.500 canjes de a 20 en una hoja.
- **Valor MÁXIMO de ticket para un cupón** ("10% off, pero no en un pedido de
  $900"). Square y Toast lo tienen; acá `max_discount_cents` ya pone el techo de
  plata y es un campo menos en un formulario que ya tiene nueve (§3.2).
- **Un cuarto `segment_kind` (tipo "Lapsed" / `inactive_since`).** **Descartado
  por el dueño del producto**, no postergado: *"Reactivarlos es un mensaje de
  whatsapp, mas personal"*. Los segmentos quedan en `all | top_n | min_spent`, los
  tres que se pidieron. La herramienta de reactivación es el botón de WhatsApp con
  mensaje precargado (§5.5.1), y el argumento de producto es bueno: a alguien que
  no compra hace dos meses no lo vuelve un mail masivo. Como bonus, esquiva el
  problema de §3.1 — ni Square ni Toast publican un umbral que sirva para esta
  cadencia, y `PRODUCT.md` prohíbe inventar datos de uso.
- **Migrar el envío de MP de un item "Envío" a `shipments.cost`.** Existe y es más
  correcto (§3.3), pero es una mejora del adapter de pagos, no de este feature.
- **Analítica de cupón más allá de los tres agregados**: comparar contra un
  período sin cupón, clientes nuevos vs. recurrentes, atribución por campaña
  (**Q10**).
- **Un plan pago con más cupo de mail.** La vía comercial de §5.10.6 abre la
  conversación; el plan, la facturación y el cupo por tienda son un feature de
  plataforma, no de este pipeline. Hoy el cupo es global del proyecto, no por
  tienda — si mañana hay planes, `CAMPAIGN_DAILY_BUDGET` pasa a ser una columna de
  `stores` y el drenaje la lee. Está diseñado para que ese cambio sea una columna,
  no una refactorización.
- **Programar una campaña para una fecha.** Hoy sale desde que se encola. Con
  15/día, "mandar el jueves" y "tardar diez días" no se combinan bien, y agregar un
  `scheduled_for` a la campaña antes de que el cupo crezca es resolver el problema
  equivocado.
- **Un interruptor general de cupones** ("apagar todos"). Con la asimetría aprobada
  (§5.11.3), pausar un cupón ya es un click sin código, así que el interruptor
  general perdió su razón de ser.
- **Una lista de supresión por hash del teléfono**, que permitiría borrar la fila
  del padrón conservando la baja. Descartada por el dueño; la limitación aceptada
  está escrita en §5.12.5.1.
- **Registro de los WhatsApp mandados.** Un WhatsApp se abre en otra app: el
  producto no puede saber si salió (§5.5.1). Un registro que depende de que el dueño
  vuelva a confirmar es un registro que miente.
- **Bajar la expiración de los pedidos con cupón** para acotar el DoS sobre la
  promo (§5.9.3). El ataque cuesta 50 teléfonos y se autolimpia en 45 minutos.

---

## 9. Registro de decisiones

**No queda nada abierto.** Se deja el registro completo porque es lo que evita
reabrir una decisión ya tomada tres semanas después.

### 9.1 Ronda 1 — sobre el plan original

| # | Pregunta | Decisión | ¿Coincide con lo recomendado? |
|---|---|---|---|
| — | Dónde vive la superficie | Sección propia **`Clientes`** en el rail: `/admin/clientes` (Padrón) + `/admin/clientes/cupones` (Cupones). No "Marketing" | Sí (§4.3) |
| Q1 | Consentimiento de marketing | **Aviso + baja de un click. Sin checkbox.** Sin columna booleana de consentimiento; `marketing_opt_out_at` es la única señal | Sí (§4.2) |
| Q2 | Quién ve el padrón | **Solo el `owner`** | Sí (§5.11.1) |
| Q3 | La línea única en el checkout de MP | **Aceptada.** No se bloquea el slice probando el sandbox | Sí (§5.8.4) |
| Q4 | Subdominio aparte para promos | **Sí: `promos.comandapp.ar`**, con fallback degradante | Sí (§5.10.5) |
| Q5 | Presupuesto diario de campaña | **15 mails/día**, y no es una constante de seguridad: es una **palanca comercial** con vía de escalación a ventas | **No** — bajado de 80 a 15 y cambiado de naturaleza (§5.10.3, §5.10.6) |
| Q6 | Corregir `private.order_is_billable` | **Aparte.** Los dos huecos quedan documentados | Sí (§5.4) |
| Q7 | Cupón en un pedido programado | **Se valida al CREAR el pedido**: *"cuando se cobra"* | Sí (§5.9.2) |
| Q8 | Balde en la cotización | **Sí**, pero **solo cuando el código no existe** (ver Q8 de la ronda 3) | Sí, y refinado |
| Q9 | Mínimos antes o después del descuento | Mínimos del pedido y del envío **SIN** descuento; envío gratis **CON** descuento | Sí (§5.9.3.1) |
| Q10 | Métricas del cupón | **Sí, en la Entrega B** | Sí (§5.14.5) |
| — | Código de 6 dígitos al crear/modificar cupones | **Requisito nuevo.** Revirtió lo que este documento proponía | — (decisión en contra, revertida) |

### 9.2 Ronda 2 — la interpretación que hubo que adoptar

**"15 cupones por día" se lee como 15 MAILS de campaña por día**, no como 15
cupones distintos creados por día (§5.10.3). El único recurso que hay que racionar
es la cuota de mail; crear un cupón cuesta una fila, y un tope de "15 cupones
creados" no sería una palanca comercial. **Confirmado implícitamente** al no ser
corregida en la ronda siguiente.

### 9.3 Ronda 3 — las decisiones finales

| # | Pregunta | Decisión | ¿Coincide con lo recomendado? |
|---|---|---|---|
| Q9r3 | **La asimetría del código de confirmación** | **Aprobada tal cual.** Textual: *"No apagar se apaga sin codigo"*. Crear, activar y todo lo que **aumente** la exposición piden código; pausar, desactivar, bajar un tope y acortar la vigencia **no** | Sí (§5.11.3) |
| Q1r3 | **El consumo del cupón** | **Reserva con confirmación**, tres estados: se reserva al crear el pedido, se confirma al entregarlo, se libera si murió sin plata | **No** — ni la redención permanente propuesta ni "liberar si nunca se cobró". Es un tercer modelo, y mejor (§5.7.2) |
| Q3r3 / Q4r3 | **Reactivar clientes** | **WhatsApp con mensaje precargado, no un segmento.** Textual: *"Reactivarlos es un mensaje de whatsapp, mas personal"*. Sin cuarto `segment_kind` | **No** — se descartó el segmento que este documento dejaba como extensión natural, con mejor argumento de producto (§5.5.1) |
| Q2r3 | Cupón de envío gratis | **Excluido**, con el eje declarado como **faltante** y no como resuelto por `delivery_free_from_cents` | Sí (§5.7.1) |
| Q5r3 | Borrado del padrón / supresión por hash | **No se construye.** Limitación aceptada y escrita: no hay camino de producto para un pedido de supresión, y borrar la fila pierde la baja | Sí (§5.12.5.1) |
| Q6r3 | Cuándo van los textos | **Legales en A, aviso de promos del checkout en B** | Sí (§5.12.3) |
| Q7r3 | La `idempotencyKey` y el cupón | **Aplicar, cambiar o quitar el cupón la descarta.** El envelope del carrito sube a `v: 2` | Sí (§5.9.1) |
| Q8r3 | `coupon_check:ip` | **Se consume solo cuando el código NO EXISTE.** La cotización no tiene debounce, así que cobrar cada intento rate-limitearía al cliente de su propio checkout | Sí, y es un bug de producto que la primera versión tenía (§5.13) |

### 9.4 Las tres decisiones del dueño que mejoraron el plan

Vale registrarlo, porque es lo que este documento no vio:

1. **La reserva** (Q1r3). La propuesta original —redención permanente— tenía un
   agujero real: un pedido abandonado se comía un uso para siempre, y con
   `max_redemptions` obligatorio eso convierte cada carrito abandonado en plata
   promocional quemada. El modelo de reserva lo resuelve y encima da un número más
   honesto al panel.
2. **WhatsApp para reactivar** (Q3r3). Este documento tenía el segmento
   `inactive_since` como "extensión natural". La objeción de producto es mejor: a
   quien no compra hace dos meses no lo trae un mail masivo, y además esquiva tener
   que inventar un umbral que ni Square ni Toast publican (§3.1).
3. **El cupo de 15** (Q5). Bajarlo de 80 a 15 parecía un recorte y es lo contrario:
   elimina de raíz el riesgo de que una promo deje un pedido sin comprobante, y
   convierte una limitación del free tier en una conversación comercial.
