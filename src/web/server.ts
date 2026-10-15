import express, { type Request, type Response, type NextFunction } from 'express';
import { json, raw } from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { config, normalizePhone } from '../config/env.js';
import { prisma, databaseIsUp } from '../db/client.js';
import { getStats } from '../db/stats.js';
import { botLog } from '../db/botLog.js';
import { getConfig, updateConfig } from '../db/config.js';
import { addAutoReply, deleteAutoReply, listAutoReplies, setAutoReplyEnabled, splitTriggers } from '../db/autoreplies.js';
import { addCustomCommand, deleteCustomCommand, isReservedName, listCustomCommands } from '../db/customCommands.js';
import { clearLogo, getLogo, imageFormat, LOGO_MAX_BYTES, setLogo } from '../db/branding.js';
import { connection, statusLabel } from '../whatsapp/state.js';
import { whatsapp } from '../whatsapp/client.js';
import { listInstances, provisionInstance, removeInstance, updateInstance } from '../whatsapp/instances.js';
import { allCommands } from '../bot/registry.js';
import { botStartedAt } from '../commands/general.js';
import { aiIsConfigured } from '../tools/api.js';
import { toolVersion } from '../media/binary.js';
import { logger } from '../lib/logger.js';
import {
  apiGuard,
  rescope,
  csrfProtection,
  loginUsernameMatches,
  requireAuth,
  sessionMiddleware,
  verifyPassword,
  tooManyAttempts,
  registerFailedAttempt,
  clearAttempts,
} from './auth.js';

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use(json({ limit: '64kb' }));
app.use(sessionMiddleware);

// ── Public ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const db = await databaseIsUp();
  res.status(db ? 200 : 503).json({
    status: db && connection.isConnected ? 'healthy' : db ? 'degraded' : 'unhealthy',
    whatsapp: connection.get().status,
    database: db ? 'connected' : 'disconnected',
  });
});

app.post('/api/login', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Too many failed attempts. Wait a few minutes.' });
    return;
  }
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (typeof password !== 'string' || !username || !loginUsernameMatches(username)) {
    registerFailedAttempt(ip);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const ok = await verifyPassword(password);
  if (!ok) {
    registerFailedAttempt(ip);
    await botLog('warn', 'security', 'Failed dashboard login attempt', { ip });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  clearAttempts(ip);
  // New session id on login, so a pre-login cookie cannot be reused.
  await new Promise<void>((resolvePromise) => req.session.regenerate(() => resolvePromise()));
  const sess = req.session as { authenticated?: boolean; csrf?: string };
  sess.authenticated = true;
  sess.csrf = randomBytes(24).toString('base64url');
  res.json({ ok: true, csrf: sess.csrf });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('akenz.sid');
    res.json({ ok: true });
  });
});

app.use('/api', apiGuard);

app.get('/api/csrf', (req: Request, res: Response) => {
  const sess = req.session as { csrf?: string };
  res.json({ token: sess.csrf ?? null });
});

// ── Status ───────────────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  const stats = await getStats();
  const state = connection.get();
  res.json({
    bot: { name: config.bot.name, version: config.bot.version, prefix: config.bot.prefix },
    whatsapp: {
      status: state.status,
      label: statusLabel[state.status],
      connected: state.status === 'connected',
      selfJid: state.selfJid,
      connectedAt: state.connectedAt,
      reconnectAttempt: state.reconnectAttempt,
      lastError: state.lastError,
    },
    stats,
    startedAt: botStartedAt(),
  });
});

// ── WhatsApp pairing ─────────────────────────────────────────────────────
/** Pairing failures reach the owner verbatim, so keep them readable. */
function describe(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Pairing failed for an unexpected reason — check the server log.';
}

