import { ADMIN_COOKIE, CUSTOMER_COOKIE, cookieNamed, json, route, verifyToken } from '../_lib.js';

/** One call tells the static pages who is looking at them, so nothing public leaks. */
export const onRequestGet = route(async (request, env) => {
  const admin = await verifyToken(env, cookieNamed(request, ADMIN_COOKIE));
  const claim = cookieNamed(request, CUSTOMER_COOKIE)
    ? await verifyToken(env, cookieNamed(request, CUSTOMER_COOKIE))
    : null;
  let customer = null;
  if (claim?.role === 'customer') {
    const row = await env.DB.prepare(
      'SELECT id, phone, name, plan, expires_at, instance_id, bot_url, status FROM customers WHERE id = ?'
    ).bind(claim.id).first();
    if (row && row.status === 'active') customer = row;
  }
  return json({ admin: admin?.role === 'admin', customer });
});
