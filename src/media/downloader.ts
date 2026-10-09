import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/env.js';
import { runTool, toolAvailable } from './binary.js';

export type MediaKind = 'audio' | 'video';

export interface TrackInfo {
  title: string;
  artist: string;
  durationSeconds: number;
  thumbnailUrl?: string;
  webpageUrl: string;
  source: string;
}

export interface DownloadedMedia {
  /** Returned as a buffer because the temp folder is deleted before we return. */
  buffer: Buffer;
  extension: string;
  sizeBytes: number;
  durationSeconds: number;
  info: TrackInfo;
}

export class DownloaderError extends Error {
  constructor(
    message: string,
    readonly kind: 'unsupported' | 'too-large' | 'failed' | 'missing-tool',
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'DownloaderError';
  }
}

/** A pluggable media source. Public content only — never DRM or private media. */
export interface MediaProvider {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  /** A bare search phrase or a public URL. */
  supports(query: string, kind: MediaKind): boolean;
  /** Metadata only, so .music can show title/artist/duration before a download. */
  info(query: string, kind?: MediaKind): Promise<TrackInfo | null>;
  download(query: string, kind: MediaKind, maxBytes: number, timeoutMs: number): Promise<DownloadedMedia>;
}

const URL_LIKE = /^(https?:\/\/|ytsearch\d*:|youtubeselector:)/i;
const isSearchPhrase = (query: string) => !URL_LIKE.test(query);

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  await mkdir(config.media.tempDir, { recursive: true }).catch(() => undefined);
  const dir = await mkdtemp(join(config.media.tempDir, 'job-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await runTool(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      30_000,
    );
    return Number.parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export async function runFfmpeg(args: string[], timeoutMs = config.media.timeoutMs): Promise<void> {
  const result = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], timeoutMs);
  if (result.code !== 0) {
    throw new DownloaderError('Media conversion failed.', 'failed', result.stderr.slice(-400));
  }
}

/**
 * yt-dlp based provider. Handles both search phrases ("Alan Walker Faded") and
 * direct public video URLs. Everything runs through the user's own yt-dlp
 * install, so site changes are fixed by updating that binary, not this code.
 */
export class YtDlpProvider implements MediaProvider {
  readonly id = 'yt-dlp';
  readonly label = 'yt-dlp';

  async isAvailable(): Promise<boolean> {
    return toolAvailable('yt-dlp');
  }

  supports(query: string): boolean {
    return query.trim().length > 0;
  }

  private target(query: string): string {
    const trimmed = query.trim();
    if (URL_LIKE.test(trimmed)) return trimmed;
    // Search: first match only, no playlist expansion.
    return `ytsearch1:${trimmed}`;
  }

  private mapMeta(meta: Record<string, unknown>, source: string): TrackInfo {
    const title = typeof meta.title === 'string' ? meta.title : 'Unknown title';
    const artist =
      typeof meta.uploader === 'string'
        ? meta.uploader
        : typeof meta.channel === 'string'
          ? meta.channel
          : typeof meta.artist === 'string'
            ? meta.artist
            : '—';
    // Flat playlist entries (fast search) often lack webpage_url but always
    // carry an id or a url, so the exact video can be downloaded afterwards.
    const url =
      typeof meta.webpage_url === 'string' && meta.webpage_url.startsWith('http')
        ? meta.webpage_url
        : typeof meta.url === 'string' && meta.url.startsWith('http')
          ? meta.url
          : typeof meta.id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(meta.id)
            ? `https://www.youtube.com/watch?v=${meta.id}`
            : source;
    return {
      title,
      artist,
      durationSeconds: Number(meta.duration ?? 0) || 0,
      thumbnailUrl: typeof meta.thumbnail === 'string' ? meta.thumbnail : undefined,
      webpageUrl: url,
      source: this.label,
    };
  }

