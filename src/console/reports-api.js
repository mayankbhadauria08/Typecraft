// Business reports (docs/ADMIN-PHASE-4.md §3). Console-only endpoints: a console session is required.
//
//   GET /api/console/reports?range=7d|30d|90d|12m            revenue.view
//   GET /api/console/reports/export?range=…&kind=days|plans  revenue.view   a CSV of the same totals (no names or emails)
//
// Money is counted the way Razorpay settles it: a sale on the India day its order was paid
// (orders.paid_at, status paid, refunded or partly refunded: a refunded sale still happened),
// a refund on the day it was processed (refunds.status = 'processed'). Net = sales − refunds.
// Sign-ups and conversion leave staff accounts out. All amounts are in paise, INR.
import { json } from '../http.js';
import { requireAdmin } from './session.js';
import { Binder, oneOf, istDay, istDayStart, istDayEnd, DAY_MS, csvResponse } from './lib.js';

export const RANGES = { '7d': { days: 7, by: 'day' }, '30d': { days: 30, by: 'day' }, '90d': { days: 90, by: 'week' }, '12m': { days: 365, by: 'month' } };
const SOLD = "('paid', 'refunded', 'partially_refunded')";
const IST_DAY = (col) => `substr(datetime(${col}, '+330 minutes'), 1, 10)`;

