import { join } from 'node:path';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config/env.js';
import { botLog } from '../db/botLog.js';
import { logger } from '../lib/logger.js';
import { registerToolPath, toolAvailable } from './binary.js';
/**
 * Media commands need yt-dlp and ffmpeg, and free Node hosts ship a plain image
 * with no package manager access — so the bot fetches the upstream static builds
 * itself. Everything lands in data/bin, which is the only place the container is
 * allowed to write, and a failed download leaves the friendly "not installed"
 * reply in place rather than breaking the process.
 */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MIN_BYTES = 1_000_000;
const SPECS = [
    {
        tool: 'yt-dlp',
        file: 'yt-dlp',
        // The plain `yt-dlp` asset is a Python zipapp; this one is a self-contained
        // ELF, because a Node image has no interpreter to run the other with.
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    },
    {
        // Raw ELF from ffmpeg-static's release, so nothing has to be unpacked.
        tool: 'ffmpeg',
        file: 'ffmpeg',
        url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64',
    },
    {
        // Duration probing keeps videos inside the size cap, so ship its partner too.
        tool: 'ffprobe',
        file: 'ffprobe',
        url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffprobe-linux-x64',
    },
];
function binPath(spec) {
    return join(config.paths.dataDir, 'bin', spec.file);
}
async function download(url, dest) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
    }
    const part = `${dest}.part`;
    // Readable.fromWeb keeps this working on the Node line the host runs, where
    // pipeline() does not accept a web stream directly.
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { mode: 0o755 }));
    const info = await stat(part);
    if (info.size < MIN_BYTES) {
        await rm(part, { force: true });
        throw new Error(`downloaded file is only ${info.size} bytes`);
    }
    await rename(part, dest);
}
async function install(spec) {
    const dest = binPath(spec);
    if (!existsSync(dest)) {
        await botLog('info', 'media', `Downloading ${spec.tool} for media features`);
        await download(spec.url, dest);
    }
    await chmod(dest, 0o755);
    registerToolPath(spec.tool, dest);
    const ok = await toolAvailable(spec.tool, true);
    await botLog(ok ? 'info' : 'warn', 'media', ok ? `${spec.tool} is ready` : `${spec.tool} downloaded but did not run`, {
        path: dest,
    });
    return ok;
}
let started = null;
/** Idempotent: the first caller starts the work, everyone else awaits it. */
export function ensureMediaTools() {
    started ??= (async () => {
        if (process.platform !== 'linux')
            return;
        const dir = join(config.paths.dataDir, 'bin');
        await mkdir(dir, { recursive: true }).catch(() => undefined);
        for (const spec of SPECS) {
            try {
                if (await toolAvailable(spec.tool))
                    continue;
                await install(spec);
            }
            catch (error) {
                logger.warn({ err: error, tool: spec.tool }, 'media tool bootstrap failed');
                await botLog('warn', 'media', `${spec.tool} could not be installed automatically`, {
                    detail: error instanceof Error ? error.message : String(error),
                });
            }
        }
        // A ffprobe left beside ffmpeg is a bonus, not a requirement: duration
        // probing already degrades to 0 when it is missing.
        const ffprobe = join(dir, 'ffprobe');
        if (existsSync(ffprobe))
            registerToolPath('ffprobe', ffprobe);
    })();
    return started;
}
//# sourceMappingURL=bootstrap.js.map