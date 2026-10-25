import type { AnyMessageContent, WAMessage } from 'baileys';
import { config } from '../config/env.js';
import { getConfig } from '../db/config.js';
import { matchAutoReply } from '../db/autoreplies.js';
import { getCustomCommand } from '../db/customCommands.js';
import { getGroupSettings, upsertGroup } from '../db/groups.js';
import { touchUser, getUser, setUserLanguage } from '../db/users.js';
import { recordActivity } from '../db/stats.js';
import { logError } from '../db/botLog.js';
import { prisma } from '../db/client.js';
import { cacheMessage, checkAntiLink, checkAntiSpam } from './groupProtect.js';
import { t, detectLanguage, isLanguage, type Language } from '../i18n/index.js';
import type { BotConfig, CommandContext } from '../types.js';
import { whatsapp, type InboundMessage } from '../whatsapp/client.js';
import { getText } from '../whatsapp/extract.js';
import { hasAdminRights, isBotAdmin, isOwner } from './permissions.js';
import { resolveCommand } from './registry.js';
import { intentOf } from './intents.js';
import { currentInstance, OWNER_INSTANCE, scoped } from '../lib/scope.js';
import { isExpired } from '../whatsapp/instances.js';
import { copy as topupCopy, topupReady } from '../lib/topup.js';
import {
  TOPUP_COMMAND_NAMES,
  TOPUP_ORIENT_NAMES,
  draftOf,
  handleTopupChat,
  relayAnswer,
} from '../commands/topup.js';

const seenGroups = new Set<string>();
const rateWindows = new Map<string, number>();

function rateLimitHit(key: string, seconds: number): { blocked: boolean; retryIn: number } {
  const now = Date.now();
  const expires = rateWindows.get(key) ?? 0;
  if (expires > now) return { blocked: true, retryIn: Math.ceil((expires - now) / 1000) };
  rateWindows.set(key, now + seconds * 1000);
  if (rateWindows.size > 5000) {
    for (const [k, v] of rateWindows) if (v <= now) rateWindows.delete(k);
  }
  return { blocked: false, retryIn: 0 };
}

async function resolveLanguage(
  senderJid: string,
  text: string,
  settings: BotConfig,
): Promise<Language> {
  // A message written in Sinhala is answered in Sinhala, whatever is stored.
  const detected = detectLanguage(text);
  if (detected) return detected;
  const user = await getUser(senderJid);
  // An unset preference means "follow the bot default", so changing the default
  // on the dashboard actually reaches people.
  if (user?.language && isLanguage(user.language)) return user.language;
  return isLanguage(settings.language) ? settings.language : 'en';
}

