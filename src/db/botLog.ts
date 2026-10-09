import { prisma } from './client.js';
import { logger } from '../lib/logger.js';

type Level = 'info' | 'warn' | 'error';

const SECRET_KEYS = /(key|secret|token|password|creds|session|cookie|apikey|authorization)/i;

/** Keeps only short, plain values — never message bodies, never credentials. */
function sanitize(meta: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEYS.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v.slice(0, 200);
    } else {
      out[k] = String(v).slice(0, 200);
    }
  }
  return out;
}

export async function botLog(
  level: Level,
  scope: string,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const clean = sanitize(meta);
  logger[level]({ scope, ...clean }, message);
  try {
    await prisma.botLog.create({
      data: { level, scope, message: message.slice(0, 500), meta: JSON.stringify(clean) },
    });
  } catch {
    // Logging must never take the bot down.
  }
}

export const logInfo = (scope: string, message: string, meta?: Record<string, unknown>) =>
  botLog('info', scope, message, meta ?? {});
export const logWarn = (scope: string, message: string, meta?: Record<string, unknown>) =>
  botLog('warn', scope, message, meta ?? {});
export const logError = (scope: string, message: string, meta?: Record<string, unknown>) =>
  botLog('error', scope, message, meta ?? {});
