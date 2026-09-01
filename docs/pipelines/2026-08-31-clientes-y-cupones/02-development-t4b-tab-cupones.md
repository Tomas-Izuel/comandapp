# T4B — Frontend: la tab de Cupones

Implementado por `frontend-react-craftsman`. Consumió los tres briefs de
`.impeccable/surfaces/` (`coupon-sheet`, `campaign-sheet`, `directory-table`),
`01-tasks.md` §T4B, `00-architecture.md` §5.5.1, §5.6, §5.7.2.4, §5.9.3, §5.9.4,
§5.10.3.1, §5.10.6, §5.11.3, §5.14.4, §5.14.5, el informe de T1B
(`02-development-t1b-backend-cupones.md`), y las firmas reales de
`marketing.controller.ts` / `marketing.actions.ts` / `coupon.model.ts` /
`coupon.schema.ts` / `lib/coupon.ts` / `types.ts` (no se inventó ninguna).

Durante el desarrollo el hilo principal corrigió `requiresConfirmation()` en
`src/lib/coupon.ts` (mensaje del coordinador, 2026-09-01): mientras el
`status` resultante de un cambio no sea `active`, nunca pide código. El aviso
del pie de `coupon-sheet.tsx` se escribió (y se revisó) contra esa versión.

## Archivos creados

- `src/app/admin/(app)/clientes/cupones/page.tsx`
- `src/views/admin/clientes/cupones/cupones-view.tsx` — el orquestador: dos
  secciones (`Cupones`, `Campañas`) con `PanelHeading`, y un solo estado de
  "qué hoja está abierta" para las tres hojas (crear/editar, detalle,
  campaña).
- `src/views/admin/clientes/cupones/coupon-list.tsx` — la lista, con acciones
  por fila.
- `src/views/admin/clientes/cupones/coupon-sheet.tsx` — crear/editar, los dos
  tiempos, el peor caso en vivo, el aviso del pie.
- `src/views/admin/clientes/cupones/coupon-detail.tsx` — la hoja de detalle
  (solo lectura + pausar/borrar/editar/mandar).
- `src/views/admin/clientes/cupones/campaign-list.tsx` — el log, solo lectura.
- `src/views/admin/clientes/cupones/campaign-sheet.tsx` — el flujo de envío.
- `src/views/admin/clientes/cupones/payment-method-checks.tsx` — los tres
  checkboxes de método de pago.
- `src/views/admin/clientes/cupones/confirm-coupon-code.tsx` — el paso del
  código de 6 dígitos para cupones (por qué es un archivo aparte de
  `confirm-with-code.tsx`: ver más abajo).
- `src/views/admin/clientes/cupones/confirm-delete-coupon.tsx` — confirmación
  de borrado, reusado por la hoja y por el detalle.
- `src/views/admin/clientes/cupones/coupon-whatsapp-menu.tsx` — el menú de
  cupones del botón de WhatsApp del padrón (criterio de aceptación 0).
- `src/views/admin/clientes/cupones/format.ts` — helpers puros locales
  (etiquetas de segmento/estado, conversión de fecha local↔ISO para la
  vigencia, el generador de código del lado del cliente).
- `src/components/ui/dropdown-menu.tsx` — **primitiva nueva**, ver más abajo.

## Archivos editados (reasignados a este slice por el hilo principal)

- `src/views/admin/clientes/customer-row.tsx` — el botón de WhatsApp pasa a
  `CouponWhatsappMenu`; sin cupones activos se comporta exactamente igual que
  antes (link directo, sin menú).
- `src/views/admin/clientes/whatsapp-message.ts` — sumó
  `buildCustomerCouponMessage()`, el tercer mensaje.

No toqué `directory-table.tsx`/`customer-directory.tsx`, `format.ts` de nivel
superior, `clientes-tabs.tsx`, `customer-sheet.tsx`, `shell.tsx`,
`src/models/**`, `src/controllers/**`, `src/lib/coupon.ts`, `src/lib/money.ts`,
`src/models/types.ts`, ni `supabase/migrations/**`.

## Primitiva nueva: `src/components/ui/dropdown-menu.tsx`

