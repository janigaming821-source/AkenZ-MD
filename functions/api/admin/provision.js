import { botBase, json, PLANS, provisionBot, readBody, requireAdmin, route } from '../../_lib.js';

const FIND = 'SELECT * FROM customers WHERE id = ?';
const LINK = 'UPDATE customers SET instance_id = ?, bot_url = ?, bot_key = ? WHERE id = ?';

/**
 * Creates (or re-creates) the bot behind an existing customer.
 *
 * Approving an order provisions the bot itself, so this exists for the rows that
 * missed it — an account made before provisioning shipped, or a call that failed
 * mid-approval. The buyer keeps their login and password; only the bot behind it
 * is replaced, so a linked phone would need linking again.
 */
export const onRequestPost = route(async (request, env) => {
  await requireAdmin(request, env);
  const body = await readBody(request);
  const id = Number(body.customer_id);
  if (!id) throw Object.assign(new Error('Which customer?'), { status: 400 });

  const customer = await env.DB.prepare(FIND).bind(id).first();
  if (!customer) throw Object.assign(new Error('That customer no longer exists.'), { status: 404 });
  if (customer.bot_key && /^\d+$/.test(String(customer.instance_id ?? ''))) {
    return json({ ok: true, already: true, instance_id: customer.instance_id });
  }

  const plan = PLANS[customer.plan] ? customer.plan : '1 Month';
  const made = await provisionBot(env, {
    label: `${customer.name} — ${customer.phone}`,
    ownerNumber: customer.phone,
    plan,
    days: PLANS[plan].days,
  });
  await env.DB.prepare(LINK).bind(made.instance, botBase(env), made.key, id).run();

  return json({ ok: true, already: false, instance_id: made.instance });
});
