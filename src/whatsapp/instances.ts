import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';
import { logError, logInfo } from '../db/botLog.js';
import { OWNER_INSTANCE, runInInstance } from '../lib/scope.js';
import { EncryptedAuthState } from './auth-store.js';
import { allClients, clientFor, dropClient } from './client.js';

const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

export const isExpired = (row: { id: number; expiresAt: Date | null }): boolean =>
  row.id !== OWNER_INSTANCE && row.expiresAt !== null && row.expiresAt.getTime() < Date.now();

function startInstance(id: number): void {
  runInInstance(id, () => {
    void clientFor(id).start().catch((error) =>
      logError('whatsapp', 'WhatsApp could not start', { detail: error instanceof Error ? error.message : String(error) }),
    );
  });
}

/**
 * The owner's bot always starts. A buyer's bot only starts once it has a paired
 * session: an unlinked one would otherwise cycle QR sockets all day for nobody.
 */
export async function startAllInstances(): Promise<number> {
  startInstance(OWNER_INSTANCE);
  const buyers = await prisma.botConfig.findMany({ where: { id: { not: OWNER_INSTANCE } } });
  let started = 1;
  for (const row of buyers) {
    if (isExpired(row) || !(await EncryptedAuthState.isPaired(row.id))) continue;
    startInstance(row.id);
    started += 1;
  }
  return started;
}

/** Instance a shop key unlocks, or null. Keys are stored only as hashes. */
export async function instanceForKey(key: string): Promise<number | null> {
  if (!key) return null;
  const row = await prisma.botConfig.findFirst({ where: { apiKey: hashKey(key) }, select: { id: true, expiresAt: true } });
  if (!row || isExpired(row)) return null;
  return row.id;
}

export interface ProvisionInput {
  label: string;
  ownerNumber: string;
  name?: string;
  plan?: string;
  expiresAt?: Date | null;
}

/** Creates a buyer's bot. The plaintext key is returned once and never stored. */
export async function provisionInstance(input: ProvisionInput): Promise<{ instance: number; apiKey: string }> {
  const apiKey = randomBytes(32).toString('hex');
  const owner = await prisma.botConfig.findUnique({ where: { id: OWNER_INSTANCE } });
  const row = await prisma.botConfig.create({
    data: {
      label: input.label.slice(0, 80),
      plan: input.plan?.slice(0, 40) ?? null,
      expiresAt: input.expiresAt ?? null,
      apiKey: hashKey(apiKey),
      ownerNumber: input.ownerNumber,
      name: (input.name || 'AkenZ MD').slice(0, 60),
      statusText: (input.name || 'AkenZ MD').slice(0, 60),
      version: owner?.version ?? '1.0.0',
      aiEnabled: owner?.aiEnabled ?? false,
      mediaEnabled: owner?.mediaEnabled ?? true,
    },
  });
  await logInfo('instances', 'Buyer bot created', { instance: row.id });
  return { instance: row.id, apiKey };
}

export async function updateInstance(id: number, patch: { plan?: string; expiresAt?: Date | null; label?: string }): Promise<boolean> {
  if (id === OWNER_INSTANCE) return false;
  const found = await prisma.botConfig.findUnique({ where: { id } });
  if (!found) return false;
  await prisma.botConfig.update({ where: { id }, data: patch });
  if (patch.expiresAt && patch.expiresAt.getTime() < Date.now()) await dropClient(id);
  return true;
}

/** Unlinks and deletes a buyer's bot. The owner's bot can never be removed here. */
export async function removeInstance(id: number): Promise<boolean> {
  if (id === OWNER_INSTANCE) return false;
  const found = await prisma.botConfig.findUnique({ where: { id } });
  if (!found) return false;
  await runInInstance(id, async () => {
    const client = clientFor(id);
    if (client.isConnected) await client.logout().catch(() => {});
  });
  await dropClient(id);
  await EncryptedAuthState.wipe(id);
  await prisma.botConfig.delete({ where: { id } });
  await logInfo('instances', 'Buyer bot removed', { instance: id });
  return true;
}

export async function listInstances() {
  const rows = await prisma.botConfig.findMany({
    select: { id: true, label: true, name: true, plan: true, expiresAt: true, ownerNumber: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  const live = new Map(allClients().map((c) => [c.instance, c.conn.get()]));
  return rows.map((row) => {
    const state = live.get(row.id);
    return {
      ...row,
      expired: isExpired(row),
      status: state?.status ?? 'disconnected',
      selfJid: state?.selfJid ?? null,
    };
  });
}

/** Expired buyer bots are switched off; checked from the scheduler tick. */
export async function stopExpiredInstances(): Promise<void> {
  const ids = allClients().map((c) => c.instance).filter((id) => id !== OWNER_INSTANCE);
  if (!ids.length) return;
  const rows = await prisma.botConfig.findMany({ where: { id: { in: ids } }, select: { id: true, expiresAt: true } });
  const known = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!known.has(id) || (row && isExpired(row))) await dropClient(id);
  }
}