No existía un wrapper de `DropdownMenu` en `components/ui/` (sí existían
`select.tsx`, `dialog.tsx`, etc., todos sobre el paquete `radix-ui` ya
instalado — `DropdownMenu` viene incluido en ese mismo paquete, así que no hizo
falta ninguna dependencia nueva). Hacía falta para dos usos: el menú de
cupones del botón de WhatsApp y el menú de "más acciones" (duplicar/borrar) de
cada fila de la lista de cupones. Sigue las mismas convenciones que el resto
de `components/ui/` (`data-slot`, variantes `data-open`/`data-closed` del
preset Nova, `bg-popover` + `ring-1 ring-foreground/10`). Los ítems son
`min-h-11` (44px) a propósito: uno de los dos usos cuelga de un botón de
contacto que se toca con el pulgar.

## Decisiones no obvias, y por qué

### 1. `ConfirmWithCode` NO es reusable sin editarlo — construí un hermano

El brief pedía: *"reusar el diálogo de confirmación que ya existe en
`/admin/pagos` si es reusable sin editarlo; si hay que tocarlo, reportar y
parar."* Lo leí completo antes de decidir. `ConfirmWithCode`
(`views/admin/shared/confirm-with-code.tsx`) no recibe la acción de confirmar
como prop: importa `confirmPendingChangeAction` **directo** desde
`admin.actions.ts`. Esa función tiene un switch cerrado sobre `change.kind`:
rama para `payment_credentials`, rama para `bank_account`, y **cualquier otro
kind cae en la rama final**, que hace
`admin.from('stores').update({ courier_collects_payment: ... })`. Con
`kind: 'coupon'` eso hubiera ejecutado una escritura equivocada sobre la
tienda (probablemente `courier_collects_payment: false`, porque
`change.payload.courierCollectsPayment` es `undefined` para un payload de
cupón) en vez de aplicar el cambio de cupón real. No es un detalle cosmético:
es un bug de escritura.

Ni `confirm-with-code.tsx` ni `admin.actions.ts` son archivos de este slice, así
que no los toqué — es exactamente el "parar y reportar" que pide el brief,
aplicado a ESE archivo puntual. Para no bloquear el resto del slice, construí
`confirm-coupon-code.tsx`: mismo layout, mismo input, mismos 10 minutos, mismo
"mandar otro código", pero con `confirmCouponChangeAction` (T1B, que sí
despacha bien por `payload.action`) para confirmar. Para reenviar sí reusé
`resendPendingChangeCodeAction` de `admin.actions.ts` tal cual, porque **ésa
no bifurca por `kind`** — re-envía con el `kind`/`payload` de la solicitud
viva, así que es segura de importar sin editar nada.

**Recomendación para el hilo principal**: `confirmPendingChangeAction` debería
tener una rama explícita para `'coupon'` (delegando a la misma lógica que
`confirmCouponChangeAction`) o, como mínimo, tirar un error explícito para un
`kind` no reconocido en vez de caer en la escritura de
`courier_collects_payment` por default. Es un riesgo que no depende de
cupones: cualquier `kind` nuevo que se agregue a `store_pending_changes` en el
futuro pisa esa misma trampa.

### 2. Bug menor encontrado, no mío para arreglar: `resendPendingChangeCodeAction` pierde el `subjectId`

Leyendo `admin.actions.ts` para el punto anterior: `resendPendingChangeCodeAction`
llama a `startPendingChange({ storeId, userId, email, storeName, timezone, kind, payload })`,
que a su vez llama a `createPendingChange({ storeId, userId, kind, payload })`
— **sin `subjectId`**. O sea que reenviar el código de una activación de
cupón crea una solicitud nueva con `subject_id = null`, perdiendo el scoping
por cupón que T1B introdujo justamente para que activar el cupón A y
después el B no se invaliden el código entre sí (§5.11.3). Es un caso de
esquina (reenviar, no pedir de cero) y de bajo impacto, pero lo dejo
documentado para quien sea dueño de `admin.actions.ts`.

### 3. El detalle del cupón se precarga ENTERO en `page.tsx` — no hay fetch bajo demanda

