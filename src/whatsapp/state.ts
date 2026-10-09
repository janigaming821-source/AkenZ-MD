import { EventEmitter } from 'node:events';

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
  reconnectAttempt: number;
}

const state: ConnectionState = {
  status: 'disconnected',
  selfJid: null,
  phoneNumber: null,
  connectedAt: null,
  lastDisconnectedAt: null,
  lastError: null,
  pairingCode: null,
  pairingCodeExpiresAt: null,
  reconnectAttempt: 0,
};

export class ConnectionStore extends EventEmitter {
  get(): ConnectionState {
    return { ...state };
  }

  patch(next: Partial<ConnectionState>): void {
    Object.assign(state, next);
    this.emit('change', this.get());
  }

  get isConnected(): boolean {
    return state.status === 'connected';
  }
}

export const connection = new ConnectionStore();

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
