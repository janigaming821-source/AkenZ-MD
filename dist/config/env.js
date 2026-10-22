import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
const hexKey = z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)');
const rawSchema = z.object({
    BOT_NAME: z.string().min(1).default('AkenZ MD'),
    BOT_VERSION: z.string().min(1).default('1.0.0'),
    OWNER_NUMBER: z.string().optional().default(''),
    OWNER_JID: z.string().optional().default(''),
    BOT_PREFIX: z.string().min(1).max(2).default('.'),
    BOT_LANGUAGE: z.enum(['en', 'si']).default('en'),
    TIMEZONE: z.string().default('Asia/Colombo'),
    DATABASE_URL: z.string().default('file:../data/noaura.db'),
    TURSO_AUTH_TOKEN: z.string().optional().default(''),
    SESSION_DIR: z.string().default('./data/session'),
    SESSION_ENCRYPTION_KEY: z.string().optional().default(''),
    DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DASHBOARD_HOST: z.string().default('127.0.0.1'),
    DASHBOARD_USERNAME: z.string().default('owner'),
    DASHBOARD_PASSWORD: z.string().optional().default(''),
    // Lets the shop site drive one buyer's pairing and branding without a session
    // cookie. Empty means the header path is closed.
    BUYER_API_KEY: z.string().optional().default(''),
    PROVISION_API_KEY: z.string().optional().default(''),
    // Shared secret the storefront uses to push order alerts through /api/notify.
    // Empty means the route stays closed.
    NOTIFY_API_KEY: z.string().optional().default(''),
    // The Free Fire top-up site this bot takes orders for. The owner's own
    // instance is the shop counter, so the URL and key only ever apply there.
    TOPUP_API_URL: z.string().optional().default(''),
    TOPUP_BOT_KEY: z.string().optional().default(''),
    COOKIE_SECRET: z.string().optional().default(''),
    AI_PROVIDER: z.enum(['gemini', 'openai', 'none']).default('none'),
    AI_API_KEY: z.string().optional().default(''),
    AI_MODEL: z.string().optional().default(''),
    AI_SYSTEM_PROMPT: z.string().default('You are AkenZ MD. Answer in the language the user wrote in.'),
    AI_MAX_CHARS: z.coerce.number().int().min(100).max(8000).default(1800),
    AI_HISTORY_LIMIT: z.coerce.number().int().min(0).max(50).default(12),
    WEATHER_PROVIDER: z.enum(['open-meteo', 'openweathermap']).default('open-meteo'),
    WEATHER_API_KEY: z.string().optional().default(''),
    TRANSLATE_PROVIDER: z.enum(['mymemory', 'deepl']).default('mymemory'),
    TRANSLATE_API_KEY: z.string().optional().default(''),
    MEDIA_ENABLED: z.enum(['true', 'false']).default('true'),
    YTDLP_PATH: z.string().optional().default(''),
    FFMPEG_PATH: z.string().optional().default(''),
    MEDIA_MAX_MB: z.coerce.number().int().min(1).max(200).default(40),
    MEDIA_TIMEOUT_MS: z.coerce.number().int().min(5000).max(900000).default(120000),
    MEDIA_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(200).default(6),
    WELCOME: z.enum(['true', 'false']).default('true'),
    GOODBYE: z.enum(['true', 'false']).default('true'),
    MAX_WARNINGS: z.coerce.number().int().min(1).max(10).default(3),
    WARNING_ACTION: z.enum(['mute', 'remove']).default('mute'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const bool = (v) => v === 'true';
export function normalizePhone(input) {
    return input.replace(/[^\d]/g, '').replace(/^00/, '');
}
/**
 * '94771234567:3@s.whatsapp.net' → '94771234567@s.whatsapp.net', '' if the input
 * is not a WhatsApp address. Device numbers are dropped because WhatsApp reuses
 * the same user across the device slots a phone can hold.
 */
export function normalizeJid(input) {
    const match = /^(\d+)(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/.exec(input.trim());
    if (!match)
        return '';
    const user = match[1];
    const server = match[2];
    if (!user || !server)
        return '';
    return `${user}@${server === 'c.us' ? 's.whatsapp.net' : server}`;
}
/**
 * Secrets that must exist for the bot to run are generated once and kept in
 * data/secrets.json (gitignored, best-effort file permissions) when not set in
 * .env, so a first start does not dead-end on a hex string.
 */
function loadGeneratedSecrets(dataDir) {
    const file = resolve(dataDir, 'secrets.json');
    let stored = {};
    if (existsSync(file)) {
        try {
            stored = JSON.parse(readFileSync(file, 'utf8'));
        }
        catch {
            stored = {};
        }
    }
    const persist = () => {
        writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
        try {
            chmodSync(file, 0o600);
        }
        catch {
            /* Windows ignores chmod; file is inside gitignored data/ */
        }
    };
    return {
        key(name) {
            const existing = stored[name];
            if (existing)
                return existing;
            const fresh = randomBytes(32).toString('hex');
            stored[name] = fresh;
            persist();
            return fresh;
        },
    };
}
function absolute(p) {
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
function absoluteFrom(base, p) {
    return isAbsolute(p) ? p : resolve(base, p);
}
function build() {
    const parsed = rawSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid configuration in .env:\n${issues}`);
    }
    const e = parsed.data;
    const dataDir = absolute('./data');
    mkdirSync(dataDir, { recursive: true });
    const secrets = loadGeneratedSecrets(dataDir);
    const sessionEncryptionKey = e.SESSION_ENCRYPTION_KEY
        ? hexKey.parse(e.SESSION_ENCRYPTION_KEY)
        : secrets.key('SESSION_ENCRYPTION_KEY');
    const cookieSecret = e.COOKIE_SECRET || secrets.key('COOKIE_SECRET');
    const ownerNumber = e.OWNER_NUMBER ? normalizePhone(e.OWNER_NUMBER) : '';
    if (ownerNumber && (ownerNumber.length < 8 || ownerNumber.length > 16)) {
        throw new Error(`OWNER_NUMBER "${e.OWNER_NUMBER}" does not look like a full international number. ` +
            'Use digits only with the country code first, e.g. 947XXXXXXXX.');
    }
    const ownerJid = e.OWNER_JID ? normalizeJid(e.OWNER_JID) : '';
    if (e.OWNER_JID && !ownerJid) {
        throw new Error(`OWNER_JID "${e.OWNER_JID}" is not a WhatsApp address. Use the full JID, ` +
            'e.g. 94771234567@s.whatsapp.net or 148649053003791@lid.');
    }
    const sessionDir = absolute(e.SESSION_DIR);
    mkdirSync(sessionDir, { recursive: true });
    // Prisma's CLI resolves `file:` paths against the schema folder, so the app
    // does the same and then hands PrismaClient the absolute result.
    const schemaDir = absolute('./prisma');
    const sqliteFile = e.DATABASE_URL.startsWith('file:')
        ? absoluteFrom(schemaDir, e.DATABASE_URL.slice('file:'.length))
        : null;
    if (sqliteFile)
        mkdirSync(dirname(sqliteFile), { recursive: true });
    // Remote libSQL (Turso) keeps the same SQLite schema while surviving on a
    // container platform's ephemeral disk. A token may arrive in the URL query
    // string or as its own variable; the adapter always gets a clean URL.
    const dbRemote = e.DATABASE_URL.startsWith('libsql://');
    let dbUrl = sqliteFile ? `file:${sqliteFile}` : e.DATABASE_URL;
    let dbAuthToken = e.TURSO_AUTH_TOKEN;
    if (dbRemote) {
        const queryIndex = dbUrl.indexOf('?');
        if (queryIndex >= 0) {
            const params = new URLSearchParams(dbUrl.slice(queryIndex + 1));
            const queryToken = params.get('authToken');
            if (!dbAuthToken && queryToken)
                dbAuthToken = queryToken;
            dbUrl = dbUrl.slice(0, queryIndex);
        }
    }
    return {
        raw: e,
        bot: {
            name: e.BOT_NAME,
            version: e.BOT_VERSION,
            prefix: e.BOT_PREFIX,
            language: e.BOT_LANGUAGE,
            timezone: e.TIMEZONE,
            ownerNumber,
            ownerJid,
        },
        db: {
            url: dbUrl,
            file: sqliteFile,
            remote: dbRemote,
            authToken: dbAuthToken,
        },
        session: {
            dir: sessionDir,
            encryptionKey: sessionEncryptionKey,
            autoGeneratedKey: !e.SESSION_ENCRYPTION_KEY,
        },
        dashboard: {
            host: e.DASHBOARD_HOST,
            port: e.DASHBOARD_PORT,
            username: e.DASHBOARD_USERNAME,
            bootstrapPassword: e.DASHBOARD_PASSWORD,
            buyerApiKey: e.BUYER_API_KEY,
            provisionApiKey: e.PROVISION_API_KEY,
            notifyApiKey: e.NOTIFY_API_KEY,
            cookieSecret,
            autoGeneratedCookieSecret: !e.COOKIE_SECRET,
        },
        ai: {
            provider: e.AI_PROVIDER,
            apiKey: e.AI_API_KEY,
            // 3.8 answers 503 for this key today; 3.7 was verified serving requests.
            model: e.AI_MODEL || (e.AI_PROVIDER === 'gemini' ? 'gemini-3.7-flash' : e.AI_PROVIDER === 'openai' ? 'gpt-4o-mini' : ''),
            systemPrompt: e.AI_SYSTEM_PROMPT,
            maxChars: e.AI_MAX_CHARS,
            historyLimit: e.AI_HISTORY_LIMIT,
        },
        weather: { provider: e.WEATHER_PROVIDER, apiKey: e.WEATHER_API_KEY },
        translate: { provider: e.TRANSLATE_PROVIDER, apiKey: e.TRANSLATE_API_KEY },
        media: {
            enabled: bool(e.MEDIA_ENABLED),
            ytdlpPath: e.YTDLP_PATH || undefined,
            ffmpegPath: e.FFMPEG_PATH || undefined,
            maxBytes: e.MEDIA_MAX_MB * 1024 * 1024,
            maxMb: e.MEDIA_MAX_MB,
            timeoutMs: e.MEDIA_TIMEOUT_MS,
            rateLimitPerHour: e.MEDIA_RATE_LIMIT_PER_HOUR,
            tempDir: absolute('./data/tmp'),
        },
        groups: {
            welcome: bool(e.WELCOME),
            goodbye: bool(e.GOODBYE),
            maxWarnings: e.MAX_WARNINGS,
            warningAction: e.WARNING_ACTION,
        },
        logLevel: e.LOG_LEVEL,
        paths: { dataDir, webDir: absolute('./src/web/public'), mediaTempDir: absolute('./data/tmp') },
    };
}
export const config = build();
//# sourceMappingURL=env.js.map