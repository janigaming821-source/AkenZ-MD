import { spawn } from 'node:child_process';
import { config } from '../config/env.js';
const PATH_NAMES = {
    'yt-dlp': 'yt-dlp',
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
};
const resolvedPath = {
    'yt-dlp': config.media.ytdlpPath,
    ffmpeg: config.media.ffmpegPath,
};
export function toolCommand(tool) {
    return resolvedPath[tool] ?? PATH_NAMES[tool];
}
export function runTool(tool, args, timeoutMs = config.media.timeoutMs) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(toolCommand(tool), args, { windowsHide: true, timeout: timeoutMs });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            // Keep only the tail; yt-dlp/ffmpeg are chatty.
            stderr = (stderr + chunk.toString('utf8')).slice(-8000);
        });
        child.on('error', (error) => {
            reject(Object.assign(error, { toolNotInstalled: error.code === 'ENOENT' }));
        });
        child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    });
}
const availability = new Map();
/** ffmpeg/ffprobe only accept the single-dash form; yt-dlp wants --version. */
const VERSION_ARGS = {
    'yt-dlp': ['--version'],
    ffmpeg: ['-version'],
    ffprobe: ['-version'],
};
const firstLine = (result) => (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.trim() ?? '';
export async function toolAvailable(tool, force = false) {
    if (!force && availability.has(tool))
        return availability.get(tool);
    try {
        const result = await runTool(tool, VERSION_ARGS[tool], 10_000);
        const ok = result.code === 0 && firstLine(result).length > 0;
        availability.set(tool, ok);
        return ok;
    }
    catch {
        availability.set(tool, false);
        return false;
    }
}
export const toolVersion = async (tool) => {
    try {
        const line = firstLine(await runTool(tool, VERSION_ARGS[tool], 10_000));
        return line || null;
    }
    catch {
        return null;
    }
};
//# sourceMappingURL=binary.js.map