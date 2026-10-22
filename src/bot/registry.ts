import type { Command, CommandCategory } from '../types.js';

const byName = new Map<string, Command>();
const byAlias = new Map<string, string>();

export function registerCommand(command: Command): void {
  if (byName.has(command.name)) {
    throw new Error(`Command "${command.name}" is already registered`);
  }
  byName.set(command.name, command);
  for (const alias of command.aliases ?? []) byAlias.set(alias, command.name);
}

export function resolveCommand(name: string): Command | undefined {
  return byName.get(name) ?? byName.get(byAlias.get(name) ?? '');
}

export function allCommands(): Command[] {
  return [...byName.values()];
}

export function menuCommands(): Command[] {
  return allCommands().filter((c) => c.inMenu);
}

export const CATEGORY_ORDER: CommandCategory[] = ['topup', 'general', 'ai', 'media', 'group', 'tools', 'utility', 'owner'];

export function byCategory(category: CommandCategory): Command[] {
  return allCommands().filter((c) => c.category === category && c.inMenu);
}
