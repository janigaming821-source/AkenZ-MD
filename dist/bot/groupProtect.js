import { whatsapp } from '../whatsapp/client.js';
import { getGroupSettings } from '../db/groups.js';
import { hasAdminRights } from './permissions.js';
import { logError } from '../db/botLog.js';
const LINK_PATTERN = /(?:https?:\/\/|www\.)\S+|whatsapp\.com\/\S+/i;
const recentMessages = new Map();
const MAX_CACHED = 200;
const spamWindow = new Map();
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW_MS = 10_000;
function cacheKey(groupJid, messageId) {
    return `${groupJid}:${messageId}`;
}
export function cacheMessage(inbound) {
    if (!inbound.isGroup)
        return;
    const key = cacheKey(inbound.jid, inbound.message.key.id ?? '');
    const text = extractText(inbound);
    recentMessages.set(key, {
        text,
        senderJid: inbound.participant ?? '',
        pushName: inbound.pushName,
        timestamp: Date.now(),
    });
    if (recentMessages.size > MAX_CACHED) {
        const oldest = recentMessages.keys().next();
        if (oldest.value)
            recentMessages.delete(oldest.value);
    }
}
function extractText(inbound) {
    const content = inbound.message.message;
    if (!content)
        return '';
    if (content.conversation)
        return content.conversation;
    if (content.extendedTextMessage?.text)
        return content.extendedTextMessage.text;
    if (content.imageMessage?.caption)
        return content.imageMessage.caption;
    if (content.videoMessage?.caption)
        return content.videoMessage.caption;
    return '';
}
export async function checkAntiLink(inbound) {
    if (!inbound.isGroup)
        return false;
    const settings = await getGroupSettings(inbound.jid);
    if (!settings.antiLink)
        return false;
    if (inbound.fromMe)
        return false;
    const sock = whatsapp.socket;
    if (!sock)
        return false;
    const sender = inbound.participant;
    if (!sender)
        return false;
    const isAdmin = await hasAdminRights(sock, inbound.jid, sender);
    if (isAdmin)
        return false;
    const text = extractText(inbound);
    if (!LINK_PATTERN.test(text))
        return false;
    try {
        await sock.sendMessage(inbound.jid, { delete: inbound.message.key });
        await sock.sendMessage(inbound.jid, { text: `@${sender.split('@')[0]}, links are not allowed here.`, mentions: [sender] });
        return true;
    }
    catch (error) {
        logError('antiLink', 'Failed to delete link message', {
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
export async function checkAntiSpam(inbound) {
    if (!inbound.isGroup)
        return false;
    const settings = await getGroupSettings(inbound.jid);
    if (!settings.antiSpam)
        return false;
    if (inbound.fromMe)
        return false;
    const sock = whatsapp.socket;
    if (!sock)
        return false;
    const sender = inbound.participant;
    if (!sender)
        return false;
    const isAdmin = await hasAdminRights(sock, inbound.jid, sender);
    if (isAdmin)
        return false;
    const now = Date.now();
    const windowKey = `${inbound.jid}:${sender}`;
    const timestamps = spamWindow.get(windowKey) ?? [];
    const recent = timestamps.filter((t) => now - t < SPAM_WINDOW_MS);
    recent.push(now);
    spamWindow.set(windowKey, recent);
    if (recent.length > SPAM_THRESHOLD) {
        try {
            await sock.sendMessage(inbound.jid, { text: `@${sender.split('@')[0]}, please slow down. Spamming is not allowed.`, mentions: [sender] });
            spamWindow.delete(windowKey);
            return true;
        }
        catch (error) {
            logError('antiSpam', 'Failed to warn spammer', {
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return false;
}
export async function handleDeleteEvent(keys) {
    const sock = whatsapp.socket;
    if (!sock)
        return;
    for (const key of keys) {
        if (!key.remoteJid || !key.id || !key.remoteJid.includes('@g.us'))
            continue;
        const ck = cacheKey(key.remoteJid, key.id);
        const cached = recentMessages.get(ck);
        if (!cached)
            continue;
        const groupSettings = await getGroupSettings(key.remoteJid);
        if (!groupSettings.antiDelete)
            continue;
        const name = cached.pushName || cached.senderJid.split('@')[0];
        const preview = cached.text.length > 200 ? cached.text.slice(0, 200) + '...' : cached.text || '(non-text message)';
        try {
            await sock.sendMessage(key.remoteJid, {
                text: `Deleted message from ${name}:\n\n${preview}`,
            });
            recentMessages.delete(ck);
        }
        catch (error) {
            logError('antiDelete', 'Failed to forward deleted message', {
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
//# sourceMappingURL=groupProtect.js.map