# T4 — Frontend cliente: checkout y seguimiento (transferencia bancaria)

Agente: `frontend-react-craftsman`. Corre en paralelo con T1/T2/T3/T5 sobre el
mismo contrato fijado en T0 (`src/models/types.ts`, `src/lib/rate-limit-policy.ts`).
Al momento de implementar, T1 y T2 ya habían aterrizado sus cambios de schema/
modelo (verificado con `git status` y lectura directa de los archivos), así que
el trabajo quedó verificado contra el contrato REAL, no solo el documentado en
`01-tasks.md` — ver la sección "Verificación contra T2" más abajo.

## Tareas implementadas (T4.1–T4.6)

### T4.1 — El bug de la derivación binaria de método de pago (`checkout-form.tsx`)

**Esto era lo más importante del slice.** Las líneas 182-187 tenían:

```ts
const bothPaymentMethodsAvailable = onlinePaymentEnabled && inStorePaymentEnabled
const effectivePaymentMethod = bothPaymentMethodsAvailable ? paymentMethod : onlinePaymentEnabled ? 'online' : 'in_store'
```

Con transferencia habilitada y sin las otras dos, esto mandaba `in_store`
igual: el pedido nacía `confirmed` e **impago**, la cocina cocinaba gratis.

Reemplazado por una lista de métodos disponibles, construida una sola vez a
partir de las tres props (`onlinePaymentEnabled`, `transferPaymentEnabled`,
`inStorePaymentEnabled`):

```ts
const availablePaymentMethods: PaymentMethod[] = [
  onlinePaymentEnabled ? 'online' : null,
  transferPaymentEnabled ? 'transfer' : null,
  inStorePaymentEnabled ? 'in_store' : null,
].filter((method): method is PaymentMethod => method !== null)
```

- El `useState` inicial de `paymentMethod` arranca en `availablePaymentMethods[0] ?? 'in_store'`.
- `effectivePaymentMethod` se deriva con `availablePaymentMethods.includes(paymentMethod) ? paymentMethod : (availablePaymentMethods[0] ?? 'in_store')` — mismo criterio que ya usaba `effectiveDeliveryMethod` para el método de entrega: si el elegido dejó de estar disponible a mitad de checkout (la cotización se refrescó y la config de la tienda cambió), se cae al primero que sigue existiendo, sin esperar un efecto.
- **Por qué ya no puede volver:** con 0/1/2/3 métodos habilitados, la lógica es la misma (`includes` + fallback al primero). No hay un segundo booleano combinando dos casos que un tercer método pueda romper — el patrón que causó el bug original (`A && B`, con "si no, A ganó") desaparece por construcción. Verifiqué manualmente el caso crítico: con **solo** `transferPaymentEnabled=true`, `availablePaymentMethods = ['transfer']`, `effectivePaymentMethod` es siempre `'transfer'`, nunca cae a `'in_store'`.

El bloque "Cómo pagás" pasó de `bothPaymentMethodsAvailable ? <RadioGroup online/in_store> : <texto único>` a `availablePaymentMethods.length > 1 ? <RadioGroup con los que haya> : singleMethodNotice(...)`. El `RadioGroup` renderiza cada `<Label>` condicionado por `availablePaymentMethods.includes(...)` — nunca un ternario anidado de tres ramas en el JSX. El texto de "un solo método" y el label del botón primario (`submitButtonLabel()`) se extrajeron a funciones para lo mismo: evitar un ternario de tres ramas metido en el render. El botón ahora tiene una rama propia para `transfer`: *"Confirmar pedido · Pagás por transferencia"*.

### T4.2 — El checkout NO muestra el CBU

La opción de transferencia en el `RadioGroup` dice *"Transferencia bancaria"* con la sublínea *"Te mostramos el CBU y el monto exacto en la pantalla siguiente."* — nunca el dato en sí. `OrderPublicView.bankAccount` (poblado por `getOrderByToken`, T2) es el único camino verificado por el que el CBU llega al cliente.

