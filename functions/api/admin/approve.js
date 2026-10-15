import { generatePassword, hashPassword, json, normalizePhone, PLANS, readBody, requireAdmin, route } from '../../_lib.js';

const FIND_CUSTOMER = 'SELECT * FROM customers WHERE phone = ?';

const NEW_CUSTOMER = `
  INSERT INTO customers (phone, name, plan, expires_at, password_salt, password_hash, instance_id, bot_url, bot_key)
  VALUES (?, ?, ?, datetime('now', ?), ?, ?, ?, ?, ?)
`;

const TOUCH_CUSTOMER = `
  UPDATE customers SET name = ?, plan = ?, expires_at = datetime('now', ?), instance_id = ?, bot_url = ?, bot_key = ?,
                       status = 'active', password_salt = ?, password_hash = ?
  WHERE id = ?
`;

const APPROVE = `UPDATE orders SET status = 'approved', handled_at = datetime('now'), customer_id = ? WHERE id = ? AND status != 'approved'`;

/**
 * Asking the bot server for a bot. The key it returns is the buyer's own API
 * key: it scopes every later /api/bot/* call from the portal to that one bot.
 */
async function provisionBot(env, { label, ownerNumber, plan, days }) {
  const base = String(env.BOT_URL ?? '').replace(/\/$/, '');
  const key = String(env.BOT_PROVISION_KEY ?? '');
  if (!base || !key) throw new Error('The bot server is not configured (BOT_URL / BOT_PROVISION_KEY).');
  const res = await fetch(`${base}/api/instances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-provision-key': key },
    body: JSON.stringify({
      label,
      ownerNumber,
      plan,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`The bot server refused to create a bot (${res.status}): ${text.slice(0, 120)}`);
  const created = JSON.parse(text);
  if (!created?.apiKey) throw new Error('The bot server did not return a key.');
  return { instance: String(created.instance), key: created.apiKey, url: base };
}

/** Extends a returning buyer's existing bot instead of forking a second one. */
async function extendBot(env, instance, days) {
  const base = String(env.BOT_URL ?? '').replace(/\/$/, '');
  const key = String(env.BOT_PROVISION_KEY ?? '');
  if (!base || !key || !instance) return;
  await fetch(`${base}/api/instances/${encodeURIComponent(instance)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-provision-key': key },
    body: JSON.stringify({ expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() }),
  }).catch(() => {});
}

/**
 * Approving an order is what creates the account: the password is generated
 * here, returned once to the owner, and only its PBKDF2 hash is stored. A repeat
 * purchase by the same number refreshes that buyer's row instead of forking a
 * second identity — the phone number is the account.
 */
export const onRequestPost = route(async (request, env) => {
  await requireAdmin(request, env);
  const body = await readBody(request);
  const orderId = Number(body.order_id);
  if (!orderId) throw Object.assign(new Error('Which order?'), { status: 400 });

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) throw Object.assign(new Error('That order no longer exists.'), { status: 404 });
  if (order.status === 'approved') throw Object.assign(new Error('This order is already approved.'), { status: 409 });

  const phone = normalizePhone(order.phone);
  const plan = PLANS[order.plan] ? order.plan : '1 Month';
  const days = `+${PLANS[plan].days} days`;
  const password = generatePassword();
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  const hash = await hashPassword(password, salt);

  const instanceId = String(body.instance_id ?? '').trim() || `c${phone}`;
  const botUrl = String(body.bot_url ?? '').trim() || env.BOT_URL || '';
  const botKey = String(body.bot_key ?? '').trim() || env.BOT_KEY || '';

  const existing = await env.DB.prepare(FIND_CUSTOMER).bind(phone).first();
  // A returning buyer keeps the bot and key they already linked their phone to.
  let instance = existing?.instance_id ?? instanceId;
  let key = existing?.bot_key ?? botKey;
  if (existing?.instance_id && existing?.bot_key && /^\d+$/.test(existing.instance_id)) {
    await extendBot(env, existing.instance_id, PLANS[plan].days);
  } else {
    const made = await provisionBot(env, { label: `${order.name} — ${phone}`, ownerNumber: phone, plan, days: PLANS[plan].days });
    instance = made.instance;
    key = made.key;
  }

  if (existing) {
    await env.DB.prepare(TOUCH_CUSTOMER)
      .bind(order.name, plan, days, instance, botUrl, key, salt, hash, existing.id)
      .run();
  } else {
    await env.DB.prepare(NEW_CUSTOMER)
      .bind(phone, order.name, plan, days, salt, hash, instance, botUrl, key)
      .run();
  }

  const customer = await env.DB.prepare(FIND_CUSTOMER).bind(phone).first();
  await env.DB.prepare(APPROVE).bind(customer.id, orderId).run();

  return json({
    ok: true,
    customer: { id: customer.id, phone: customer.phone, name: customer.name, plan: customer.plan, expires_at: customer.expires_at },
    // Shown once — the owner pastes it into the welcome message.
    login: { phone: customer.phone, password },
  }, 201);
});
