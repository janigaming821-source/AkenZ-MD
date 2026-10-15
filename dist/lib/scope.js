import { AsyncLocalStorage } from 'node:async_hooks';
/** The owner's own bot. Everything that predates multi-instance belongs to it. */
export const OWNER_INSTANCE = 1;
const store = new AsyncLocalStorage();
/**
 * Which bot the current work belongs to. Timers and promises inherit the value
 * from where they were created, so a socket started inside runInInstance keeps
 * its scope for every event it later emits.
 */
export const currentInstance = () => store.getStore() ?? OWNER_INSTANCE;
export const runInInstance = (instance, fn) => store.run(instance, fn);
/** Key for an in-memory cache that must not be shared between bots. */
export const scoped = (key) => `${currentInstance()}|${key}`;
//# sourceMappingURL=scope.js.map