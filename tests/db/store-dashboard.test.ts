import { describe, expect, it } from 'vitest'
import {
  asAuthenticated,
  createAuthUserSql,
  dbAvailable,
  expectSqlToFail,
  inTransaction,
  newUserId,
  uniqueSlug,
} from './helpers'

type Dashboard = {
  salesByDay: Array<{ date: string; orders: number; revenueCents: number }>
  ordersByStatus: Record<string, number>
  averageTicketCents: number
}

/**
 * `public.store_dashboard` — A-01, A-10 y P-13.
 *
 * A-01: es `SECURITY DEFINER`, así que bypassea RLS por diseño; sin el
 * chequeo de membresía adentro sería una fuga de datos entre tiendas (un
 * dueño lee la facturación del competidor con solo cambiar el id).
 *
 * A-10: agrupa por día en la zona DEL LOCAL, no en UTC. Un pedido de las
 * 22:30 de Argentina es "01:30Z" del día siguiente: agrupar en UTC corría el
 * pico del viernes a la noche —el único horario que importa— al sábado.
 *
 * P-13: un pedido online `pending` (impago, abandonado) no es una venta. El
 * filtro viejo era "todo lo que no esté cancelado", y como los `pending`
 * nunca expiraban, la facturación se inflaba con pedidos que nadie pagó.
 */
describe.skipIf(!dbAvailable)('public.store_dashboard', () => {
  it('un authenticated que no es miembro de la tienda recibe 42501, no los datos de otro local', () => {
    const ownerId = newUserId()
    const outsiderId = newUserId()
    expectSqlToFail(
      [
        createAuthUserSql(ownerId, `${ownerId}@example.com`),
        createAuthUserSql(outsiderId, `${outsiderId}@example.com`),
        `insert into public.stores (slug, name, status) values ('${uniqueSlug('a01')}', 'Tienda A01', 'active') returning id \\gset store_`,
        `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
        ...asAuthenticated(outsiderId, [`select public.store_dashboard(:store_id, 7);`]),
      ].join('\n'),
      /no tenes permiso sobre la tienda/,
    )
  })

  it('agrupa por día en la zona del LOCAL: un pedido de las 22:30 de Argentina cae en el día de Argentina, no en el de UTC (A-10)', () => {
    const ownerId = newUserId()
    const out = inTransaction(
      createAuthUserSql(ownerId, `${ownerId}@example.com`),
      `insert into public.stores (slug, name, status, timezone)
         values ('${uniqueSlug('a10')}', 'Tienda A10', 'active', 'America/Argentina/Buenos_Aires')
       returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
      // 01:30 UTC es 22:30 del día ANTERIOR en Argentina (UTC-3): el instante
      // exacto donde el bug corría el pedido un día para adelante.
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents, created_at)
         values (:store_id, 'confirmed', 'Cliente', '+5491100000000', gen_random_uuid()::text, 'online', 'approved', 3000, 3000,
                 ((current_date - 1) + time '01:30:00') at time zone 'UTC')
       returning id \\gset order_`,
      ...asAuthenticated(ownerId, [`select public.store_dashboard(:store_id, 7)::text;`]),
      `select (current_date - 2)::text as ar_day, (current_date - 1)::text as utc_day;`,
    )

    const [dashboardJson, dayLine] = out.split('\n')
    const dashboard = JSON.parse(dashboardJson) as Dashboard
    const [arDay, utcDay] = dayLine.split('|')

    const arEntry = dashboard.salesByDay.find((d) => d.date === arDay)
    const utcEntry = dashboard.salesByDay.find((d) => d.date === utcDay)

    // El pedido cuenta en el día de Argentina (el correcto)...
    expect(arEntry).toEqual({ date: arDay, orders: 1, revenueCents: 3000 })
    // ...y NO en el día calendario de UTC, que es donde caía con el bug.
    expect(utcEntry?.orders ?? 0).toBe(0)
  })

  it('un pedido online pending (impago, abandonado) no cuenta como facturación (P-13)', () => {
    const ownerId = newUserId()
    const out = inTransaction(
      createAuthUserSql(ownerId, `${ownerId}@example.com`),
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('p13')}', 'Tienda P13', 'active') returning id \\gset store_`,
      `insert into public.store_members (store_id, user_id, role) values (:store_id, '${ownerId}', 'owner');`,
      // Facturable: pago en el local, ya entregado en la cocina (status !=
      // pending/cancelled), aunque payment_status siga en 'pending' —el cobro
      // es presencial.
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'ready', 'Cliente local', '+5491100000000', gen_random_uuid()::text, 'in_store', 'pending', 2000, 2000);`,
      // Abandonado: pedido online que nunca se pagó. Con la regla vieja
      // ("todo lo que no esté cancelado") esto se sumaba igual.
      `insert into public.orders (store_id, status, customer_name, customer_phone_e164, idempotency_key, payment_method, payment_status, subtotal_cents, total_cents)
         values (:store_id, 'pending', 'Cliente que abandonó', '+5491100000000', gen_random_uuid()::text, 'online', 'pending', 999999, 999999);`,
      ...asAuthenticated(ownerId, [`select public.store_dashboard(:store_id, 3)::text;`]),
    )

    const dashboard = JSON.parse(out) as Dashboard
    // ordersByStatus SÍ ve los dos pedidos (es el estado real de la cocina)...
    expect(dashboard.ordersByStatus).toMatchObject({ ready: 1, pending: 1 })
    // ...pero la facturación es solo la del pedido que efectivamente cobró.
    expect(dashboard.averageTicketCents).toBe(2000)
    const today = dashboard.salesByDay.at(-1)
    expect(today).toMatchObject({ orders: 1, revenueCents: 2000 })
  })
})
