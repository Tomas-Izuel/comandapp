# Transferencia bancaria como tercer medio de pago — arquitectura

Rama sugerida: `feat/transferencia-bancaria`. Planner: `feature-planner`.
Fecha: 2026-08-30. **Versión 2**, incorporando las decisiones que bajó el dueño
del producto durante la planificación (quién confirma, límite de subida, escape
hatch por WhatsApp, retención).

**Estado: propuesta, pendiente de aprobación.** Lo que queda abierto está
marcado **[DECIDIR]** y no se implementa sin respuesta.

---

## 1. Problema y contexto

### 1.1 Lo que se pidió (textual)

> Agregamos en pagos la opción de transferencia bancaria, agregando un CBU o alias
> - Si es posible deberíamos poder validar el titular de la cuenta y que el admin lo confirme
> - Como es de pago, pedir el código
> - Al pagar por transferencia el usuario final sube un comprobante
> - El admin marca como pagado el pedido, puede acceder al comprobante ahí mismo y marcarlo como pagado
> - Al marcar como pagado borramos la imagen del comprobante, para no almacenar cosas de más en el storage

Y las precisiones posteriores:

- **Quién confirma la cuenta bancaria: el dueño del local**, con el código de 6
  dígitos, reusando `store_pending_changes`. Nada de aprobación desde
  `/backoffice`.
- **Validación del titular**: hay un candidato concreto (§3.4). *"Si es viable
  lo hacemos, si no, doble verificación y listo."* La validación automática
  tiene que ser **un adapter opcional detrás de un puerto**, nunca un
  acoplamiento, y el camino manual tiene que funcionar hoy sin contrato firmado.
- **Un comprobante por pedido, punto.** *"El límite es no subir más de una
  imagen"*, con ventana de 8 h como balde anti-abuso del endpoint.
- **El escape hatch es humano**: un botón *"Escribirle por WhatsApp"* en el
  detalle del pedido del admin. Si el comprobante está mal, el staff resuelve
  por ahí. **Decidido a conciencia, no se re-litiga.**
- **Retención y barrido**: aprobado.

### 1.2 Qué es esto realmente

No es "un medio de pago más". Es **el primer medio de pago del producto cuyo
ciclo de dinero lo cierra un humano y no un webhook.** Toca cinco invariantes a
la vez:

1. `payment_method` deja de ser binario, y hay **siete lugares que asumen que lo
   es** (§2.2). Dos de ellos producen **comida gratis**, no un error.
2. Aparece un dato de tienda que el **cliente anónimo tiene que leer** (el CBU) y
   que si alguien puede **escribir, redirige toda la plata del local**. Es la
   primera vez que esas dos cosas conviven en la misma entidad.
3. Aparece un **archivo subido por un anónimo**. Hoy el único bucket es
   `product-images`, público, y su policy de escritura es
   `private.is_store_member(...)`: no hay un solo camino de subida que no sea
   staff logueado.
4. Aparece un pedido `pending` durante minutos u horas esperando a que una
   persona lo mire. **Ninguna pantalla del mostrador muestra `pending`** (§2.3).
5. Aparece un **borrado programado de datos personales de terceros**, con una
   tensión real entre minimización y evidencia (§6.4).

### 1.3 Restricciones vinculantes (de `CLAUDE.md`, no se negocian)

MVC estricto (Postgres solo en `models/`, `page.tsx` nunca importa
`@supabase/*`) · lecturas y acciones en archivos separados · centavos enteros ·
**el precio lo pone el servidor** · invariantes de dominio en Postgres y
permisos en RLS, nunca solo en TypeScript · **grants por columna** y toda
escritura de plata con `createAdminClient()` detrás de un chequeo explícito ·
mobile-first · multi-tienda.

---

## 2. El sistema real, verificado (no asumido)

El proyecto hosted está **en paridad con las migraciones** (28 archivos en
`supabase/migrations/`, 28 en `mcp__supabase__list_migrations`, consultado el
2026-08-30). Los advisors de seguridad no reportan nada nuevo: los cuatro
`rls_enabled_no_policy` (`rate_limits`, `signup_allowlist`,
`store_payment_credentials`, `store_pending_changes`) son **deliberados** y están
documentados.

### 2.1 Dónde está hoy cada pieza

| Pieza | Dónde | Hecho verificado |
|---|---|---|
| `orders.payment_method` | `20260825120100_orders.sql:47` | `check (payment_method in ('online','in_store'))` |
| `paymentMethodSchema` | `order.schema.ts:102` | `z.enum(['online','in_store'])` |
| `PAYMENT_PROVIDER` | `order.schema.ts:86` | `'mercadopago' as const`, hardcodeado |
| `payments.provider` | `hardening.sql:121` | `check (provider in ('mercadopago'))` — **una transferencia no entra sin tocar el CHECK** |
| `payments_one_approved_per_order_idx` | `hardening.sql:130` | único parcial `(order_id) where status='approved'` |
| `private.order_is_billable` | `rpc.sql:32` | `approved OR (in_store AND status not in ('pending','cancelled'))`. **Una transferencia aprobada ya factura sin tocar nada** |
| `private.enforce_order_rules` | vigente en `20260829170000:641` | `payment_method` inmutable; "online impago no confirma" enumerado como `= 'online'` |
| `public.create_order` | vigente en `20260829170000:470` | pasa `payment_method` como texto: **no hay que tocarla** |
| `public.expire_pending_orders` | `rpc.sql:255` (única definición) | filtra `payment_method = 'online'`: una transferencia abandonada **no se barre nunca** |
| `public.cleanup_old_records` | vigente en `20260829150000_rate_limits.sql:140` | cuatro `delete`; `create or replace` reemplaza el cuerpo entero |
| `stores` grants de escritura | `hardening.sql:422` + 5 migraciones | `revoke insert,update,delete` + `grant update (...)` columna por columna |
| `stores` grant de lectura | `20260825120500_grants.sql:12` | `grant select on public.stores to anon, authenticated` — **grant de TABLA** |
| `store_payment_credentials` | `init_schema.sql:176` + `rls.sql:241` | cero policies, cero grants para `anon`/`authenticated` |
| `store_pending_changes.kind` | `20260828235210:21` | `check (kind in ('payment_credentials','courier_payment_policy'))` |
| Bucket único | `20260825120400_storage.sql` | `product-images`, **público**, 5 MB, `image/jpeg\|png\|webp\|avif`. Verificado contra el hosted: es el único |
| Upload de imagen | `views/admin/catalogo/image-upload.ts:56` | 100 % browser, cliente de sesión. **No existe camino de upload server-side.** Ya comprime con canvas: 1600 px, JPEG 0.82 |
| `canTakeOrders` | `lib/store-availability.ts:28` | `acceptingOrders && (onlinePaymentEnabled \|\| inStorePaymentEnabled)` |
| `markPaidInStore` | `order.model.ts:1212` | admin client, `.eq('payment_method','in_store').eq('payment_status','pending')` (CAS). **No escribe fila en `payments`** |
| `requireStoreMembership` | `store.model.ts:131` | `{ role: 'owner' }` opcional; `courier` → 403 |
| `getPaymentProvider()` | `services/payments/index.ts:12` | el seam de proveedor de pago; hoy sin argumentos |
| `getGeocoder()` | `services/geocoding/index.ts` | **el patrón exacto** a copiar para un servicio externo opcional |
| `vercel.json` | raíz | un solo cron: `/api/cron/cleanup`, 04:30 UTC. Los otros tres los dispara pg_cron |

### 2.2 Los binarios que se rompen con un tercer método

Un tercer valor del enum **no falla en compilación en todos estos lugares**;
varios son ternarios que degradan en silencio.

| # | Archivo:línea | Qué asume | Qué pasa si no se toca |
|---|---|---|---|
| 1 | `checkout-form.tsx:182-187` | `effective = online ? 'online' : 'in_store'` | Con transferencia habilitada y sin las otras dos, el checkout manda `in_store` y **el pedido nace `confirmed` e impago** |
| 2 | `checkout-form.tsx:729-759` | `RadioGroup` de exactamente dos opciones | La transferencia no se puede elegir |
| 3 | `order-status.tsx:157` (`PaymentNotice`) | `paymentMethod === 'in_store' ? … : PAYMENT_STATUS_LABELS[…]` | Una transferencia pendiente dice "Pendiente de pago" sin decir qué hacer |
| 4 | `order.model.ts:681-682` | `initialStatus = isOnline ? 'pending' : 'confirmed'` | **La cocina cocina gratis** |
| 5 | `order.model.ts:1177-1183` + el trigger | "online impago no confirma" enumerado como `= 'online'` | El staff podría confirmar una transferencia impaga desde el KDS |
| 6 | `store.mapper.ts:31-32` + `store-availability.ts:20` | dos flags de pago | Un local con solo transferencia queda "sin medio de pago" y la vitrina lo muestra cerrado |
| 7 | `order.model.ts:236` (`canResumePayment`) | `paymentMethod === 'online'` | **Correcto por casualidad**: la transferencia no debe ofrecer "Ir a pagar". **No tocar** |
| 8 | `checkout.actions.ts:29` (`resumePaymentAction`) | `paymentMethod !== 'online'` ⇒ `DomainError` | **Correcto por casualidad**, y es la defensa del servidor detrás del ítem 7. **No tocar** |
| 9 | `order.model.ts:1296` (`markOrderPaid`) | `order.paymentMethod !== 'online'` ⇒ `mismatch` | **Correcto**: un pago de Mercado Pago que aterriza en un pedido por transferencia es un `mismatch`, que es lo que corresponde. **No tocar** |

