import { prisma } from './client.js';
export async function upsertGroup(jid, name, memberCount = 0) {
    await prisma.group.upsert({
        where: { jid },
        create: { jid, name, memberCount },
        update: { ...(name ? { name } : {}), memberCount },
    });
}
export async function getGroupSettings(groupJid) {
    const existing = await prisma.groupSettings.findUnique({ where: { groupJid } });
    if (existing)
        return existing;
    return prisma.groupSettings.create({ data: { groupJid } });
}
export async function updateGroupSettings(groupJid, patch) {
    await getGroupSettings(groupJid);
    return prisma.groupSettings.update({ where: { groupJid }, data: patch });
}
export async function countGroups() {
    return prisma.group.count();
}
//# sourceMappingURL=groups.js.map