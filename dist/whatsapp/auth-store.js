import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initAuthCreds, makeCacheableSignalKeyStore, addTransactionCapability } from 'baileys';
import { config } from '../config/env.js';
import { prisma } from '../db/client.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { OWNER_INSTANCE } from '../lib/scope.js';
const CREDS_FILE = 'creds.enc.json';
const KEYS_FILE = 'keys.enc.json';
const WRITE_FLUSH_MS = 400;
const SESSION_ROW_CREDS = 'creds';
const SESSION_ROW_KEYS = 'keys';
/**
 * The owner's bot keeps the original unsuffixed names, so the session it already
 * has stays linked; every other instance gets its own suffix.
 */
const suffixed = (name, instance) => (instance === OWNER_INSTANCE ? name : `${name}-${instance}`);
/** write → temp file → rename, so a crash mid-write cannot corrupt the session */
function atomicWrite(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            renameSync(tmp, file);
            return;
        }
        catch (error) {
            // Windows locks a file another handle is reading; brief retry is enough.
            if (attempt === 3)
                throw error;
            const waitUntil = Date.now() + 60 * (attempt + 1);
            while (Date.now() < waitUntil) {
                /* spin */
            }
        }
    }
}
function decryptOrUndefined(payload, file) {
    if (payload === undefined)
        return undefined;
    try {
        return decryptJson(payload);
    }
    catch (error) {
        logger.error({ err: error instanceof Error ? error.message : String(error), file }, 'Credential file could not be decrypted — the session must be re-paired');
        return undefined;
    }
}
/**
 * requestPairingCode() writes `creds.me` with the placeholder name '~' the moment
 * a code is generated, long before the account is actually paired. If that
 * half-state survives a restart, Baileys sees a `me` and sends a login instead of
 * a registration — which the server rejects with 401 every time, so pairing can
 * never finish. `registered` only flips to true at companion_finish, so requiring
 * both conditions means a genuinely paired identity can never be erased here.
 */
function resetUnregisteredIdentity(creds) {
    if (creds.registered !== true && creds.me?.name === '~') {
        logger.info({ detail: 'Dropped the half-written identity from an unfinished pairing attempt.' }, 'auth: clearing unpaired identity');
        creds.me = undefined;
        creds.pairingCode = undefined;
    }
    return creds;
}
class FileSessionStorage {
    instance;
    constructor(instance) {
        this.instance = instance;
    }
    path(id) {
        const file = id === SESSION_ROW_KEYS ? KEYS_FILE : CREDS_FILE;
        return join(config.session.dir, suffixed(file.replace('.enc.json', ''), this.instance) + '.enc.json');
    }
    async load(id) {
        const file = this.path(id);
        if (!existsSync(file))
            return undefined;
        return readFileSync(file, 'utf8');
    }
    async save(id, payload) {
        atomicWrite(this.path(id), payload);
    }
    async clear() {
        for (const file of [this.path(SESSION_ROW_CREDS), this.path(SESSION_ROW_KEYS)]) {
            try {
                if (existsSync(file))
                    unlinkSync(file);
            }
            catch (error) {
                logger.warn({ file: file.split('/').pop(), err: String(error) }, 'could not delete credential file');
            }
        }
    }
}
class DbSessionStorage {
    instance;
    constructor(instance) {
        this.instance = instance;
    }
    rowId(id) {
        return suffixed(id, this.instance);
    }
    async load(id) {
        const row = await prisma.sessionStore.findUnique({ where: { id: this.rowId(id) } });
        return row?.payload;
    }
    async save(id, payload) {
        const rowId = this.rowId(id);
        await prisma.sessionStore.upsert({ where: { id: rowId }, create: { id: rowId, payload }, update: { payload } });
    }
    async clear() {
        await prisma.sessionStore.deleteMany({
            where: { id: { in: [this.rowId(SESSION_ROW_CREDS), this.rowId(SESSION_ROW_KEYS)] } },
        });
    }
}
const storageFor = (instance) => config.db.remote ? new DbSessionStorage(instance) : new FileSessionStorage(instance);
/**
 * On-disk (or in-database) Baileys auth state, AES-256-GCM encrypted with
 * SESSION_ENCRYPTION_KEY. Raw credentials never leave this process and are
 * never served by the dashboard.
 */