app.post('/api/whatsapp/pair', async (req, res) => {
  const raw = String((req.body as { phoneNumber?: string })?.phoneNumber ?? '').trim();
  if (!raw) {
    res.status(400).json({ error: 'Enter the WhatsApp number in international format, e.g. +94 771234567.' });
    return;
  }
  const number = normalizePhone(raw);
  try {
    const code = await whatsapp.requestPairing(number);
    const state = connection.get();
    await botLog('info', 'whatsapp', 'Pairing code generated from the dashboard');
    res.json({
      code,
      expiresAt: state.pairingCodeExpiresAt,
      phoneNumber: number,
      instructions: {
        en: [
          '1. Open WhatsApp.',
          '2. Go to Settings.',
          '3. Open Linked Devices.',
          '4. Select Link a Device.',
          '5. Select "Link with phone number".',
          '6. Enter the pairing code.',
        ],
        si: [
          '1. WhatsApp විවෘත කරන්න.',
          '2. Settings වෙත යන්න.',
          '3. Linked Devices වෙත යන්න.',
          '4. Link a Device තෝරන්න.',
          '5. "Link with phone number" තෝරන්න.',
          '6. පෙන්වන pairing code එක ඇතුළත් කරන්න.',
        ],
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'pairing request failed');
    res.status(400).json({ error: describe(error) });
  }
});

app.get('/api/whatsapp/status', (_req, res) => {
  whatsapp.noteDemand();
  const state = connection.get();
  res.json({
    status: state.status,
    label: statusLabel[state.status],
    connected: state.status === 'connected',
    phoneNumber: state.phoneNumber,
    pairingCode: state.pairingCode,
    pairingCodeExpiresAt: state.pairingCodeExpiresAt,
    hasPairingQr: Boolean(state.pairingQr),
    lastError: state.lastError,
  });
});

/**
 * QR linking is the other half of pairing. WhatsApp counts every pairing-code
 * request against a per-account linking limit and answers the overflow with
 * 429 rate-overlimit, while a scan uses a different handshake — so when codes
 * are throttled the QR is the path that still works.
 */
app.get('/api/whatsapp/qr', async (_req, res) => {
  // A buyer's bot sleeps until someone asks to link it.
  await whatsapp.ensureStarted().catch((error) => logger.warn({ err: error }, 'socket start failed'));
  const qr = connection.get().pairingQr;
  if (!qr) {
    res.status(404).json({ error: 'No QR is being broadcast right now.' });
    return;
  }
  try {
    res.json({ dataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
  } catch (error) {
    logger.error({ err: error }, 'QR rendering failed');
    res.status(500).json({ error: 'The QR could not be rendered.' });
  }
});

/**
 * Pairing has to survive asset caching: the edge keeps serving stale dashboard
 * files after a deploy, and an owner who cannot see the QR cannot link a
 * device. This page is served dynamically with no-store, and its assets are
 * stamped per process start, so a deploy can never leave a browser on old code.
 */
const PAIR_ASSETS_STAMP = Date.now();

const PAIR_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link this device — AkenZ MD</title>
<link rel="stylesheet" href="/pair.css?v=${PAIR_ASSETS_STAMP}">
</head>
<body>
<main>
  <h1>Scan to link this number</h1>
  <p>WhatsApp &#8594; Settings &#8594; Linked devices &#8594; Link a device &#8594; point the camera at the square.</p>
  <p>දුරකථනයේ: WhatsApp &#8594; Settings &#8594; Linked devices &#8594; Link a device &#8594; QR එක කැමරාවට පෙන්වන්න.</p>
  <img id="qr" alt="WhatsApp pairing QR">
  <p id="note">Waiting for a QR from WhatsApp. Keep this page open — it refreshes by itself.</p>
</main>
<script src="/pair.js?v=${PAIR_ASSETS_STAMP}" defer></script>
</body>
</html>
`;

app.get('/pair', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(PAIR_PAGE);
});

app.post('/api/whatsapp/disconnect', async (_req, res) => {
  await whatsapp.disconnect();
  res.json({ ok: true, status: connection.get().status });
});

app.post('/api/whatsapp/reconnect', async (_req, res) => {
  await whatsapp.reconnect();
  res.json({ ok: true, status: connection.get().status });
});

// Destroys the stored session — the UI asks for confirmation first.
app.post('/api/whatsapp/logout', async (_req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true, status: connection.get().status });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Logout failed.' });
  }
});

// ── Settings ─────────────────────────────────────────────────────────────
const SETTINGS_KEYS = [
  'name',
  'prefix',
  'language',
  'aiEnabled',
  'autoReplyEnabled',
  'welcomeEnabled',
  'goodbyeEnabled',
  'mediaEnabled',
  'groupToolsEnabled',
  'statusText',
  'maxWarnings',
  'warningAction',
] as const;

app.get('/api/settings', async (_req, res) => {
  // logoData is a megabyte of base64; the dashboard reads it from /api/settings/logo.
  const { dashboardHash: _hash, logoData: _logo, ...safe } = await getConfig();
  res.json({
    settings: safe,
    hasLogo: Boolean(_logo),
    keys: { ai: config.ai.provider, weather: config.weather.provider, media: config.media.enabled },
  });
});

app.post('/api/settings', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, string | number | boolean> = {};
  for (const key of SETTINGS_KEYS) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (key === 'maxWarnings') patch[key] = Math.min(Math.max(Number(value) || 3, 1), 10);
    else if (key === 'warningAction') patch[key] = value === 'remove' ? 'remove' : 'mute';
    else if (key === 'prefix') patch[key] = /^[!./#]$/.test(String(value)) ? String(value) : '.';
    else if (key === 'language') patch[key] = value === 'si' ? 'si' : 'en';
    else if (typeof value === 'boolean') patch[key] = value;
    else patch[key] = String(value).slice(0, 120);
  }
  if (Object.keys(patch).length) await updateConfig(patch);
  await botLog('info', 'dashboard', 'Settings updated');
  res.json({ ok: true });
});

/**
 * Brand image for the menu banner. The bytes travel as the request body with an
 * image content type, which keeps the 64kb JSON limit out of the way and saves
 * the browser from base64-ing a megabyte before upload.
 */
app.get('/api/settings/logo', async (_req, res) => {
  const logo = await getLogo();
  if (!logo) {
    res.status(404).json({ error: 'No brand image is set.' });
    return;
  }
  res.set({ 'Content-Type': logo.mime, 'Cache-Control': 'no-store' });
  res.send(Buffer.from(logo.data, 'base64'));
});

app.put(
  '/api/settings/logo',
  raw({ type: ['image/jpeg', 'image/png'], limit: LOGO_MAX_BYTES }),
  rescope,
  async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = imageFormat(bytes);
    if (!mime) {
      res.status(400).json({ error: 'Upload a JPEG or PNG image under 3 MB.' });
      return;
    }
    await setLogo(bytes, mime);
    await botLog('info', 'dashboard', 'Brand image updated', { bytes: bytes.length });
    res.json({ ok: true, bytes: bytes.length });
  },
);

app.delete('/api/settings/logo', async (_req, res) => {
  await clearLogo();
  await botLog('info', 'dashboard', 'Brand image removed');
  res.json({ ok: true });
});

// ── Custom commands ──────────────────────────────────────────────────────
app.get('/api/commands', async (_req, res) => {
  const [custom, builtIn] = await Promise.all([listCustomCommands(), Promise.resolve(allCommands())]);
  res.json({
    custom,
    builtIn: builtIn.map((c) => ({
      name: c.name,
      category: c.category,
      usage: c.usage,
      description: c.description,
      ownerOnly: Boolean(c.ownerOnly),
      aliases: c.aliases ?? [],
    })),
  });
});

app.post('/api/commands', async (req, res) => {
  const { name, response } = (req.body ?? {}) as { name?: string; response?: string };
  const clean = String(name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!clean || !String(response ?? '').trim()) {
    res.status(400).json({ error: 'name and response are both required' });
    return;
  }
  // A built-in always answers first, so a custom command under its name would
  // sit in the database doing nothing and look broken to the owner.
  if (isReservedName(clean)) {
    res.status(409).json({ error: `.${clean} is already a built-in command. Pick another name.` });
    return;
  }
  try {
    const created = await addCustomCommand(clean, String(response).slice(0, 2000), 'dashboard');
    await botLog('info', 'dashboard', 'Custom command created', { name: clean });
    res.json({ ok: true, command: created });
  } catch {
    res.status(409).json({ error: 'That command name already exists.' });
  }
});

app.delete('/api/commands/:id', async (req, res) => {
  const row = await prisma.customCommand.findUnique({ where: { id: Number(req.params.id) } });
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  await deleteCustomCommand(row.name);
  res.json({ ok: true });
});

// ── Auto replies ────────────────────────────────────────────────────────
app.get('/api/autoreplies', async (_req, res) => {
  res.json(await listAutoReplies());
});

app.post('/api/autoreplies', async (req, res) => {
  const { triggers, response, matchType } = (req.body ?? {}) as {
    triggers?: string;
    response?: string;
    matchType?: string;
  };
  const list = splitTriggers(String(triggers ?? ''));
  if (!list.length || !String(response ?? '').trim()) {
    res.status(400).json({ error: 'triggers and response are both required' });
    return;
  }
  const created = await addAutoReply(list, String(response).slice(0, 1000), matchType === 'contains' ? 'contains' : 'exact');
  res.json({ ok: true, autoReply: created });
});

app.patch('/api/autoreplies/:id', async (req, res) => {
  const { enabled } = (req.body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be true or false' });
    return;
  }
  const changed = await setAutoReplyEnabled(Number(req.params.id), enabled);
  if (!changed) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/autoreplies/:id', async (req, res) => {
  const removed = await deleteAutoReply(Number(req.params.id));
  if (!removed) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

// ── Logs ─────────────────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await prisma.botLog.findMany({ orderBy: { id: 'desc' }, take: limit });
  res.json(
    rows.map((r) => ({
      id: r.id,
      level: r.level,
      scope: r.scope,
      message: r.message,
      meta: (() => {
        try {
          return JSON.parse(r.meta) as unknown;
        } catch {
          return {};
        }
      })(),
      createdAt: r.createdAt,
    })),
  );
});

app.get('/api/groups', async (_req, res) => {
  const rows = await prisma.groupSettings.findMany({ orderBy: { updatedAt: 'desc' }, take: 100, include: { group: true } });
  res.json(rows.map(({ group, ...settings }) => ({
    jid: settings.groupJid,
    name: group?.name ?? null,
    memberCount: group?.memberCount ?? 0,
    settings,
  })));
});

app.get('/api/schedules', async (_req, res) => {
  const rows = await prisma.scheduledTask.findMany({ orderBy: { runAt: 'asc' }, take: 200 });
  res.json({ timezone: config.bot.timezone, tasks: rows });
});

app.delete('/api/schedules/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = await prisma.scheduledTask.findUnique({ where: { id } });
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (row.status !== 'pending') {
    res.status(409).json({ error: 'Only pending tasks can be deleted.' });
    return;
  }
  await prisma.scheduledTask.delete({ where: { id } });
  await botLog('info', 'dashboard', 'Scheduled task deleted');
  res.json({ ok: true });
});

app.get('/api/integrations', async (_req, res) => {
  res.json({
    ai: { provider: config.ai.provider, configured: aiIsConfigured(), model: config.ai.model },
    weather: { provider: config.weather.provider, keyless: config.weather.provider === 'open-meteo' },
    translate: { provider: config.translate.provider, keyless: config.translate.provider === 'mymemory' },
    media: { enabled: config.media.enabled },
    ownerNumberSet: Boolean(config.bot.ownerNumber),
    ownerJidSet: Boolean(config.bot.ownerJid),
  });
});

app.get('/api/media/tools', async (_req, res) => {
  res.json({
    ytdlp: await toolVersion('yt-dlp'),
    ffmpeg: await toolVersion('ffmpeg'),
    ffprobe: await toolVersion('ffprobe'),
    limits: { maxMb: config.media.maxMb, ratePerHour: config.media.rateLimitPerHour },
  });
});

// Only job metadata is stored (kind, search text, status, size) — never files.
app.get('/api/media/history', async (_req, res) => {
  const rows = await prisma.mediaHistory.findMany({ orderBy: { id: 'desc' }, take: 60 });
  res.json(rows);
});

// ── Buyer bots (shop server only, behind PROVISION_API_KEY) ──────────────
const parseExpiry = (value: unknown): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

app.get('/api/instances', async (_req, res) => {
  res.json({ instances: await listInstances() });
});

app.post('/api/instances', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = String(body.label ?? '').trim();
  const ownerNumber = normalizePhone(String(body.ownerNumber ?? ''));
  if (!label || ownerNumber.length < 10) {
    res.status(400).json({ error: 'label and an international ownerNumber are required' });
    return;
  }
  const created = await provisionInstance({
    label,
    ownerNumber,
    name: body.name ? String(body.name) : undefined,
    plan: body.plan ? String(body.plan) : undefined,
    expiresAt: parseExpiry(body.expiresAt) ?? null,
  });
  res.status(201).json(created);
});

app.patch('/api/instances/:id', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: { plan?: string; label?: string; expiresAt?: Date | null } = {};
  if (body.plan !== undefined) patch.plan = String(body.plan).slice(0, 40);
  if (body.label !== undefined) patch.label = String(body.label).slice(0, 80);
  const expiry = parseExpiry(body.expiresAt);
  if (expiry !== undefined) patch.expiresAt = expiry;
  const ok = await updateInstance(Number(req.params.id), patch);
  res.status(ok ? 200 : 404).json({ ok });
});

app.delete('/api/instances/:id', async (req, res) => {
  const ok = await removeInstance(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

// ── Dashboard static files ───────────────────────────────────────────────
// Always revalidate: an owner who updates the bot must never be stuck on a
// cached bundle. On loopback a 304 costs nothing.
const noCache = (res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
};

app.use(express.static(config.paths.webDir, { index: false, setHeaders: noCache }));
app.get(['/', '/connect'], (_req, res) => {
  noCache(res);
  res.sendFile(join(config.paths.webDir, 'index.html'));
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  void botLog('error', 'dashboard', 'Unhandled dashboard error', { detail: error.message });
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' });
});

export const dashboard = app;
