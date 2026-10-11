import { config } from '../config/env.js';
import { getConfig } from '../db/config.js';
import { matchAutoReply } from '../db/autoreplies.js';
import { getCustomCommand } from '../db/customCommands.js';
import { getGroupSettings, upsertGroup } from '../db/groups.js';
import { touchUser, getUser, setUserLanguage } from '../db/users.js';
import { recordActivity } from '../db/stats.js';
import { logError } from '../db/botLog.js';
import { prisma } from '../db/client.js';
import { cacheMessage, checkAntiLink, checkAntiSpam } from './groupProtect.js';
import { t, detectLanguage, isLanguage } from '../i18n/index.js';
import { whatsapp } from '../whatsapp/client.js';
import { getText } from '../whatsapp/extract.js';
import { hasAdminRights, isBotAdmin, isOwner } from './permissions.js';
import { resolveCommand } from './registry.js';
const seenGroups = new Set();
const rateWindows = new Map();
function rateLimitHit(key, seconds) {
    const now = Date.now();
    const expires = rateWindows.get(key) ?? 0;
    if (expires > now)
        return { blocked: true, retryIn: Math.ceil((expires - now) / 1000) };
    rateWindows.set(key, now + seconds * 1000);
    if (rateWindows.size > 5000) {
        for (const [k, v] of rateWindows)
            if (v <= now)
                rateWindows.delete(k);
    }
    return { blocked: false, retryIn: 0 };
}
async function resolveLanguage(senderJid, text, settings) {
    // A message written in Sinhala is answered in Sinhala, whatever is stored.
    const detected = detectLanguage(text);
    if (detected)
        return detected;
    const user = await getUser(senderJid);
    // An unset preference means "follow the bot default", so changing the default
    // on the dashboard actually reaches people.
    if (user?.language && isLanguage(user.language))
        return user.language;
    return isLanguage(settings.language) ? settings.language : 'en';
}
export async function handleInbound(inbound) {
    const { message, isGroup, jid: chatJid, pushName } = inbound;
    if (inbound.fromMe)
        return; // the owner's own phone is not a command channel
    const senderJid = isGroup ? inbound.participant ?? chatJid : chatJid;
    const settings = await getConfig();
    const text = getText(message);
    if (!text)
        return;
    try {
        await touchUser(senderJid, pushName);
        if (isGroup && !seenGroups.has(chatJid)) {
            seenGroups.add(chatJid);
            await upsertGroup(chatJid, null);
        }
    }
    catch (error) {
        logError('handler', 'Could not record inbound activity', {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
    const groupSettings = isGroup ? await getGroupSettings(chatJid) : null;
    const prefix = groupSettings?.prefix || settings.prefix;
    const lang = await resolveLanguage(senderJid, text, settings);
    const owner = isOwner(senderJid, settings.ownerNumber, config.bot.ownerJid);
    const sock = whatsapp.socket;
    if (!sock)
        return;
    if (isGroup) {
        cacheMessage(inbound);
        if (await checkAntiLink(inbound))
            return;
        if (await checkAntiSpam(inbound))
            return;
    }
    const replyText = (body) => sock.sendMessage(chatJid, { text: body }, { quoted: message });
    const buildContext = (command, args, fullArgs) => ({
        receivedAt: inbound.receivedAt,
        command,
        args,
        fullArgs,
        text,
        prefix,
        lang,
        settings,
        chatJid,
        isGroup,
        groupJid: isGroup ? chatJid : null,
        senderJid,
        pushName,
        isOwner: owner,
        isAdmin: async () => (isGroup ? hasAdminRights(sock, chatJid, senderJid) : owner),
        isBotAdmin: async () => (isGroup ? isBotAdmin(sock, chatJid, whatsapp.selfJid) : false),
        message,
        reply: async (body, options = {}) => {
            await sock.sendMessage(chatJid, {
                text: body,
                ...(options.mentions?.length ? { mentions: options.mentions } : {}),
            }, 
            // Reply-quotes are what make a bot chat readable; status() opts out.
            options.quoted === false ? {} : { quoted: message });
        },
        sendMedia: async (content) => {
            await sock.sendMessage(chatJid, content);
        },
        t: (key, vars) => t(lang, key, vars),
        status: async (body) => {
            await sock.sendMessage(chatJid, { text: body });
        },
    });
    const looksLikeCommand = text.startsWith(prefix) && text.length > prefix.length;
    if (!looksLikeCommand) {
        recordActivity(chatJid, isGroup).catch(() => { });
        if (settings.autoReplyEnabled) {
            const hit = await matchAutoReply(text);
            if (hit)
                await replyText(hit.response);
        }
        return;
    }
    const [rawName = '', ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    const fullArgs = args.join(' ');
    if (!name)
        return;
    const command = resolveCommand(name);
    // Counting is a nice-to-have; a failed insert must never eat the reply.
    recordActivity(chatJid, isGroup, name).catch(() => { });
    if (!command) {
        const custom = await getCustomCommand(name);
        if (custom)
            await replyText(custom.response);
        return;
    }
    if (command.ownerOnly && !owner) {
        await replyText(t(lang, 'error.notOwner'));
        await prisma.botLog.create({
            data: {
                level: 'warn',
                scope: 'security',
                message: 'Blocked an owner-only command attempt',
                meta: JSON.stringify({ command: name, group: isGroup }),
            },
        });
        return;
    }
    if (command.groupOnly && !isGroup) {
        await replyText(t(lang, 'error.notInGroup'));
        return;
    }
    if (command.adminOnly && !owner && !(await hasAdminRights(sock, chatJid, senderJid))) {
        await replyText(t(lang, 'error.notAdmin'));
        return;
    }
    if (command.rateLimitSeconds) {
        const hit = rateLimitHit(`${senderJid}:${name}`, command.rateLimitSeconds);
        if (hit.blocked) {
            await replyText(t(lang, 'error.rateLimited', { seconds: hit.retryIn }));
            return;
        }
    }
    const ctx = buildContext(name, args, fullArgs);
    try {
        await command.execute(ctx);
        if (command.ownerOnly) {
            await prisma.ownerAction.create({
                data: { action: name, detail: fullArgs.slice(0, 200), actorJid: senderJid },
            });
        }
    }
    catch (error) {
        const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
        await logError('command', `Command .${name} failed`, { detail: error instanceof Error ? error.message : detail });
        await replyText(t(lang, 'error.generic'));
    }
}
/** Used by .language and the dashboard when the owner changes the default. */
export async function rememberLanguage(senderJid, language) {
    await setUserLanguage(senderJid, language);
}
//# sourceMappingURL=handler.js.map