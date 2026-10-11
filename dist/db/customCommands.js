import { prisma } from './client.js';
const RESERVED = new Set([
    'help',
    'menu',
    'ping',
    'bot',
    'owner',
    'runtime',
    'speed',
    'status',
    'profile',
    'language',
    'settings',
    'addcmd',
    'delcmd',
    'listcmd',
    'autoreply',
    'broadcast',
    'restart',
    'shutdown',
    'eval',
    'exec',
    'setprefix',
    'setname',
    'setbio',
    'setstatus',
    'users',
    'stats',
    'ban',
    'unban',
    'block',
    'unblock',
    'reload',
    'backup',
    'database',
    'schedule',
    'schedules',
    'delschedule',
]);
export const isReservedName = (name) => RESERVED.has(name.toLowerCase());
export async function addCustomCommand(name, response, createdBy, mediaUrl) {
    return prisma.customCommand.create({
        data: { name: name.toLowerCase(), response, createdBy, mediaUrl: mediaUrl ?? null },
    });
}
export async function getCustomCommand(name) {
    return prisma.customCommand.findUnique({ where: { name: name.toLowerCase() } });
}
export async function deleteCustomCommand(name) {
    const found = await getCustomCommand(name);
    if (!found)
        return null;
    await prisma.customCommand.delete({ where: { id: found.id } });
    return found;
}
export async function listCustomCommands() {
    return prisma.customCommand.findMany({ orderBy: { name: 'asc' } });
}
//# sourceMappingURL=customCommands.js.map