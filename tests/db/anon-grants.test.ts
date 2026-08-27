import { describe, it } from 'vitest'
import { asAnon, dbAvailable, expectSqlToFail } from './helpers'

/**
 * Doble candado para `anon`: ni `orders` ni `store_payment_credentials`
 * tienen grant NI policy para el rol anónimo. `anon` solo lee el catálogo
 * publicado (`stores`, `products`, ...) — cero acceso a pedidos, cero acceso
 * a credenciales de cobro. Un cliente consulta SU pedido con el
 * `public_token` a través de un route handler que corre con
 * `createAdminClient()`, nunca directo por PostgREST.
 */
describe.skipIf(!dbAvailable)('grants de anon sobre datos sensibles', () => {
  it('anon no puede leer orders (ni policy ni grant)', () => {
    expectSqlToFail(asAnon(['select count(*) from public.orders;']).join('\n'), /permission denied for table orders/)
  })

  it('anon no puede leer store_payment_credentials, el activo más sensible del sistema', () => {
    expectSqlToFail(
      asAnon(['select count(*) from public.store_payment_credentials;']).join('\n'),
      /permission denied for table store_payment_credentials/,
    )
  })
})
