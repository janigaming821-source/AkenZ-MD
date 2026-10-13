import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const APP = 'd825e73c-e6c9-49ee-9b4d-e9a9bee3e62f';
const TOKEN = readFileSync('.bonto-token', 'utf8').trim();
const API = `https://api.bonto.dev/api/files/${APP}`;

/** Everything the running container needs, so cloud cannot drift from local. */
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const FILES = [
  ...walk('dist'),
  ...walk(join('src', 'web', 'public')),
  ...walk('locales'),
  'prisma/schema.prisma',
].map((p) => p.split('\\').join('/'));

/**
 * The cloud install differs from the local one: prisma must be a real dependency
 * (the image installs production-only) and has to run `prisma generate` after
 * install, or @prisma/client throws at boot.
 */
const local = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = { ...local.dependencies };
deps.prisma = local.devDependencies.prisma;
delete deps['@whiskeysockets/baileys'];
deps.baileys = 'latest';
const cloud = {
  name: local.name,
  version: local.version,
  private: true,
  type: 'module',
  main: 'dist/index.js',
  engines: local.engines,
  // Generate runs at boot, not only on install: npm skips a project's postinstall
  // when the dependency tree is unchanged, which left the client built from the
  // previous schema and every new column unknown at runtime.
  scripts: { start: 'prisma generate --quiet && node dist/index.js', postinstall: 'prisma generate' },
  prisma: local.prisma,
  dependencies: deps,
};
// package.json goes last: writing it triggers the container's npm install, and the
// new code should already be in place when it restarts.
const ORDER = FILES.filter((p) => p !== 'package.json');
ORDER.push('package.json');
const CONTENT = { 'package.json': JSON.stringify(cloud, null, 2) };

let failures = 0;
for (const path of ORDER) {
  const content = CONTENT[path] ?? readFileSync(path, 'utf8');
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ path, content }),
  });
  const text = await r.text();
  if (!r.ok) failures += 1;
  if (!r.ok || path.includes('web/public') || path === 'package.json' || path.endsWith('prisma')) {
    console.log(`${r.status}  ${path.padEnd(34)} ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
}
console.log(`\nuploaded ${ORDER.length} files, ${failures} failed`);
