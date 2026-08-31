---
version: 1
slug: "src-views-admin-pagos-bank-account-form-tsx"
primary_target: "src/views/admin/pagos/bank-account-form.tsx"
related_targets: ["src/views/admin/pagos/payment-form.tsx","src/views/admin/shared/confirm-with-code.tsx","src/views/admin/catalogo/confirm-delete-button.tsx","src/app/admin/(app)/pagos/page.tsx"]
---

# Transferencia bancaria como tercer medio de pago

**Alcance y modo.** Sección nueva en `/admin/pagos`, hermana de la de Mercado
Pago que ya existe (`payment-form.tsx`). Modo **Operate**: la vara es la misma
pantalla de al lado, no una landing de producto.

**Audiencia y trabajo.** El dueño del local (nunca `staff`: cambiar o crear la
cuenta exige `role: 'owner'`, igual que las credenciales de Mercado Pago), en el
mismo momento en que da de alta o revisa su forma de cobrar. La consecuencia de
equivocarse acá es peor que un typo cualquiera: el CBU se le muestra a cada
cliente que elige transferencia, así que un dígito mal cargado redirige la
plata de todos ellos a una cuenta que no es la del local.

**Por qué no es "un campo más".** Igual que el access token de Mercado Pago,
cambiar el CBU pasa por `ConfirmWithCode` — el mismo componente, sin un segundo
flujo. A diferencia de MP, acá **no hay ningún secreto que cifrar**: el CBU es
público a propósito (el cliente lo necesita para transferir), así que el código
protege el *destino* de la plata, no un dato confidencial. Apagar
(`is_active`) o borrar la cuenta **no** piden código: no redirigen nada, solo
sacan el método de la vitrina — decisión de `00-architecture.md` §5.11.

## Lo que NO se puede prometer (D2, vinculante)

Este producto **no verifica titulares de cuenta** — no existe forma gratuita de
resolver CBU → titular en Argentina (`00-architecture.md` §3.2). Lo único que
hay es: (a) un checksum matemático sobre el CBU/CVU, que solo dice "está bien
tipeado", y (b) un contraste opcional CUIT-contra-CUIT contra un proveedor que
hoy no está contratado.

**Prohibido en esta pantalla**: "cuenta verificada", "titular validado",
cualquier tilde o sello que sugiera identidad confirmada. **Permitido y
correcto**: "el CBU tiene formato válido", "no pudimos comprobar el titular",
"el CUIT de esa cuenta no coincide con el que cargaste".

## Los tres estados del CBU/CVU (D3)

El dueño puede cargar CBU, CVU o alias — al menos uno, cualquier combinación.
`cbu` y `alias` son ambos nullable en el modelo; el campo `cbu` cubre CBU y CVU
por igual (se distinguen por los tres primeros dígitos, ver `src/lib/cbu.ts`).
Se distinguen **visualmente**, nunca con el mismo tratamiento:

1. **Checksum OK** — CBU/CVU completo (22 dígitos) y los dígitos verificadores
   dan. Tono neutro/primario: "CBU con formato válido" + el banco si
   `bankNameForCbu` lo resuelve (si devuelve `null` porque la tabla del BCRA no
   cubre esa entidad, **no se muestra ni un hueco ni un error** — el dato
   simplemente no está).
2. **Sin checksum posible (solo alias)** — no hay CBU cargado. Tono
   **warning** (no error, no bloquea envío): avisa que un alias mal tipeado no
   se detecta hasta que un cliente transfiere a la cuenta equivocada. Es
   información para decidir, no una validación que se pueda "arreglar" en el
   formulario.
3. **Checksum inválido** — hay 22 dígitos pero no dan. Tono **destructive** y
   **sí bloquea el envío**. El mensaje nombra el problema exacto: "Revisá el
   CBU: los dígitos verificadores no dan" (mismo string que el `refine` del
   servidor, para que cliente y servidor digan lo mismo).

La validación corre **en vivo, sobre el mismo módulo puro** que usa el
servidor (`isValidCbu`/`bankNameForCbu` de `src/lib/cbu.ts`, sin
`server-only` a propósito) — nunca una regex duplicada en la vista.

## El contraste con proveedor (día uno: no existe)

`lookupBankHolderAction` es un botón aparte ("Contrastar titular" o similar),
**no se dispara en cada tecla**. Devuelve un veredicto —
`match` / `mismatch` / `unavailable` — y **nunca un nombre**: mostrar el nombre
que trajo el proveedor cuando no coincide es divulgar un dato personal de un
tercero (`00-architecture.md` §3.5). `mismatch` no bloquea el envío: puede ser
una cuenta a nombre de otra persona de la familia, o un CUIT de facturación
distinto del de cobro.

**`status.validatorAvailable` es hoy `false` siempre** (no hay proveedor
contratado, `00-architecture.md` §3.4). Con `false`, **la sección de contraste
no se renderiza** — ni el botón, ni un placeholder que explique que no hay
proveedor. Un botón que no hace nada es peor que ningún botón. El estado que
tiene que quedar impecable es exactamente este: sin proveedor, con el resto de
la pantalla completo y útil igual.

## Selected direction

Reusa el esqueleto visual de `payment-form.tsx`: una caja de estado arriba
(borde, sin sombra, ícono + texto — acá `Landmark` en vez del isotipo de MP),
un formulario abajo, `ConfirmWithCode` al pie. **Sin cuenta cargada**, la caja
de estado enseña (qué es, qué habilita, qué hace falta) en vez de decir "no hay
nada" — ver `operate.md`, "empty states que enseñan". **Con cuenta cargada**,
la caja muestra el estado activo/pausado (mismo tratamiento de pill que
"Conectado"/"Modo prueba" de MP) más un toggle inline para pausar/reactivar
(acción inmediata, sin código) y el botón de borrar (`ConfirmDeleteButton`,
diálogo destructivo — único modal de esta sección, coherente con el resto del
árbol de `/admin`).

Los campos del formulario: CBU/CVU (dígitos únicamente, se filtran al tipear),
alias, titular declarado (obligatorio), CUIT del titular (opcional, para el
contraste futuro). Ninguno usa `react-hook-form`: como `payment-form.tsx`, el
formulario es chico y el estado por campo alcanza — mezclar los dos enfoques en
la misma pantalla sería la inconsistencia que `operate.md` prohíbe
explícitamente ("same button shape, same form-control vocabulary").

## Estados que tienen que existir

Sin cuenta (empty state que enseña) · con cuenta activa · con cuenta pausada ·
CBU vacío con solo alias (warning) · CBU con checksum inválido (bloquea,
nombra el problema) · CBU válido sin banco resuelto (sin hueco) · CBU válido
con banco resuelto · enviando el pedido de código · código rechazado (el form
no pierde lo tipeado) · confirmado con éxito · alternando activo/pausado ·
borrando (diálogo + error inline si falla) · con `validatorAvailable: true`:
contraste inactivo / cargando / `match` / `mismatch` / `unavailable`.

## Constraints

- `holderName` es SIEMPRE lo que el dueño declaró — nunca lo que devuelva un
  proveedor. No hay campo ni estado que muestre un nombre distinto al tipeado.
- Ningún dato de `holderTaxId` sale de este panel: no está en `StoreBankAccount`
  (público), solo en `StoreBankAccountAdmin`.
- Targets de 44px, foco visible, `aria-invalid` + `aria-describedby` en cada
  campo con error, igual que `payment-form.tsx`.
- Sin kicker/eyebrow, sin `Panel` anidado dentro de otro `Panel` — esto es
  Operate, no la gramática de `views/shared/surfaces.tsx`.
