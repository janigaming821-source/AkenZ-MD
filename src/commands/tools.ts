import QRCode from 'qrcode';
import {
  currentWeather,
  defineWord,
  shortenUrl,
  translateText,
  wikiSummary,
  aiIsConfigured,
} from '../tools/api.js';
import { inspectUrl, validatePublicUrl } from '../tools/url.js';
import type { Command } from '../types.js';

const weather: Command = {
  name: 'weather',
  category: 'tools',
  description: 'Current conditions for a place.',
  usage: 'weather <city>',
  inMenu: true,
  rateLimitSeconds: 10,
  async execute(ctx) {
    const city = ctx.fullArgs.trim();
    if (!city) {
      await ctx.reply(ctx.t('error.noText'));
      return;
    }
    const result = await currentWeather(city);
    if (!result.ok) {
      await ctx.reply(
        result.reason === 'not-configured'
          ? 'API configuration required. Set WEATHER_API_KEY for OpenWeatherMap, or use WEATHER_PROVIDER=open-meteo.'
          : result.reason === 'not-found'
            ? ctx.t('weather.notFound', { city })
            : ctx.t('weather.failed'),
      );
      return;
    }
    const w = result.data;
    await ctx.reply(
      [
        `🌤 *${w.location}${w.country ? `, ${w.country}` : ''}*`,
        `🌡 ${w.temperatureC}°C (feels ${w.feelsLikeC}°C)`,
        `☁️ ${w.condition}`,
        `💧 ${w.humidity}%  ·  🌬 ${w.windKph} km/h`,
      ].join('\n'),
    );
  },
};

const translate: Command = {
  name: 'translate',
  category: 'tools',
  description: 'Translate text: translate <si|en> <text>',
  usage: 'translate <si|en> <text>',
  inMenu: true,
  aliases: ['tr'],
  rateLimitSeconds: 5,
  async execute(ctx) {
    const [target, ...rest] = ctx.args;
    const text = rest.join(' ').trim();
    if (!target || !text) {
      await ctx.reply(ctx.t('translate.needText', { prefix: ctx.prefix }));
      return;
    }
    const to = target.toLowerCase();
    if (!['en', 'si'].includes(to)) {
      await ctx.reply(ctx.t('translate.needText', { prefix: ctx.prefix }));
      return;
    }
    const result = await translateText(text, to);
    if (!result.ok) {
      await ctx.reply(
        result.reason === 'not-configured'
          ? 'API configuration required for that translator.'
          : ctx.t('translate.failed'),
      );
      return;
    }
    await ctx.reply(`🌐 ${result.data}`);
  },
};

