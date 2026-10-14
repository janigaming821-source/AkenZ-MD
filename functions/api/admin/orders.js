import { json, requireAdmin, route } from '../../_lib.js';

const LIST = `
  SELECT o.*, c.phone AS account_phone, c.bot_url AS account_bot_url, c.instance_id AS account_instance
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE (? = 'all' OR o.status = ?)
  ORDER BY datetime(o.created_at) DESC
  LIMIT 200
`;

const COUNTS = 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status';

export const onRequestGet = route(async (request, env) => {
  await requireAdmin(request, env);
  const status = new URL(request.url).searchParams.get('status') ?? 'pending';
  const [rows, counts] = await Promise.all([
    env.DB.prepare(LIST).bind(status, status).all(),
    env.DB.prepare(COUNTS).all(),
  ]);
  const byStatus = Object.fromEntries(counts.results.map((c) => [c.status, c.n]));
  return json({ orders: rows.results, counts: { pending: byStatus.pending ?? 0, approved: byStatus.approved ?? 0, rejected: byStatus.rejected ?? 0, all: Object.values(byStatus).reduce((a, b) => a + b, 0) } });
});
