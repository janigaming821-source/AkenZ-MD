import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/env.js';
import { toolAvailable } from './binary.js';
import { probeDuration, runFfmpeg, withTempDir } from './downloader.js';
const GIF_MAX_SECONDS = 15;
const GIF_MAX_SIDE = 480;
async function requireFfmpeg() {
    if (!(await toolAvailable('ffmpeg'))) {
        throw new Error('ffmpeg is not installed on this machine.');
    }
}
/** Drop the video track and re-encode as an mp3 WhatsApp can play inline. */
export async function extractAudio(input) {
    await requireFfmpeg();
    return withTempDir(async (dir) => {
        const src = join(dir, 'input');
        const dst = join(dir, 'audio.mp3');
        await writeFile(src, input);
        await runFfmpeg(['-i', src, '-vn', '-map', 'a', '-acodec', 'libmp3lame', '-q:a', '4', dst]);
        return readFile(dst);
    });
}
/** Turn an audio/video attachment into a WhatsApp voice note (ogg/opus). */
export async function toVoiceNote(input) {
    await requireFfmpeg();
    return withTempDir(async (dir) => {
        const src = join(dir, 'input');
        const dst = join(dir, 'voice.ogg');
        await writeFile(src, input);
        await runFfmpeg([
            '-i', src,
            '-vn',
            '-acodec', 'libopus',
            '-ac', '1',
            '-ar', '48000',
            '-b:a', '32k',
            '-vbr', 'on',
            '-compression_level', '10',
            dst,
        ]);
        return readFile(dst);
    });
}
/** Video or animated sticker to an animated GIF (palette pass keeps colours sane). */
export async function toGif(input) {
    await requireFfmpeg();
    return withTempDir(async (dir) => {
        const src = join(dir, 'input');
        const dst = join(dir, 'out.gif');
        await writeFile(src, input);
        const seconds = await probeDuration(src);
        const limit = Math.min(seconds || GIF_MAX_SECONDS, GIF_MAX_SECONDS);
        const scale = `scale='min(${GIF_MAX_SIDE},iw)':-2:flags=lanczos`;
        await runFfmpeg([
            '-i', src,
            '-t', String(limit),
            '-vf', `fps=15,${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:allow_diffusion=0`,
            '-loop', '0',
            dst,
        ], config.media.timeoutMs);
        const buffer = await readFile(dst);
        if (buffer.length > 8_000_000)
            throw new Error('That clip is too heavy to turn into a GIF.');
        return buffer;
    });
}
//# sourceMappingURL=convert.js.map