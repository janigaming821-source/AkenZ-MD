import { readBody, requireCustomer, route } from './_lib.js';

/**
 * The portal's calls into a buyer's bot instance. One table is the security
 * boundary: the browser never sees the instance key, and nothing outside this
 * list can be reached through the proxy.
 */
const TARGETS = {
  status: { path: '/api/whatsapp/status', methods: ['GET'] },
  pair: { path: '/api/whatsapp/pair', methods: ['POST'] },
  qr: { path: '/api/whatsapp/qr', methods: ['GET'] },
  reconnect: { path: '/api/whatsapp/reconnect', methods: ['POST'] },
  settings: { path: '/api/settings', methods: ['GET', 'POST'] },
  logo: { path: '/api/settings/logo', methods: ['GET', 'PUT', 'DELETE'] },
};

/** Builds the handler for one action, e.g. `forward('pair')` for /api/bot/pair. */
export const forward = (name) =>
  route(async (request, env) => {
    const customer = await requireCustomer(request, env);
    if (!customer.bot_url || !customer.bot_key) {
      throw Object.assign(new Error('Your bot is not linked yet. The owner will message you when it is ready.'), { status: 503 });
    }

    const target = TARGETS[name];
    if (!target.methods.includes(request.method)) {
      throw Object.assign(new Error('That action is not available.'), { status: 405 });
    }

    const headers = new Headers({ 'x-api-key': customer.bot_key });
    const init = { method: request.method, headers };

    // A brand image is the raw bytes the browser picked, so it streams through
    // untouched; only JSON bodies are re-read.
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const type = request.headers.get('content-type') ?? '';
      if (type.includes('application/json')) {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(await readBody(request));
      } else {
        if (type) headers.set('content-type', type);
        init.body = request.body;
        init.duplex = 'half';
      }
    }

    const url = new URL(target.path, customer.bot_url.replace(/\/+$/, '') + '/');
    const upstream = await fetch(url, init).catch(() => null);
    if (!upstream) throw Object.assign(new Error('Your bot did not answer. Try again in a minute.'), { status: 502 });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' },
    });
  });
