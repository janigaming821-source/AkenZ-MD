/**
 * Console pairing helper: `npm run pair -- 947XXXXXXXX`
 * Requests a phone-number pairing code, prints it, then waits for WhatsApp to
 * accept it and stores the encrypted session.
 */
import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/client.js';
import { logInfo } from '../db/botLog.js';
import { loadLocales } from '../i18n/index.js';
import { registerAllCommands } from '../commands/index.js';
import { handleInbound } from '../bot/handler.js';
import { handleParticipants } from '../bot/events.js';
import { handleStatus } from '../bot/statusHandler.js';
import { whatsapp } from '../whatsapp/client.js';
import { connection } from '../whatsapp/state.js';
import { normalizePhone } from '../config/env.js';

const RESET = '\x1b[0m';
const ORANGE = '\x1b[38;5;208m';

async function main(): Promise<void> {
  loadLocales();
  await connectDatabase();
  registerAllCommands();
  whatsapp.attach({ onMessage: handleInbound, onParticipants: handleParticipants, onStatus: handleStatus });

  const given = process.argv[2];
  const number = normalizePhone(given ?? config.bot.ownerNumber);
  if (!number) {
    console.error('No number to pair. Pass one:  npm run pair -- 947XXXXXXXX');
    console.error('…or set OWNER_NUMBER in .env.');
    process.exit(1);
  }

  console.log(`\nPairing ${ORANGE}${number}${RESET} …`);
  const code = await whatsapp.requestPairing(number);

  console.log(`
  ${ORANGE}PAIRING CODE${RESET}

      ${ORANGE}${code}${RESET}

  WhatsApp → Settings → Linked devices → Link a device →
  ${ORANGE}Link with phone number${RESET} → type the code.

  The code expires in about 60 seconds. Waiting for WhatsApp…
`);

  const paired = await waitForConnection(90_000);
  if (!paired) {
    console.error('\nNot paired yet. Run the command again, or pair from the dashboard at');
    console.error(`http://${config.dashboard.host}:${config.dashboard.port} (page: WhatsApp).\n`);
    await whatsapp.disconnect();
    await disconnectDatabase();
    process.exit(2);
  }

  await logInfo('whatsapp', 'Pairing completed from the console helper');
  console.log(`\n🟢 Paired as ${connection.get().selfJid ?? 'unknown'}. Session saved — future starts restore it automatically.\n`);
  console.log('Leave this process running to use the bot, or press Ctrl+C and start it with npm run dev.\n');
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
  await whatsapp.disconnect();
  await disconnectDatabase();
  process.exit(0);
}

function waitForConnection(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      connection.off('change', onChange);
      resolve(value);
    };
    const onChange = (state: { status: string }) => {
      if (state.status === 'connected') finish(true);
      if (state.status === 'logged_out' || state.status === 'session_expired' || state.status === 'blocked_by_whatsapp') {
        finish(false);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    connection.on('change', onChange);
    if (connection.isConnected) finish(true);
  });
}

main().catch((error) => {
  console.error('Pairing failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
