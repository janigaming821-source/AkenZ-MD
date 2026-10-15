import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/env.js';
import { prisma } from '../db/client.js';
import { setPrefix, updateConfig } from '../db/config.js';
import { addAutoReply, deleteAutoReply, listAutoReplies, splitTriggers } from '../db/autoreplies.js';
import { addCustomCommand, deleteCustomCommand, getCustomCommand, isReservedName, listCustomCommands } from '../db/customCommands.js';
import { countUsers, setUserBlocked } from '../db/users.js';
import { getStats } from '../db/stats.js';
import { logInfo } from '../db/botLog.js';
import { formatBytes, formatDateTime } from './format.js';
import { whatsapp } from '../whatsapp/client.js';
import { resolveTargetJid } from '../bot/targets.js';
import { currentInstance, OWNER_INSTANCE } from '../lib/scope.js';
const BROADCAST_MAX = 100;
const BROADCAST_DELAY_MS = 900;
/** Distinct chats that have actually spoken to the bot in the last 7 days. */
async function recentChats() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await prisma.messageStat.findMany({
        where: { createdAt: { gte: since } },
        distinct: ['chatJid'],
        select: { chatJid: true },
    });
    return rows.map((r) => r.chatJid);
}
const broadcast = {
    name: 'broadcast',
    category: 'owner',
    description: 'Send a notice to chats that messaged the bot in the last 7 days (max 100).',
    usage: 'broadcast <message>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const message = ctx.fullArgs.trim();
        if (!message) {
            await ctx.reply(ctx.t('error.noText'));
            return;
        }
        const targets = await recentChats();
        if (!targets.length) {
            await ctx.reply('No chats to send to yet. The broadcast list only contains people who messaged the bot in the last 7 days.');
            return;
        }
        const slice = targets.slice(0, BROADCAST_MAX);
        await ctx.reply(`📣 Sending to ${slice.length} chat(s). Started by owner.`);
        let sent = 0;
        let failed = 0;
        for (const jid of slice) {
            try {
                await whatsapp.sendText(jid, `📣 ${message}`);
                sent += 1;
                await new Promise((r) => setTimeout(r, BROADCAST_DELAY_MS));
            }
            catch {
                failed += 1;
            }
        }
        await logInfo('owner', 'Broadcast finished', { recipients: sent });
        await ctx.reply(`✅ Broadcast done: ${sent} sent${failed ? `, ${failed} failed` : ''}.`);
    },
};
const restart = {
    name: 'restart',
    category: 'owner',
    description: 'Reconnect the WhatsApp session (process restart still needs your supervisor).',
    usage: 'restart',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        await ctx.reply(ctx.t('restart'));
        await logInfo('owner', 'Owner requested a session restart');
        setTimeout(async () => {
            try {
                await whatsapp.reconnect();
            }
            catch {
                /* reconnect logs its own failures */
            }
        }, 500);
    },
};
const shutdown = {
    name: 'shutdown',
    category: 'owner',
    description: 'Stop the bot process.',
    usage: 'shutdown',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        await ctx.reply(ctx.t('shutdown'));
        await logInfo('owner', 'Owner shut the bot down');
        setTimeout(async () => {
            await whatsapp.disconnect().catch(() => undefined);
            // A buyer's .shutdown may only stop their own bot; the process runs many.
            if (currentInstance() !== OWNER_INSTANCE)
                return;
            process.exit(0);
        }, 800);
    },
};
const setprefix = {
    name: 'setprefix',
    category: 'owner',
    description: 'Change the command prefix (. ! / #).',
    usage: 'setprefix <char>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        try {
            const next = await setPrefix(ctx.args[0] ?? '');
            await ctx.reply(ctx.t('prefix.changed', { prefix: next.prefix }));
        }
        catch (error) {
            await ctx.reply(error instanceof Error ? `❌ ${error.message}` : ctx.t('error.generic'));
        }
    },
};
const setname = {
    name: 'setname',
    category: 'owner',
    description: 'Change the bot name (also updates the WhatsApp account name).',
    usage: 'setname <new name>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const name = ctx.fullArgs.trim().slice(0, 50);
        if (!name)
            return ctx.reply(ctx.t('error.noText'));
        await updateConfig({ name });
        try {
            await whatsapp.socket?.updateProfileName(name);
        }
        catch {
            await ctx.reply('Bot name saved. WhatsApp refused the account name change.');
            return;
        }
        await ctx.reply(ctx.t('name.changed', { name }));
    },
};
const setbio = {
    name: 'setbio',
    category: 'owner',
    description: 'Set the status text the bot shows in .status (WhatsApp Web no longer exposes the About field).',
    usage: 'setbio <text>',
    ownerOnly: true,
    inMenu: true,
    aliases: ['setstatus'],
    async execute(ctx) {
        const text = ctx.fullArgs.trim();
        if (!text)
            return ctx.reply(ctx.t('error.noText'));
        if (text.length > 120)
            return ctx.reply(ctx.t('setbio.tooLong'));
        await updateConfig({ statusText: text });
        await ctx.reply(ctx.t('bio.changed'));
    },
};
const autoreply = {
    name: 'autoreply',
    category: 'owner',
    description: 'Manage auto replies: add|list|delete|enable|disable|on|off',
    usage: 'autoreply add <trigger> => <response>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        const rest = ctx.fullArgs.replace(/^\S+\s*/, '');
        if (sub === 'on' || sub === 'off') {
            await updateConfig({ autoReplyEnabled: sub === 'on' });
            return ctx.reply(ctx.t(sub === 'on' ? 'autoreply.on' : 'autoreply.off'));
        }
        if (sub === 'list') {
            const rows = await listAutoReplies();
            if (!rows.length)
                return ctx.reply(ctx.t('autoreply.empty'));
            return ctx.reply([
                ctx.t('autoreply.list', { count: rows.length }),
                ...rows.map((r) => ctx.t('autoreply.row', {
                    id: r.id,
                    trigger: r.triggers.replaceAll(',', ', '),
                    response: r.response.length > 60 ? `${r.response.slice(0, 57)}…` : r.response,
                })),
            ].join('\n'));
        }
        if (sub === 'delete') {
            const id = Number.parseInt(ctx.args[1] ?? '', 10);
            const removed = Number.isFinite(id) && (await deleteAutoReply(id));
            return ctx.reply(removed ? ctx.t('autoreply.deleted', { id }) : ctx.t('autoreply.notFound'));
        }
        if (sub === 'enable' || sub === 'disable') {
            const id = Number.parseInt(ctx.args[1] ?? '', 10);
            const found = await prisma.autoReply.findUnique({ where: { id } });
            if (!found)
                return ctx.reply(ctx.t('autoreply.notFound'));
            await prisma.autoReply.update({ where: { id }, data: { enabled: sub === 'enable' } });
            await ctx.reply(ctx.t(sub === 'enable' ? 'autoreply.enabledRow' : 'autoreply.disabledRow', { id }));
        }
        if (sub === 'add') {
            const [triggerPart, responsePart] = rest.split(/\s=>\s|\s->\s/);
            if (!triggerPart || !responsePart) {
                await ctx.reply(ctx.t('autoreply.syntax', { p: ctx.prefix }));
                return;
            }
            const triggers = splitTriggers(triggerPart);
            if (!triggers.length)
                return ctx.reply(ctx.t('error.noText'));
            const matchType = triggers.some((t) => t.endsWith('*')) ? 'contains' : 'exact';
            const cleaned = triggers.map((t) => t.replace(/\*$/, '').trim()).filter(Boolean);
            const created = await addAutoReply(cleaned, responsePart.trim().slice(0, 1000), matchType);
            return ctx.reply(ctx.t('autoreply.added', { id: created.id }));
        }
        await ctx.reply(ctx.t('help.usage', { usage: `${ctx.prefix}autoreply <add|list|delete|enable|disable|on|off>` }));
    },
};
const addcmd = {
    name: 'addcmd',
    category: 'owner',
    description: 'Create a custom command: addcmd <name> <response>',
    usage: 'addcmd <name> <response>',
    ownerOnly: true,
    inMenu: true,
    aliases: ['setcmd'],
    async execute(ctx) {
        const name = (ctx.args[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        const response = ctx.fullArgs.replace(/^\S+\s*/, '').trim();
        if (!name || !response) {
            await ctx.reply(ctx.t('cmd.syntax', { p: ctx.prefix }));
            return;
        }
        if (isReservedName(name))
            return ctx.reply(`\`${name}\` is a built-in command name.`);
        if (await getCustomCommand(name)) {
            return ctx.reply(ctx.t('cmd.exists', { name }));
        }
        await addCustomCommand(name, response.slice(0, 2000), ctx.senderJid);
        await ctx.reply(ctx.t('cmd.added', { name: `\`${ctx.prefix}${name}\`` }));
    },
};
const delcmd = {
    name: 'delcmd',
    category: 'owner',
    description: 'Delete a custom command.',
    usage: 'delcmd <name>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const name = (ctx.args[0] ?? '').toLowerCase();
        const removed = await deleteCustomCommand(name);
        await ctx.reply(removed ? ctx.t('cmd.deleted', { name }) : ctx.t('cmd.notFound', { name }));
    },
};
const listcmd = {
    name: 'listcmd',
    category: 'owner',
    description: 'List custom commands.',
    usage: 'listcmd',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const rows = await listCustomCommands();
        if (!rows.length)
            return ctx.reply(ctx.t('cmd.empty'));
        await ctx.reply([ctx.t('cmd.list', { count: rows.length }), ...rows.map((r) => `\`${ctx.prefix}${r.name}\` → ${r.response.slice(0, 70)}`)].join('\n'));
    },
};
const users = {
    name: 'users',
    category: 'owner',
    description: 'Count of tracked users and the most recent ones.',
    usage: 'users',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const total = await countUsers();
        const recent = await prisma.user.findMany({ orderBy: { lastSeen: 'desc' }, take: 10 });
        await ctx.reply([
            ctx.t('users.count', { count: total }),
            ...recent.map((u) => `• ${u.name ?? u.waId ?? u.jid.split('@')[0]} — ${formatDateTime(u.lastSeen, config.bot.timezone)}`),
        ].join('\n'));
    },
};
const stats = {
    name: 'stats',
    category: 'owner',
    description: 'Real counts from the database.',
    usage: 'stats',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const s = await getStats();
        await ctx.reply(ctx.t('stats', {
            users: s.users,
            groups: s.groups,
            messages: s.messages,
            commands: s.commands,
            autoreplies: s.autoReplies,
            commands2: s.customCommands,
        }));
    },
};
const block = {
    name: 'block',
    category: 'owner',
    description: 'Block a number (stops it messaging the bot).',
    usage: 'block @user|<number>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const target = await resolveTargetJid(ctx);
        if (!target)
            return ctx.reply(ctx.t('error.noText'));
        await whatsapp.socket?.updateBlockStatus(target, 'block');
        await setUserBlocked(target, true);
        await ctx.reply(ctx.t('blocked', { name: `@${target.split('@')[0]}` }));
    },
};
const unblock = {
    name: 'unblock',
    category: 'owner',
    description: 'Unblock a number.',
    usage: 'unblock @user|<number>',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const target = await resolveTargetJid(ctx);
        if (!target)
            return ctx.reply(ctx.t('error.noText'));
        await whatsapp.socket?.updateBlockStatus(target, 'unblock');
        await setUserBlocked(target, false);
        await ctx.reply(ctx.t('unblocked', { name: `@${target.split('@')[0]}` }));
    },
};
const ban = {
    name: 'ban',
    category: 'owner',
    description: 'Remove from this group and block the number.',
    usage: 'ban @user',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const target = await resolveTargetJid(ctx);
        if (!target)
            return ctx.reply(ctx.t('error.noText'));
        if (ctx.isGroup) {
            try {
                await whatsapp.socket?.groupParticipantsUpdate(ctx.groupJid, [target], 'remove');
            }
            catch {
                /* removal may be refused; blocking still applies */
            }
        }
        await whatsapp.socket?.updateBlockStatus(target, 'block');
        await setUserBlocked(target, true);
        await ctx.reply(ctx.t('banned', { name: `@${target.split('@')[0]}` }));
    },
};
const unban = {
    name: 'unban',
    category: 'owner',
    description: 'Undo a ban.',
    usage: 'unban @user',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const target = await resolveTargetJid(ctx);
        if (!target)
            return ctx.reply(ctx.t('error.noText'));
        await whatsapp.socket?.updateBlockStatus(target, 'unblock');
        await setUserBlocked(target, false);
        await ctx.reply(ctx.t('unblocked', { name: `@${target.split('@')[0]}` }));
    },
};
const reload = {
    name: 'reload',
    category: 'owner',
    description: 'Re-read settings, auto replies and custom commands from the database.',
    usage: 'reload',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        await updateConfig({});
        await ctx.reply(`${ctx.t('reload')} Built-in commands need a process restart to change; database-driven ones apply immediately.`);
    },
};
const backup = {
    name: 'backup',
    category: 'owner',
    description: 'Copy the SQLite database into data/backups.',
    usage: 'backup',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        if (!config.db.file) {
            await ctx.reply('Backup is only wired for the SQLite setup described in the README.');
            return;
        }
        const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
        const target = join(config.paths.dataDir, 'backups', `akenz-${stamp}.db`);
        await mkdir(join(config.paths.dataDir, 'backups'), { recursive: true });
        // Flush WAL pages first so the copied file is a consistent snapshot.
        // This PRAGMA returns a row, so it must go through queryRaw, not executeRaw.
        await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
        await copyFile(config.db.file, target);
        const { size } = await stat(target);
        await logInfo('owner', 'Database backup created');
        await ctx.reply(`${ctx.t('backup.started')}\n📁 ${target.replace(config.paths.dataDir, 'data/')}\n💾 ${formatBytes(size)}`);
    },
};
const database = {
    name: 'database',
    category: 'owner',
    description: 'Database file size and row counts.',
    usage: 'database',
    ownerOnly: true,
    inMenu: true,
    async execute(ctx) {
        const counts = await Promise.all([
            prisma.user.count(),
            prisma.groupSettings.count(),
            prisma.warning.count(),
            prisma.autoReply.count(),
            prisma.customCommand.count(),
            prisma.mediaHistory.count(),
            prisma.scheduledTask.count(),
            prisma.botLog.count(),
        ]);
        const size = config.db.file ? (await stat(config.db.file).catch(() => null))?.size ?? 0 : 0;
        await ctx.reply([
            `🗄 ${formatBytes(size)} — ${(config.db.file ?? '').replace(config.paths.dataDir, 'data/')}`,
            `Users ${counts[0]} · Groups ${counts[1]} · Warnings ${counts[2]} · Auto replies ${counts[3]}`,
            `Commands ${counts[4]} · Media ${counts[5]} · Schedules ${counts[6]} · Logs ${counts[7]}`,
        ].join('\n'));
    },
};
export const ownerCommands = [
    broadcast,
    restart,
    shutdown,
    setprefix,
    setname,
    setbio,
    autoreply,
    addcmd,
    delcmd,
    listcmd,
    users,
    stats,
    block,
    unblock,
    ban,
    unban,
    reload,
    backup,
    database,
];
//# sourceMappingURL=owner.js.map