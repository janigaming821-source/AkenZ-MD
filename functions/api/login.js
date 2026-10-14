import {
  CUSTOMER_COOKIE,
  badRequest,
  hashPassword,
  safeCompare,
  json,
  normalizePhone,
  readBody,
  route,
  sessionCookie,
  signToken,
} from '../_lib.js';

const LOCKOUT_MINUTES = 15;
const MAX_FAILURES = 8;

const FIND = 'SELECT * FROM customers WHERE phone = ?';

const FAIL = `UPDATE customers SET failed_logins = failed_logins + 1 WHERE id = ?`;
const FAIL_RESET = `UPDATE customers SET failed_logins = 1, last_login_at = datetime('now') WHERE id = ?`;
const SUCCESS = "UPDATE customers SET failed_logins = 0, last_login_at = datetime('now') WHERE id = ?";

/**
 * Buyers sign in with their WhatsApp number — the same number they ordered on,
 * so there is no email to collect and nothing to remember but the password.
 */
export const onRequestPost = route(async (request, env) => {
  const body = await readBody(request);
  const phone = normalizePhone(body.phone);
  const password = String(body.password ?? '');
  if (!phone || password.length < 4) return badRequest('Enter your WhatsApp number and the password you were given.');

  const customer = await env.DB.prepare(FIND).bind(phone).first();
  // A wrong number must cost the same as a wrong password, or the form becomes
  // a cheap way to learn which numbers are customers.
  const salt = customer?.password_salt ?? '00000000000000000000000000000000';
  const hash = await hashPassword(password, salt);

  const matched = customer ? await safeCompare(hash, customer.password_hash) : false;
  if (!customer || customer.status !== 'active' || !matched) {
    if (customer) {
      const recent = await env.DB.prepare(
        "SELECT failed_logins FROM customers WHERE id = ? AND datetime(last_login_at) > datetime('now', ?)"
      ).bind(customer.id, `-${LOCKOUT_MINUTES} minutes`).first();
      const count = recent?.failed_logins ?? 0;
      if (count >= MAX_FAILURES) {
        return badRequest(`Too many wrong tries. Wait ${LOCKOUT_MINUTES} minutes and try again.`, 429);
      }
      await env.DB.prepare(count === 0 ? FAIL_RESET : FAIL).bind(customer.id).run();
    }
    await new Promise((r) => setTimeout(r, 500));
    return badRequest('Those details do not match.', 401);
  }

  await env.DB.prepare(SUCCESS).bind(customer.id).run();
  const token = await signToken(env, { role: 'customer', id: customer.id });
  const hours = Number(env.SESSION_TTL_HOURS) || 72;
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(CUSTOMER_COOKIE, token, hours * 3600) });
});
