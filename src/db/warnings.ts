import { prisma } from './client.js';
import type { Warning } from '../types.js';

export async function addWarning(
  groupJid: string,
  userJid: string,
  reason: string,
  issuedBy: string,
): Promise<Warning> {
  return prisma.warning.create({ data: { groupJid, userJid, reason, issuedBy } });
}

export async function activeWarningCount(groupJid: string, userJid: string): Promise<number> {
  return prisma.warning.count({ where: { groupJid, userJid, revoked: false } });
}

export async function listWarnings(groupJid: string, userJid: string): Promise<Warning[]> {
  return prisma.warning.findMany({ where: { groupJid, userJid, revoked: false }, orderBy: { createdAt: 'asc' } });
}

export async function clearWarnings(groupJid: string, userJid: string): Promise<number> {
  const result = await prisma.warning.updateMany({ where: { groupJid, userJid }, data: { revoked: true } });
  return result.count;
}
