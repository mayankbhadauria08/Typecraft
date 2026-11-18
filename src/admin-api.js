// Admin API — docs/SAAS-CONTRACTS.md §5 (admin list) and docs/ADMIN-CONSOLE.md §4 (permissions).
// Staff = owner (OWNER_EMAILS) / admin / support (admin_users). Everyone else gets 404.
// Each handler names the permission it needs (src/console/permissions.js); what Admin and
// Support may do is set in the console's Roles and permissions page. Every write is recorded in audit_logs.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { uuid } from './crypto.js';
import { roleOf, ROLES } from './roles.js';
import { requirePermission, assertCan } from './console/session.js';
import { isOwner, healthNumbers } from './admin.js';
import { entitlementsFor } from './entitlements.js';
import { audit, getSetting, refund } from './billing.js';
import { storedPackageView as packageView } from './package-view.js';
import { packageFields, checkPackage, featureKeys, saveStatements, highlightTakenFrom } from './package-rules.js';

const PAGE_SIZE = 25;
const DAY_MS = 86400000;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };
const pageOf = (q) => Math.max(1, Math.min(10000, parseInt(q.get('page') || '1', 10) || 1));
const paged = (items, page, total) => ({ items, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total });
const like = (s) => `%${String(s).replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/* ---------------- GET /api/admin/me ---------------- */
export async function getMe(request, env) {
  const { user, role } = await requirePermission(env, request);
  return json({ user, role });
}

/* ---------------- GET /api/admin/overview ---------------- */
export async function getOverview(request, env) {
  await requirePermission(env, request, 'dashboard.view');
  const DB = env.DB;
  const now = nowIso();
  const ago = (d) => new Date(Date.now() - d * DAY_MS).toISOString();
  const today = now.slice(0, 10);
  const paid = "status IN ('paid', 'partially_refunded', 'refunded')";
  const res = await DB.batch([
    DB.prepare('SELECT COUNT(*) AS n FROM users'),
    DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?1').bind(ago(7)),
    DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM user_subscriptions WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?1)").bind(now),
    DB.prepare(`SELECT COALESCE(SUM(CASE WHEN paid_at >= ?1 THEN amount_paise END), 0) AS today, COALESCE(SUM(CASE WHEN paid_at >= ?2 THEN amount_paise END), 0) AS d7,
                       COALESCE(SUM(CASE WHEN paid_at >= ?3 THEN amount_paise END), 0) AS d30, COALESCE(SUM(amount_paise), 0) AS total, COUNT(*) AS orders
                  FROM orders WHERE ${paid}`).bind(today, ago(7), ago(30)),
    DB.prepare(`SELECT COALESCE(SUM(CASE WHEN processed_at >= ?1 THEN amount_paise END), 0) AS today, COALESCE(SUM(CASE WHEN processed_at >= ?2 THEN amount_paise END), 0) AS d7,
                       COALESCE(SUM(CASE WHEN processed_at >= ?3 THEN amount_paise END), 0) AS d30, COALESCE(SUM(amount_paise), 0) AS total
                  FROM refunds WHERE status = 'processed'`).bind(today, ago(7), ago(30)),
    DB.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE created_at >= ?1 GROUP BY status').bind(today),
    DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('created', 'attempted', 'pending') AND created_at >= ?1").bind(ago(1)),
    DB.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE status = 'failed' AND received_at >= ?1").bind(ago(7)),
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status IN ('failed', 'bounced') AND created_at >= ?1").bind(ago(1)),
    DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    DB.prepare(`SELECT p.id, p.name, COUNT(s.id) AS n FROM packages p LEFT JOIN user_subscriptions s ON s.package_id = p.id AND s.status = 'active'
                  AND (s.expires_at IS NULL OR s.expires_at > ?1) GROUP BY p.id ORDER BY p.display_order`).bind(now),
  ]);
  const one = (i) => res[i].results[0] || {};
  const rev = one(3), ref = one(4);
  return json({
    at: now,
    users: { total: one(0).n, new7d: one(1).n, paying: one(2).n },
    revenue: {
      todayPaise: rev.today - ref.today, d7Paise: rev.d7 - ref.d7, d30Paise: rev.d30 - ref.d30, totalPaise: rev.total - ref.total,
      grossTotalPaise: rev.total, refundsTotalPaise: ref.total, paidOrders: rev.orders,
    },
    ordersToday: Object.fromEntries(res[5].results.map((r) => [r.status, r.n])),
    pendingOrders24h: one(6).n,
    webhookFailures7d: one(7).n,
    emailFailures24h: one(8).n,
    newContactMessages: one(9).n,
    activeByPackage: res[10].results.map((r) => ({ packageId: r.id, name: r.name, active: r.n })),
    health: await healthNumbers(env),
  });
}

/* ---------------- users ---------------- */
export async function getUsers(request, env) {
  await requirePermission(env, request, 'customers.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q);
  const term = (q.get('q') || '').trim().slice(0, 100).toLowerCase();
  const now = nowIso();
  const where = term ? "WHERE (u.email LIKE ?2 ESCAPE '\\' OR lower(u.full_name) LIKE ?2 ESCAPE '\\' OR u.id = ?3)" : 'WHERE ?2 IS NULL AND ?3 IS NULL';
  const args = [now, term ? like(term) : null, term ? term : null];
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT u.id, u.full_name, u.email, u.email_verified, u.account_status, u.created_at, u.last_login_at, a.role,
                           (SELECT p.name FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
                             WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1)
                             ORDER BY p.display_order DESC LIMIT 1) AS plan
                      FROM users u LEFT JOIN admin_users a ON a.user_id = u.id ${where}
                     ORDER BY u.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(...args),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where.replace(/\?2/g, '?1').replace(/\?3/g, '?2')}`).bind(args[1], args[2]),
  ]);
  const items = rows.results.map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, emailVerified: !!u.email_verified, status: u.account_status,
    role: isOwner(env, u.email) ? 'owner' : u.role || null, plan: u.plan || 'Free', createdAt: u.created_at, lastLoginAt: u.last_login_at }));
  return json(paged(items, page, count.results[0].n));
}

