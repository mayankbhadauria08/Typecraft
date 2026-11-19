// Dashboard (docs/ADMIN-PHASE-2.md §11): how the business is doing, from the real tables, in one batch.
//
//   GET /api/console/dashboard?range=today|7d|30d    dashboard.view   money only with revenue.view
//
// Days are India days. Each figure comes with the same figure for the period just before. The
// "needs attention" list holds only what the role may open, each with the page that shows it.
import { json, nowIso } from '../http.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { setupItems } from './access-api.js';
import { DAY_MS, IST_MIN, oneOf, istDay, istDayStart, istDayEnd } from './lib.js';
import { CONSOLE_BASE } from './config.js';

const SOLD = "('paid', 'partially_refunded', 'refunded')";
const WAITING = "('created', 'attempted', 'pending')";
// an India day from a stored ISO time, in SQL
const dayOf = (column) => `substr(datetime(${column}, '+${IST_MIN} minutes'), 1, 10)`;
const RANGES = { today: 1, '7d': 7, '30d': 30 };

export async function getDashboard(request, env) {
  const who = await requireAdmin(env, request, 'dashboard.view');
  const perms = await permissionsFor(env, who.role);
  const can = (k) => perms.includes(k);
  const range = oneOf(new URL(request.url).searchParams.get('range'), Object.keys(RANGES), '7d');
  const n = RANGES[range];
  const now = nowIso(), today = istDay();
  const first = istDay(Date.now() - (n - 1) * DAY_MS), before = istDay(Date.now() - (2 * n - 1) * DAY_MS);
  const c0 = istDayStart(first), c1 = istDayEnd(today), p0 = istDayStart(before);
  // the chart always shows at least 7 days
  const chartDays = Math.max(7, n), chartFirst = istDay(Date.now() - (chartDays - 1) * DAY_MS), chartStart = istDayStart(chartFirst);
  const soon = new Date(Date.now() + 7 * DAY_MS).toISOString(), stuck = new Date(Date.now() - 15 * 60000).toISOString();
  const week = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const DB = env.DB;

  const q = {
    users: DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1 AND created_at < ?2), 0) AS cur,
                              COALESCE(SUM(created_at >= ?3 AND created_at < ?1), 0) AS prev FROM users`).bind(c0, c1, p0),
    learners: DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN day >= ?1 THEN user_id END) AS cur, COUNT(DISTINCT CASE WHEN day < ?1 THEN user_id END) AS prev
                            FROM daily_totals WHERE day >= ?2 AND day <= ?3 AND seconds > 0`).bind(first, before, today),
    plans: DB.prepare(`SELECT p.id, p.name, COUNT(DISTINCT s.user_id) AS n FROM packages p
                         LEFT JOIN user_subscriptions s ON s.package_id = p.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1)
                        WHERE p.id <> 'free' GROUP BY p.id ORDER BY p.display_order, p.id`).bind(now),
    paying: DB.prepare(`SELECT COUNT(DISTINCT user_id) AS n, COALESCE(SUM(expires_at > ?1 AND expires_at <= ?2), 0) AS ending FROM user_subscriptions
                         WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?1)`).bind(now, soon),
    orders: DB.prepare(`SELECT COALESCE(SUM(status IN ${SOLD} AND paid_at >= ?1 AND paid_at < ?2), 0) AS paid,
                               COALESCE(SUM(status IN ${SOLD} AND paid_at >= ?3 AND paid_at < ?1), 0) AS paid_prev,
                               COALESCE(SUM(CASE WHEN status IN ${SOLD} AND paid_at >= ?1 AND paid_at < ?2 THEN amount_paise END), 0) AS gross,
                               COALESCE(SUM(CASE WHEN status IN ${SOLD} AND paid_at >= ?3 AND paid_at < ?1 THEN amount_paise END), 0) AS gross_prev,
                               COALESCE(SUM(status = 'failed' AND created_at >= ?1 AND created_at < ?2), 0) AS failed,
                               COALESCE(SUM(status = 'failed' AND created_at >= ?3 AND created_at < ?1), 0) AS failed_prev,
                               COALESCE(SUM(status IN ${WAITING} AND created_at >= ?1 AND created_at < ?2), 0) AS waiting
                          FROM orders WHERE paid_at >= ?3 OR created_at >= ?3`).bind(c0, c1, p0),
    refunds: DB.prepare(`SELECT COALESCE(SUM(CASE WHEN processed_at >= ?1 AND processed_at < ?2 THEN amount_paise END), 0) AS cur,
                                COALESCE(SUM(CASE WHEN processed_at < ?1 THEN amount_paise END), 0) AS prev
                           FROM refunds WHERE status = 'processed' AND processed_at >= ?3`).bind(c0, c1, p0),
    // needs attention
    stuck: DB.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE o.created_at < ?1 AND o.created_at > ?2
                          AND (o.status = 'pending' OR (o.status IN ('created', 'attempted') AND EXISTS (SELECT 1 FROM payments y WHERE y.order_id = o.id)))`).bind(stuck, week),
    refundsOpen: DB.prepare(`SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'failed'), 0) AS failed FROM refunds WHERE status IN ('pending', 'failed')`),
    emails: DB.prepare(`SELECT COUNT(*) AS n FROM email_logs WHERE status IN ('failed', 'bounced') AND created_at >= ?1 AND COALESCE(last_error, '') <> 'not_configured'`).bind(week),
    messages: DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    // the chart
    signups: DB.prepare(`SELECT ${dayOf('created_at')} AS day, COUNT(*) AS n FROM users WHERE created_at >= ?1 GROUP BY day`).bind(chartStart),
    sales: DB.prepare(`SELECT ${dayOf('paid_at')} AS day, COUNT(*) AS n, SUM(amount_paise) AS gross FROM orders WHERE status IN ${SOLD} AND paid_at >= ?1 GROUP BY day`).bind(chartStart),
    returned: DB.prepare(`SELECT ${dayOf('processed_at')} AS day, SUM(amount_paise) AS amount FROM refunds WHERE status = 'processed' AND processed_at >= ?1 GROUP BY day`).bind(chartStart),
  };
  const names = Object.keys(q);
  const answers = await DB.batch(names.map((k) => q[k]));
  const R = Object.fromEntries(names.map((k, i) => [k, answers[i].results]));
  const one = (k) => R[k][0] || {};
  const money = can('revenue.view');

  const users = one('users'), learners = one('learners'), paying = one('paying'), orders = one('orders'), refunds = one('refunds');
  const pair = (cur, prev) => ({ now: cur || 0, before: prev || 0 });

  // needs attention: only what this role may open, each with where to look
  const attention = [];
  // text: [for one, for more]
  const add = (perm, count, text, href) => {
    if (count > 0 && (!perm || can(perm))) attention.push({ count, text: count === 1 ? text[0] : text[1], href });
  };
  add('payments.view', one('stuck').n, ['payment started over 15 minutes ago and still not confirmed', 'payments started over 15 minutes ago and still not confirmed'],
    `${CONSOLE_BASE}/payments?status=pending`);
  add('refunds.view', one('refundsOpen').pending, ['refund still on its way', 'refunds still on their way'], `${CONSOLE_BASE}/refunds?status=pending`);
  add('refunds.view', one('refundsOpen').failed, ['refund that failed', 'refunds that failed'], `${CONSOLE_BASE}/refunds?status=failed`);
  add('emails.view', one('emails').n, ['email that failed in the last 7 days', 'emails that failed in the last 7 days'], `${CONSOLE_BASE}/email-log?status=failed`);
  add('support.view', one('messages').n, ['new message from the contact form', 'new messages from the contact form'], `${CONSOLE_BASE}/support?status=new`);
  if (can('settings.view')) {
    const off = setupItems(env).filter((i) => !i.ready).map((i) => i.label.toLowerCase()).join(', ');
    add(null, setupItems(env).filter((i) => !i.ready).length, ['service not set up: ' + off, 'services not set up: ' + off], CONSOLE_BASE);
  }

  const signups = new Map(R.signups.map((r) => [r.day, r.n])), sales = new Map(R.sales.map((r) => [r.day, r])), returned = new Map(R.returned.map((r) => [r.day, r.amount]));
  const days = Array.from({ length: chartDays }, (_, i) => {
    const day = istDay(Date.parse(chartStart) + i * DAY_MS);
    const s = sales.get(day) || {};
    return { day, signups: signups.get(day) || 0, paid: s.n || 0, netPaise: money ? (s.gross || 0) - (returned.get(day) || 0) : null };
  });

  return json({
    range, from: first, to: today, previous: { from: before, to: istDay(Date.parse(c0) - DAY_MS) },
    customers: { total: users.total || 0, new: pair(users.cur, users.prev), learners: pair(learners.cur, learners.prev) },
    plans: { paying: paying.n || 0, endingIn7Days: paying.ending || 0, byPackage: R.plans.map((p) => ({ id: p.id, name: p.name, customers: p.n })) },
    payments: { paid: pair(orders.paid, orders.paid_prev), failed: pair(orders.failed, orders.failed_prev), waiting: orders.waiting || 0 },
    money: money ? {
      gross: pair(orders.gross, orders.gross_prev), refunds: pair(refunds.cur, refunds.prev),
      net: pair((orders.gross || 0) - (refunds.cur || 0), (orders.gross_prev || 0) - (refunds.prev || 0)), currency: 'INR',
    } : null,
    attention,
    chart: days,
    at: now,
  });
}

export const ROUTES = { 'GET /api/console/dashboard': getDashboard };
export const PATTERNS = [];
