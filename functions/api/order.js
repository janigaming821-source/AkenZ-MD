import { badRequest, json, normalizePhone, PLANS, readBody, route } from '../_lib.js';

const INSERT_ORDER = `
  INSERT INTO orders (name, phone, plan, price_lkr, bot_name, prefix, ez_number, txn_id, notes, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const RATE_LIMIT = "SELECT COUNT(*) AS n FROM orders WHERE ip = ? AND created_at > datetime('now', '-1 hour')";

/**
 * The public order form. Nothing here confirms a payment — the row lands as
 * 'pending' and the owner approves it after checking EZ Cash, which is the whole
 * point of the approval step.
 */
export const onRequestPost = route(async (request, env) => {
  const body = await readBody(request);
  const name = String(body.name ?? '').trim().slice(0, 40);
  const phone = normalizePhone(body.phone);
  const plan = String(body.plan ?? '').trim();
  const ezNumber = normalizePhone(body.ez_number);
  const txnId = String(body.txn_id ?? '').trim().slice(0, 30);
  const notes = String(body.notes ?? '').trim().slice(0, 300);

  if (name.length < 2) return badRequest('Please give your name.');
  if (!phone) return badRequest('That WhatsApp number is not complete — use 0771234567 or +94771234567.');
  if (!PLANS[plan]) return badRequest('Choose one of the three plans.');
  if (!ezNumber) return badRequest('Enter the EZ Cash number you paid from.');
  if (txnId.length < 4) return badRequest('Enter the transaction reference from the EZ Cash confirmation.');

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const recent = await env.DB.prepare(RATE_LIMIT).bind(ip).first();
  if (recent?.n >= 5) return badRequest('Too many orders from here for now. Message the owner on WhatsApp instead.', 429);

  const prefix = ['.', '!', '#'].includes(body.prefix) ? body.prefix : '.';
  const botName = String(body.bot_name ?? '').trim().slice(0, 24);

  const { meta } = await env.DB.prepare(INSERT_ORDER)
    .bind(name, phone, plan, PLANS[plan].price, botName, prefix, ezNumber, txnId, notes, ip)
    .run();

  return json({ ok: true, order_id: String(meta.last_row_id) }, 201);
});
