import { NextResponse } from 'next/server'
import { confirmUnsubscribeAction } from '@/controllers/unsubscribe.actions'

/**
 * El endpoint de one-click de RFC 8058, en un path PROPIO y distinto de
 * `/baja/[token]`.
 *
 * El estándar pide que el `POST` de baja vaya a la MISMA URI que la persona
 * ve en el mail, pero Next no permite un `page.tsx` y un `route.ts` en el
 * mismo path (los dos atenderían la misma URL sin forma de decidir cuál
 * gana — es un error de arranque, no de build). Por eso el mail de campaña
 * (T5B, Entrega B) tiene que usar DOS URLs distintas:
 *
 *   - En el CUERPO del mail: `/baja/{token}` (la página humana, con nombre
 *     del local y botón).
 *   - En el header `List-Unsubscribe` (junto con
 *     `List-Unsubscribe-Post: List-Unsubscribe=One-Click`): ESTA ruta,
 *     `/baja/{token}/one-click`.
 *
 * Si se invierten, el one-click de Gmail/Outlook deja de andar y nadie se
 * entera —no hay error visible, el botón "Cancelar suscripción" del cliente
 * de mail simplemente no hace nada— así que quien escriba el mail de
 * campaña tiene que leer este comentario antes de armar los headers.
 *
 * `POST` → la baja de verdad. **200 con body vacío**, que es lo que exige el
 * estándar: nada de redirect, nada de JSON, nada que un cliente de mail
 * automatizado tenga que interpretar. `confirmUnsubscribeAction` nunca tira
 * (pasa por `toActionResult`, que atrapa todo): token inexistente, ya dado
 * de baja, o balde agotado devuelven igual `{ ok: false }` sin excepción, así
 * que no hay rama de error que manejar acá — responde 200 siempre, que
 * además evita que el endpoint sirva de oráculo de qué tokens existen.
 *
 * `GET` → el RFC exige que la URI del one-click sea "navegable" (alguien
 * puede abrirla a mano, o un escáner de link le pega un GET). Se redirige a
 * la página humana en vez de duplicarla: un GET acá NUNCA da de baja a
 * nadie, ni siquiera de forma indirecta a través del redirect.
 */
export async function POST(_request: Request, ctx: RouteContext<'/baja/[token]/one-click'>) {
  const { token } = await ctx.params
  await confirmUnsubscribeAction(token)
  return new NextResponse(null, { status: 200 })
}

export async function GET(request: Request, ctx: RouteContext<'/baja/[token]/one-click'>) {
  const { token } = await ctx.params
  return NextResponse.redirect(new URL(`/baja/${token}`, request.url))
}
