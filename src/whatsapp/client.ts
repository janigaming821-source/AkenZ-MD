import {
  DisconnectReason,
  DEFAULT_CONNECTION_CONFIG,
  fetchLatestBaileysVersion,
  makeWASocket,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
} from 'baileys';
import type { AnyMessageContent, GroupParticipant, WAMessage, WAMessageKey, WASocket } from 'baileys';
import { pino } from 'pino';
import { config } from '../config/env.js';
import { botLog, logError, logInfo, logWarn } from '../db/botLog.js';
import { EncryptedAuthState } from './auth-store.js';
import { connectionFor, forgetConnection, type ConnectionStore } from './state.js';
import { currentInstance, OWNER_INSTANCE, runInInstance } from '../lib/scope.js';

export interface InboundMessage {
  jid: string;
  isGroup: boolean;
  participant: string | null;
  fromMe: boolean;
  pushName: string | null;
  message: WAMessage;
  /** Wall-clock arrival in this process, used for honest response-time figures. */
  receivedAt: number;
}

export interface ParticipantEvent {
  jid: string;
  action: 'add' | 'remove' | 'promote' | 'demote';
  participants: string[];
}

export interface StatusEvent {
  /** The JID of the contact who posted the status. */
  senderJid: string;
  pushName: string | null;
  message: WAMessage;
}

export interface ClientHooks {
  onMessage: (msg: InboundMessage) => Promise<void>;
  onParticipants?: (event: ParticipantEvent) => Promise<void>;
  onStatus?: (event: StatusEvent) => Promise<void>;
  onDelete?: (keys: WAMessageKey[]) => Promise<void>;
}

const PAIRING_CODE_TTL_MS = 55_000;
const PAIRING_REQUEST_TIMEOUT_MS = 30_000;
/** Ceiling on waiting for the server to prove the socket is usable. */
const SOCKET_READY_TIMEOUT_MS = 20_000;
/** How long we keep re-issuing a code after the owner asks for one. */
const PAIRING_INTENT_MS = 4 * 60_000;
/** Short, fixed pause between pairing sockets — not the failure backoff. */
const PAIRING_RETRY_DELAY_MS = 2_500;
/** How long Baileys may hold one QR reference before moving to the next. */
const PAIRING_SOCKET_HOLD_MS = 120_000;
/** Gap between registration attempts while nobody has asked for a code yet. */
const QR_WINDOW_RETRY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 12;
/** A buyer's unlinked bot stops offering QRs once nobody has looked for this long. */
const BUYER_PAIRING_IDLE_MS = 10 * 60_000;
const BACKOFF_CAP_MS = 60_000;

/**
 * Baileys never settles a pairing request if the socket dies underneath it,
 * which would hang the dashboard button forever. The losing promise is
 * swallowed so a late rejection cannot become an unhandled rejection.
 */
/**
 * True when WhatsApp dropped the connection because another connection for this
 * same device took over — a collision between two of our own sockets, not an
 * unlink on the phone.
 */