### T4.3 — `image-compress.ts`: extracción real, no una segunda función

`compressImage` (canvas, 1600px, JPEG 0.82) se movió tal cual de `views/admin/catalogo/image-upload.ts` a `views/shared/image-compress.ts`. `image-upload.ts` ahora la importa; su comportamiento no cambió (mismo `MAX_DIMENSION`/`JPEG_QUALITY`, mismo cuerpo). `receipt-upload.ts` (nuevo) la reusa para el caso imagen del comprobante.

`receipt-upload.ts` (`uploadTransferReceipt(token, file, onPhase)`):
- Imagen (`file.type.startsWith('image/')`) → se comprime con `compressImage`, se manda como `image/jpeg`.
- PDF (`file.type === 'application/pdf'`) → va crudo, con un tope duro de `MAX_RECEIPT_BYTES` (4 MB, importado de `order.schema.ts` — T2 ya lo exportaba al momento de implementar) chequeado ANTES de mandar, con mensaje propio.
- Cualquier otro tipo → error de cliente sin llegar a tocar la red.
- `POST multipart/form-data` a `/api/orders/<token>/comprobante`, campo `file` — **verificado contra el route handler real de T2** (ver más abajo), no contra una suposición.
- Devuelve `{ ok: true; order: OrderPublicView } | { ok: false; error: string; status?: number }`.

### T4.4 — `transfer-panel.tsx` (nuevo)

El panel del seguimiento (`/pedido/[token]`). Orden de arriba a abajo: monto exacto (`Price`, `.tabular`, grande) → CBU/CVU o alias con botón de copiar (`CopyValue`, local al archivo — 22 dígitos a mano en un celular es un error garantizado) → titular + banco (banco se omite si `bankName` es `null`) → `shortCode` como referencia, en una fila con borde punteado → control de subida.

**El caso solo-alias** (`bankAccount.cbu === null`, decisión D3): el alias pasa a ser el valor primario del `CopyValue`, con el label "Alias" en vez de "CBU o CVU". Nunca se renderiza un campo de CBU vacío.

**El "un solo tiro", con la advertencia ANTES de confirmar:** al elegir un archivo se entra a un estado "picked" con preview real (imagen tal cual, o nombre+peso si es PDF) y, junto al botón "Confirmar y subir" (nunca en un tooltip ni después), el aviso: *"Revisá que se lea bien el monto y la fecha. Solo podés subir un comprobante."* Un archivo inválido (ni imagen ni PDF, o PDF > 4 MB) muestra el error en el lugar de ese aviso y **saca el botón de confirmar** — no se ofrece confirmar algo que el servidor va a rechazar.

**Estados cubiertos:** idle (dropzone punteada) · picked válido (preview + aviso + Confirmar/Elegir otro) · picked inválido (preview + error, sin botón de confirmar) · subiendo (barra de progreso por etapa, mismo patrón que `product-image-field.tsx`: sin progreso real por byte, se comunica por etapa) · recibido/terminal (`StatusPill` tono `live` + texto, sin control de subida, sin volver a mostrar la imagen — el cliente nunca recibe una signed URL) · conflicto de servidor (409: se intenta refrescar el pedido real vía `GET /api/orders/[token]`; si falla, se trata como terminal igual — nunca un rojo genérico) · error de red durante la subida (`Alert destructive`, el archivo elegido se conserva para reintentar) · sin cuenta bancaria resuelta (`bankAccount === null`: mensaje corto + WhatsApp, sin control de subida).

**El escape hatch** (WhatsApp del local, ícono de marca de `@/components/ui/whatsapp`, mismo patrón que `store-dock.tsx`) es un link siempre visible al pie del panel, en todos los estados — no depende de haber subido nada.

