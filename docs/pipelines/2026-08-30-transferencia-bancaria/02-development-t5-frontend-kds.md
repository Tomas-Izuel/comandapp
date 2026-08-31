# T5 — Frontend: bandeja de transferencias del KDS

Agente: `frontend-react-craftsman`. Rama: `feat/transferencia-bancaria`.

## Qué se implementó

- **`src/views/admin/kds/transfer-tray.tsx` (nuevo).** La bandeja de
  "Transferencias por confirmar", arriba del tablero. Exporta `TransferTray`.
- **`src/views/admin/kds/board.tsx`** — monta `<TransferTray>` en los DOS
  branches de retorno (el estado "sin pedidos activos" con onboarding/"al día",
  y el tablero con columnas), porque una transferencia pendiente puede existir
  aunque el tablero de cocina esté vacío — son dos fuentes de datos
  independientes (`ACTIVE_STATUSES` vs. `pending`). `KdsBoard` gana dos props
  nuevas: `currency: string` y `initialTransferOrders: Order[]`.
- **`src/views/admin/kds/order-card.tsx`** — chip "Transferencia" (ícono
  `Landmark`) en la fila de metadata de la tarjeta, visible cuando
  `order.paymentMethod === 'transfer'`. Sin botón nuevo: la confirmación de
  pago vive solo en la bandeja. También exporta `useElapsedMinutes` (antes
  privado) para que `transfer-tray.tsx` lo reuse en vez de duplicar el hook.
- **`src/app/admin/(app)/page.tsx`** — trae `getPendingTransferOrders(storeId)`
  en paralelo con `getActiveOrders(storeId)` (dos lecturas independientes,
  `Promise.all`) y pasa `transferOrders` + `session.store.currency` a
  `KdsBoard`. Sigue sin importar `@supabase/*`: la lectura es un modelo
  consumido directo, igual que `getActiveOrders` ya hacía.
- **`.impeccable/surfaces/src-app-admin-app-page-tsx.md`** — actualizado con la
  sección de la bandeja (qué es, por qué, reglas de copy, y la razón del chip
  en `order-card.tsx`).

## Cómo se integró sin romper el tablero existente

`getActiveOrders` filtra por `ACTIVE_STATUSES`, que no incluye `pending`
(`order.schema.ts:29`). Un pedido por transferencia recién creado es
`payment_method='transfer'`, `status='pending'` — invisible para
`fetchActiveOrdersAction`/`KdsBoard` tal como estaban. En vez de tocar ese
filtro (que rompería la invariante "el tablero es cocina, no un buzón de
pendientes"), la bandeja es una **fuente de datos y un ciclo de refresco
paralelos**, con su propio canal Realtime (`kds-transfers-${storeId}`) y su
propio `setInterval` de 30 s — mismos números (`POLL_INTERVAL_MS`,
`REALTIME_DEBOUNCE_MS`) y mismo patrón que `board.tsx`, pero sin compartir
estado con él. Cuando el staff confirma un pago, `updateOrderStatus` lo pasa a
`confirmed` (dentro de `confirmTransferPaymentAction` → `confirmTransferPayment`,
T2) y en el siguiente poll/evento el pedido: (a) desaparece de la bandeja
porque ya no es `pending`, y (b) aparece solo en la columna "Confirmado" del
tablero de siempre, sin ningún cambio en `board.tsx` más allá de montar la
bandeja — es exactamente el mismo pedido, el mismo `orders.id`, cruzando de una
consulta a la otra.

## Cómo se ve un pedido con / sin comprobante / con comprobante purgado

Dentro del `Dialog` de detalle (`ConfirmDialog` → `ReceiptSection`), por
`order.transferReceiptPath` / `order.transferReceiptUploadedAt` (ninguna
llamada al servidor hasta que el staff toca algo):

1. **Con comprobante** (`transferReceiptPath` no nulo): botón "Ver
   comprobante". Al tocarlo, recién ahí se pide la signed URL
   (`transferReceiptUrlAction`) — nunca antes, porque dura 5 minutos y pedir
   una por fila en una bandeja que se repolea sola cada 30 s sería tirar
   trabajo y ampliar la ventana de una URL que nadie miró. Si es imagen, se
   muestra inline dentro del mismo diálogo (no un overlay anidado: el propio
   `Dialog` ya trae foco atrapado + Escape + devolución de foco por Radix, así
   que no hacía falta un segundo nivel). Si es PDF, se abre en pestaña nueva
   apenas llega la URL.
2. **Sin comprobante** (los dos campos nulos): "Todavía no subió ningún
   comprobante." Sin botón — no hay nada que pedir al servidor.
3. **Comprobante purgado** (`transferReceiptPath` nulo, `transferReceiptUploadedAt`
   no nulo): "Subió un comprobante, pero ya se eliminó (se borra a las 24 h de
   confirmar el pago)." Mensaje neutro, no un error — tal como pide
   `CLAUDE.md`/la brief de T5.