Los ítems 4 y 5 son los peligrosos. Los ítems 7-9 se listan porque el reflejo al
ver `=== 'online'` es "hay que agregar `transfer`", y en esos tres **agregarlo
sería el bug**.

### 2.3 El agujero operativo que nadie pidió y hay que tapar

`ACTIVE_STATUSES = ['confirmed','preparing','ready','on_the_way']`
(`order.schema.ts:29`), y `getActiveOrders` filtra por ahí
(`order.model.ts:902`). **El KDS no muestra `pending`.**

Un pedido por transferencia nace `pending` y se queda ahí hasta que un humano
mire. Tal como se pidió, **ese pedido es invisible para el mostrador**: el
cliente sube el comprobante y nadie se entera nunca. La bandeja de
"Transferencias por confirmar" no es un extra de UI: es lo que hace que el
feature exista.

### 2.4 Herramientas de la casa que se reusan tal cual

`store_pending_changes` + `claim_store_pending_change` +
`views/admin/shared/confirm-with-code.tsx` + la plantilla
`store-payment-change-code` → el "pedir el código", **sin reinventar nada** ·
`requireStoreMembership(storeId, { role: 'owner' })` ·
`createAdminClient()` detrás de ese chequeo (patrón `markPaidInStore`) ·
`lib/crypto/secrets.ts` (`hmacSha256`, `lastFour`) ·
`consumeOrThrow` (`admin.actions.ts:76`) + `RATE_LIMIT_POLICY`
(`lib/rate-limit-policy.ts:20`) + el union en `types.ts:739` ·
`payments_one_approved_per_order_idx` como árbitro de la carrera (§5.6) ·
`services/geocoding/` como plantilla del puerto opcional (§5.3) ·
`whatsapp-link.adapter.ts` y `phoneSchema` para el botón de WhatsApp (§5.9).

---

## 3. Investigación: qué se puede validar de verdad

Todo lo de esta sección está verificado contra fuentes primarias del BCRA y, en
el caso del algoritmo, comprobado empíricamente contra nueve CBU/CVU reales
publicados por seis bancos distintos más dos CVU de Mercado Pago (9/9 válidos en
ambos bloques).

### 3.1 Validación de CBU/CVU: gratis, offline, y bien documentada

**Estructura real (ojo, el dígito verificador NO va en el medio del bloque):**

| Posiciones | Contenido |
|---|---|
| 1–3 | Código de **entidad** |
| 4–7 | Código de **sucursal** (o de **PSP**, si es CVU) |
| **8** | **DV del bloque 1** |
| 9–21 | Tipo y número de **cuenta** |
| **22** | **DV del bloque 2** |