**Render gate:** decidido en el padre (`order-tracking.tsx`), no en el componente: `order.paymentMethod === 'transfer' && order.status === 'pending'`. Ese único chequeo cubre "ya confirmado" (status pasa a `confirmed` a la vez que `paymentStatus` pasa a `approved`, en la misma acción de `confirmTransferPayment`) y "cancelado" — no hace falta mirar `paymentStatus` por separado. El componente además tiene una guarda defensiva propia (`if (order.paymentMethod !== 'transfer') return null`).

### T4.5 — `PaymentNotice` con tres casos (`order-status.tsx`)

Antes: `paymentMethod === 'in_store' ? 'Pagás al retirar' : PAYMENT_STATUS_LABELS[paymentStatus]` — con transferencia esto mostraba "Pago pendiente" a secas, sin decir qué hacer. Ahora, vía una función `paymentNoticeText(paymentMethod, paymentStatus, transferReceiptUploadedAt)`:
- `in_store` → "Pagás al retirar" (sin cambios).
- `transfer` → "Transferí para confirmar tu pedido" o "Estamos verificando tu transferencia" según si ya subió comprobante.
- Cualquier otro (`online`) → el label de `payment_status` de siempre, sin cambios.

`transferReceiptUploadedAt` es un prop **opcional** con default `null`: el KDS (`order-card.tsx`, de T5, que **no edité**) sigue llamando al componente con solo `paymentStatus`/`paymentMethod` y su comportamiento no cambia un píxel.

### T4.6 — `/legal/privacidad`

Sección nueva "Si pagás por transferencia": qué se sube, que el CBU se muestra recién con el pedido creado, que el comprobante es de una sola vez (con el WhatsApp como salida), quién lo puede leer (solo el staff de ESE local) y los plazos de retención — **24 h después de confirmado el pago, 7 días en cualquier otro caso** — que tienen que coincidir con las constantes reales del cron de purga (T2.7, `src/app/api/cron/cleanup/route.ts`); dejé un comentario en el archivo señalando esa dependencia. Actualicé la fecha de "última actualización" a 2026-08-31.

## Decisión de composición: el pill y el panel no se pisan

`PaymentNotice` sigue siendo el resumen de una línea (como ya era para online/in_store); `TransferPanel` es la superficie de acción completa. Se montan uno debajo del otro en `order-tracking.tsx`, no se fusionaron: es la misma separación que el producto ya sostiene en otros lados ("cocina y dinero son dos relojes que nunca se infieren uno del otro").

## Verificación contra T2 (no asumida)

Antes de cerrar, leí el route handler real (`src/app/api/orders/[token]/comprobante/route.ts`, ya escrito por T2 al momento de mi implementación) y `storeTransferReceipt` en `order.model.ts`:
- Campo de `FormData`: `file` — coincide con lo que asumí en `receipt-upload.ts`.
- Respuesta de éxito: `{ order: OrderPublicView }` — coincide.
- Respuesta de error: `{ error: string }` vía `toApiError`, sin `field` en este endpoint — mi cliente ya lo trata como texto plano, sin depender de `field`.
- 409 en conflicto de subida simultánea: confirmado en `storeTransferReceipt` (`DomainError(..., { status: 409 })`) — mi `handleConfirm` lo distingue explícitamente y hace `refetchOrder()` en vez de mostrar un error genérico.

No hubo que ajustar nada: el contrato documentado en `01-tasks.md` T2.4 coincidió con lo implementado.

## Primitivas nuevas y dónde viven

- `CopyValue` y `FilePreview` — locales a `transfer-panel.tsx`. No se sumaron a `views/shared/surfaces.tsx`: no hay un segundo consumidor hoy (el admin tiene su propio `CopyField` no exportado en `payment-form.tsx`, y su propio picker de foto en `product-image-field.tsx`; unificar hubiera significado tocar código de T3, fuera de mi propiedad). Si en el futuro el admin necesita algo equivalente, ahí se justifica extraer un primitivo común.
- `compressImage` — extraída a `views/shared/image-compress.ts` (T4.3), como pidió la tarea. Es la única función compartida real que agregué a `shared/`.

