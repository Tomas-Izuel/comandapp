---
version: 1
slug: "src-app-admin-app-page-tsx"
primary_target: "src/app/admin/(app)/page.tsx"
related_targets: ["src/app/admin/(app)/pedidos/page.tsx","src/app/admin/(app)/catalogo/page.tsx","src/app/admin/(app)/apariencia/page.tsx","src/app/admin/(app)/ajustes/page.tsx","src/app/admin/(app)/pagos/page.tsx","src/app/admin/(app)/dashboard/page.tsx","src/app/admin/login/page.tsx"]
---

# Panel del local

**Alcance y modo.** `/admin` completo: tablero de cocina, historial de pedidos,
ABM de catálogo, apariencia, ajustes, pagos, dashboard y login. Modo **Operate**,
sin excepción.

**El panel NO hereda la composición de la cara del cliente.** Comparte tokens,
tipografía, controles y las primitivas de `src/views/shared/`, y ahí termina. La
vara acá son los **KDS de cocina** (Square KDS, Toast KDS) y los **paneles de
administración densos** (Linear, Stripe), no la app de pedido.

**Audiencia y trabajo.** Dos personas distintas con el mismo panel:

- *El encargado del mostrador*, parado en la caja, atendiendo gente presencial en
  paralelo, interrumpido cada treinta segundos. Lee densidad y hace clicks
  precisos, pero **tiene que poder retomar el hilo después de cada interrupción
  sin volver a leer la pantalla entera.** Ese es el criterio de diseño número uno
  del tablero de cocina.
- *El dueño, desde su propio celular*, mirando entre otras cosas y a veces sin
  estar en el local. Necesita el estado completo de un vistazo.

**Consecuencias de diseño.**
- El tablero de cocina es **columnas por estado**, no una lista con filtro: la
  posición de un pedido en la pantalla es la memoria del que fue interrumpido.
- **El tiempo transcurrido es la información más importante de una comanda**, y
  crece: un pedido que pasó su ETA tiene que gritar sin depender del color.
- Targets grandes: se opera parado, a veces con las manos ocupadas.
- La transición de estado que la máquina no permite **no se ofrece**:
  `ALLOWED_TRANSITIONS` de `order.schema.ts` es la fuente, la UI la importa.
- Se permite **un paso atrás**: un toque equivocado en una cocina llena está
  garantizado.
- Un 409 (otro operario cambió el estado primero) es un mensaje entendible, no un
  error genérico: "Otro pedido ya lo movió, se actualizó solo".

**Estados que tienen que existir.** Sin pedidos todavía. Catálogo vacío (primer
día del local: eso es onboarding, no un vacío). Producto sin foto. Credenciales
de Mercado Pago de prueba (`warning`, no `destructive`: nada está roto, pero no
es neutral). Local suspendido por la plataforma. Guardado en curso y guardado
fallido.

**Onboarding.** El dueño entra por primera vez a un panel sin catálogo, sin
credenciales y sin marca cargada. El panel tiene que decir qué falta para poder
vender, en orden, y llevarlo ahí. Un panel vacío que no explica nada es la razón
por la que un local vuelve a WhatsApp.
