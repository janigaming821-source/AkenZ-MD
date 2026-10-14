/**
 * Publishes site/ on Cloudflare Pages and puts whatsappbot.noaura.xyz on it.
 *
 *   node deploy-site-cloudflare.mjs
 *
 * No token to paste: it reads the scoped API token from the gitignored
 * .cloudflare-token file, and falls back to the `npx wrangler login` session
 * stored on this machine. The scoped token is the one that can write DNS records
 * — the wrangler OAuth session has read-only zone rights.
 *
 * Options through env: SITE_SUBDOMAIN (default: whatsappbot), PAGES_PROJECT
 * (default: whatsapp-bot), SITE_DOMAIN (default: noaura.xyz).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROJECT = process.env.PAGES_PROJECT ?? 'whatsapp-bot';
const SUBDOMAIN = process.env.SITE_SUBDOMAIN ?? 'whatsappbot';
const DOMAIN = process.env.SITE_DOMAIN ?? 'noaura.xyz';
const HOSTNAME = `${SUBDOMAIN}.${DOMAIN}`;

/**
 * The scoped API token in .cloudflare-token wins, because it can also write DNS
 * records; the wrangler OAuth session cannot (its zone rights are read-only, and
 * the Pages domain call then fails with a misleading "invalid TLD").
 */
function localToken() {
  const file = '.cloudflare-token';
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

/**
 * wrangler keeps the OAuth token in a TOML file whose location differs by
 * platform; the value is read but never printed.
 */
function wranglerToken() {
  const roots = [
    process.env.APPDATA && join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config'),
    process.env.APPDATA && join(process.env.APPDATA, 'wrangler', 'config'),
    join(homedir(), '.wrangler', 'config'),
  ].filter(Boolean);
  for (const dir of roots) {
    const file = join(dir, 'default.toml');
    if (!existsSync(file)) continue;
    const found = readFileSync(file, 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (found) return found[1];
  }
  return null;
}

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? localToken() ?? wranglerToken();
if (!TOKEN) {
  console.error('No Cloudflare credential found. Put a scoped token in .cloudflare-token, or run: npx wrangler login');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const api = async (path, options = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...options, headers: H });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`${path}: HTTP ${res.status} with a non-JSON body`);
  if (!body.success) {
    const first = body.errors?.[0];
    if (first?.code === 10000 || /did not validate/i.test(first?.message ?? '')) {
      throw new Error('the stored Cloudflare session expired — run: npx wrangler login');
    }
    throw new Error(`${path}: ${body.errors?.map((e) => e.message).join(', ') ?? res.status}`);
  }
  return body.result;
};

const [zone] = await api(`/zones?name=${DOMAIN}`);
if (!zone) {
  throw new Error(`Zone ${DOMAIN} is not visible to this login. Check the account with: npx wrangler whoami`);
}
const account = zone.account.id;
console.log(`zone ${DOMAIN} → account ${account.slice(0, 8)}…, project "${PROJECT}"`);

console.log('uploading site/ to Pages…');
// shell: true because npx is a .cmd shim on Windows, and spawn refuses it without
// a shell (the args then appear in the error dump instead of running).
execFileSync(`npx -y wrangler pages deploy site --project-name ${PROJECT} --branch main`, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: account },
});

// Pages refuses to serve a hostname it has not been told about, so the record
// alone is not enough — and this account's API rejects the attach call with
// "invalid TLD" (code 8000015) even though the dashboard does the same thing.
// Try the API, then fall back to watching the URL, and say plainly which step
// still needs the one-time dashboard click.
const project = await api(`/accounts/${account}/pages/projects/${PROJECT}`);
const pagesTarget = project.subdomain.endsWith('.pages.dev')
  ? project.subdomain
  : `${project.subdomain}.pages.dev`;

console.log(`creating the DNS record for ${HOSTNAME}…`);
const records = await api(`/zones/${zone.id}/dns_records?type=CNAME&name=${HOSTNAME}`);
if (!records.length) {
  await api(`/zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ name: HOSTNAME, type: 'CNAME', content: pagesTarget, proxied: true, ttl: 1 }),
  });
  console.log('CNAME created (proxied)');
} else {
  console.log('CNAME already present');
}

const listedDomains = async () =>
  (await api(`/accounts/${account}/pages/projects/${PROJECT}/domains`)).filter((d) => d.name === HOSTNAME);

if ((await listedDomains()).length) {
  console.log('hostname already attached');
} else {
  try {
    await api(`/accounts/${account}/pages/projects/${PROJECT}/domains`, {
      method: 'POST',
      body: JSON.stringify({ hostname: HOSTNAME }),
    });
    console.log('hostname attached to the Pages project');
  } catch (error) {
    console.log(`attach call refused (${error?.message}); the dashboard does this once at Pages → ${PROJECT} → Custom domains → Set up a custom domain.`);
  }
}

// Whether the API or the dashboard attached it, the proof is the URL answering.
let live = false;
for (let attempt = 0; attempt < 20 && !live; attempt += 1) {
  const res = await fetch(`https://${HOSTNAME}`, { redirect: 'manual' }).catch(() => null);
  live = Boolean(res && res.status < 400);
  if (live) break;
  await new Promise((r) => setTimeout(r, 15_000));
}

const [domain] = await listedDomains().catch(() => []);
const status = (name, value) => console.log(`  ${name.padEnd(11)} ${value ?? 'unknown'}`);
if (domain) {
  status('attached', domain.status);
  status('verified', domain.verification_data?.status);
  status('tls', domain.validation_data?.status);
}
console.log(
  live
    ? `\nhttps://${HOSTNAME} is serving the site.`
    : `\nhttps://${HOSTNAME} is not answering yet — finish the Custom domains step in the dashboard, then re-run this script to verify.`,
);
