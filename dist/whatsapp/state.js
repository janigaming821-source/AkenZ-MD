import { EventEmitter } from 'node:events';
const state = {
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
};
export class ConnectionStore extends EventEmitter {
    get() {
        return { ...state };
    }
    patch(next) {
        Object.assign(state, next);
        this.emit('change', this.get());
    }
    get isConnected() {
        return state.status === 'connected';
    }
}
export const connection = new ConnectionStore();
export const statusLabel = {
    disconnected: '🔴 Disconnected',
    connecting: '🟡 Connecting…',
    awaiting_pairing: '🟡 Awaiting pairing',
    connected: '🟢 Connected',
    reconnecting: '🟡 Reconnecting…',
    session_expired: '🔴 Session expired',
    logged_out: '🔴 Logged out',
    blocked_by_whatsapp: '🔴 Restricted by WhatsApp',
};
//# sourceMappingURL=state.js.map