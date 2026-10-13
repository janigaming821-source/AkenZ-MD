import type { WASocket } from 'baileys';

const ADMIN_CACHE_MS = 30_000;
type RoleMap = { roles: Map<string, 'admin' | 'superadmin' | undefined>; at: number };
const roleCache = new Map<string, RoleMap>();

/** '94771234567:12@s.whatsapp.net' → '94771234567' */
export function userIdOf(jid: string): string {
  return jid.split(':')[0]?.split('@')[0] ?? jid;
}

/** Drops the device suffix so a stored address can be compared to a live JID. */
function withoutDevice(jid: string): string {
  return jid.replace(/:\d+@/, '@');
}

/**
 * Owner check. Compares the *sender JID that WhatsApp gave us* against the
 * identities configured on the server — never a display name or a client-supplied
 * flag.
 *
 * The JID comparison exists because 1:1 chats are now addressed by LID
 * (`148649053003791@lid`) instead of a phone number. Matching digits alone
 * silently locks the real owner out of their own bot.
 */
export function isOwner(
  jid: string | null | undefined,
  ownerNumber: string,
  ownerJid?: string,
): boolean {
  if (!jid) return false;
  const user = userIdOf(jid);
  if (!user) return false;
  if (ownerNumber && user === ownerNumber.replace(/[^\d]/g, '')) return true;
  return Boolean(ownerJid) && withoutDevice(jid) === withoutDevice(ownerJid ?? '');
}

async function loadRoles(sock: WASocket, groupJid: string): Promise<Map<string, 'admin' | 'superadmin' | undefined>> {
  const cached = roleCache.get(groupJid);
  if (cached && Date.now() - cached.at < ADMIN_CACHE_MS) return cached.roles;
  const meta = await sock.groupMetadata(groupJid);
  const roles = new Map<string, 'admin' | 'superadmin' | undefined>();
  for (const p of meta.participants) roles.set(p.id, p.admin ?? undefined);
  roleCache.set(groupJid, { roles, at: Date.now() });
  return roles;
}

export function invalidateGroupCache(groupJid?: string): void {
  if (groupJid) roleCache.delete(groupJid);
  else roleCache.clear();
}

export async function hasAdminRights(sock: WASocket, groupJid: string, senderJid: string): Promise<boolean> {
  try {
    const roles = await loadRoles(sock, groupJid);
    const role = roles.get(senderJid);
    return role === 'admin' || role === 'superadmin';
  } catch {
    return false;
  }
}

/** Does the bot itself have admin power in this group? */
export async function isBotAdmin(sock: WASocket, groupJid: string, selfJid: string | null): Promise<boolean> {
  if (!selfJid) return false;
  try {
    const roles = await loadRoles(sock, groupJid);
    const role = roles.get(selfJid);
    return role === 'admin' || role === 'superadmin';
  } catch {
    return false;
  }
}
