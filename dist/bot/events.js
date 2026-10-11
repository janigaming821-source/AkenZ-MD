import { getConfig } from '../db/config.js';
import { getGroupSettings, upsertGroup } from '../db/groups.js';
import { logError } from '../db/botLog.js';
import { t } from '../i18n/index.js';
import { whatsapp } from '../whatsapp/client.js';
/**
 * Welcome / goodbye. WhatsApp only reports these for groups the bot is in, and
 * removals are reported for anyone — including admins who left voluntarily.
 */
export async function handleParticipants(event) {
    try {
        const settings = await getConfig();
        const groupSettings = await getGroupSettings(event.jid);
        if (event.action === 'add' && (settings.welcomeEnabled || groupSettings.welcome)) {
            await upsertGroup(event.jid, null);
            const lang = settings.language;
            const names = event.participants.map((p) => `@${p.split('@')[0]}`);
            await whatsapp.sendMessage(event.jid, {
                text: [
                    t(lang, 'welcome', { name: names.join(', ') }),
                    groupSettings.rules ? `\n📜 ${groupSettings.rules.slice(0, 300)}` : '',
                ].join(''),
                mentions: event.participants,
            });
        }
        if (event.action === 'remove' && (settings.goodbyeEnabled || groupSettings.goodbye)) {
            const lang = settings.language;
            const names = event.participants.map((p) => `@${p.split('@')[0]}`);
            await whatsapp.sendMessage(event.jid, {
                text: t(lang, 'goodbye', { name: names.join(', ') }),
                mentions: event.participants,
            });
        }
    }
    catch (error) {
        // A chat that has since been left must not break the bot.
        await logError('groups', 'Welcome/goodbye skipped', {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
//# sourceMappingURL=events.js.map