`getCouponDetailForStore` (T1B, `marketing.controller.ts`) es `server-only` y
no hay una Server Action de lectura que la exponga a un Client Component
(`marketing.actions.ts` no tiene una, y agregarle una es tocar un archivo que
no es de este slice). Como las views no pueden fetchear, la alternativa que
respeta la arquitectura es que `page.tsx` traiga el detalle de **todos** los
cupones de una vez, en paralelo (`Promise.all`), y se lo pase entero a
`CuponesView` como `CouponDetail[]`. Al abrir la hoja de detalle de una fila no
hay ningún round trip: los datos ya están en el árbol. Para el volumen de
cupones de un local (una lista de promociones, no un catálogo de productos)
esto es liviano. Si algún día un local tiene cientos de cupones activos a la
vez, ahí sí conviene una Server Action de detalle bajo demanda — no es
necesario hoy y no lo until construí especulativamente.

### 4. Los `released` NO aparecen en la lista de canjes del detalle — gap de contrato, no mío para cerrar

El brief y `01-tasks.md` piden explícitamente: *"Los últimos 20 canjes... Los
`released` se muestran con un `StatusPill` y su motivo — son diagnóstico, van
en la fila y no en el titular."* Verifiqué contra el contrato real
(`couponDetailRpcSchema`, `CouponRedemptionRow` en `types.ts`) y
**`recentRedemptions` solo trae canjes CONFIRMADOS** — el comentario del
propio tipo lo dice ("Una fila de la lista de canjes del cupón. Solo canjes
CONFIRMADOS."), y `coupon_detail()` (la RPC de T1B) no expone ninguna fila
`released` ni su `released_reason`. No hay forma de mostrar lo que el brief
pide sin un campo que el contrato de T1B no tiene, y `types.ts` /
`coupon.schema.ts` no son archivos de este slice.

Implementé la lista con lo que el contrato SÍ da (los últimos canjes
confirmados, con el total real al lado), documenté el hueco en el propio
componente (`coupon-detail.tsx`), y lo reporto acá para que el hilo principal
decida: si el producto quiere esa fidelidad exacta, hace falta sumar a
`coupon_detail()` (y a `couponDetailRpcSchema`/`CouponRedemptionRow`) los
`released` recientes con su motivo — no es un cambio grande, pero es un
cambio de contrato que no me corresponde hacer.

**Consecuencia derivada**: el heurístico de "¿se puede borrar?" en el cliente
(`reservedCount === 0 && redeemedCount === 0`) no puede detectar un cupón sin
reservas ni canjes vivos pero con algún `released` viejo — ese caso sigue
ofreciendo el botón "Borrar", que el servidor rechaza correctamente
(`deleteUnusedCoupon` traduce el `23503` al mensaje de interfaz "Este cupón ya
se usó: se puede pausar, no borrar."), así que no hay riesgo de borrar algo
indebido, pero el botón se ofrece cuando en rigor no debería. Documentado
inline en `confirm-delete-coupon.tsx`.

### 5. `activeCoupons` en `CustomerRow` — el prop existe, el dato todavía no llega

El criterio de aceptación 0 pedía el menú de cupones del botón de WhatsApp del
padrón, y el hilo principal reasignó `customer-row.tsx` y
`whatsapp-message.ts` para que lo monte yo mismo (ya no hace falta que T2A lo
haga, porque ya está mergeado). Hice las dos partes que esos dos archivos
pueden hacer:

- `whatsapp-message.ts` suma `buildCustomerCouponMessage()`.
- `customer-row.tsx` reemplaza el botón de WhatsApp por `CouponWhatsappMenu`,
  con un prop nuevo `activeCoupons?: Coupon[]` (default `[]`).

**Lo que falta, y por qué no lo cerré yo**: para que `activeCoupons` traiga
datos reales hace falta que `src/app/admin/(app)/clientes/page.tsx` llame a
`getCouponsForStore(session.store.id)` (ya filtrando `couponState() ===
'active'`, o pasando la lista completa y filtrando en la vista) y que
`customer-directory.tsx` la reciba y la reenvíe a cada `CustomerRow`. **Esos
dos archivos son de T2A y están explícitamente en mi "NO TOQUES"** (`"src/app/admin/(app)/clientes/layout.tsx
ni page.tsx (el del padrón)"`, `"directory-table.tsx"`). No los toqué.

Con `activeCoupons` en `[]` (el default), el comportamiento de HOY es
idéntico al de antes de este cambio: el botón de WhatsApp sigue siendo el
link directo de los dos mensajes de T2A, sin menú — "el menú no se ofrece si
no hay ninguno" se cumple trivialmente porque la lista está vacía. **No hay
ninguna regresión, pero el criterio de aceptación 0 no está completo
end-to-end hasta que alguien con permiso sobre esos dos archivos agregue las
~3 líneas que faltan.** Dejo el diff exacto necesario para quien lo tome:

```ts
// page.tsx del padrón
const [directory, coupons] = await Promise.all([
  getCustomerDirectoryForStore(session.store.id),
  getCouponsForStore(session.store.id),
])
const activeCoupons = coupons.filter((c) => couponState(c) === 'active')
// pasar `activeCoupons` a <CustomerDirectoryView .../>

// customer-directory.tsx
// recibir `activeCoupons: Coupon[]` como prop y pasarlo a cada <CustomerRow activeCoupons={activeCoupons} .../>
```

### 6. El generador de código del lado del cliente duplica al de `coupon.model.ts`

`generateCouponCode()` (T1B) vive en `coupon.model.ts`, que tiene
`import 'server-only'` — inalcanzable desde un Client Component, y no hay
ninguna Server Action que lo exponga (agregar una es tocar
`marketing.actions.ts`, que no es mío). El botón "Generar" de `coupon-sheet.tsx`
necesita sugerir un código sin ida y vuelta al servidor, así que
`format.ts` tiene una copia PURA (`generateCouponCodeClient()`) con el MISMO
alfabeto, largo y cutoff, usando `crypto.getRandomValues` del browser (nunca
`Math.random()`). No es una segunda fuente de verdad de seguridad: el código
que se guarda pasa igual por `couponCodeSchema` y por `coupons_code_check` en
el servidor, así que esta copia solo puede sugerir un código válido, nunca
colar uno inválido. Documentado en el propio archivo.

### 7. Vigencia: fecha (no hora), convertida a la zona del local

El schema pide `z.iso.datetime()` para `startsAt`/`endsAt`. La hoja pide
fecha nomás (un dueño piensa "desde el viernes hasta el domingo", no en
horas). `format.ts` suma `isoToLocalDay`/`localDayToStartIso`/`localDayToEndIso`,
construidos sobre `zonedDayStart`/`zonedDay` de `src/lib/dates.ts` (no
reinventé la aritmética de zona horaria). El "hasta" se guarda como la
medianoche del día SIGUIENTE al elegido, porque `couponState()` compara con
`>=` (límite exclusivo): si `endsAt` fuera la medianoche del propio día
elegido, ese día quedaría vencido desde las 00:00, y el dueño esperaba que
valiera todo ese día.

### 8. El preview de campaña no se dispara por tecla

Igual que el criterio del checkout (`coupon_check:ip` se cobra solo en el
fallo justamente para no necesitar debounce), el preview de campaña
(`previewCampaignAction`) se dispara con un botón explícito ("Calcular
destinatarios"), nunca en el `onChange` de los inputs de N / monto mínimo. Es
la misma doctrina aplicada al mismo problema: no ir al servidor en cada
tecla.

### 9. `worstCaseCents()` toma un `Coupon` completo — la hoja arma un cast documentado

`worstCaseCents(coupon: Coupon)` en `lib/coupon.ts` solo lee cinco campos
(`discountType`, `percent`, `amountOffCents`, `maxDiscountCents`,
`maxRedemptions`), pero su firma pide el tipo completo. En `coupon-sheet.tsx`
el preview en vivo arma un objeto con esos cinco campos y lo castea con
`as unknown as Coupon`, con un comentario explicando por qué (un formulario
que todavía puede no tener fila en la base no tiene el resto de los campos de
`Coupon`, y no hacía falta inventarlos). La vista sigue sin calcular la
fórmula por su cuenta: llama a la función real.

## Acceptance criteria de `01-tasks.md` §T4B — estado

0. **Parcial, documentado en la decisión 5.** El componente del menú existe y
   funciona; falta la plomería de datos en dos archivos de T2A.
1. Un `staff` no llega a la page: `resolveAdminSession()` + `redirect('/admin')`
   si `role !== 'owner'`, mismo patrón que el Padrón.
2. El peor caso se recalcula en vivo (`useMemo` sobre los campos vigilados) y
   dice "sin tope" cuando falta `maxDiscountCents` en un cupón porcentual.
3. Los tres métodos de pago se deshabilitan (no se ocultan) con el motivo y un
   link a `/admin/pagos`, según `session.store.{online,transfer,inStore}PaymentEnabled`.
4. La lista solo ofrece "Borrar" cuando `reservedCount === 0 && redeemedCount
   === 0` (ver el gap documentado en la decisión 4 para el caso de `released`
   sueltos).
4-bis. La columna "Usos" muestra `reserved + redeemed` sobre `maxRedemptions`;
   la hoja de detalle desglosa las tres partes en una línea de texto con el
   helper de "reservados" inline.
5. El aviso de "pide código" / "se aplica al instante" está al pie de la
   hoja, se recalcula en cada render con `requiresConfirmation()` real (no una
   copia), y aparece ANTES de que exista un botón de guardar que lo dispare.
6. `stopped` y `failed` tienen tono y label distintos en `campaign-list.tsx`,
   y `stopped` traduce el motivo a una frase (nunca el enum crudo).
7. El preview de campaña muestra días/última fecha, y el bloqueo por
   vencimiento nombra las tres salidas (estirar vigencia, mandar a menos
   gente, pedir cupo) en el mismo texto que dispara `sendCampaignAction` en el
   servidor si se lo saltea igual.
8. Sin scroll horizontal: grillas con `minmax(0, Xfr)` y `flex-wrap`, drawers
   con `sm:max-w-lg`, mismo patrón que `customer-row.tsx`/`history-list.tsx`.

## Piso de calidad — verificado

- Sin kicker/eyebrow en ningún título.
- Sin `Panel` anidado en ningún archivo nuevo.
- Los tres agregados del cupón, el desglose de la reserva, y las cuatro
  cuentas de campaña son texto — cero tarjetas de métrica.
- Sin emoji: los íconos son de `lucide-react` (`Ticket`, `Send`, `Mail`,
  `Shuffle`, `Copy`, `MoreVertical`, `Trash2`) o `WhatsApp`
  (`components/ui/whatsapp`, ya existente).
- `.tabular` en toda plata, porcentaje, contador y fecha.
- 44px mínimo verificado y corregido: los botones de fila de
  `coupon-list.tsx` (Pausar/Activar/Mandar por mail) arrancaron con
  `size="sm"` (28px) y se subieron al tamaño por default (44px) al revisar
  contra el precedente de `history-list.tsx`, que documenta el mismo piso
  para acciones de fila. Igual corrección en los botones del pedido de cupo
  de `campaign-sheet.tsx`.
- `aria-invalid` + `aria-describedby` por campo con error en `coupon-sheet.tsx`;
  `aria-describedby` en el botón "Mandar" deshabilitado de `campaign-sheet.tsx`
  apuntando al motivo.
- `rounded-lg`/`rounded-pill` (tokens), nunca `rounded-[--radius]`.
- Bug encontrado y corregido durante la auditoría propia: el resaltado de
  "seleccionado" de los radios de tipo de descuento usaba un
  `has-data-checked:` inventado (no compila a nada útil en este preset). Se
  corrigió a `has-[[data-state=checked]]:`, el patrón real que ya usa
  `branding-form.tsx` para el mismo efecto.

## Estados que se implementaron

Sin cupones (`EmptyState` que enseña qué es un cupón) · hoja nueva vacía ·
borrador guardado (sheet se queda abierto, pasa a modo edición con "Activar"
disponible) · aviso "se aplica al instante" / "pide un código" según se tipea
· peor caso acotado / SIN COTA · pidiendo el código · código rechazado (la
hoja no pierde lo tipeado, `code` no se limpia salvo tras confirmar/cancelar)
· activado / pausado (nunca pide código) · `scheduled`/`expired`/`exhausted`
derivados vía `couponState()` · con reservas vivas (desglose de tres partes) ·
sin canjes todavía · borrado rechazado por uso (mensaje del servidor, no la
constraint) · segmento sin elegir / `all` / `top_n` con y sin N / `min_spent`
con y sin monto · `willSend === 0` (botón deshabilitado, motivo visible) ·
`daysNeeded === 1` sin oferta / `> 1` con oferta · bloqueo por vencimiento con
las tres salidas · `maxRedemptions < willSend` informado en tono neutro ·
pedido de cupo enviado / fallado (con el mail de ventas a la vista) · log
vacío / con cada estado de campaña · mobile apilado en todas las listas y
hojas.

## Lo que quedó pendiente / cross-lane, resumido

1. **Bloqueante parcial (criterio 0)**: `activeCoupons` no llega a
   `CustomerRow` porque `customer-directory.tsx` y el `page.tsx` del padrón
   son de T2A. Diff exacto en la decisión 5.
2. **Reportado, no arreglado (no es mi archivo)**: `confirmPendingChangeAction`
   en `admin.actions.ts` necesita una rama para `kind: 'coupon'` (o rechazar
   kinds desconocidos) para no escribir `courier_collects_payment` por
   default con cualquier `kind` futuro.
3. **Reportado, bajo impacto**: `resendPendingChangeCodeAction` no reenvía
   `subjectId`, así que reenviar el código de una activación de cupón pierde
   el scoping por cupón (§5.11.3).
4. **Gap de contrato de T1B**: `coupon_detail()`/`couponDetailRpcSchema`/
   `CouponRedemptionRow` no traen canjes `released`, así que la lista de
   canjes del detalle no puede mostrarlos con su motivo como pide el brief.
5. **Escala, no bug**: el detalle de todos los cupones se precarga de una en
   `page.tsx` por falta de una Server Action de lectura bajo demanda; bien
   para el volumen normal de un local, a revisar si algún día hay cientos de
   cupones activos a la vez.

## Verificación

- `npm run typecheck`: verde.
- `npm run lint`: verde (0 errores, 0 warnings).
- `npm run build`: verde, `/admin/clientes/cupones` compila como ruta
  dinámica del panel.
- `npm test`: 83 archivos, 1023 tests, 4 skip (sin Docker) — sin regresiones,
  incluido `tests/views/clientes-whatsapp-message.test.ts` (los dos mensajes
  de T2A siguen intactos).
- El hook de `impeccable` corrió después de cada edición de UI: "no
  deterministic design-quality issues found" en todos los archivos nuevos.

## Addendum — QC de la coordinación (2026-09-01, sesión posterior)

El dueño probó la pantalla con sesión real y encontró dos bugs reales en
`coupon-list.tsx`, verificados con números (no a ojo). Los dos quedaron
arreglados.

### Bug 1: la tabla no alineaba consigo misma — última columna en `auto`

`lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6rem_9rem_10rem_auto]` se
repetía igual en el encabezado y en cada fila, pero **`auto` hace que CADA
elemento con esa clase resuelva su propia plantilla de grilla según el
contenido de esa columna en ESE elemento**: el encabezado tiene la palabra
"Acciones" (angosta), una fila `active` tiene "Pausar" + "Mandar por mail" +
el menú (ancha). Con seis columnas y dos de ellas en `fr`, la diferencia se
la comen las columnas flexibles — así que el encabezado y cada fila (y filas
entre sí, según su estado) terminaban con anchos de columna DISTINTOS,
verificable comparando `getComputedStyle(...).gridTemplateColumns` de dos
elementos con la misma clase.

**Arreglo**: la última columna pasa a ancho FIJO (`19rem`, medido contra la
fila más ancha posible — Pausar/Activar + "Mandar por mail" + el kebab de
44px), y la clase de grilla completa se extrajo a una constante compartida
(`GRID_COLS`) que usan el encabezado y cada fila. Con las seis columnas
fijas o `minmax(0, Xfr)` con el mismo `minmax`, el string de
`gridTemplateColumns` es idéntico en el encabezado y en toda fila, sea cual
sea el estado del cupón.

### Bug 2: el pill "Sin ese medio" no entraba en la columna de Estado (6rem)

La columna "Estado" es `6rem` (96px) fijo, y un segundo `StatusPill` de aviso
("Restringido a un medio que hoy no cobrás" / "Sin ese medio") se partía en
dos líneas y salía del pill, además de estirar la fila. Dos problemas
distintos, un solo arreglo:

1. **Dónde vive**: se sacó de la columna de Estado (que solo tiene que
   alcanzar para la palabra del estado del cupón) y pasó a vivir DEBAJO del
   código/nombre, en la primera columna (`minmax(0,1.6fr)`, ~490px), tanto en
   la fila mobile como en la de escritorio. Ahí tiene espacio real para leerse
   entero.
2. **Qué dice**: "Sin ese medio" no explicaba nada por sí solo — señalado
   explícitamente por el dueño. Se reemplazó por dos mensajes con severidad
   distinta y el/los método(s) nombrados, sin conjugar verbos (para no pelear
   con singular/plural con hasta 3 métodos):
   - **Todos** los métodos que el cupón permite están inhabilitados hoy → tono
     `danger`, "No se puede canjear: hoy no cobrás con {métodos}" (el cupón
     está muerto, no solo restringido).
   - **Alguno** (no todos) → tono `warning`, "Incluye un medio que hoy no
     cobrás: {métodos}" (el cupón sigue sirviendo por los demás métodos).

   `methodsPhrase()` (nuevo helper local en `coupon-list.tsx`) arma "Mercado
   Pago", "Mercado Pago y Transferencia" o la lista completa con comas — nunca
   el valor crudo del enum.

## Addendum — dos hallazgos que el hilo principal cerró, y que me desbloquean

1. **`coupon_detail()` ahora devuelve los tres estados.** `CouponRedemptionRow`
   ganó `status: 'reserved' | 'redeemed' | 'released'` y
   `releasedReason: 'expired' | 'cancelled_unpaid' | null`, y
   `couponRedemptionRowRpcSchema` los valida. Esto cierra el gap de contrato
   documentado arriba (decisión 4 del informe original): `coupon-detail.tsx`
   ahora muestra un `RedemptionStatusPill` por fila —nada para `redeemed`
   (es el estado esperado), "Reservado" (tono `live`) para `reserved`, y
   "Liberado: {motivo}" (tono `neutral`, motivo vía el nuevo
   `redemptionReleasedReasonLabel()` en `format.ts`) para `released`—, sin
   tocar las tres métricas de arriba, que siguen contando SOLO `redeemed`
   (facturación sobre un pedido que puede morir sigue siendo un número falso).
   El heading de la lista pasó de "Todavía no hay canjes confirmados." a
   "Todavía no hay movimientos de este cupón." porque ahora la lista
   incluye más que canjes confirmados.

2. **El fall-through de `confirmPendingChangeAction` está cerrado** (no es mi
   archivo, lo arregló el hilo principal). Confirma que la decisión de NO
   reusar `ConfirmWithCode` para cupones —y construir `confirm-coupon-code.tsx`
   como hermano— fue la correcta: el bug real era peor de lo que parecía en la
   primera lectura (un pending change de cualquier `kind` no manejado apagaba
   `courier_collects_payment` en silencio). `confirm-coupon-code.tsx` sigue
   siendo necesario tal cual está: `confirmPendingChangeAction` ahora tira en
   vez de corromper, pero sigue sin aplicar el cambio de cupón — eso lo hace
   `confirmCouponChangeAction` (T1B), que es la que este componente llama.

## Verificación (después del addendum)

- `npm run typecheck`: verde.
- `npm run lint`: verde (0 errores, 0 warnings).
- `npm run build`: verde, sin warnings nuevos en `/admin/clientes/cupones`.

## Addendum 2 — Hallazgos 7 y 8 del review de Entrega B, más dos nits

### Hallazgo 7 — el menú de WhatsApp ofrecía cupones vencidos/agotados

`page.tsx` sigue filtrando por `status === 'active'` (eso no lo toco, es
archivo ajeno) y sigue pasando esa lista como prop `activeCoupons`. El
arreglo va en `coupon-whatsapp-menu.tsx`: agrega un segundo filtro con
`isCouponUsable()` (de `src/lib/coupon.ts`, ya importado en el módulo antes
por otra función del mismo archivo — `describeDiscount`) sobre la prop que
ya llega, antes de decidir si mostrar el link directo o el menú, y antes de
mapear los ítems. `usableCoupons` reemplaza a `activeCoupons` en las dos
ramas (el chequeo `.length === 0` y el `.map`).

Decisión: **cupón inusable no se ofrece**, no se muestra deshabilitado con
motivo. El brief de esta superficie dice que un menú vacío es peor que
ningún menú — mismo criterio ya aplicado cuando no hay cupones activos en
absoluto —, y agregar un ítem deshabilitado con "venció"/"se agotó" solo
para un caso que además ya se explica en la hoja de detalle del cupón no
suma nada al flujo de mandar un mensaje. Si tras el filtro no queda ninguno,
el botón vuelve a ser el link directo de `wa.me` de siempre — mismo camino
que ya existía para "cero cupones activos".

No fue necesario ningún cambio en `page.tsx` ni en el tipo `Coupon`: los
campos que `couponState()`/`isCouponUsable()` necesitan (`endsAt`,
`reservedCount`, `redeemedCount`, `maxRedemptions`, `status`, `startsAt`) ya
viajan completos en cada fila.

### Hallazgo 8 — `coupon-detail.tsx` no usaba el dato que ya tenía

`canDelete` pasó de `reservedCount === 0 && redeemedCount === 0` a
`current.recentRedemptions.length === 0`. `recentRedemptions` trae los
últimos 20 canjes SIN filtrar por status (incluye `released`), así que si
viene vacío el ledger completo del cupón está vacío — es más fiel al
criterio de aceptación T4B-4 ("un cupón con cualquier fila en el ledger, una
`released` incluida, no ofrece borrar") que los dos contadores, que
`sync_coupon_counters()` recalcula solo sobre `reserved`/`redeemed`.

`coupon-list.tsx` queda con el heurístico de los dos contadores, tal como
pedía el hallazgo: ahí `Coupon` (no `CouponDetail`) no trae la lista de
canjes, así que no hay con qué mejorarlo sin pedir un campo nuevo al
contrato — eso sí sería un cambio cross-lane, y el hallazgo no lo pedía.

### Nits resueltas (dentro de mis archivos)

- **`customer-row.tsx`**: el comentario de la prop `activeCoupons` decía que
  "hoy nadie llama a `CustomerRow` pasando este prop" y que quedaba
  "documentado como pendiente cross-lane". Falso en el estado actual:
  `page.tsx` y `customer-directory.tsx` (T2A) ya arman y pasan la prop de
  punta a punta. Reescrito para reflejar eso; el default `[]` se queda,
  ahora explicado como red de seguridad y no como el camino real.
- **`coupon-sheet.tsx`**: el input de código de cupón llevaba `.tabular`.
  Un código es un identificador, no una medición (plata/minutos), así que
  se sacó la clase. Cosmético — `tabular-nums` no afecta letras, pero la
  regla del piso de calidad es "monoespaciada solo para medición" y el
  `.tabular` la reforzaba sin corresponder.

### Nits no tocadas (fuera de mis archivos o del criterio del review)

- `src/models/types.ts` (`CouponChangeKind` sin uso), la FK simple de
  `coupon_campaigns.coupon_id`, `CPN09` compartido entre dos rechazos,
  `PAYMENT_METHOD_LABELS` duplicado en `coupon.model.ts`, los índices de FK
  incompletos y el timezone UTC del mail de campaña: todas son de
  `src/models/**`, `src/services/**` o `supabase/migrations/**` — fuera de
  mis límites, quedan para el agente de backend.
- `campaign-sheet.tsx` (mecanismo distinto al que pedía el brief pero mismo
  resultado práctico) y `coupon-detail.tsx:184-189` (link a
  `/admin/pedidos?from=…&to=…` en vez de un pedido puntual): el propio
  review los marca como aceptables tal cual están, no como algo a arreglar.
  `checkout-form.tsx` es de `src/views/storefront/**`, fuera de mis límites.

## Verificación (después del addendum 2)

- `npm run typecheck`: verde.
- `npm run lint`: verde (0 errores, 0 warnings).
- No corrí `npm test`: está en rojo por las 5 fallas intencionales del
  test-engineer que le tocan al agente de backend, según instrucción de la
  tarea.
