import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import session from 'express-session';
import { config } from '../config/env.js';
import { getConfig, updateConfig } from '../db/config.js';
import { OWNER_INSTANCE, runInInstance } from '../lib/scope.js';
import { instanceForKey } from '../whatsapp/instances.js';
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
/** Instance the shop's key unlocks for this request, or null. */
async function viaBuyerKey(req) {
    const provided = req.get('x-api-key') ?? '';
    if (!provided)
        return null;
    // originalUrl, because inside app.use('/api', …) the request path has already
    // had the mount point stripped and would not match the set.
    if (!BUYER_PATHS.has(req.originalUrl.split('?')[0] ?? ''))
        return null;
    if (config.dashboard.buyerApiKey && safeEqual(provided, config.dashboard.buyerApiKey))
        return OWNER_INSTANCE;
    return instanceForKey(provided);
}
/**
 * Session cookie for the dashboard, or a shop key for the handful of routes a
 * buyer needs from the site. The key replaces CSRF as well: it cannot be
 * attached by a cross-site form, so a browser has no way to send it. Everything
 * downstream runs scoped to the instance the key belongs to.
 */
export function apiGuard(req, res, next) {
    if (req.originalUrl.startsWith('/api/instances')) {
        provisionGuard(req, res, next);
        return;
    }
    if (req.originalUrl.startsWith('/api/notify')) {
        notifyGuard(req, res, next);
        return;
    }
    viaBuyerKey(req)
        .then((instance) => {
        if (instance === null) {
            requireAuth(req, res, () => csrfProtection(req, res, next));
            return;
        }
        res.setHeader('cache-control', 'no-store');
        res.locals.instance = instance;
        runInInstance(instance, next);
    })
        .catch(next);
}
/** Express body parsers can drop the async scope; this puts it back. */
export function rescope(_req, res, next) {
    runInInstance(res.locals.instance ?? OWNER_INSTANCE, next);
}
/** Only the shop server holds this key; it creates and removes buyer bots. */
function provisionGuard(req, res, next) {
    const provided = req.get('x-provision-key') ?? '';
    if (!config.dashboard.provisionApiKey || !safeEqual(provided, config.dashboard.provisionApiKey)) {
        res.status(401).json({ error: 'provision key required' });
        return;
    }
    res.setHeader('cache-control', 'no-store');
    next();
}
/**
 * The storefront pushes order alerts here with a shared header key. It sends on
 * the owner's instance only — a notify caller cannot reach a buyer's socket —
 * and the key replaces CSRF the same way the shop key does.
 */
function notifyGuard(req, res, next) {
    const provided = req.get('x-notify-key') ?? '';
    if (!config.dashboard.notifyApiKey || !safeEqual(provided, config.dashboard.notifyApiKey)) {
        res.status(401).json({ error: 'notify key required' });
        return;
    }
    res.setHeader('cache-control', 'no-store');
    runInInstance(OWNER_INSTANCE, next);
}
export const loginUsernameMatches = (given) => safeEqual(given, config.dashboard.username);
//# sourceMappingURL=auth.js.map