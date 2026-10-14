import { ADMIN_COOKIE, adminMatches, badRequest, json, route, sessionCookie, signToken } from '../../_lib.js';

export const onRequestPost = route(async (request, env) => {
  if (!(await adminMatches(request, env))) {
    await new Promise((r) => setTimeout(r, 800));
    return badRequest('Wrong password.', 401);
  }
  const token = await signToken(env, { role: 'admin' });
  const hours = Number(env.SESSION_TTL_HOURS) || 72;
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(ADMIN_COOKIE, token, hours * 3600) });
});
