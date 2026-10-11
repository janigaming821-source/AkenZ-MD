const byName = new Map();
const byAlias = new Map();
export function registerCommand(command) {
    if (byName.has(command.name)) {
        throw new Error(`Command "${command.name}" is already registered`);
    }
    byName.set(command.name, command);
    for (const alias of command.aliases ?? [])
        byAlias.set(alias, command.name);
}
export function resolveCommand(name) {
    return byName.get(name) ?? byName.get(byAlias.get(name) ?? '');
}
export function allCommands() {
    return [...byName.values()];
}
export function menuCommands() {
    return allCommands().filter((c) => c.inMenu);
}
export const CATEGORY_ORDER = ['general', 'ai', 'media', 'group', 'tools', 'utility', 'owner'];
export function byCategory(category) {
    return allCommands().filter((c) => c.category === category && c.inMenu);
}
//# sourceMappingURL=registry.js.map