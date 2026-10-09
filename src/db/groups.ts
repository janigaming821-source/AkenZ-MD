import { prisma } from './client.js';
import type { GroupSettings } from '../types.js';

export async function upsertGroup(jid: string, name: string | null, memberCount = 0): Promise<void> {
  await prisma.group.upsert({
    where: { jid },
    create: { jid, name, memberCount },
    update: { ...(name ? { name } : {}), memberCount },
  });
}

export async function getGroupSettings(groupJid: string): Promise<GroupSettings> {
  const existing = await prisma.groupSettings.findUnique({ where: { groupJid } });
  if (existing) return existing;
  return prisma.groupSettings.create({ data: { groupJid } });
}

export async function updateGroupSettings(
  groupJid: string,
  patch: Partial<Omit<GroupSettings, 'id' | 'groupJid' | 'createdAt' | 'updatedAt'>>,
): Promise<GroupSettings> {
  await getGroupSettings(groupJid);
  return prisma.groupSettings.update({ where: { groupJid }, data: patch });
}

export async function countGroups(): Promise<number> {
  return prisma.group.count();
}
