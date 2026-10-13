/**
 * Publishes site/ on Cloudflare Pages and points a subdomain at it.
 * Needs a Cloudflare API token with "Pages: Edit" and "DNS: Edit" for the zone:
 *
 *   CLOUDFLARE_API_TOKEN=xxxx node deploy-site-cloudflare.mjs
 *
 * Options through env: CF_ACCOUNT_ID (default: the Noaura account), SITE_SUBDOMAIN
 * (default: whatsapp), PAGES_PROJECT (default: whatsapp-bot), SITE_DOMAIN (default: noaura.xyz).
 */
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set. Create one at dash.cloudflare.com → My Profile → API Tokens (template: Edit Cloudflare Workers, plus DNS:Edit for the zone).');
  process.exit(1);
}

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? '7a8f4a5018ba5948c7273f2d0ea63102';
const PROJECT = process.env.PAGES_PROJECT ?? 'whatsapp-bot';
const SUBDOMAIN = process.env.SITE_SUBDOMAIN ?? 'whatsapp';
const DOMAIN = process.env.SITE_DOMAIN ?? 'noaura.xyz';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const api = async (path, options = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...options, headers: H });
  const body = await res.json();
  if (!body.success) throw new Error(`${path}: ${body.errors?.map((e) => e.message).join(', ') ?? res.status}`);
  return body.result;
};

console.log(`deploying site/ to Pages project "${PROJECT}"…`);
execFileSync('npx', ['-y', 'wrangler', 'pages', 'deploy', 'site', '--project-name', PROJECT, '--branch', 'main'], {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
});

const target = `${PROJECT}.pages.dev`;
const [zone] = await api(`/zones?name=${DOMAIN}`);
if (!zone) throw new Error(`Zone ${DOMAIN} is not in this Cloudflare account.`);

const existing = await api(`/zones/${zone.id}/dns_records?type=CNAME&name=${SUBDOMAIN}.${DOMAIN}`);
const record = { name: `${SUBDOMAIN}.${DOMAIN}`, type: 'CNAME', content: target, proxied: true };
if (existing[0]) {
  await api(`/zones/${zone.id}/dns_records/${existing[0].id}`, { method: 'PUT', body: JSON.stringify(record) });
  console.log(`CNAME ${record.name} updated → ${target} (proxied)`);
} else {
  const created = await api(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(record) });
  console.log(`CNAME ${record.name} created → ${target} (proxied, id ${created.id})`);
}

const dns = await api(`/zones/${zone.id}/dns_records?type=CNAME&name=${SUBDOMAIN}.${DOMAIN}`);
console.log(`\nhttps://${SUBDOMAIN}.${DOMAIN} is wired to ${target}.`);
console.log(`Check it in a minute or two: curl -sI https://${SUBDOMAIN}.${DOMAIN} | head -3`);
