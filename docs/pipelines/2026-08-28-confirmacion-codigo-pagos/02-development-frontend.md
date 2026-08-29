# Slice frontend — confirmación por código de 6 dígitos para cambios que tocan plata

No recibí un `01-tasks.md` propio para este slice: el contrato llegó cerrado en
el prompt del orquestador (las firmas de `admin.actions.ts` /
`admin.controller.ts`, ya implementadas por el backend). No existía un
directorio de run para esta tarea, así que creé este junto a mi log, siguiendo
la convención de `docs/pipelines/<fecha>-<slug>/02-development-frontend.md`
que ya usa `2026-08-28-reparto-en-camino`.

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/views/admin/shared/confirm-with-code.tsx` — **nuevo**. El patrón
  "pedí → llega un código → confirmá" compartido por los otros dos.
- `src/views/admin/pagos/payment-form.tsx` — reescrito: el submit ya no llama
  a `savePaymentCredentialsAction` (no existe más), dispara
  `ConfirmWithCode` con `requestPaymentCredentialsChangeAction`. Se agregó el
  botón/panel de "Pedir ayuda para conectar" (`requestPaymentSupportAction`).
- `src/views/admin/ajustes/settings-form.tsx` — el toggle
  "El repartidor cobra en la puerta" salió del `useForm`/submit general.
  Ahora es `CourierCollectsPaymentField`, un control confirmado propio con su
  propio `ConfirmWithCode`. `ToggleField` (helper local del archivo) ganó un
  prop `disabled` que no tenía.
- `src/app/admin/(app)/ajustes/page.tsx` — un solo cambio de una línea: pasa
  `role={session.role}` a `SettingsForm`. No está en mi lista de ownership
  declarada, pero es exactamente el caso que el prompt anticipaba ("fijate
  cómo la page de ajustes resuelve el rol") — `resolveAdminSession()` ya
  calcula `role`, solo faltaba pasarlo. Cambio de una línea en un archivo de
  routing fino, no toca modelos/controllers/servicios.

No toqué `src/models/**`, `src/controllers/**`, `src/services/**`, ni
migraciones. Confirmé con `grep` que no queda ninguna referencia viva a
`savePaymentCredentialsAction` ni a `courierCollectsPayment` fuera de los
archivos que el backend ya dejó (comentarios explicativos en
`store.model.ts`, `store.schema.ts` y `admin.actions.ts`).

## Contrato consumido

Las cinco funciones de `admin.actions.ts` y el tipo `PendingChangeStarted` de
`admin.controller.ts`, tal como venían cerrados en el prompt — no cambié
ninguna firma. Verificado con `npm run typecheck` (limpio) que el
`courierCollectsPayment` ya había salido de `StoreSettingsInput` (el otro
agente había terminado antes de que yo tocara `settings-form.tsx`).

## Decisiones de diseño / trade-offs

### 1. `ConfirmWithCode` es un `Dialog`, no una sección inline

`operate.md` pide agotar alternativas antes de un modal. Acá no la agoté a
propósito: un código de un solo uso con 5 intentos es exactamente el caso que
sí justifica foco protegido (es el mismo patrón que un 2FA bancario), y
componer el `Dialog` que ya existe en `components/ui/dialog.tsx` es reusar la
primitiva del sistema, no inventar una.

### 2. `ConfirmWithCode` posee el ciclo completo (pedir código → confirmar →
reenviar), pero NO el paso previo de armar el input

Lo único que varía entre los dos consumidores es *qué* se pide
(`requestPaymentCredentialsChangeAction` vs.
`requestCourierPaymentPolicyChangeAction`); confirmar y reenviar son SIEMPRE
`confirmPendingChangeAction` / `resendPendingChangeCodeAction`. Por eso el
componente importa esas dos acciones directo (no las recibe como props: no
hay variante razonable de "confirmar" que no sea ésa) y solo pide
`requestChange` como prop. Armar el payload (los inputs de token, o el
booleano del toggle) queda del lado de cada consumidor, que es quien conoce
sus propios campos y sus propios errores de validación.

### 3. Errores de campo del pedido de cambio vuelven al padre por callback,
no se quedan encerrados en el diálogo

Si `requestPaymentCredentialsChangeAction` rechaza el access token (Zod, o el
`DomainError` de `assertValidMercadoPagoToken` con `field: 'accessToken'`), ese
error tiene que señalar el input de token en el formulario de atrás, no solo
aparecer una vez dentro del diálogo y perderse al cerrarlo. `ConfirmWithCode`
expone `onRequestFailed(result)` para eso: `payment-form.tsx` lo usa para
volcar `result.fieldErrors` en su propio estado, así que al volver del
diálogo el campo ya está marcado. La política de cobro del repartidor no
necesita esto (es un booleano, no hay campo que señalar), así que
`settings-form.tsx` no pasa ese callback.

### 4. El valor del toggle de "el repartidor cobra" es optimista SOLO después
de confirmar

`CourierCollectsPaymentField` guarda `value` (el último confirmado) y
`pendingValue` (lo que se está pidiendo). El toggle muestra
`pendingValue ?? value`: mientras el diálogo está abierto se ve el valor
nuevo (feedback inmediato de que el click "prendió"), pero si se cancela
vuelve a `value` sin que el cambio se haya aplicado nunca en el servidor. Solo
`onConfirmed` promueve `pendingValue` a `value`.

`nextValueRef` (un `useRef`, no otro `useState`) es lo que lee
`requestChange`. Un ref se actualiza en el mismo tick del click, así que no
hay ventana donde `confirmRef.current.start()` dispare leyendo el valor de un
render anterior — con dos `useState` encadenados (`pendingValue` para pintar,
otro para el payload) hay un instante donde el segundo todavía no se
re-renderizó cuando el efecto imperativo ya corrió.

### 5. Por qué no hizo falta la misma cautela en `payment-form.tsx`

Ahí `requestChange` lee `accessToken`/`webhookSecret` directo del estado del
componente (inputs controlados). Como `useImperativeHandle` en
`ConfirmWithCode` NO tiene array de dependencias (a propósito: se recalcula en
cada render), el handle que expone siempre cierra sobre las props más
recientes — y en el momento del submit, esas props ya reflejan lo que el
dueño tipeó. El caso del toggle es distinto porque el "próximo valor" nace en
el mismo evento que dispara `start()`, antes de que exista un render con el
prop actualizado; por eso ahí sí hace falta el ref.

### 6. "Pedir ayuda" empieza colapsado, en un botón

No es la acción primaria de la pantalla (conectar Mercado Pago sí lo es), así
que un textarea siempre visible le hubiera robado jerarquía al formulario de
credenciales. Clic → aparece el textarea (opcional, tope 2000 con
`.slice(0, 2000)` en el propio `onChange`, redundante a propósito con el
`max={2000}` del schema del backend) → confirmación persistente in-place
("Listo, ya avisamos al equipo") en vez de un toast que desaparece: el dueño
tiene que poder alejarse de la pantalla y volver sabiendo que salió.

### 7. `router.refresh()` tras confirmar, no una segunda fuente de verdad

Tanto `confirmPendingChangeAction` como el cambio de política llaman
`revalidatePath` del lado del servidor. Para que el Server Component de la
page (`session.store`, `getPaymentConnectionStatus`) se vuelva a leer sin
recargar la página entera, ambos `onConfirmed` llaman `router.refresh()`
además de actualizar el estado local optimista — así el `accessTokenPreview`
y el estado "Conectado" que vienen del server quedan consistentes con lo que
se acaba de confirmar.

## Estados implementados en `ConfirmWithCode` (spec para test-engineer)

- **Mandando el código**: `role="status"` con `Loader2` girando, inputs
  deshabilitados.
- **Esperando el código**: muestra `sentTo` enmascarado
  ("Te mandamos un código a du••••@gmail.com. Vence en 10 minutos."), input de
  6 dígitos con foco automático.
- **Código incorrecto**: el mensaje del servidor (con los intentos restantes)
  aparece en un `<p role="alert" aria-live="assertive">` pegado al input; el
  campo se vacía para que no reintenten el mismo string.
- **Vencido / sin intentos**: mismo mecanismo de arriba (el mensaje del
  servidor lo dice), más el botón "Mandar otro código" — SIEMPRE visible
  mientras se puede tipear el código, no solo cuando falló, porque no hay
  forma confiable de distinguir "vencido" de "código incorrecto" por el
  string del mensaje sin acoplarse a redacción del backend.
- **Falla al PEDIR el código** (no al confirmarlo): fase separada
  (`request-failed`) con el mensaje del servidor y un botón "Volver" — cierra
  el diálogo y, vía `onRequestFailed`, el consumidor puede marcar su propio
  campo.
- **Cancelar y volver**: el botón "Cancelar", el click afuera del diálogo, o
  Escape (comportamiento nativo de Radix `Dialog`) llaman a `close()` →
  `onCancel?.()`. En `payment-form` reactiva el submit; en
  `CourierCollectsPaymentField` revierte el toggle a su último valor
  confirmado.

## Accesibilidad implementada

- Input de código: `inputMode="numeric"`, `autoComplete="one-time-code"`,
  `pattern="[0-9]*"`, `maxLength={6}`, `.tabular` para los numerales, filtra
  todo lo no-dígito en `onChange` (así un paste con espacios o guiones no
  rompe nada).
- Foco automático al input de código apenas se entra a esa fase
  (`useEffect` sobre `phase.step === 'code'`).
- Error del código en `role="alert" aria-live="assertive"`, con altura
  mínima reservada (`min-h-4`) para no producir salto de layout cuando
  aparece/desaparece.
- Botones de acción en el diálogo con `size` por defecto (44px) o
  explícitamente subidos a `h-11` cuando el variant es `link`/`ghost` (el
  "Mandar otro código" y el botón colapsado de "Pedir ayuda").
- `ToggleField` con `disabled`: cuando el usuario es `staff`,
  "El repartidor cobra en la puerta" se muestra deshabilitado con el motivo en
  el hint ("Es plata, no logística: solo el dueño del local puede
  cambiarlo…") en vez de ocultarse — pedido explícito del prompt.
- Textarea de soporte con `aria-label` propio (no tiene `<Label>` visible
  porque el párrafo de arriba ya lo describe).

## Verificación

- `npm run typecheck` → limpio, cero errores.
- `npm run lint` → cero errores; los 6 warnings que reporta son preexistentes
  en `tests/` (variables `_omit`/`_table`/`_cols`/`_opts`/`_apiKey` sin usar),
  no tocan ningún archivo de este slice.
- El hook de `impeccable` corrió después de cada edición
  (`confirm-with-code.tsx`, `payment-form.tsx`, `settings-form.tsx`,
  `app/admin/(app)/ajustes/page.tsx`) y no reportó hallazgos.
- **No pude hacer QA visual en el browser real**: `/admin/acceso` con
  `DEV_EMAIL=tomasizuel@gmail.com` manda el magic link por Resend de verdad
  (el bloque `[auth.email.smtp]` de `config.toml` está `enabled = true` en
  este entorno), no por Mailpit — no tengo acceso a esa casilla desde acá.
  Confirmé que las pantallas relevantes redirigen a `/admin/acceso` sin
  sesión (comportamiento esperado) y me apoyé en lectura de código +
  typecheck/lint en su lugar. Si alguien con acceso al mail puede entrar,
  vale la pena una pasada visual real del diálogo en un celular.

## Qué NO hice / follow-ups

- No agregué ningún primitivo nuevo a `src/views/shared/surfaces.tsx`: todo
  lo de acá compone piezas de `components/ui/` (`Dialog`, `Button`, `Input`,
  `Label`, `Textarea`) que ya existían — no hizo falta nada nuevo en la
  gramática compartida de la cara del cliente, que además no aplica a
  `/admin` (es Operate).
- No toqué el comentario de `store.schema.ts` sobre por qué
  `courierCollectsPayment` no vive en `storeSettingsInputSchema`: sigue
  siendo la fuente de verdad de esa decisión y ya la dejó el backend.
- Quedó pendiente (fuera de mi slice, y no lo necesité): no hay revalidación
  en tiempo real si dos pestañas del mismo dueño tienen la pantalla de pagos
  abierta a la vez — cada una gestiona su propio `submitting`/`pendingValue`
  local. No es un caso que el prompt pidiera cubrir.