  async info(query: string, kind?: MediaKind): Promise<TrackInfo | null> {
    const trimmed = query.trim();
    if (isSearchPhrase(trimmed)) {
      // Fetch five candidates cheaply (flat playlist, no per-video requests)
      // and prefer one of a normal length, so ".video games" does not resolve
      // to a 69-minute compilation that can never fit the size cap.
      const cap = kind === 'video' ? 600 : 900;
      const args = ['-4', '--flat-playlist', '--skip-download', '--dump-single-json', `ytsearch5:${trimmed}`];
      const { code, stdout, stderr } = await runTool('yt-dlp', args, 60_000);
      if (code !== 0) {
        if (/DRM|protected|members-only|login|authentication|Private video/i.test(stderr)) {
          throw new DownloaderError('That content is protected or private.', 'unsupported', stderr.slice(-300));
        }
        return null;
      }
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const entries = Array.isArray(parsed.entries)
          ? (parsed.entries as Record<string, unknown>[])
          : [parsed];
        const usable = entries.filter((e) => e && !e.is_live);
        if (!usable.length) return null;
        const length = (e: Record<string, unknown>) => {
          const d = Number(e.duration ?? 0) || 0;
          return d > 0 ? d : Number.MAX_SAFE_INTEGER;
        };
        const inCap = usable.filter((e) => length(e) <= cap);
        const chosen = inCap.length
          ? inCap[0]!
          : [...usable].sort((a, b) => length(a) - length(b))[0]!;
        return this.mapMeta(chosen, trimmed);
      } catch {
        return null;
      }
    }

    const args = ['-4', '--no-playlist', '--skip-download', '--dump-single-json', trimmed];
    const { code, stdout, stderr } = await runTool('yt-dlp', args, 60_000);
    if (code !== 0) {
      if (/DRM|protected|members-only|login|authentication|Private video/i.test(stderr)) {
        throw new DownloaderError('That content is protected or private.', 'unsupported', stderr.slice(-300));
      }
      return null;
    }
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const entry = Array.isArray(parsed.entries) ? (parsed.entries[0] as Record<string, unknown>) : parsed;
      return this.mapMeta(entry ?? {}, trimmed);
    } catch {
      return null;
    }
  }

  async download(query: string, kind: MediaKind, maxBytes: number, timeoutMs: number): Promise<DownloadedMedia> {
    const available = await toolAvailable('ffmpeg');
    if (kind === 'audio' && !available) {
      throw new DownloaderError('ffmpeg is not installed, so audio conversion cannot run.', 'missing-tool');
    }
    if (kind === 'video') {
      // 720p first; before giving up with "too large", a smaller rendition is
      // tried, so the common case still delivers the file.
      try {
        return await this.runDownload(query, 'video', maxBytes, timeoutMs, 720);
      } catch (error) {
        if (error instanceof DownloaderError && error.kind === 'too-large') {
          return this.runDownload(query, 'video', maxBytes, timeoutMs, 480);
        }
        throw error;
      }
    }
    return this.runDownload(query, 'audio', maxBytes, timeoutMs);
  }

  private async runDownload(
    query: string,
    kind: MediaKind,
    maxBytes: number,
    timeoutMs: number,
    maxHeight?: number,
  ): Promise<DownloadedMedia> {
    return withTempDir(async (dir) => {
      const out = join(dir, kind === 'audio' ? 'track.%(ext)s' : 'video.%(ext)s');
      const args = [
        '--no-playlist',
        '--newline',
        '--no-progress',
        '-N',
        '4',
        '--retries',
        '3',
        '--fragment-retries',
        '3',
        '--socket-timeout',
        '20',
        '-o',
        out,
        '--max-filesize',
        `${Math.floor(maxBytes / 1024 / 1024)}M`,
      ];
      if (kind === 'audio') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      else {
        args.push(
          '-f',
          `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/best`,
          '--merge-output-format',
          'mp4',
        );
      }
      args.push(this.target(query));

      const { code, stdout, stderr } = await runTool('yt-dlp', args, timeoutMs);
      const logs = `${stdout}\n${stderr}`;
      if (code !== 0) {
        if (/larger than max-filesize/i.test(logs)) {
          throw new DownloaderError('File too large for this bot.', 'too-large', stderr.slice(-300));
        }
        if (/DRM|protected|members-only|Private video|authentication/i.test(stderr)) {
          throw new DownloaderError('That content is protected or private.', 'unsupported', stderr.slice(-300));
        }
        if (/requested format is not available/i.test(stderr)) {
          throw new DownloaderError('File too large for this bot.', 'too-large', stderr.slice(-300));
        }
        throw new DownloaderError('Unable to process this URL.', 'failed', stderr.slice(-300));
      }

      const { readdir, stat, readFile } = await import('node:fs/promises');
      const files = await readdir(dir);
      const produced = files.filter((f) => /\.(mp3|mp4|m4a|webm|mkv|opus)$/i.test(f));
      if (!produced.length) {
        // yt-dlp exits 0 when --max-filesize makes it skip the download —
        // this is the "preview shows but file never arrives" case.
        if (/larger than max-filesize/i.test(logs)) {
          throw new DownloaderError('File too large for this bot.', 'too-large', 'skipped by size cap');
        }
        throw new DownloaderError('Nothing was produced.', 'failed', stderr.slice(-200));
      }
      const name = produced[0]!;
      const path = join(dir, name);
      const { size } = await stat(path);
      if (size > maxBytes) {
        throw new DownloaderError('File too large for this bot.', 'too-large', `${Math.round(size / 1e6)}MB`);
      }
      const buffer = await readFile(path);
      const duration = await probeDuration(path);
      return {
        buffer,
        extension: name.split('.').pop()!.toLowerCase(),
        sizeBytes: size,
        durationSeconds: duration,
        info: {
          title: name.replace(/\.[^.]+$/, ''),
          artist: '—',
          durationSeconds: duration,
          webpageUrl: this.target(query),
          source: this.label,
        },
      };
    });
  }
}