async function userRow(env, id) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new HttpError(404, 'not_found', 'User not found.');
  const u = await env.DB.prepare('SELECT id, full_name, email, phone_number, email_verified, account_status, created_at, last_login_at FROM users WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'not_found', 'User not found.');
  return u;
}

async function userDetail(env, u) {
  const DB = env.DB;
  const [subs, orders, totals, tests] = (await DB.batch([
    DB.prepare('SELECT s.*, p.name FROM user_subscriptions s JOIN packages p ON p.id = s.package_id WHERE s.user_id = ?1 ORDER BY s.created_at DESC').bind(u.id),
    DB.prepare(`SELECT o.*, p.name AS package_name, i.number AS invoice_number FROM orders o JOIN packages p ON p.id = o.package_id
                  LEFT JOIN invoices i ON i.order_id = o.id WHERE o.user_id = ?1 ORDER BY o.created_at DESC LIMIT 100`).bind(u.id),
    DB.prepare('SELECT xp, streak_count, streak_best FROM user_totals WHERE user_id = ?1').bind(u.id),
    DB.prepare('SELECT COUNT(*) AS n, MAX(wpm) AS best FROM typing_tests WHERE user_id = ?1').bind(u.id),
  ])).map((r) => r.results);
  const t = totals[0] || {};
  return {
    user: { id: u.id, fullName: u.full_name, email: u.email, phoneNumber: u.phone_number, emailVerified: !!u.email_verified, status: u.account_status,
      createdAt: u.created_at, lastLoginAt: u.last_login_at, role: await roleOf(env, { id: u.id, email: u.email }) },
    entitlements: await entitlementsFor(env, u.id),
    subscriptions: subs.map((s) => ({ id: s.id, packageId: s.package_id, packageName: s.name, orderId: s.order_id, status: s.status, source: s.source, startsAt: s.starts_at, expiresAt: s.expires_at })),
    orders: orders.map((o) => ({ orderId: o.id, packageName: o.package_name, amountPaise: o.amount_paise, status: o.status, createdAt: o.created_at, paidAt: o.paid_at, invoiceNumber: o.invoice_number, failureReason: o.failure_reason })),
    progress: { xp: t.xp || 0, streak: t.streak_count || 0, bestStreak: t.streak_best || 0, tests: tests[0].n, bestTestWpm: tests[0].best || 0 },
  };
}

export async function getUser(request, env, ctx, params) {
  await requirePermission(env, request, 'customers.view');
  return json(await userDetail(env, await userRow(env, params.id)));
}

