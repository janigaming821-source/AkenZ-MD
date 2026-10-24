import { t as translate } from '../i18n/index.js';
import * as api from '../lib/topup.js';
import { getUser } from '../db/users.js';
import { compressImage } from '../media/images.js';
import { getMediaType, mediaSourceMessage } from '../whatsapp/extract.js';
import { whatsapp } from '../whatsapp/client.js';
// One unfinished order per private chat, good for twenty minutes. A stale
// half-order must never hijack whatever the person types next.
const drafts = new Map();
const DRAFT_TTL = 20 * 60_000;
export function draftOf(chatJid) {
    const hit = drafts.get(chatJid);
    if (!hit)
        return undefined;
    if (Date.now() - hit.at > DRAFT_TTL) {
        drafts.delete(chatJid);
        return undefined;
    }
    return hit;
}
function setDraft(chatJid, next) {
    drafts.set(chatJid, next);
    if (drafts.size > 500) {
        for (const [jid, draft] of drafts)
            if (Date.now() - draft.at > DRAFT_TTL)
                drafts.delete(jid);
    }
}
export function clearDraft(chatJid) {
    drafts.delete(chatJid);
}
/** Digits of the address a customer sends from. A privacy address has none. */
function phoneOf(jid) {
    if (String(jid || '').endsWith('@lid'))
        return '';
    const raw = String(jid).split('@')[0]?.replace(/\D/g, '') ?? '';
    return raw.length >= 10 ? raw : '';
}
/** 070XXXXXXX and 70XXXXXXX both mean 9470XXXXXXX, the way the site reads it. */
function normalizePhone(digits) {
    let d = digits.replace(/\D/g, '').replace(/^00/, '');
    if (d.startsWith('0'))
        d = `94${d.slice(1)}`;
    else if (d.length === 9)
        d = `94${d}`;
    return d.length >= 10 && d.length <= 12 ? d : '';
}
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} LKR`;
/**
 * Copy for a chat. Anything the seller typed in the top-up console wins; the
 * bundled locale is the fallback. A Sinhala answer carries the English
 * underneath, because one thread is read by people who type either.
 */
function say(ctx, key, vars) {
    const override = ctx.topupCopy?.[key];
    if (override)
        return interpolate(override, vars);
    const main = ctx.t(key, vars);
    if (ctx.lang === 'si')
        return `${main}\n\n${interpolate(translate('en', key, vars), vars)}`;
    return main;
}
function interpolate(raw, vars) {
    return Object.entries(vars || {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw);
}
async function catalog() {
    try {
        return await api.context();
    }
    catch {
        return null;
    }
}
/** Only packs a buyer can actually get: likes stay off the shelf until open. */
function shelf(cfg) {
    return cfg.packs.filter((p) => p.category !== 'likes' || cfg.likes_enabled);
}
function packName(p, lang) {
    return lang === 'si' && p.name_si ? p.name_si : p.name_en;
}
/**
 * `.buy 100`, `.buy diamond 100`, `.buy 3`. A number that matches a pack size
 * wins over a list position, because a size is what people actually type.
 */
function findPack(list, query) {
    const q = query.toLowerCase().trim();
    if (!q)
        return undefined;
    const numbered = list.map((p, i) => ({ p, n: i + 1 }));
    if (/^\d+$/.test(q)) {
        const bySize = numbered.find(({ p }) => p.sku.endsWith(`_${q}`) || String(p.price_lkr) === q);
        if (bySize)
            return bySize.p;
        const byIndex = numbered.find(({ n }) => String(n) === q);
        if (byIndex)
            return byIndex.p;
        return undefined;
    }
    const words = q.replace(/[^a-z0-9]/g, '');
    return numbered.find(({ p }) => `${p.sku} ${p.name_en} ${p.name_si}`.toLowerCase().replace(/[^a-z0-9]/g, '').includes(words))
        ?.p;
}
// ------------------------------------------------------------------ commands
const prices = {
    name: 'prices',
    aliases: ['topup', 'packs', 'shop'],
    category: 'topup',
    inMenu: true,
    description: 'Every pack with today\u2019s price',
    usage: 'prices',
    rateLimitSeconds: 3,
    async execute(ctx) {
        const cfg = await catalog();
        if (!cfg)
            return ctx.reply(say(ctx, 'topup.offline'));
        if (cfg.maintenance === 'on')
            return ctx.reply(say(ctx, 'topup.closed'));
        const lines = shelf(cfg).map((p, i) => {
            const off = p.was_price_lkr > p.price_lkr ? ` -${Math.round((1 - p.price_lkr / p.was_price_lkr) * 100)}%` : '';
            return `*${i + 1}.* ${packName(p, ctx.lang)} — ${money(p.price_lkr)}${off}`;
        });
        await ctx.reply(`${say(ctx, 'topup.pricesHead', { store: cfg.store_name })}\n\n${lines.join('\n')}\n\n${say(ctx, 'topup.pricesFoot', {
            min: money(cfg.min_order_lkr),
            buy: `${ctx.prefix}buy`,
        })}`);
    },
};
const buy = {
    name: 'buy',
    aliases: ['order'],
    category: 'topup',
    inMenu: true,
    description: 'Start a top-up order',
    usage: 'buy <pack> [quantity]',
    rateLimitSeconds: 1,
    async execute(ctx) {
        if (ctx.isGroup)
            return ctx.reply(say(ctx, 'topup.privateOnly'));
        const cfg = await catalog();
        if (!cfg)
            return ctx.reply(say(ctx, 'topup.offline'));
        if (cfg.maintenance === 'on')
            return ctx.reply(say(ctx, 'topup.closed'));
        const query = ctx.fullArgs.trim();
        if (!query) {
            await ctx.reply(say(ctx, 'topup.pick', { prices: `${ctx.prefix}prices`, buy: `${ctx.prefix}buy` }));
            return;
        }
        const parts = query.split(/\s+/);
        // ".buy 300" is one 300-diamond pack; ".buy 300 2" is two of them. Only a
        // second number counts as a quantity, so a size can never eat itself.
        let qty = 1;
        const last = parts.at(-1) ?? '';
        if (parts.length > 1 && /^\d{1,2}$/.test(last)) {
            const maybe = Number(last);
            if (maybe >= 1 && maybe <= cfg.max_items) {
                qty = maybe;
                parts.pop();
            }
        }
        const pack = findPack(shelf(cfg), parts.join(' '));
        if (!pack) {
            // A locked pack still gets the honest reason rather than "not found",
            // so the customer knows it is coming rather than missing.
            const hidden = cfg.packs.some((p) => p.category === 'likes' && findPack([p], parts.join(' ')));
            if (hidden && !cfg.likes_enabled) {
                await ctx.reply(say(ctx, 'topup.likesLocked'));
                return;
            }
            await ctx.reply(say(ctx, 'topup.noPack', { query, prices: `${ctx.prefix}prices` }));
            return;
        }
        if (pack.category === 'likes' && !cfg.likes_enabled) {
            await ctx.reply(say(ctx, 'topup.likesLocked'));
            return;
        }
        const fee = pack.price_lkr > 0 ? cfg.ezcash_fee_lkr : 0;
        const total = pack.price_lkr * qty + fee;
        if (total > 0 && total < cfg.min_order_lkr) {
            await ctx.reply(say(ctx, 'topup.belowMin', { min: money(cfg.min_order_lkr) }));
            return;
        }
        const label = `${packName(pack, ctx.lang)} ×${qty}`;
        const phone = phoneOf(ctx.senderJid);
        setDraft(ctx.chatJid, {
            sku: pack.sku,
            label,
            unit: pack.price_lkr,
            qty,
            fee,
            phone,
            ffId: '',
            slipPath: '',
            step: phone ? 'ffid' : 'phone',
            at: Date.now(),
        });
        const ask = phone
            ? say(ctx, 'topup.needPlayerId', { pack: label })
            : say(ctx, 'topup.needOwnNumber', { pack: label });
        await ctx.reply(`${say(ctx, 'topup.selected', { pack: label, total: money(total) })}\n\n${ask}`);
    },
};
const track = {
    name: 'track',
    aliases: ['mystatus', 'myorders'],
    category: 'topup',
    inMenu: true,
    description: 'Check an order',
    usage: 'track [order number]',
    rateLimitSeconds: 5,
    async execute(ctx) {
        if (ctx.isGroup)
            return ctx.reply(say(ctx, 'topup.privateOnly'));
        const phone = phoneOf(ctx.senderJid);
        if (!phone)
            return ctx.reply(say(ctx, 'topup.needNumber'));
        let list;
        try {
            list = await api.ordersOf(phone);
        }
        catch {
            return ctx.reply(say(ctx, 'topup.offline'));
        }
        if (!list.length)
            return ctx.reply(say(ctx, 'topup.noOrders'));
        const wanted = ctx.fullArgs.trim().toUpperCase();
        const order = wanted ? list.find((o) => o.ref.toUpperCase() === wanted) : list[0];
        if (!order)
            return ctx.reply(say(ctx, 'topup.noSuchOrder', { ref: wanted }));
        const cfg = await catalog();
        const line = say(ctx, `topup.state.${order.status}`, {
            ref: order.ref,
            amount: money(order.amount_lkr),
            pack: (order.items || []).map((i) => `${packLike(i.name_en, i.name_si, ctx.lang)} ×${i.qty}`).join(', '),
        });
        const link = cfg?.store_url ? say(ctx, 'topup.trackLink', { url: `${cfg.store_url}/track#${order.ref}` }) : '';
        await ctx.reply(`${line}${order.reject_reason ? `\n\n${say(ctx, 'topup.reason', { reason: order.reject_reason })}` : ''}${link ? `\n${link}` : ''}`);
    },
};
function packLike(en, si, lang) {
    return lang === 'si' && si ? si : en;
}
const ezcash = {
    name: 'ezcash',
    aliases: ['pay'],
    category: 'topup',
    inMenu: true,
    description: 'Where to pay',
    usage: 'ezcash',
    rateLimitSeconds: 5,
    async execute(ctx) {
        const cfg = await catalog();
        if (!cfg?.ezcash_number)
            return ctx.reply(say(ctx, 'topup.noCounter'));
        await ctx.reply(say(ctx, 'topup.payNow', { name: cfg.ezcash_name, number: cfg.ezcash_number }));
    },
};
const nevermind = {
    name: 'nevermind',
    aliases: ['stoporder'],
    category: 'topup',
    inMenu: true,
    description: 'Forget the order in progress',
    usage: 'nevermind',
    async execute(ctx) {
        if (!draftOf(ctx.chatJid))
            return ctx.reply(say(ctx, 'topup.noDraft'));
        clearDraft(ctx.chatJid);
        await ctx.reply(say(ctx, 'topup.draftGone'));
    },
};
const support = {
    name: 'support',
    aliases: ['assist'],
    category: 'topup',
    inMenu: true,
    description: 'Talk to the seller',
    usage: 'support <your question>',
    rateLimitSeconds: 20,
    async execute(ctx) {
        if (!ctx.fullArgs.trim())
            return ctx.reply(say(ctx, 'topup.needQuestion'));
        const sent = await forwardToSeller(ctx, ctx.fullArgs.trim());
        if (!sent)
            await ctx.reply(say(ctx, 'topup.noSupport'));
    },
};
/**
 * The counter only opens on the seller's own number. A buyer's bot has the
 * same command names installed but must send its customers elsewhere, because
 * these orders would land on the seller's shop.
 */
