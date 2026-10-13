/**
 * Publishes site/ on Cloudflare Pages and puts it on whatsapp.noaura.xyz.
 * Needs one API token with, for the noaura.xyz zone: Zone:Read, DNS:Edit,
 * Pages:Edit (dash.cloudflare.com → My Profile → API Tokens → Create Token).
 *
 *   CLOUDFLARE_API_TOKEN=xxxx node deploy-site-cloudflare.mjs
 *
 * Options through env: SITE_SUBDOMAIN (default: whatsapp), PAGES_PROJECT
 * (default: whatsapp-bot), SITE_DOMAIN (default: noaura.xyz). The account id is
 * read from the zone instead of being hardcoded, so a wrong guess cannot be
 * baked into this file.
 */
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set. Create one at dash.cloudflare.com → My Profile → API Tokens with Zone:Read, DNS:Edit and Pages:Edit for the noaura.xyz zone.');
  process.exit(1);
}

const PROJECT = process.env.PAGES_PROJECT ?? 'whatsapp-bot';
const SUBDOMAIN = process.env.SITE_SUBDOMAIN ?? 'whatsapp';
const DOMAIN = process.env.SITE_DOMAIN ?? 'noaura.xyz';
const HOSTNAME = `${SUBDOMAIN}.${DOMAIN}`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const api = async (path, options = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...options, headers: H });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`${path}: HTTP ${res.status} with a non-JSON body`);
  if (!body.success) throw new Error(`${path}: ${body.errors?.map((e) => e.message).join(', ') ?? res.status}`);
  return body.result;
};

const zones = (await api(`/zones?name=${DOMAIN}`)).filter(Boolean);
if (!zones.length) {
  throw new Error(`Zone ${DOMAIN} is not visible to this token. Check the token's zone scope, and that ${DOMAIN} is on this Cloudflare account.`);
}
const zone = zones[0];
const account = zone.account.id;
console.log(`zone ${DOMAIN} → account ${account.slice(0, 8)}…, project "${PROJECT}"`);

console.log('uploading site/ to Pages…');
execFileSync('npx', ['-y', 'wrangler', 'pages', 'deploy', 'site', '--project-name', PROJECT, '--branch', 'main'], {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: account },
});

// The DNS record alone is not enough: Pages only serves hostnames it has been
// told about, and answers "This custom hostname is not associated with this
// project" for anything else. This call creates the record and the certificate.
console.log(`attaching ${HOSTNAME} to the Pages project…`);
let attached;
try {
  attached = await api(`/accounts/${account}/pages/projects/${PROJECT}/domains`, {
    method: 'POST',
    body: JSON.stringify({ hostname: HOSTNAME }),
  });
} catch (error) {
  // Re-running after a partial success: the hostname is already there, so read
  // its state instead of failing on "already exists".
  if (!/exist/i.test(String(error?.message))) throw error;
  attached = await api(`/accounts/${account}/pages/projects/${PROJECT}/domains/${HOSTNAME}`);
  console.log('already attached, checking its state');
}

// Validation and the certificate both happen asynchronously after the POST.
let status = attached;
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (status.ssl?.status === 'active' && status.dns?.status === 'resolved' && status.validation?.status === 'active') break;
  await new Promise((r) => setTimeout(r, 15_000));
  status = await api(`/accounts/${account}/pages/projects/${PROJECT}/domains/${HOSTNAME}`);
}

const describe = (label, value) => console.log(`${label}: ${value ?? 'unknown'}`);
describe('dns', status.dns?.status ?? status.dns);
describe('ssl', status.ssl?.status);
describe('validation', status.validation?.status);
console.log(`\nhttps://${HOSTNAME}`);
console.log('If the domain or the certificate is still pending, re-run this script — it is safe to repeat.');
