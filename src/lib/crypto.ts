import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

const KEY = Buffer.from(config.session.encryptionKey, 'hex');
if (KEY.length !== 32) {
  throw new Error('SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes');
}

type WrappedBinary = { __b64: string };

/** JSON that survives the Uint8Array/Buffer fields Baileys creds are full of. */
export function encodeBinaryJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Uint8Array) {
      return { __b64: Buffer.from(v).toString('base64') };
    }
    // JSON.stringify calls Buffer#toJSON() *before* the replacer runs, so a key
    // arrives here as { type: 'Buffer', data: number[] }. Persist that shape and
    // the next start hands Baileys a plain object where it needs bytes — the
    // noise handshake then throws and every connection dies before pairing.
    if (v && typeof v === 'object' && (v as { type?: unknown }).type === 'Buffer'
      && Array.isArray((v as { data?: unknown }).data)) {
      return { __b64: Buffer.from((v as { data: number[] }).data).toString('base64') };
    }
    return v;
  });
}

export function decodeBinaryJson(text: string): unknown {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === 'object' && '__b64' in v) {
      const b64 = (v as WrappedBinary).__b64;
      if (typeof b64 === 'string') return Buffer.from(b64, 'base64');
    }
    // Sessions written before the encoder learned about Buffer#toJSON() hold
    // { type: 'Buffer', data } objects. Read those back as bytes instead of
    // failing the handshake, so an existing session self-heals on the next save.
    if (v && typeof v === 'object' && (v as { type?: unknown }).type === 'Buffer'
      && Array.isArray((v as { data?: unknown }).data)) {
      return Buffer.from((v as { data: number[] }).data);
    }
    return v;
  });
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(encodeBinaryJson(value), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  });
}

export function decryptJson<T>(payload: string): T {
  const box = JSON.parse(payload) as { v: number; iv: string; tag: string; ct: string };
  if (box.v !== 1) throw new Error(`Unsupported credential container version: ${box.v}`);
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
  return decodeBinaryJson(plaintext.toString('utf8')) as T;
}