**Algoritmo — módulo 10, ponderador 9713.** Fuente primaria: BCRA / CIMPRA,
Boletín 016, *"Estándares recomendados para el intercambio de información entre
empresas y entidades financieras"*, cap. 4
(<https://www.bcra.gob.ar/archivos/Pdfs/Medios_pago/SNP3016.pdf>). El ponderador
se aplica **de derecha a izquierda** (unidad ×3, decena ×1, centena ×7, unidad de
mil ×9, y ciclo), lo que leído de izquierda a derecha da:

```
Bloque 1 (7 dígitos base):  [7, 1, 3, 9, 7, 1, 3]
Bloque 2 (13 dígitos base): [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]
DV = (10 − (Σ dígitoᵢ·pesoᵢ mod 10)) mod 10
```

**El `mod 10` exterior no es cosmético.** El texto del BCRA dice "el resto se
deducirá de 10", lo que daría 10 cuando el resto es 0 — imposible. El
comportamiento real es DV = 0, verificado con el prefijo de CVU de Prex
(`00000130`: base `0000013` suma 10, resto 0, DV real 0). **Un implementador que
omita ese `mod 10` rechaza CBU válidos y el bug solo aparece en un puñado de
entidades.** Va comentado en el código.

**CVU: mismo algoritmo, y se distingue porque los tres primeros dígitos son
`000`.** Fuente: texto ordenado *"SNP – Servicios de Pago"* §2.3
(<https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-snp-spd.pdf>). El código de PSP
son las posiciones **4 a 7** — cuidado con la creencia muy replicada de que
"0031 es Mercado Pago": esa cadena **incluye el dígito verificador**. El código
de Mercado Pago es `0003`.

**Alias — reglas oficiales exactas.** Mismo texto ordenado, §3.7.2.1.i
(Com. "A" 8114, vigencia 09/10/2024): mínimo 6, máximo 20 caracteres; solo
`0-9 A-Z a-z . -`; mayúsculas y minúsculas indistintas. O sea
`^[A-Za-z0-9.-]{6,20}$`, case-insensitive. (Documentación vieja dice 14
caracteres: era la Com. "A" 6044 de 2016, ampliada después.)

**Entidad → nombre de banco.** El BCRA expone
`GET https://api.bcra.gob.ar/cheques/v1.0/entidades`, **gratis, sin auth y con
`Access-Control-Allow-Origin: *`**. Pero **devuelve solo 59 entidades** (las
adheridas al sistema de cheques — faltan bancos reales como Brubank) y **cero
códigos de PSP**. COELSA no publica la tabla de PSPs.
**Decisión: tabla embebida y versionada en el repo**, sembrada desde ese endpoint
más los PSP de fuentes comunitarias. Una llamada de red en el checkout para
mostrar el nombre de un banco es una dependencia que no se justifica.

**Conclusión: validar que un CBU/CVU esté bien escrito y decir de qué entidad es
cuesta cero pesos, cero red y ~40 líneas de código puro.** Y ataca el problema
más frecuente de verdad, que no es el fraude sino el dedo gordo: un dígito mal
tipeado manda la plata de todos los clientes del local a ningún lado.

**Y hay que ser honesto sobre lo que NO dice.** El propio boletín del BCRA
declara su propósito: *"mejorar la calidad de captura de los datos"*. Un
checksum válido significa "no hay error de transcripción". No significa que la
cuenta exista, que esté activa, ni de quién es.

### 3.2 Resolver CBU/CVU → titular: no existe gratis

El riel argentino se construyó para **verificar una coincidencia** (mandás CBU +
CUIT que ya tenés, te devuelve `COINCIDE`/`NO_COINCIDE`), no para **resolver un
nombre**. La base CBU↔CUIT existe, vive en COELSA, y la norma que la crea la
somete explícitamente a la Ley 25.326 — Com. "B" 10980
(<https://www.bcra.gob.ar/archivos/Pdfs/comytexord/B10980.pdf>): *"La CEC BV
será responsable en lo relativo de la aplicación a esta base de la Ley de
protección de datos personales."*

- **COELSA** no tiene puerta para terceros. La Com. "A" 8298 (07/08/2025) sí la
  obliga a exponer una API gratis, pero solo *"a los sujetos obligados"*
  (entidades financieras, PSPCP, administradores de esquemas de pago), y lo que
  devuelve son **totalizadores de riesgo, no nombres**.
- **Acceso a la base de alias**, texto ordenado §3.9, literal: *"Podrán acceder a
  la plataforma todas las entidades financieras por sí mismas o a través de
  terceros autorizados por ellos"*. **No hay endpoint público.**
- **BCRA**: ninguna de sus cinco APIs públicas toca cuentas. La Central de
  Deudores devuelve razón social **a partir del CUIT**, no del CBU — y el eslabón
  faltante es justo CBU → CUIT.
- **Mercado Pago**: cero ocurrencias de "CBU"/"CVU" en su documentación de
  developers para Argentina. Money Out recibe el nombre del titular como
  **input**, no lo devuelve, y no tiene variante MLA. Que la **app** de MP te
  muestre el titular es UI de un PSPCP con acceso al riel, no una API.
- **Lo que sí existe, todo con contrato**: BIND PSP (el único documentado que
  resuelve nombre desde CBU/CVU/alias solo — requiere ser cliente de BIND Pagos),
  Red Link (solo `COINCIDE`/`NO_COINCIDE`, requiere banco adherido), Comafi,
  Nosis (confirma, no devuelve).
- **Bandera roja**: hay servicios self-service que venden exactamente lo que
  ningún regulado puede vender sin contrato, sin razón social ni CUIT argentinos
  y con teléfono en Estados Unidos. **No usar.** Si un proveedor te vende
  titularidad de CBU sin pedirte contrato ni acreditar interés legítimo, o no
  entrega, o accede por una vía que te expone a vos.

**Existe un "Confirmation of Payee" argentino, pero está del otro lado de la
pared.** Texto ordenado §3.7.3: cuando el cliente ingresa un **alias** para una
transferencia inmediata, la entidad *"debe presentar al cliente una pantalla de
confirmación que … tenga … **nombre real del destinatario** … y CUIT/CUIL/CDI/DNI
del receptor"*. Es obligatorio desde 2016 y sigue vigente. **Es una obligación de
UI de una entidad financiera hacia su propio cliente, no un servicio consultable
por terceros.**

**Normativa (Ley 25.326, vigente en 2026 — hay proyectos de reforma, ninguno
sancionado):** el nombre y el CUIT asociados a una cuenta son datos personales.
Un SaaS de pedidos que consulta el titular de la cuenta de **un tercero** no tiene
consentimiento ni interés legítimo acreditable. **Esto no aplica a nuestro caso
de uso** por un motivo importante que se detalla en §5.3: el único CBU que
consultamos es **el del propio local, cargado por su propio dueño**.

### 3.3 Lo que el mercado argentino ya resolvió, y no con comprobantes — **PUSHBACK**

Éste es el hallazgo que obliga a poner algo sobre la mesa antes de construir.

**Pago Nube (Tiendanube) eliminó el comprobante a propósito.** Su flujo real es:
el cliente ingresa su DNI, recibe un **CVU**, transfiere el **monto exacto con
centavos**, **en un solo pago**, **desde una cuenta a su nombre**, dentro de
**24 h**. El sistema detecta la acreditación y aprueba solo. Textual de su centro
de ayuda:

> *"Los pagos se aprueban sin que tengas que pedir o revisar comprobantes
> manualmente, ya que **Pago Nube valida la acreditación por vos**."*
> *"**Evitar fraudes: No más comprobantes falsos**, ya que el sistema solo
> aprueba si el dinero ingresó realmente."*
> *"**Nunca realices el envío de la venta si el estado del pago no aparece
> 'Aprobado'** … el comprobante de transferencia no garantiza que el dinero haya
> ingresado correctamente."*

Comisión: 0,85–1,50 % + IVA por transferencia, contra 3,29–6,40 % + IVA por
tarjeta. Ése es el motor real del crecimiento del medio.

**Talo Pay** (argentino) hace lo mismo vía API: **CVU y alias únicos por pago**,
webhooks, sandbox con simulador, expiración configurable, **1 %** por
transferencia, y —lo más interesante— estados de primera clase `PENDING`,
`SUCCESS`, **`OVERPAID`**, **`UNDERPAID`**, `EXPIRED`.

**El fraude con comprobantes falsos es real y frecuente.** Hay casos verificados
en 2026: más de 50 comercios de Olavarría estafados por la misma pareja (un
panadero acumuló ~$1 millón); $2,2 millones en Canín; +$4,5 millones en
Maquinchao, donde además una jueza tuvo que ordenar a dos plataformas
abstenerse de cobrar créditos tomados con los datos de la víctima. Las apps que
generan comprobantes falsos se distribuyen por Telegram, se venden por paquetes,
falsifican múltiples billeteras, **generan SMS que simulan ser del banco y
reproducen el sonido de confirmación de la app real**. *(Advertencia
metodológica: el "aumento del 30 %" que circula en los medios no tiene fuente
primaria; son dos cifras distintas e incompatibles citándose entre sí. No lo
usamos como argumento.)*

**En Argentina no existe ninguna verificación oficial de autenticidad de un
comprobante** — ni QR verificable, ni consulta por número de operación. La
recomendación uniforme de todas las fuentes, incluida Mercado Pago, es
*"no entregues hasta ver en tu actividad que el dinero ingresó"*.

**Qué significa para el plan.** Tres cosas, y la tercera es la decisión:

1. **Cualquier validación sobre la imagen es teatro de seguridad.** Nada de OCR,
   heurísticas de logo, ni "detectar comprobantes falsos". Contra un adversario
   que vende paquetes de pantallazos por Telegram, eso no defiende: **le da al
   local una falsa confianza, que es peor que ninguna.**
2. **La UI del staff no pregunta "¿el comprobante es válido?" sino "¿la plata
   está en tu cuenta?".** La imagen es contexto, no evidencia. Esto es una
   restricción de copy vinculante para el slice de KDS.
3. **[DECIDIR] D0 — Existe una alternativa que este plan no construye, y hay que
   nombrarla.** Un proveedor de conciliación (Talo, 1 %) daría CVU único por
   pedido, acreditación automática, cero comprobantes, cero storage, cero
   problema de datos personales y cero fraude de captura. Y **encajaría en el
   seam que ya existe**: `getPaymentProvider()` en `services/payments/index.ts`,
   detrás del puerto `PaymentProvider`. Lo que **no** da es lo que el dueño pidió:
   que la plata caiga directo en la cuenta del local, sin intermediario ni
   contrato. **Recomendación: construir el flujo manual ahora** —es lo que se
   pidió, funciona sin firmar nada, y es el patrón que usan Empretienda y el
   WhatsApp que venimos a reemplazar— **y dejar registrado que el camino
   automático existe, cuesta ~1 % y es un adapter, no una reescritura.** Si el
   dueño quiere evaluarlo, se evalúa antes de escribir código, no después.

### 3.4 El candidato: `Fintech_AR_CBU_GOLD` (Certisend / Sysworld) — **NO VIABLE hoy**

Investigado con `curl` contra el endpoint real y contra el backend del portal, el
2026-08-30/31. Proveedor: **Sysworld Servicios S.A.**, marca **Certisend**,
marketplace **ApiLanding**.

**Lo bueno, y es genuinamente bueno:**

- **El dato NO viene enmascarado.** El payload reportado
  (`titular.nombre`, `cuenta.nro_cbu`, `respuesta.descripcion` = `"ALIAS
  ENCONTRADO"`) es **el payload de COELSA pasado tal cual**. Se confirma por
  identidad de esquema con BDC Conecta, que documenta públicamente el mismo
  lookup: `"nombre": "JOHN DOE"`, `cuit`, `tipoPersona`, y la cadena exacta
  `"respuestaDescripcion": "ALIAS ENCONTRADO"`
  (<https://docs.bdcconecta.com/Cuentas/alias_consulta>).
- **No hay norma del BCRA que obligue a enmascarar.** Se buscó "enmascar\*" en los
  tres textos ordenados relevantes (Secreto Financiero, SNP-Transferencias,
  Com. "A" 7153): cero ocurrencias. El enmascarado de algunos home banking es
  práctica de industria.
- **Resuelve en los dos sentidos**: el catálogo archivado lista
  `validate_gold` y un hermano `validate_cbu`, y el parámetro `cbu` acepta alias.

**Lo que lo descarta, hoy:**

| Hallazgo | Evidencia |
|---|---|
| **Sin sandbox y sin autoservicio para este producto** | El endpoint responde `401 security tokens not defined.` sin `token-susc`/`token-api`. **El producto GOLD ya no figura en el catálogo autoservicio 2026**: el backend vivo lista 30 APIs y la única de CBU es `"cbu-validation" / "Valida un CBU."`, sin mención de titular |
| **Sin precio publicado** | En el catálogo archivado de 2024 el GOLD decía `$ Info` (a negociar). Lo único con precio hoy es `cbu-validation`: ARS $100/consulta con **lote mínimo de 1.000** ($100.000) |
| **Sin SLA** | No publican ninguno |
| **La bandera roja** | Su propia status page (`digital.sysworld.com.ar`) marcaba el componente **"BD Certisend & VWCore" en 0.000 % de uptime durante los 90 días corridos** hasta el 30/08/2026. Un crawl anterior mostraba 99,962 %: degradó |
| **Autenticación por query string** | Dos secretos en la URL — quedan en logs de proxy, de Cloudflare y en el `Referer`. Para **el mismo lookup**, BDC Conecta exige mTLS + VPN + token + `X-SIGNATURE` HMAC-SHA256 |
| **Términos sin DPA** | No hay cláusula de elegibilidad ni de responsabilidad sobre datos personales. Con el art. 11.4 de la Ley 25.326, todo el riesgo del cedente queda del lado nuestro |

**Veredicto: no se integra ahora.** Se implementa `manual.adapter.ts` y el puerto
queda listo. `certisend.adapter.ts` se deja escrito contra el contrato y
**apagado por default**, para que el día que haya credenciales sea una variable
de entorno y no un refactor.

### 3.5 La trampa legal que cambia el diseño, y la salida

Este es el hallazgo más importante de toda la investigación, y **corrige el
diseño, no solo la elección de proveedor**.

La Ley 25.326 exige consentimiento (art. 5.1) con excepciones tasadas. Para este
caso:

- **El art. 5.2.c no cubre el CBU.** Su enumeración es cerrada — "nombre, DNI,
  identificación tributaria o previsional, ocupación, fecha de nacimiento y
  domicilio". El CBU no está.
- **El art. 5.2.a (fuente de acceso público irrestricto) no aplica**: un endpoint
  comercial pago no es una fuente pública.
- **La única excepción que calza es el art. 5.2.d (relación contractual), y tiene
  una asimetría fatal: te cubre cuando el titular *es* tu comerciante —o sea,
  cuando la verificación da OK— y te deja sin base legal justo cuando da mal, que
  es el único caso en que la función vale algo.**
- **Art. 1, párr. 2: la ley alcanza también a las personas jurídicas.** Argentina
  es la excepción frente al RGPD acá. *"Es una SRL, no aplica"* es falso.
- **Art. 4.1: datos "no excesivos".** Guardar nombre y CUIT cuando alcanzaba un
  booleano es exactamente el supuesto que ataca.
- **"Prevención del fraude" como interés legítimo no es derecho vigente**: está en
  los tres proyectos de reforma en trámite, ninguno sancionado a agosto de 2026.

**La salida, que además es más barata y técnicamente mejor:**

1. **Pedir un producto *match-only*, no de resolución de nombre.** Ya tenemos el
   CUIT del comerciante por la relación contractual; lo único que hace falta es
   *"¿este CBU es de él?"*. Red Link devuelve literalmente
   `COINCIDE` / `NO_COINCIDE` sin nombre alguno, y Comafi tiene una API separada
   de "validar si una CBU/CVU corresponde a un CUIT/CUIL".
2. **Y si igual se usa una API que devuelve nombre: comparar en el servidor
   contra el CUIT que ya tenemos, guardar un booleano y un timestamp, y descartar
   el nombre.** El nombre nunca toca la base.

**Consecuencia vinculante para el diseño (§5.3):** el puerto
`BankAccountValidator` devuelve un `BankAccountLookup` que vive **solo en memoria,
dentro de la Server Action**. Lo único que se persiste es `holder_match` +
`checked_at`. Y la comparación se hace **por CUIT, dígito contra dígito**, no por
nombre — es exacta, no necesita normalizar tildes ni orden de apellido, y saca el
feature del alcance del análisis de arriba: **no hay base de datos de terceros que
registrar, no hay cesión que justificar, y no hay dato bancario ajeno
almacenado.**

---

## 4. Pushback: cuatro cosas que hay que mirar de frente

### 4.1 "Validar el titular" no existe como se imagina. No lo prometamos en la UI

Ver §3.2. Aun con el adapter automático funcionando, lo que tendríamos es
**contraste**: la API dice un nombre, el dueño declaró otro, y alguien mira.
La palabra "verificado" en una pantalla que el **cliente** ve, sostenida por eso,
transfiere confianza que no ganamos.

**Propuesta: el cliente no ve ningún sello.** Ve el titular, el banco y el CBU,
que es lo que necesita para transferir. El estado de contraste
(`match` / `mismatch` / `unavailable`) vive en el panel del dueño, para el dueño.

### 4.2 "CBU o alias" — el alias no puede ser el único dato

El alias es un **puntero mutable**: se puede cambiar una vez por día, hasta 10
veces por año calendario (texto ordenado §3.7.6). No tiene checksum, y no hay
endpoint público que lo resuelva. Si el local carga solo un alias, **no tenemos
forma de detectar un error de tipeo ni de saber de qué banco es**, y el dato que
dirige la plata de todos sus clientes puede cambiar de destino sin que nos
enteremos.

**Propuesta: el CBU/CVU es obligatorio; el alias es opcional y se muestra al
lado como comodidad.** Costo para el dueño: copiar 22 dígitos una vez. Beneficio:
el dato que dirige la plata pasa por un checksum, y el alias que se muestra tiene
un CBU al lado con el que contrastarlo.

### 4.3 El pedido pasa a estar invisible: hace falta una bandeja

Ver §2.3. **No es alcance opcional.**

### 4.4 Un pedido por transferencia abandonado no se limpia nunca

`expire_pending_orders` filtra `payment_method = 'online'`. Una transferencia que
el cliente nunca paga queda `pending` para siempre, ocupando su `short_code` (el
índice `orders_store_short_code_active_idx` es único sobre los no terminales).
Hay que extender el barrido, y hay una trampa de firma de función (§7.3).

---

## 5. Arquitectura recomendada

### 5.1 Vocabulario nuevo

`payment_method` gana **`transfer`**. `payments.provider` gana **`transfer`**
(hoy el CHECK solo admite `'mercadopago'`).

### 5.2 Dónde vive el CBU: tabla propia, no columnas en `stores`

**Es el punto de diseño más importante y tiene un motivo técnico duro.**

`stores` tiene `grant select on public.stores to anon, authenticated`, que es un
grant **de tabla**. En Postgres, una vez otorgado a nivel de tabla, **no se puede
"restar" una columna con un `revoke select (col)`**. La documentación de
`REVOKE` lo dice textual
(<https://www.postgresql.org/docs/current/sql-revoke.html>):

> *"Granting the privilege at the table level and then revoking it for one column
> will not do what you might wish: the table-level grant is unaffected by a
> column-level operation."*

O sea: cualquier columna nueva en `stores` es legible por `anon` para toda tienda
activa, y acotarla exigiría revocar el select de tabla y reotorgarlo columna por
columna — un cambio grande y riesgoso sobre la query más caliente del producto.

El CBU **sí** tiene que ser público. El CUIT declarado y el resultado del
contraste con la API **no**.

**Decisión: tabla nueva `public.store_bank_accounts`, 1:1 con `stores`.** Es la
doctrina de grants por columna del repo aplicada tal cual, y es la única forma de
tener parte pública y parte privada en la misma entidad.

Forma (intención, no DDL — la migración la escribe el hilo principal):

```
public.store_bank_accounts
  store_id       bigint primary key references stores(id) on delete cascade
  cbu            text not null            -- 22 dígitos, CHECK ^[0-9]{22}$
  alias          text                     -- CHECK ^[A-Za-z0-9.-]{6,20}$
  holder_name    text not null            -- lo que el dueño DECLARA
  holder_tax_id  text                     -- CUIT/CUIL declarado, CHECK ^[0-9]{11}$
  bank_name      text                     -- snapshot derivado del código de entidad
  is_active      boolean not null default true
  -- Resultado del contraste automático, si hubo. Es TODO lo que queda de la
  -- llamada al proveedor: el nombre que devolvió no se persiste nunca (§3.5).
  holder_match   text check (holder_match in ('match','mismatch','unavailable'))
  checked_at     timestamptz
  created_at, updated_at timestamptz
```

**No hay columna `holder_source`.** `holder_name` es siempre lo que declaró el
dueño; el contraste vive entero en `holder_match`. Una columna que dijera "este
nombre lo trajo la API" sería la señal de que el nombre de la API se guardó.

**No hay columna `status` ni `reviewed_by`**: la plataforma no revisa nada. Una
fila existe **si y solo si** el dueño la confirmó con el código de 6 dígitos.

Grants y RLS:

- `revoke all on public.store_bank_accounts from anon, authenticated;`
- `grant select (store_id, cbu, alias, holder_name, bank_name) on … to anon, authenticated;`
  — **exactamente las cinco columnas que el cliente necesita para transferir.**
  `holder_tax_id`, `holder_match` y `checked_at` no salen nunca
  al borde público.
- Policy de SELECT para `anon, authenticated`: `is_active AND` la tienda está
  `active`.
- **Cero grants de INSERT/UPDATE/DELETE.** Toda escritura es `service_role`
  detrás de `requireStoreMembership(storeId, { role: 'owner' })` + el código.
  Mismo criterio que `store_payment_credentials`, por el mismo motivo: quien
  escribe esto **redirige la plata del local**.
- **Recordar el grant a `service_role`**, explícito. Es la trampa documentada del
  repo: sin él, `service_role` recibe `42501 permission denied` aunque bypassee
  RLS, y el síntoma no menciona los privilegios en ningún lado.
- El panel (`/admin/pagos`) lee **todas** las columnas para su propia tienda con
  el admin client detrás de `requireStoreMembership`, exactamente como
  `getPaymentConnectionStatus` (`admin.controller.ts:75`). No hace falta policy.

**`is_active` se puede apagar sin código.** Motivo: el código de 6 dígitos existe
para impedir que una sesión robada **redirija plata**. Apagar el método no
redirige nada — solo pierde ventas, que es una decisión que el dueño tiene
derecho a tomar rápido. Encenderlo requiere que exista una fila, y esa fila solo
nace con el código.

> **Alternativa descartada A: columnas en `stores`.** Más barata de escribir,
> imposible de acotar (párrafo de arriba), y mete el CUIT y el resultado del
> contraste en el payload que `anon` descarga en cada carga de la vitrina.
>
> **Alternativa descartada B: guardarlo en `store_payment_credentials`.** Es
> donde "vive lo de cobrar", pero esa tabla existe para que el secreto **no
> llegue** al borde. El CBU tiene el requisito **opuesto**: tiene que llegar.
> Mezclarlas obliga a que la vitrina lea con admin client desde una tabla que el
> modelo de seguridad dice que no debe tocar.

### 5.3 La validación del titular: un puerto, dos adapters, cero acoplamiento

`src/services/bank-validation/`, copiando **literalmente** la forma de
`src/services/geocoding/` — que existe por el mismo motivo y ya resolvió las
mismas preguntas.

```
bank-validation/
  bank-account-validator.port.ts   el contrato
  certisend.adapter.ts             el proveedor pago, detrás de env
  manual.adapter.ts                no-op: siempre devuelve null
  index.ts                         getBankAccountValidator()
```

Contrato (forma, no código):

```
BankAccountLookup = {
  cbu: string | null
  alias: string | null
  holderName: string | null      // puede venir null o enmascarado
  holderTaxId: string | null
  bankCode: string | null
  accountStatus: string | null
}

interface BankAccountValidator {
  lookupByAlias(alias: string): Promise<BankAccountLookup | null>
  lookupByCbu(cbu: string): Promise<BankAccountLookup | null>
}
```

Reglas del puerto, calcadas de `Geocoder` y por las mismas razones:

- **`server-only`**, timeout de 5 s, validación Zod campo por campo de la
  respuesta (un proveedor externo puede cambiar la forma sin avisar).
- **Ante cualquier error devuelve `null`, nunca tira.** Una API de un tercero
  caída no puede impedir que un local cargue su CBU.
- **El resultado es una PROPUESTA que se contrasta, no una verdad que se
  persiste.** Es exactamente la doctrina que ya está escrita para el geocoder:
  *"lo que se persiste es el pin que el dueño confirma, no lo que devolvió el
  geocoder"*. Acá es todavía más estricto: **`BankAccountLookup` vive solo en
  memoria, dentro de la Server Action, y se descarta.** Lo que se persiste en
  `holder_name` es lo que el dueño declaró; de lo que dijo la API queda
  **únicamente `holder_match` + `checked_at`**. El nombre que devuelve el
  proveedor **nunca toca la base ni un log** — §3.5.
- **La comparación se hace por CUIT, dígito contra dígito, no por nombre.** Es
  exacta (no hay que normalizar tildes, mayúsculas ni orden de apellido), y es lo
  que reduce el dato persistido a un booleano. Si el dueño no cargó
  `holder_tax_id` o el proveedor no devolvió CUIT, el resultado es
  `'unavailable'` — **no se cae a comparar nombres**, que es difuso y obligaría a
  guardar el nombre para poder mostrarlo.
- La fábrica elige por env (`BANK_VALIDATION_PROVIDER`, default `manual`), igual
  que `WHATSAPP_PROVIDER`. **Sin variable configurada, el sistema funciona
  entero**: el adapter manual devuelve `null`, `holder_match` queda
  `'unavailable'`, y el flujo sigue siendo checksum + declaración + código. Ése
  es el "doble verificación y listo" del dueño, y es un camino de primera clase,
  no un degradado.

**Sobre datos personales (§3.2, §3.5):** el único CBU que este puerto consulta es
**el del propio local, tipeado por su propio dueño, en su propio panel, sobre su
propia cuenta** — y aun así lo único que sobrevive a la llamada es un booleano.
Las dos reglas juntas son las que sacan el feature del alcance del análisis de
§3.5. **Nunca se usa este puerto sobre un CBU que venga de un cliente**, y va
comentado en el puerto con esas palabras.

**La llamada se hace en el momento de PEDIR el cambio, no al confirmarlo.** El
dueño tipea el CBU, el formulario le muestra el banco (offline) y, si hay
proveedor, el titular que devolvió la API al lado del que él escribió. Recién
entonces pide el código. Contrastar después de confirmar sería contrastar tarde.

### 5.4 El flag derivado y el gate de la vitrina

`stores.transfer_payment_enabled boolean not null default false`, **derivado**,
mantenido por un trigger sobre `store_bank_accounts` (insert / update de
`is_active` / delete), copiando el patrón de
`private.sync_store_online_payment` (`20260829160000_online_payment_flag.sql`).

- Verdadero ⟺ existe fila con `is_active`.
- **Sin `grant update` para `authenticated`**, igual que `status`, `slug` y
  `online_payment_enabled`. Es derivado, no configurable.
- Default `false` ⇒ **ninguna tienda existente cambia de estado con el deploy.**

`src/lib/store-availability.ts` pasa a
`onlinePaymentEnabled || inStorePaymentEnabled || transferPaymentEnabled`, y
`canTakeOrders` no cambia de forma. Eso responde el gate de disponibilidad sin
romper el default del alta.

### 5.5 El ciclo de vida del pedido por transferencia

```
cliente elige "transferencia"
  → createOrder: initialStatus = 'pending', payment_status = 'pending'
  → submitOrder NO crea preferencia de MP; redirige a /pedido/[token]
  → seguimiento: CBU, alias, titular, banco, MONTO EXACTO y el short_code
    como referencia, más el control de subida (UNA sola oportunidad, avisado
    antes — §5.7)
  → el cliente transfiere y sube el comprobante
  → el pedido aparece en "Transferencias por confirmar" del KDS
  → el staff mira SU cuenta (no el comprobante) y toca "Confirmar pago"
  → payment_status='approved', fila en payments, 'pending'→'confirmed',
    ETA recalculado, WhatsApp de confirmación, comprobante marcado para purga
  → de acá en adelante es un pedido normal
```

**Regla dura: un pedido por transferencia impago NO pasa a `confirmed`.** Misma
regla que el pago online, y por un motivo más fuerte: acá la plata está **menos**
asegurada que con Mercado Pago (no hay webhook, no hay contracargo, y el
comprobante no prueba nada — §3.3).

**Dónde vive: en Postgres, en `private.enforce_order_rules`**, espejada en
`updateOrderStatus` (que es lo que hace que la UI no ofrezca el botón). Y con un
cambio de forma que vale la pena: el trigger hoy dice
`if new.payment_method = 'online' and new.payment_status <> 'approved'`.

**Propuesta: invertir el predicado a `new.payment_method <> 'in_store'`.** La
regla real del dominio es *"todo lo que no se cobra en el mostrador necesita la
plata asegurada antes de cocinar"*. Enumerando los métodos malos, cada método
futuro **nace inseguro por omisión** — que es exactamente la trampa que
`CLAUDE.md` documenta para `create_order` / `store_couriers` / `platform_stores`.
Enumerando el único método bueno, el default es seguro. El mismo cambio va en
`order.model.ts:1177-1183`.

**El ETA congelado** se **recalcula al confirmar**, reusando
`refreshFrozenEta(orderId)` (`order.model.ts:1458`) — lo mismo que ya hace el
camino de Mercado Pago al aprobarse el pago. Entre crear y confirmar puede pasar
media hora, y un ETA de hace media hora no le sirve a nadie. Cero mecanismo
nuevo.

### 5.6 `payments`: sí, deja fila

La confirmación inserta una fila en `payments` con `provider = 'transfer'`,
`provider_payment_id = 'order:' || order_id`, `status = 'approved'`,
`amount_cents = total_cents`, y en `raw` quién confirmó, cuándo, el número de
operación que el staff pueda haber tipeado, y la huella del comprobante.

Tres motivos concretos, no de simetría:

1. **`payments_one_approved_per_order_idx` se vuelve el árbitro de la carrera.**
   Dos operarios tocando "Confirmar pago" a la vez: el segundo insert rebota con
   `23505` y la acción devuelve 409 en vez de pisar. El CAS sobre `orders`
   (`.eq('payment_status','pending')`, como `markPaidInStore`) cubre casi todo;
   el índice lo cierra desde la base, para `service_role` incluido.
2. **`expire_pending_orders` ya tiene `not exists (payments approved)`**: una
   transferencia confirmada queda protegida del barrido sin agregar una línea.
3. **Es lo único que sobrevive al borrado de la imagen.**

Cuesta: extender `payments_provider_check` a `in ('mercadopago','transfer')`.
`private.order_is_billable` **no se toca**: `payment_status = 'approved'` ya la
hace facturable, así que `store_dashboard`, `platform_metrics` y `platform_stores`
computan bien sin cambios.

> Asimetría consciente: `markPaidInStore` (efectivo) **no** deja fila y se deja
> como está. El efectivo se confirma con el cliente presente y no tiene número de
> operación; una transferencia es un movimiento electrónico con referencia y
> merece libro mayor. Igualar los dos casos es alcance que nadie pidió.

### 5.7 El comprobante: un solo tiro, por nuestro servidor, a un bucket privado

**El que sube no está logueado. Lo único que tiene es el `public_token`.**

#### Por qué el archivo pasa por nuestro servidor

| | Opción A — signed upload URL (browser → Storage directo) | Opción B — por nuestro route handler **[recomendada]** |
|---|---|---|
| Límite de tamaño | Solo el del bucket | **4,5 MB de Vercel** (`413 FUNCTION_PAYLOAD_TOO_LARGE`) |
| Validación de MIME | **Imposible**: Storage confía en el `Content-Type` que manda el browser | **Magic bytes reales**, del lado del servidor |
| Hash del contenido | El servidor nunca ve los bytes | SHA-256 exacto |
| PDF | Igual | Igual |
| Round trips | 3 (pedir URL, subir, confirmar) | **1** |

El pedido explícito es *"MIME y tamaño validados en el servidor, no confíes en el
`Content-Type` que manda el browser"*. **Con la opción A eso es literalmente
imposible**: los bytes no pasan por nosotros.

Y la objeción obvia a B —el límite de 4,5 MB de Vercel contra una foto de
celular— **se cae sola, porque el repo ya resolvió ese problema**:
`views/admin/catalogo/image-upload.ts` comprime con canvas a 1600 px y JPEG 0.82
antes de subir, y saca fotos de 6 MB a ~300 KB. Y la compresión con canvas tiene
una propiedad de seguridad que se suele pasar por alto: **re-encodea los píxeles,
así que la salida es un JPEG genuino producido por el browser, cualquiera haya
sido la entrada.** El vector de "subir un ejecutable con Content-Type de imagen"
desaparece antes de llegar al servidor, y el servidor lo vuelve a verificar igual.

**Decisión: opción B.** Un solo `POST multipart`, el browser comprime primero
(reusando el patrón existente, sin duplicarlo), el servidor valida bytes reales y
sube con el admin client.

#### PDF: se acepta

Con **una sola oportunidad de subida**, rechazar el PDF del homebanking —que es
lo que mucha gente tiene a mano— sería mandar al cliente al escape hatch de
WhatsApp por una limitación nuestra. Se acepta, con dos reglas:

- Los PDF **no se comprimen** (no hay canvas que valga): pasan tal cual, con tope
  duro de 4 MB en el servidor, rechazado con un mensaje claro **antes** de que
  Vercel devuelva su `413` genérico.
- Se valida por **magic bytes**: `%PDF-` (`25 50 44 46`) para PDF,
  `FF D8 FF` para JPEG. Nada más. El `allowed_mime_types` del bucket queda en
  `['image/jpeg','application/pdf']` — angosto a propósito, porque el browser
  siempre produce JPEG y el PDF es el único pasajero crudo.
- El visor del staff abre el PDF en pestaña nueva; la imagen se muestra inline.

#### El bucket

`order-receipts`: **privado**, `file_size_limit` 5 MB (backstop por encima de
nuestro tope de 4 MB), MIME como arriba, y **cero policies para `anon` y
`authenticated`** — ni de lectura ni de escritura. Igual que
`store_payment_credentials`: el único camino es `service_role` detrás de un
chequeo explícito. Las URLs firmadas de lectura las emite nuestro servidor y no
necesitan policy.

**Path determinístico: `{store_id}/{order_id}/comprobante`, sin extensión.** El
primer segmento sigue siendo `store_id` por convención del repo. El MIME real
vive en la fila del pedido y se le pasa a `createSignedUrl` al leer. Con un solo
comprobante por pedido, esto garantiza **un objeto por pedido, como máximo, para
siempre**.

#### "Un comprobante por pedido" como invariante de base, no como `if`

La regla del dueño se implementa en tres capas, y **la que manda es Postgres**:

1. **La columna `transfer_receipt_uploaded_at` es inmutable una vez seteada.**
   Entra a `private.enforce_order_rules`: si `old` no es null y `new` difiere,
   `raise`. **Nunca se nulea**, ni siquiera al purgar la imagen (§5.8) — es el
   registro durable de "este pedido ya usó su oportunidad", y sobrevive al
   borrado del archivo.
2. **El UPDATE del route handler lleva `.is('transfer_receipt_uploaded_at', null)`**
   — compare-and-swap, igual que `markPaidInStore`. Dos subidas simultáneas: una
   gana, la otra recibe un 409 con texto de dominio. Un `if` en el servidor
   perdería esa carrera.
3. **El balde de rate limit** `receipt:order`, **1 cada 8 h**, es la ventana
   anti-abuso del endpoint que pidió el dueño. No es una segunda oportunidad: la
   oportunidad ya la consumió la capa 1.

Segundo balde `receipt:ip`, 20/1 h, contra un script que pruebe tokens. Los dos
**fail-open**, como el default del repo: si Postgres no responde, negar la subida
no protege nada y el pedido ya está roto igual.

**El orden de operaciones importa**: rate limit → validar el pedido (token,
`payment_method='transfer'`, `payment_status='pending'`, no terminal, sin
comprobante previo) → validar los bytes → subir a Storage → **UPDATE con CAS**.
Si el CAS falla después de subir, se borra el objeto recién subido (best-effort)
y se devuelve 409. Subir antes de escribir y no al revés, porque un objeto
huérfano se barre y una fila que miente no.

#### Cómo lo ve el staff

Una Server Action detrás de `requireStoreMembership(storeId)` que devuelve
`createSignedUrl(path, 300)`. Cinco minutos: suficiente para mirar, corto para
que un link copiado no sirva mañana. **El cliente anónimo nunca recibe una URL de
lectura**: la pantalla de seguimiento solo dice "comprobante recibido".

#### Columnas nuevas en `orders`

```
transfer_receipt_path        text
transfer_receipt_uploaded_at timestamptz   -- INMUTABLE una vez seteada, nunca se nulea
transfer_receipt_mime        text
transfer_receipt_size        int
transfer_receipt_sha256      text
```

Todas nullables, todas escritas solo por `service_role` (`orders` tiene
`revoke update from authenticated` + `grant update (status)` y nada más:
**no hace falta ni se debe agregar ningún grant**).

Índice parcial para la bandeja y el barrido:
`create index orders_transfer_pending_idx on orders (store_id, created_at) where payment_method = 'transfer' and payment_status = 'pending';`

> **Alternativa descartada: tabla `order_transfer_receipts`.** Un join más en
> `ORDER_WITH_ITEMS_SELECT` (que usa `*`) y en el mapper, para una relación
> 1:0-1 de cinco escalares. Precedente explícito del repo: *"El delivery no
> agregó ni una tabla: son columnas sobre `stores`, `orders` y `store_members`."*

### 5.8 Retención y barrido

**Un solo mecanismo.** El barrido vive en el handler
`src/app/api/cron/cleanup/route.ts` (Vercel Cron, diario 04:30 UTC), **no dentro
de `cleanup_old_records`**, y el motivo es técnico, no de gusto: **borrar filas de
`storage.objects` con SQL no borra el archivo del backend de objetos.** La única
forma correcta es la API de Storage, que es TypeScript. La RPC sigue barriendo
sus cuatro tablas sin cambios; el handler suma un paso:

1. Modelo (solo lectura): `listPurgeableReceipts()` → `{ orderId, path }[]`.
2. `admin.storage.from('order-receipts').remove(paths)`.
3. Modelo: nulear `transfer_receipt_path` y `transfer_receipt_mime` **solo de los
   que efectivamente se borraron**. Si el paso 2 falla, la fila sigue apuntando y
   el próximo tick reintenta. Nulear primero dejaría el objeto huérfano para
   siempre.

`transfer_receipt_uploaded_at`, `size` y `sha256` **se conservan**: la huella
queda, la imagen no.

| Caso | Se borra la imagen |
|---|---|
| Transferencia confirmada (`paid_at` no nulo) | **24 h después de `paid_at`** — D5, decidido |
| Cualquier otro con comprobante (cancelado, o `pending` eterno) | **7 días después de `transfer_receipt_uploaded_at`** |

**[DECIDIR] D5 — 48 h vs. borrado inmediato al marcar pagado.** El pedido
original dice "al marcar como pagado borramos la imagen". El motivo (no
acumular) es correcto; el **momento** es el peor posible: la disputa aparece
*después* de marcar pagado ("me lo cobraste dos veces", "la transferencia se
revirtió"), no antes. La aritmética no aprieta: un comprobante comprimido pesa
~300 KB, hay como máximo uno por pedido, y 30 transferencias por día × 24 h son
~22 MB contra 1 GB de free tier.

**DECIDIDO (2026-08-31): 24 h después de `paid_at`, un solo camino de borrado.**
El dueño acortó la ventana propuesta a la mitad. La constante vive en un solo
lugar del handler del cron; el margen contra una disputa del día siguiente se
mantiene y el storage baja a la mitad.

### 5.9 "Marcar pagado" NO depende del comprobante, y el escape hatch es WhatsApp

Dos consecuencias directas de la decisión del dueño, y las dos son vinculantes:

1. **`confirmTransferPayment` no exige comprobante.** Si la resolución fue por
   WhatsApp, el staff confirma igual. La acción del servidor **no** valida
   `transfer_receipt_path is not null`, y el borrado del archivo al confirmar es
   **un no-op tranquilo** cuando no hay nada que borrar. El botón "Confirmar
   pago" está habilitado con o sin imagen; lo que cambia es el contexto que la
   tarjeta muestra.
2. **Botón "Escribirle por WhatsApp"** en el detalle del pedido del admin. Es un
   deep link `wa.me` al `customer_phone_e164` del pedido, con texto prellenado
   (nombre, `short_code`, y el problema). **Reusa la normalización que ya existe**
   — `orders.customer_phone_e164` ya está en E.164 porque `phoneSchema`
   (`order.schema.ts:115`) lo normalizó al crear el pedido, con la trampa del
   "15" de Córdoba ya resuelta. **El link es
   `https://wa.me/${phone.replace(/\D/g,'')}`, exactamente como
   `store-dock.tsx:57` y `whatsapp-link.adapter.ts:68-70`.
   Nadie escribe una segunda normalización.**

### 5.10 Expiración del pedido abandonado

`expire_pending_orders` pasa a barrer también las transferencias:

- `payment_method = 'transfer'` **sin comprobante** y más viejo que
  `p_transfer_minutes` (propuesta: **120 minutos**; más que los 45 de online
  porque el cliente tiene que salir de la app, abrir el homebanking y volver.
  Pago Nube usa 24 h, pero es e-commerce general: **la comida no espera un día**).
- **Con comprobante: nunca se cancela sola.** Hay plata declarada y esa decisión
  es de una persona. Queda en la bandeja del KDS.

**Trampa de migración (§7.3):** agregar un parámetro **crea una sobrecarga**, no
reemplaza la función. Hay que `drop function public.expire_pending_orders(int)`
explícito.

### 5.11 Confirmación por código

Se reusa entero. `store_pending_changes.kind` gana **`'bank_account'`**:

- CHECK del `kind` extendido en la migración; `PendingChangeKind`
  (`store-pending-change.model.ts:23`) extendido.
- Payload jsonb: `{ cbu, alias, holderName, holderTaxId, bankName, holderMatch, checkedAt }`.
  **No se cifra**, a diferencia del access token de Mercado Pago: esto no es un
  secreto — el CBU se publica a los clientes. Cifrarlo daría una falsa sensación
  y complicaría el despacho sin ganar nada. (El código sigue guardándose como
  HMAC, nunca en claro.)
- Lo aprueba **el mismo dueño que lo pidió** (`requested_by` tiene que coincidir):
  es confirmación de identidad, no escalación de permiso. La RPC
  `claim_store_pending_change` ya lo exige; no hay que tocarla.
- Balde nuevo **`bank_account_change:store`, 3/1 h, `mode: 'deny'`
  (fail-closed)**, exactamente como `payment_change:store`. Toca las credenciales
  de cobro: si la base no responde, no se cambia un CBU.
- El despacho en `confirmPendingChangeAction` (`admin.actions.ts:524-554`) gana
  una tercera rama: upsert en `store_bank_accounts` + `revalidatePath('/admin/pagos')`.

**Cambiar el CBU vuelve a pasar por el código, siempre.** Apagar (`is_active`) o
borrar la cuenta, **no**: el código existe para impedir que una sesión robada
**redirija plata**, y apagar o borrar no redirige nada — solo apaga el medio de
pago, que es una decisión que el dueño tiene derecho a tomar rápido y sin
esperar un mail. Y volver a encenderlo con otro CBU sí exige el código, porque
eso es un alta. La asimetría es deliberada: **el código protege el destino de la
plata, no la disponibilidad del método.**

### 5.12 Mapa de componentes

```
Postgres  ── store_bank_accounts (tabla nueva; grants por columna; policy anon = is_active)
          ── stores.transfer_payment_enabled (derivada; trigger sync_store_transfer_payment)
          ── orders.payment_method CHECK += 'transfer'
          ── orders.transfer_receipt_* (5 columnas) + índice parcial
          ── payments_provider_check += 'transfer'
          ── store_pending_changes.kind CHECK += 'bank_account'
          ── enforce_order_rules: predicado a `<> 'in_store'` + uploaded_at inmutable
          ── expire_pending_orders: DROP + recreate con p_transfer_minutes
          ── platform_stores: SEXTA reescritura (+ transfer_payment_enabled)
          ── Storage: bucket privado `order-receipts`, sin policies

lib/      ── cbu.ts (NUEVO, PURO, sin server-only): checksum, entidad→banco, alias
          ── store-availability.ts (+ transferPaymentEnabled)
          ── storage.ts (+ ORDER_RECEIPTS_BUCKET, orderReceiptPath())
          ── rate-limit-policy.ts (+ 3 baldes) y types.ts (+ 3 al union)

services/ ── bank-validation/ (NUEVO): port + certisend.adapter + manual.adapter + index

models/   ── store-bank-account.model.ts (NUEVO)
          ── order.model.ts (transfer en createOrder; markPaidByTransfer;
                             attachReceipt; listPurgeableReceipts; clearReceiptRefs;
                             getPendingTransferOrders)
          ── mappers/store.mapper.ts (+ transferPaymentEnabled, + bankAccount)
          ── schemas/order.schema.ts (+ 'transfer'; receiptUploadSchema)
          ── schemas/store.schema.ts (bankAccountInputSchema, con el checksum en un refine)
          ── store-pending-change.model.ts (+ kind 'bank_account')

controllers ── admin.actions.ts     (requestBankAccountChangeAction, deleteBankAccountAction,
                                     toggleBankAccountAction, + rama en confirmPendingChangeAction)
            ── admin.controller.ts  (getBankAccountStatus, lookupBankHolder)
            ── kitchen.actions.ts   (confirmTransferPaymentAction, receiptUrlAction)
            ── kitchen.controller.ts(confirmTransferPayment)

app/      ── api/orders/[token]/comprobante/route.ts  (NUEVO: POST multipart)
          ── api/cron/cleanup/route.ts                (+ purga de comprobantes)

views/    ── admin/pagos/bank-account-form.tsx   (NUEVO)
          ── storefront/checkout-form.tsx        (3 métodos, no 2)
          ── storefront/transfer-panel.tsx       (NUEVO: CBU + subida de un solo tiro)
          ── admin/kds/transfer-tray.tsx         (NUEVO: bandeja + visor + WhatsApp)
          ── shared/order-status.tsx             (PaymentNotice con 3 casos)
```

---

## 6. Cuestiones transversales

### 6.1 Aislamiento multi-tienda

`store_bank_accounts` está scopeada por PK `store_id`; la policy de `anon` exige
tienda activa y `is_active`. El path del comprobante arranca con `store_id` y lo
deriva **el servidor** a partir del pedido resuelto por token, nunca el cliente.
Toda escritura del staff lleva `.eq('store_id', storeId)` explícito además del
`requireStoreMembership`, siguiendo la nota de `CLAUDE.md` sobre la asignación de
repartidor (el trigger valida la relación, no la pertenencia del pedido).

### 6.2 Autoridad del precio

Sin cambios: el cliente sigue mandando IDs y cantidades. El monto a transferir
sale de `orders.total_cents`, inmutable por trigger. **El staff no puede tipear
"cuánto entró"**: confirma o no confirma. Si entró un monto distinto, no se
confirma — se resuelve por WhatsApp y se cancela o se cobra la diferencia en el
mostrador. Un campo de "monto recibido" abriría la puerta a confirmar un pedido
de $30.000 con $3.000. *(Nota: Talo modela esto con `OVERPAID`/`UNDERPAID` de
primera clase. Es la forma correcta el día que haya conciliación automática; sin
ella no hay dato con el que poblarlos.)*

### 6.3 Secretos

No hay secreto nuevo del lado del CBU (se publica). Si entra el adapter
Certisend, sí aparece una credencial de API: va por env, `server-only`, y **nunca
se loguea la respuesta cruda** (contiene un nombre de persona). El código de 6
dígitos sigue guardándose como HMAC con `CREDENTIALS_ENCRYPTION_KEY`.

### 6.4 Datos personales

Una imagen de una transferencia contiene nombre, CBU y a veces CUIT del cliente.
Es dato personal de un tercero, subido sin cuenta. **Eso refuerza el pedido del
dueño**: la retención corta es lo correcto, y no solo por storage. Dos
consecuencias que son tarea, no detalle:

1. **`/legal/privacidad` tiene que actualizarse.** Hoy describe el comportamiento
   real y no menciona ningún archivo subido por el cliente. `CLAUDE.md` es
   explícito: *"si cambian las claves de `localStorage`, el proveedor de pago o el
   de email, queda desactualizada"*. Esto es un cambio de esa clase.
2. El texto del control de subida dice qué pasa con la imagen y por cuánto tiempo
   se guarda, **antes** de subirla.

### 6.5 Modos de falla y rollback

| Falla | Qué pasa | Mitigación |
|---|---|---|
| Storage caído al subir | 502 y el cliente no puede subir | La pantalla ofrece el fallback: mandar el comprobante por WhatsApp. **El pedido no se pierde** y el staff puede confirmar sin imagen (§5.9) |
| El CAS falla después de subir | Objeto subido, fila sin actualizar | Se borra el objeto (best-effort) y se devuelve 409. Si el borrado falla, el barrido de 7 días lo levanta |
| Dos operarios confirman a la vez | 409 | CAS sobre `orders` + `payments_one_approved_per_order_idx` |
| Se borró la imagen y aparece una disputa | Sin imagen | `size` + `sha256` + `uploaded_at` + número de operación en `payments.raw`, que no se borran |
| El local carga un CBU con un dígito mal | La plata se pierde | Checksum en Zod (rechaza antes de guardar) + contraste con la API si hay proveedor |
| Comprobante falso | El local entrega sin cobrar | **No se mitiga con software** (§3.3). Se mitiga con copy: la pantalla del staff dice "mirá tu cuenta", no "mirá el comprobante" |
| API de validación caída | — | El adapter devuelve `null`, `holder_match = 'unavailable'`, el flujo sigue |
| Rollback del feature | Tiendas con el flag en `true` y pedidos `transfer` vivos | §7.2 |

### 6.6 Cache y revalidación

`revalidatePath('/admin/pagos')` al confirmar el cambio de cuenta (patrón ya
presente en `confirmPendingChangeAction`). La vitrina lee la tienda por request
(`getStoreBySlug` está memoizado con `cache()` **por render**, no entre requests),
así que un cambio se ve en la siguiente carga. **La bandeja del KDS se alimenta
del poll de 30 s + Realtime que ya existen**: el staff tiene SELECT sobre
`orders`, así que —a diferencia de la cola del repartidor— Realtime **sí** dispara
acá. Cero mecanismo nuevo de refresco.

### 6.7 Observabilidad

Cada confirmación deja fila en `payments` y evento en `order_events` por el camino
de cambio de estado que ya existe. El barrido devuelve un conteo en el JSON del
cron, como los demás. La subida loguea con IP truncada, igual que
`/api/orders/[token]`.

---

## 7. Seguridad de la migración

**Todas las migraciones las escribe el hilo principal. Ningún agente toca
`supabase/migrations/` ni resetea la base.**

### 7.1 Orden y aditividad

Todo es **aditivo** salvo dos reemplazos de función (`enforce_order_rules`,
`expire_pending_orders`) y un `drop function`. Vercel y `db push` corren en
paralelo desde el mismo push, así que la ventana en la que uno está y el otro no
tiene que ser inocua:

- **Migración primero, código después: seguro.** Un CHECK que admite
  `'transfer'` y una tabla nueva no molestan al código viejo.
- **Código primero, migración después: rompería** — el checkout ofrecería
  transferencia y `create_order` fallaría con `23514`. **Mitigación estructural:
  `transfer_payment_enabled` arranca en `false` para todas las tiendas.** Aunque
  el código salga primero, ninguna vitrina ofrece el método hasta que alguien
  cargue una cuenta, y eso solo se puede hacer con la tabla ya creada.
  **El opt-in por tienda ES la protección de la ventana.**

### 7.2 Reversibilidad

Bajar el código es seguro mientras no haya pedidos `transfer` vivos. Con pedidos
vivos, el rollback deja filas que el código viejo no entiende: `PaymentNotice`
caería en su rama `else` (muestra el label de `payment_status`, que es correcto) y
el KDS los ignoraría por estar en `pending`. **No corrompe nada, pero deja
pedidos huérfanos.** Procedimiento: apagar el flag en todas las tiendas
(`update store_bank_accounts set is_active=false` con `service_role`), esperar a
que los `transfer` vivos se resuelvan, y recién ahí bajar el código.

### 7.3 Trampas concretas de esta migración

1. **`expire_pending_orders`**: agregar parámetro crea una **sobrecarga**. Hace
   falta `drop function public.expire_pending_orders(int);` explícito, y volver a
   `revoke execute … from public, anon, authenticated` + `grant … to service_role`
   sobre la firma nueva.
2. **`cleanup_old_records`**: **en este plan NO se toca** (la purga va en
   TypeScript, §5.8). Si alguien la toca, tiene que **copiar los cuatro `delete`
   existentes** — vigente en `20260829150000_rate_limits.sql:140`.
3. **`platform_stores`**: sexta reescritura completa, enumera columnas a mano.
   Una columna nueva que no se agregue **desaparece sin error**.
4. **`create_order`**: NO hace falta tocarla — pasa `payment_method` como texto
   (verificado en `20260829170000:551`).
5. **CHECKs con nombre** (`orders_payment_method_check`,
   `payments_provider_check`): `drop constraint` + `add constraint`, con el patrón
   idempotente del skill de Supabase (`do $$ … pg_constraint … $$`), porque
   Postgres no tiene `add constraint if not exists`.
6. **Grants de `store_bank_accounts`**: por columna para `anon` y `authenticated`,
   **y explícito para `service_role`** — sin él, `42501 permission denied` aunque
   bypassee RLS, y el síntoma no menciona los privilegios.
7. **`database.types.ts`** se regenera con `npm run db:types` desde el hilo
   principal; el CI compara el drift.
8. **Verificar con `curl` y la secret key** que `service_role` puede escribir en
   `store_bank_accounts` y subir/firmar en `order-receipts` **antes** de dar la
   migración por buena. Es el procedimiento que `CLAUDE.md` exige para toda tabla
   nueva, y costó un bug bloqueante la vez que no se hizo.

---

## 8. Preguntas abiertas y supuestos

### Ya decididas por el dueño durante la planificación — no se reabren

- **D1 — quién confirma la cuenta bancaria: el DUEÑO DEL LOCAL**, con el código de
  6 dígitos, reusando `store_pending_changes`. **Nada de aprobación desde
  `/backoffice`.** La opción de revisión por plataforma que este documento
  proponía en su v1 quedó descartada. §5.11
- **D4 — un pedido por transferencia impago NO pasa a `confirmed`**, y la regla
  vive en Postgres. §5.5
- **D6 — un comprobante por pedido, un solo tiro.** El escape hatch es humano: el
  botón "Escribirle por WhatsApp" en el detalle del pedido del admin. Riesgo
  aceptado a conciencia. §5.7, §5.9
- **Retención y barrido**: aprobados. §5.8

### Resueltas por el dueño del producto — 2026-08-31

- **D0 — se construye el flujo MANUAL ahora.** No se evalúa proveedor de
  conciliación automática en esta tanda. El pushback de §3.3 queda registrado y
  el seam `getPaymentProvider()` sigue siendo el lugar por donde entraría.
- **D2 — SÍ.** "Validar el titular" es checksum + declaración + contraste
  opcional, y **el cliente no ve ningún sello de "verificado"**. Prohibido
  escribir copy que lo sugiera. §3.2, §4.1
- **D3 — el dueño puede cargar cualquiera de los TRES identificadores: CBU, CVU
  o alias.** Se aparta de la recomendación de §4.2, que pedía CBU obligatorio.
  Implementación: `cbu` es nullable (CBU y CVU comparten formato de 22 dígitos y
  la misma columna), `alias` es nullable, y un CHECK
  (`store_bank_accounts_has_identifier_check`) exige que haya **al menos uno**.
  **Consecuencia aceptada a conciencia:** una cuenta cargada solo con alias no
  tiene checksum que validar, así que un error de tipeo no se puede detectar y el
  local se entera cuando un cliente le transfiere a otra cuenta. La UI de
  `/admin/pagos` **tiene que advertirlo** cuando el dueño guarda solo alias.
- **D5 — la imagen se borra 24 HORAS después de `paid_at`**, no 48 y no al
  instante. Un solo camino de borrado, dentro del handler del cron de cleanup.
  La ventana de los casos sin confirmar (cancelado o `pending` eterno) queda en
  7 días como estaba.
- **D7 — no entra ahora.** No se abre conversación comercial por un producto
  match-only. El adapter de validación automática queda como no-op.

### Investigación cerrada

- **§3.4 — `Fintech_AR_CBU_GOLD` (Certisend/Sysworld): NO VIABLE hoy.**
  Sin sandbox, sin autoservicio para ese producto, sin precio publicado, sin SLA,
  con los secretos en la query string y con su propia status page marcando el
  componente en 0,000 % de uptime durante 90 días. **No bloquea el plan**: el
  adapter es opcional por diseño y el camino manual es de primera clase.

### Supuestos declarados (si alguno es falso, cambia el diseño)

- El proyecto hosted está en paridad con `supabase/migrations/` — verificado
  (28 = 28) el 2026-08-30.
- `product-images` es el único bucket — verificado contra el hosted.
- `service_role` puede subir y firmar sobre un bucket sin policies (bypassea RLS
  en `storage.objects`). **No verificado contra el proyecto real**: es el punto 8
  de §7.3.
- El local piloto tiene una cuenta bancaria a nombre del comercio o de su dueño.
- **No se agrega plantilla de mail nueva.** El aviso al local de "subieron un
  comprobante" es la bandeja del KDS + el poll/Realtime que ya existen. Un mail
  sería una novena plantilla y alcance extra.
- El `short_code` alcanza como referencia de la transferencia. No se cambia el
  total para hacerlo único (eso sería tocar el precio, y el precio lo pone el
  servidor por otras razones).
