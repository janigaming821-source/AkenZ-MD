import { config } from '../config/env.js';
import { updateConfig } from '../db/config.js';
import { getStats } from '../db/stats.js';
import { getUser } from '../db/users.js';
import { languageName, t } from '../i18n/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command, CommandCategory, CommandContext, Language } from '../types.js';
import { connection, statusLabel } from '../whatsapp/state.js';
import { whatsapp } from '../whatsapp/client.js';
import { rememberLanguage } from '../bot/handler.js';
import { CATEGORY_ORDER, byCategory, resolveCommand } from '../bot/registry.js';
import { box, formatDateTime, formatUptime, section } from './format.js';

const startedAt = Date.now();
export const botStartedAt = () => startedAt;

const SECTION_ICONS: Partial<Record<CommandCategory, string>> = {
  general: '🧭',
  ai: '🤖',
  media: '🎬',
  group: '👥',
  tools: '🛠️',
  utility: '🗒️',
};

let cachedMenuImage: Buffer | null | undefined;

/** Optional banner sent together with the menu. Missing file → text-only menu. */
function menuImage(): Buffer | null {
  if (cachedMenuImage !== undefined) return cachedMenuImage;
  try {
    cachedMenuImage = readFileSync(resolve(process.cwd(), 'assets', 'menu.jpg'));
  } catch {
    cachedMenuImage = null;
  }
  return cachedMenuImage;
}

const menu: Command = {
  name: 'menu',
  category: 'general',
  description: 'Show the command menu.',
  usage: 'menu',
  inMenu: true,
  aliases: ['start', 'commands'],
  async execute(ctx: CommandContext) {
    const lines: string[] = [
      ctx.t('menu.greeting', { name: ctx.pushName || ctx.t('app.hello') }),
      '',
      ctx.t('menu.status', {
        status: ctx.t(connection.isConnected ? 'app.online' : 'app.offline'),
        version: ctx.settings.version,
      }),
    ];

    // Owner commands stay off the menu — they still work for the owner.
    const show: Array<[CommandCategory, boolean]> = [
      ['general', true],
      ['ai', ctx.settings.aiEnabled],
      ['media', ctx.settings.mediaEnabled],
      ['group', ctx.settings.groupToolsEnabled && ctx.isGroup],
      ['tools', true],
      ['utility', true],
    ];

    for (const [category, visible] of show) {
      if (!visible) continue;
      const commands = byCategory(category);
      if (!commands.length) continue;
      const icon = SECTION_ICONS[category] ? `${SECTION_ICONS[category]} ` : '';
      lines.push('', section(`${icon}${ctx.t(`menu.section.${category}`)}`));
      for (const command of commands) lines.push(`┃  .${command.name}`);
    }

    lines.push('', ctx.t('menu.hint', { prefix: ctx.prefix }));
    const text = box(ctx.t('menu.title', { name: ctx.settings.name }), lines);

    const image = menuImage();
    if (image) {
      await ctx.sendMedia({ image, caption: text });
      return;
    }
    await ctx.reply(text);
  },
};