function isConnectionConflict(error: unknown): boolean {
  const err = error as { message?: string; data?: { tag?: string; content?: unknown } } | undefined;
  if (/conflict|duplicate/i.test(err?.message ?? '')) return true;
  const node = err?.data;
  if (!node || node.tag !== 'stream:error') return false;
  const children = Array.isArray(node.content) ? node.content as { tag?: string }[] : [];
  return children.some((child) => child?.tag === 'conflict' || child?.tag === 'duplicate');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Owns the WhatsApp socket: phone-number pairing, session persistence and
 * bounded reconnects. QR is intentionally not used as the connect method.
 */
export class WhatsAppClient {
  readonly conn: ConnectionStore;
  private sock: WASocket | null = null;
  /** Last time someone asked to see this bot's QR or code. */
  private lastDemand = 0;

  constructor(readonly instance: number) {
    this.conn = connectionFor(instance);
  }

  /** Keeps an unlinked buyer bot offering QRs while its owner is looking. */
  noteDemand(): void {
    this.lastDemand = Date.now();
  }

  /** Opens a socket if none is running yet, e.g. when a buyer asks for a QR. */
  async ensureStarted(): Promise<void> {
    this.noteDemand();
    // The owner's bot is started at boot and manages its own reconnects.
    if (this.instance === OWNER_INSTANCE || this.sock || this.reconnectTimer || this.conn.isConnected) return;
    await this.start();
  }
  private auth: EncryptedAuthState | null = null;
  private authPromise: Promise<EncryptedAuthState> | null = null;
  private hooks: ClientHooks | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private shuttingDown = false;
  private pairingRequest: Promise<string> | null = null;
  private pairingTimer: NodeJS.Timeout | null = null;
  private readyResolve: (() => void) | null = null;
  /** Set once the server has proved this socket can carry an IQ. */
  private socketReady = false;
  /**
   * Identifies the current socket. A replaced socket keeps its event listeners
   * attached, and a dying one that is still allowed to drive state schedules a
   * reconnect beside its successor — WhatsApp answers two concurrent connections
   * for one device by terminating each in turn, which looks like flapping.
   */
  private generation = 0;
  /**
   * The number the owner asked to pair, and how long we should keep trying.
   * A code belongs to one socket only: Baileys ends its QR refs and drops the
   * connection roughly 10-60s after it starts, which silently voids the code
   * the owner is still typing. Re-issuing on each fresh socket keeps it live.
   */
  private pairingIntent: { phoneNumber: string; until: number } | null = null;

  attach(hooks: ClientHooks): void {
    this.hooks = hooks;
  }

  get socket(): WASocket | null {
    return this.sock;
  }

  get isConnected(): boolean {
    return this.conn.isConnected;
  }

  get selfJid(): string | null {
    return this.conn.get().selfJid;
  }

  get waVersion(): [number, number, number] {
    return this.waVersionValue;
  }

  private waVersionValue: [number, number, number] = DEFAULT_CONNECTION_CONFIG.version as [number, number, number];

  async start(): Promise<void> {
    this.shuttingDown = false;
    // Prefer the current published WA version; fall back to the value bundled
    // with the library when the registry is unreachable (offline / behind proxy).
    try {
      const fetched = await fetchLatestBaileysVersion();
      this.waVersionValue = fetched.version;
    } catch (error) {
      logWarn('whatsapp', 'Could not fetch latest WA version, using bundled default', {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.auth) {
      // Loading the session touches storage (files locally, the remote database
      // in the cloud), so construction is awaited. The promise guard keeps two
      // racing connect() calls from building two independent caches.
      if (!this.authPromise) this.authPromise = EncryptedAuthState.create(this.instance);
      this.auth = await this.authPromise;
    }
    await this.auth.resetUnpairedIdentity();
    this.socketReady = false;

    // Retire the previous socket before opening another, and mark it superseded
    // first so its closing events can't schedule a reconnect of their own.
    this.generation += 1;
    if (this.sock) {
      const stale = this.sock;
      this.sock = null;
      try {
        stale.end(undefined);
      } catch {
        /* already gone */
      }
    }

    // A code belongs to the socket that asked for it. Showing a previous socket's
    // code would leave the owner typing digits WhatsApp has already forgotten.
    if (!this.auth.hasPairedSession) {
      this.clearPairingTimer();
      this.conn.patch({ pairingCode: null, pairingCodeExpiresAt: null });
    }

    this.conn.patch({
      status: this.conn.get().status === 'connected' ? 'connecting' : this.conn.get().status,
    });

    const childLogger = pino({ level: config.logLevel === 'silent' ? 'fatal' : config.logLevel });

    /**
     * Every caller here is a fire-and-forget reconnect timer, so a socket that
     * cannot be created must retry through the same budget as a socket that
     * dropped. Letting the promise reject instead would log a noise line and leave
     * the bot permanently offline.
     */
    try {
      this.sock = makeWASocket({
        auth: this.auth.state,
        logger: childLogger,
        version: this.waVersionValue,
        browser: ['Ubuntu', 'Chrome', '124.0.0'],
        // Personal bot: no history dump, replies are what matter.
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true,
        emitOwnEvents: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        /**
         * Baileys hands out the server's QR references one at a time and then ends
         * the connection with 'QR refs attempts ended' — on a 20s clock by default,
         * which kills a pairing socket about 100s after it opens and voids the code
         * the owner is still typing. We never show a QR, so holding each reference
         * longer costs nothing and keeps one socket alive across the whole pairing.
         */
        qrTimeout: PAIRING_SOCKET_HOLD_MS,
      });

      this.bindEvents(this.sock);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.sock = null;
      await botLog('error', 'whatsapp', 'Could not open a WhatsApp socket, retrying', { detail });
      await this.scheduleReconnect(detail);
    }
  }

  private bindEvents(sock: WASocket): void {
    // Baileys emits from its own socket callbacks; pin them to this bot.
    const on = sock.ev.on.bind(sock.ev) as (event: string, fn: (arg: never) => void) => void;
    const ev = {
      on: (event: string, fn: (arg: never) => void) =>
        on(event, (arg: never) => runInInstance(this.instance, () => fn(arg))),
    } as unknown as WASocket['ev'];
    const gen = this.generation;
    /** Ignore anything a superseded socket says after it has been replaced. */
    const current = () => gen === this.generation;

    ev.on('connection.update', (update) => {
      if (!current()) return;
      void this.handleConnectionUpdate(update);
    });

    ev.on('creds.update', () => {
      if (!current()) return;
      void (async () => {
        try {
          await this.auth?.saveCreds();
          await this.auth?.flushKeys();
        } catch (error) {
          logError('whatsapp', 'Failed to persist session credentials', {
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });

    ev.on('messages.upsert', ({ messages, type }) => {
      if (!current()) return;
      if (type !== 'notify' && type !== 'append') return;
      for (const message of messages) {
        if (!message.key?.remoteJid) continue;

        if (isJidStatusBroadcast(message.key.remoteJid)) {
          if (!this.hooks?.onStatus || message.key.fromMe) continue;
          const senderJid = message.key.participant
            ? jidNormalizedUser(message.key.participant)
            : null;
          if (!senderJid) continue;
          this.hooks.onStatus({
            senderJid,
            pushName: message.pushName ?? null,
            message,
          }).catch((error) => {
            logError('status', 'Status handler failed', {
              detail: error instanceof Error ? error.message : String(error),
            });
          });
          continue;
        }

        const jid = message.key.remoteJid;
        if (jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) continue;
        const inbound: InboundMessage = {
          jid,
          isGroup: isJidGroup(jid) === true,
          participant: message.key.participant ? jidNormalizedUser(message.key.participant) : null,
          fromMe: message.key.fromMe === true,
          pushName: message.pushName ?? null,
          message,
          receivedAt: Date.now(),
        };
        this.hooks?.onMessage(inbound).catch((error) => {
          logError('handler', 'Unhandled error while processing an inbound message', {
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });

    if (this.hooks?.onDelete) {
      const onDelete = this.hooks.onDelete;
      ev.on('messages.delete', (event) => {
        if (!current()) return;
        if ('keys' in event) {
          onDelete(event.keys).catch((error) => {
            logError('handler', 'Delete handler failed', {
              detail: error instanceof Error ? error.message : String(error),
            });
          });
        }
      });
    }

    if (this.hooks?.onParticipants) {
      const onParticipants = this.hooks.onParticipants;
      ev.on('group-participants.update', (data) => {
        if (!current()) return;
        onParticipants({
          jid: data.id,
          action: data.action as ParticipantEvent['action'],
          // Baileys 7 hands back participant objects; the rest of the bot works
          // with plain JIDs, so flatten here rather than leaking the shape inward.
          participants: data.participants.map((p) => (typeof p === 'string' ? p : p.id)),
        }).catch((error) => {
          logError('groups', 'Participant event failed', {
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      });
    }
  }

  private async handleConnectionUpdate(update: {
    connection?: 'open' | 'connecting' | 'close';
    qr?: string;
    lastDisconnect?: { error?: Error | { output?: { statusCode?: number }; message?: string } };
  }): Promise<void> {
    const state = update.connection;
    if (update.qr && !this.conn.isConnected) {
      /**
       * A QR push is the first moment the socket is genuinely usable: it arrives
       * after the handshake, from the server itself, offering pairing references.
       * Asking for a code any earlier (on 'connecting') hits a socket that is not
       * open yet and throws "Connection Closed".
       */
      this.socketReady = true;
      this.readyResolve?.();
      this.readyResolve = null;
      this.conn.patch({ pairingQr: update.qr });

      // Only fetch a code when the owner actually asked for one. WhatsApp counts
      // every code request against a per-account linking limit and answers the
      // overflow with `429 rate-overlimit`, so a socket that requests one on
      // every restart quietly burns the owner's ability to pair at all.
      const target = this.activePairingNumber();
      if (target && !this.pairingRequest && !this.conn.get().pairingCode) {
        void this.issuePairingCode(target).catch((error) => {
          logWarn('whatsapp', 'Pairing code request failed', {
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    const disconnectError = update.lastDisconnect?.error as Error | undefined;

    if (state === 'open') {
      this.attempts = 0;
      this.pairingIntent = null;
      const selfJid = this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
      this.conn.patch({
        status: 'connected',
        selfJid,
        connectedAt: Date.now(),
        lastError: null,
        reconnectAttempt: 0,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        pairingQr: null,
      });
      this.clearPairingTimer();
      this.socketReady = true;
      this.readyResolve?.();
      this.readyResolve = null;
      await botLog('info', 'whatsapp', 'WhatsApp connected');
      return;
    }

    if (state === 'connecting') {
      if (this.conn.get().status !== 'connected') {
        this.conn.patch({ status: this.auth?.hasPairedSession ? 'connecting' : 'awaiting_pairing' });
        // The code itself is requested from the first QR push, once the socket is
        // actually open — see handleConnectionUpdate.
      }
      return;
    }

    if (state === 'close' || state === 'error') {
      // A QR belongs to the socket that broadcasted it. Leaving the old one on
      // screen invites a scan that can never complete.
      this.conn.patch({ lastDisconnectedAt: Date.now(), pairingQr: null });
      const reasonCode = (disconnectError as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const reason = reasonCode ?? DisconnectReason.connectionClosed;
      const detail = `${reasonCode ?? 'unknown'}${disconnectError?.message ? ` — ${disconnectError.message}` : ''}`;

      // 401 = unlinked from the phone, 500 = broken session, 411 = device mismatch.
      // All three mean "pair again", never "keep retrying quietly".
      const fatal =
        reason === DisconnectReason.loggedOut ||
        reason === DisconnectReason.badSession ||
        reason === DisconnectReason.multideviceMismatch;

      /**
       * WhatsApp also answers 401 with `<conflict type="device_removed">` when a
       * second connection for this device takes over — which is what happens when
       * the bot is restarted while its previous socket is still closing. Nothing
       * was unlinked on the phone, so deleting the session for that would throw
       * away a working pairing over a self-inflicted collision.
       */
      const conflict = isConnectionConflict(disconnectError);

      /**
       * A 401 on a socket that was never paired is a failed pairing attempt, not
       * an unlink from the phone. Treating it as a logout destroyed the stored
       * registration mid-pairing, which voided the very code the owner was typing.
       */
      const wasPaired = this.auth?.hasPairedSession === true;

      if (fatal && wasPaired && !conflict) {
        this.auth?.destroy();
        this.auth = null;
        this.authPromise = null;
        this.sock = null;
        this.pairingIntent = null;
        this.conn.patch({
          status: reason === DisconnectReason.loggedOut ? 'logged_out' : 'session_expired',
          selfJid: null,
          connectedAt: null,
          pairingCode: null,
          pairingCodeExpiresAt: null,
          lastError: disconnectError?.message ?? 'Session no longer valid',
        });
        await botLog('warn', 'whatsapp', 'WhatsApp session invalidated — pairing required', { reason: detail });
        return;
      }

      /**
       * Pairing runs on a clock we do not control: Baileys drops the socket as
       * soon as the server's QR refs run out, whether or not anyone asked for a
       * code. While the account is still unpaired every drop means "offer the QR
       * again", not "back off and go dark" — a socket that exhausts its budget
       * leaves the owner staring at a dashboard with nothing to scan.
       */
      if (!wasPaired && !this.conn.isConnected) {
        if (this.instance !== OWNER_INSTANCE && Date.now() - this.lastDemand > BUYER_PAIRING_IDLE_MS) {
          this.sock = null;
          this.conn.patch({ status: 'disconnected', pairingQr: null, pairingCode: null, lastError: null });
          return;
        }
        const intent = this.activePairingNumber();
        await this.restartPairingSocket(detail, intent ? PAIRING_RETRY_DELAY_MS : QR_WINDOW_RETRY_MS);
        return;
      }

      if (reason === DisconnectReason.forbidden) {
        this.conn.patch({ status: 'blocked_by_whatsapp', lastError: disconnectError?.message ?? null });
        await botLog('error', 'whatsapp', 'WhatsApp refused the connection (403) — stopping reconnects', {
          reason: detail,
        });
        return;
      }

      if (this.shuttingDown) {
        this.conn.patch({ status: 'disconnected' });
        return;
      }

      await this.scheduleReconnect(detail);
    }
  }

  /** Restart promptly and without consuming the reconnect budget, while pairing. */
  private async restartPairingSocket(detail: string, delayMs = PAIRING_RETRY_DELAY_MS): Promise<void> {
    this.attempts = 0;
    this.clearPairingTimer();
    this.conn.patch({ status: 'awaiting_pairing', lastError: null });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
    this.reconnectTimer.unref();
    await botLog('info', 'whatsapp', 'Restarting the pairing socket', { detail });
  }

  private async scheduleReconnect(detail: string): Promise<void> {
    this.attempts += 1;
    if (this.attempts > MAX_RECONNECT_ATTEMPTS) {
      this.conn.patch({ status: 'disconnected', lastError: `Disconnected after ${MAX_RECONNECT_ATTEMPTS} retries (${detail})` });
      await botLog('error', 'whatsapp', 'Reconnect attempts exhausted — manual start required', {
        attempts: MAX_RECONNECT_ATTEMPTS,
      });
      return;
    }

    const delay = Math.min(2 ** (this.attempts - 1) * 1000, BACKOFF_CAP_MS);
    this.conn.patch({ status: 'reconnecting', reconnectAttempt: this.attempts, lastError: detail });
    await botLog('warn', 'whatsapp', 'WhatsApp disconnected, scheduling reconnect', {
      attempt: this.attempts,
      delayMs: delay,
    });

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // connect() retires the previous socket itself.
      void this.connect();
    }, delay);
  }

  /**
   * Phone-number pairing: WhatsApp → Settings → Linked devices → Link with
   * phone number. The number must be the bot's own, in international format.
   */
  async requestPairing(phoneNumber: string): Promise<string> {
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    if (normalized.startsWith('0')) {
      throw new Error(
        `Use the international format without the leading 0 — 94771234567, not ${normalized}.`
      );
    }
    // E.164 allows at most 15 digits; anything shorter than 10 has no country code.
    if (normalized.length < 10 || normalized.length > 15) {
      throw new Error('That does not look like a full international number — country code first, e.g. 94771234567.');
    }
    if (this.conn.isConnected) {
      throw new Error('This session is already paired and connected.');
    }

    this.noteDemand();
    this.pairingIntent = { phoneNumber: normalized, until: Date.now() + PAIRING_INTENT_MS };

    if (!this.sock) {
      this.conn.patch({ status: 'connecting' });
      await this.connect();
    }
    if (!this.sock) throw new Error('WhatsApp socket could not be created.');
    await this.waitForSocketReady();

    // The first QR push may already have fetched a code for this exact number a
    // second ago. Hand that one back instead of sending a second request that
    // would void the code already on the owner's screen.
    const live = this.conn.get();
    if (live.pairingCode && live.phoneNumber === normalized && (live.pairingCodeExpiresAt ?? 0) > Date.now()) {
      return live.pairingCode;
    }

    return this.issuePairingCode(normalized);
  }

  /** The number we should keep re-issuing a code for, or null once that window closes. */
  private activePairingNumber(): string | null {
    if (!this.pairingIntent) return null;
    if (Date.now() > this.pairingIntent.until) {
      this.pairingIntent = null;
      return null;
    }
    return this.pairingIntent.phoneNumber;
  }

  /**
   * Single-flight on purpose. Each requestPairingCode() rotates this device's
   * ephemeral pairing key and its ref, so two requests in the same tick leave
   * WhatsApp holding the second key while the code on screen belongs to the
   * first — the phone then reports "Couldn't link device". Callers that arrive
   * while a request is in flight join it and get the same code.
   */
  private async issuePairingCode(normalized: string): Promise<string> {
    if (!this.sock) throw new Error('WhatsApp socket is not ready.');
    if (this.pairingRequest) return this.pairingRequest;

    const request = (async () => {
      const code = await withTimeout(
        this.sock!.requestPairingCode(normalized),
        PAIRING_REQUEST_TIMEOUT_MS,
        'WhatsApp did not answer the pairing request. Use Reconnect session and try again.'
      );
      this.conn.patch({
        status: 'awaiting_pairing',
        phoneNumber: normalized,
        pairingCode: code,
        pairingCodeExpiresAt: Date.now() + PAIRING_CODE_TTL_MS,
        lastError: null,
      });
      this.armPairingExpiry();
      await botLog('info', 'whatsapp', 'Pairing code requested', { masked: `${code.slice(0, 2)}****` });
      return code;
    })().finally(() => {
      if (this.pairingRequest === request) this.pairingRequest = null;
    });

    this.pairingRequest = request;
    return request;
  }

  /**
   * Resolves once the socket can actually carry an IQ. 'connecting' is too early:
   * the WebSocket is still handshaking, and a pairing request sent then comes
   * back as "Connection Closed". The first QR push — or a stream open — is the
   * proof the server is talking to us.
   */
  private waitForSocketReady(): Promise<void> {
    if (this.socketReady) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.readyResolve = null;
        resolve();
      };
      const timer = setTimeout(finish, SOCKET_READY_TIMEOUT_MS);
      this.readyResolve = finish;
    });
  }

  /**
   * A code is never replaced on its own. Each pairing request rotates the device's
   * pairing ref, and WhatsApp honours only the newest one — so quietly issuing a
   * fresh code voids whatever the owner is halfway through typing. When a code
   * dies we say so and wait for an explicit request instead.
   */
  private armPairingExpiry(): void {
    this.clearPairingTimer();
    this.pairingTimer = setTimeout(() => {
      if (this.conn.isConnected) return;
      this.conn.patch({ pairingCode: null, pairingCodeExpiresAt: null, lastError: 'Pairing code expired' });
    }, PAIRING_CODE_TTL_MS);
    this.pairingTimer.unref();
  }

  private clearPairingTimer(): void {
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearPairingTimer();
    this.pairingIntent = null;
    try {
      await this.auth?.saveCreds();
      await this.auth?.flushKeys();
    } catch {
      /* keep shutdown resilient */
    }
    this.sock?.end(undefined);
    this.sock = null;
    this.conn.patch({ status: 'disconnected', selfJid: null, connectedAt: null, pairingCode: null });
    await botLog('info', 'whatsapp', 'WhatsApp disconnected by request');
  }

  /** Forces a fresh socket without wiping the stored session. */
  async reconnect(): Promise<void> {
    this.attempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.auth?.saveCreds();
      await this.auth?.flushKeys();
    } catch {
      /* the new socket will re-persist on the next creds.update */
    }
    try {
      this.sock?.end(undefined);
    } catch {
      /* already gone */
    }
    this.sock = null;
    this.conn.patch({ status: 'connecting', connectedAt: null, selfJid: null, reconnectAttempt: 0 });
    await this.connect();
    await botLog('info', 'whatsapp', 'Session reconnect requested');
  }

  /** Unlinks the companion session. Destructive: pairing is required again. */
  async logout(): Promise<void> {
    this.pairingIntent = null;
    this.clearPairingTimer();
    if (!this.sock) {
      this.auth?.destroy();
      this.auth = null;
      this.conn.patch({ status: 'logged_out', selfJid: null });
      return;
    }
    await this.sock.logout('AkenZ MD: logout requested from the private dashboard');
    this.auth?.destroy();
    this.auth = null;
    this.sock = null;
    this.conn.patch({ status: 'logged_out', selfJid: null, connectedAt: null });
    await botLog('warn', 'whatsapp', 'WhatsApp session logged out');
  }

  async sendMessage(
    jid: string,
    content: AnyMessageContent,
    options: { quoted?: WAMessage } = {}
  ): Promise<WAMessage | undefined> {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    return this.sock.sendMessage(jid, content, options.quoted ? { quoted: options.quoted } : {});
  }

  async sendText(jid: string, text: string, options: { quoted?: WAMessage; mentions?: string[] } = {}) {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    return this.sock.sendMessage(
      jid,
      { text, ...(options.mentions?.length ? { mentions: options.mentions } : {}) },
      options.quoted ? { quoted: options.quoted } : {}
    );
  }

  async groupMetadata(jid: string) {
    if (!this.sock) throw new Error('WhatsApp is not connected.');
    return this.sock.groupMetadata(jid);
  }

  async groupParticipants(jid: string): Promise<GroupParticipant[]> {
    const meta = await this.groupMetadata(jid);
    return meta.participants;
  }
}

const clients = new Map<number, WhatsAppClient>();

export function clientFor(instance: number): WhatsAppClient {
  let client = clients.get(instance);
  if (!client) {
    client = new WhatsAppClient(instance);
    if (sharedHooks) client.attach(sharedHooks);
    clients.set(instance, client);
  }
  return client;
}

export const allClients = (): WhatsAppClient[] => [...clients.values()];

let sharedHooks: ClientHooks | null = null;

/** The same handlers serve every bot; scope tells them which one is talking. */
export function attachAll(hooks: ClientHooks): void {
  sharedHooks = hooks;
  for (const client of clients.values()) client.attach(hooks);
}

/** Stops a bot and forgets it, so a removed buyer leaves nothing running. */
export async function dropClient(instance: number): Promise<void> {
  const client = clients.get(instance);
  clients.delete(instance);
  if (client) await client.disconnect().catch(() => {});
  forgetConnection(instance);
}

/**
 * The client of whichever bot the current work belongs to. Commands and routes
 * were written against one global client; resolving it per call keeps them
 * correct without threading an instance through every call site.
 */
export const whatsapp = new Proxy({} as WhatsAppClient, {
  get(_target, prop) {
    const client = clientFor(currentInstance());
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
