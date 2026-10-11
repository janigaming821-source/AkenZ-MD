import { prisma } from './client.js';
import { config } from '../config/env.js';
const ID = 1;
async function row() {
    const existing = await prisma.botConfig.findUnique({ where: { id: ID } });
    if (existing)
        return existing;
    return prisma.botConfig.create({
        data: {
            id: ID,
            name: config.bot.name,
            version: config.bot.version,
            prefix: config.bot.prefix,
            language: config.bot.language,
            ownerNumber: config.bot.ownerNumber,
            aiEnabled: config.ai.provider !== 'none' && Boolean(config.ai.apiKey),
            welcomeEnabled: config.groups.welcome,
            goodbyeEnabled: config.groups.goodbye,
            mediaEnabled: config.media.enabled,
            maxWarnings: config.groups.maxWarnings,
            warningAction: config.groups.warningAction,
            statusText: `${config.bot.name} 🟠`,
        },
    });
}
/**
 * The database is the source of truth for settings that the owner can change
 * from WhatsApp or the dashboard. The owner number always follows .env, since
 * a stale value there would lock the real owner out or hand access to a stranger.
 */
export async function getConfig() {
    const current = await row();
    if (config.bot.ownerNumber && current.ownerNumber !== config.bot.ownerNumber) {
        return prisma.botConfig.update({ where: { id: ID }, data: { ownerNumber: config.bot.ownerNumber } });
    }
    return current;
}
export async function updateConfig(patch) {
    await row();
    return prisma.botConfig.update({ where: { id: ID }, data: patch });
}
export async function setPrefix(prefix) {
    if (!/^[!./#]$/.test(prefix)) {
        throw new Error('Prefix must be one of: . ! / #');
    }
    return updateConfig({ prefix });
}
export async function setLanguage(language) {
    return updateConfig({ language });
}
//# sourceMappingURL=config.js.map