export async function handleInbound(inbound: InboundMessage): Promise<void> {
  const { message, isGroup, jid: chatJid, pushName } = inbound;
  const buyer = currentInstance() !== OWNER_INSTANCE;
  // The seller's own number is the top-up counter: it answers orders, prices
  // and questions and nothing else. A buyer's bot keeps its full command set.
  const topupLine = !buyer && topupReady();
  // A buyer's bot runs on the buyer's own number, so their phone is the only
  // way they can command it. Baileys echoes the bot's own sends with 3EB0 ids.
  const selfCommand = buyer && inbound.fromMe && !message.key.id?.startsWith('3EB0');
  if (inbound.fromMe && !selfCommand) return;

  const settings = await getConfig();
  if (buyer && isExpired(settings)) return;
  const senderJid = selfCommand
    ? whatsapp.selfJid ?? chatJid
    : isGroup ? inbound.participant ?? chatJid : chatJid;
  const text = getText(message);
  // A caption-less picture is nothing to any bot — except the counter, where a
  // slip photo arrives exactly like that and is the next step of an order.
  if (!text && !(topupLine && !isGroup)) return;

  try {
    await touchUser(senderJid, pushName);
    if (isGroup && !seenGroups.has(chatJid)) {
      seenGroups.add(chatJid);
      await upsertGroup(chatJid, null);
    }
  } catch (error) {
    logError('handler', 'Could not record inbound activity', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const groupSettings = isGroup ? await getGroupSettings(chatJid) : null;
  const prefix = groupSettings?.prefix || settings.prefix;
  if (selfCommand && !(text.startsWith(prefix) && text.length > prefix.length)) return;
  const lang = await resolveLanguage(senderJid, text, settings);
  // The seller's OWNER_JID only means something on the seller's own bot.
  const owner = selfCommand || isOwner(senderJid, settings.ownerNumber, buyer ? undefined : config.bot.ownerJid);

  const sock = whatsapp.socket;
  if (!sock) return;

  if (isGroup) {
    cacheMessage(inbound);
    if (await checkAntiLink(inbound)) return;
    if (await checkAntiSpam(inbound)) return;
  }

  const replyText = (body: string) => sock.sendMessage(chatJid, { text: body }, { quoted: message });

  const buildContext = (command: string, args: string[], fullArgs: string): CommandContext => ({
    receivedAt: inbound.receivedAt,
    command,
    args,
    fullArgs,
    text,
    prefix,
    lang,
    settings,
    chatJid,
    isGroup,
    groupJid: isGroup ? chatJid : null,
    senderJid,
    pushName,
    isOwner: owner,
    isTopup: topupLine,
    topupCopy: topupLine ? topupCopy() : undefined,
    isAdmin: async () => (isGroup ? hasAdminRights(sock, chatJid, senderJid) : owner),
    isBotAdmin: async () => (isGroup ? isBotAdmin(sock, chatJid, whatsapp.selfJid) : false),
    message,
    reply: async (body, options = {}) => {
      await sock.sendMessage(
        chatJid,
        {
          text: body,
          ...(options.mentions?.length ? { mentions: options.mentions } : {}),
        },
        // Reply-quotes are what make a bot chat readable; status() opts out.
        options.quoted === false ? {} : { quoted: message }
      );
    },
    sendMedia: async (content: AnyMessageContent) => {
      await sock.sendMessage(chatJid, content);
    },
    t: (key, vars) => t(lang, key, vars),
    status: async (body) => {
      await sock.sendMessage(chatJid, { text: body });
    },
  });

  const looksLikeCommand = text.startsWith(prefix) && text.length > prefix.length;
  // A customer at the counter types the word, not the command. An open order
  // comes first: while a draft is alive every reply is its next step, and the
  // seller's own messages stay theirs because a relay must never be parsed.
  const spoken =
    !looksLikeCommand && !owner && topupLine && !isGroup && !draftOf(chatJid)
      ? intentOf(text)
      : undefined;

  if (!looksLikeCommand && !spoken) {
    recordActivity(chatJid, isGroup).catch(() => {});
    if (topupLine && !isGroup) {
      // The seller replying to a forwarded question wins over everything else.
      if (await relayAnswer(message).catch(() => false)) return;
      const answered = await handleTopupChat(buildContext('chat', [], text)).catch(() => false);
      if (answered) return;
    }
    if (settings.autoReplyEnabled) {
      const hit = await matchAutoReply(text);
      if (hit) await replyText(hit.response);
    }
    return;
  }

  const [rawName = '', ...rest] = text.slice(prefix.length).trim().split(/\s+/);
  const name = spoken?.command.name ?? rawName.toLowerCase();
  const args = spoken?.args ?? rest;
  const fullArgs = args.join(' ');
  if (!name) return;

  const command = spoken?.command ?? resolveCommand(name);
  // Counting is a nice-to-have; a failed insert must never eat the reply.
  recordActivity(chatJid, isGroup, name).catch(() => {});

  // On the counter, a customer gets the shop and nothing else. Custom commands
  // and the rest of the AkenZ MD feature set stay for the buyer-owned bots.
  if (topupLine && !owner && !TOPUP_COMMAND_NAMES.has(name) && !TOPUP_ORIENT_NAMES.has(name)) {
    await replyText(t(lang, 'topup.notForThisBot', { prices: `${prefix}prices`, buy: `${prefix}buy` }));
    return;
  }

  if (!command) {
    const custom = await getCustomCommand(name);
    if (custom) await replyText(custom.response);
    return;
  }

  if (command.ownerOnly && !owner) {
    await replyText(t(lang, 'error.notOwner'));
    await prisma.botLog.create({
      data: {
        level: 'warn',
        scope: 'security',
        message: 'Blocked an owner-only command attempt',
        meta: JSON.stringify({ command: name, group: isGroup }),
      },
    });
    return;
  }

  if (command.groupOnly && !isGroup) {
    await replyText(t(lang, 'error.notInGroup'));
    return;
  }

  if (command.adminOnly && !owner && !(await hasAdminRights(sock, chatJid, senderJid))) {
    await replyText(t(lang, 'error.notAdmin'));
    return;
  }

  if (command.rateLimitSeconds) {
    const hit = rateLimitHit(scoped(`${senderJid}:${name}`), command.rateLimitSeconds);
    if (hit.blocked) {
      await replyText(t(lang, 'error.rateLimited', { seconds: hit.retryIn }));
      return;
    }
  }

  const ctx = buildContext(name, args, fullArgs);

  try {
    await command.execute(ctx);
    if (command.ownerOnly) {
      await prisma.ownerAction.create({
        data: { action: name, detail: fullArgs.slice(0, 200), actorJid: senderJid },
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    await logError('command', `Command .${name} failed`, { detail: error instanceof Error ? error.message : detail });
    await replyText(t(lang, 'error.generic'));
  }
}

/** Used by .language and the dashboard when the owner changes the default. */
export async function rememberLanguage(senderJid: string, language: Language): Promise<void> {
  await setUserLanguage(senderJid, language);
}
