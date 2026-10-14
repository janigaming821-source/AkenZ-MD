import { json, readBody, requireAdmin, route } from '../../_lib.js';

export const onRequestPost = route(async (request, env) => {
  await requireAdmin(request, env);
  const { order_id: orderId, reason = '' } = await readBody(request);
  const { meta } = await env.DB.prepare(
    "UPDATE orders SET status = 'rejected', handled_at = datetime('now'), notes = notes || ? WHERE id = ? AND status != 'approved'"
  )
    .bind(reason ? `\nRejected: ${reason}` : '', Number(orderId))
    .run();
  if (!meta.changes) throw Object.assign(new Error('Nothing to reject — check the order id.'), { status: 404 });
  return json({ ok: true });
});
