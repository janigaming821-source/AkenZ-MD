import { DateTime } from 'luxon';
import { prisma } from '../db/client.js';
import { config } from '../config/env.js';
import { formatDateTime } from './format.js';
import type { Command } from '../types.js';

const tz = () => config.bot.timezone;

const schedule: Command = {
  name: 'schedule',
  category: 'owner',
  description: 'Send yourself a reminder in N minutes.',
  usage: 'schedule <minutes> <message>',
  ownerOnly: true,
  inMenu: true,
  async execute(ctx) {
    const minutes = Number.parseInt(ctx.args[0] ?? '', 10);
    const message = ctx.fullArgs.replace(/^\S+\s*/, '').trim();
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10_080 || !message) {
      await ctx.reply(ctx.t('schedule.badTime'));
      return;
    }
    const runAt = new Date(Date.now() + minutes * 60_000);
    await prisma.scheduledTask.create({
      data: { chatJid: ctx.chatJid, message: message.slice(0, 1000), runAt, createdBy: ctx.senderJid },
    });
    await ctx.reply(ctx.t('schedule.added', { time: formatDateTime(runAt, tz()) }));
  },
};

const schedules: Command = {
  name: 'schedules',
  category: 'owner',
  description: 'List pending scheduled tasks.',
  usage: 'schedules',
  ownerOnly: true,
  inMenu: true,
  async execute(ctx) {
    const rows = await prisma.scheduledTask.findMany({
      where: { status: 'pending' },
      orderBy: { runAt: 'asc' },
      take: 20,
    });
    if (!rows.length) {
      await ctx.reply(ctx.t('schedule.empty'));
      return;
    }
    await ctx.reply(
      [
        ctx.t('schedule.list'),
        ...rows.map(
          (r) =>
            `#${r.id} · ${DateTime.fromJSDate(r.runAt).setZone(tz()).toFormat('dd LLL HH:mm')} · ${r.message.slice(0, 60)}`,
        ),
      ].join('\n'),
    );
  },
};

const delschedule: Command = {
  name: 'delschedule',
  category: 'owner',
  description: 'Cancel a scheduled task by id.',
  usage: 'delschedule <id>',
  ownerOnly: true,
  inMenu: true,
  async execute(ctx) {
    const id = Number.parseInt(ctx.args[0] ?? '', 10);
    if (!Number.isFinite(id)) {
      await ctx.reply(ctx.t('schedule.needTime', { prefix: ctx.prefix }));
      return;
    }
    const removed = await prisma.scheduledTask.deleteMany({ where: { id } });
    await ctx.reply(removed.count ? ctx.t('schedule.deleted', { id }) : ctx.t('error.notFound'));
  },
};

export const scheduleCommands = [schedule, schedules, delschedule];