export class EncryptedAuthState {
    state;
    storage;
    /** True once a saved credential blob was loaded for this identity. */
    persisted;
    keys;
    keysDirty = false;
    flushTimer;
    writing = false;
    /** Whether this instance has a finished pairing on record, without building a socket. */
    static async isPaired(instance) {
        const raw = await storageFor(instance).load(SESSION_ROW_CREDS);
        return decryptOrUndefined(raw, CREDS_FILE)?.registered === true;
    }
    /** Drops an instance's stored session, e.g. when a buyer's bot is removed. */
    static async wipe(instance) {
        await storageFor(instance).clear();
    }
    static async create(instance) {
        const storage = storageFor(instance);
        const [credsRaw, keysRaw] = await Promise.all([
            storage.load(SESSION_ROW_CREDS),
            storage.load(SESSION_ROW_KEYS),
        ]);
        return new EncryptedAuthState(storage, credsRaw, keysRaw);
    }
    constructor(storage, credsRaw, keysRaw) {
        const creds = resetUnregisteredIdentity(decryptOrUndefined(credsRaw, CREDS_FILE) ?? initAuthCreds());
        this.persisted = credsRaw !== undefined;
        this.keys = decryptOrUndefined(keysRaw, KEYS_FILE) ?? {};
        this.storage = storage;
        const store = {
            get: (type, ids) => {
                const bucket = this.keys[type];
                const out = {};
                for (const id of ids) {
                    const value = bucket?.[id];
                    if (value !== undefined)
                        out[id] = value;
                }
                return out;
            },
            set: (data) => {
                for (const [type, entries] of Object.entries(data)) {
                    const bucket = (this.keys[type] ??= {});
                    for (const [id, value] of Object.entries(entries ?? {})) {
                        if (value === null || value === undefined)
                            delete bucket[id];
                        else
                            bucket[id] = value;
                    }
                }
                this.keysDirty = true;
                this.scheduleKeysFlush();
            },
            clear: async () => {
                this.keys = {};
                await this.storage.clear();
            },
        };
        const cached = makeCacheableSignalKeyStore(store, logger.child({ scope: 'baileys-store' }));
        this.state = {
            creds,
            keys: addTransactionCapability(cached, logger.child({ scope: 'baileys-tx' }), {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 30,
            }),
        };
    }
    /** True when a paired session already exists in storage. */
    get hasPairedSession() {
        return this.persisted && this.state.creds.registered === true;
    }
    /**
     * Called before every socket while still unpaired. requestPairingCode() writes
     * `creds.me` as soon as a code exists, so without this the next connection
     * sends a login for an account that was never linked and WhatsApp answers 401
     * — a loop that makes pairing impossible to finish.
     */
    async resetUnpairedIdentity() {
        const had = this.state.creds.me;
        resetUnregisteredIdentity(this.state.creds);
        if (had && !this.state.creds.me)
            await this.saveCreds();
    }
    saveCreds = async () => {
        if (this.writing)
            return;
        this.writing = true;
        try {
            await this.storage.save(SESSION_ROW_CREDS, encryptJson(this.state.creds));
        }
        finally {
            this.writing = false;
        }
    };
    scheduleKeysFlush() {
        if (this.flushTimer)
            return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flushKeys();
        }, WRITE_FLUSH_MS);
        this.flushTimer.unref();
    }
    async flushKeys() {
        if (!this.keysDirty)
            return;
        this.keysDirty = false;
        await this.storage.save(SESSION_ROW_KEYS, encryptJson(this.keys));
    }
    /** Wipes the stored session — used after logout or when creds become invalid. */
    destroy() {
        this.keys = {};
        this.keysDirty = false;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        void this.storage.clear().catch((error) => {
            logger.warn({ err: String(error) }, 'could not delete stored session data');
        });
    }
}
//# sourceMappingURL=auth-store.js.map