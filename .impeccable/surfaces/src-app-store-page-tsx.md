---
version: 1
slug: "src-app-store-page-tsx"
primary_target: "src/app/[store]/page.tsx"
related_targets: ["src/app/[store]/producto/[id]/page.tsx","src/app/[store]/carrito/page.tsx","src/app/[store]/checkout/page.tsx","src/app/pedido/[token]/page.tsx","src/app/mis-pedidos/page.tsx"]
---

# Vitrina del cliente

**Alcance y modo.** El recorrido completo del comprador: catálogo `/[store]`,
ficha de producto, carrito, checkout, seguimiento `/pedido/[token]` y
`/mis-pedidos`. Modo **Persuade** en el catálogo y la ficha (el visitante decide
entre este local y el de al lado); **Operate** de carrito en adelante (ya
decidió, ahora tiene que poder completar sin fricción).

**Audiencia y trabajo.** Alguien con hambre, viernes 21:30, celular en una mano,
a veces en la calle con brillo alto y mala señal. No tiene cuenta ni la quiere.
Éxito: pedir, pagar y saber cuándo está listo sin hablar con nadie.

**Contenido real.** Carta corta y curada: **6 a 10 productos**. **Va a haber
fotos reales y buenas** — confirmado por el dueño del producto el 2026-08-26, y
es la premisa que define el diseño. Bebidas y guarniciones pueden no tener foto y
eso es normal: el marco sin foto muestra el nombre en grande sobre el color de la
marca, nunca un hueco gris. Nada de testimonios, métricas ni marcas: no existen.

**Dirección: el estándar de la categoría, ejecutado completo.** La app de pedido
propia de una marca. Vara: McDonald's / Mostaza / Starbucks y Toast / Square /
Slice. Marca propia, nunca marketplace. La convención se usa entera: riel de
categorías pegajoso, filas de producto con foto grande, hoja de producto que sube
desde abajo, barra de carrito fija al pie, stepper de cantidad.

**Momento memorable: agregar al carrito.** Es el único momento autorizado. La
hoja del producto baja, la barra de carrito entra desde el pie con resorte la
primera vez, y el contador late cuando ya existía. Una sola confirmación, siempre
la misma, en toda la cara del cliente.

**Lo que se rechaza explícitamente** (era el mundo anterior): foto reducida a una
franja de 7rem, `hero_image_url` sin renderizar, nombres de producto en caja alta
condensada a `7vw`, fila de specs monoespaciada `PRECIO / MIN`, y el `-mt-14` que
solapa el primer producto sobre el hero.

**Estados que tienen que existir.** Local cerrado (la carta se ve igual, solo no
se puede pedir). Producto sin foto. Producto sin stock. Carrito vacío. Carga
(esqueleto con la geometría real). Checkout con error de pago. Pedido pago y
pedido impago con retiro en el local — cocina y dinero son dos relojes.

**Onboarding.** El cliente no tiene cuenta y llega por un link. Nombre, teléfono
y email opcional se piden **una sola vez** y quedan en `localStorage`
(`burger-shop.customer`); a partir de ahí el checkout llega precargado. "Pedir de
nuevo" y "mis pedidos" tienen que ser visibles para el que vuelve, no un link
escondido.
