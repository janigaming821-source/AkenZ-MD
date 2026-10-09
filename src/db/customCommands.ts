import { prisma } from './client.js';
import type { CustomCommand } from '../types.js';

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

export const isReservedName = (name: string) => RESERVED.has(name.toLowerCase());

export async function addCustomCommand(
  name: string,
  response: string,
  createdBy: string,
  mediaUrl?: string | null,
): Promise<CustomCommand> {
  return prisma.customCommand.create({
    data: { name: name.toLowerCase(), response, createdBy, mediaUrl: mediaUrl ?? null },
  });
}

export async function getCustomCommand(name: string): Promise<CustomCommand | null> {
  return prisma.customCommand.findUnique({ where: { name: name.toLowerCase() } });
}

export async function deleteCustomCommand(name: string): Promise<CustomCommand | null> {
  const found = await getCustomCommand(name);
  if (!found) return null;
  await prisma.customCommand.delete({ where: { id: found.id } });
  return found;
}

export async function listCustomCommands(): Promise<CustomCommand[]> {
  return prisma.customCommand.findMany({ orderBy: { name: 'asc' } });
}
