import { EventEmitter } from 'node:events';
import { currentInstance } from '../lib/scope.js';
const initialState = () => ({
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
    state = initialState();
    get() {
        return { ...this.state };
    }
    patch(next) {
        Object.assign(this.state, next);
        this.emit('change', this.get());
    }
    get isConnected() {
        return this.state.status === 'connected';
    }
}
const stores = new Map();
export function connectionFor(instance) {
    let store = stores.get(instance);
    if (!store) {
        store = new ConnectionStore();
        stores.set(instance, store);
    }
    return store;
}
export const forgetConnection = (instance) => {
    stores.delete(instance);
};
/** The connection of whichever bot the current work belongs to. */
export const connection = {
    get: () => connectionFor(currentInstance()).get(),
    patch: (next) => connectionFor(currentInstance()).patch(next),
    get isConnected() {
        return connectionFor(currentInstance()).isConnected;
    },
};
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