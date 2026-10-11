import { config } from '../config/env.js';
import { prisma } from '../db/client.js';
import { logError, logInfo } from '../db/botLog.js';
import { downloader, DownloaderError } from '../media/downloader.js';
import { compressImage, resizeImage, stickerToImage, toSticker, videoToSticker } from '../media/images.js';
import { downloadMedia, getMediaType, mediaSourceMessage } from '../whatsapp/extract.js';
import { whatsapp } from '../whatsapp/client.js';
const hourly = new Map();
/** Per-user hourly cap, so the bot never turns into a download farm. */
function mediaQuota(senderJid) {
    const now = Date.now();
    const windowStart = now - 3_600_000;
    const hits = (hourly.get(senderJid) ?? []).filter((t) => t > windowStart);
    if (hits.length >= config.media.rateLimitPerHour)
        return { allowed: false, used: hits.length };
    hits.push(now);
    hourly.set(senderJid, hits);
    return { allowed: true, used: hits.length };
}
async function guard(ctx, kind) {
    if (!ctx.settings.mediaEnabled || !config.media.enabled) {
        await ctx.reply(ctx.t('media.disabled'));
        return false;
    }
    const quota = mediaQuota(ctx.senderJid);
    if (!quota.allowed) {
        await ctx.reply(ctx.t('media.rateLimited', { count: config.media.rateLimitPerHour }));
        return false;
    }
    if (!(await downloader.hasWorkingProvider())) {
        await ctx.reply(ctx.t('media.noBinary', { tool: 'yt-dlp' }));
        return false;
    }
    void prisma.mediaHistory.create({
        data: { kind, query: ctx.fullArgs.slice(0, 200), requester: ctx.senderJid, status: 'requested' },
    });
    return true;
}
function describe(info, kind) {
    const mm = Math.floor(info.durationSeconds / 60);
    const ss = String(info.durationSeconds % 60).padStart(2, '0');
    const icon = kind === 'video' ? '🎬' : '🎵';
    return [`${icon} ${info.title}`, `🎙 ${info.artist}`, `⏱ ${mm}:${ss}`, `🔗 ${info.webpageUrl}`].join('\n');
}
const music = {
    name: 'music',
    category: 'media',
    description: 'Find a track and send it as audio.',
    usage: 'music <search or url>',
    inMenu: true,
    rateLimitSeconds: 20,
    async execute(ctx) {
        const query = ctx.fullArgs.trim();
        if (!query)
            return ctx.reply(ctx.t('error.noText'));
        if (!(await guard(ctx, 'music')))
            return;
        try {
            const found = await downloader.find(query, 'audio');
            if (!found) {
                await ctx.reply(ctx.t('music.none', { query: query.slice(0, 60) }));
                return;
            }
            await ctx.status(describe(found.info, 'music'));
            // Download the exact video the preview picked, not a fresh search.
            const media = await downloader.download(found.info.webpageUrl, 'audio');
            await ctx.sendMedia({
                audio: media.buffer,
                mimetype: 'audio/mpeg',
                fileName: `${found.info.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.mp3`,
            });
            await logInfo('media', 'music delivered', { bytes: media.sizeBytes });
        }
        catch (error) {
            await reportMediaFailure(ctx, error);
        }
    },
};
const video = {
    name: 'video',
    category: 'media',
    description: 'Search YouTube and send the video.',
    usage: 'video <search or url>',
    inMenu: true,
    rateLimitSeconds: 30,
    async execute(ctx) {
        const query = ctx.fullArgs.trim();
        if (!query)
            return ctx.reply(ctx.t('error.noText'));
        if (!(await guard(ctx, 'video')))
            return;
        try {
            const found = await downloader.find(query, 'video');
            if (!found) {
                await ctx.reply(ctx.t('music.none', { query: query.slice(0, 60) }));
                return;
            }
            await ctx.status(describe(found.info, 'video'));
            // Download the exact video the preview picked, not a fresh search.
            const media = await downloader.download(found.info.webpageUrl, 'video');
            await ctx.sendMedia({
                video: media.buffer,
                mimetype: 'video/mp4',
                caption: found.info.title.slice(0, 200),
            });
            await logInfo('media', 'video delivered', { bytes: media.sizeBytes });
        }
        catch (error) {
            await reportMediaFailure(ctx, error);
        }
    },
};
async function reportMediaFailure(ctx, error) {
    if (error instanceof DownloaderError) {
        if (error.kind === 'unsupported')
            await ctx.reply(ctx.t('media.couldNotProcess'));
        else if (error.kind === 'too-large') {
            await ctx.reply(ctx.t('media.tooLarge', { mb: config.media.maxMb }));
        }
        else if (error.kind === 'missing-tool') {
            await ctx.reply(ctx.t('media.noBinary', { tool: 'ffmpeg' }));
        }
        else {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
        await logError('media', error.message, { detail: error.detail ?? '' });
        return;
    }
    await logError('media', 'Unexpected media failure', {
        detail: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply(ctx.t('media.couldNotProcess'));
}
/** Reads the media attached to the command, or to the message it quotes. */
async function inboundMedia(ctx) {
    const sock = whatsapp.socket;
    if (!sock)
        return null;
    const source = mediaSourceMessage(ctx.message);
    if (!source)
        return null;
    const type = getMediaType(source);
    if (!type || type === 'document')
        return null;
    const buffer = await downloadMedia(sock, source);
    return { buffer, type };
}
const sticker = {
    name: 'sticker',
    category: 'media',
    description: 'Turn an image or short video into a sticker.',
    usage: 'sticker  (send with a photo/video, or reply to one)',
    inMenu: true,
    rateLimitSeconds: 10,
    async execute(ctx) {
        if (!ctx.settings.mediaEnabled)
            return ctx.reply(ctx.t('media.disabled'));
        const media = await inboundMedia(ctx);
        if (!media) {
            await ctx.reply(ctx.t('sticker.needMedia', { prefix: ctx.prefix }));
            return;
        }
        try {
            const webp = media.type === 'video'
                ? await videoToSticker(media.buffer)
                : await toSticker(media.buffer);
            await ctx.sendMedia({ sticker: webp });
        }
        catch (error) {
            await logError('sticker', 'Sticker conversion failed', {
                detail: error instanceof Error ? error.message : String(error),
            });
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const toimg = {
    name: 'toimg',
    category: 'media',
    description: 'Convert a sticker back into an image.',
    usage: 'toimg  (reply to a sticker)',
    inMenu: true,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type !== 'sticker') {
            await ctx.reply(ctx.t('image.needImage', { prefix: ctx.prefix, command: 'toimg' }));
            return;
        }
        try {
            const png = await stickerToImage(media.buffer);
            await ctx.sendMedia({ image: png });
        }
        catch {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const compress = {
    name: 'compress',
    category: 'media',
    description: 'Recompress an image: compress [targetKB]',
    usage: 'compress [kb]  (with or replying to an image)',
    inMenu: true,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type !== 'image') {
            await ctx.reply(ctx.t('image.needImage', { prefix: ctx.prefix, command: 'compress' }));
            return;
        }
        try {
            const result = await compressImage(media.buffer, Number.parseInt(ctx.args[0] ?? '', 10) || undefined);
            await ctx.sendMedia({
                image: result.buffer,
                caption: `${(result.beforeBytes / 1024).toFixed(0)} KB → ${(result.afterBytes / 1024).toFixed(0)} KB`,
            });
        }
        catch {
            await ctx.reply(ctx.t('media.couldNotProcess'));
        }
    },
};
const resize = {
    name: 'resize',
    category: 'media',
    description: 'Resize an image: resize <width> <height>',
    usage: 'resize <width> <height>',
    inMenu: true,
    async execute(ctx) {
        const media = await inboundMedia(ctx);
        if (!media || media.type !== 'image') {
            await ctx.reply(ctx.t('image.needImage', { prefix: ctx.prefix, command: 'resize' }));
            return;
        }
        const [w, h] = [Number(ctx.args[0]), Number(ctx.args[1])];
        try {
            const out = await resizeImage(media.buffer, w, h);
            await ctx.sendMedia({ image: out, caption: `${Math.round(w)}×${Math.round(h)}` });
        }
        catch (error) {
            await ctx.reply(error instanceof Error ? `❌ ${error.message}` : ctx.t('media.couldNotProcess'));
        }
    },
};
export const mediaCommands = [music, video, sticker, toimg, compress, resize];
//# sourceMappingURL=media.js.map