import { prisma } from './client.js';
/** Tracks the minimum needed to answer commands: identity, language, counters. */
export async function touchUser(jid, name, countMessage = true) {
    return prisma.user.upsert({
        where: { jid },
        create: {
            jid,
            waId: jid.split(':')[0] ?? null,
            name,
            messageCount: countMessage ? 1 : 0,
            lastSeen: new Date(),
        },
        update: {
            ...(name ? { name } : {}),
            lastSeen: new Date(),
            ...(countMessage ? { messageCount: { increment: 1 } } : {}),
        },
    });
}
export async function getUser(jid) {
    return prisma.user.findUnique({ where: { jid } });
}
export async function setUserLanguage(jid, language) {
    await prisma.user.upsert({
        where: { jid },
        create: { jid, language },
        update: { language },
    });
}
export async function setUserBlocked(jid, blocked, name = null) {
    await prisma.user.upsert({
        where: { jid },
        create: { jid, blocked, name },
        update: { blocked, ...(name ? { name } : {}) },
    });
}
export async function countUsers() {
    return prisma.user.count();
}
//# sourceMappingURL=users.js.map