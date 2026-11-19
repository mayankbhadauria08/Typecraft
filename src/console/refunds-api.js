// Refunds (docs/ADMIN-PHASE-2.md §7). Console-only endpoints: a console session is required.
//
//   GET  /api/console/refunds              refunds.view      list: q, status, from, to, page
//   POST /api/console/refunds              payments.refund   send money back through Razorpay (password check)
//                                                            { paymentId, amountPaise | null, reasonCode, reasonText, planAction }
//   POST /api/console/refunds/:id/recheck  payments.recheck  ask Razorpay about a refund that is still on its way
//
// Money moves only through refund() in src/billing.js.
import { HttpError, json, readJson, fieldError, clientIp } from '../http.js';
import { hitLimit, emailEnabled } from '../session.js';
import * as rzp from '../razorpay.js';
import { audit, refund, recheckRefund } from '../billing.js';
import { requireAdmin } from './session.js';
import { Binder, PAGE_SIZE, pageOf, offsetOf, paged, like, oneOf, idParam, isDay, istDayStart, istDayEnd, money, assertNotOwnAccount } from './lib.js';

/** Why the money goes back. The words are stored with the refund ("Customer request: bought the wrong plan"). */
export const REASONS = {
  duplicate: 'Duplicate payment',
  request: 'Customer request',
  technical: 'Technical problem',
  unauthorised: 'Payment not made by the card holder',
  other: 'Other',
};
/** What a refund does to the plan the order started: auto = the usual rule (a full refund ends it). */
export const PLAN_ACTIONS = ['auto', 'keep', 'end'];
const REFUNDABLE = ['captured', 'partially_refunded'];

/* ---------- the list ---------- */
const FROM = `FROM refunds r JOIN payments y ON y.id = r.payment_id JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
              JOIN packages p ON p.id = o.package_id LEFT JOIN users x ON x.id = r.requested_by`;

