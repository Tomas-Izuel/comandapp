-- ---------------------------------------------------------------------------
-- Slugs reservados: la lista pasa de proteger PATHS a proteger HOSTNAMES
--
-- Hasta hoy la lista existia para que una tienda no se comiera una ruta
-- estatica de Next. Con `[slug].comandapp.ar` cambia de naturaleza: cada slug
-- es ademas un **subdominio real** de la zona DNS de la plataforma.
--
-- El riesgo nuevo no es teorico y no lo cubre el CHECK anterior: si un local
-- registra el slug `mail` y despues hace falta `mail.comandapp.ar` para los
-- registros de Resend, hay un conflicto entre un registro DNS y un tenant vivo.
-- Desenredarlo implica renombrarle la tienda a un cliente, y renombrar un slug
-- ya rompia links — con subdominios rompe ademas un hostname. Por eso los
-- nombres de infraestructura se reservan ANTES de que exista el primer local
-- que los pueda tomar.
--
-- Caso aparte, y el que mas duele: `comandapp`. Un `comandapp.comandapp.ar`
-- registrado por un tercero es phishing servido por nosotros, con nuestro
-- certificado.
--
-- La lista sigue duplicada a proposito en `RESERVED_SLUGS` de
-- `platform.schema.ts`: la base garantiza que no entre, el schema hace que el
-- mensaje se entienda. Si se agrega uno, va en los DOS lados.
--
-- Sigue siendo un CHECK con `not in (...)` y no una tabla: una tabla seria una
-- TERCERA fuente de verdad, necesitaria RLS y grants propios, y tendria
-- superficie de API. Un CHECK no se puede esquivar por ningun camino. El precio
-- es esta migracion de swap cada vez que se agrega uno.
--
-- Seguro de aplicar: `add constraint` valida contra las filas existentes, y el
-- unico slug que existe hoy es `la-birra`.
-- ---------------------------------------------------------------------------

alter table public.stores drop constraint stores_slug_not_reserved_check;

alter table public.stores
  add constraint stores_slug_not_reserved_check check (
    slug not in (
      -- Rutas de la app y del stack (la lista original).
      'admin','api','app','assets','auth','backoffice','blog','carrito','checkout',
      'dashboard','docs','envios','favicon','functions','graphql','health','help',
      'images','legal','login','logout','manifest','mis-pedidos','new','nueva',
      'pedido','pedidos','public','realtime','repartidor','repartidores','rest',
      'robots','settings','sitemap','static','status','storage','support','www',
      '_next',

      -- Correo e infraestructura de entrega. Los mas urgentes: el magic link es
      -- la unica puerta a /admin y Resend necesita registros en esta zona.
      'mail','email','smtp','imap','pop','mx','webmail','autoconfig','autodiscover',
      'bounces','track','link','links','send',

      -- DNS y red.
      'ns','ns1','ns2','dns','ftp','vpn','gateway','proxy',

      -- Entornos.
      'staging','stage','dev','test','qa','demo','beta','preview','sandbox','local',
      'internal',

      -- CDN y assets.
      'cdn','img','media','files','download','downloads','web','www2',

      -- Identidad y pagos.
      'id','sso','oauth','callback','account','accounts','cuenta','pay','pago','pagos',
      'billing','facturacion','webhook','webhooks',

      -- Observabilidad.
      'metrics','monitor','logs','grafana','ci','git',

      -- Marca y proveedores.
      'comandapp','vercel','supabase','resend','mercadopago','mp',

      -- Superficie de cliente.
      'm','mobile','soporte','ayuda','contacto'
    )
  );

-- No hace falta reservar nada mas para que el slug sea un label DNS valido: el
-- regex de `slugSchema` (`^[a-z0-9]+(-[a-z0-9]+)*$`) ya prohibe guion inicial o
-- final y `--` consecutivos, y `max(60)` esta debajo del limite de 63 chars por
-- label. De paso, `--` imposible significa que un slug nunca puede empezar con
-- `xn--`, lo que cierra la clase entera de homografos punycode.
