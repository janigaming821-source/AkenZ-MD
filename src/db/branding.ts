import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from './client.js';
import { logger } from '../lib/logger.js';

const ID = 1;

/** Ceiling for a brand image, shared by the dashboard upload and .setlogo. */
export const LOGO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The menu banner a buyer uploads lives in the database, not on disk: a cloud
 * container restarts from its image, so a file written to assets/ disappears
 * with it. The in-memory copy below is the hot path — every .menu reads it.
 */
let cache: { value: Buffer | null; loaded: boolean } = { value: null, loaded: false };

/**
 * Which format the bytes actually are. WhatsApp re-compresses images and
 * browsers rename files, so the signature decides what the menu tells the
 * receiver to expect.
 */
export function imageFormat(bytes: Buffer): 'image/jpeg' | 'image/png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  return null;
}

/** Base64 payload and mime, or null when no image was uploaded. */
export async function getLogo(): Promise<{ data: string; mime: string } | null> {
  const row = await prisma.botConfig.findUnique({ where: { id: ID }, select: { logoData: true, logoMime: true } });
  if (!row?.logoData) return null;
  return { data: row.logoData, mime: row.logoMime ?? 'image/jpeg' };
}

export async function setLogo(bytes: Buffer, mime: string): Promise<void> {
  const data = bytes.toString('base64');
  await prisma.botConfig.update({ where: { id: ID }, data: { logoData: data, logoMime: mime } });
  cache = { value: Buffer.from(data, 'base64'), loaded: true };
}

export async function clearLogo(): Promise<void> {
  await prisma.botConfig.update({ where: { id: ID }, data: { logoData: null, logoMime: null } });
  cache = { value: null, loaded: false };
}

/**
 * The banner the menu goes out with: the uploaded brand image, else the shipped
 * assets/menu.jpg, else nothing — in which case the menu is plain text.
 */
export async function menuImage(): Promise<Buffer | null> {
  if (cache.loaded) return cache.value;
  const stored = await getLogo();
  cache = { value: stored ? Buffer.from(stored.data, 'base64') : fromDisk(), loaded: true };
  return cache.value;
}

function fromDisk(): Buffer | null {
  const path = resolve(process.cwd(), 'assets', 'menu.jpg');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch (error) {
    logger.warn({ err: error }, 'menu banner unreadable');
    return null;
  }
}