const ownersOf = (env) => [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
function customersOnly(b, col, owners) {
  const parts = [`${col} NOT IN (SELECT user_id FROM admin_users WHERE user_id IS NOT NULL)`];
  if (owners.length) parts.push(`${col} NOT IN (SELECT id FROM users WHERE LOWER(email) IN (${owners.map((e) => b.p(e)).join(', ')}))`);
  return parts.join(' AND ');
}

/** The bucket a day falls in: the day itself, the Monday of its week, or its month. */
function bucketOf(day, by) {
  if (by === 'day') return day;
  if (by === 'month') return day.slice(0, 7);
  const t = Date.parse(day + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
}
/** Every bucket from `first` to `last`, in order, with an empty row each. */
function buckets(first, last, by) {
  const out = new Map();
  for (let t = Date.parse(first + 'T00:00:00Z'); t <= Date.parse(last + 'T00:00:00Z'); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10), key = bucketOf(day, by);
    if (!out.has(key)) out.set(key, { key, from: day, to: day, gross: 0, refunds: 0, net: 0, orders: 0, signups: 0 });
    out.get(key).to = day;
  }
  return out;
}

/** The report for a range, as the page and the CSV use it. */
export async function buildReport(env, rangeKey, now = Date.now()) {
  const range = RANGES[rangeKey] ? rangeKey : '30d';
  const { days, by } = RANGES[range];
  const today = istDay(now), first = istDay(now - (days - 1) * DAY_MS);
  const prevFirst = istDay(now - (2 * days - 1) * DAY_MS), prevLast = istDay(now - days * DAY_MS);
  const start = istDayStart(first), end = istDayEnd(today), prevStart = istDayStart(prevFirst);
  const owners = ownersOf(env), DB = env.DB, nowIso = new Date(now).toISOString();
  const stmt = (fn) => { const b = new Binder(); const sql = fn(b); return DB.prepare(sql).bind(...b.args); };

  const [sales, refunds, signups, prev, buyers, converted, everyone, renew, upcoming, lapsed, reasons] = await DB.batch([
    stmt((b) => `SELECT ${IST_DAY('o.paid_at')} AS d, o.package_id, p.name, COUNT(*) AS n, SUM(o.amount_paise) AS s
                   FROM orders o JOIN packages p ON p.id = o.package_id
                  WHERE o.status IN ${SOLD} AND o.paid_at >= ${b.p(start)} AND o.paid_at < ${b.p(end)} GROUP BY d, o.package_id`),
    stmt((b) => `SELECT ${IST_DAY('r.processed_at')} AS d, o.package_id, p.name, COUNT(*) AS n, SUM(r.amount_paise) AS s
                   FROM refunds r JOIN orders o ON o.id = r.order_id JOIN packages p ON p.id = o.package_id
                  WHERE r.status = 'processed' AND r.processed_at >= ${b.p(start)} AND r.processed_at < ${b.p(end)} GROUP BY d, o.package_id`),
    stmt((b) => `SELECT ${IST_DAY('u.created_at')} AS d, COUNT(*) AS n FROM users u
                  WHERE u.created_at >= ${b.p(start)} AND u.created_at < ${b.p(end)} AND ${customersOnly(b, 'u.id', owners)} GROUP BY d`),
    stmt((b) => `SELECT
        (SELECT COALESCE(SUM(amount_paise), 0) FROM orders WHERE status IN ${SOLD} AND paid_at >= ${b.once('ps', prevStart)} AND paid_at < ${b.once('s', start)}) AS gross,
        (SELECT COUNT(*) FROM orders WHERE status IN ${SOLD} AND paid_at >= ${b.once('ps', prevStart)} AND paid_at < ${b.once('s', start)}) AS orders,
        (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds WHERE status = 'processed' AND processed_at >= ${b.once('ps', prevStart)} AND processed_at < ${b.once('s', start)}) AS refunds,
        (SELECT COUNT(*) FROM users u WHERE u.created_at >= ${b.once('ps', prevStart)} AND u.created_at < ${b.once('s', start)} AND ${customersOnly(b, 'u.id', owners)}) AS signups`),
    stmt((b) => `SELECT COUNT(DISTINCT o.user_id) AS buyers,
                        COUNT(DISTINCT CASE WHEN NOT EXISTS (SELECT 1 FROM orders e WHERE e.user_id = o.user_id AND e.status IN ${SOLD} AND e.paid_at < ${b.once('s', start)})
                                            THEN o.user_id END) AS first_time
                   FROM orders o WHERE o.status IN ${SOLD} AND o.paid_at >= ${b.once('s', start)} AND o.paid_at < ${b.p(end)}`),
    stmt((b) => `SELECT COUNT(*) AS n FROM users u WHERE u.created_at >= ${b.p(start)} AND u.created_at < ${b.p(end)} AND ${customersOnly(b, 'u.id', owners)}
                    AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ${SOLD})`),
    stmt((b) => `SELECT COUNT(*) AS total,
                        SUM(EXISTS (SELECT 1 FROM user_subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.source = 'purchase'
                                    AND (s.expires_at IS NULL OR s.expires_at > ${b.once('now', nowIso)}))) AS paying,
                        SUM(EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ${SOLD})) AS ever_paid
                   FROM users u WHERE u.account_status = 'active' AND ${customersOnly(b, 'u.id', owners)}`),
    stmt((b) => `SELECT COALESCE(SUM(s.expires_at < ${b.p(new Date(now + 7 * DAY_MS).toISOString())}), 0) AS next7, COUNT(*) AS next30
                   FROM user_subscriptions s WHERE s.status = 'active' AND s.source = 'purchase' AND s.expires_at > ${b.once('now', nowIso)}
                    AND s.expires_at < ${b.p(new Date(now + 30 * DAY_MS).toISOString())}`),
    stmt((b) => `SELECT s.user_id, u.full_name, u.email, p.name AS plan, s.expires_at FROM user_subscriptions s JOIN users u ON u.id = s.user_id JOIN packages p ON p.id = s.package_id
                  WHERE s.status = 'active' AND s.source = 'purchase' AND s.expires_at > ${b.once('now', nowIso)} AND s.expires_at < ${b.p(new Date(now + 30 * DAY_MS).toISOString())}
                  ORDER BY s.expires_at LIMIT 10`),
    stmt((b) => `SELECT COUNT(DISTINCT s.user_id) AS n FROM user_subscriptions s
                  WHERE s.source = 'purchase' AND s.expires_at >= ${b.p(start)} AND s.expires_at < ${b.once('now', nowIso)}
                    AND NOT EXISTS (SELECT 1 FROM user_subscriptions t WHERE t.user_id = s.user_id AND t.status = 'active' AND (t.expires_at IS NULL OR t.expires_at > ${b.once('now', nowIso)}))`),
    stmt((b) => `SELECT COALESCE(reason, 'No reason given') AS reason, COUNT(*) AS n, SUM(amount_paise) AS s FROM refunds
                  WHERE status = 'processed' AND processed_at >= ${b.p(start)} AND processed_at < ${b.p(end)} GROUP BY reason`),
  ]);

  const series = buckets(first, today, by);
  const plans = new Map();
  const plan = (id, name) => { if (!plans.has(id)) plans.set(id, { id, name, orders: 0, gross: 0, refunds: 0, net: 0 }); return plans.get(id); };
  let gross = 0, orders = 0, refunded = 0, joined = 0;
  for (const r of sales.results) {
    const b = series.get(bucketOf(r.d, by)); if (b) { b.gross += r.s; b.orders += r.n; }
    const p = plan(r.package_id, r.name); p.gross += r.s; p.orders += r.n;
    gross += r.s; orders += r.n;
  }
  for (const r of refunds.results) {
    const b = series.get(bucketOf(r.d, by)); if (b) b.refunds += r.s;
    plan(r.package_id, r.name).refunds += r.s;
    refunded += r.s;
  }
  for (const r of signups.results) { const b = series.get(bucketOf(r.d, by)); if (b) b.signups += r.n; joined += r.n; }
  for (const b of series.values()) b.net = b.gross - b.refunds;
  for (const p of plans.values()) p.net = p.gross - p.refunds;

  // refund reasons: "Customer request: bought the wrong plan" counts as "Customer request"
  const why = new Map();
  for (const r of reasons.results) {
    const key = String(r.reason).split(':')[0].trim() || 'No reason given';
    const w = why.get(key) || { reason: key, count: 0, amount: 0 };
    w.count += r.n; w.amount += r.s; why.set(key, w);
  }
  const p = prev.results[0], all = everyone.results[0], bu = buyers.results[0];
  return {
    range, by, from: first, to: today, previous: { from: prevFirst, to: prevLast },
    totals: {
      gross: { now: gross, before: p.gross }, refunds: { now: refunded, before: p.refunds },
      net: { now: gross - refunded, before: p.gross - p.refunds }, orders: { now: orders, before: p.orders },
      signups: { now: joined, before: p.signups }, avgOrder: orders ? Math.round(gross / orders) : 0,
      buyers: bu.buyers, firstTime: bu.first_time, converted: converted.results[0].n,
    },
    series: [...series.values()],
    byPlan: [...plans.values()].sort((a, b) => b.gross - a.gross),
    refundReasons: [...why.values()].sort((a, b) => b.amount - a.amount),
    customers: { total: all.total || 0, payingNow: all.paying || 0, everPaid: all.ever_paid || 0 },
    renewals: {
      next7: renew.results[0].next7, next30: renew.results[0].next30, lapsed: lapsed.results[0].n,
      upcoming: upcoming.results.map((r) => ({ customerId: r.user_id, name: r.full_name, email: r.email, plan: r.plan, expiresAt: r.expires_at })),
    },
    currency: 'INR', at: new Date(now).toISOString(),
  };
}

export async function getReports(request, env) {
  await requireAdmin(env, request, 'revenue.view');
  const range = oneOf(new URL(request.url).searchParams.get('range'), Object.keys(RANGES), '30d');
  return json(await buildReport(env, range));
}

const rupees = (paise) => (paise / 100).toFixed(2);
export async function getReportsExport(request, env) {
  await requireAdmin(env, request, 'revenue.view');
  const q = new URL(request.url).searchParams;
  const range = oneOf(q.get('range'), Object.keys(RANGES), '30d');
  const kind = oneOf(q.get('kind'), ['days', 'plans'], 'days');
  const r = await buildReport(env, range);
  if (kind === 'plans') {
    return csvResponse(`typecraft-sales-by-plan-${r.from}-to-${r.to}.csv`, ['Plan', 'Orders', 'Sales (INR)', 'Refunds (INR)', 'Net (INR)'],
      r.byPlan.map((p) => [p.name, p.orders, rupees(p.gross), rupees(p.refunds), rupees(p.net)]));
  }
  const unit = { day: 'Day', week: 'Week starting', month: 'Month' }[r.by];
  return csvResponse(`typecraft-sales-${r.from}-to-${r.to}.csv`, [unit, 'Orders', 'Sales (INR)', 'Refunds (INR)', 'Net (INR)', 'Sign-ups'],
    r.series.map((b) => [b.key, b.orders, rupees(b.gross), rupees(b.refunds), rupees(b.net), b.signups]));
}

export const ROUTES = {
  'GET /api/console/reports': getReports,
  'GET /api/console/reports/export': getReportsExport,
};
