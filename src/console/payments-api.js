// Payments (docs/ADMIN-PHASE-2.md §6). Console-only endpoints: a console session is required.
// One row is one order: a customer's attempt to buy a plan. An order can have several
// payment attempts at Razorpay, and refunds.
//
//   GET  /api/console/payments                   payments.view     list: q, status, package, from, to, page
//   GET  /api/console/payments/export.csv        payments.export   the same filters as a spreadsheet (password check)
//   GET  /api/console/payments/:orderId          payments.view     the order, its payment attempts, refunds, invoice, plan
//   POST /api/console/payments/:orderId/recheck  payments.recheck  ask Razorpay what happened to an order that is not paid
//
// Nothing here marks an order paid by itself: only a payment Razorpay reports as captured
// for that order and amount does (reconcileOrder() in src/billing.js).
import { HttpError, json, nowIso, clientIp } from '../http.js';
import { orderDiscount } from '../pricing.js';
import { hitLimit, emailEnabled } from '../session.js';
import * as rzp from '../razorpay.js';
import { audit, reconcileOrder } from '../billing.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { PAGE_SIZE, EXPORT_MAX, Binder, pageOf, offsetOf, paged, like, oneOf, idParam, isDay, istDay, istDayStart, istDayEnd, istStamp, csvResponse, parseJson, ownAccount } from './lib.js';

/* ---------- the list ---------- */
// what the Status filter means in the orders table
export const ORDER_GROUPS = {
  paid: ['paid'],
  pending: ['created', 'attempted', 'pending'],
  failed: ['failed'],
  refunded: ['refunded', 'partially_refunded'],
  cancelled: ['cancelled'],
};
const SETTLED = "('captured', 'refunded', 'partially_refunded')";
const FROM = 'FROM orders o JOIN users u ON u.id = o.user_id JOIN packages p ON p.id = o.package_id LEFT JOIN invoices i ON i.order_id = o.id';
// the attempt that counts for an order: the one that was paid, else the latest
const attempt = (column) => `(SELECT y.${column} FROM payments y WHERE y.order_id = o.id ORDER BY (y.status IN ${SETTLED}) DESC, y.created_at DESC LIMIT 1)`;

