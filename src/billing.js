// Billing — docs/SAAS-CONTRACTS.md §3 and §5: packages, checkout (Razorpay), webhook,
// fulfilment, refunds, invoices, the learner's plan/orders/invoices, typing tests,
// analytics and the payment crons.
//
// Money rules: amounts are paise; a package is only activated after the payment is
// confirmed by Razorpay itself (API fetch after a valid checkout signature, or a
// signed webhook); fulfilment happens once (conditional UPDATE + unique indexes).
import { packageView, catalogueView } from './package-view.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession, hitLimit, tooMany } from './session.js';
import { uuid, sha256Hex } from './crypto.js';
import * as rzp from './razorpay.js';
import { ensureInvoice, invoiceView } from './invoices.js';
import { entitlementsFor, has } from './entitlements.js';
import { sendTemplate } from './mail.js';
import { todayOf } from './api.js';

const DAY_MS = 86400000;
const MIN_MS = 60000;
const ORDER_ID_RE = /^ord_[a-f0-9]{24}$/;
const RZP_ID_RE = /^[A-Za-z0-9_]{6,64}$/;
const TEST_ID_RE = /^[\w:.-]{8,100}$/;
const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };
const money = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const siteUrl = (env) => String(env.SITE_URL || 'https://typecrafttyping.in').replace(/\/+$/, '');

/* ---------------- shared helpers (also used by src/admin-api.js) ---------------- */
export async function getSetting(env, key, def = {}) {
  const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?1').bind(key).first();
  return row ? parse(row.value, def) : def;
}

