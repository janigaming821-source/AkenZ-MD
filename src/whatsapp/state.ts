import { EventEmitter } from 'node:events';
import { currentInstance } from '../lib/scope.js';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting_pairing'
  | 'connected'
  | 'reconnecting'
  | 'session_expired'
  | 'logged_out'
  | 'blocked_by_whatsapp';

export interface ConnectionState {
  status: ConnectionStatus;
  /** WhatsApp JID of the paired account, e.g. 947XXXXXXXX:xx@s.whatsapp.net */
  selfJid: string | null;
  phoneNumber: string | null;
  connectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
  /** Active pairing code, only ever shown to the owner in the private dashboard. */
  pairingCode: string | null;
  pairingCodeExpiresAt: number | null;
  /** Current pairing QR payload, for scan-based linking. */
  pairingQr: string | null;
  reconnectAttempt: number;
}

const initialState = (): ConnectionState => ({
  status: 'disconnected',
  selfJid: null,
  phoneNumber: null,
  connectedAt: null,
  lastDisconnectedAt: null,
  lastError: null,
  pairingCode: null,
  pairingCodeExpiresAt: null,
  pairingQr: null,
  reconnectAttempt: 0,
});

/** Live connection state of one bot instance. */
export class ConnectionStore extends EventEmitter {
  private state: ConnectionState = initialState();

  get(): ConnectionState {
    return { ...this.state };
  }

  patch(next: Partial<ConnectionState>): void {
    Object.assign(this.state, next);
    this.emit('change', this.get());
  }

  get isConnected(): boolean {
    return this.state.status === 'connected';
  }
}

const stores = new Map<number, ConnectionStore>();

export function connectionFor(instance: number): ConnectionStore {
  let store = stores.get(instance);
  if (!store) {
    store = new ConnectionStore();
    stores.set(instance, store);
  }
  return store;
}

export const forgetConnection = (instance: number): void => {
  stores.delete(instance);
};

/** The connection of whichever bot the current work belongs to. */
export const connection = {
  get: (): ConnectionState => connectionFor(currentInstance()).get(),
  patch: (next: Partial<ConnectionState>): void => connectionFor(currentInstance()).patch(next),
  get isConnected(): boolean {
    return connectionFor(currentInstance()).isConnected;
  },
};

export const statusLabel: Record<ConnectionStatus, string> = {
  disconnected: '🔴 Disconnected',
  connecting: '🟡 Connecting…',
  awaiting_pairing: '🟡 Awaiting pairing',
  connected: '🟢 Connected',
  reconnecting: '🟡 Reconnecting…',
  session_expired: '🔴 Session expired',
  logged_out: '🔴 Logged out',
  blocked_by_whatsapp: '🔴 Restricted by WhatsApp',
};
