import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import { config } from '../config/env.js';
import { getConfig, updateConfig } from '../db/config.js';

export const PASSWORD_ATTEMPTS_WINDOW_MS = 5 * 60_000;
export const PASSWORD_ATTEMPTS_MAX = 8;

const attempts = new Map<string, { count: number; first: number }>();

export function tooManyAttempts(ip: string): boolean {
  const record = attempts.get(ip);
  if (!record) return false;
  if (Date.now() - record.first > PASSWORD_ATTEMPTS_WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return record.count >= PASSWORD_ATTEMPTS_MAX;
}

export function registerFailedAttempt(ip: string): void {
  const record = attempts.get(ip);
  if (!record || Date.now() - record.first > PASSWORD_ATTEMPTS_WINDOW_MS) {
    attempts.set(ip, { count: 1, first: Date.now() });
    return;
  }
  record.count += 1;
}

export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

const hashPassword = (plain: string) => hash(plain, 12);

/**
 * Returns the password the owner must use on first run: the configured
 * DASHBOARD_PASSWORD, or a generated one that is printed once in the console.
 */
export async function ensureDashboardPassword(): Promise<{ existing: boolean; password: string | null }> {
  const settings = await getConfig();
  if (settings.dashboardHash) return { existing: true, password: null };

  const generated = config.dashboard.bootstrapPassword || randomBytes(9).toString('base64url');
  await updateConfig({ dashboardHash: await hashPassword(generated) });
  return { existing: false, password: generated };
}

export async function changeDashboardPassword(plain: string): Promise<void> {
  if (plain.length < 8) throw new Error('Use at least 8 characters.');
  await updateConfig({ dashboardHash: await hashPassword(plain) });
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const settings = await getConfig();
  if (!settings.dashboardHash) return false;
  return compare(plain, settings.dashboardHash);
}

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const sessionMiddleware = session({
  name: 'akenz.sid',
  secret: config.dashboard.cookieSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Loopback-only deployments cannot use Secure cookies; note it in the README.
    secure: false,
    maxAge: 8 * 60 * 60 * 1000,
  },
});

export interface AuthedRequest extends Request {
  csrfToken?: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sess = req.session as { authenticated?: boolean; csrf?: string } | undefined;
  if (!sess?.authenticated) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  (req as AuthedRequest).csrfToken = sess.csrf;
  next();
}

/** Double-submit CSRF: the token lives in the session, the client echoes the header. */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const sess = req.session as { csrf?: string } | undefined;
  if (!sess) return next();
  if (!sess.csrf) sess.csrf = randomBytes(24).toString('base64url');
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const provided = req.get('x-csrf-token') ?? '';
  if (!safeEqual(provided, sess.csrf)) {
    res.status(403).json({ error: 'csrf check failed' });
    return;
  }
  next();
}

/**
 * Paths the shop site may drive on a buyer's behalf: link the number, watch the
 * connection, set branding. Anything owner-wide (logs, groups, commands, logout)
 * stays behind the session, and the key never unlocks those.
 */
const BUYER_PATHS = new Set([
  '/api/whatsapp/status',
  '/api/whatsapp/pair',
  '/api/whatsapp/qr',
  '/api/whatsapp/reconnect',
  '/api/settings',
  '/api/settings/logo',
]);

const viaBuyerKey = (req: Request): boolean => {
  const provided = req.get('x-api-key') ?? '';
  if (!provided || !config.dashboard.buyerApiKey) return false;
  // originalUrl, because inside app.use('/api', …) the request path has already
  // had the mount point stripped and would not match the set.
  if (!BUYER_PATHS.has(req.originalUrl.split('?')[0] ?? '')) return false;
  return safeEqual(provided, config.dashboard.buyerApiKey);
};

/**
 * Session cookie for the dashboard, or the shop's key for the handful of routes
 * a buyer needs from the site. The key replaces CSRF as well: it cannot be
 * attached by a cross-site form, so a browser has no way to send it.
 */
export function apiGuard(req: Request, res: Response, next: NextFunction): void {
  if (viaBuyerKey(req)) {
    res.setHeader('cache-control', 'no-store');
    next();
    return;
  }
  requireAuth(req, res, () => csrfProtection(req, res, next));
}

export const loginUsernameMatches = (given: string): boolean =>
  safeEqual(given, config.dashboard.username);