## Accesibilidad (contrato para el test-engineer)

- El bloque que alterna entre el picker y el mensaje terminal de `transfer-panel.tsx` está envuelto en `aria-live="polite"`: la transición pasa sola (resultado de `handleConfirm`), sin que el foco se mueva ahí.
- El error de validación de archivo (`fieldError`) usa `role="alert"`; el error de red/servidor (`uploadError`) usa el componente `Alert` (que ya trae `role="alert"` incorporado) con `aria-live="assertive"` explícito, mismo patrón que `checkout-form.tsx`.
- La barra de progreso de subida usa `role="progressbar"` con `aria-valuemin/max/now` y `aria-label`.
- El botón de copiar CBU/alias tiene `aria-label` dinámico (`Copiar el CBU` / `Copiar el alias`); el link de WhatsApp tiene `aria-label` explicitando que abre en otra pestaña.
- Todos los targets interactivos (botones, el dropzone, el link de WhatsApp) son ≥44px (`h-11`/`min-h-11`/`min-h-24`).
- Ítems de tipografía del Web Interface Guidelines: espacios NO-breaking (` `) entre número y unidad en "4 MB"/"X KB" (`transfer-panel.tsx`, `receipt-upload.ts`); elipsis reales (`…`) en los textos de progreso.

## Acceptance criteria de `01-tasks.md` — estado

- ✅ Con **solo** transferencia habilitada, el checkout la ofrece y el pedido creado tendría `paymentMethod: 'transfer'` (verificado por lectura de código: `availablePaymentMethods = ['transfer']` fuerza `effectivePaymentMethod = 'transfer'` siempre).
- ✅ Con los tres métodos, hay tres opciones en el `RadioGroup` y la primera seleccionada es la primera de la lista (`online` si está disponible).
- ✅ El CBU se copia de un toque en mobile (`CopyValue`, botón `size="icon"` de 44px).
- ✅ Elegir un archivo muestra preview y la advertencia de un solo intento ANTES de que se pueda confirmar (el botón "Confirmar y subir" solo existe en el estado "picked", junto al aviso).
- ✅ Un archivo > 4 MB (PDF) se rechaza en el cliente, con mensaje propio, antes de llegar a `fetch`.
- ✅ Después de subir no hay forma de volver a subir en la UI (el bloque entero de picker desaparece, reemplazado por el mensaje terminal).
- ✅ Un 409 del servidor se muestra como estado (refetch silencioso, o mensaje neutral si el refetch falla), nunca como error rojo genérico.
- ✅ Motion: no se agregó ninguno nuevo — todo entra ya montado con el `Panel`, sin revelado al scroll. El único momento animado sigue siendo agregar al carrito.
- ✅ Contraste: todo el panel usa los tokens del tema (`text-muted-foreground`, `bg-muted`, `text-warning-foreground`, etc.), sin opacidades sobre texto — `ensureContrast()` sigue siendo la garantía real.

## Lo que dejé afuera / follow-ups

