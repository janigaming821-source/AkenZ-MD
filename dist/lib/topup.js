import { config } from '../config/env.js';
/**
 * Client for the Free Fire top-up site.
 *
 * The bot never prices anything itself and never holds an order in its own
 * database: it asks the site for a session token for the customer's phone
 * number and then calls the same /account/ endpoints the storefront uses. A
 * chat order therefore passes every checkout rule the web one does — the slip
 * is required, totals are recomputed from the catalogue, one free pack per
 * order, the same per-account rate limit.
 */
const API = () => String(config.raw.TOPUP_API_URL || '').replace(/\/+$/, '');
const KEY = () => String(config.raw.TOPUP_BOT_KEY || '');
// Only ever present on the seller's own instance. A buyer's bot has the shop
// key so its owner can take orders, and must not be able to settle one.
const DELIVERY_KEY = () => String(config.raw.TOPUP_DELIVERY_KEY || '');
export function deliveryReady() {
    return !!API() && !!DELIVERY_KEY();
}
export function topupReady() {
    return !!API() && !!KEY();
}
class TopupError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
async function call(path, init = {}, token, timeoutMs = 15000) {
    if (!topupReady())
        throw new TopupError('not_configured');
    const headers = {
        'content-type': 'application/json',
        'x-noaura-bot': KEY(),
        ...init.headers,
    };
    if (token)
        headers['x-noaura-user'] = token;
    const res = await fetch(`${API()}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!res)
        throw new TopupError('offline');
    // A JSON body is the only proof the site answered; a proxy page or a cold
    // start screen also arrives with HTTP 200.
    const body = (await res.json().catch(() => null));
    if (!body || typeof body !== 'object')
        throw new TopupError(`http_${res.status}`);
    if (body.ok === false)
        throw new TopupError(body.message || 'rejected');
    return body;
}
// -------------------------------------------------------------- catalogue
let cached = null;
const CONTEXT_TTL = 60_000;
export async function context(force = false) {
    if (!force && cached && Date.now() - cached.at < CONTEXT_TTL)
        return cached.value;
    const value = await call('/bot/context');
    cached = { at: Date.now(), value };
    return value;
}
/**
 * Wording the seller edited in the top-up console, served from a cache so a
 * slow site can never delay a chat reply. Refreshing in the background means
 * an edit lands on the next message instead of blocking this one.
 */
let copyCache = {};
let copyNextRefresh = 0;
export function copy() {
    const now = Date.now();
    if (now >= copyNextRefresh) {
        copyNextRefresh = now + 300_000;
        void context(true)
            .then((value) => {
            copyCache = value.messages || {};
        })
            .catch(() => {
            copyNextRefresh = now + 60_000;
        });
    }
    return copyCache;
}
// -------------------------------------------------------------- sessions
const sessions = new Map();
const SESSION_TTL = 6 * 24 * 3600 * 1000;
/** A phone number is the whole account, so the site mints a token for it. */
export async function session(phone) {
    const hit = sessions.get(phone);
    if (hit && Date.now() - hit.at < SESSION_TTL)
        return hit.token;
    const { token } = await call('/bot/session', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    });
    if (!token)
        throw new TopupError('no_token');
    sessions.set(phone, { at: Date.now(), token });
    return token;
}
/**
 * Ask the shop who owns that Player ID, before the money moves. It goes through
 * the same cached lookup the storefront uses, so an ID checked here is not
 * spent again at checkout. A null answer is not a refusal — the provider has a
 * small daily meter, and when it runs out the order still has to be placeable.
 */
export async function checkFfId(phone, ffId) {
    const token = await session(phone);
    const r = await call('/account/ff-save', { method: 'POST', body: JSON.stringify({ ff_id: ffId }) }, token, 
    // A cold provider lookup costs five seconds here. That is long enough to
    // hold a chat hostage, so it gets a short leash and the order goes through
    // on the seller's own reading of the ID instead.
    7000);
    return { verified: !!r.verified, nickname: String(r.nickname || ''), level: Number(r.level) || 0 };
}
export async function uploadSlip(phone, buffer, mime) {
    const token = await session(phone);
    const form = new FormData();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    form.append('slip', new Blob([new Uint8Array(buffer)], { type: mime.startsWith('image/') ? mime : 'image/jpeg' }), `slip.${ext}`);
    // The api() helper sets content-type for JSON bodies; multipart has to let
    // fetch attach its own boundary instead.
    const headers = { 'x-noaura-bot': KEY(), 'x-noaura-user': token };
    const res = await fetch(`${API()}/account/slip`, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!res)
        throw new TopupError('offline');
    const body = (await res.json().catch(() => null));
    if (!body?.ok || !body.path)
        throw new TopupError(body?.message || 'upload_failed');
    return body.path;
}
export async function placeOrder(phone, draft) {
    const token = await session(phone);
    const method = draft.method || 'ezcash';
    return call(`/account/orders`, {
        method: 'POST',
        body: JSON.stringify({
            ff_id: draft.ffId,
            items: draft.items,
            method,
            txn_id: draft.txnId || '',
            slip_path: draft.slipPath || '',
            slip_name: draft.slipPath ? 'slip.jpg' : '',
            note: draft.note || 'via WhatsApp',
        }),
    }, token);
}
/**
 * What the counter is worth for this customer. The site recomputes every total,
 * so this number is only ever used to choose which way to pay — never to price
 * anything.
 */
export async function balanceOf(phone) {
    const token = await session(phone);
    const { balance_lkr } = await call('/account/wallet', {}, token);
    return Math.max(0, Math.floor(Number(balance_lkr) || 0));
}
export async function ordersOf(phone) {
    const token = await session(phone);
    const { orders } = await call('/account/orders', {}, token);
    return orders || [];
}
export async function claimAlerts(limit = 3) {
    const { alerts } = await call('/bot/alerts/claim', {
        method: 'POST',
        body: JSON.stringify({ limit }),
    });
    return alerts || [];
}
/**
 * Tells the site what happened to a claimed alert. A send that the bot never
 * reports — a crash, a kill — is not lost: the site's lease expires and the
 * alert comes back on the next poll.
 */
export async function reportAlert(id, delivered, messageId = '', error = '') {
    await call('/bot/alerts/result', {
        method: 'POST',
        body: JSON.stringify({ id, ok: delivered, message_id: messageId, error }),
    });
}
/**
 * The seller said `.done`, so the site settles the order and hands back what the
 * receipt needs. Either a reference or the id of the alert message he replied to
 * identifies it — the message id is what makes "reply to the order and type
 * .done" survive a bot restart, because the site keeps it on the order row.
 */
export async function orderDone(ref, messageId = '') {
    if (!deliveryReady())
        throw new TopupError('delivery_not_configured');
    const res = await fetch(`${API()}/bot/order-done`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-noaura-delivery': DELIVERY_KEY(),
        },
        body: JSON.stringify({ ref, message_id: messageId }),
        signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (!res)
        throw new TopupError('offline');
    const body = (await res.json().catch(() => null));
    if (!body || typeof body !== 'object')
        throw new TopupError(`http_${res.status}`);
    if (body.ok === false)
        throw new TopupError(body.message || 'rejected');
    return { ...body, wa_phone: String(body.wa_phone || '') };
}
export { TopupError };
//# sourceMappingURL=topup.js.map