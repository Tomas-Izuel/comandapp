# Revisión — Transferencia bancaria como tercer medio de pago

**Veredicto: APROBADO**

Revisor: `code-reviewer`. Corre en paralelo con `test-engineer`, sobre el árbol de trabajo de `feat/transferencia-bancaria` (los cambios están sin commitear; no hay divergencia de commits contra `main`, así que el diff real es `git diff HEAD` + los archivos sin trackear).

## Alcance revisado

```
37 archivos modificados, 12 nuevos (+ la migración), 1598 inserciones / 109 borrados
(sin contar skills-lock.json, mercadopago.adapter.ts, .agents/skills/**, .claude/skills/gril*
— explícitamente fuera de alcance)
```

Incluye: la migración `supabase/migrations/20260831120000_transferencia_bancaria.sql`; los modelos y controllers de cuenta bancaria (T1) y de pedido/comprobante (T2); las vistas de `/admin/pagos` (T3), checkout/seguimiento del cliente (T4) y la bandeja del KDS (T5); y los tres archivos que el hilo principal tocó fuera de su propio corte (`platform.model.ts`, `email.port.ts`, `payment-change.tsx`, más `checkout.controller.ts`/`kitchen.controller.ts` para exportar dos funciones, y `tests/db/order-state-machine.test.ts`).

Verifiqué `npm run typecheck` y `npm run lint` sobre el árbol completo: los dos limpios. No corrí `npm test` (dominio de `test-engineer`, corriendo en paralelo).

## Lo que confirmé, independientemente de lo que ya validó el orquestador

- **El checksum de CBU/CVU** (`src/lib/cbu.ts`): repliqué el algoritmo en un script aparte y validé los dos vectores de `00-architecture.md` (el CVU de Mercado Pago y el CBU de ejemplo) → `true` en los dos, y una mutación de un dígito → `false`. El `% 10` exterior está.
- **Los siete binarios de `00-architecture.md` §2.2**: los cinco que había que arreglar están arreglados y los tres que NO había que tocar (`canResumePayment` en `order.model.ts:249`, la guarda `paymentMethod !== 'online'` de `checkout.actions.ts:29`, y el `mismatchReason` de `markOrderPaid` en `order.model.ts:1332`) siguen exactamente como estaban, byte a byte.
- **El predicado del trigger y el de `updateOrderStatus` dicen lo mismo**: los dos son `<> 'in_store'` (migración línea 463, `order.model.ts:1215`).
- **Ningún `grant` nuevo sobre `orders`**: las cinco columnas de comprobante no tienen ni un `grant update` para `authenticated`; confirmado por grep sobre la migración completa.
- **`getPublicBankAccount` enumera columnas**, nunca `select('*')` (`store-bank-account.model.ts:49`).
- **El route handler del comprobante ignora el `Content-Type`** y decide por magic bytes (`FF D8 FF` / `%PDF-`) antes de tocar Storage.
- **`clearReceiptRefs` nunca incluye `transfer_receipt_uploaded_at`** en su `update()` — solo nulea `path` y `mime`.
- **Ningún adapter de `bank-validation` propaga una excepción**: `manual.adapter.ts` no puede tirar por construcción (dos funciones que siempre devuelven `null`), y `certisend.adapter.ts` envuelve todo en `try/catch` y solo loguea "no se pudo contrastar", nunca el body de la respuesta.
- **El nombre del titular que devuelve el proveedor no sale nunca**: revisé los tres puntos de contacto (`resolveHolderMatch`, la rama inline de `lookupBankHolderAction`, y el payload que arma `requestBankAccountChangeAction` para `store_pending_changes`) y en los tres el `BankAccountLookup` completo se descarta apenas se calcula el veredicto; lo único que sobrevive es `'match'|'mismatch'|'unavailable'` + `checkedAt`. `BankHolderProbe` (el tipo que cruza al browser) no tiene campo `holderName`.
- **Ningún `page.tsx` tocado importa `@supabase/*`** (los cinco que cambiaron: checkout, admin raíz, pagos, privacidad, pedido/[token]).
- **Ningún `.actions.ts` exporta algo que no sea una función `async`** (`admin.actions.ts`, `kitchen.actions.ts` completos, grep de `^export`).
- **Sin doble dueño de archivo no disclosed**: crucé la lista completa del diff contra `01-tasks.md`. Los únicos archivos sin dueño en la spec original que alguien tocó son los que ya están reportados — por T1 (`store-hours.ts`, `payment-change.tsx`) y por el propio orquestador (`platform.model.ts`, `email.port.ts`, `checkout.controller.ts`/`kitchen.controller.ts` para exportar `sendReceiptEmail`/`sendConfirmedWhatsapp`, `tests/db/order-state-machine.test.ts`). No encontré ninguno adicional.
- **Idempotencia y doble cobro**: `markPaidByTransfer` hace CAS sobre `orders` (`payment_method='transfer' AND payment_status='pending'`) y además inserta en `payments`, protegido por `payments_one_approved_per_order_idx`; un `23505` ahí se traduce a 409, no a 500. `storeTransferReceipt` sube el objeto ANTES de escribir la fila y hace CAS con `.is('transfer_receipt_uploaded_at', null)`; si pierde la carrera, borra el objeto recién subido (best-effort) y devuelve 409. El trigger bloquea el cambio de `transfer_receipt_uploaded_at` una vez no nula incluso para `service_role`, así que la invariante no depende solo del CAS de la aplicación.
- **Purga**: el cron primero borra del bucket (`purgeReceiptObjects`) y solo nulea la referencia de los paths que el borrado confirmó (`purgedPathSet`); si el borrado no devuelve nada, no nulea nada y el próximo tick reintenta. Orden correcto.
- **Aislamiento multi-tienda**: todas las escrituras y lecturas de `store-bank-account.model.ts` y las nuevas de `order.model.ts` llevan `.eq('store_id', ...)` explícito además del chequeo de membresía en el caller (`getTransferReceiptSignedUrl`, `markPaidByTransfer`). `storeTransferReceipt` deriva `store_id` del pedido resuelto por token —nunca del cliente— exactamente como pide `00-architecture.md` §6.1.
- **Sin copy de "verificado"**: grep de `verificad|validad` sobre las tres superficies nuevas/tocadas de cara al cliente y al staff solo encontró "dígitos verificadores" (describe el checksum, no una identidad), que es correcto. El copy de contraste dice "coincide"/"no coincide" y explícitamente "no te devolvemos ningún nombre".
- **`RouteContext<'/api/orders/[token]/comprobante'>`** existe y compila (Next 16, `params` como Promise) — confirmado por `tsc --noEmit` limpio.