const qr: Command = {
  name: 'qr',
  category: 'tools',
  description: 'Make a QR image from text or a link.',
  usage: 'qr <text|url>',
  inMenu: true,
  rateLimitSeconds: 5,
  async execute(ctx) {
    const value = ctx.fullArgs.trim();
    if (!value) {
      await ctx.reply(ctx.t('qr.needText', { prefix: ctx.prefix }));
      return;
    }
    if (value.length > 800) {
      await ctx.reply(ctx.t('qr.tooLong'));
      return;
    }
    const buffer = await QRCode.toBuffer(value, {
      type: 'png',
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
    await ctx.sendMedia({ image: buffer, caption: `QR for: ${value.slice(0, 120)}` });
  },
};

const short: Command = {
  name: 'short',
  category: 'tools',
  description: 'Shorten a public link.',
  usage: 'short <url>',
  inMenu: true,
  rateLimitSeconds: 10,
  async execute(ctx) {
    const raw = ctx.args[0]?.trim();
    if (!raw) {
      await ctx.reply(ctx.t('short.needUrl', { prefix: ctx.prefix }));
      return;
    }
    const validated = await validatePublicUrl(raw);
    if (!validated.ok) {
      await ctx.reply(ctx.t('error.invalidUrl'));
      return;
    }
    const result = await shortenUrl(validated.url.toString());
    if (!result.ok) {
      await ctx.reply(ctx.t('short.failed'));
      return;
    }
    await ctx.reply(`🔗 ${result.data}`);
  },
};

const urlinfo: Command = {
  name: 'urlinfo',
  category: 'tools',
  description: 'Inspect a public URL (status, type, size).',
  usage: 'urlinfo <url>',
  inMenu: true,
  rateLimitSeconds: 10,
  async execute(ctx) {
    const raw = ctx.args[0]?.trim();
    if (!raw) {
      await ctx.reply(ctx.t('error.invalidUrl'));
      return;
    }
    const result = await inspectUrl(raw);
    if (!result.ok) {
      await ctx.reply(
        result.reason === 'private-address' || result.reason === 'private-host'
          ? 'That address points at a private network. Not allowed.'
          : ctx.t('error.invalidUrl'),
      );
      return;
    }
    const d = result.data;
    await ctx.reply(
      [
        ctx.t('urlinfo.title'),
        `URL: ${d.finalUrl}`,
        `Status: ${d.status}`,
        `Type: ${d.contentType}`,
        `Size: ${d.lengthBytes ? `${(d.lengthBytes / 1024).toFixed(1)} KB` : 'unknown'}`,
        `Server: ${d.server}`,
      ].join('\n'),
    );
  },
};

const wiki: Command = {
  name: 'wiki',
  category: 'tools',
  description: 'Short Wikipedia summary. Sinhala queries use Sinhala Wikipedia.',
  usage: 'wiki <topic>',
  inMenu: true,
  rateLimitSeconds: 8,
  async execute(ctx) {
    const query = ctx.fullArgs.trim();
    if (!query) {
      await ctx.reply(ctx.t('error.noText'));
      return;
    }
    const result = await wikiSummary(query);
    if (!result.ok) {
      await ctx.reply(result.reason === 'not-found' ? ctx.t('wiki.notFound', { query }) : ctx.t('wiki.failed'));
      return;
    }
    const w = result.data;
    await ctx.reply([`📖 *${w.title}*`, '', w.extract, w.url ? `🔗 ${w.url}` : ''].filter(Boolean).join('\n'));
  },
};

const define: Command = {
  name: 'define',
  category: 'tools',
  description: 'English dictionary definition of a word.',
  usage: 'define <word>',
  aliases: ['dict'],
  inMenu: true,
  rateLimitSeconds: 5,
  async execute(ctx) {
    const word = ctx.fullArgs.trim();
    if (!word) {
      await ctx.reply(ctx.t('error.noText'));
      return;
    }
    const result = await defineWord(word);
    if (!result.ok) {
      await ctx.reply(result.reason === 'not-found' ? ctx.t('define.notFound', { word }) : ctx.t('define.failed'));
      return;
    }
    const d = result.data;
    await ctx.reply(
      [
        `📚 *${d.word}*${d.phonetic ? ` ${d.phonetic}` : ''}`,
        ...d.meanings.map(
          (m) => `• (${m.partOfSpeech}) ${m.definition}${m.example ? `\n  “${m.example}”` : ''}`,
        ),
      ].join('\n'),
    );
  },
};

/** Present in the registry so .menu/.help stay honest about what actually works. */
const ai: Command = {
  name: 'ai',
  category: 'ai',
  description: 'Ask the AI. Needs AI_API_KEY configured.',
  usage: 'ai <question>',
  inMenu: true,
  rateLimitSeconds: 8,
  async execute(ctx) {
    if (!ctx.settings.aiEnabled || !aiIsConfigured()) {
      await ctx.reply(ctx.t('ai.disabled'));
      return;
    }
    const question = ctx.fullArgs.trim();
    if (!question) {
      await ctx.reply(ctx.t('ai.noQuestion', { prefix: ctx.prefix }));
      return;
    }
    const { askAi } = await import('../tools/api.js');
    const result = await askAi(ctx.chatJid, question);
    if (!result.ok) {
      await ctx.reply(result.reason === 'not-configured' ? ctx.t('ai.disabled') : ctx.t('ai.failed'));
      return;
    }
    await ctx.reply(result.data);
  },
};

export const toolCommands = [weather, translate, qr, short, urlinfo, wiki, define, ai];