function whereOf(b, q) {
  const where = [];
  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`u.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${b.p(like(term))} ESCAPE '\\'`];
    if (/^[\w-]{6,64}$/.test(term)) {
      const t = b.p(term);   // an ID is matched whole
      parts.push(`r.razorpay_refund_id = ${t}`, `r.order_id = ${t}`, `r.user_id = ${t}`, `y.razorpay_payment_id = ${t}`, `o.razorpay_order_id = ${t}`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const status = oneOf(q.get('status'), ['pending', 'processed', 'failed']);
  if (status) where.push(`r.status = ${b.p(status)}`);
  const from = q.get('from'), to = q.get('to');
  if (isDay(from)) where.push(`r.created_at >= ${b.p(istDayStart(from))}`);
  if (isDay(to)) where.push(`r.created_at < ${b.p(istDayEnd(to))}`);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

export async function getRefunds(request, env) {
  await requireAdmin(env, request, 'refunds.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB;
  const list = new Binder(), count = new Binder();
  const listWhere = whereOf(list, q), countWhere = whereOf(count, q);
  const [rows, total] = await DB.batch([
    DB.prepare(`SELECT r.id, r.order_id, r.amount_paise, r.status, r.reason, r.razorpay_refund_id, r.processed_at, r.created_at,
                       o.currency, p.name AS package_name, u.id AS user_id, u.full_name, u.email, x.full_name AS requester
                  ${FROM} ${listWhere} ORDER BY r.created_at DESC, r.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n ${FROM} ${countWhere}`).bind(...count.args),
  ]);
  const items = rows.results.map((r) => ({
    id: r.id, orderId: r.order_id, amountPaise: r.amount_paise, currency: r.currency, status: r.status, reason: r.reason || null,
    razorpayRefundId: r.razorpay_refund_id || null, requestedBy: r.requester || null, packageName: r.package_name,
    processedAt: r.processed_at, createdAt: r.created_at, customer: { id: r.user_id, fullName: r.full_name, email: r.email },
  }));
  return json(paged(items, page, total.results[0].n));
}

/* ---------- sending a refund ---------- */
export async function postRefund(request, env, ctx) {
  const who = await requireAdmin(env, request, 'payments.refund');
  const body = await readJson(request);
  const DB = env.DB;
  if (typeof body.paymentId !== 'string' || !/^[\w-]{1,64}$/.test(body.paymentId)) throw fieldError({ paymentId: 'Choose the payment to refund.' });
  const pay = await DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(body.paymentId).first();
  if (!pay) throw new HttpError(404, 'not_found', 'Payment not found.');
  assertNotOwnAccount(who, pay.user_id);
  if (!REFUNDABLE.includes(pay.status)) throw new HttpError(400, 'not_refundable', 'Only a payment that went through can be refunded.');
  if (!rzp.configured(env)) throw new HttpError(503, 'payments_unavailable', 'The Razorpay keys are not set, so refunds cannot be sent.');

  // the amount: what is still refundable, unless a smaller amount is given
  const used = (await DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM refunds WHERE payment_id = ?1 AND status IN ('processed', 'pending')").bind(pay.id).first()).s;
  const left = pay.amount_paise - used;
  if (left <= 0) throw new HttpError(400, 'not_refundable', 'Everything paid with this payment has already been refunded, or is on its way back.');
  let amount = left;
  if (body.amountPaise != null) {
    if (!Number.isInteger(body.amountPaise) || body.amountPaise <= 0) throw fieldError({ amountPaise: 'Enter an amount above ₹0.' });
    if (body.amountPaise > left) throw fieldError({ amountPaise: `At most ${money(left)} can still be refunded for this payment.` });
    amount = body.amountPaise;
  }

  // why: a reason from the list, with details (details are required for "Other")
  const code = oneOf(body.reasonCode, Object.keys(REASONS), null);
  if (!code) throw fieldError({ reasonCode: 'Choose why the money is going back.' });
  const text = typeof body.reasonText === 'string' ? body.reasonText.trim().replace(/\s+/g, ' ') : '';
  if (code === 'other' && text.length < 3) throw fieldError({ reasonText: 'Say why the money is going back.' });
  if (text.length > 250) throw fieldError({ reasonText: 'Keep the details under 250 characters.' });
  const reason = code === 'other' ? text : REASONS[code] + (text ? ': ' + text : '');

  const planAction = oneOf(body.planAction == null ? 'auto' : body.planAction, PLAN_ACTIONS, null);
  if (!planAction) throw fieldError({ planAction: 'Choose what happens to the plan.' });
  // a choice other than the usual rule is kept in refund_choices: before migration 0006 this answers "not switched on yet",
  // before any money moves
  if (planAction !== 'auto') await DB.prepare('SELECT 1 FROM refund_choices LIMIT 1').first();

  // one refund request per payment per 10 seconds: a double click cannot send two
  if (!(await hitLimit(env, `refund:${pay.id}`, 1, 10))) {
    throw new HttpError(429, 'rate_limited', 'A refund for this payment was sent a moment ago. Look at the page again before sending another.');
  }
  const r = await refund(env, ctx, pay, { amountPaise: amount, reason, actorId: who.user.id, ip: clientIp(request), planAction });
  const order = await DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(pay.order_id).first();
  return json({ refundId: r.refundId, amountPaise: r.amountPaise, status: r.status, planEnded: r.planEnded, orderId: pay.order_id, orderStatus: order.status,
    emailsOn: emailEnabled(env) }, 201);
}

/* ---------- a refund that is still on its way ---------- */
export async function postRefundRecheck(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'payments.recheck');
  const row = await env.DB.prepare('SELECT * FROM refunds WHERE id = ?1').bind(idParam(params.id, 'Refund not found.')).first();
  if (!row) throw new HttpError(404, 'not_found', 'Refund not found.');
  if (row.status !== 'pending') {
    throw new HttpError(400, 'not_needed', row.status === 'processed' ? 'This refund has already been sent.' : 'This refund failed, so nothing is on its way.');
  }
  if (!row.razorpay_refund_id) throw new HttpError(400, 'not_at_razorpay', 'This refund never reached Razorpay, so there is nothing to check.');
  if (!rzp.configured(env)) throw new HttpError(503, 'payments_unavailable', 'The Razorpay keys are not set, so this refund cannot be checked.');
  if (!(await hitLimit(env, `recheck:${row.id}`, 1, 30))) throw new HttpError(429, 'rate_limited', 'This refund was checked a moment ago. Wait half a minute and try again.');
  if (!(await hitLimit(env, `recheck-by:${who.user.id}`, 60, 600))) throw new HttpError(429, 'rate_limited', 'You have checked a lot of payments in the last few minutes. Wait a little and try again.');

  const r = await recheckRefund(env, ctx, row);
  await audit(env, { actorId: who.user.id, action: 'refund.recheck', target: `payment:${row.payment_id}`,
    detail: { refundId: row.razorpay_refund_id, amountPaise: row.amount_paise, before: 'pending', after: r.status }, ip: clientIp(request) });
  return json({ status: r.status, changed: r.status !== 'pending' });
}

export const ROUTES = {
  'GET /api/console/refunds': getRefunds,
  'POST /api/console/refunds': postRefund,
};
export const PATTERNS = [
  ['POST', /^\/api\/console\/refunds\/([\w-]{1,64})\/recheck$/, ['id'], postRefundRecheck],
];
