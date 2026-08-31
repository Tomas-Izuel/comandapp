# T3 — Frontend `/admin/pagos`: cuenta bancaria — dev log

Agente: `frontend-react-craftsman`. Rama: `feat/transferencia-bancaria`.

## Qué se construyó

- `src/views/admin/pagos/bank-account-form.tsx` **(nuevo)** — sección completa
  de cuenta bancaria, hermana de `payment-form.tsx` (Mercado Pago) en la misma
  pantalla.
- `src/app/admin/(app)/pagos/page.tsx` **(editado)** — suma
  `getBankAccountStatus(session.store.id)` en paralelo (`Promise.all`) con
  `getPaymentConnectionStatus`, y renderiza las dos secciones separadas por un
  `border-t` + `PanelHeading` ("Transferencia bancaria"), mismo patrón de
  secciones múltiples que usa `ordering-form.tsx`. La page sigue sin importar
  `@supabase/*` (regla dura): solo llama a los dos controllers y pasa los datos
  a los forms.
- `.impeccable/surfaces/src-views-admin-pagos-bank-account-form-tsx.md`
  **(nuevo)** — brief de la superficie, modo Operate, con los tres estados de
  D3 y el límite de copy de D2 documentados explícitamente para que quien
  toque este archivo después no tenga que releer `00-architecture.md` entero.

No se tocó ningún archivo fuera de mi propiedad (`src/views/admin/pagos/**`,
`src/app/admin/(app)/pagos/page.tsx`, el brief nuevo).

## Contratos consumidos de T1 (verificados contra el código real, no solo el plan)

T1 corrió en paralelo y terminó antes que yo. Verifiqué las firmas reales
contra `01-tasks.md` y until dos diferencias que importan:

1. **`BankAccountInput` es `z.infer` (tipo de SALIDA post-transform), no el
   tipo crudo pre-parse.** El nombre sugería lo contrario, pero
   `requestBankAccountChangeAction` igual hace
   `bankAccountInputSchema.parse(input)` puertas adentro, así que en runtime da
   igual: le mando strings crudos (`cbu`/`alias`/`holderTaxId` con formato
   libre, `''` para "no cargado") y el `.parse()` interno normaliza y valida de
   nuevo. TypeScript no se queja porque los campos opcionales aceptan
   `string | undefined` y yo mando `string` (incluyendo `''`), que es un
   subtipo válido. Si alguna vez `requestBankAccountChangeAction` deja de
   re-parsear, este archivo necesita normalizar client-side antes de armar
   `input` — dejo la nota acá para que no se pierda.
2. **`lookupBankHolderAction` pide `holderTaxId` en el `probe`**, no solo
   `{ cbu?, alias? }` como decía la firma de T1.8 en `01-tasks.md`. Sin el CUIT
   que el dueño está tipeando en ese momento no hay con qué comparar del lado
   del proveedor — T1 lo documentó como "vacío editorial" del plan, no como
   decisión de diseño. Lo detecté leyendo `admin.actions.ts` (el `match` salía
   `'unavailable'` siempre si no mandaba `holderTaxId`) y actualicé
   `HolderContrast` para mandarlo. **Reporto esto como la única divergencia
   real entre plan y código** — el resto de las firmas (T1.1, T1.8, T1.9)
   coincidió exactamente con lo documentado.

