import { prisma } from './client.js';
export async function recordActivity(chatJid, isGroup, command) {
    await prisma.messageStat.create({ data: { chatJid, isGroup, command: command ?? null } });
}
export async function getStats() {
    const [users, groups, messages, commands, autoReplies, customCommands, warnings, scheduled, media] = await Promise.all([
        prisma.user.count(),
        prisma.group.count(),
        prisma.messageStat.count(),
        prisma.messageStat.count({ where: { command: { not: null } } }),
        prisma.autoReply.count(),
        prisma.customCommand.count(),
        prisma.warning.count({ where: { revoked: false } }),
        prisma.scheduledTask.count({ where: { status: 'pending' } }),
        prisma.mediaHistory.count(),
    ]);
    return { users, groups, messages, commands, autoReplies, customCommands, warnings, scheduled, media };
}
//# sourceMappingURL=stats.js.map