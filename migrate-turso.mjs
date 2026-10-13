import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Apply SQL to the remote (Turso) database the cloud bot runs on.
 *
 *   node migrate-turso.mjs prisma/migrations/<name>/migration.sql
 *   node migrate-turso.mjs --sql "ALTER TABLE ..."
 *
 * Prisma's own migrate commands cannot reach a libsql:// URL, and the connection
 * details live on the bonto app, so this reads them there instead of asking for
 * them on the command line — no token is ever printed or written to disk.
 */
const APP = process.env.BONTO_APP_ID ?? 'd825e73c-e6c9-49ee-9b4d-e9a9bee3e62f';

const arg = process.argv[2];
const inline = arg === '--sql' ? process.argv[3] : undefined;
const sql = inline ?? (arg && existsSync(arg) ? readFileSync(arg, 'utf8') : null);
if (!sql) {
  console.error('usage: node migrate-turso.mjs <sql-file> | --sql "<statements>"');
  process.exit(1);
}

async function cloudEnv() {
  const token = readFileSync('.bonto-token', 'utf8').trim();
  const res = await fetch(`https://api.bonto.dev/api/apps/${APP}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`bonto returned HTTP ${res.status}`);
  const vars = (await res.json()).app?.env_vars ?? [];
  // The API has returned both shapes: a list of {key,value} and a plain map.
  return Object.fromEntries(
    Array.isArray(vars) ? vars.map((v) => [v.key, v.value]) : Object.entries(vars),
  );
}

const env = await cloudEnv();
const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN;
if (!url?.startsWith('libsql://')) {
  console.error('the database URL is not a remote (libsql) database — nothing to migrate');
  process.exit(1);
}

// Statement splitting is safe for schema SQL of this shape: no strings contain a
// semicolon, and each statement stands on its own.
const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--'));

const client = createClient({ url, authToken });
const applied = [];
for (const statement of statements) {
  try {
    await client.execute(statement);
    applied.push(statement.split('\n')[0].slice(0, 72));
  } catch (error) {
    console.error(`FAILED: ${statement.split('\n')[0].slice(0, 72)}`);
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exitCode = 1;
    break;
  }
}
await client.close();
console.log(`applied ${applied.length}/${statements.length} statements to the remote database:`);
for (const line of applied) console.log(`  ${line}`);