Del resto, consumido tal cual: `isValidCbu` / `isValidAlias` / `bankNameForCbu`
/ `normalizeCbu` / `normalizeAlias` / `CBU_LENGTH` de `src/lib/cbu.ts` (mismo
módulo puro que corre en el servidor — cero regex duplicada en la vista),
`getBankAccountStatus` / `BankAccountStatus` / `BankHolderProbe` de
`admin.controller.ts`, y las cuatro acciones de `admin.actions.ts`
(`requestBankAccountChangeAction`, `lookupBankHolderAction`,
`setBankAccountActiveAction`, `deleteBankAccountAction`). Alineé el copy de
error del CBU y del alias en el cliente para que sea **byte-idéntico** al
mensaje que devuelve el schema del servidor ("Revisá el CBU o CVU: los dígitos
verificadores no dan.", "El alias tiene que tener de 6 a 20 caracteres (letras,
números, punto o guion)."): si algún día divergen, sería peor que un usuario
viera dos redacciones distintas del mismo error según si lo atajó el cliente o
el servidor.

## Los tres estados de D3 (CBU/CVU obligatorio-o-no, alias solo)

Implementados como estados **visualmente distintos** en el campo de CBU, no
como una sola clase de error:

1. **Checksum OK** (`cbuValid`): texto en `text-primary` con `CircleCheck`,
   "CBU con formato válido" + `— {bankName}` si `bankNameForCbu` resuelve algo
   (nunca un hueco ni un placeholder si devuelve `null`).
2. **Sin checksum posible, solo alias** (`onlyAlias`: hay alias, no hay CBU):
   `text-warning-foreground` con `TriangleAlert`. **No bloquea** — no entra en
   `canSubmit`.
3. **Checksum inválido** (`cbuChecksumBad`: 22 dígitos, DV mal): `text-destructive`
   con `CircleAlert`, nombra el problema exacto, y **sí bloquea** (`canSubmit`
   se vuelve `false`).

No usé ningún token de color nuevo: el "positivo" reusa `--primary` (mismo
criterio que el pill "Conectado" de `payment-form.tsx`) porque este proyecto no
tiene un `--success` separado — inventar uno hubiera sido un color nuevo fuera
del sistema.

## El filtro de copy D2 (nada de "verificado")

Ningún string en el archivo usa "verificado", "validado" ni ninguna variante.
Las únicas afirmaciones sobre el CBU son "formato válido" (checksum, nada más)
y, en el contraste, "coincide"/"no coincide" (comparación de CUIT, nunca
identidad). El bloque de contraste dice explícitamente "no te devolvemos ningún
nombre" para que quede claro por qué un `mismatch` no es un rechazo. Repasé
`00-architecture.md` §4.1 línea por línea contra el archivo final antes de
cerrar.

## El contraste (`HolderContrast`)

Construido completo (botón manual, nunca en cada tecla; nunca muestra un
nombre, solo `match`/`mismatch`/`unavailable`), pero **con
`status.validatorAvailable === false` (el estado real de hoy, D0/D7) la
sección entera no se monta** — ni el botón ni un placeholder explicando que no
hay proveedor. Agregué además una guarda que el plan no explicitaba: el botón
queda deshabilitado si falta el CUIT del titular (`canProbe`), con un hint
("Hace falta el CUIT del titular para poder contrastar"), porque sin ese campo
`lookupBankHolderAction` siempre devuelve `'unavailable'` y un botón que
"contrasta" sin poder contrastar nada es peor que no tenerlo — mismo principio
que ya aplica el plan a la sección completa.

## Apagar/borrar sin código, activar tras confirmar

`setBankAccountActiveAction` (toggle inline, `ActiveToggle`, sin diálogo — es
reversible e inmediato, igual que `AcceptingOrdersToggle` de
`ordering-form.tsx` pero sin la parte destructiva porque acá no hay nada que
cancelar) y `deleteBankAccountAction` (reusa `ConfirmDeleteButton` de
`catalogo/`, único modal de la pantalla) van sin `ConfirmWithCode`, tal como
pide el plan. **Nota de diseño que encontré leyendo `upsertBankAccount`
(T1)**: confirmar un cambio con el código siempre deja `is_active: true`, sea
alta o reemplazo — así que en `onConfirmed` fuerzo `setIsActive(true)`
localmente para que el pill no muestre "Pausada" un instante antes de que
`router.refresh()` traiga el dato real.

## Por qué no reusé `ToggleField` de `views/admin/ajustes/fields.tsx`

Existe un componente casi idéntico ahí, pero su propio comentario lo describe
como compartido **solo** entre las dos páginas de Ajustes que arrastran un
`useForm` con barra de guardado — no es una pieza declarada para el resto del
árbol. Mi toggle no guarda por lotes (pega directo al servidor al tocarlo,
como `AcceptingOrdersToggle`), así que además de la intención documentada, el
comportamiento es distinto. Escribí `ActiveToggle` local (25 líneas, mismo
idioma visual `group/field-label`-like) en vez de acoplar `pagos/` a un archivo
de `ajustes/` que no se declaró reusable. Si en algún momento aparece un tercer
lugar que necesite este mismo toggle, ahí sí vale la pena subirlo a
`views/admin/shared/`.

## Por qué no usé `react-hook-form`

`payment-form.tsx`, la hermana explícita que el brief pide imitar, tampoco lo
usa — es `useState` por campo. Mezclar los dos enfoques en la misma pantalla de
Pagos sería la inconsistencia que `operate.md` prohíbe explícitamente ("same
button shape, same form-control vocabulary"). El formulario es chico (cuatro
campos) y la validación en vivo depende de funciones puras de `src/lib/cbu.ts`
que no necesitan un resolver de Zod corriendo en cada keystroke.

## Comportamientos user-facing implementados (spec para `test-engineer`)

Acceptance criteria de `01-tasks.md` T3, uno por uno:

- **Sin cuenta cargada**: la caja de estado muestra qué es transferencia
  bancaria, qué habilita y qué hace falta (CBU/CVU o alias + titular) — no
  "no hay nada". Verificable: render con `status.account === null`.
- **Con cuenta cargada**: la caja muestra pill "Activa"/"Pausada", el banco si
  `account.bankName` no es `null`, y el formulario llega pre-poblado con
  `cbu`, `alias`, `holderName`, `holderTaxId` de `account`.
- **CBU inválido no se puede enviar**: con 22 dígitos y checksum malo,
  `canSubmit` es `false` (el botón `disabled`) y el mensaje inline dice
  "Revisá el CBU o CVU: los dígitos verificadores no dan." — mismo string que
  el `refine` del servidor.
- **Solo alias**: con `alias` no vacío y `cbu` vacío, aparece el aviso
  `text-warning-foreground` y el envío **no** se bloquea por esto (sí sigue
  bloqueado si falta `holderName`).
- **Al menos un identificador**: con `cbu` y `alias` vacíos, el botón queda
  deshabilitado y aparece "Cargá un CBU, un CVU o un alias — hace falta al
  menos uno." en vez del texto de "te mandamos un código".
- **El formulario no pierde lo tipeado si el código falla**: `onRequestFailed`
  y `onCancel` de `ConfirmWithCode` solo tocan `error`/`fieldErrors`/
  `submitting` — nunca los campos del formulario. Verificable simulando un
  `requestBankAccountChangeAction` que resuelve `{ ok: false }` y comprobando
  que `cbu`/`alias`/`holderName`/`holderTaxId` siguen en pantalla.
- **Errores de campo del servidor** (`fieldErrors.cbu`, `.alias`, `.holderName`,
  `.holderTaxId`) tienen prioridad sobre la validación en vivo del cliente y se
  muestran en el mismo lugar que el hint normal (mismo `id`, así que
  `aria-describedby` nunca apunta a un nodo que no existe).
- **Apagar/reactivar** (`setBankAccountActiveAction`) es inmediato, sin modal;
  si el server devuelve error, el valor **no se optimiza** (se queda en el
  estado previo) y sale un toast — mismo contrato que `AcceptingOrdersToggle`.
- **Borrar** (`deleteBankAccountAction`) pasa por `ConfirmDeleteButton`
  (diálogo destructivo); en éxito limpia los cuatro campos del form y
  refresca; en error, el mensaje se muestra inline en el diálogo sin cerrarlo
  (comportamiento propio de `ConfirmDeleteButton`, no reescrito acá).
- **Contraste** (`lookupBankHolderAction`, solo si `validatorAvailable`): botón
  deshabilitado sin `holderTaxId`; en éxito muestra exactamente uno de los tres
  veredictos (`match`/`mismatch`/`unavailable`) y **nunca** un nombre — ni en
  el DOM, ni en el estado de React (`ProbeState` solo guarda `BankHolderProbe`,
  que ya no lleva `holderName` desde el servidor).

## Accesibilidad

- Los cuatro inputs de texto tienen `Label htmlFor` + `aria-describedby` que
  **siempre** apunta a un párrafo presente (hint, error de cliente o error de
  servidor comparten el mismo `id` en un `if/else if` mutuamente excluyente) —
  nunca un id huérfano.
- `aria-invalid` combina validación de cliente y `fieldErrors` del servidor.
- Errores usan `role="alert"`; el veredicto del contraste usa `role="status"`
  (no es un error, es información).
- Toggle de "Cuenta activa": `label htmlFor` envolviendo el `Checkbox`, foco
  visible con `has-[:focus-visible]:ring-3`, hit target de fila completa
  (`min-h-11`).
- `spellCheck={false}` en los tres campos donde no aplica (CBU, alias, CUIT);
  `holderName` lo deja en `true` (es un nombre propio, corrector útil).
- Revisé el archivo contra las Web Interface Guidelines de Vercel
  (`web-design-guidelines` skill): sin hallazgos — el único ajuste que hice
  durante la revisión fue unificar los `aria-describedby` para que apunten
  siempre a un nodo montado, sin importar la rama condicional.

## Lo que dejé afuera / follow-ups

- **No hay copy sobre WhatsApp/soporte** en esta sección — a diferencia de
  `payment-form.tsx`, el plan no pide un botón de "pedir ayuda" acá (el escape
  hatch de transferencia es el botón de WhatsApp en el **detalle del pedido**
  del admin, que es alcance de T5, no de esta pantalla).
- **No implementé un explicador de "qué es un CVU vs. un CBU"**: el plan no lo
  pide y el campo ya dice "CBU o CVU" en el label — agregar más texto ahí
  hubiera sido explicar de más una distinción que no cambia el flujo del
  dueño.
- **Dependencia cruzada verificada, no pendiente**: al momento de escribir este
  log, T1 ya había terminado (`src/lib/cbu.ts`, `store-bank-account.model.ts`,
  `admin.controller.ts`, `admin.actions.ts`, `store.schema.ts` todos
  presentes), así que `npm run typecheck` corre limpio sobre mis dos archivos.
  Los únicos errores de `tsc --noEmit` que quedan en el árbol son en
  `tests/lib/store-availability.test.ts` y `tests/lib/store-hours.test.ts`
  (faltan `transferPaymentEnabled` en fixtures) — son de `test-engineer`, no
  los toqué.

## Verificación

- `npm run typecheck`: limpio para `src/views/admin/pagos/bank-account-form.tsx`
  y `src/app/admin/(app)/pagos/page.tsx`.
- `npm run lint` (repo completo): sin hallazgos.
- Hook `impeccable` tras cada edición: sin hallazgos deterministas.
