import { prisma } from './client.js';
import { currentInstance } from '../lib/scope.js';
import type { GroupSettings } from '../types.js';

const key = (groupJid: string) => ({ groupJid_instance: { groupJid, instance: currentInstance() } });

export async function upsertGroup(jid: string, name: string | null, memberCount = 0): Promise<void> {
  await prisma.group.upsert({
    where: { jid },
    create: { jid, name, memberCount },
    update: { ...(name ? { name } : {}), memberCount },
  });
}

export async function getGroupSettings(groupJid: string): Promise<GroupSettings> {
  const existing = await prisma.groupSettings.findUnique({ where: key(groupJid) });
  if (existing) return existing;
  return prisma.groupSettings.create({ data: { groupJid } });
}

export async function updateGroupSettings(
  groupJid: string,
  patch: Partial<Omit<GroupSettings, 'id' | 'groupJid' | 'createdAt' | 'updatedAt'>>,
): Promise<GroupSettings> {
  await getGroupSettings(groupJid);
  return prisma.groupSettings.update({ where: key(groupJid), data: patch });
}

export async function countGroups(): Promise<number> {
  return prisma.groupSettings.count();
}
