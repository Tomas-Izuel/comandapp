# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**El que compra.** Alguien con hambre, en el celular, muchas veces caminando o
en el colectivo, decidiendo entre este local y el de al lado. No tiene cuenta,
no la quiere, y no va a instalar nada. Su éxito es: pedir, pagar y saber cuándo
está listo, sin hablar con nadie.

**El encargado del mostrador.** Opera el panel de cocina parado en la caja,
atendiendo gente presencial en paralelo. Lo interrumpen cada treinta segundos.
Puede leer densidad y hacer clicks precisos, pero tiene que poder retomar el
hilo después de cada interrupción sin perder dónde estaba.

**El dueño, desde su propio celular.** Mira el panel entre otras cosas, a veces
sin estar en el local. Necesita el estado completo de un vistazo y enterarse
cuando entra un pedido sin tener la pantalla abierta.

**La plataforma (un solo operador).** Da de alta locales, los suspende y mira
métricas globales. Es el dueño del SaaS, no del local.

## Product Purpose

Reemplazar el flujo con el que hoy vende la mayoría de las hamburgueserías:
mensaje a WhatsApp → alguien contesta → el cliente dice qué quiere → le pasan el
total → manda comprobante → cocinan → le avisan.

Ese flujo consume una persona entera en hora pico, se cae cuando entran cinco
pedidos juntos, pierde ventas mientras nadie contesta, y no deja ningún dato.

Éxito es que el local venda más sin que nadie del local escriba un solo mensaje.

## Positioning

No es "una web para el restaurante". Es el reemplazo del canal de venta que ya
usan, con las dos cosas que WhatsApp no puede dar:

1. **Un tiempo de espera que se ajusta a la carga real de la cocina.** Cada
   producto declara cuánto tarda; cuando hay muchos pedidos activos el estimado
   se multiplica. El cliente ve un número honesto en vez de un "20 minutos" que
   el local dice siempre igual.
2. **Un pedido que se puede enchufar al software de gestión del local**, sea
   cual sea, sin rehacer nada.

## Operating Context

El pedido nace en un celular y muere en una cocina. Entre medio hay una caja con
gente esperando y un teléfono que hoy suena todo el tiempo.

- La hora pico es de viernes a domingo a la noche. Todo el sistema se juzga por
  cómo se comporta cuando entran muchos pedidos juntos, no por cómo se ve vacío.
- El local ya tiene algún software de gestión; **todavía no sabemos cuál**. El
  producto no se puede acoplar a ninguno.
- La comunicación con el cliente después de la compra sigue pasando por
  WhatsApp, porque es donde el cliente ya está.
- Mercado Pago es el medio de pago de facto en Argentina.

## Capabilities and Constraints

**Confirmado que existe:**
- Catálogo por tienda con categorías, productos y modificadores (punto de
  cocción, extras, sin ingredientes).
- Carrito sin cuenta, guardado en el navegador.
- Retiro en el local y delivery, cada uno activable por tienda.
- Seguimiento del pedido por link, y "mis pedidos" desde el navegador.
- Reiterar un pedido anterior.
- Panel de cocina, ABM de catálogo con foto, y dashboard de ventas por local.
- Backoffice de plataforma para dar de alta y suspender locales.

**Pago — decisión confirmada en esta ronda:** el cliente puede pagar online por
adelantado **o reservar y pagar al retirar en el local**. Cada tienda decide si
habilita el pago presencial. Consecuencia que el producto tiene que absorber: el
ciclo de la cocina y el ciclo del dinero son dos cosas distintas y se siguen por
separado. Un pedido puede estar listo y todavía impago.

**Restricciones durables:**
- El cliente **no tiene cuenta**. Si cambia de dispositivo o borra los datos del
  navegador, pierde el historial. Se mitiga con el link del pedido, que se puede
  compartir; no se resuelve pidiendo login.
- Multi-tienda desde el día uno: todo dato pertenece a un local.
- Cada local cobra con **su propia** cuenta de Mercado Pago.
- Todo el dinero son centavos enteros. El total lo calcula siempre el servidor.
- Mobile-first no es una preferencia: es de dónde entra el pedido.

**Sin decidir todavía:**
- Qué software de gestión usan los locales.
- Si el WhatsApp de "pedido listo" arranca manual (link `wa.me`) o automático
  (Cloud API de Meta, que depende de que Meta apruebe las plantillas).
- Cobro de la suscripción del SaaS a los locales.

## Brand Commitments

Hay un **local piloto real** con nombre, logo, fotos de producto y carta propia.
Esos activos existen pero **todavía no fueron entregados**, así que ningún
nombre, logo ni foto de ese local puede darse por conocido hasta que aparezcan.

**Preferencia declarada (2026-08-26): el estándar de la categoría.** Ante una
ronda de direcciones visuales, el dueño del producto eligió deliberadamente la
puerta convencional: esto se ve y se opera como **la app de pedido propia de una
marca** —McDonald's, Mostaza, Starbucks— y como **la web de pedido que contrata
un local** —Toast, Square, Slice—. El nivel de craft de esos productos es la vara
del build. Es una decisión permanente, no la falta de una: la convención se
ejecuta entera y sin rarezas de contrabando. **Marca propia, nunca marketplace.**

Cada local personaliza su propia identidad (logo, colores, tipografía, portada)
dentro del producto. La marca de la plataforma es deliberadamente invisible en
la cara del cliente: el comprador tiene que sentir que está en la web de la
hamburguesería, no en un portal de terceros.

## Evidence on Hand

- **Existe** un local piloto concreto. Sus activos reales (logo, fotos, carta,
  precios) están comprometidos pero **no entregados a la fecha**.
- **No existe** ningún dato de uso, testimonio, métrica de conversión, caso de
  éxito ni benchmark. Nada de eso puede inventarse ni insinuarse en la interfaz.
- Los datos actuales del repositorio (`supabase/seed.sql`, tienda `la-birra`)
  son **ficticios y de desarrollo**. No son el local piloto.

## Product Principles

1. **Nadie del local escribe un mensaje.** Cada interacción que obligue a un
   humano del local a tipear es una regresión al flujo que vinimos a reemplazar.
2. **El servidor dice el precio y el tiempo.** Lo que el navegador afirma es una
   sugerencia, nunca un dato.
3. **El panel se retoma, no se aprende.** Quien lo usa está siendo interrumpido
   todo el tiempo; después de cada interrupción tiene que saber dónde estaba sin
   volver a leer la pantalla entera.
4. **Cocina y dinero son dos relojes.** Un pedido puede estar listo e impago, o
   pago y sin empezar. Confundirlos rompe el pago en el local.
5. **Nada se acopla al POS que todavía no conocemos.** Toda integración sale por
   eventos, nunca por una dependencia directa.
6. **El cliente está en la web de la hamburguesería.** La plataforma no se
   muestra.

## Accessibility & Inclusion

- El comprador usa una mano, en la calle, con brillo alto y a veces mala señal.
  Targets grandes, contraste alto y estados que se entiendan sin color.
- Cada local elige sus colores, así que el contraste **no** puede depender de
  que elijan bien: el sistema tiene que garantizar legibilidad con cualquier
  combinación que el kit de marca permita.
- Español rioplatense en toda la interfaz.
