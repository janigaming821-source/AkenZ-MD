import { json, requireCustomer, route } from '../_lib.js';

export const onRequestGet = route(async (request, env) => {
  const customer = await requireCustomer(request, env);
  const orders = await env.DB.prepare(
    "SELECT id, plan, status, created_at, handled_at FROM orders WHERE phone = ? ORDER BY datetime(created_at) DESC LIMIT 10"
  ).bind(customer.phone).all();
  const { password_salt: _salt, password_hash: _hash, bot_key: _key, ...profile } = customer;
  return json({ customer: profile, orders: orders.results });
});