export async function postUser(request, env, ctx, params) {
  const who = await requirePermission(env, request); // each change below names its own permission
  const { user: actor, role: actorRole } = who;
  const u = await userRow(env, params.id);
  const body = await readJson(request);
  const DB = env.DB;
  const ip = clientIp(request);
  const now = nowIso();
  const targetRole = await roleOf(env, { id: u.id, email: u.email });
  const done = [];

  if (body.role !== undefined) {
    await assertCan(env, who, 'admins.manage'); // Super Admin only
    const role = body.role === null || body.role === 'none' || body.role === '' ? null : body.role;
    if (role !== null && !ROLES.includes(role)) throw fieldError({ role: 'Role must be owner, admin, support or none.' });
    if (isOwner(env, u.email)) throw fieldError({ role: 'This account is an owner through OWNER_EMAILS; change that setting instead.' });
    if (role === null) await DB.prepare('DELETE FROM admin_users WHERE user_id = ?1').bind(u.id).run();
    else await DB.prepare(`INSERT INTO admin_users (user_id, role, created_by, created_at) VALUES (?1, ?2, ?3, ?4)
                           ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, created_by = excluded.created_by`).bind(u.id, role, actor.id, now).run();
    await audit(env, { actorId: actor.id, action: 'user.role', target: `user:${u.id}`, detail: { from: targetRole, to: role }, ip });
    done.push('role');
  }
  if (body.status !== undefined) {
    await assertCan(env, who, 'customers.manage');
    if (!['active', 'disabled'].includes(body.status)) throw fieldError({ status: 'Status must be active or disabled.' });
    if (u.id === actor.id) throw fieldError({ status: "You can't change your own account status." });
    if (targetRole === 'owner' || (targetRole && actorRole !== 'owner')) throw new HttpError(403, 'forbidden', 'Only the owner can disable staff accounts, and owners cannot be disabled here.');
    const stmts = [DB.prepare('UPDATE users SET account_status = ?2, updated_at = ?3 WHERE id = ?1').bind(u.id, body.status, now)];
    if (body.status === 'disabled') stmts.push(DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id));
    await DB.batch(stmts);
    await audit(env, { actorId: actor.id, action: body.status === 'disabled' ? 'user.disable' : 'user.enable', target: `user:${u.id}`, detail: { reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : null }, ip });
    done.push('status');
  }
  if (body.grant !== undefined) {
    await assertCan(env, who, 'subscriptions.manage');
    const g = body.grant;
    if (!g || typeof g !== 'object' || typeof g.packageId !== 'string') throw fieldError({ grant: 'Choose a plan to grant.' });
    const pkg = await DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(g.packageId).first();
    if (!pkg || pkg.id === 'free') throw fieldError({ grant: 'Choose a paid plan to grant.' });
    let days = g.days == null ? pkg.validity_days : g.days;
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw fieldError({ grant: 'Days must be a whole number from 1 to 3650.' });
    const expires = days == null ? null : new Date(Date.now() + days * DAY_MS).toISOString();
    const id = uuid();
    await DB.prepare(`INSERT INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
                      VALUES (?1, ?2, ?3, NULL, 'active', 'admin', ?4, ?5, ?6, ?7, ?6, ?6)`).bind(id, u.id, pkg.id, pkg.features, pkg.limits, now, expires).run();
    await audit(env, { actorId: actor.id, action: 'subscription.grant', target: `user:${u.id}`, detail: { subscriptionId: id, packageId: pkg.id, days, reason: typeof g.reason === 'string' ? g.reason.slice(0, 300) : null }, ip });
    done.push('grant');
  }
  if (body.revoke !== undefined) {
    await assertCan(env, who, 'subscriptions.manage');
    if (typeof body.revoke !== 'string') throw fieldError({ revoke: 'Choose a subscription to revoke.' });
    const r = await DB.prepare("UPDATE user_subscriptions SET status = 'revoked', updated_at = ?3 WHERE id = ?1 AND user_id = ?2 AND status = 'active'").bind(body.revoke, u.id, now).run();
    if (r.meta.changes !== 1) throw fieldError({ revoke: 'That subscription is not active for this user.' });
    await audit(env, { actorId: actor.id, action: 'subscription.revoke', target: `user:${u.id}`, detail: { subscriptionId: body.revoke }, ip });
    done.push('revoke');
  }
  if (!done.length) throw new HttpError(400, 'nothing_to_save', 'Nothing to change.');
  return json({ changed: done, ...(await userDetail(env, await userRow(env, u.id))) });
}

/* ---------------- packages ---------------- */
export async function getAdminPackages(request, env) {
  await requirePermission(env, request, 'packages.view');
  const [pk, ft] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM packages ORDER BY display_order, price_paise'),
    env.DB.prepare('SELECT key, label, description FROM package_features ORDER BY display_order'),
  ]);
  const labels = Object.fromEntries(ft.results.map((f) => [f.key, f.label]));
  return json({ packages: pk.results.map((p) => ({ ...packageView(p, labels), active: !!p.active, displayOrder: p.display_order, updatedAt: p.updated_at })), features: ft.results });
}

