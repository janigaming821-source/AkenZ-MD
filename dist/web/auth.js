import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import session from 'express-session';
import { config } from '../config/env.js';
import { getConfig, updateConfig } from '../db/config.js';
export const PASSWORD_ATTEMPTS_WINDOW_MS = 5 * 60_000;
export const PASSWORD_ATTEMPTS_MAX = 8;
const attempts = new Map();
export function tooManyAttempts(ip) {
    const record = attempts.get(ip);
    if (!record)
        return false;
    if (Date.now() - record.first > PASSWORD_ATTEMPTS_WINDOW_MS) {
        attempts.delete(ip);
        return false;
    }
    return record.count >= PASSWORD_ATTEMPTS_MAX;
}
export function registerFailedAttempt(ip) {
    const record = attempts.get(ip);
    if (!record || Date.now() - record.first > PASSWORD_ATTEMPTS_WINDOW_MS) {
        attempts.set(ip, { count: 1, first: Date.now() });
        return;
    }
    record.count += 1;
}
export function clearAttempts(ip) {
    attempts.delete(ip);
}
const hashPassword = (plain) => hash(plain, 12);
/**
 * Returns the password the owner must use on first run: the configured
 * DASHBOARD_PASSWORD, or a generated one that is printed once in the console.
 */
export async function ensureDashboardPassword() {
    const settings = await getConfig();
    if (settings.dashboardHash)
        return { existing: true, password: null };
    const generated = config.dashboard.bootstrapPassword || randomBytes(9).toString('base64url');
    await updateConfig({ dashboardHash: await hashPassword(generated) });
    return { existing: false, password: generated };
}
export async function changeDashboardPassword(plain) {
    if (plain.length < 8)
        throw new Error('Use at least 8 characters.');
    await updateConfig({ dashboardHash: await hashPassword(plain) });
}
export async function verifyPassword(plain) {
    const settings = await getConfig();
    if (!settings.dashboardHash)
        return false;
    return compare(plain, settings.dashboardHash);
}
const safeEqual = (a, b) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};
export const sessionMiddleware = session({
    name: 'noaura.sid',
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
export function requireAuth(req, res, next) {
    const sess = req.session;
    if (!sess?.authenticated) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    req.csrfToken = sess.csrf;
    next();
}
/** Double-submit CSRF: the token lives in the session, the client echoes the header. */
export function csrfProtection(req, res, next) {
    const sess = req.session;
    if (!sess)
        return next();
    if (!sess.csrf)
        sess.csrf = randomBytes(24).toString('base64url');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return next();
    const provided = req.get('x-csrf-token') ?? '';
    if (!safeEqual(provided, sess.csrf)) {
        res.status(403).json({ error: 'csrf check failed' });
        return;
    }
    next();
}
export const loginUsernameMatches = (given) => safeEqual(given, config.dashboard.username);
//# sourceMappingURL=auth.js.map