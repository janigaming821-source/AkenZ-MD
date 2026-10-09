import { getGroupSettings, updateGroupSettings } from '../db/groups.js';
import { activeWarningCount, addWarning, clearWarnings, listWarnings } from '../db/warnings.js';
import { logWarn } from '../db/botLog.js';
import { whatsapp } from '../whatsapp/client.js';
import { invalidateGroupCache } from '../bot/permissions.js';
import { isSelfJid, resolveTargetJid } from '../bot/targets.js';
import type { Command, CommandContext } from '../types.js';

const lastTagAll = new Map<string, number>();

function requireGroup(ctx: CommandContext): boolean {
  return ctx.isGroup && Boolean(ctx.groupJid);
}

async function groupMeta(ctx: CommandContext) {
  const sock = whatsapp.socket;
  if (!sock || !ctx.groupJid) throw new Error('not connected');
  return sock.groupMetadata(ctx.groupJid);
}

const groupinfo: Command = {
  name: 'groupinfo',
  category: 'group',
  description: 'Show group details.',
  usage: 'groupinfo',
  groupOnly: true,
  inMenu: true,
  async execute(ctx) {
    if (!requireGroup(ctx)) return;
    const meta = await groupMeta(ctx);
    const admins = meta.participants.filter((p) => p.admin);
    const restrictions = [
      meta.announce ? 'messages: admins only' : 'messages: everyone',
      meta.restrict ? 'settings: admins only' : 'settings: everyone',
    ].join(', ');
    await ctx.reply(
      ctx.t('group.info', {
        subject: meta.subject,
        members: meta.participants.length,
        admins: admins.length,
        restrictions,
      }),
    );
  },
};

const admins: Command = {
  name: 'admins',
  category: 'group',
  description: 'List group admins.',
  usage: 'admins',
  groupOnly: true,
  inMenu: true,
  async execute(ctx) {
    const meta = await groupMeta(ctx);
    const list = meta.participants.filter((p) => p.admin);
    if (!list.length) {
      await ctx.reply(ctx.t('group.noAdmins'));
      return;
    }
    await ctx.reply(
      [ctx.t('group.admins'), ...list.map((p) => `@${p.id.split('@')[0]}`)].join('\n'),
      { mentions: list.map((p) => p.id) },
    );
  },
};

const tagall: Command = {
  name: 'tagall',
  category: 'group',
  description: 'Mention every member (admin only, cooldown applies).',
  usage: 'tagall [message]',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const meta = await groupMeta(ctx);
    const last = lastTagAll.get(ctx.groupJid!) ?? 0;
    const settings = await getGroupSettings(ctx.groupJid!);
    const cooldownMs = settings.tagallCooldown * 1000;
    if (Date.now() - last < cooldownMs && !ctx.isOwner) {
      await ctx.reply(
        ctx.t('group.tagall.cooldown', { seconds: Math.ceil((cooldownMs - (Date.now() - last)) / 1000) }),
      );
      return;
    }
    lastTagAll.set(ctx.groupJid!, Date.now());
    const ids = meta.participants.map((p) => p.id);
    const note = ctx.fullArgs.trim();
    await ctx.reply(
      [`📣 *${meta.subject}*`, note ? `\n${note}` : '', ...ids.map((id) => `@${id.split('@')[0]}`)].filter(Boolean).join('\n'),
      { mentions: ids },
    );
    await ctx.reply(ctx.t('group.tagall', { count: ids.length }));
  },
};

const rules: Command = {
  name: 'rules',
  category: 'group',
  description: 'Show the group rules. Admins can set them: rules <text>',
  usage: 'rules [text]',
  groupOnly: true,
  inMenu: true,
  async execute(ctx) {
    const settings = await getGroupSettings(ctx.groupJid!);
    if (!ctx.fullArgs.trim()) {
      await ctx.reply(settings.rules.trim() ? `📜 ${settings.rules}` : ctx.t('group.rules.empty'));
      return;
    }
    if (!ctx.isOwner && !(await ctx.isAdmin())) {
      await ctx.reply(ctx.t('error.notAdmin'));
      return;
    }
    await updateGroupSettings(ctx.groupJid!, { rules: ctx.fullArgs.trim().slice(0, 1000) });
    await ctx.reply(ctx.t('group.rules.set'));
  },
};