export async function putPackage(request, env, ctx, params) {
  const { user: actor } = await requirePermission(env, request, 'packages.manage');
  const DB = env.DB;
  const p = await DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(params.id).first();
  if (!p) throw new HttpError(404, 'not_found', 'Package not found.');
  const body = await readJson(request);
  // the rules are shared with the admin console: src/package-rules.js
  const cur = packageFields(p);
  const { v, fields, changed } = checkPackage(p.id, cur, body, await featureKeys(env));
  if (Object.keys(fields).length) throw fieldError(fields);
  const taken = await highlightTakenFrom(env, p.id, v);
  await DB.batch(saveStatements(env, p.id, v, { now: nowIso() }));
  await audit(env, { actorId: actor.id, action: 'package.update', target: `package:${p.id}`,
    detail: { changed, from: Object.fromEntries(changed.map((k) => [k, cur[k]])), ...(taken.length ? { highlightTakenFrom: taken } : {}) }, ip: clientIp(request) });
  const row = await DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(p.id).first();
  const labels = Object.fromEntries((await DB.prepare('SELECT key, label FROM package_features').all()).results.map((r) => [r.key, r.label]));
  return json({ package: { ...packageView(row, labels), active: !!row.active, displayOrder: row.display_order, updatedAt: row.updated_at }, changed });
}

