---
version: 1
slug: "src-app-repartidor-page-tsx"
primary_target: "src/app/repartidor/page.tsx"
related_targets: ["src/app/repartidor/layout.tsx","src/app/repartidor/acceso/page.tsx"]
---

# Portal del repartidor

**Alcance y modo.** `/repartidor` completo: acceso (magic link) y la cola de
entregas. Modo **Operate**, y es el extremo opuesto del panel de cocina dentro
del mismo modo: allá densidad máxima para retomar el hilo tras una
interrupción; acá **una sola decisión por pantalla**, porque quien mira esto
está arriba de una moto o recién bajándose.

**No hereda la composición de la cara del cliente ni la del panel de cocina.**
Comparte tokens, tipografía y controles — nada más.

**Audiencia y trabajo.** El repartidor: casco puesto o recién sacado, guantes,
una mano libre, sol pegando en la pantalla, señal intermitente en la calle.
No es un rol que "aprende" la interfaz una vez y vuelve — cada turno puede ser
otra persona, otro celular, otra luz. No lee: escanea un número y actúa.

**Consecuencias de diseño.**
- Un pedido activo a la vez, como tarjeta única que ocupa la pantalla. La
  cola siguiente son filas compactas de solo lectura (código + calle): sirven
  para saber qué viene, no para tocar nada.
- Jerarquía de la tarjeta activa: código corto en grande (lo que canta el
  mostrador) → dirección (`line` y `unit` al mismo tamaño: perder el piso
  cuesta diez minutos en la puerta) → `between`/`notes` → botón de mapa →
  teléfono `tel:` → una acción primaria gigante ("Iniciar" / "Entregado").
- Targets **≥56px**, no 44: el piso del resto del producto no alcanza acá.
- Contraste alto siempre. Nada de texto secundario gris claro — se lee al sol,
  no en un living.
- Polling, nunca Realtime (RLS no expone `orders` a este rol; ver
  `AGENTS.md` de esta tarea). Cada ~20s + refetch en `visibilitychange`.
- El cobro en la puerta es condicional: si `collect` es `null` no se dibuja
  ni una palabra sobre plata. Si existe, confirmación en un `Dialog` antes de
  marcar entregado con cobro.
- Un 409/40001 (el mostrador movió el pedido primero) es "se actualizó solo",
  igual que en el KDS — nunca un error genérico.

**Estados que tienen que existir.** Sin pedidos asignados (el más frecuente
del día — es "esperá", no un error). Sin conexión / falló el refetch. Invitado
que entró antes de que le asignen algo. Repartidor desactivado. Local
suspendido no aplica acá — ese pedido nunca llegaría a la cola.

**Anti-metas.** Nada de navegación lateral, nada de tabs, nada de tabla. El
chrome es el nombre del repartidor arriba y el botón de salir — todo lo demás
es la tarjeta activa.
