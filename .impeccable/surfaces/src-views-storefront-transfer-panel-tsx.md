---
version: 1
slug: "src-views-storefront-transfer-panel-tsx"
primary_target: "src/views/storefront/transfer-panel.tsx"
related_targets: ["src/views/storefront/order-tracking.tsx","src/views/storefront/receipt-upload.ts","src/views/shared/order-status.tsx","src/app/pedido/[token]/page.tsx"]
---

# El panel de transferencia en el seguimiento del pedido

**Alcance y modo.** `src/views/storefront/transfer-panel.tsx` (nuevo),
consumido desde `src/views/storefront/order-tracking.tsx`. Modo **Operate**: el
cliente ya decidió comprar y ya eligió transferencia — ahora tiene que
completar el pago con una mano y a veces mala señal, sin volver a pensar en
plata mostrada de más ("carrera hacia el checkout" no aplica acá).

**Audiencia y trabajo.** El mismo comprador de siempre, parado en la vereda o
en el sillón, que acaba de confirmar el pedido y aterriza en `/pedido/[token]`
con una sola pantalla para resolver dos cosas: transferir el monto exacto al
CBU correcto, y subir la prueba de que lo hizo. Tiene **una sola oportunidad**
de subir el comprobante — decisión del dueño del producto, no rediscutible — así
que el craft de esta pantalla es evitar que esa única oportunidad se
desperdicie por apuro.

**El problema real que resuelve este brief.** Con "un comprobante por pedido,
punto" como regla de negocio, el riesgo lo carga la interfaz: si el cliente
sube una foto borrosa o el archivo equivocado, no hay vuelta atrás dentro del
producto. La mitigación no es técnica (no hay "deshacer un POST"), es de
secuencia: mostrar el archivo elegido y avisar del límite de un solo tiro
**antes** de que el botón de confirmar sea alcanzable, nunca en un tooltip ni
después de que ya se mandó.

**Selected direction — jerarquía de la información.** Un único `Panel` (mismo
lenguaje que el resto del checkout: `Panel` con `p-5`, `h2` sin kicker), con
esta prioridad de arriba a abajo:
1. Monto exacto (`Price`, `.tabular`, grande — es lo que el cliente tiene que
   copiar bien en su homebanking).
2. CBU o CVU con botón de copiar de un toque (22 dígitos a mano en un celular
   es un error garantizado); alias al lado si además existe. **`cbu` es
   nullable** (D3): cuando el local solo cargó alias, ese pasa a ser el valor
   primario con copiar — nunca un campo de CBU vacío.
3. Titular declarado y banco (derivado, puede ser `null` — se omite la línea,
   nunca se muestra en blanco).
4. El `shortCode` como referencia de la transferencia, en una fila con borde
   punteado (visualmente "dato a anotar", no una acción).
5. El control de subida, que es su propia máquina de estados (ver abajo).

**Selected direction — la subida, de un solo tiro.**
- **Idle**: una zona con borde punteado, sin la foto todavía, invita a elegir
  archivo — mismo lenguaje visual que el picker de foto de producto del admin
  (`product-image-field.tsx`), adaptado: acepta `image/*` y `application/pdf`.
- **Elegido, antes de confirmar**: preview real (la imagen tal cual se va a
  ver, o el nombre + peso si es PDF) y, **junto al botón de confirmar, no en
  un tooltip**, un aviso corto: *"Revisá que se lea bien el monto y la fecha.
  Solo podés subir un comprobante."* Dos botones: "Elegir otro" (vuelve a
  idle) y "Confirmar y subir" (dispara la subida real). Un archivo inválido
  (ni imagen ni PDF, o un PDF de más de 4MB) muestra el error en el lugar del
  aviso y saca el botón de confirmar — no tiene sentido ofrecer confirmar algo
  que el servidor va a rechazar.
- **Subiendo**: barra de progreso por ETAPA (comprimiendo → subiendo), mismo
  patrón ya establecido en `product-image-field.tsx` — no hay progreso real
  por byte sin una dependencia nueva, así que no se inventa un porcentaje.
- **Terminal (subido)**: el control de subida desaparece por completo — no se
  vuelve a mostrar, ni la imagen que se subió (el cliente nunca recibe una
  signed URL de lectura). Un `StatusPill` tono `live` + una frase: *"El local
  lo está revisando. Te avisamos por WhatsApp en cuanto confirme el pago."*
  El resto del panel (monto, CBU, referencia) se mantiene visible: no molesta
  y sirve si el cliente necesita reenviar los datos a quien transfirió por él.
- **Conflicto (409 del servidor)**: no es un error rojo genérico — es un
  ESTADO. Se intenta refrescar el pedido real primero; si no se puede, se
  muestra el mismo tono neutral que el terminal ("ya se registró un
  comprobante para este pedido").

**El escape hatch, siempre visible.** Un link a WhatsApp del local (ícono de
marca, no genérico — mismo componente que usa `store-dock.tsx`), al pie del
panel, en TODOS los estados: *"¿Subiste el comprobante equivocado? Escribinos
por WhatsApp."* No depende de haber subido nada — es la salida humana para
cualquier variante de "algo salió mal" que el producto no puede resolver solo.

**Caso sin cuenta bancaria resuelta** (`order.bankAccount === null`: el
proveedor puede tardar en poblarla, o el local desactivó transferencia después
de creado el pedido). Sin CBU no hay a dónde transferir con certeza: el panel
muestra solo un aviso corto dirigiendo al WhatsApp del local, sin ofrecer el
control de subida.

**Copy (rioplatense):** *"Transferí para confirmar tu pedido"* (encabezado,
sin kicker). *"Monto exacto"*. *"CBU o CVU"* / *"Alias"* según cuál sea el
primario. *"Poné como referencia"* + `#shortCode`. *"Subí tu comprobante" /
"Foto o PDF, hasta 4 MB — una sola vez"* (idle). *"Revisá que se lea bien el
monto y la fecha. Solo podés subir un comprobante."* (aviso pre-confirmación).
*"Comprobante recibido" / "El local lo está revisando. Te avisamos por
WhatsApp en cuanto confirme el pago."* (terminal).

**Estados que tienen que existir.** Sin comprobante (idle). Eligiendo con
preview válida. Eligiendo con error de validación (tipo no soportado, PDF
> 4MB). Subiendo (progreso por etapa). Recibido (terminal). Conflicto de
servidor (409, tratado como estado). Error de red durante la subida (alert,
con reintento — el archivo se conserva). Solo alias, sin CBU. Sin cuenta
bancaria resuelta.

**Motion.** Ninguno nuevo. El único momento animado del producto sigue siendo
agregar al carrito; este panel no lo toca — todo entra ya montado con el
`Panel`, sin revelado al hacer scroll.

**Targets.** 44px mínimo en el botón de copiar el CBU, los dos botones de la
etapa "elegido", y el link de WhatsApp.

**Contraste.** El panel vive dentro del tema de marca del local
(`[data-store-theme]`), un color arbitrario que `ensureContrast()` corrige —
nada de opacidades sobre texto que puedan romper ese piso.

**Primitivas.** `CopyValue` (CBU/alias + botón de copiar) y `FilePreview`
(imagen o chip de archivo) son específicas de este panel — no hay un segundo
consumidor hoy, así que viven locales a `transfer-panel.tsx` y no se suman a
`views/shared/surfaces.tsx`. Si el admin necesitara algo similar en el futuro,
ahí se justifica extraer.
