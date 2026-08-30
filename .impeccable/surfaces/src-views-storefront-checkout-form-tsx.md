---
version: 1
slug: "src-views-storefront-checkout-form-tsx"
primary_target: "src/views/storefront/checkout-form.tsx"
related_targets: ["src/app/[store]/checkout/page.tsx","src/lib/store-hours.ts","src/views/shared/surfaces.tsx"]
---

# Selector "para ahora" / programar en el checkout

**Alcance y modo.** `src/views/storefront/checkout-form.tsx` (y su page,
`src/app/[store]/checkout/page.tsx`, que deja de cortar en seco para
`closed_can_schedule` — ver brief de `states.tsx`). Modo **Operate**: el
cliente ya decidió comprar acá, ahora tiene que completar sin fricción, con una
mano y a veces mala señal.

**Audiencia y trabajo.** El mismo comprador del checkout de hoy, con una
decisión nueva encima de las que ya tenía (datos, cómo lo recibe, cómo paga):
¿ahora o más tarde? Tiene que poder elegir un slot concreto entre **3 días × 4-8
horas de franja abierta por noche** —cientos de opciones posibles— sin que la
pantalla se vuelva un formulario de agenda corporativa. La mayoría de las veces
la respuesta es "para ahora" y esta sección no debería robarle tiempo a esa
mayoría.

**Selected direction — dónde va.** Un `Panel` nuevo, mismo lenguaje que los
demás bloques del checkout (`Panel` con `p-4 sm:p-5`, encabezado `h2` sin
kicker). Orden en el flujo: Datos → Cómo lo recibís → **Cuándo lo querés**
(nuevo) → Tu pedido (resumen) → Cómo pagás → Notas → `ActionBar`. Va después de
"Cómo lo recibís" a propósito: el lead time depende de `deliveryMinutes`, que
recién se conoce una vez elegido el método de entrega — mostrar el selector de
horario antes invitaría a elegir un slot que el método de entrega elegido
después invalida.

**Selected direction — el selector.**
- Segmento "Para ahora" / "Programar" (dos botones tipo radio, mismo patrón
  visual que ya usan los `Label`+`RadioGroupItem` bordeados de "Cómo lo
  recibís"/"Cómo pagás" en este mismo archivo — no inventar un tercer patrón de
  radio). "Para ahora" solo existe y solo puede estar seleccionado cuando la
  tienda está abierta; si `storefrontGate() === 'closed_can_schedule'`, el
  segmento ni se dibuja — programar es la única rama, sin toggle que elegir.
- Debajo, cuando "Programar" está activo: navegación de día (hasta 3 chips,
  "Hoy" / "Mañana" / nombre del día, snap horizontal como el `CategoryRail` —
  sin reusar el componente literal, que es semántica de categorías de carta,
  pero sí su gramática visual de pastilla) y, para el día elegido, una grilla
  de horarios en pastillas de 15 en 15 minutos (radios reales agrupados,
  vestidos como chips — la fila entera es el target, ≥44px). Un día sin ningún
  slot ofrecible (noche llena, o todos los slots caen antes del lead) muestra
  un texto inline en ese chip de día en vez de una grilla vacía: *"No quedan
  turnos esta noche"*.
- El primer slot posible (`from + lead`, redondeado a :00/:15/:30/:45) se
  precarga como default cuando el checkout entra ya en modo forzado
  (`closed_can_schedule`): menos taps para el caso "quiero pedir para cuando
  abran", siempre corregible.
- Los slots se calculan **en el cliente** con `scheduleSlots()` de
  `src/lib/store-hours.ts` sobre los horarios que la page ya trajo — sin
  round-trip nuevo al servidor. El `leadMinutes` usa `basePrepMinutes` del
  `quote` vigente (`useCheckoutQuote`) más los minutos de envío si el método
  elegido es delivery: recalcular la lista cuando cambia el método de entrega o
  cuando el quote termina de cargar (hasta entonces, no se pinta la grilla —
  un pequeño estado de carga en el lugar de la grilla, no un layout shift).

**Copy (rioplatense):**
- Encabezado de sección: *"Cuándo lo querés"* (sin kicker).
- Segmento: *"Para ahora"* / *"Programar"*.
- Encabezados de día: *"Hoy"*, *"Mañana"*, o el nombre del día (mismo criterio
  que ya usa el historial de `/admin/pedidos` para hoy/ayer, espejado hacia
  adelante).
- Noche llena: *"No quedan turnos esta noche"*.
- Botón primario, cuando hay slot elegido: agrega la hora al texto que ya varía
  por método de pago — p. ej. *"Confirmar pedido para las 21:30 · Pagás al
  retirar"* — mismo patrón condicional que ya arma este archivo, una cadena más
  larga.

**Errores del servidor.** `createOrder` puede rechazar el `scheduledFor` (no es
múltiplo de 15, lead insuficiente, fuera del horizonte de 7 días, o el rango ya
no está abierto — la tienda pudo cambiar el horario entre que el cliente abrió
el checkout y confirmó). Estos son `DomainError` con `field` — se muestran
exactamente como ya se muestran hoy los errores de `customerName`/
`deliveryAddressLine`: el mismo `formError`/`fieldErrors` state, un
`fieldRefs['scheduledFor']` nuevo para llevar el foco a la sección de horario
en vez de dejarlo en el campo de arriba.

**Estados que tienen que existir.** Tienda abierta (para ahora es default,
programar disponible). Tienda `closed_can_schedule` (programar es la única
rama, con el aviso de por qué arriba del formulario — mismo mensaje que
`ClosedNotice` en esta misma sesión de compra). Quote todavía cargando (no
pintar la grilla). Un día entero sin slots (noche llena o todo antes del
lead). Envío que cambia el lead a mitad de selección (recalcular, no perder la
selección si sigue siendo válida). Error de slot inválido al confirmar.

**Motion.** Ninguno nuevo. La grilla de horarios aparece ya montada con el
`Panel` (sin revelado al hacer scroll); el único momento animado del producto
sigue siendo agregar al carrito, que este Panel no toca.

**Targets.** 44px mínimo en cada chip de día y cada pastilla de horario — es
la superficie más densa en objetivos táctiles que este pipeline agrega.

**Primitivas.** Los chips de día/horario son específicos de este selector — no
encajan en la semántica de `CategoryChip` (categorías de carta) ni en
`OptionRow` (opciones de producto con precio). Recomendación: vive local a
`checkout-form.tsx` o un archivo hermano en `views/storefront/` (p. ej.
`schedule-picker.tsx`), **no** se suma a `views/shared/surfaces.tsx` — no hay
un segundo consumidor hoy. Si en el futuro alguna otra pantalla necesita elegir
un horario de 15 minutos, ahí se justifica extraer.