const link: Command = {
  name: 'link',
  category: 'group',
  description: 'Show the group invite link.',
  usage: 'link',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const sock = whatsapp.socket!;
    const code = await sock.groupInviteCode(ctx.groupJid!);
    if (!code) {
      await ctx.reply(ctx.t('group.actionFailed'));
      return;
    }
    await ctx.reply(ctx.t('group.link', { code }));
  },
};

const promote: Command = {
  name: 'promote',
  category: 'group',
  description: 'Make a member an admin (owner or admin).',
  usage: 'promote @user  (or reply to their message)',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    const sock = whatsapp.socket!;
    try {
      await sock.groupParticipantsUpdate(ctx.groupJid!, [target], 'promote');
      invalidateGroupCache(ctx.groupJid!);
      await ctx.reply(ctx.t('group.promoted', { name: `@${target.split('@')[0]}` }));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const demote: Command = {
  name: 'demote',
  category: 'group',
  description: 'Remove admin rights.',
  usage: 'demote @user',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    try {
      await whatsapp.socket!.groupParticipantsUpdate(ctx.groupJid!, [target], 'demote');
      invalidateGroupCache(ctx.groupJid!);
      await ctx.reply(ctx.t('group.demoted', { name: `@${target.split('@')[0]}` }));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const add: Command = {
  name: 'add',
  category: 'group',
  description: 'Add a number to this group.',
  usage: 'add <94771234567>',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    try {
      const result = await whatsapp.socket!.groupParticipantsUpdate(ctx.groupJid!, [target], 'add');
      if (result?.[0]?.status === 'error' || result?.[0]?.status === 'fail') {
        await ctx.reply(ctx.t('group.addFailed'));
        return;
      }
      await ctx.reply(ctx.t('group.added', { name: `@${target.split('@')[0]}` }));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const remove: Command = {
  name: 'remove',
  category: 'group',
  description: 'Remove a member from this group.',
  usage: 'remove @user',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    if (isSelfJid(target)) return ctx.reply(ctx.t('warn.self'));
    try {
      await whatsapp.socket!.groupParticipantsUpdate(ctx.groupJid!, [target], 'remove');
      await ctx.reply(ctx.t('group.removed', { name: `@${target.split('@')[0]}` }));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const mute: Command = {
  name: 'mute',
  category: 'group',
  description: 'Restrict messaging to admins.',
  usage: 'mute',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    try {
      await whatsapp.socket!.groupSettingUpdate(ctx.groupJid!, 'announcement');
      await updateGroupSettings(ctx.groupJid!, { muted: true });
      await ctx.reply(ctx.t('group.muted'));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const unmute: Command = {
  name: 'unmute',
  category: 'group',
  description: 'Let everyone message again.',
  usage: 'unmute',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    try {
      await whatsapp.socket!.groupSettingUpdate(ctx.groupJid!, 'not_announcement');
      await updateGroupSettings(ctx.groupJid!, { muted: false });
      await ctx.reply(ctx.t('group.unmuted'));
    } catch {
      await ctx.reply(ctx.t('group.actionFailed'));
    }
  },
};

const warn: Command = {
  name: 'warn',
  category: 'group',
  description: 'Warn a member. Admins only.',
  usage: 'warn @user [reason]',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    if (isSelfJid(target) || target === ctx.senderJid) return ctx.reply(ctx.t('warn.self'));
    const reason = ctx.fullArgs.replace(/@\d+\s*/, '').trim() || '—';
    const record = await addWarning(ctx.groupJid!, target, reason, ctx.senderJid);
    const count = await activeWarningCount(ctx.groupJid!, target);
    const max = ctx.settings.maxWarnings;
    await ctx.reply(ctx.t('warn.added', { count, max, name: `@${target.split('@')[0]}`, reason }), {
      mentions: [target],
    });

    if (count >= max) {
      await ctx.reply(ctx.t('warn.limit', { name: `@${target.split('@')[0]}`, max }), { mentions: [target] });
      if (ctx.settings.warningAction === 'remove') {
        try {
          await whatsapp.socket!.groupParticipantsUpdate(ctx.groupJid!, [target], 'remove');
          await clearWarnings(ctx.groupJid!, target);
        } catch {
          await ctx.reply(ctx.t('group.actionFailed'));
          await logWarn('groups', 'Warning limit removal refused by WhatsApp', { record: record.id });
        }
      } else {
        // WhatsApp offers no per-member mute, so nothing destructive is guessed.
        await ctx.reply(
          'Per-member mute is not available on WhatsApp. Set `warningAction` to `remove` to remove at the limit.',
        );
      }
    }
  },
};

const warnings: Command = {
  name: 'warnings',
  category: 'group',
  description: 'Show warnings for a member, or clear them: warnings clear @user',
  usage: 'warnings [@user] [clear]',
  groupOnly: true,
  adminOnly: true,
  inMenu: false,
  async execute(ctx) {
    const target = await resolveTargetJid(ctx);
    if (!target) {
      await ctx.reply(ctx.t('group.needTarget'));
      return;
    }
    if (ctx.args.includes('clear')) {
      const cleared = await clearWarnings(ctx.groupJid!, target);
      await ctx.reply(ctx.t('warn.cleared', { name: `@${target.split('@')[0]}` }) + ` (${cleared})`);
      return;
    }
    const rows = await listWarnings(ctx.groupJid!, target);
    if (!rows.length) {
      await ctx.reply(ctx.t('warn.none', { name: `@${target.split('@')[0]}` }));
      return;
    }
    await ctx.reply(
      [
        ctx.t('warn.list', { name: `@${target.split('@')[0]}`, count: rows.length, max: ctx.settings.maxWarnings }),
        ...rows.map((w, i) => `${i + 1}. ${w.reason} — ${w.createdAt.toISOString().slice(0, 10)}`),
      ].join('\n'),
    );
  },
};

const antilink: Command = {
  name: 'antilink',
  category: 'group',
  description: 'Toggle link deletion. Admin only.',
  usage: 'antilink on|off',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(ctx.t('help.usage', { usage: `${ctx.prefix}antilink <on|off>` }));
      return;
    }
    const enabled = sub === 'on';
    await updateGroupSettings(ctx.groupJid!, { antiLink: enabled });
    await ctx.reply(`Anti-link ${enabled ? 'enabled' : 'disabled'}.`);
  },
};

const antidelete: Command = {
  name: 'antidelete',
  category: 'group',
  description: 'Show deleted messages. Admin only.',
  usage: 'antidelete on|off',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(ctx.t('help.usage', { usage: `${ctx.prefix}antidelete <on|off>` }));
      return;
    }
    const enabled = sub === 'on';
    await updateGroupSettings(ctx.groupJid!, { antiDelete: enabled });
    await ctx.reply(`Anti-delete ${enabled ? 'enabled' : 'disabled'}.`);
  },
};

const antispam: Command = {
  name: 'antispam',
  category: 'group',
  description: 'Toggle spam detection. Admin only.',
  usage: 'antispam on|off',
  groupOnly: true,
  adminOnly: true,
  inMenu: true,
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(ctx.t('help.usage', { usage: `${ctx.prefix}antispam <on|off>` }));
      return;
    }
    const enabled = sub === 'on';
    await updateGroupSettings(ctx.groupJid!, { antiSpam: enabled });
    await ctx.reply(`Anti-spam ${enabled ? 'enabled' : 'disabled'}.`);
  },
};

export const groupCommands = [
  groupinfo,
  admins,
  tagall,
  rules,
  link,
  promote,
  demote,
  add,
  remove,
  mute,
  unmute,
  warn,
  warnings,
  antilink,
  antidelete,
  antispam,
];