## Hallazgos

Ninguno bloqueante. Los que siguen son observaciones para tener en cuenta, no defectos que impidan commitear.

### Minor

1. **`resendPendingChangeCodeAction` (`admin.actions.ts:593`, no tocado por esta rama) consume el balde `payment_change:store`, no `bank_account_change:store`, para CUALQUIER `kind` de cambio pendiente.** Es un comportamiento preexistente (ya aplicaba a `courier_payment_policy`), pero con `bank_account` como tercer consumidor, el reenvío del código de cuenta bancaria queda protegido por el balde de Mercado Pago en vez del suyo propio. No es una regresión de esta rama y no debilita la protección fail-closed (los dos baldes son `deny`, 3/1h), pero el nombre del balde nuevo (`bank_account_change:store`) sugiere una protección dedicada que en la práctica solo cubre el pedido inicial del cambio, no los reenvíos. Vale la pena una nota para una futura pasada, no bloquea esta.

2. **`getBankAccountStatus` (`admin.controller.ts`) no restringe por rol**, igual que `getPaymentConnectionStatus` (patrón preexistente): cualquier staff con membresía (no solo el dueño) puede leer `holderTaxId`, `holderMatch` y `checkedAt` a través de `/admin/pagos`. Es exactamente el mismo nivel de exposición que ya tiene la pantalla de Mercado Pago, así que no es una regresión de esta feature, pero el CUIT del titular es un dato más sensible que el estado de conexión de MP. Si se quiere endurecer, sería consistente hacerlo para las dos pantallas a la vez, no solo para ésta.

3. **Botones de `bank-account-form.tsx` en `h-10` (40px)**, por debajo del piso de 44px que exige `CLAUDE.md`. Es una copia exacta y deliberada del patrón ya existente en `payment-form.tsx` (la hermana de Mercado Pago en la misma pantalla), así que es deuda heredada de esa pantalla y no algo que esta rama introduce — pero al agregar una sección nueva a esa misma página era la oportunidad de corregirlo en las dos secciones a la vez. No bloqueante.

### Nit

4. El dev log de T2 describe un helper `toEmailPaymentMethod()` que colapsaba `'transfer'` a `'online'` antes de pasarlo a las plantillas de mail. Esa función no existe en el código final: en su lugar, `EmailVars.paymentMethod` se ensanchó a `'online' | 'in_store' | 'transfer'` (cambio hecho por el hilo principal en `email.port.ts`), que es la solución correcta y más simple. El log quedó desactualizado respecto del código — no hay ningún bug, solo quería dejar registrada la discrepancia entre lo reportado y lo implementado, por si alguien busca esa función y no la encuentra.

## Qué le rutéo a `test-engineer`

No escribo tests, pero dejo señalado dónde creo que falta cobertura más allá de la spec ya listada en `01-tasks.md`/T7:

- Un test que ejercite específicamente el camino "pierde la carrera del CAS en `storeTransferReceipt` después de subir el objeto" y confirme que el objeto se borra del bucket (o, si el borrado falla, que el próximo `listPurgeableReceipts` lo detecta igual por quedar con `transfer_receipt_uploaded_at is null` y `path` apuntando a un objeto ya huérfano — este caso border no está explícito en la spec de T2).
- El hallazgo #1 de arriba (`resendPendingChangeCodeAction` con `kind='bank_account'` consume `payment_change:store`, no `bank_account_change:store`) es verificable en TS sin base real y no está en ninguna lista de criterios de aceptación — si se considera un comportamiento a documentar (no a arreglar en esta rama), un test que lo deje explícito evita que alguien lo "corrija" sin darse cuenta de que ya era así para `courier_payment_policy`.

## Qué está bien

- La inversión del predicado (`<> 'in_store'` en vez de `= 'online'`) está aplicada de punta a punta —trigger, `createOrder`, `updateOrderStatus`— con el mismo comentario explicando el motivo en los tres lugares. Es exactamente el tipo de default seguro que `CLAUDE.md` pide para las enumeraciones que crecen.
- El manejo de datos personales de terceros (CUIT/nombre que devolvería un proveedor de validación) está tratado con el mismo rigor en el puerto, el adapter, la Server Action y el tipo que cruza al browser — cuatro capas independientes, ninguna deja pasar el nombre.
- La derivación de métodos de pago disponibles en `checkout-form.tsx` (lista + `.includes()` en vez de un booleano combinado) mata la clase de bug completa, no solo el caso puntual que se pidió arreglar.
- El copy del KDS y del panel del cliente respeta la regla de "la plata, no el comprobante" de punta a punta, incluida la `DialogDescription` del diálogo de confirmación.
- Buena disciplina de scope: los cinco slices se mantuvieron dentro de su corte de archivos con las únicas excepciones ya reportadas por sus propios dev logs, y ninguna de esas excepciones fue silenciosa.

## Blockers

Ninguno.
