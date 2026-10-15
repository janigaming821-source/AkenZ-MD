import { prisma } from './client.js';
import { currentInstance } from '../lib/scope.js';
const key = (groupJid) => ({ groupJid_instance: { groupJid, instance: currentInstance() } });
export async function upsertGroup(jid, name, memberCount = 0) {
    await prisma.group.upsert({
        where: { jid },
        create: { jid, name, memberCount },
        update: { ...(name ? { name } : {}), memberCount },
    });
}
export async function getGroupSettings(groupJid) {
    const existing = await prisma.groupSettings.findUnique({ where: key(groupJid) });
    if (existing)
        return existing;
    return prisma.groupSettings.create({ data: { groupJid } });
}
export async function updateGroupSettings(groupJid, patch) {
    await getGroupSettings(groupJid);
    return prisma.groupSettings.update({ where: key(groupJid), data: patch });
}
export async function countGroups() {
    return prisma.groupSettings.count();
}
//# sourceMappingURL=groups.js.map