function shop(command) {
    return {
        ...command,
        execute: async (ctx) => {
            if (!ctx.isTopup) {
                await ctx.reply(ctx.t('topup.notForThisBot', { prices: `${ctx.prefix}prices`, buy: `${ctx.prefix}buy` }));
                return;
            }
            await command.execute(ctx);
        },
    };
}
export const topupCommands = [prices, buy, track, ezcash, nevermind, support].map(shop);
/** Commands the shop line answers with. Everything else belongs to a buyer's bot. */
export const TOPUP_COMMAND_NAMES = new Set(topupCommands.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
/** Orientation stays open on the shop line so nobody feels stuck. */
export const TOPUP_ORIENT_NAMES = new Set(['menu', 'start', 'commands', 'help', 'ping', 'language']);
// ------------------------------------------------------- seller conversation
const relays = new Map();
const RELAY_TTL = 12 * 3600_000;
/**
 * A plain message on the shop line is a question, not noise. It goes to the
 * seller with the customer's number on the front, and whatever the seller
 * replies to that forwarded copy comes straight back to the customer — one
 * thread, no app switching, nothing lost in the middle.
 */
async function forwardToSeller(ctx, text, quiet = false) {
    // The seller's own chats must never bounce his words back at him.
    if (ctx.isOwner)
        return false;
    const raw = String(ctx.settings.ownerNumber || '').replace(/\D/g, '');
    if (!raw)
        return false;
    const to = `${raw}@s.whatsapp.net`;
    const phone = phoneOf(ctx.senderJid) || ctx.senderJid.split('@')[0] || '';
    const sent = await whatsapp
        .sendMessage(to, { text: `${ctx.t('topup.relayHead', { name: ctx.pushName || 'Customer', phone })}\n${text.slice(0, 1500)}` })
        .catch(() => null);
    const id = sent?.key?.id;
    if (!id)
        return false;
    relays.set(id, { chatJid: ctx.chatJid, phone, at: Date.now() });
    if (relays.size > 400) {
        for (const [old, hit] of relays)
            if (Date.now() - hit.at > RELAY_TTL)
                relays.delete(old);
    }
    // The intro has already been given, so from here on the pass-on happens
    // without telling the customer about it. The seller answers into this chat.
    if (!quiet)
        await ctx.reply(say(ctx, 'topup.relaySent'));
    return true;
}
function quotedId(message) {
    const text = message.message?.extendedTextMessage;
    return text?.contextInfo?.stanzaId || '';
}
function bodyOf(message) {
    return String(message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? '').trim();
}
/**
 * The seller answered a forwarded question. Only a reply to that exact
 * forwarded message counts, so his own commands and top-up orders are untouched.
 */
export async function relayAnswer(message) {
    const id = quotedId(message);
    if (!id)
        return false;
    const hit = relays.get(id);
    if (!hit || Date.now() - hit.at > RELAY_TTL)
        return false;
    const text = bodyOf(message);
    if (!text)
        return false;
    await whatsapp.sendText(hit.chatJid, text).catch(() => null);
    relays.delete(id);
    return true;
}
// ------------------------------------------------------------ chat follow-up
// ------------------------------------------------------------ first contact
/**
 * The counter speaks once. Whoever writes to this number for the very first
 * time gets the shop intro, because "hi" is how a buyer arrives and an empty
 * chat looks like a dead one. Anything they send afterwards is either a command,
 * the next step of an order, or a question for the seller — never a second
 * chance to hear the same speech.
 *
 * `messageCount` is read after the handler has already recorded this message,
 * so 1 means nothing from this number was ever on file before.
 */
async function greetOnce(ctx) {
    if (ctx.isOwner || !ctx.text.trim())
        return false;
    const seen = await getUser(ctx.senderJid).catch(() => null);
    if (seen && seen.messageCount > 1)
        return false;
    await ctx.reply(say(ctx, 'topup.greet', { prices: `${ctx.prefix}prices`, buy: `${ctx.prefix}buy` }));
    return true;
}
// ------------------------------------------------------------ chat follow-up
/**
 * Anything that is not a command, on the shop line. A chat holding a draft
 * answers as the next step of that order — own number, player ID, slip photo,
 * EZ Cash reference — and a chat without one becomes a question for the seller.
 * Returns true when the message was consumed.
 */
export async function handleTopupChat(ctx) {
    if (ctx.isGroup)
        return false;
    const draft = draftOf(ctx.chatJid);
    // A picture with no words on it is only a slip when an order is waiting for
    // one. Otherwise the chat is answered exactly like any other message.
    if (!draft && !ctx.text.trim())
        return false;
    if (!draft) {
        if (await greetOnce(ctx))
            return true;
        // Past the intro the bot keeps out of the way: the question still reaches
        // the seller, who answers into this chat, but the customer is not told a
        // forwarding happened.
        return forwardToSeller(ctx, ctx.text, true);
    }
    const media = getMediaType(ctx.message);
    const source = mediaSourceMessage(ctx.message);
    if (media === 'image' && source && draft.step === 'slip') {
        let buffer;
        try {
            buffer = await whatsapp.downloadMedia(source);
        }
        catch {
            return stuckOn(ctx, draft, 'topup.slipFail');
        }
        const small = await compressImage(buffer, 1200).catch(() => ({ buffer }));
        try {
            draft.slipPath = await api.uploadSlip(draft.phone, small.buffer, 'image/jpeg');
        }
        catch (error) {
            const code = error instanceof api.TopupError ? error.code : 'upload_failed';
            return stuckOn(ctx, draft, slipError(code));
        }
        draft.step = 'txn';
        draft.at = Date.now();
        await ctx.reply(say(ctx, 'topup.needTxn', { pack: draft.label }));
        return true;
    }
    const digits = ctx.text.replace(/\D/g, '');
    if (draft.step === 'phone') {
        const phone = normalizePhone(digits);
        if (!phone)
            return stuckOn(ctx, draft, 'topup.badOwnNumber');
        draft.phone = phone;
        draft.step = 'ffid';
        draft.at = Date.now();
        await ctx.reply(say(ctx, 'topup.needPlayerId', { pack: draft.label }));
        return true;
    }
    if (draft.step === 'ffid') {
        if (digits.length < 8 || digits.length > 12) {
            return stuckOn(ctx, draft, 'topup.badPlayerId');
        }
        draft.ffId = digits;
        draft.at = Date.now();
        const cfg = await catalog();
        const total = draft.unit * draft.qty + draft.fee;
        // Money that is already in the account retires the whole counter leg — no
        // shop visit, no slip photo, no reference to type. It is only a shortcut
        // and never a licence: the site recomputes the total from the catalogue and
        // refuses to spend what is not there, so a stale number here just falls
        // back to paying at the counter.
        const held = await api.balanceOf(draft.phone).catch(() => 0);
        if (total > 0 && held >= total) {
            try {
                const placed = await api.placeOrder(draft.phone, {
                    ffId: draft.ffId,
                    items: [{ sku: draft.sku, qty: draft.qty }],
                    method: 'wallet',
                });
                clearDraft(ctx.chatJid);
                await ctx.reply(say(ctx, 'topup.paidWallet', {
                    ref: String(placed.ref || ''),
                    pack: draft.label,
                    total: money(Number(placed.amount_lkr) || total),
                    left: money(Number(placed.balance_lkr) || held - total),
                }));
                return true;
            }
            catch (error) {
                const code = error instanceof api.TopupError ? error.code : 'offline';
                if (code !== 'wallet_short')
                    return stuckOn(ctx, draft, orderError(code));
            }
        }
        draft.step = 'slip';
        await ctx.reply(say(ctx, 'topup.needSlip', {
            total: money(total),
            name: cfg?.ezcash_name || '',
            number: cfg?.ezcash_number || '',
            pack: draft.label,
        }));
        return true;
    }
    if (draft.step === 'txn') {
        if (digits.length < 6)
            return stuckOn(ctx, draft, 'topup.badTxn');
        try {
            const placed = await api.placeOrder(draft.phone, {
                ffId: draft.ffId,
                items: [{ sku: draft.sku, qty: draft.qty }],
                txnId: digits,
                slipPath: draft.slipPath,
            });
            clearDraft(ctx.chatJid);
            await ctx.reply(say(ctx, 'topup.placed', {
                ref: String(placed.ref || ''),
                pack: draft.label,
                total: money(Number(placed.amount_lkr) || draft.unit * draft.qty + draft.fee),
            }));
            return true;
        }
        catch (error) {
            const code = error instanceof api.TopupError ? error.code : 'offline';
            return stuckOn(ctx, draft, orderError(code));
        }
    }
    // A slip that has not arrived yet: repeat the step it is stuck on.
    return stuckOn(ctx, draft, 'topup.needStep');
}
/** The prompt that gets a draft moving again, per step. */
const STEP_KEY = {
    phone: 'topup.needOwnNumber',
    ffid: 'topup.needPlayerId',
    slip: 'topup.needSlip',
    txn: 'topup.needTxn',
};
/**
 * Answer an error, then repeat the step the order is stuck on. The draft stays
 * exactly where it was, so a mistyped reference never costs the customer their
 * place in the order.
 */
async function stuckOn(ctx, draft, key) {
    draft.at = Date.now();
    const cfg = await catalog();
    const vars = {
        pack: draft.label,
        total: money(draft.unit * draft.qty + draft.fee),
        name: cfg?.ezcash_name || '',
        number: cfg?.ezcash_number || '',
    };
    await ctx.reply(`${say(ctx, key, vars)}\n\n${say(ctx, STEP_KEY[draft.step], vars)}`);
    return true;
}
function slipError(code) {
    if (code === 'file_too_large')
        return 'topup.slipBig';
    if (code === 'unsupported_type')
        return 'topup.slipType';
    if (code === 'too_many_uploads')
        return 'topup.tooMany';
    return 'topup.slipFail';
}
/** The site already said why it refused; the chat repeats it in the customer's words. */
function orderError(code) {
    const known = {
        slip_required: 'topup.stillNeedSlip',
        txn_id_too_short: 'topup.badTxn',
        txn_already_used: 'topup.txnUsed',
        invalid_ff_id: 'topup.badPlayerId',
        order_below_minimum: 'topup.belowMinOnly',
        too_many_orders: 'topup.tooMany',
        max_10_items_per_order: 'topup.tooManyPacks',
        free_limit: 'topup.freeOnce',
        unknown_package: 'topup.packChanged',
        likes_under_development: 'topup.likesLocked',
        offline: 'topup.offline',
        store_closed: 'topup.closed',
        could_not_place_order: 'topup.tryAgain',
    };
    return known[code] || 'topup.tryAgain';
}
//# sourceMappingURL=topup.js.map