export async function audit(env, { actorId = null, action, target = null, detail = null, ip = null }) {
  await env.DB.prepare('INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(uuid(), actorId, action, target, detail == null ? null : JSON.stringify(detail), ip, nowIso()).run();
}

/** A 402 answer in the contract's shape (§3). */
export function planResponse(code, message, feature) {
  return json({ error: { code, message, feature, upgradeUrl: '/pricing' } }, 402);
}

async function email(env, ctx, msg) {
  try { await sendTemplate(env, ctx, { category: 'billing', ...msg }); } catch (err) { console.error('billing email failed:', msg.template, err && err.name); }
}

export async function paymentsAvailable(env) {
  if (!rzp.configured(env)) return false;
  const s = await getSetting(env, 'payments', { enabled: true });
  return s.enabled !== false;
}
async function assertPayments(env) {
  if (!(await paymentsAvailable(env))) throw new HttpError(503, 'payments_unavailable', 'Payments are not available right now. Please try again later.');
}

/* ---------------- GET /api/packages (public) ---------------- */
export { packageView };

export async function getPackages(request, env) {
  const [pk, ft] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM packages WHERE active = 1 ORDER BY display_order, price_paise'),
    env.DB.prepare('SELECT key, label, description FROM package_features ORDER BY display_order'),
  ]);
  const labels = Object.fromEntries(ft.results.map((f) => [f.key, f.label]));
  return json({ packages: pk.results.map((p) => packageView(p, labels)), features: catalogueView(ft.results) }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/* ---------------- GET /api/me/entitlements ---------------- */
export async function getEntitlements(request, env) {
  const { user } = await requireSession(env, request);
  return json(await entitlementsFor(env, user.id));
}

/* ---------------- POST /api/checkout/order ---------------- */
export async function postOrder(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const packageId = typeof body.packageId === 'string' ? body.packageId.trim() : '';
  if (!packageId) throw fieldError({ packageId: 'Choose a plan.' });
  const DB = env.DB;
  const pkg = await DB.prepare('SELECT * FROM packages WHERE id = ?1 AND active = 1').bind(packageId).first();
  if (!pkg) throw fieldError({ packageId: 'That plan is not available.' });
  if (!(pkg.price_paise > 0)) throw new HttpError(400, 'free_package', 'The Free plan needs no payment.');
  await assertPayments(env);
  if (!(await hitLimit(env, `checkout:${user.id}`, 20, 3600))) throw tooMany(60);

  const out = (o) => json({
    orderId: o.id, razorpayOrderId: o.razorpay_order_id, amountPaise: o.amount_paise, currency: o.currency,
    keyId: env.RAZORPAY_KEY_ID, packageId: pkg.id, packageName: pkg.name,
    prefill: { name: user.fullName, email: user.email, contact: user.phoneNumber || '' },
  });
  const cutoff = new Date(Date.now() - 30 * MIN_MS).toISOString();
  const reuse = await DB.prepare(
    `SELECT * FROM orders WHERE user_id = ?1 AND package_id = ?2 AND status = 'created' AND razorpay_order_id IS NOT NULL
        AND amount_paise = ?3 AND currency = ?4 AND created_at > ?5 ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id, pkg.id, pkg.price_paise, pkg.currency, cutoff).first();
  if (reuse) return out(reuse);

  const id = 'ord_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = nowIso();
  await DB.prepare(`INSERT INTO orders (id, user_id, package_id, amount_paise, currency, status, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, 'created', ?6, ?6)`).bind(id, user.id, pkg.id, pkg.price_paise, pkg.currency, now).run();
  let r;
  try {
    r = await rzp.createOrder(env, { amount: pkg.price_paise, currency: pkg.currency, receipt: id, notes: { orderId: id, userId: user.id, packageId: pkg.id } });
  } catch (err) {
    await DB.prepare("UPDATE orders SET status = 'failed', failure_reason = 'Could not start the payment.', updated_at = ?2 WHERE id = ?1").bind(id, nowIso()).run();
    throw err;
  }
  if (!r || typeof r.id !== 'string' || r.amount !== pkg.price_paise) {
    await DB.prepare("UPDATE orders SET status = 'failed', failure_reason = 'Could not start the payment.', updated_at = ?2 WHERE id = ?1").bind(id, nowIso()).run();
    throw new HttpError(502, 'payment_provider_error', 'The payment provider gave an unexpected answer. Please try again.');
  }
  await DB.prepare('UPDATE orders SET razorpay_order_id = ?2, updated_at = ?3 WHERE id = ?1').bind(id, r.id, nowIso()).run();
  return out({ id, razorpay_order_id: r.id, amount_paise: pkg.price_paise, currency: pkg.currency });
}

/* ---------------- payments, fulfilment, failures ---------------- */
const PAY_STATUSES = ['created', 'authorized', 'captured', 'failed'];

/** Saves (or updates) what Razorpay told us about one payment. Never moves a captured or refunded payment backwards. */
export async function recordPayment(env, order, p, verifiedBy) {
  const now = nowIso();
  const status = PAY_STATUSES.includes(p.status) ? p.status : p.status === 'refunded' ? 'captured' : 'created';
  await env.DB.prepare(
    `INSERT INTO payments (id, order_id, user_id, razorpay_payment_id, amount_paise, currency, status, method, error_code, error_description,
                           verified_by, captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
     ON CONFLICT (razorpay_payment_id) DO UPDATE SET
       status = CASE WHEN payments.status IN ('refunded', 'partially_refunded') THEN payments.status
                     WHEN payments.status = 'captured' AND excluded.status <> 'captured' THEN payments.status
                     ELSE excluded.status END,
       method = COALESCE(excluded.method, payments.method),
       error_code = excluded.error_code, error_description = excluded.error_description,
       captured_at = COALESCE(payments.captured_at, excluded.captured_at),
       updated_at = excluded.updated_at`
  ).bind('pay_row_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20), order.id, order.user_id, p.id, p.amount, p.currency || 'INR', status,
    typeof p.method === 'string' ? p.method.slice(0, 30) : null,
    p.error_code ? String(p.error_code).slice(0, 60) : null, p.error_description ? String(p.error_description).slice(0, 300) : null,
    verifiedBy, status === 'captured' ? now : null, now).run();
}

/** Marks an order failed if nothing was captured for it. Returns true if this call changed it. */
export async function markFailed(env, ctx, order, reason, { notify = true } = {}) {
  const r = await env.DB.prepare(
    `UPDATE orders SET status = 'failed', failure_reason = ?2, updated_at = ?3
      WHERE id = ?1 AND status IN ('created', 'attempted', 'pending')
        AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ?1 AND status IN ('captured', 'refunded', 'partially_refunded'))`
  ).bind(order.id, String(reason || 'The payment did not go through.').slice(0, 300), nowIso()).run();
  const changed = r.meta.changes === 1;
  if (changed && notify) {
    const u = await env.DB.prepare('SELECT u.email, u.full_name, p.name FROM users u JOIN packages p ON p.id = ?2 WHERE u.id = ?1').bind(order.user_id, order.package_id).first();
    if (u) await email(env, ctx, { to: u.email, userId: order.user_id, template: 'payment_failed',
      data: { name: u.full_name, packageName: u.name, amountPaise: order.amount_paise, amount: money(order.amount_paise), orderId: order.id,
        reason: String(reason || '').slice(0, 300), retryUrl: `${siteUrl(env)}/checkout?plan=${order.package_id}` } });
  }
  return changed;
}

/**
 * Activates a paid order once: the order row moves to 'paid' and the subscription
 * is created in the same transaction; only the call that moved it issues the
 * invoice, sends the email and writes the audit log. Renewals stack.
 */
export async function fulfil(env, ctx, orderId, { via = 'system' } = {}) {
  const DB = env.DB;
  const o = await DB.prepare(
    `SELECT o.*, p.name AS package_name, p.validity_days, p.features, p.limits FROM orders o JOIN packages p ON p.id = o.package_id WHERE o.id = ?1`
  ).bind(orderId).first();
  if (!o) return { claimed: false };
  const now = nowIso();
  let starts = now, expires = null;
  if (o.validity_days != null) {
    const latest = await DB.prepare(
      "SELECT MAX(expires_at) AS m FROM user_subscriptions WHERE user_id = ?1 AND status = 'active' AND expires_at IS NOT NULL AND expires_at > ?2"
    ).bind(o.user_id, now).first();
    if (latest && latest.m && latest.m > now) starts = latest.m;
    expires = new Date(Date.parse(starts) + o.validity_days * DAY_MS).toISOString();
  }
  const res = await DB.batch([
    DB.prepare(`UPDATE orders SET status = 'paid', paid_at = ?2, failure_reason = NULL, updated_at = ?2
                 WHERE id = ?1 AND status IN ('created', 'attempted', 'pending', 'failed', 'cancelled')`).bind(o.id, now),
    DB.prepare(`INSERT OR IGNORE INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
                SELECT ?1, ?2, ?3, ?4, 'active', 'purchase', ?5, ?6, ?7, ?8, ?9, ?9 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?4 AND status = 'paid')`)
      .bind(uuid(), o.user_id, o.package_id, o.id, o.features, o.limits, starts, expires, now),
  ]);
  const claimed = res[0].meta.changes === 1;
  if (!claimed) {
    const inv = await DB.prepare('SELECT number FROM invoices WHERE order_id = ?1').bind(o.id).first();
    return { claimed: false, invoiceNumber: inv ? inv.number : null };
  }
  const inv = await ensureInvoice(env, o.id);
  await audit(env, { action: 'order.paid', target: `order:${o.id}`, detail: { packageId: o.package_id, amountPaise: o.amount_paise, via, startsAt: starts, expiresAt: expires } });
  const u = await DB.prepare('SELECT email, full_name FROM users WHERE id = ?1').bind(o.user_id).first();
  if (u && inv) {
    await email(env, ctx, { to: u.email, userId: o.user_id, template: 'payment_success',
      data: { name: u.full_name, packageName: o.package_name, amountPaise: o.amount_paise, amount: money(o.amount_paise), orderId: o.id,
        startsAt: starts, expiresAt: expires, invoiceNumber: inv.number, invoiceUrl: `${siteUrl(env)}/account/invoices/${inv.number}`,
        dashboardUrl: `${siteUrl(env)}/dashboard` } });
    await DB.prepare('UPDATE invoices SET emailed_at = ?2 WHERE id = ?1').bind(inv.id, nowIso()).run();
  }
  return { claimed: true, invoiceNumber: inv ? inv.number : null };
}

/**
 * Acts on a payment entity that came from Razorpay (API fetch or signed webhook):
 * checks it belongs to the order with the same amount, captures it if only
 * authorized, and fulfils on capture. Returns { status: 'paid'|'pending'|'failed'|'mismatch', invoiceNumber? }.
 */
export async function handlePayment(env, ctx, order, p, verifiedBy) {
  if (!p || p.order_id !== order.razorpay_order_id || p.amount !== order.amount_paise || (p.currency || 'INR') !== order.currency) {
    await env.DB.prepare("UPDATE orders SET failure_reason = 'The payment did not match this order.', updated_at = ?2 WHERE id = ?1 AND status <> 'paid'")
      .bind(order.id, nowIso()).run();
    console.error('payment does not match its order:', order.id);
    return { status: 'mismatch' };
  }
  await recordPayment(env, order, p, verifiedBy);
  let status = p.status;
  if (status === 'authorized') {
    try {
      const c = await rzp.capturePayment(env, p.id, order.amount_paise, order.currency);
      status = c && c.status;
      if (c && c.id === p.id) await recordPayment(env, order, c, verifiedBy);
    } catch {
      // maybe captured meanwhile (auto-capture or a parallel call): ask again
      try { const again = await rzp.fetchPayment(env, p.id); status = again.status; if (again.order_id === order.razorpay_order_id) await recordPayment(env, order, again, 'api'); } catch { status = 'authorized'; }
    }
  }
  if (status === 'captured' || status === 'refunded') {
    const f = await fulfil(env, ctx, order.id, { via: verifiedBy });
    const now = await env.DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(order.id).first();
    const inv = f.invoiceNumber || (await env.DB.prepare('SELECT number FROM invoices WHERE order_id = ?1').bind(order.id).first() || {}).number || null;
    return { status: now.status === 'paid' || now.status === 'partially_refunded' || now.status === 'refunded' ? 'paid' : 'pending', invoiceNumber: inv };
  }
  if (status === 'failed') {
    await markFailed(env, ctx, order, p.error_description || 'The payment did not go through.');
    return { status: 'failed' };
  }
  await env.DB.prepare("UPDATE orders SET status = 'pending', updated_at = ?2 WHERE id = ?1 AND status IN ('created', 'attempted')").bind(order.id, nowIso()).run();
  return { status: 'pending' };
}

async function ownOrder(env, userId, orderId) {
  if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId)) throw new HttpError(404, 'not_found', 'Order not found.');
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1 AND user_id = ?2').bind(orderId, userId).first();
  if (!o) throw new HttpError(404, 'not_found', 'Order not found.');
  return o;
}

/* ---------------- POST /api/checkout/verify ---------------- */
export async function postVerify(request, env, ctx) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const order = await ownOrder(env, user.id, body.orderId);
  if (!(await hitLimit(env, `verify:${user.id}`, 30, 600))) throw tooMany(10);
  const invoiceOf = async () => (await env.DB.prepare('SELECT number FROM invoices WHERE order_id = ?1').bind(order.id).first() || {}).number || null;
  if (['paid', 'refunded', 'partially_refunded'].includes(order.status)) {
    return json({ status: 'paid', orderId: order.id, invoiceNumber: await invoiceOf() });
  }
  const rOrder = body.razorpay_order_id, rPay = body.razorpay_payment_id, sig = body.razorpay_signature;
  if (typeof rPay !== 'string' || !RZP_ID_RE.test(rPay) || typeof sig !== 'string' || sig.length > 200 || rOrder !== order.razorpay_order_id
      || !(await rzp.verifyPaymentSignature(env, order.razorpay_order_id, rPay, sig))) {
    await audit(env, { actorId: user.id, action: 'checkout.bad_signature', target: `order:${order.id}`, ip: clientIp(request) });
    throw new HttpError(400, 'bad_signature', "We couldn't confirm this payment. If money was taken, it will be confirmed automatically within a few minutes.");
  }
  // the browser's word is not enough: ask Razorpay what really happened
  const p = await rzp.fetchPayment(env, rPay);
  const r = await handlePayment(env, ctx, order, p, 'signature');
  if (r.status === 'mismatch') throw new HttpError(400, 'payment_mismatch', 'This payment does not match your order. Please contact support.');
  return json({ status: r.status, orderId: order.id, ...(r.invoiceNumber ? { invoiceNumber: r.invoiceNumber } : {}) });
}

/* ---------------- POST /api/checkout/failed ---------------- */
export async function postFailed(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const order = await ownOrder(env, user.id, body.orderId);
  const text = [body.code, body.description].filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().replace(/[\u0000-\u001f]/g, ' ')).join(': ').slice(0, 300)
    || 'The payment did not go through.';
  // display only: this never activates anything, and never fails an order Razorpay captured
  await env.DB.prepare(
    `UPDATE orders SET failure_reason = ?2, updated_at = ?3,
            status = CASE WHEN status IN ('created', 'attempted', 'pending')
                           AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ?1 AND status IN ('authorized', 'captured', 'refunded', 'partially_refunded'))
                          THEN 'failed' ELSE status END
      WHERE id = ?1 AND status NOT IN ('paid', 'refunded', 'partially_refunded')`
  ).bind(order.id, text, nowIso()).run();
  const o = await env.DB.prepare('SELECT status, failure_reason FROM orders WHERE id = ?1').bind(order.id).first();
  return json({ orderId: order.id, status: o.status, failureReason: o.failure_reason });
}

/* ---------------- GET /api/checkout/orders/:id ---------------- */
export async function getOrder(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  const o = await ownOrder(env, user.id, params.id);
  const extra = await env.DB.prepare('SELECT p.name, i.number FROM packages p LEFT JOIN invoices i ON i.order_id = ?2 WHERE p.id = ?1').bind(o.package_id, o.id).first();
  return json({ orderId: o.id, status: o.status, packageId: o.package_id, packageName: extra.name, amountPaise: o.amount_paise, currency: o.currency,
    createdAt: o.created_at, paidAt: o.paid_at, ...(extra.number ? { invoiceNumber: extra.number } : {}), ...(o.failure_reason && o.status !== 'paid' ? { failureReason: o.failure_reason } : {}) });
}

/* ---------------- refunds ---------------- */
/**
 * What the administrator chose for the plan on the latest processed refund of a payment:
 * 'keep', 'end', or null for the usual rule (a full refund ends the plan). The choice sits in
 * refund_choices (migration 0006); until that table exists the usual rule applies.
 */
async function refundPlanChoice(env, paymentRowId) {
  try {
    const row = await env.DB.prepare(
      `SELECT c.plan_action FROM refunds r LEFT JOIN refund_choices c ON c.razorpay_refund_id = r.razorpay_refund_id
        WHERE r.payment_id = ?1 AND r.status = 'processed' ORDER BY r.processed_at DESC, r.created_at DESC LIMIT 1`
    ).bind(paymentRowId).first();
    return (row && row.plan_action) || null;
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return null;
    throw err;
  }
}

/**
 * Recomputes a payment's refund state from its processed refunds. A full refund revokes the
 * order's subscription, unless the administrator chose otherwise for the latest refund
 * ('keep': never; 'end': also on a part refund). A plan that was ended is never switched back on here.
 */
async function applyRefunds(env, ctx, paymentRowId, { actorId = null } = {}) {
  const DB = env.DB;
  const pay = await DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(paymentRowId).first();
  if (!pay) return null;
  const sum = (await DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM refunds WHERE payment_id = ?1 AND status = 'processed'").bind(pay.id).first()).s;
  if (!sum) return { refundedPaise: 0, full: false, planEnded: false };
  const full = sum >= pay.amount_paise;
  const choice = await refundPlanChoice(env, pay.id);
  const endPlan = choice === 'end' || (full && choice !== 'keep');
  const now = nowIso();
  const st = full ? 'refunded' : 'partially_refunded';
  const stmts = [
    DB.prepare("UPDATE payments SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('captured', 'partially_refunded', 'refunded')").bind(pay.id, st, now),
    DB.prepare("UPDATE orders SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('paid', 'partially_refunded', 'refunded')").bind(pay.order_id, st, now),
  ];
  if (endPlan) stmts.push(DB.prepare("UPDATE user_subscriptions SET status = 'revoked', updated_at = ?2 WHERE order_id = ?1 AND status = 'active'").bind(pay.order_id, now));
  const res = await DB.batch(stmts);
  const planEnded = endPlan && res[2].meta.changes > 0;
  if (planEnded) await audit(env, { actorId, action: 'subscription.revoke', target: `order:${pay.order_id}`, detail: { reason: full ? 'full_refund' : 'refund' } });
  return { refundedPaise: sum, full, planEnded };
}

/** Saves a refund Razorpay reported (from our refund call or a webhook) and applies it once processed. */
async function settleRefund(env, ctx, pay, r, { reason = null, requestedBy = null } = {}) {
  const DB = env.DB;
  const status = r.status === 'processed' ? 'processed' : r.status === 'failed' ? 'failed' : 'pending';
  const before = await DB.prepare('SELECT status FROM refunds WHERE razorpay_refund_id = ?1').bind(r.id).first();
  const now = nowIso();
  await DB.prepare(
    `INSERT INTO refunds (id, payment_id, order_id, user_id, razorpay_refund_id, amount_paise, status, reason, requested_by, processed_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
     ON CONFLICT (razorpay_refund_id) DO UPDATE SET
       status = CASE WHEN refunds.status = 'processed' THEN 'processed' ELSE excluded.status END,
       reason = COALESCE(refunds.reason, excluded.reason), requested_by = COALESCE(refunds.requested_by, excluded.requested_by),
       processed_at = COALESCE(refunds.processed_at, excluded.processed_at), updated_at = excluded.updated_at`
  ).bind(uuid(), pay.id, pay.order_id, pay.user_id, r.id, r.amount, status, reason, requestedBy, status === 'processed' ? now : null, now).run();
  if (status !== 'processed' || (before && before.status === 'processed')) return { status, applied: false };
  const out = await applyRefunds(env, ctx, pay.id, { actorId: requestedBy });
  await audit(env, { actorId: requestedBy, action: 'refund.processed', target: `payment:${pay.id}`, detail: { amountPaise: r.amount, full: out && out.full } });
  const u = await DB.prepare('SELECT u.email, u.full_name, p.name FROM users u JOIN orders o ON o.user_id = u.id JOIN packages p ON p.id = o.package_id WHERE o.id = ?1').bind(pay.order_id).first();
  if (u) await email(env, ctx, { to: u.email, userId: pay.user_id, template: 'refund_processed',
    data: { name: u.full_name, packageName: u.name, amountPaise: r.amount, amount: money(r.amount), orderId: pay.order_id, full: !!(out && out.full) } });
  return { status, applied: true, full: !!(out && out.full), planEnded: !!(out && out.planEnded) };
}

/**
 * Admin refund through Razorpay. amountPaise defaults to everything still refundable.
 * planAction: 'auto' (a full refund ends the plan), 'keep' or 'end'.
 */
export async function refund(env, ctx, pay, { amountPaise, reason, actorId, ip, planAction = 'auto' }) {
  if (!['captured', 'partially_refunded'].includes(pay.status)) throw new HttpError(400, 'not_refundable', 'Only captured payments can be refunded.');
  if (!rzp.configured(env)) throw new HttpError(503, 'payments_unavailable', 'Payments are not configured, so refunds cannot be made.');
  const used = (await env.DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM refunds WHERE payment_id = ?1 AND status IN ('processed', 'pending')").bind(pay.id).first()).s;
  const left = pay.amount_paise - used;
  const amount = amountPaise == null ? left : amountPaise;
  if (!Number.isInteger(amount) || amount <= 0) throw fieldError({ amountPaise: 'Enter the refund amount in paise (a whole number above 0).' });
  if (amount > left) throw fieldError({ amountPaise: `At most ${money(left)} can still be refunded for this payment.` });
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (!cleanReason) throw fieldError({ reason: 'Give a reason for the refund.' });
  const r = await rzp.refundPayment(env, pay.razorpay_payment_id, { amount, notes: { orderId: pay.order_id, reason: cleanReason.slice(0, 200) } });
  if (!r || typeof r.id !== 'string') throw new HttpError(502, 'payment_provider_error', 'The payment provider gave an unexpected answer.');
  const chosen = planAction === 'keep' || planAction === 'end';
  let choiceKept = true;
  if (chosen) {
    // kept beside the refund, so the choice also holds when Razorpay confirms the refund later.
    // The money has already moved: if this cannot be written, the refund is still recorded, under the usual rule.
    try {
      await env.DB.prepare('INSERT INTO refund_choices (razorpay_refund_id, plan_action, created_by, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (razorpay_refund_id) DO NOTHING')
        .bind(r.id, planAction, actorId, nowIso()).run();
    } catch (err) {
      choiceKept = false;
      console.error('refund plan choice was not saved:', err && err.name);
    }
  }
  await audit(env, { actorId, action: 'payment.refund', target: `payment:${pay.id}`,
    detail: { amountPaise: amount, reason: cleanReason, refundId: r.id, status: r.status, ...(chosen ? { planAction, ...(choiceKept ? {} : { planActionSaved: false }) } : {}) }, ip });
  const s = await settleRefund(env, ctx, pay, { id: r.id, amount: r.amount || amount, status: r.status }, { reason: cleanReason, requestedBy: actorId });
  let planEnded = !!s.planEnded;
  // Razorpay's notice of this refund can, in a rare race, be handled before the choice above was saved:
  // then the refund is already recorded, and the choice is applied now
  if (chosen && choiceKept && s.status === 'processed' && !s.applied) planEnded = !!((await applyRefunds(env, ctx, pay.id, { actorId })) || {}).planEnded;
  return { refundId: r.id, amountPaise: amount, status: s.status, planEnded };
}

/**
 * Asks Razorpay about a refund that is still on its way and records the answer.
 * → { status: 'processed' | 'failed' | 'pending' }. Throws when Razorpay cannot be asked.
 */
export async function recheckRefund(env, ctx, row) {
  const pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(row.payment_id).first();
  const r = await rzp.fetchRefund(env, row.razorpay_refund_id);
  if (!pay || !r || r.id !== row.razorpay_refund_id || r.payment_id !== pay.razorpay_payment_id) {
    throw new HttpError(502, 'payment_provider_error', 'Razorpay answered about a different refund. Nothing was changed.');
  }
  if (r.status === 'processed') {
    await settleRefund(env, ctx, pay, { id: r.id, amount: row.amount_paise, status: 'processed' }, { reason: row.reason, requestedBy: row.requested_by });
    return { status: 'processed' };
  }
  if (r.status === 'failed') {
    const done = await env.DB.prepare("UPDATE refunds SET status = 'failed', updated_at = ?2 WHERE razorpay_refund_id = ?1 AND status = 'pending'").bind(r.id, nowIso()).run();
    if (done.meta.changes) await audit(env, { action: 'refund.failed', target: `payment:${pay.id}`, detail: { refundId: r.id } });
    return { status: 'failed' };
  }
  return { status: 'pending' };
}

/* ---------------- POST /api/webhooks/razorpay ---------------- */
function trimmed(evt) {
  const p = (evt && evt.payload) || {};
  const pay = p.payment && p.payment.entity, ord = p.order && p.order.entity, ref = p.refund && p.refund.entity;
  return JSON.stringify({ event: evt && evt.event, paymentId: pay && pay.id, orderId: (pay && pay.order_id) || (ord && ord.id), amount: (pay && pay.amount) || (ref && ref.amount),
    status: (pay && pay.status) || (ref && ref.status), refundId: ref && ref.id });
}

async function orderForRazorpay(env, rzpOrderId) {
  if (typeof rzpOrderId !== 'string' || !rzpOrderId) return null;
  return env.DB.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?1').bind(rzpOrderId).first();
}

async function processWebhook(env, ctx, type, payload) {
  const pay = payload.payment && payload.payment.entity;
  const ord = payload.order && payload.order.entity;
  const ref = payload.refund && payload.refund.entity;
  switch (type) {
    case 'payment.authorized':
    case 'payment.captured':
    case 'order.paid': {
      if (!pay) return { status: 'ignored', note: 'no payment' };
      const order = await orderForRazorpay(env, pay.order_id || (ord && ord.id));
      if (!order) return { status: 'ignored', note: 'unknown order' };
      const r = await handlePayment(env, ctx, order, pay, 'webhook');
      return r.status === 'mismatch' ? { status: 'ignored', note: 'payment does not match order' } : { status: 'processed' };
    }
    case 'payment.failed': {
      if (!pay) return { status: 'ignored', note: 'no payment' };
      const order = await orderForRazorpay(env, pay.order_id);
      if (!order) return { status: 'ignored', note: 'unknown order' };
      if (pay.amount !== order.amount_paise) return { status: 'ignored', note: 'payment does not match order' };
      await recordPayment(env, order, { ...pay, status: 'failed' }, 'webhook');
      await markFailed(env, ctx, order, pay.error_description || 'The payment did not go through.');
      return { status: 'processed' };
    }
    case 'refund.processed':
    case 'refund.failed': {
      if (!ref || typeof ref.id !== 'string') return { status: 'ignored', note: 'no refund' };
      const row = await env.DB.prepare('SELECT * FROM payments WHERE razorpay_payment_id = ?1').bind(ref.payment_id).first();
      if (!row) return { status: 'ignored', note: 'unknown payment' };
      if (type === 'refund.failed') {
        await env.DB.prepare("UPDATE refunds SET status = 'failed', updated_at = ?2 WHERE razorpay_refund_id = ?1 AND status <> 'processed'").bind(ref.id, nowIso()).run();
        await audit(env, { action: 'refund.failed', target: `payment:${row.id}`, detail: { refundId: ref.id } });
        return { status: 'processed' };
      }
      await settleRefund(env, ctx, row, { id: ref.id, amount: ref.amount, status: 'processed' }, { reason: (ref.notes && typeof ref.notes.reason === 'string' ? ref.notes.reason.slice(0, 300) : null) });
      return { status: 'processed' };
    }
    default:
      return { status: 'ignored', note: 'event not used' };
  }
}

export async function postWebhook(request, env, ctx) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new HttpError(503, 'payments_unavailable', 'Payments are not configured.');
  const raw = await request.text(); // the signature is over the exact bytes received
  if (raw.length > 1024 * 1024) throw new HttpError(413, 'too_large', 'That request is too large.');
  if (!(await rzp.verifyWebhookSignature(env, raw, request.headers.get('X-Razorpay-Signature')))) {
    throw new HttpError(400, 'bad_signature', 'Invalid signature.');
  }
  let evt;
  try { evt = JSON.parse(raw); } catch { throw new HttpError(400, 'bad_json', 'The request could not be read.'); }
  if (!evt || typeof evt !== 'object' || typeof evt.event !== 'string') throw new HttpError(400, 'bad_json', 'The request could not be read.');
  const header = request.headers.get('X-Razorpay-Event-Id');
  const eventId = header && /^[\w.:-]{1,100}$/.test(header) ? header : 'sha256:' + (await sha256Hex(raw));
  const DB = env.DB;
  const ins = await DB.prepare(`INSERT INTO webhook_events (id, provider, event, status, payload, received_at) VALUES (?1, 'razorpay', ?2, 'received', ?3, ?4)
                                ON CONFLICT (id) DO NOTHING`).bind(eventId, evt.event.slice(0, 60), trimmed(evt), nowIso()).run();
  if (ins.meta.changes !== 1) {
    const prev = await DB.prepare('SELECT status FROM webhook_events WHERE id = ?1').bind(eventId).first();
    if (prev && (prev.status === 'processed' || prev.status === 'ignored')) return json({ received: true, duplicate: true });
  }
  try {
    const out = await processWebhook(env, ctx, evt.event, evt.payload && typeof evt.payload === 'object' ? evt.payload : {});
    await DB.prepare('UPDATE webhook_events SET status = ?2, error = ?3, processed_at = ?4 WHERE id = ?1').bind(eventId, out.status, out.note || null, nowIso()).run();
  } catch (err) {
    console.error('razorpay webhook failed:', evt.event, err && err.name);
    await DB.prepare("UPDATE webhook_events SET status = 'failed', error = ?2, processed_at = ?3 WHERE id = ?1")
      .bind(eventId, String((err && err.message) || 'error').slice(0, 300), nowIso()).run();
    return json({ error: { code: 'webhook_failed', message: 'Could not process the event now.' } }, 500);
  }
  return json({ received: true });
}

/* ---------------- the learner's plan, orders and invoices ---------------- */
export async function getMySubscriptions(request, env) {
  const { user } = await requireSession(env, request);
  const rows = (await env.DB.prepare(
    `SELECT s.*, p.name FROM user_subscriptions s JOIN packages p ON p.id = s.package_id WHERE s.user_id = ?1 ORDER BY s.starts_at DESC LIMIT 200`
  ).bind(user.id).all()).results;
  const now = nowIso();
  return json({
    subscriptions: rows.map((s) => ({ id: s.id, packageId: s.package_id, packageName: s.name, orderId: s.order_id, source: s.source,
      status: s.status === 'active' && s.expires_at && s.expires_at <= now ? 'expired' : s.status,
      upcoming: s.status === 'active' && s.starts_at > now, startsAt: s.starts_at, expiresAt: s.expires_at })),
    entitlements: await entitlementsFor(env, user.id, now),
  });
}

export async function getMyOrders(request, env) {
  const { user } = await requireSession(env, request);
  const rows = (await env.DB.prepare(
    `SELECT o.*, p.name AS package_name, i.number AS invoice_number,
            (SELECT method FROM payments WHERE order_id = o.id ORDER BY (status = 'captured') DESC, created_at DESC LIMIT 1) AS method,
            (SELECT razorpay_payment_id FROM payments WHERE order_id = o.id AND status IN ('captured', 'refunded', 'partially_refunded') LIMIT 1) AS rzp_payment,
            (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds WHERE order_id = o.id AND status = 'processed') AS refunded
       FROM orders o JOIN packages p ON p.id = o.package_id LEFT JOIN invoices i ON i.order_id = o.id
      WHERE o.user_id = ?1 ORDER BY o.created_at DESC LIMIT 200`
  ).bind(user.id).all()).results;
  return json({ orders: rows.map((o) => ({ orderId: o.id, packageId: o.package_id, packageName: o.package_name, amountPaise: o.amount_paise, currency: o.currency,
    status: o.status, method: o.method || null, createdAt: o.created_at, paidAt: o.paid_at, invoiceNumber: o.invoice_number || null,
    refundedPaise: o.refunded, failureReason: o.status === 'failed' ? o.failure_reason : null,
    razorpayPaymentId: o.rzp_payment || null })) });  // shown on /account/payments so a learner can quote it to support
}

export async function getMyInvoices(request, env) {
  const { user } = await requireSession(env, request);
  const rows = (await env.DB.prepare('SELECT i.number, i.order_id, i.amount_paise, i.currency, i.issued_at, i.lines FROM invoices i WHERE i.user_id = ?1 ORDER BY i.seq DESC LIMIT 200')
    .bind(user.id).all()).results;
  return json({ invoices: rows.map((i) => ({ number: i.number, orderId: i.order_id, amountPaise: i.amount_paise, currency: i.currency, issuedAt: i.issued_at,
    description: (parse(i.lines, [])[0] || {}).description || '' })) });
}

export async function getMyInvoice(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  const row = await env.DB.prepare('SELECT * FROM invoices WHERE number = ?1 AND user_id = ?2').bind(params.number, user.id).first();
  if (!row) throw new HttpError(404, 'not_found', 'Invoice not found.');
  const extra = await env.DB.prepare(
    `SELECT o.status, o.paid_at, (SELECT method FROM payments WHERE order_id = o.id AND status IN ('captured', 'refunded', 'partially_refunded') LIMIT 1) AS method,
            (SELECT razorpay_payment_id FROM payments WHERE order_id = o.id AND status IN ('captured', 'refunded', 'partially_refunded') LIMIT 1) AS rzp_payment,
            (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds WHERE order_id = o.id AND status = 'processed') AS refunded
       FROM orders o WHERE o.id = ?1`
  ).bind(row.order_id).first();
  return json({ invoice: invoiceView(row, { status: extra.status, paidAt: extra.paid_at, paymentMethod: extra.method || null, paymentReference: extra.rzp_payment || null,
    refundedPaise: extra.refunded }) });
}

/* ---------------- typing tests ---------------- */
function num(v, min, max, { int = false, required = true } = {}) {
  if (v == null || v === '') return required ? NaN : null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return NaN;
  return int ? Math.round(n) : Math.round(n * 10) / 10;
}

export async function postTest(request, env, ctx) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const fields = {};
  if (typeof body.id !== 'string' || !TEST_ID_RE.test(body.id)) fields.id = 'Missing or invalid test id.';
  const duration = num(body.duration, 5, 900, { int: true });
  const wpm = num(body.wpm, 0, 400), rawWpm = num(body.rawWpm, 0, 400, { required: false }), accuracy = num(body.accuracy, 0, 100);
  const errors = num(body.errors ?? 0, 0, 100000, { int: true }), chars = num(body.chars ?? 0, 0, 100000, { int: true });
  if (Number.isNaN(duration)) fields.duration = 'duration must be seconds from 5 to 900.';
  if (Number.isNaN(wpm)) fields.wpm = 'wpm must be a number from 0 to 400.';
  if (Number.isNaN(rawWpm)) fields.rawWpm = 'rawWpm must be a number from 0 to 400.';
  if (Number.isNaN(accuracy)) fields.accuracy = 'accuracy must be a number from 0 to 100.';
  if (Number.isNaN(errors)) fields.errors = 'errors must be a whole number.';
  if (Number.isNaN(chars)) fields.chars = 'chars must be a whole number.';
  const textKind = body.textKind == null ? 'words' : body.textKind;
  if (typeof textKind !== 'string' || !/^[a-z]{1,20}$/.test(textKind)) fields.textKind = 'Unknown text kind.';
  if (Object.keys(fields).length) throw fieldError(fields);

  const DB = env.DB;
  const day = todayOf(body.today);
  const dup = await DB.prepare('SELECT 1 FROM typing_tests WHERE user_id = ?1 AND id = ?2').bind(user.id, body.id).first();
  const ent = await entitlementsFor(env, user.id);
  const limit = ent.limits.dailyTests === undefined ? null : ent.limits.dailyTests;
  const used = (await DB.prepare('SELECT COUNT(*) AS n FROM typing_tests WHERE user_id = ?1 AND day = ?2').bind(user.id, day).first()).n;
  if (dup) return json({ saved: false, duplicate: true, today: { date: day, used, limit } });
  if (limit !== null && used >= limit) {
    return planResponse('plan_limit', `You've used today's ${limit} saved typing tests. Upgrade for more, or come back tomorrow.`, 'tests.basic');
  }
  const now = nowIso();
  await DB.prepare(`INSERT INTO typing_tests (id, user_id, duration, wpm, raw_wpm, accuracy, errors, chars, text_kind, day, created_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (user_id, id) DO NOTHING`)
    .bind(body.id, user.id, duration, wpm, rawWpm, accuracy, errors, chars, textKind, day, now).run();
  const pref = await DB.prepare('SELECT test_results FROM email_preferences WHERE user_id = ?1').bind(user.id).first();
  if (pref && pref.test_results) {
    await email(env, ctx, { to: user.email, userId: user.id, template: 'test_completed', category: 'platform',
      data: { name: user.fullName, wpm, accuracy, duration, rawWpm, errors } });
  }
  return json({ saved: true, test: { id: body.id, duration, wpm, rawWpm, accuracy, errors, chars, textKind, day, createdAt: now },
    today: { date: day, used: used + 1, limit } }, 201);
}

export async function getTests(request, env) {
  const { user } = await requireSession(env, request);
  const q = new URL(request.url).searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10) || 50));
  const ent = await entitlementsFor(env, user.id);
  const historyDays = ent.limits.historyDays ?? null;
  const today = todayOf(q.get('today'));
  const from = historyDays ? new Date(Date.parse(today) - (historyDays - 1) * DAY_MS).toISOString().slice(0, 10) : '0000-00-00';
  const DB = env.DB;
  const [rows, used, best] = await DB.batch([
    DB.prepare('SELECT * FROM typing_tests WHERE user_id = ?1 AND day >= ?2 ORDER BY created_at DESC LIMIT ?3').bind(user.id, from, limit),
    DB.prepare('SELECT COUNT(*) AS n FROM typing_tests WHERE user_id = ?1 AND day = ?2').bind(user.id, today),
    DB.prepare('SELECT MAX(wpm) AS wpm, AVG(wpm) AS avg, AVG(accuracy) AS acc, COUNT(*) AS n FROM typing_tests WHERE user_id = ?1 AND day >= ?2').bind(user.id, from),
  ]);
  const b = best.results[0];
  return json({
    tests: rows.results.map((t) => ({ id: t.id, duration: t.duration, wpm: t.wpm, rawWpm: t.raw_wpm, accuracy: t.accuracy, errors: t.errors, chars: t.chars, textKind: t.text_kind, day: t.day, createdAt: t.created_at })),
    summary: { count: b.n, bestWpm: b.wpm || 0, avgWpm: b.avg ? Math.round(b.avg * 10) / 10 : 0, avgAccuracy: b.acc ? Math.round(b.acc * 10) / 10 : 0 },
    today: { date: today, used: used.results[0].n, limit: ent.limits.dailyTests ?? null },
    historyDays,
  });
}

/* ---------------- GET /api/me/analytics ---------------- */
// basic (everyone; 7 days without analytics.basic / history.full), advanced (analytics.advanced), insights (insights).
// ?section=advanced|insights asks for one part only and answers 402 without the feature.
export async function getAnalytics(request, env) {
  const { user } = await requireSession(env, request);
  const q = new URL(request.url).searchParams;
  const section = q.get('section');
  const ent = await entitlementsFor(env, user.id);
  const canAdv = has(ent, 'analytics.advanced'), canIns = has(ent, 'insights');
  if (section === 'advanced' && !canAdv) return planResponse('plan_required', 'Advanced analytics come with the Pro plan and above.', 'analytics.advanced');
  if (section === 'insights' && !canIns) return planResponse('plan_required', 'Personal insights come with the Premium plan.', 'insights');
  const full = has(ent, 'analytics.basic');
  const today = todayOf(q.get('today'));
  const days = full ? Math.min(365, Math.max(7, parseInt(q.get('days') || '90', 10) || 90)) : Math.min(7, ent.limits.historyDays || 7);
  const from = new Date(Date.parse(today) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const DB = env.DB;
  const [daily, tests, ks, bg, ec] = (await DB.batch([
    DB.prepare('SELECT day, seconds, runs, best_wpm, acc_sum, acc_count, xp FROM daily_totals WHERE user_id = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day').bind(user.id, from, today),
    DB.prepare('SELECT day, COUNT(*) AS n, AVG(wpm) AS wpm, MAX(wpm) AS best, AVG(accuracy) AS acc FROM typing_tests WHERE user_id = ?1 AND day >= ?2 GROUP BY day ORDER BY day').bind(user.id, from),
    DB.prepare('SELECT k, attempts, errors FROM key_stats WHERE user_id = ?1').bind(user.id),
    DB.prepare('SELECT pair, count, total_ms FROM bigram_stats WHERE user_id = ?1 AND count >= 3').bind(user.id),
    DB.prepare('SELECT cls, n FROM error_classes WHERE user_id = ?1').bind(user.id),
  ])).map((r) => r.results);
  const r1 = (n) => Math.round(n * 10) / 10;
  const basic = {
    from, to: today, days,
    daily: daily.map((d) => ({ date: d.day, minutes: Math.round(d.seconds / 60), runs: d.runs, bestWpm: d.best_wpm, avgAccuracy: d.acc_count ? r1(d.acc_sum / d.acc_count) : null, xp: d.xp })),
    tests: tests.map((t) => ({ date: t.day, count: t.n, avgWpm: r1(t.wpm), bestWpm: t.best, avgAccuracy: r1(t.acc) })),
  };
  const keys = ks.map((k) => ({ key: k.k, attempts: k.attempts, errors: k.errors, accuracy: k.attempts ? r1(100 * (1 - k.errors / k.attempts)) : null }));
  const pairs = bg.map((p) => ({ pair: p.pair, count: p.count, avgMs: Math.round(p.total_ms / p.count) })).sort((a, b) => b.avgMs - a.avgMs);
  const errorClasses = { adjacent: 0, transposition: 0, omission: 0, other: 0 };
  for (const r of ec) errorClasses[r.cls] = r.n;
  const advanced = canAdv ? { keyHeatmap: keys, slowPairs: pairs.slice(0, 15), errorClasses } : null;
  let insights = null;
  if (canIns) {
    const weakKeys = keys.filter((k) => k.attempts >= 20).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
    const topError = Object.entries(errorClasses).sort((a, b) => b[1] - a[1])[0];
    const tips = [];
    if (weakKeys.length) tips.push(`Practise the keys ${weakKeys.map((k) => k.key).join(' ')}: they have your lowest accuracy.`);
    if (pairs.length) tips.push(`Slow down on purpose for ${pairs.slice(0, 3).map((p) => p.pair.replace('>', '')).join(', ')} until they feel even.`);
    if (topError && topError[1] > 0) tips.push({ adjacent: 'Most mistakes hit a neighbouring key: keep your fingers anchored on the home row.', transposition: 'You often swap letters: type a little slower and evenly.', omission: 'You often skip letters: read a word ahead.', other: 'Mixed mistakes: aim for accuracy first, speed follows.' }[topError[0]]);
    const recent = basic.daily.filter((d) => d.minutes > 0);
    tips.push(recent.length >= 5 ? 'Good rhythm this period: keep 10–15 minutes a day.' : 'Short daily sessions beat long weekly ones: aim for 10 minutes a day.');
    insights = { weakKeys, slowPairs: pairs.slice(0, 3), mainErrorType: topError && topError[1] > 0 ? topError[0] : null, plan: tips };
  }
  const locked = [!full && 'analytics.basic', !canAdv && 'analytics.advanced', !canIns && 'insights'].filter(Boolean);
  if (section === 'advanced') return json({ advanced });
  if (section === 'insights') return json({ insights });
  return json({ basic, advanced, insights, locked, upgradeUrl: locked.length ? '/pricing' : null });
}

/* ---------------- crons ---------------- */
/**
 * Asks Razorpay what happened to one order and acts on the answer: used by the scheduled
 * check below and by "Check with Razorpay" in the admin console. Only a payment Razorpay
 * reports as captured for this order and this amount can make it paid.
 * → { outcome: 'paid' | 'pending' | 'failed' | 'mismatch' | 'cancelled' | 'waiting', attempts, counts }
 *   attempts: payments Razorpay has for the order; counts: the scheduled check's counter to raise, or null.
 * Throws when Razorpay cannot be asked.
 */
export async function reconcileOrder(env, ctx, o, now = Date.now()) {
  const list = await rzp.fetchOrderPayments(env, o.razorpay_order_id);
  const items = (list && Array.isArray(list.items) ? list.items : []).filter((p) => p && p.order_id === o.razorpay_order_id);
  const attempts = items.length;
  const good = items.find((p) => p.status === 'captured') || items.find((p) => p.status === 'authorized');
  if (good) {
    const r = await handlePayment(env, ctx, o, good, 'api');
    return { outcome: r.status, attempts, counts: r.status === 'paid' ? 'paid' : null };
  }
  if (attempts && items.every((p) => p.status === 'failed')) {
    for (const p of items) if (p.amount === o.amount_paise) await recordPayment(env, o, p, 'api');
    const changed = await markFailed(env, ctx, o, items[items.length - 1].error_description || 'The payment did not go through.');
    return { outcome: 'failed', attempts, counts: changed ? 'failed' : null };
  }
  if (!attempts && Date.parse(o.created_at) < now - DAY_MS) {
    await env.DB.prepare("UPDATE orders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status IN ('created', 'attempted')").bind(o.id, nowIso()).run();
    return { outcome: 'cancelled', attempts, counts: 'cancelled' };
  }
  return { outcome: 'waiting', attempts, counts: null };
}

/** Every 10 minutes: orders waiting for a payment result are checked with Razorpay. */
export async function reconcile(env, ctx, { olderThanMin = 15 } = {}) {
  const DB = env.DB;
  const out = { checked: 0, paid: 0, failed: 0, cancelled: 0, invoices: 0 };
  if (rzp.configured(env)) {
    const now = Date.now();
    const rows = (await DB.prepare(
      `SELECT * FROM orders WHERE status IN ('created', 'attempted', 'pending') AND razorpay_order_id IS NOT NULL
          AND created_at < ?1 AND created_at > ?2 ORDER BY created_at LIMIT 25`
    ).bind(new Date(now - olderThanMin * MIN_MS).toISOString(), new Date(now - 7 * DAY_MS).toISOString()).all()).results;
    for (const o of rows) {
      out.checked++;
      try {
        const r = await reconcileOrder(env, ctx, o, now);
        if (r.counts) out[r.counts]++;
      } catch (err) {
        console.error('reconcile failed for an order:', err && err.code);
      }
    }
  }
  // repair: a paid order always has its invoice
  const missing = (await DB.prepare("SELECT o.id FROM orders o LEFT JOIN invoices i ON i.order_id = o.id WHERE o.status = 'paid' AND i.id IS NULL LIMIT 25").all()).results;
  for (const m of missing) { if (await ensureInvoice(env, m.id)) out.invoices++; }
  return out;
}

/** Nightly: expire ended subscriptions (email when the learner is back on Free) and send 3-day renewal reminders. */
export async function nightly(env, ctx) {
  const DB = env.DB;
  const now = nowIso();
  const out = { expired: 0, reminded: 0 };
  const expired = (await DB.prepare(
    `UPDATE user_subscriptions SET status = 'expired', updated_at = ?1 WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?1
     RETURNING id, user_id, package_id`
  ).bind(now).all()).results;
  out.expired = expired.length;
  const users = [...new Set(expired.map((s) => s.user_id))];
  for (const uid of users) {
    const ent = await entitlementsFor(env, uid, now);
    if (ent.plan !== 'free') continue; // still covered by another plan
    const u = await DB.prepare("SELECT email, full_name FROM users WHERE id = ?1 AND account_status = 'active'").bind(uid).first();
    const last = expired.filter((s) => s.user_id === uid).pop();
    const pkg = await DB.prepare('SELECT name FROM packages WHERE id = ?1').bind(last.package_id).first();
    if (u) await email(env, ctx, { to: u.email, userId: uid, template: 'subscription_expired',
      data: { name: u.full_name, packageName: pkg ? pkg.name : last.package_id, renewUrl: `${siteUrl(env)}/checkout?plan=${last.package_id}` } });
  }
  const soon = new Date(Date.now() + 3 * DAY_MS).toISOString();
  const due = (await DB.prepare(
    `SELECT s.id, s.user_id, s.package_id, s.expires_at, p.name, p.active, u.email, u.full_name
       FROM user_subscriptions s JOIN packages p ON p.id = s.package_id JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active' AND s.expires_at IS NOT NULL AND s.expires_at > ?1 AND s.expires_at <= ?2 AND s.reminded_at IS NULL
        AND u.account_status = 'active'
        AND NOT EXISTS (SELECT 1 FROM user_subscriptions t WHERE t.user_id = s.user_id AND t.status = 'active' AND t.id <> s.id
                           AND (t.expires_at IS NULL OR t.expires_at > s.expires_at))
      LIMIT 500`
  ).bind(now, soon).all()).results;
  for (const s of due) {
    const claim = await DB.prepare('UPDATE user_subscriptions SET reminded_at = ?2, updated_at = ?2 WHERE id = ?1 AND reminded_at IS NULL').bind(s.id, now).run();
    if (claim.meta.changes !== 1) continue;
    out.reminded++;
    await email(env, ctx, { to: s.email, userId: s.user_id, template: 'subscription_renewal_reminder',
      data: { name: s.full_name, packageName: s.name, expiresAt: s.expires_at, renewUrl: `${siteUrl(env)}/checkout?plan=${s.active ? s.package_id : ''}` } });
  }
  return out;
}

export async function cron(env, ctx, kind) {
  if (kind === '*/10 * * * *') {
    const r = await reconcile(env, ctx);
    if (r.checked || r.invoices) console.log('payments reconcile:', JSON.stringify(r));
  } else if (kind === '17 21 * * *') {
    const r = await nightly(env, ctx);
    console.log('subscriptions nightly:', JSON.stringify(r));
  }
}

export const ROUTES = {
  'GET /api/packages': getPackages,
  'GET /api/me/entitlements': getEntitlements,
  'POST /api/checkout/order': postOrder,
  'POST /api/checkout/verify': postVerify,
  'POST /api/checkout/failed': postFailed,
  'POST /api/webhooks/razorpay': postWebhook,
  'GET /api/me/subscriptions': getMySubscriptions,
  'GET /api/me/orders': getMyOrders,
  'GET /api/me/invoices': getMyInvoices,
  'POST /api/me/tests': postTest,
  'GET /api/me/tests': getTests,
  'GET /api/me/analytics': getAnalytics,
};
export const PATTERNS = [
  ['GET', /^\/api\/checkout\/orders\/(ord_[a-f0-9]{24})$/, ['id'], getOrder],
  ['GET', /^\/api\/me\/invoices\/(TC-\d{4}-\d{6,})$/, ['number'], getMyInvoice],
];
