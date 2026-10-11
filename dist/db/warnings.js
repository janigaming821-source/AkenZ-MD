import { prisma } from './client.js';
export async function addWarning(groupJid, userJid, reason, issuedBy) {
    return prisma.warning.create({ data: { groupJid, userJid, reason, issuedBy } });
}
export async function activeWarningCount(groupJid, userJid) {
    return prisma.warning.count({ where: { groupJid, userJid, revoked: false } });
}
export async function listWarnings(groupJid, userJid) {
    return prisma.warning.findMany({ where: { groupJid, userJid, revoked: false }, orderBy: { createdAt: 'asc' } });
}
export async function clearWarnings(groupJid, userJid) {
    const result = await prisma.warning.updateMany({ where: { groupJid, userJid }, data: { revoked: true } });
    return result.count;
}
//# sourceMappingURL=warnings.js.map