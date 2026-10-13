import { prisma } from './client.js';
import { allCommands } from '../bot/registry.js';
/**
 * A custom command never overrides a built-in one, so a name the handler already
 * answers would sit in the database looking broken. Asking the registry keeps
 * this true as commands are added — the list it replaced was stale within a day.
 */
export const isReservedName = (name) => {
    const wanted = name.toLowerCase();
    return allCommands().some((c) => c.name === wanted || (c.aliases ?? []).includes(wanted));
};
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