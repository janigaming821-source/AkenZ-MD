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

export function topupReady(): boolean {
  return !!API() && !!KEY();
}

export interface TopupPack {
  sku: string;
  category: string;
  name_en: string;
  name_si: string;
  detail_en: string;
  detail_si: string;
  badge_en: string;
  price_lkr: number;
  was_price_lkr: number;
}

export interface TopupContext {
  store_name: string;
  packs: TopupPack[];
  likes_enabled: boolean;
  ezcash_number: string;
  ezcash_name: string;
  ezcash_fee_lkr: number;
  min_order_lkr: number;
  max_items: number;
  slip_required: boolean;
  store_url: string;
  support_whatsapp: string;
  maintenance: string;
  /** Copy the owner edited in the console; anything absent uses the bot's own. */
  messages: Record<string, string>;
}

class TopupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  if (!topupReady()) throw new TopupError('not_configured');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-noaura-bot': KEY(),
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['x-noaura-user'] = token;
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res) throw new TopupError('offline');
  // A JSON body is the only proof the site answered; a proxy page or a cold
  // start screen also arrives with HTTP 200.
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
  if (!body || typeof body !== 'object') throw new TopupError(`http_${res.status}`);
  if (body.ok === false) throw new TopupError(body.message || 'rejected');
  return body;
}

// -------------------------------------------------------------- catalogue

let cached: { at: number; value: TopupContext } | null = null;
const CONTEXT_TTL = 60_000;

export async function context(force = false): Promise<TopupContext> {
  if (!force && cached && Date.now() - cached.at < CONTEXT_TTL) return cached.value;
  const value = await call<TopupContext>('/bot/context');
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Wording the seller edited in the top-up console, served from a cache so a
 * slow site can never delay a chat reply. Refreshing in the background means
 * an edit lands on the next message instead of blocking this one.
 */
let copyCache: Record<string, string> = {};
let copyNextRefresh = 0;

export function copy(): Record<string, string> {
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

const sessions = new Map<string, { at: number; token: string }>();
const SESSION_TTL = 6 * 24 * 3600 * 1000;

/** A phone number is the whole account, so the site mints a token for it. */
export async function session(phone: string): Promise<string> {
  const hit = sessions.get(phone);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.token;
  const { token } = await call<{ token: string }>('/bot/session', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  if (!token) throw new TopupError('no_token');
  sessions.set(phone, { at: Date.now(), token });
  return token;
}

export interface OrderDraft {
  ffId: string;
  items: { sku: string; qty: number }[];
  txnId: string;
  slipPath: string;
  note?: string;
}

export async function uploadSlip(phone: string, buffer: Buffer, mime: string): Promise<string> {
  const token = await session(phone);
  const form = new FormData();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  form.append(
    'slip',
    new Blob([new Uint8Array(buffer)], { type: mime.startsWith('image/') ? mime : 'image/jpeg' }),
    `slip.${ext}`
  );
  // The api() helper sets content-type for JSON bodies; multipart has to let
  // fetch attach its own boundary instead.
  const headers: Record<string, string> = { 'x-noaura-bot': KEY(), 'x-noaura-user': token };
  const res = await fetch(`${API()}/account/slip`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!res) throw new TopupError('offline');
  const body = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; message?: string } | null;
  if (!body?.ok || !body.path) throw new TopupError(body?.message || 'upload_failed');
  return body.path;
}

export async function placeOrder(phone: string, draft: OrderDraft): Promise<Record<string, unknown>> {
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

export interface SiteOrder {
  ref: string;
  status: string;
  ff_id: string;
  amount_lkr: number;
  items: { name_en: string; name_si: string; qty: number; price_lkr: number }[];
  created_at: string;
  reviewed_at: string | null;
  delivered_at: string | null;
  reject_reason?: string;
}

export async function ordersOf(phone: string): Promise<SiteOrder[]> {
  const token = await session(phone);
  const { orders } = await call<{ orders: SiteOrder[] }>('/account/orders', {}, token);
  return orders || [];
}

export { TopupError };
