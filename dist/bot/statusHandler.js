import { whatsapp } from '../whatsapp/client.js';
import { logError } from '../db/botLog.js';
import { scoped } from '../lib/scope.js';
const REACT_EMOJI = '\u{1F525}';
const reacted = new Set();
const MAX_TRACKED = 500;
export async function handleStatus(event) {
    const msgKey = event.message.key;
    const messageKey = scoped(`${msgKey.remoteJid}:${msgKey.id}`);
    if (reacted.has(messageKey))
        return;
    reacted.add(messageKey);
    if (reacted.size > MAX_TRACKED) {
        const first = reacted.values().next();
        if (first.value)
            reacted.delete(first.value);
    }
    try {
        await whatsapp.sendMessage('status@broadcast', {
            react: {
                key: msgKey,
                text: REACT_EMOJI,
            },
        });
    }
    catch (error) {
        reacted.delete(messageKey);
        logError('status', 'Failed to react to status', {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
//# sourceMappingURL=statusHandler.js.map