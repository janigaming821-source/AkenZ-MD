import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { config } from '../config/env.js';

// Prisma resolves `file:` URLs relative to the schema folder, so the app
// hands it the absolute path it computed instead.
process.env.DATABASE_URL = config.db.url;

const logLevels: Prisma.LogLevel[] = config.logLevel === 'debug' ? ['warn', 'error'] : ['error'];

/**
 * The query engine bundled with Prisma cannot dial libsql:// itself, so a
 * remote Turso database goes through the driver adapter. Locally the classic
 * engine keeps talking to the on-disk SQLite file exactly as before.
 */
function createPrismaClient(): PrismaClient {
  if (config.db.remote) {
    const adapter = new PrismaLibSQL({
      url: config.db.url,
      authToken: config.db.authToken || undefined,
    });
    return new PrismaClient({ adapter, log: logLevels });
  }
  return new PrismaClient({ log: logLevels });
}

export const prisma = createPrismaClient();

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export async function databaseIsUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
