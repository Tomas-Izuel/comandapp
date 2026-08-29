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
Slice. Marca propia, nunca marketplace.

**Rendición actual (2026-08-28), elegida por el dueño del producto contra una
referencia concreta.** Tarjetas blancas que se levantan de la página con sombra
real, todo en pastilla, radio grande (`--radius` 1.25rem por defecto) y verde de
marca como campo sólido en lo que se toca. La composición del catálogo es:
portada como tarjeta redondeada → buscador en pastilla (siempre visible) → riel
de categorías con la foto de cada una → **grilla de dos columnas** de tarjetas
con botón de sumar apoyado en la esquina de la foto.

Lo que la referencia traía y **no** entra, porque el producto no lo tiene: auth
("Welcome back", avatar, campana), calorías, rating con estrellas, favoritos y
descuentos. Cada uno se reemplazó por el dato honesto equivalente o se eliminó;
inventarlos contradice `PRODUCT.md`.

**El verde no es el de la referencia.** El lima original (`#8cc63f`) da 2.05:1
contra blanco, y en esta composición el color de marca **es** el color del
precio sobre la tarjeta blanca. El default es `#468511`: mismo tono, 4.54:1, pasa
sin que `ensureContrast()` tenga que corregir nada. El lima quedó como
`color_accent`. Cada local puede cambiarlo; el sistema garantiza el contraste.

**El dock.** Barra flotante al alcance del pulgar, solo en `/[store]`: el
carrito relleno con el color del local (crece a pastilla con el total cuando hay
ítems, cotizado por el servidor) más los canales propios del local — WhatsApp,
cómo llegar, Instagram, y las apps por las que también vende (Rappi, PedidosYa,
Uber Eats, agrupadas en "Pedir por"). **Solo se dibuja lo que el local
configuró**: un botón muerto no es una barra, es una promesa rota. Se configura
en `/admin/ajustes` → "Canales del local".

**Momento memorable: agregar al carrito.** Único momento autorizado. La hoja del
producto sube, el dock pasa de círculo a pastilla con el total, y el contador
late cuando ya existía.

**Estados que tienen que existir.** Local cerrado (la carta se ve igual, solo no
se puede pedir). Producto sin foto. Producto sin stock. Carrito vacío. Búsqueda
sin resultados. Carga (esqueleto con la geometría real de la grilla). Checkout
con error de pago. Pedido pago y pedido impago con retiro en el local — cocina y
dinero son dos relojes.

**Onboarding.** El cliente no tiene cuenta y llega por un link. Nombre, teléfono
y email opcional se piden **una sola vez** y quedan en `localStorage`
(`burger-shop.customer`); a partir de ahí el checkout llega precargado. "Pedir de
nuevo" y "mis pedidos" tienen que ser visibles para el que vuelve.

**Sin resolver.** El local piloto todavía no entregó logo, fotos ni carta, así
que la premisa central del diseño —la foto como motor de venta— sigue sin poder
verificarse con material real: el seed de desarrollo tiene una sola foto.
