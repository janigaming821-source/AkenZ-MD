import { prisma } from './client.js';
const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');
/** Split "hello, hi, ආයුබෝවන්" into separate triggers. */
export function splitTriggers(input) {
    return input
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean);
}
export async function addAutoReply(triggers, response, matchType) {
    return prisma.autoReply.create({
        data: { triggers: triggers.map(normalize).join(','), response, matchType },
    });
}
export async function listAutoReplies() {
    return prisma.autoReply.findMany({ orderBy: { id: 'asc' } });
}
export async function deleteAutoReply(id) {
    const found = await prisma.autoReply.findUnique({ where: { id } });
    if (!found)
        return false;
    await prisma.autoReply.delete({ where: { id } });
    return true;
}
export async function setAutoReplyEnabled(id, enabled) {
    const found = await prisma.autoReply.findUnique({ where: { id } });
    if (!found)
        return false;
    await prisma.autoReply.update({ where: { id }, data: { enabled } });
    return true;
}
/** Case-insensitive exact → contains, first match wins. */
export async function matchAutoReply(text) {
    const incoming = normalize(text);
    if (!incoming)
        return null;
    const rows = await prisma.autoReply.findMany({ where: { enabled: true } });
    for (const row of rows) {
        const triggers = row.triggers.split(',').map((t) => normalize(t));
        if (row.matchType === 'exact' && triggers.includes(incoming))
            return row;
    }
    for (const row of rows) {
        const triggers = row.triggers.split(',').map((t) => normalize(t));
        if (row.matchType === 'contains' && triggers.some((t) => t && incoming.includes(t)))
            return row;
    }
    return null;
}
//# sourceMappingURL=autoreplies.js.map