/**
 * Tries each registered provider in order. A provider that throws or times out
 * is skipped — the bot keeps answering.
 */
export class DownloaderManager {
  private readonly providers: MediaProvider[] = [];

  register(provider: MediaProvider): void {
    this.providers.push(provider);
  }

  list(): MediaProvider[] {
    return [...this.providers];
  }

  private async candidates(): Promise<MediaProvider[]> {
    const results = await Promise.all(
      this.providers.map(async (provider) => ({ provider, ok: await provider.isAvailable() })),
    );
    return results.filter((r) => r.ok).map((r) => r.provider);
  }

  /** True when at least one provider can run right now. */
  async hasWorkingProvider(): Promise<boolean> {
    return (await this.candidates()).length > 0;
  }

  async find(query: string, kind: MediaKind): Promise<{ provider: MediaProvider; info: TrackInfo } | null> {
    for (const provider of await this.candidates()) {
      if (!provider.supports(query, kind)) continue;
      try {
        const info = await provider.info(query, kind);
        if (info) return { provider, info };
      } catch (error) {
        if (error instanceof DownloaderError && error.kind === 'unsupported') throw error;
      }
    }
    return null;
  }

  async download(query: string, kind: MediaKind): Promise<DownloadedMedia> {
    const maxBytes = config.media.maxBytes;
    const timeoutMs = config.media.timeoutMs;
    let lastError: DownloaderError | null = null;
    for (const provider of await this.candidates()) {
      if (!provider.supports(query, kind)) continue;
      try {
        return await provider.download(query, kind, maxBytes, timeoutMs);
      } catch (error) {
        if (error instanceof DownloaderError) {
          if (error.kind === 'unsupported') throw error;
          lastError = error;
        } else {
          lastError = new DownloaderError('Unable to process this URL.', 'failed', String(error));
        }
      }
    }
    throw lastError ?? new DownloaderError('Unable to process this URL.', 'unsupported');
  }
}

export const downloader = new DownloaderManager();
downloader.register(new YtDlpProvider());

export { isSearchPhrase };
