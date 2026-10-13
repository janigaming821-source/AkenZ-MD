import axios from 'axios';
import { whatsapp } from '../whatsapp/client.js';
import { quotedMessageId } from '../whatsapp/extract.js';
import { validatePublicUrl } from '../tools/url.js';
import { extractAudio, toGif, toVoiceNote } from '../media/convert.js';
import { logError } from '../db/botLog.js';
import { clearLogo, imageFormat, LOGO_MAX_BYTES, setLogo } from '../db/branding.js';
import { resolveTargetJid } from '../bot/targets.js';
import { invalidateGroupCache } from '../bot/permissions.js';
import { inboundMedia } from './media.js';
/**
 * Several features address *another* message (react, delete). WhatsApp only
 * identifies it by key, and the key is rebuilt from the quoting context: the
 * quoted id, plus the author when the quoted message came from somebody else.
 */
function quotedKey(ctx) {
    const id = quotedMessageId(ctx.message);
    if (!id)
        return null;
    const info = ctx.message.message?.extendedTextMessage?.contextInfo;
    return {
        remoteJid: ctx.chatJid,
        id,
        fromMe: !info?.participant,
        participant: info?.participant,
    };
}
async function fetchBuffer(url) {
    const validated = await validatePublicUrl(url);
    if (!validated.ok)
        throw new Error('The picture URL was not accepted.');
    const { data } = await axios.get(validated.url.toString(), {
        responseType: 'arraybuffer',
        timeout: 20_000,
        maxContentLength: 15 * 1024 * 1024,
    });
    return Buffer.from(data);
}
const pp = {
    name: 'pp',
    category: 'tools',
    description: 'Download the profile picture of a number, a member or a group.',
    usage: 'pp [group]  (mention or reply to someone)',
    inMenu: true,
    rateLimitSeconds: 8,
    async execute(ctx) {
        const sock = whatsapp.socket;
        if (!sock)
            return;
        const wantsGroup = ctx.args[0]?.toLowerCase() === 'group';
        const target = wantsGroup ? ctx.groupJid : (await resolveTargetJid(ctx)) ?? ctx.senderJid;
        if (!target) {
            await ctx.reply(ctx.t('error.notFound'));
            return;
        }
        let url;
        try {
            url = await sock.profilePictureUrl(target, 'image');
        }
        catch {
            url = undefined;
        }
        if (!url) {
            await ctx.reply(ctx.t('pp.none'));
            return;
        }
        try {
            await ctx.sendMedia({ image: await fetchBuffer(url), caption: `📸 ${target.split('@')[0]}` });
        }
        catch (error) {
            await logError('pp', 'Profile picture download failed', {
                detail: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply(ctx.t('pp.failed'));
        }
    },
};
const react = {
    name: 'react',
    category: 'general',
    description: 'React with an emoji to the message you reply to.',
    usage: 'react 😀  (reply to a message)',
    inMenu: true,
    rateLimitSeconds: 3,
    async execute(ctx) {
        const key = quotedKey(ctx);
        if (!key) {
            await ctx.reply(ctx.t('react.needQuote', { prefix: ctx.prefix }));
            return;
        }
        const emoji = ctx.fullArgs.trim() || '👍';
        try {
            await whatsapp.socket?.sendMessage(ctx.chatJid, { react: { key, text: emoji } });
        }
        catch {
            await ctx.reply(ctx.t('group.actionFailed'));
        }
    },
};
const poll = {
    name: 'poll',
    category: 'general',
    description: 'Create a poll: poll Question | option | option',
    usage: 'poll <question> | <option> | <option>',
    inMenu: true,
    rateLimitSeconds: 15,
    async execute(ctx) {
        const raw = ctx.fullArgs.trim();
        if (!raw.includes('|')) {
            await ctx.reply(ctx.t('poll.needArgs', { prefix: ctx.prefix }));
            return;
        }
        const [question, ...options] = raw.split('|').map((part) => part.trim()).filter(Boolean);
        if (!question || options.length < 2) {
            await ctx.reply(ctx.t('poll.tooFew'));
            return;
        }
        try {
            await whatsapp.socket?.sendMessage(ctx.chatJid, {
                poll: { name: question.slice(0, 256), values: options.slice(0, 12), selectableCount: 1 },
            });
        }
        catch {
            await ctx.reply(ctx.t('group.actionFailed'));
        }
    },
};
const del = {
    name: 'del',
    category: 'group',
    description: 'Delete the message you reply to (admin only).',
    usage: 'del  (reply to the message)',
    groupOnly: true,
    adminOnly: true,
    inMenu: true,
    async execute(ctx) {
        const key = quotedKey(ctx);
        if (!key) {
            await ctx.reply(ctx.t('del.needQuote', { prefix: ctx.prefix }));
            return;
        }
        if (!key.fromMe && !(await ctx.isBotAdmin())) {
            await ctx.reply(ctx.t('group.needBotAdmin'));
            return;
        }
        try {
            await whatsapp.socket?.sendMessage(ctx.chatJid, { delete: key });
        }
        catch {
            await ctx.reply(ctx.t('del.failed'));
        }
    },
};
const EPHEMERAL_SECONDS = {
    off: 0,
    '24h': 86_400,
    day: 86_400,
    '7d': 604_800,
    week: 604_800,
    '90d': 7_776_000,
};
const ephemeral = {
    name: 'ephemeral',
    category: 'group',
    description: 'Turn disappearing messages on or off: ephemeral <off|24h|7d|90d>',
    usage: 'ephemeral <off|24h|7d|90d>',
    groupOnly: true,
    adminOnly: true,
    inMenu: true,
    async execute(ctx) {
        if (!(await ctx.isBotAdmin())) {
            await ctx.reply(ctx.t('group.needBotAdmin'));
            return;
        }
        const value = ctx.args[0]?.toLowerCase() ?? '';
        const seconds = EPHEMERAL_SECONDS[value];
        if (seconds === undefined) {
            await ctx.reply(ctx.t('ephemeral.invalid', { prefix: ctx.prefix }));
            return;
        }
        try {
            await whatsapp.socket?.groupToggleEphemeral(ctx.groupJid, seconds);
            await ctx.reply(seconds === 0 ? ctx.t('ephemeral.off') : ctx.t('ephemeral.set', { value }));
        }
        catch {
            await ctx.reply(ctx.t('group.actionFailed'));
        }
    },
};
const tagadmin = {
    name: 'tagadmin',
    category: 'group',
    description: 'Mention every admin of this group.',
    usage: 'tagadmin',
    groupOnly: true,
    inMenu: true,
    rateLimitSeconds: 30,
    async execute(ctx) {
        const sock = whatsapp.socket;
        if (!sock || !ctx.groupJid)
            return;
        const meta = await sock.groupMetadata(ctx.groupJid);
        const admins = meta.participants.filter((p) => p.admin);
        if (!admins.length) {
            await ctx.reply(ctx.t('group.noAdmins'));
            return;
        }
        await ctx.reply([ctx.t('group.admins'), ...admins.map((p) => `@${p.id.split('@')[0]}`)].join('\n'), { mentions: admins.map((p) => p.id) });
    },
};
const hidetag = {
    name: 'hidetag',
    category: 'group',
    description: 'Mention the whole group without listing the numbers.',
    usage: 'hidetag <message>',
    groupOnly: true,
    adminOnly: true,
    inMenu: true,
    rateLimitSeconds: 30,
    async execute(ctx) {
        const sock = whatsapp.socket;
        if (!sock || !ctx.groupJid)
            return;
        const note = ctx.fullArgs.trim();
        if (!note) {
            await ctx.reply(ctx.t('error.noText'));
            return;
        }
        const meta = await sock.groupMetadata(ctx.groupJid);
        await sock.sendMessage(ctx.chatJid, {
            text: note,
            mentions: meta.participants.map((p) => p.id),
        });
    },
};
const toaudio = {
    name: 'toaudio',
    category: 'media',
    description: 'Extract the sound from a video as an mp3.',
    usage: 'toaudio  (reply to a video or audio message)',
    aliases: ['mp3', 'yta'],
    inMenu: true,
    rateLimitSeconds: 20,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type === 'image' || media.type === 'sticker') {
            await ctx.reply(ctx.t('media.needMedia', { prefix: ctx.prefix, command: 'toaudio' }));
            return;
        }
        try {
            await ctx.sendMedia({ audio: await extractAudio(media.buffer), mimetype: 'audio/mpeg' });
        }
        catch {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const vn = {
    name: 'vn',
    category: 'media',
    description: 'Send any audio or video as a voice note.',
    usage: 'vn  (reply to audio or video)',
    aliases: ['voice', 'tovoice'],
    inMenu: true,
    rateLimitSeconds: 20,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type === 'image' || media.type === 'sticker') {
            await ctx.reply(ctx.t('media.needMedia', { prefix: ctx.prefix, command: 'vn' }));
            return;
        }
        try {
            await ctx.sendMedia({
                audio: await toVoiceNote(media.buffer),
                ptt: true,
                mimetype: 'audio/ogg; codecs=opus',
            });
        }
        catch {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const togif = {
    name: 'togif',
    category: 'media',
    description: 'Turn a video or animated sticker into a GIF.',
    usage: 'togif  (reply to a video or animated sticker)',
    inMenu: true,
    rateLimitSeconds: 20,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || (media.type !== 'video' && media.type !== 'sticker')) {
            await ctx.reply(ctx.t('media.needMedia', { prefix: ctx.prefix, command: 'togif' }));
            return;
        }
        try {
            await ctx.sendMedia({ image: await toGif(media.buffer) });
        }
        catch {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const groups = {
    name: 'groups',
    category: 'owner',
    description: 'List the groups this bot belongs to.',
    usage: 'groups',
    ownerOnly: true,
    inMenu: false,
    async execute(ctx) {
        const sock = whatsapp.socket;
        if (!sock)
            return;
        const all = Object.values(await sock.groupFetchAllParticipating());
        if (!all.length) {
            await ctx.reply(ctx.t('groups.empty'));
            return;
        }
        all.sort((a, b) => b.participants.length - a.participants.length);
        const shown = all.slice(0, 25);
        await ctx.reply([
            ctx.t('groups.title', { count: all.length }),
            ...shown.map((g, i) => `${i + 1}. ${g.subject || g.id.split('@')[0]} — ${g.participants.length}`),
            all.length > shown.length ? `… +${all.length - shown.length}` : '',
        ]
            .filter(Boolean)
            .join('\n'));
    },
};
const setpp = {
    name: 'setpp',
    category: 'owner',
    description: 'Set the bot’s own profile picture from an image.',
    usage: 'setpp  (send with a photo, or reply to one)',
    ownerOnly: true,
    inMenu: false,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type !== 'image') {
            await ctx.reply(ctx.t('media.needMedia', { prefix: ctx.prefix, command: 'setpp' }));
            return;
        }
        const sock = whatsapp.socket;
        if (!sock || !whatsapp.selfJid) {
            await ctx.reply(ctx.t('app.offline'));
            return;
        }
        try {
            await sock.updateProfilePicture(whatsapp.selfJid, media.buffer);
            await ctx.reply(ctx.t('setpp.done'));
        }
        catch (error) {
            await logError('setpp', 'Profile picture update failed', {
                detail: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply(ctx.t('setpp.failed'));
        }
    },
};
const leave = {
    name: 'leave',
    category: 'owner',
    description: 'Leave a group by its JID.',
    usage: 'leave <groupJid>',
    ownerOnly: true,
    inMenu: false,
    async execute(ctx) {
        const jid = ctx.args[0]?.trim();
        const self = whatsapp.selfJid;
        if (!/@g\.us$/.test(jid ?? '') || !self) {
            await ctx.reply(ctx.t('error.notFound'));
            return;
        }
        try {
            await whatsapp.socket?.groupParticipantsUpdate(jid, [self], 'remove');
            invalidateGroupCache(jid);
            await ctx.reply(ctx.t('group.removed'));
        }
        catch {
            await ctx.reply(ctx.t('group.actionFailed'));
        }
    },
};
const setlogo = {
    name: 'setlogo',
    category: 'owner',
    description: 'Set the banner image the menu is sent with.',
    usage: 'setlogo  (send with a photo, or reply to one)',
    ownerOnly: true,
    inMenu: false,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        const mime = media ? imageFormat(media.buffer) : null;
        if (!media || !mime) {
            await ctx.reply(ctx.t('setlogo.needImage', { prefix: ctx.prefix }));
            return;
        }
        if (media.buffer.length > LOGO_MAX_BYTES) {
            await ctx.reply(ctx.t('setlogo.tooBig', { mb: Math.round(LOGO_MAX_BYTES / 1024 / 1024) }));
            return;
        }
        try {
            await setLogo(media.buffer, mime);
            await ctx.reply(ctx.t('setlogo.done'));
        }
        catch (error) {
            await logError('setlogo', 'Brand image update failed', {
                detail: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply(ctx.t('setlogo.failed'));
        }
    },
};
const dellogo = {
    name: 'dellogo',
    category: 'owner',
    description: 'Remove the menu banner and go back to the text menu.',
    usage: 'dellogo',
    ownerOnly: true,
    inMenu: false,
    async execute(ctx) {
        await clearLogo();
        await ctx.reply(ctx.t('setlogo.removed'));
    },
};
export const extraCommands = [
    pp,
    react,
    poll,
    del,
    ephemeral,
    tagadmin,
    hidetag,
    toaudio,
    vn,
    togif,
    groups,
    setpp,
    leave,
    setlogo,
    dellogo,
];
//# sourceMappingURL=extras.js.map