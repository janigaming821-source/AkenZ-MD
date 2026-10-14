import { hashPassword, json, readBody, requireCustomer, route, safeCompare } from '../_lib.js';

const MIN_LENGTH = 8;

/**
 * A buyer's password is handed out once, in a WhatsApp message, so they need to
 * be able to replace it. This is the only place the hash is rewritten.
 */
export const onRequestPost = route(async (request, env) => {
  const customer = await requireCustomer(request, env);
  const { current = '', next = '' } = await readBody(request);
  if (next.length < MIN_LENGTH) throw Object.assign(new Error(`Use at least ${MIN_LENGTH} characters.`), { status: 400 });

  const currentHash = await hashPassword(current, customer.password_salt);
  if (!(await safeCompare(currentHash, customer.password_hash))) {
    throw Object.assign(new Error('The current password is not right.'), { status: 403 });
  }

  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  await env.DB.prepare('UPDATE customers SET password_salt = ?, password_hash = ? WHERE id = ?')
    .bind(salt, await hashPassword(next, salt), customer.id)
    .run();

  return json({ ok: true });
});
