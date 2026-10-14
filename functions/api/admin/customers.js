import { json, requireAdmin, route } from '../../_lib.js';

const LIST = `
  SELECT id, phone, name, plan, expires_at, instance_id, bot_url, status, created_at,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.id AND o.status = 'approved') AS orders_approved
  FROM customers ORDER BY datetime(created_at) DESC LIMIT 200
`;

export const onRequestGet = route(async (request, env) => {
  await requireAdmin(request, env);
  const rows = await env.DB.prepare(LIST).all();
  return json({ customers: rows.results });
});