const help: Command = {
  name: 'help',
  category: 'general',
  description: 'List commands, or explain one: help <command>.',
  usage: 'help [command]',
  inMenu: true,
  async execute(ctx) {
    const wanted = ctx.args[0]?.toLowerCase();
    if (wanted) {
      const command = resolveCommand(wanted);
      if (!command) {
        await ctx.reply(ctx.t('help.notFound', { command: wanted, prefix: ctx.prefix }));
        return;
      }
      await ctx.reply(
        [
          `.${command.name}`,
          ctx.t('help.description', { description: command.description }),
          ctx.t('help.usage', { usage: `${ctx.prefix}${command.usage}` }),
          command.aliases?.length ? `Aliases: ${command.aliases.map((a) => `.${a}`).join(', ')}` : '',
          command.ownerOnly ? t(ctx.lang, 'error.notOwner') : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      return;
    }

    const groups = CATEGORY_ORDER.map((category) => {
      const commands = byCategory(category).filter((c) => !c.ownerOnly || ctx.isOwner);
      if (!commands.length) return '';
      return [
        `*${ctx.t(`menu.section.${category}`)}*`,
        ...commands.map((c) => `\`${ctx.prefix}${c.usage}\` — ${c.description}`),
      ].join('\n');
    }).filter(Boolean);

    await ctx.reply([ctx.t('help.header', { name: ctx.settings.name, prefix: ctx.prefix }), ...groups].join('\n\n'));
  },
};

const ping: Command = {
  name: 'ping',
  category: 'general',
  description: 'End-to-end response time for this message.',
  usage: 'ping',
  inMenu: true,
  async execute(ctx) {
    await ctx.reply(ctx.t('ping.response', { ms: Math.max(0, Date.now() - ctx.receivedAt) }));
  },
};

const speed: Command = {
  name: 'speed',
  category: 'general',
  description: 'Round-trip time of a live WhatsApp account query.',
  usage: 'speed',
  inMenu: false,
  async execute(ctx) {
    const sock = whatsapp.socket;
    if (!sock) {
      await ctx.reply(ctx.t('error.generic'));
      return;
    }
    const started = Date.now();
    await sock.fetchPrivacySettings(true);
    await ctx.reply(`⚡ ${ctx.t('ping.reachable', { ms: Date.now() - started })}`);
  },
};

const bot: Command = {
  name: 'bot',
  category: 'general',
  description: 'About this bot.',
  usage: 'bot',
  inMenu: true,
  async execute(ctx) {
    await ctx.reply(
      ctx.t('bot.info', {
        name: ctx.settings.name,
        version: ctx.settings.version,
        prefix: ctx.prefix,
        status: statusLabel[connection.get().status],
      }),
    );
  },
};

const owner: Command = {
  name: 'owner',
  category: 'general',
  description: 'Show the owner contact.',
  usage: 'owner',
  inMenu: true,
  async execute(ctx) {
    const number = ctx.settings.ownerNumber;
    if (!number) {
      await ctx.reply(ctx.t('owner.noOwner'));
      return;
    }
    const record = await getUser(`${number}@s.whatsapp.net`);
    // A stranger must not be handed the owner's personal number.
    const shown = ctx.isOwner ? number : `${number.slice(0, 3)}${'X'.repeat(Math.max(1, number.length - 3))}`;
    await ctx.reply(ctx.t('owner.info', { name: record?.name ?? ctx.settings.name, number: shown }));
  },
};

const runtime: Command = {
  name: 'runtime',
  category: 'general',
  description: 'How long the bot has been running.',
  usage: 'runtime',
  inMenu: true,
  async execute(ctx) {
    await ctx.reply(
      ctx.t('runtime', {
        uptime: formatUptime(Date.now() - startedAt),
        wa: statusLabel[connection.get().status],
        prefix: ctx.prefix,
        language: languageName[ctx.lang],
      }),
    );
  },
};

const status: Command = {
  name: 'status',
  category: 'general',
  description: 'Bot status and the configured status text.',
  usage: 'status',
  inMenu: true,
  async execute(ctx) {
    const stats = await getStats();
    await ctx.reply(
      [
        `*${ctx.settings.statusText}*`,
        '',
        statusLabel[connection.get().status],
        `⏱ ${formatUptime(Date.now() - startedAt)}`,
        `👥 ${stats.users} · 🗂 ${stats.groups} · ✉️ ${stats.messages}`,
      ].join('\n'),
    );
  },
};

const profile: Command = {
  name: 'profile',
  category: 'general',
  description: 'What this bot has recorded about you.',
  usage: 'profile',
  inMenu: true,
  async execute(ctx) {
    const record = await getUser(ctx.senderJid);
    await ctx.reply(
      ctx.t('profile', {
        name: record?.name ?? ctx.pushName ?? '—',
        count: record?.messageCount ?? 0,
        language:
          languageName[
            record?.language === 'si' || record?.language === 'en' ? record.language : ctx.lang
          ],
        firstSeen: record ? formatDateTime(record.firstSeen, config.bot.timezone) : '—',
        lastSeen: record ? formatDateTime(record.lastSeen, config.bot.timezone) : '—',
        // The address WhatsApp gave this sender — a LID in 1:1 chats, not a phone
        // number. The owner needs it for OWNER_JID, and it is only ever shown to
        // the person it belongs to.
        id: ctx.senderJid,
      }),
    );
  },
};

const language: Command = {
  name: 'language',
  category: 'general',
  description: 'Switch language: language en | language si',
  usage: 'language <en|si>',
  inMenu: true,
  async execute(ctx) {
    const wanted = ctx.args[0]?.toLowerCase() as Language | undefined;
    if (wanted !== 'en' && wanted !== 'si') {
      await ctx.reply(ctx.t('language.invalid', { prefix: ctx.prefix }));
      return;
    }
    if (ctx.isOwner) await updateConfig({ language: wanted });
    // Everyone may pick their own reply language.
    await rememberLanguage(ctx.senderJid, wanted);
    await ctx.reply(t(wanted, 'language.changed'));
  },
};

const settings: Command = {
  name: 'settings',
  category: 'general',
  description: 'Show current bot settings.',
  usage: 'settings',
  inMenu: true,
  async execute(ctx) {
    const s = ctx.settings;
    const yes = (v: boolean) => (v ? '✅' : '❌');
    await ctx.reply(
      [
        ctx.t('settings.title'),
        '',
        ctx.t('settings.item', { label: ctx.t('label.name'), value: s.name }),
        ctx.t('settings.item', { label: ctx.t('label.prefix'), value: `\`${ctx.prefix}\`` }),
        ctx.t('settings.item', {
          label: ctx.t('label.language'),
          value: languageName[s.language === 'si' ? 'si' : 'en'],
        }),
        ctx.t('settings.item', { label: ctx.t('label.ai'), value: yes(s.aiEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.autoReply'), value: yes(s.autoReplyEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.welcome'), value: yes(s.welcomeEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.goodbye'), value: yes(s.goodbyeEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.media'), value: yes(s.mediaEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.groupTools'), value: yes(s.groupToolsEnabled) }),
        ctx.t('settings.item', { label: ctx.t('label.maxWarnings'), value: s.maxWarnings }),
      ].join('\n'),
    );
  },
};

export const generalCommands = [menu, help, ping, speed, bot, owner, runtime, status, profile, language, settings];
