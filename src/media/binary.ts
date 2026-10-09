import { spawn } from 'node:child_process';
import { config } from '../config/env.js';

export type MediaTool = 'yt-dlp' | 'ffmpeg' | 'ffprobe';

const PATH_NAMES: Record<MediaTool, string> = {
  'yt-dlp': 'yt-dlp',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
};

const resolvedPath: Partial<Record<MediaTool, string>> = {
  'yt-dlp': config.media.ytdlpPath,
  ffmpeg: config.media.ffmpegPath,
};

export function toolCommand(tool: MediaTool): string {
  return resolvedPath[tool] ?? PATH_NAMES[tool];
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runTool(tool: MediaTool, args: string[], timeoutMs = config.media.timeoutMs): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(toolCommand(tool), args, { windowsHide: true, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Keep only the tail; yt-dlp/ffmpeg are chatty.
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(Object.assign(error, { toolNotInstalled: error.code === 'ENOENT' }));
    });
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

const availability = new Map<MediaTool, boolean>();

/** ffmpeg/ffprobe only accept the single-dash form; yt-dlp wants --version. */
const VERSION_ARGS: Record<MediaTool, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
};

const firstLine = (result: RunResult): string =>
  (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.trim() ?? '';

export async function toolAvailable(tool: MediaTool, force = false): Promise<boolean> {
  if (!force && availability.has(tool)) return availability.get(tool)!;
  try {
    const result = await runTool(tool, VERSION_ARGS[tool], 10_000);
    const ok = result.code === 0 && firstLine(result).length > 0;
    availability.set(tool, ok);
    return ok;
  } catch {
    availability.set(tool, false);
    return false;
  }
}

export const toolVersion = async (tool: MediaTool): Promise<string | null> => {
  try {
    const line = firstLine(await runTool(tool, VERSION_ARGS[tool], 10_000));
    return line || null;
  } catch {
    return null;
  }
};
