import { prisma } from './client.js';
import { currentInstance } from '../lib/scope.js';
import type { Language, User } from '../types.js';

const key = (jid: string) => ({ jid_instance: { jid, instance: currentInstance() } });

/** Tracks the minimum needed to answer commands: identity, language, counters. */
export async function touchUser(jid: string, name: string | null, countMessage = true): Promise<User> {
  return prisma.user.upsert({
    where: key(jid),
    create: {
      jid,
      waId: jid.split(':')[0] ?? null,
      name,
      messageCount: countMessage ? 1 : 0,
      lastSeen: new Date(),
    },
    update: {
      ...(name ? { name } : {}),
      lastSeen: new Date(),
      ...(countMessage ? { messageCount: { increment: 1 } } : {}),
    },
  });
}

export async function getUser(jid: string): Promise<User | null> {
  return prisma.user.findUnique({ where: key(jid) });
}

export async function setUserLanguage(jid: string, language: Language): Promise<void> {
  await prisma.user.upsert({
    where: key(jid),
    create: { jid, language },
    update: { language },
  });
}

export async function setUserBlocked(jid: string, blocked: boolean, name: string | null = null): Promise<void> {
  await prisma.user.upsert({
    where: key(jid),
    create: { jid, blocked, name },
    update: { blocked, ...(name ? { name } : {}) },
  });
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}
