/**
 * Shared helpers for the shop Functions. Everything here runs on the Cloudflare
 * Workers runtime, so there is no node:crypto and no bcrypt — WebCrypto only.
 */

const utf8 = new TextEncoder();

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const badRequest = (message, status = 400) => json({ error: message }, status);

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** PBKDF2 stands in for bcrypt — the only slow hash this runtime offers. */
export async function hashPassword(plain, saltHex) {
  const base = await crypto.subtle.importKey('raw', utf8.encode(plain), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    // 100 000 is the ceiling: the Workers runtime refuses higher counts with
    // NotSupportedError, which surfaced as a 500 on every login.
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100_000 },
    base,
    256
  );
  return toHex(bits);
}

export const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

/**
 * A password a buyer can read off a WhatsApp message without ambiguity: no 0/O,
 * no 1/l/I. 8 characters from a 32-symbol alphabet is ~40 bits, which is enough
 * behind a lockout counter for a bot dashboard.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePassword(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/**
 * The Workers runtime has no crypto.timingSafeEqual, so secrets are compared by
 * their HMAC under a fixed key: both digests are always 64 hex characters, and
 * the loop reads every character before answering, so neither the length nor a
 * matching prefix is observable.
 */
export async function safeCompare(a, b) {
  const key = await crypto.subtle.importKey('raw', utf8.encode('akenz-shop-compare'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = async (value) => toHex(await crypto.subtle.sign('HMAC', key, utf8.encode(String(value))));
  const [left, right] = [await digest(a), await digest(b)];
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left.charCodeAt(i) ?? 0) ^ (right.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded + '==='.slice(0, (4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

/**
 * Sessions are stateless: the payload is base64url JSON signed with HMAC, so a
 * stolen cookie cannot be forged and an expired one needs no database cleanup.
 */
export async function signToken(env, payload) {
  const body = b64url(utf8.encode(JSON.stringify({ ...payload, exp: Date.now() + env.SESSION_TTL_HOURS * 3600_000 })));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.COOKIE_SECRET), utf8.encode(body))));
  return `${body}.${sig}`;
}

export async function verifyToken(env, token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const key = await hmacKey(env.COOKIE_SECRET);
  const expected = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(body))));
  if (!(await safeCompare(sig, expected))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function cookieNamed(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const sessionCookie = (name, token, maxAgeSeconds) =>
  `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export const clearCookie = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export const ADMIN_COOKIE = 'akenz_admin';
export const CUSTOMER_COOKIE = 'akenz_cust';

/** Basic requests are compared by digest, so a wrong guess has no observable shape. */
export async function adminMatches(request, env) {
  const { password } = await readBody(request);
  if (typeof password !== 'string' || !env.ADMIN_PASSWORD) return false;
  return safeCompare(password, env.ADMIN_PASSWORD);
}

export async function requireAdmin(request, env) {
  const payload = await verifyToken(env, cookieNamed(request, ADMIN_COOKIE));
  if (payload?.role !== 'admin') {
    throw Object.assign(new Error('admin login required'), { status: 401 });
  }
  return payload;
}

export async function requireCustomer(request, env) {
  const payload = await verifyToken(env, cookieNamed(request, CUSTOMER_COOKIE));
  if (payload?.role !== 'customer') {
    throw Object.assign(new Error('login required'), { status: 401 });
  }
  const row = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(payload.id).first();
  if (!row || row.status !== 'active') {
    throw Object.assign(new Error('login required'), { status: 401 });
  }
  return row;
}

/** Wraps every handler so a thrown {status} becomes the right HTTP answer. */
export const route = (handler) => async (context) => {
  try {
    return await handler(context.request, context.env, context);
  } catch (error) {
    if (error instanceof Response) return error;
    // Only an error nobody gave a status to is a bug — those stay generic, so a
    // database failure never prints its internals to a buyer's browser.
    if (!error?.status) {
      console.error(error);
      return badRequest('Something went wrong. Try again.', 500);
    }
    return badRequest(error.message, error.status);
  }
};

export const PLANS = {
  '1 Month': { price: 120, days: 31 },
  '1 Year': { price: 800, days: 366 },
  Lifetime: { price: 1000, days: 36500 },
};

export const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/[^\d]/g, '').replace(/^00/, '').replace(/^0/, '94');
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
};

/** The bot server, and the key that lets this site create and remove bots. */
export const botBase = (env) => String(env.BOT_URL ?? '').replace(/\/+$/, '');

const botKey = (env) => String(env.BOT_PROVISION_KEY ?? '');

/**
 * Asks the bot server for a bot. The key it returns is the buyer's own API key:
 * it scopes every later /api/bot/* call from the portal to that one bot, and the
 * browser never sees it.
 */
export async function provisionBot(env, { label, ownerNumber, plan, days }) {
  const base = botBase(env);
  const key = botKey(env);
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
export async function extendBot(env, instance, days) {
  const base = botBase(env);
  const key = botKey(env);
  if (!base || !key || !instance) return null;
  const res = await fetch(`${base}/api/instances/${encodeURIComponent(instance)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-provision-key': key },
    body: JSON.stringify({ expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() }),
  }).catch(() => null);
  return res?.ok ? res : null;
}

