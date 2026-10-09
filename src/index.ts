import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/client.js';
import { getConfig } from './db/config.js';
import { logError, logInfo } from './db/botLog.js';
import { loadLocales } from './i18n/index.js';
import { registerAllCommands } from './commands/index.js';
import { handleInbound } from './bot/handler.js';
import { handleParticipants } from './bot/events.js';
import { handleStatus } from './bot/statusHandler.js';
import { handleDeleteEvent } from './bot/groupProtect.js';
import { whatsapp } from './whatsapp/client.js';
import { connection } from './whatsapp/state.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';
import { dashboard } from './web/server.js';
import { ensureDashboardPassword } from './web/auth.js';

const ORANGE = '\x1b[38;5;208m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => plainLength(l))) + 2;
  const pad = (s: string) => s + ' '.repeat(width - plainLength(s));
  console.log('');
  console.log(`${ORANGE}╭${'─'.repeat(width + 2)}╮${RESET}`);
  console.log(`${ORANGE}│${RESET} ${pad('NOAURA BOT')} ${ORANGE}│${RESET}`);
  console.log(`${ORANGE}├${'─'.repeat(width + 2)}┤${RESET}`);
  for (const line of lines) console.log(`${ORANGE}│${RESET} ${pad(line)} ${ORANGE}│${RESET}`);
  console.log(`${ORANGE}╰${'─'.repeat(width + 2)}╯${RESET}`);
  console.log('');
}

/** Box alignment must ignore ANSI escape sequences. */
function plainLength(input: string): number {
  return input.replace(/\x1b\[[0-9;]*m/g, '').length;
}

let httpServer: Server | null = null;

async function main(): Promise<void> {
  mkdirSync(config.paths.mediaTempDir, { recursive: true });
  loadLocales();

  await connectDatabase();
  const settings = await getConfig();

  const commandCount = registerAllCommands();
  whatsapp.attach({
    onMessage: handleInbound,
    onParticipants: handleParticipants,
    onStatus: handleStatus,
    onDelete: handleDeleteEvent,
  });

  // Hosting platforms (Render etc.) inject $PORT for the app to bind; locally
  // DASHBOARD_PORT from .env applies as before.
  const dashboardPort = Number(process.env.PORT) || config.dashboard.port;
  const server = dashboard.listen(dashboardPort, config.dashboard.host, () => {
    logInfo('dashboard', 'Dashboard listening', { url: `http://${config.dashboard.host}:${dashboardPort}` });
  });
  httpServer = server;
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\nDashboard port ${dashboardPort} is already in use. Change DASHBOARD_PORT in .env.\n`);
      process.exit(1);
    }
    console.error('Dashboard failed to start:', error.message);
  });

  const firstRun = await ensureDashboardPassword();
  if (!firstRun.existing && firstRun.password) {
    console.log(
      `\n${ORANGE}First run — dashboard password (shown once, change it in .env later):${RESET}\n` +
        `  username: ${config.dashboard.username}\n` +
        `  password: ${firstRun.password}\n`
    );
  }

  // The socket connects in the background so the dashboard is reachable even
  // when WhatsApp is unreachable; pairing state is surfaced there.
  void whatsapp
    .start()
    .then(() => {
      const state = connection.get();
      logInfo('whatsapp', 'WhatsApp startup sequence finished', { status: state.status });
    })
    .catch(async (error) => {
      await logError('whatsapp', 'WhatsApp could not start', { detail: error instanceof Error ? error.message : String(error) });
      console.error(`WhatsApp start failed: ${error instanceof Error ? error.message : String(error)}`);
    });

  startScheduler();

  const state = connection.get();
  banner([
    `Status:    ${state.status === 'connected' ? 'ONLINE 🟢' : 'STARTING 🟡'}`,
    `WhatsApp:  ${state.status}`,
    `Owner:     ${
      config.bot.ownerJid
        ? 'configured (number + WhatsApp ID)'
        : config.bot.ownerNumber
          ? 'number only — private chats use a WhatsApp ID, so set OWNER_JID too'
          : 'not set — owner commands are locked'
    }`,
    `Prefix:    ${settings.prefix}`,
    `Language:  ${settings.language === 'si' ? 'සිංහල' : 'English'}`,
    `Commands:  ${commandCount} registered`,
    `Dashboard: http://${config.dashboard.host}:${config.dashboard.port}`,
    `Database:  ${config.db.file ?? 'external'}`,
  ]);

  if (!config.bot.ownerNumber) {
    console.log(
      `${DIM}Set OWNER_NUMBER in .env to unlock owner commands and enable pairing-code login from the console.${RESET}\n`
    );
  }
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down NOAURA BOT…`);
  stopScheduler();
  try {
    await whatsapp.disconnect();
  } catch {
    /* socket may already be closed */
  }
  await new Promise<void>((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 3000);
    httpServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  await disconnectDatabase();
  console.log('Stopped cleanly.');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

/**
 * The message alone ('Connection Closed') does not say which call threw it, so the
 * stack is the only thing that makes a rejection actionable in the Logs page.
 */
function describe(reason: unknown): string {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  return error.stack ?? error.message;
}

process.on('unhandledRejection', (reason) => {
  void logError('process', 'Unhandled promise rejection', { detail: describe(reason) });
});

process.on('uncaughtException', (error) => {
  void logError('process', 'Uncaught exception', { detail: describe(error) });
  console.error('Uncaught exception:', error);
});

main().catch((error) => {
  console.error('Startup failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
