import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { toolAvailable } from './binary.js';
import { runFfmpeg } from './downloader.js';
export const STICKER_MAX_BYTES = 100_000;
export const STICKER_VIDEO_MAX_SECONDS = 12;
const SIDE = 512;
async function withScratch(fn) {
    await mkdir(config.media.tempDir, { recursive: true }).catch(() => undefined);
    const dir = await mkdtemp(join(config.media.tempDir, 'img-'));
    try {
        return await fn(dir);
    }
    finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
/** Reads an image with sharp; rejects anything that is not a decodable image. */
export async function readImage(buffer) {
    try {
        return sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
    }
    catch {
        throw new Error('That file is not a readable image.');
    }
}
/** Static WhatsApp sticker: 512x512 WebP under 100 KB. */
export async function toSticker(input) {
    return withScratch(async () => {
        let quality = 90;
        for (;;) {
            const out = await sharp(input, { animated: false })
                .resize(SIDE, SIDE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                .webp({ quality, effort: 6 })
                .toBuffer();
            if (out.length <= STICKER_MAX_BYTES || quality <= 20) {
                if (out.length > STICKER_MAX_BYTES) {
                    // Last resort: shrink the canvas before giving up.
                    const smaller = await sharp(input)
                        .resize(384, 384, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                        .webp({ quality: 40, effort: 6 })
                        .toBuffer();
                    if (smaller.length > STICKER_MAX_BYTES) {
                        throw new Error(`Image stays above the 100 KB sticker limit (got ${Math.round(smaller.length / 1000)} KB).`);
                    }
                    return smaller;
                }
                return out;
            }
            quality -= 10;
        }
    });
}
/** Animated sticker from a short video or GIF, via ffmpeg + libwebp. */
export async function videoToSticker(input) {
    if (!(await toolAvailable('ffmpeg'))) {
        throw new Error('ffmpeg is not installed, so video stickers cannot be made.');
    }
    return withScratch(async (dir) => {
        const src = join(dir, 'input');
        const dst = join(dir, 'sticker.webp');
        await writeFile(src, input);
        await runFfmpeg([
            '-i', src,
            '-t', String(STICKER_VIDEO_MAX_SECONDS),
            '-vf', `fps=20,scale=${SIDE}:${SIDE}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${SIDE}:${SIDE}:(ow-iw)/2:(oh-ih)/2:color=white@0.0`,
            '-loop', '0',
            '-webp_lossless', '0',
            '-q:v', '60',
            dst,
        ]);
        const buffer = await readFile(dst);
        if (buffer.length > 500_000)
            throw new Error('That video is too long or too busy for a sticker.');
        return buffer;
    });
}
/** Sticker (webp) back to a normal image. */
export async function stickerToImage(input, format = 'png') {
    return sharp(input).flatten({ background: '#ffffff' }).toFormat(format).toBuffer();
}
export async function resizeImage(input, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
        throw new Error('Give two numbers, e.g. resize 720 480');
    }
    if (width > 4096 || height > 4096)
        throw new Error('Maximum size is 4096x4096.');
    return sharp(input, { limitInputPixels: 40_000_000 })
        .resize(Math.round(width), Math.round(height), { fit: 'inside' })
        .png()
        .toBuffer();
}
export async function compressImage(input, targetKb) {
    const target = Math.min(Math.max(targetKb ?? 200, 30), 2000) * 1024;
    let quality = 80;
    let out = await sharp(input, { limitInputPixels: 40_000_000 }).jpeg({ quality, mozjpeg: true }).toBuffer();
    while (out.length > target && quality > 25) {
        quality -= 5;
        out = await sharp(input).jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    return { buffer: out, beforeBytes: input.length, afterBytes: out.length };
}
//# sourceMappingURL=images.js.map