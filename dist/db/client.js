import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { config } from '../config/env.js';
import { currentInstance } from '../lib/scope.js';
// Prisma resolves `file:` URLs relative to the schema folder, so the app
// hands it the absolute path it computed instead.
process.env.DATABASE_URL = config.db.url;
const logLevels = config.logLevel === 'debug' ? ['warn', 'error'] : ['error'];
/**
 * The query engine bundled with Prisma cannot dial libsql:// itself, so a
 * remote Turso database goes through the driver adapter. Locally the classic
 * engine keeps talking to the on-disk SQLite file exactly as before.
 */
function createPrismaClient() {
    if (config.db.remote) {
        const adapter = new PrismaLibSQL({
            url: config.db.url,
            authToken: config.db.authToken || undefined,
        });
        return new PrismaClient({ adapter, log: logLevels });
    }
    return new PrismaClient({ log: logLevels });
}
/** Models whose rows belong to one bot instance. Group and BotConfig are not here. */
const SCOPED = new Set([
    'User', 'GroupSettings', 'Warning', 'AutoReply', 'CustomCommand', 'Note',
    'ScheduledTask', 'MessageStat', 'BotLog', 'MediaHistory', 'OwnerAction',
]);
const FILTERED = new Set([
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count',
    'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);
/**
 * Every query on an instance-owned model is pinned to the bot whose work is
 * running, so no call site can read or delete another buyer's rows by id.
 */
export const prisma = createPrismaClient().$extends({
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (!SCOPED.has(model))
                    return query(args);
                const instance = currentInstance();
                const a = (args ?? {});
                if (FILTERED.has(operation))
                    a.where = { ...a.where, instance };
                if (operation === 'create')
                    a.data = { ...a.data, instance };
                if (operation === 'createMany' && Array.isArray(a.data))
                    a.data = a.data.map((d) => ({ ...d, instance }));
                if (operation === 'upsert')
                    a.create = { ...a.create, instance };
                return query(a);
            },
        },
    },
});
export async function connectDatabase() {
    await prisma.$connect();
}
export async function disconnectDatabase() {
    await prisma.$disconnect();
}
export async function databaseIsUp() {
    try {
        await prisma.$queryRaw `SELECT 1`;
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=client.js.map