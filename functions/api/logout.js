import { CUSTOMER_COOKIE, clearCookie, json, route } from '../_lib.js';

export const onRequestPost = route(async () =>
  json({ ok: true }, 200, { 'set-cookie': clearCookie(CUSTOMER_COOKIE) })
);
