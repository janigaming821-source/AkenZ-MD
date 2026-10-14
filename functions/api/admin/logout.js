import { ADMIN_COOKIE, clearCookie, json, route } from '../../_lib.js';

export const onRequestPost = route(async () => json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) }));