1. **No implementé una segunda comparación CBU-vs-alias con warning al cliente.** El aviso de "sin CBU no detectamos errores de tipeo" es responsabilidad de T3 (el formulario de `/admin/pagos`, donde el DUEÑO carga el dato) según D3 en `01-tasks.md` línea 9-11 — no del cliente. El cliente simplemente ve el alias como dato primario cuando no hay CBU, sin alarmar por algo que no puede corregir.
2. **No agregué `width`/`height` explícitos al `<img>` de preview del comprobante** (Web Interface Guidelines pide dimensiones explícitas contra CLS). Es una preview local (`URL.createObjectURL`) que aparece DESPUÉS de una interacción del usuario, nunca en el paint inicial — no hay CLS que prevenir ahí. Documentado como excepción deliberada, no un descuido.
3. **La confirmación de "un solo tiro" es inline, no un modal.** Es lo que pide explícitamente T4.4 ("junto al botón, no en un tooltip ni después") y coincide con `craft-floor.md` ("un modal para una tarea que no necesita interrupción ni foco protegido" está en la lista de cosas a rechazar). Lo señalo porque el checklist genérico de Web Interface Guidelines sugiere modal/undo para acciones destructivas — acá se prioriza el brief explícito del producto.
4. **Discrepancia de instrucciones sobre el "modo" de esta superficie**, que reporto para que quede escrita: el prompt de lanzamiento de este slice dice *"El checkout es superficie de compra, no de tarea"*, pero `01-tasks.md` (línea ~987) dice *"el checkout y el seguimiento son Operate"*. Construí con el criterio de **Operate** (que es también lo que ya dicen los briefs `.impeccable/` existentes de `checkout-form.tsx` y `order-tracking.tsx`, ambos de un pipeline anterior): densidad de información y continuar-sin-perder-el-lugar por encima de expresión, dentro del mundo visual ya elegido (foto grande, radios de marca, `Panel`/`RadioGroup` estándar de la categoría). No encontré contradicción real en la práctica: el mundo visual (chain-app) y el modo de craft (Operate) conviven en el resto del checkout ya existente, y este slice solo extiende ese mismo lenguaje.
5. **No toqué `EtaHero`** en `order-tracking.tsx` a pesar de que, leyendo `order.model.ts`, `etaAt` se setea siempre en la creación (incluso para pedidos `pending`) — lo que significa que un pedido por transferencia recién creado muestra una cuenta regresiva de minutos en vez de "esperando confirmación". Esto es un comportamiento PREEXISTENTE (afecta también a `online` pendiente) y está fuera del alcance de T4 según la tarea. Lo señalo como hallazgo, no lo arreglé.

## Cross-lane: nada pendiente

Al momento de cerrar, T1, T2, T3 y T5 ya habían aterrizado sus cambios (verificado con `git status` y lectura directa de `order.schema.ts`, `order.model.ts`, el route handler nuevo, y `kitchen.actions.ts` vía `transfer-tray.tsx` de T5). No quedó ningún contrato pendiente de verificar contra una implementación real.

## Archivos tocados

- `src/views/storefront/checkout-form.tsx` (T4.1, T4.2)
- `src/views/storefront/transfer-panel.tsx` (nuevo, T4.4)
- `src/views/storefront/receipt-upload.ts` (nuevo, T4.3)
- `src/views/storefront/order-tracking.tsx` (T4.4, T4.5 wiring)
- `src/views/shared/order-status.tsx` (T4.5)
- `src/views/shared/image-compress.ts` (nuevo, T4.3 — extracción)
- `src/views/admin/catalogo/image-upload.ts` (T4.3 — solo la extracción, comportamiento intacto)
- `src/app/[store]/checkout/page.tsx` (pasa `transferPaymentEnabled`)
- `src/app/pedido/[token]/page.tsx` (pasa `whatsappPhoneE164`)
- `src/app/legal/privacidad/page.tsx` (T4.6)
- `.impeccable/surfaces/src-views-storefront-transfer-panel-tsx.md` (nuevo)
- `.impeccable/surfaces/src-views-storefront-checkout-form-tsx.md` (actualizado, sección nueva agregada al final, la de horarios programados intacta)
- `.impeccable/surfaces/src-views-storefront-order-tracking-tsx.md` (ídem)

`npm run typecheck` y `npm run lint` (`eslint .`) corren limpios sobre todo el árbol excepto los errores preexistentes en `tests/lib/store-availability.test.ts` y `tests/lib/store-hours.test.ts` (faltan `transferPaymentEnabled` en fixtures de `Store`/`PaymentFlags` — de `tests/`, dominio del `test-engineer`, no tocado por mí).