En los tres casos "Confirmar pago" está habilitado igual (no hay ninguna guarda
de UI que lo condicione a la existencia de comprobante), y "Escribirle por
WhatsApp" está siempre visible como escape hatch.

## Copy del botón de WhatsApp

Deep link `https://wa.me/${order.customerPhoneE164.replace(/\D/g, '')}` (mismo
patrón exacto que `store-dock.tsx:57`, sin segunda normalización de teléfono),
con texto prellenado:

> "Hola {nombre}! Somos del local, por tu pedido {shortCode}. Necesitamos que
> nos ayudes con el comprobante de la transferencia, ¿nos lo podés reenviar o
> contarnos qué pasó?"

Botón: "Escribirle por WhatsApp". Vive en el pie del `Dialog` de detalle,
arriba de "Confirmar pago" (mismo orden que el pedido: primero resolver el
problema si lo hay, después confirmar).

La copy del diálogo entero respeta la regla de la sección "Copy: la regla que
no se negocia" de `01-tasks.md` T5: el texto de `DialogDescription` pregunta
literalmente "¿la plata ya está ahí?" y aclara que el comprobante "es un dato
más, nunca la prueba — acá no hay forma de verificar que sea auténtico". No hay
ningún check verde, sello ni puntaje en ningún estado.

## Contratos consumidos de T2 (verificados, coinciden)

Programé contra las firmas de `01-tasks.md` T2.6 antes de que T2 las
implementara; quedaron verificadas byte a byte contra lo que efectivamente
aterrizó en `src/controllers/kitchen.actions.ts`:

```
confirmTransferPaymentAction(p: { storeId; orderId; reference?: string }): Promise<ActionResult>
transferReceiptUrlAction(p: { storeId; orderId }): Promise<ActionResult<{ url: string; mime: string } | null>>
fetchPendingTransfersAction(storeId: number): Promise<ActionResult<Order[]>>
```

Y de `src/models/order.model.ts`: `getPendingTransferOrders(storeId: number): Promise<Order[]>`,
consumida directo desde `page.tsx` (Server Component → modelo, mismo patrón que
`getActiveOrders`).

No hubo que reportar ninguna discrepancia: las firmas finales de T2 coinciden
con las documentadas.

## Primitivas compartidas

No se agregó ninguna a `src/views/shared/`. Se reutilizaron: `Price`
(`views/shared/money.tsx`), `PanelHeading` (`views/admin/page-frame.tsx`,
la variante de Operate, no `SectionHeading` de la cara del cliente), y los
componentes de `components/ui/` (`Dialog`, `Button`, `Input`, `Label`) ya
usados en `order-card.tsx`/`assign-courier.tsx`. `PaymentNotice` de
`views/shared/order-status.tsx` se importa sin tocar (es de T4); en esta
bandeja no aplica porque un pedido `pending` por transferencia todavía no tiene
`paymentStatus` que mostrar ahí — el estado del dinero de ESTE flujo lo
comunica el chip "Con/Sin comprobante" y el propio diálogo, no `PaymentNotice`.

## Comportamientos visibles y expectativas de accesibilidad (spec para `test-engineer`)

- **Aparición**: un pedido `transfer` `pending` aparece en la bandeja en el
  siguiente poll (≤30 s) o antes si Realtime dispara. Los que tienen
  comprobante subido aparecen primero (orden que ya viene resuelto desde
  `getPendingTransferOrders`, la bandeja no reordena).
- **Vacío**: sin transferencias pendientes, `TransferTray` renderiza `null` —
  no hay contenedor, no hay `EmptyState`, no ocupa layout.
- **Apertura del detalle**: tocar una fila (es un `<button>` real, `min-h-11`,
  operable por teclado y con foco visible del sistema — no hay `outline-none`
  sin reemplazo) abre el `Dialog`. Foco entra al diálogo, queda atrapado
  adentro, Escape lo cierra (salvo mientras hay una acción en vuelo:
  `pending`), y el foco vuelve al botón-fila que lo abrió al cerrar — todo
  provisto por Radix `Dialog`, sin código propio de foco.
- **Ver comprobante**: un toque pide la signed URL; imagen se muestra inline
  con `alt` descriptivo; PDF abre en pestaña nueva. Un error de red muestra
  texto y permite reintentar (mismo botón).