/** WHERE for the list, its COUNT and the export: built against one binder per statement. */
export function ordersWhere(b, q) {
  const where = [];
  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`u.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${b.p(like(term))} ESCAPE '\\'`];
    if (/^[\w-]{6,64}$/.test(term)) {
      // an id: ours, Razorpay's, the customer's, or an invoice number. Always the whole id, so the unique indexes answer.
      const t = b.p(term);
      parts.push(`o.id = ${t}`, `o.razorpay_order_id = ${t}`, `o.user_id = ${t}`, `i.number = ${b.p(term.toUpperCase())}`,
        `EXISTS (SELECT 1 FROM payments y WHERE y.order_id = o.id AND y.razorpay_payment_id = ${t})`,
        `EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id AND r.razorpay_refund_id = ${t})`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const group = Object.hasOwn(ORDER_GROUPS, q.get('status') || '') ? ORDER_GROUPS[q.get('status')] : null;
  if (group) where.push(`o.status IN (${group.map((s) => b.p(s)).join(', ')})`);
  const pkg = q.get('package') || '';
  if (/^[a-z][a-z0-9-]{0,30}$/.test(pkg)) where.push(`o.package_id = ${b.p(pkg)}`);
  const from = q.get('from'), to = q.get('to');
  if (isDay(from)) where.push(`o.created_at >= ${b.p(istDayStart(from))}`);
  if (isDay(to)) where.push(`o.created_at < ${b.p(istDayEnd(to))}`);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

function listStatement(env, q, { limit, offset }) {
  const b = new Binder();
  const where = ordersWhere(b, q);
  return env.DB.prepare(
    `SELECT o.id, o.user_id, o.amount_paise, o.currency, o.status, o.created_at, o.paid_at, o.razorpay_order_id, o.failure_reason,
            u.full_name, u.email, p.name AS package_name, i.number AS invoice_number,
            ${attempt('method')} AS method, ${attempt('razorpay_payment_id')} AS razorpay_payment_id,
            (SELECT COALESCE(SUM(r.amount_paise), 0) FROM refunds r WHERE r.order_id = o.id AND r.status = 'processed') AS refunded_paise
       ${FROM} ${where}
      ORDER BY o.created_at DESC, o.id LIMIT ${limit} OFFSET ${offset}`
  ).bind(...b.args);
}
function countStatement(env, q) {
  const b = new Binder();
  const where = ordersWhere(b, q);
  return env.DB.prepare(`SELECT COUNT(*) AS n ${FROM} ${where}`).bind(...b.args);
}

export async function getPayments(request, env) {
  await requireAdmin(env, request, 'payments.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB;
  const [rows, count, packages] = await DB.batch([
    listStatement(env, q, { limit: PAGE_SIZE, offset: offsetOf(page) }),
    countStatement(env, q),
    DB.prepare("SELECT id, name FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  const items = rows.results.map((o) => ({
    id: o.id, createdAt: o.created_at, paidAt: o.paid_at, status: o.status, amountPaise: o.amount_paise, currency: o.currency,
    refundedPaise: o.refunded_paise, packageName: o.package_name, method: o.method || null, invoiceNumber: o.invoice_number || null,
    customer: { id: o.user_id, fullName: o.full_name, email: o.email },
  }));
  return json({ ...paged(items, page, count.results[0].n), packages: packages.results });
}

const STATUS_WORDS = { created: 'Not paid yet', attempted: 'Not paid yet', pending: 'Processing', paid: 'Paid', failed: 'Failed',
  refunded: 'Refunded', partially_refunded: 'Partly refunded', cancelled: 'Cancelled' };
const rupees = (paise) => ((paise || 0) / 100).toFixed(2);

export async function exportPayments(request, env) {
  const who = await requireAdmin(env, request, 'payments.export');
  const q = new URL(request.url).searchParams;
  const rows = (await listStatement(env, q, { limit: EXPORT_MAX + 1, offset: 0 }).all()).results;
  const more = rows.length > EXPORT_MAX;
  const out = rows.slice(0, EXPORT_MAX).map((o) => [
    istStamp(o.created_at), o.full_name, o.email, o.package_name, rupees(o.amount_paise), o.currency, STATUS_WORDS[o.status] || o.status,
    o.method || '', rupees(o.refunded_paise), o.paid_at ? istStamp(o.paid_at) : '', o.invoice_number || '', o.id, o.razorpay_order_id || '',
    o.razorpay_payment_id || '', o.status === 'failed' ? (o.failure_reason || '') : '',
  ]);
  const filters = Object.fromEntries(['q', 'status', 'package', 'from', 'to'].filter((k) => q.get(k)).map((k) => [k, k === 'q' ? '(search text)' : q.get(k)]));
  await audit(env, { actorId: who.user.id, action: 'payments.export', target: 'payments', detail: { rows: out.length, cutOff: more, filters }, ip: clientIp(request) });
  return csvResponse(`typecraft-payments-${istDay()}.csv`,
    ['Date (India time)', 'Customer', 'Email', 'Plan', 'Amount', 'Currency', 'Status', 'Paid with', 'Refunded', 'Paid at (India time)', 'Invoice',
      'Order ID', 'Razorpay order ID', 'Razorpay payment ID', 'Why it failed'], out);
}

/* ---------- one order ---------- */
// an order that is not paid can be checked again, also after it was marked failed or cancelled:
// a later attempt on the same Razorpay order may have gone through
const RECHECKABLE = ['created', 'attempted', 'pending', 'failed', 'cancelled'];

async function orderRow(env, id) {
  const o = await env.DB.prepare(
    `SELECT o.*, u.full_name, u.email, u.account_status, p.name AS package_name
       FROM orders o JOIN users u ON u.id = o.user_id JOIN packages p ON p.id = o.package_id WHERE o.id = ?1`
  ).bind(idParam(id, 'Payment not found.')).first();
  if (!o) throw new HttpError(404, 'not_found', 'Payment not found.');
  return o;
}
/** Why this order cannot be checked with Razorpay; null when it can. */
function recheckBlock(env, o) {
  if (!RECHECKABLE.includes(o.status)) return 'This order is already paid. There is nothing to check.';
  if (!o.razorpay_order_id) return 'This order never reached Razorpay, so there is nothing to check.';
  if (!rzp.configured(env)) return 'The Razorpay keys are not set, so this order cannot be checked.';
  return null;
}

export async function getPayment(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'payments.view');
  const o = await orderRow(env, params.id);
  const perms = await permissionsFor(env, who.role);
  const has = (k) => perms.includes(k);
  const DB = env.DB, now = nowIso();

  const stmts = {
    attempts: DB.prepare(
      `SELECT y.id, y.razorpay_payment_id, y.amount_paise, y.currency, y.status, y.method, y.error_description, y.verified_by, y.captured_at, y.created_at,
              (SELECT COALESCE(SUM(r.amount_paise), 0) FROM refunds r WHERE r.payment_id = y.id AND r.status = 'processed') AS refunded,
              (SELECT COALESCE(SUM(r.amount_paise), 0) FROM refunds r WHERE r.payment_id = y.id AND r.status = 'pending') AS refunding
         FROM payments y WHERE y.order_id = ?1 ORDER BY y.created_at DESC, y.id LIMIT 50`).bind(o.id),
    refunds: DB.prepare(
      `SELECT r.id, r.payment_id, r.razorpay_refund_id, r.amount_paise, r.status, r.reason, r.processed_at, r.created_at, x.full_name AS requester
         FROM refunds r LEFT JOIN users x ON x.id = r.requested_by WHERE r.order_id = ?1 ORDER BY r.created_at DESC, r.id LIMIT 50`).bind(o.id),
    invoice: DB.prepare('SELECT number, amount_paise, issued_at FROM invoices WHERE order_id = ?1').bind(o.id),
    plan: DB.prepare('SELECT id, status, source, starts_at, expires_at FROM user_subscriptions WHERE order_id = ?1').bind(o.id),
  };
  if (has('audit.view')) {
    stmts.activity = DB.prepare(
      `SELECT a.action, a.detail, a.created_at, x.full_name AS actor FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id
        WHERE a.target = ?1 OR a.target IN (SELECT 'payment:' || y.id FROM payments y WHERE y.order_id = ?2)
        ORDER BY a.created_at DESC LIMIT 30`).bind(`order:${o.id}`, o.id);
  }
  const names = Object.keys(stmts);
  const answers = await DB.batch(names.map((k) => stmts[k]));
  const R = Object.fromEntries(names.map((k, i) => [k, answers[i].results]));

  const inv = R.invoice[0] || null, sub = R.plan[0] || null;
  const block = recheckBlock(env, o);
  const keys = rzp.configured(env);
  const attempts = R.attempts.map((y) => ({
    id: y.id, razorpayPaymentId: y.razorpay_payment_id, amountPaise: y.amount_paise, currency: y.currency, status: y.status, method: y.method || null,
    error: y.status === 'failed' ? (y.error_description || null) : null, verifiedBy: y.verified_by, capturedAt: y.captured_at, createdAt: y.created_at,
    refundedPaise: y.refunded, refundablePaise: ['captured', 'partially_refunded'].includes(y.status) ? Math.max(0, y.amount_paise - y.refunded - y.refunding) : 0,
  }));
  const refundable = attempts.some((y) => y.refundablePaise > 0);
  // a coupon or a sale on this order (migration 0013; none before it)
  const d = await orderDiscount(env, o.id);
  return json({
    discount: d ? { source: d.source, label: d.label, code: d.code || null, listPaise: d.list_price_paise, discountPaise: d.discount_paise, couponId: d.coupon_id || null } : null,
    order: {
      id: o.id, status: o.status, amountPaise: o.amount_paise, currency: o.currency, packageId: o.package_id, packageName: o.package_name,
      razorpayOrderId: o.razorpay_order_id || null, failureReason: o.status === 'paid' ? null : (o.failure_reason || null),
      createdAt: o.created_at, paidAt: o.paid_at, updatedAt: o.updated_at,
      refundedPaise: R.refunds.reduce((sum, r) => sum + (r.status === 'processed' ? r.amount_paise : 0), 0),
    },
    customer: { id: o.user_id, fullName: o.full_name, email: o.email, status: o.account_status },
    attempts,
    refunds: R.refunds.map((r) => ({
      id: r.id, paymentId: r.payment_id, razorpayRefundId: r.razorpay_refund_id || null, amountPaise: r.amount_paise, status: r.status,
      reason: r.reason || null, requestedBy: r.requester || null, processedAt: r.processed_at, createdAt: r.created_at,
    })),
    invoice: inv ? { number: inv.number, amountPaise: inv.amount_paise, issuedAt: inv.issued_at } : null,
    plan: sub ? { id: sub.id, source: sub.source, startsAt: sub.starts_at, expiresAt: sub.expires_at,
      status: sub.status === 'active' && sub.expires_at && sub.expires_at <= now ? 'expired' : sub.status === 'active' && sub.starts_at > now ? 'upcoming' : sub.status } : null,
    activity: R.activity ? R.activity.map((a) => {
      const d = parseJson(a.detail, {});
      return { action: a.action, reason: typeof d.reason === 'string' ? d.reason : null, amountPaise: Number.isInteger(d.amountPaise) ? d.amountPaise : null,
        actor: a.actor || 'System', createdAt: a.created_at };
    }) : null,
    can: {
      recheck: has('payments.recheck') && !block, recheckBlock: has('payments.recheck') && RECHECKABLE.includes(o.status) ? block : null,
      refund: has('payments.refund') && keys && refundable && !ownAccount(who, o.user_id),
      refundBlock: has('payments.refund') && refundable && ownAccount(who, o.user_id) ? "This is your own payment. Ask a Super Admin to refund it."
        : has('payments.refund') && !keys && refundable ? 'The Razorpay keys are not set, so refunds cannot be sent.' : null,
      recheckRefund: has('payments.recheck') && keys,
    },
    emailsOn: emailEnabled(env),
  });
}

export async function postRecheck(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'payments.recheck');
  const o = await orderRow(env, params.id);
  if (!RECHECKABLE.includes(o.status)) throw new HttpError(400, 'not_needed', 'This order is already paid. There is nothing to check.');
  if (!o.razorpay_order_id) throw new HttpError(400, 'not_at_razorpay', 'This order never reached Razorpay, so there is nothing to check.');
  if (!rzp.configured(env)) throw new HttpError(503, 'payments_unavailable', 'The Razorpay keys are not set, so this order cannot be checked.');
  // each check is a call to Razorpay: once per order per half minute, and not hundreds from one person
  if (!(await hitLimit(env, `recheck:${o.id}`, 1, 30))) throw new HttpError(429, 'rate_limited', 'This order was checked a moment ago. Wait half a minute and try again.');
  if (!(await hitLimit(env, `recheck-by:${who.user.id}`, 60, 600))) throw new HttpError(429, 'rate_limited', 'You have checked a lot of orders in the last few minutes. Wait a little and try again.');

  const r = await reconcileOrder(env, ctx, o);
  const after = (await env.DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(o.id).first()).status;
  await audit(env, { actorId: who.user.id, action: 'payment.recheck', target: `order:${o.id}`,
    detail: { before: o.status, after, outcome: r.outcome, attempts: r.attempts }, ip: clientIp(request) });
  return json({ before: o.status, status: after, changed: after !== o.status, outcome: r.outcome, attempts: r.attempts });
}

export const ROUTES = {
  'GET /api/console/payments': getPayments,
  'GET /api/console/payments/export.csv': exportPayments,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/payments\/([\w-]{1,64})$/, ['id'], getPayment],
  ['POST', /^\/api\/console\/payments\/([\w-]{1,64})\/recheck$/, ['id'], postRecheck],
];
