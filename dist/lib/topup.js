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
async function call(path, init = {}, token) {
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
        signal: AbortSignal.timeout(15000),
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
    return call(`/account/orders`, {
        method: 'POST',
        body: JSON.stringify({
            ff_id: draft.ffId,
            items: draft.items,
            method: 'ezcash',
            txn_id: draft.txnId,
            slip_path: draft.slipPath,
            slip_name: 'slip.jpg',
            note: draft.note || 'via WhatsApp',
        }),
    }, token);
}
export async function ordersOf(phone) {
    const token = await session(phone);
    const { orders } = await call('/account/orders', {}, token);
    return orders || [];
}
export { TopupError };
//# sourceMappingURL=topup.js.map