- **Confirmar sin comprobante**: el botón "Confirmar pago" nunca está
  deshabilitado por falta de imagen — verificable llamando la acción sobre un
  pedido con `transferReceiptPath: null`.
- **Confirmar con éxito**: la fila desaparece de la bandeja, el diálogo se
  cierra, toast de éxito con el texto "Pago confirmado. El pedido pasó a la
  cocina."; en el tablero de abajo el mismo pedido aparece en la columna
  "Confirmado" en el siguiente refresco, con el chip "Transferencia".
- **409 (otro operario confirmó primero)**: se trata como información, no
  como error — la fila desaparece igual, el toast es de éxito
  (`'Otro operario ya confirmó este pago.'`), nunca `toast.error`.
- **WhatsApp**: el link abre en pestaña nueva (`target="_blank" rel="noreferrer"`),
  con el teléfono ya normalizado por el servidor (nunca se recalcula acá).
- **Targets**: fila de la bandeja `min-h-11`, todos los botones del diálogo
  `h-11`/`h-12`. Nada por debajo de 44px.
- **Densidad**: la bandeja es una lista compacta (código + nombre + hace
  cuánto + monto + chip), no tarjetas — se opera parado, con las manos
  ocupadas, coherente con la vara de KDS que pide `.impeccable/surfaces/`.

## Qué quedó afuera / follow-ups

- **No se hizo verificación visual en navegador.** El feature necesita
  pedidos `payment_method='transfer'` reales para poblar la bandeja, y eso
  depende de la migración (`supabase/migrations/20260831120000_transferencia_bancaria.sql`,
  ya presente en el árbol pero — según las reglas del repo — solo el hilo
  principal la aplica/resetea la base) y de datos de prueba
  (`npm run db:reset -- --orders`, que no me corresponde correr). Si hace
  falta una pasada visual antes de cerrar el pipeline, pido que el hilo
  principal aplique la migración y corra el reset con `--orders`, y hago una
  ronda de `impeccable audit`/captura contra `/admin` real.
- **No se tocó `src/views/shared/order-status.tsx`** (es de T4) ni
  `src/views/admin/pagos/**` (T3) ni `src/controllers/**`/`src/models/**`
  (T2), tal como marca el brief.
- El mensaje de WhatsApp es genérico ("ayudanos con el comprobante… ¿nos
  contás qué pasó?") en vez de intentar adivinar el problema puntual (imagen
  ilegible vs. monto distinto vs. no llegó nada): el staff lo edita a mano
  antes de mandar si hace falta precisión, y no hay forma de saber la causa
  real sin que un humano mire primero. Si el dueño quiere un texto más
  específico por escenario, es un cambio de una línea en `whatsappHref`.

## Problemas encontrados en archivos ajenos (informativo, no corregidos)

Detectados vía `npx tsc --noEmit` durante el desarrollo, todos en lanes
paralelos (T1/T2/T3/tests) y ya resueltos o en curso al momento de cerrar este
informe salvo los que siguen abiertos en la última corrida:

- `src/lib/store-hours.ts` y `tests/lib/store-availability.test.ts` todavía no
  pasan `transferPaymentEnabled` a `PaymentFlags` en varios call sites — no es
  mío (`src/lib/**` y `tests/**` están fuera de mi propiedad).
- `src/views/admin/pagos/bank-account-form.tsx` (T3) importa cuatro acciones de
  `admin.actions.ts` que a esa altura todavía no estaban exportadas
  (`requestBankAccountChangeAction`, `lookupBankHolderAction`,
  `setBankAccountActiveAction`, `deleteBankAccountAction`) — mismo patrón que
  yo tuve contra T2 (programar contra la firma documentada antes de que
  aterrice), no es un bug mío que reportar, solo una foto del árbol en un
  momento en que varias lanes corrían en simultáneo.

No rompí nada de esto ni lo edité: son de otras lanes y typecheck/lint sobre
`src/views/admin/kds/**` y `src/app/admin/(app)/page.tsx` están en verde.

## Verificación

- `npx tsc --noEmit`: cero errores en `src/views/admin/kds/**` y
  `src/app/admin/(app)/page.tsx` (verificado explícitamente con
  `grep -E "kds/|app/admin"` sobre la salida completa).
- `npx eslint src/views/admin/kds/transfer-tray.tsx src/views/admin/kds/order-card.tsx src/views/admin/kds/board.tsx "src/app/admin/(app)/page.tsx"`:
  sin hallazgos.
- Hook de `impeccable` corrido automáticamente tras cada edición de UI: sin
  hallazgos deterministas en ninguno de los archivos tocados.
- No corrí `npm test` (no escribo tests) ni `npm run build` completo (varias
  lanes en vuelo simultáneo lo iban a romper por archivos que no son míos).
