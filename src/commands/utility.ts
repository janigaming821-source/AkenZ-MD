import { prisma } from '../db/client.js';
import type { Command, CommandContext } from '../types.js';

const note: Command = {
  name: 'note',
  category: 'utility',
  description: 'Save, list, or delete personal notes.',
  usage: 'note save <title> | <content>  /  note list  /  note delete <id>',
  inMenu: true,
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'list' || sub === 'all') {
      const rows = await prisma.note.findMany({
        where: { userJid: ctx.senderJid },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      if (!rows.length) {
        await ctx.reply('No notes yet. Save one: .note save My Title | My note text');
        return;
      }
      const lines = rows.map((n) => `#${n.id}  ${n.title}  (${n.createdAt.toISOString().slice(0, 10)})`);
      await ctx.reply(`Your notes:\n${lines.join('\n')}`);
      return;
    }

    if (sub === 'delete' || sub === 'remove' || sub === 'del') {
      const id = Number(ctx.args[1]);
      if (!Number.isFinite(id)) {
        await ctx.reply('Usage: .note delete <id>');
        return;
      }
      const found = await prisma.note.findFirst({ where: { id, userJid: ctx.senderJid } });
      if (!found) {
        await ctx.reply('Note not found or not yours.');
        return;
      }
      await prisma.note.delete({ where: { id } });
      await ctx.reply(`Note #${id} deleted.`);
      return;
    }

    if (sub === 'save' || sub === 'add' || sub === 'new') {
      const rest = ctx.fullArgs.slice(sub.length).trim();
      const sepIdx = rest.indexOf('|');
      if (sepIdx < 0) {
        await ctx.reply('Usage: .note save <title> | <content>');
        return;
      }
      const title = rest.slice(0, sepIdx).trim().slice(0, 100);
      const content = rest.slice(sepIdx + 1).trim().slice(0, 2000);
      if (!title || !content) {
        await ctx.reply('Both title and content are required.');
        return;
      }
      const created = await prisma.note.create({
        data: { userJid: ctx.senderJid, title, content },
      });
      await ctx.reply(`Note #${created.id} saved: "${title}"`);
      return;
    }

    if (sub && ctx.args.length >= 2) {
      const title = sub;
      const content = ctx.args.slice(1).join(' ').slice(0, 2000);
      if (!content) {
        await ctx.reply('Usage: .note save <title> | <content>');
        return;
      }
      const created = await prisma.note.create({
        data: { userJid: ctx.senderJid, title: title.slice(0, 100), content },
      });
      await ctx.reply(`Note #${created.id} saved: "${title}"`);
      return;
    }

    await ctx.reply('Usage: .note save <title> | <content>  /  .note list  /  .note delete <id>');
  },
};

const remind: Command = {
  name: 'remind',
  category: 'utility',
  description: 'Set a reminder. Time: 30m, 2h, 1d, or a specific time like 14:30.',
  usage: 'remind <time> <message>',
  inMenu: true,
  async execute(ctx) {
    if (ctx.args.length < 2) {
      await ctx.reply('Usage: .remind <time> <message>\nExamples: .remind 30m Take a break\n.remind 2h Call mom\n.remind 1d Submit report');
      return;
    }

    const timeArg = ctx.args[0]!.toLowerCase();
    const message = ctx.args.slice(1).join(' ').slice(0, 500);
    if (!message) {
      await ctx.reply('Please include a reminder message.');
      return;
    }

    const runAt = parseTime(timeArg);
    if (!runAt) {
      await ctx.reply('Invalid time. Use: 30m, 2h, 1d, or a time like 14:30');
      return;
    }

    const task = await prisma.scheduledTask.create({
      data: {
        chatJid: ctx.chatJid,
        message: `Reminder: ${message}`,
        kind: 'reminder',
        runAt,
        createdBy: ctx.senderJid,
      },
    });

    const inHuman = formatDuration(runAt.getTime() - Date.now());
    await ctx.reply(`Reminder set for ${inHuman} from now. (ID: #${task.id})`);
  },
};

const reminders: Command = {
  name: 'reminders',
  category: 'utility',
  description: 'List your pending reminders or cancel one.',
  usage: 'reminders [cancel <id>]',
  inMenu: true,
  async execute(ctx) {
    if (ctx.args[0]?.toLowerCase() === 'cancel' || ctx.args[0]?.toLowerCase() === 'delete') {
      const id = Number(ctx.args[1]);
      if (!Number.isFinite(id)) {
        await ctx.reply('Usage: .reminders cancel <id>');
        return;
      }
      const found = await prisma.scheduledTask.findFirst({
        where: { id, createdBy: ctx.senderJid, status: 'pending' },
      });
      if (!found) {
        await ctx.reply('Reminder not found or already done.');
        return;
      }
      await prisma.scheduledTask.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      await ctx.reply(`Reminder #${id} cancelled.`);
      return;
    }

    const rows = await prisma.scheduledTask.findMany({
      where: { createdBy: ctx.senderJid, status: 'pending' },
      orderBy: { runAt: 'asc' },
      take: 15,
    });
    if (!rows.length) {
      await ctx.reply('No pending reminders. Set one: .remind 30m Take a break');
      return;
    }
    const lines = rows.map((r) => {
      const when = r.runAt.toISOString().replace('T', ' ').slice(0, 16);
      return `#${r.id}  ${when}  ${r.message.replace('Reminder: ', '')}`;
    });
    await ctx.reply(`Your reminders:\n${lines.join('\n')}`);
  },
};

function parseTime(input: string): Date | null {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2];
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return new Date(Date.now() + value * ms);
  }

  const timeMatch = input.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  return null;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export const utilityCommands = [note, remind, reminders];
