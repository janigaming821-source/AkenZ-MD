import { botBase, extendBot, generatePassword, hashPassword, json, normalizePhone, PLANS, provisionBot, readBody, requireAdmin, route } from '../../_lib.js';

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

  const existing = await env.DB.prepare(FIND_CUSTOMER).bind(phone).first();
  // A returning buyer keeps the bot and key their phone is already linked to. A
  // row without a real numeric instance (one predating provisioning, or a failed
  // call) is created afresh rather than trusted.
  const reusable = existing?.bot_key && /^\d+$/.test(String(existing.instance_id ?? ''));
  let instance;
  let key;
  if (reusable) {
    instance = existing.instance_id;
    key = existing.bot_key;
    await extendBot(env, instance, PLANS[plan].days);
  } else {
    const made = await provisionBot(env, {
      label: `${order.name} — ${phone}`,
      ownerNumber: phone,
      plan,
      days: PLANS[plan].days,
    });
    instance = made.instance;
    key = made.key;
  }
  const botUrl = botBase(env);

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