/* ---------------- payments ---------------- */
export async function getPayments(request, env) {
  await requirePermission(env, request, 'payments.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q);
  const status = q.get('status');
  const term = (q.get('q') || '').trim().slice(0, 100).toLowerCase();
  const conds = [], args = [];
  if (status && /^[a-z_]{1,30}$/.test(status)) { args.push(status); conds.push(`o.status = ?${args.length}`); }
  if (term) {
    args.push(like(term)); const i = args.length;
    args.push(term); const j = args.length;
    conds.push(`(u.email LIKE ?${i} ESCAPE '\\' OR lower(u.full_name) LIKE ?${i} ESCAPE '\\' OR o.id = ?${j} OR o.razorpay_order_id = ?${j}
                  OR EXISTS (SELECT 1 FROM payments x WHERE x.order_id = o.id AND lower(x.razorpay_payment_id) = ?${j}))`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT o.*, u.email, u.full_name, p.name AS package_name, i.number AS invoice_number,
                           y.id AS payment_id, y.razorpay_payment_id, y.status AS payment_status, y.method, y.error_description,
                           (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds r WHERE r.order_id = o.id AND r.status = 'processed') AS refunded,
                           (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds r WHERE r.order_id = o.id AND r.status = 'pending') AS refund_pending
                      FROM orders o JOIN users u ON u.id = o.user_id JOIN packages p ON p.id = o.package_id
                      LEFT JOIN invoices i ON i.order_id = o.id
                      LEFT JOIN payments y ON y.id = (SELECT id FROM payments z WHERE z.order_id = o.id
                                                       ORDER BY (z.status IN ('captured', 'refunded', 'partially_refunded')) DESC, z.updated_at DESC LIMIT 1)
                      ${where} ORDER BY o.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(...args),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id ${where}`).bind(...args),
  ]);
  const items = rows.results.map((o) => ({
    orderId: o.id, userId: o.user_id, email: o.email, name: o.full_name, packageId: o.package_id, packageName: o.package_name,
    amountPaise: o.amount_paise, currency: o.currency, status: o.status, createdAt: o.created_at, paidAt: o.paid_at, failureReason: o.failure_reason,
    razorpayOrderId: o.razorpay_order_id, invoiceNumber: o.invoice_number || null,
    payment: o.payment_id ? { id: o.payment_id, razorpayPaymentId: o.razorpay_payment_id, status: o.payment_status, method: o.method, error: o.error_description } : null,
    refundedPaise: o.refunded, refundPendingPaise: o.refund_pending,
    refundablePaise: o.payment_id && ['captured', 'partially_refunded'].includes(o.payment_status) ? o.amount_paise - o.refunded - o.refund_pending : 0,
  }));
  return json(paged(items, page, count.results[0].n));
}

export async function postRefund(request, env, ctx, params) {
  const { user: actor } = await requirePermission(env, request, 'payments.refund');
  const body = await readJson(request);
  const id = params.id;
  const pay = await env.DB.prepare(
    `SELECT * FROM payments WHERE id = ?1 OR razorpay_payment_id = ?1
        OR (order_id = ?1 AND status IN ('captured', 'partially_refunded', 'refunded')) ORDER BY (status = 'captured') DESC LIMIT 1`
  ).bind(id).first();
  if (!pay) throw new HttpError(404, 'not_found', 'Payment not found.');
  const amountPaise = body.amountPaise == null ? null : body.amountPaise;
  const r = await refund(env, ctx, pay, { amountPaise, reason: body.reason, actorId: actor.id, ip: clientIp(request) });
  const o = await env.DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(pay.order_id).first();
  return json({ refund: r, orderId: pay.order_id, orderStatus: o.status });
}

/* ---------------- revenue ---------------- */
export async function getRevenue(request, env) {
  await requirePermission(env, request, 'revenue.view');
  const q = new URL(request.url).searchParams;
  const to = isDay(q.get('to')) ? q.get('to') : nowIso().slice(0, 10);
  const from = isDay(q.get('from')) ? q.get('from') : new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (from > to) throw fieldError({ from: 'from must be on or before to.' });
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 731) throw fieldError({ from: 'Choose at most two years.' });
  const end = to + 'T23:59:59.999Z';
  const DB = env.DB;
  const paid = "o.status IN ('paid', 'partially_refunded', 'refunded')";
  const [days, refunds, byPkg] = (await DB.batch([
    DB.prepare(`SELECT substr(o.paid_at, 1, 10) AS day, COUNT(*) AS orders, SUM(o.amount_paise) AS gross FROM orders o
                 WHERE ${paid} AND o.paid_at >= ?1 AND o.paid_at <= ?2 GROUP BY day ORDER BY day`).bind(from, end),
    DB.prepare(`SELECT substr(processed_at, 1, 10) AS day, COUNT(*) AS n, SUM(amount_paise) AS amount FROM refunds
                 WHERE status = 'processed' AND processed_at >= ?1 AND processed_at <= ?2 GROUP BY day ORDER BY day`).bind(from, end),
    DB.prepare(`SELECT p.id, p.name, COUNT(o.id) AS orders, COALESCE(SUM(o.amount_paise), 0) AS gross,
                       COALESCE(SUM((SELECT COALESCE(SUM(r.amount_paise), 0) FROM refunds r WHERE r.order_id = o.id AND r.status = 'processed')), 0) AS refunded
                  FROM orders o JOIN packages p ON p.id = o.package_id
                 WHERE ${paid} AND o.paid_at >= ?1 AND o.paid_at <= ?2 GROUP BY p.id ORDER BY gross DESC`).bind(from, end),
  ])).map((r) => r.results);
  const series = [];
  const dm = new Map(days.map((d) => [d.day, d])), rm = new Map(refunds.map((r) => [r.day, r]));
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    const d = dm.get(day), r = rm.get(day);
    const gross = d ? d.gross : 0, ref = r ? r.amount : 0;
    series.push({ date: day, orders: d ? d.orders : 0, grossPaise: gross, refundsPaise: ref, netPaise: gross - ref });
  }
  const gross = days.reduce((s, d) => s + d.gross, 0), orders = days.reduce((s, d) => s + d.orders, 0), ref = refunds.reduce((s, r) => s + r.amount, 0);
  return json({
    from, to, currency: 'INR', daily: series,
    byPackage: byPkg.map((p) => ({ packageId: p.id, name: p.name, orders: p.orders, grossPaise: p.gross, refundsPaise: p.refunded, netPaise: p.gross - p.refunded })),
    totals: { orders, grossPaise: gross, refundsPaise: ref, netPaise: gross - ref, refunds: refunds.reduce((s, r) => s + r.n, 0), avgOrderPaise: orders ? Math.round(gross / orders) : 0 },
  });
}

/* ---------------- settings ---------------- */
const SETTING_KEYS = ['seller', 'support', 'payments', 'signups'];
const str = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);
const VALIDATE = {
  seller(v) {
    for (const k of ['name', 'legalName', 'address', 'email', 'phone']) if (v[k] !== undefined && !str(v[k], 300)) return `seller.${k} must be text (at most 300 characters).`;
    if (v.gstin !== undefined && v.gstin !== null && !(typeof v.gstin === 'string' && /^[0-9A-Z]{15}$/.test(v.gstin))) return 'seller.gstin must be a 15-character GSTIN or empty.';
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'seller.email must be an email address.';
    return null;
  },
  support(v) {
    if (v.email !== undefined && !(typeof v.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))) return 'support.email must be an email address.';
    if (v.hours !== undefined && !str(v.hours, 200)) return 'support.hours must be text.';
    if (v.replyDays !== undefined && !(Number.isInteger(v.replyDays) && v.replyDays >= 0 && v.replyDays <= 30)) return 'support.replyDays must be 0–30.';
    return null;
  },
  payments(v) {
    for (const k of ['enabled', 'testMode']) if (v[k] !== undefined && typeof v[k] !== 'boolean') return `payments.${k} must be true or false.`;
    return null;
  },
  signups(v) {
    if (v.open !== undefined && typeof v.open !== 'boolean') return 'signups.open must be true or false.';
    return null;
  },
};
const ALLOWED_FIELDS = { seller: ['name', 'legalName', 'address', 'email', 'phone', 'gstin'], support: ['email', 'hours', 'replyDays'], payments: ['enabled', 'testMode'], signups: ['open'] };

async function allSettings(env) {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = await getSetting(env, k, {});
  return out;
}

export async function getSettings(request, env) {
  await requirePermission(env, request, 'settings.view');
  return json({ settings: await allSettings(env), paymentsConfigured: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), webhookConfigured: !!env.RAZORPAY_WEBHOOK_SECRET });
}

export async function putSettings(request, env) {
  const { user: actor } = await requirePermission(env, request, 'settings.manage');
  const body = await readJson(request);
  const fields = {}, changes = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTING_KEYS.includes(k)) { fields[k] = `Unknown setting: ${k}.`; continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { fields[k] = `${k} must be an object.`; continue; }
    const unknown = Object.keys(v).filter((f) => !ALLOWED_FIELDS[k].includes(f));
    if (unknown.length) { fields[k] = `Unknown field: ${k}.${unknown[0]}.`; continue; }
    const err = VALIDATE[k](v);
    if (err) { fields[k] = err; continue; }
    changes[k] = v;
  }
  if (Object.keys(fields).length) throw fieldError(fields);
  if (!Object.keys(changes).length) throw new HttpError(400, 'nothing_to_save', 'Nothing to save.');
  const now = nowIso();
  const before = await allSettings(env);
  await env.DB.batch(Object.entries(changes).map(([k, v]) => env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(k, JSON.stringify({ ...before[k], ...v }), actor.id, now)));
  await audit(env, { actorId: actor.id, action: 'settings.update', target: `settings:${Object.keys(changes).join(',')}`,
    detail: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: Object.fromEntries(Object.keys(v).map((f) => [f, before[k][f] ?? null])), to: v }])), ip: clientIp(request) });
  return json({ settings: await allSettings(env) });
}

/* ---------------- audit log ---------------- */
export async function getAudit(request, env) {
  await requirePermission(env, request, 'audit.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q);
  const action = q.get('action');
  const where = action && /^[\w.]{1,60}$/.test(action) ? 'WHERE a.action = ?1' : 'WHERE ?1 IS NULL';
  const arg = action && /^[\w.]{1,60}$/.test(action) ? action : null;
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}
                     ORDER BY a.created_at DESC, a.rowid DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(arg),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${where}`).bind(arg),
  ]);
  return json(paged(rows.results.map((a) => ({ id: a.id, at: a.created_at, actorId: a.actor_id, actorEmail: a.actor_email || (a.actor_id ? null : 'system'),
    action: a.action, target: a.target, detail: parse(a.detail, null), ip: a.ip })), page, count.results[0].n));
}

export const ROUTES = {
  'GET /api/admin/me': getMe,
  'GET /api/admin/overview': getOverview,
  'GET /api/admin/users': getUsers,
  'GET /api/admin/packages': getAdminPackages,
  'GET /api/admin/payments': getPayments,
  'GET /api/admin/revenue': getRevenue,
  'GET /api/admin/settings': getSettings,
  'PUT /api/admin/settings': putSettings,
  'GET /api/admin/audit': getAudit,
};
export const PATTERNS = [
  ['GET', /^\/api\/admin\/users\/([\w-]{1,64})$/, ['id'], getUser],
  ['POST', /^\/api\/admin\/users\/([\w-]{1,64})$/, ['id'], postUser],
  ['PUT', /^\/api\/admin\/packages\/([\w-]{1,40})$/, ['id'], putPackage],
  ['POST', /^\/api\/admin\/payments\/([\w-]{1,80})\/refund$/, ['id'], postRefund],
];
export async function cron() {}
