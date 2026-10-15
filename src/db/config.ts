import { prisma } from './client.js';
import { config } from '../config/env.js';
import { currentInstance, OWNER_INSTANCE } from '../lib/scope.js';
import type { BotConfig, Language } from '../types.js';

async function row(): Promise<BotConfig> {
  const id = currentInstance();
  const existing = await prisma.botConfig.findUnique({ where: { id } });
  if (existing) return existing;
  // Buyer rows are created by provisioning; only the owner's is born here.
  if (id !== OWNER_INSTANCE) throw new Error(`Bot instance ${id} does not exist.`);
  return prisma.botConfig.create({
    data: {
      id,
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
 * from WhatsApp or the dashboard. The owner number of the owner's own bot always
 * follows .env, since a stale value there would lock the real owner out.
 */
export async function getConfig(): Promise<BotConfig> {
  const current = await row();
  if (current.id === OWNER_INSTANCE && config.bot.ownerNumber && current.ownerNumber !== config.bot.ownerNumber) {
    return prisma.botConfig.update({ where: { id: current.id }, data: { ownerNumber: config.bot.ownerNumber } });
  }
  return current;
}

export async function updateConfig(patch: Partial<BotConfig>): Promise<BotConfig> {
  const current = await row();
  return prisma.botConfig.update({ where: { id: current.id }, data: patch });
}

export async function setPrefix(prefix: string): Promise<BotConfig> {
  if (!/^[!./#]$/.test(prefix)) {
    throw new Error('Prefix must be one of: . ! / #');
  }
  return updateConfig({ prefix });
}

export async function setLanguage(language: Language): Promise<BotConfig> {
  return updateConfig({ language });
}
