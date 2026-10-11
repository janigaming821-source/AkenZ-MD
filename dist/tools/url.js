import { lookup } from 'node:dns/promises';
const PRIVATE_V4 = [
    /^(127\.|10\.|192\.168\.|0\.)/,
    /^(169\.254\.)/,
    /^(172\.(1[6-9]|2\d|3[01])\.)/,
    /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/,
];
export function isPrivateAddress(ip) {
    if (ip === '::1' || ip.toLowerCase().startsWith('fe80') || ip.toLowerCase().startsWith('fc'))
        return true;
    if (ip === '::ffff:127.0.0.1')
        return true;
    return PRIVATE_V4.some((re) => re.test(ip));
}
/**
 * Accepts only public http(s) URLs. Blocks hostnames that resolve to loopback,
 * private ranges or cloud metadata endpoints, so a chat message cannot make the
 * bot scan the owner's local network.
 */
export async function validatePublicUrl(raw) {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        return { ok: false, reason: 'not-a-url' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return { ok: false, reason: 'unsupported-scheme' };
    const host = url.hostname;
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
        return { ok: false, reason: 'private-host' };
    }
    // IPv6 literals arrive bracketed in URLs.
    const bare = host.replace(/^\[|\]$/g, '');
    if (/^[\d.]+$/.test(bare)) {
        return isPrivateAddress(bare) ? { ok: false, reason: 'private-address' } : { ok: true, url };
    }
    if (/^[0-9a-fA-F:.]*$/.test(bare) && bare.includes(':')) {
        return isPrivateAddress(bare) ? { ok: false, reason: 'private-address' } : { ok: true, url };
    }
    try {
        const records = await lookup(host, { all: true });
        if (!records.length)
            return { ok: false, reason: 'unresolvable' };
        if (records.some((r) => isPrivateAddress(r.address)))
            return { ok: false, reason: 'private-address' };
        return { ok: true, url };
    }
    catch {
        return { ok: false, reason: 'unresolvable' };
    }
}
export async function inspectUrl(startUrl) {
    const validated = await validatePublicUrl(startUrl);
    if (!validated.ok)
        return { ok: false, reason: validated.reason };
    const { default: axios } = await import('axios');
    try {
        const response = await axios.get(validated.url.toString(), {
            method: 'HEAD',
            maxRedirects: 5,
            timeout: 15_000,
            validateStatus: () => true,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NOAURABot/1.0)' },
        });
        return {
            ok: true,
            data: {
                finalUrl: response.request?.res?.responseUrl ?? validated.url.toString(),
                status: response.status,
                contentType: String(response.headers['content-type'] ?? '—'),
                lengthBytes: response.headers['content-length'] ? Number(response.headers['content-length']) : null,
                redirects: response.request?.res?.socket?.reqs?.length ?? 0,
                server: String(response.headers['server'] ?? '—'),
            },
        };
    }
    catch {
        return { ok: false, reason: 'unreachable' };
    }
}
//# sourceMappingURL=url.js.map