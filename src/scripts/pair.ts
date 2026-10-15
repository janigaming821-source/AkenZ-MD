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
import { connection, connectionFor } from '../whatsapp/state.js';
import { OWNER_INSTANCE } from '../lib/scope.js';
import { normalizePhone } from '../config/env.js';

const RESET = '\x1b[0m';
const ORANGE = '\x1b[38;5;208m';
/** How long the helper keeps a live code on screen while waiting for the phone. */
const PAIRING_WINDOW_MS = 300_000;

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

  let announced = '';
  const onState = (state: { pairingCode?: string | null }) => {
    if (state.pairingCode && state.pairingCode !== announced) {
      announced = state.pairingCode;
      printCode(announced);
    }
  };
  connectionFor(OWNER_INSTANCE).on('change', onState);

  // A WhatsApp code lives about a minute and is never replaced behind the owner's
  // back, so ask for the next one as soon as this one dies and keep the terminal
  // showing a live code for the whole window.
  const deadline = Date.now() + PAIRING_WINDOW_MS;
  let paired = false;
  while (!paired && Date.now() < deadline) {
    announced = '';
    try {
      onState({ pairingCode: await whatsapp.requestPairing(number) });
    } catch (error) {
      if (connection.isConnected) break;
      console.error(error instanceof Error ? error.message : String(error));
    }

    while (Date.now() < deadline && connection.get().pairingCode && !connection.isConnected) {
      await sleep(500);
    }
    paired = connection.isConnected;
  }
  connectionFor(OWNER_INSTANCE).off('change', onState);

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

function printCode(code: string): void {
  console.log(`
  ${ORANGE}PAIRING CODE${RESET}

      ${ORANGE}${code}${RESET}

  WhatsApp → Settings → Linked devices → Link a device →
  ${ORANGE}Link with phone number${RESET} → type ${ORANGE}${code}${RESET} now.

  This code expires in about 60 seconds; a fresh one prints here if it renews.
  Waiting for WhatsApp…
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Pairing failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
