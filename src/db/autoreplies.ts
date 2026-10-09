import { prisma } from './client.js';
import type { AutoReply } from '../types.js';

export type MatchType = 'exact' | 'contains';

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Split "hello, hi, ආයුබෝවන්" into separate triggers. */
export function splitTriggers(input: string): string[] {
  return input
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function addAutoReply(triggers: string[], response: string, matchType: MatchType): Promise<AutoReply> {
  return prisma.autoReply.create({
    data: { triggers: triggers.map(normalize).join(','), response, matchType },
  });
}

export async function listAutoReplies(): Promise<AutoReply[]> {
  return prisma.autoReply.findMany({ orderBy: { id: 'asc' } });
}

export async function deleteAutoReply(id: number): Promise<boolean> {
  const found = await prisma.autoReply.findUnique({ where: { id } });
  if (!found) return false;
  await prisma.autoReply.delete({ where: { id } });
  return true;
}

export async function setAutoReplyEnabled(id: number, enabled: boolean): Promise<boolean> {
  const found = await prisma.autoReply.findUnique({ where: { id } });
  if (!found) return false;
  await prisma.autoReply.update({ where: { id }, data: { enabled } });
  return true;
}

/** Case-insensitive exact → contains, first match wins. */
export async function matchAutoReply(text: string): Promise<AutoReply | null> {
  const incoming = normalize(text);
  if (!incoming) return null;
  const rows = await prisma.autoReply.findMany({ where: { enabled: true } });
  for (const row of rows) {
    const triggers = row.triggers.split(',').map((t) => normalize(t));
    if (row.matchType === 'exact' && triggers.includes(incoming)) return row;
  }
  for (const row of rows) {
    const triggers = row.triggers.split(',').map((t) => normalize(t));
    if (row.matchType === 'contains' && triggers.some((t) => t && incoming.includes(t))) return row;
  }
  return null;
}
