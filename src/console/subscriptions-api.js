// Subscriptions (docs/ADMIN-PHASE-2.md §8): the plans customers have. Console-only endpoints.
//
//   GET  /api/console/subscriptions                 subscriptions.view    list: q, state, package, source, page
//   POST /api/console/customers/:id/subscriptions   subscriptions.manage  give a plan: { packageId, days | null, reason }
//   POST /api/console/subscriptions/:id/extend      subscriptions.manage  add days: { days 1–365, reason }
//   POST /api/console/subscriptions/:id/revoke      subscriptions.manage  end a plan early: { reason }. Nothing is refunded.
//   POST /api/console/subscriptions/extend-all      subscriptions.bulk    add days to every active plan that has an end date:
//                                                                         { days 1–30, reason } (password check)
//
// Dates stay in the exact toISOString() form, because they are compared as text: date sums in
// SQL go through shift() below. No email goes to customers from here yet.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { uuid } from '../crypto.js';
import { hitLimit } from '../session.js';
import { audit } from '../billing.js';
import { entitlementsFor } from '../entitlements.js';
import { requireAdmin } from './session.js';
import { Binder, PAGE_SIZE, DAY_MS, pageOf, offsetOf, paged, like, oneOf, idParam, reasonOf } from './lib.js';

/** A date column moved by `mod` ('+7 days'), in the same text form as toISOString(). */
const shift = (column, mod) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, ${mod})`;
export const SOURCES = ['purchase', 'admin', 'promo'];

/** What a plan is now: active, upcoming (queued after another), expired or revoked. */
export const stateOf = (s, now) => (s.status !== 'active' ? s.status : s.expires_at && s.expires_at <= now ? 'expired' : s.starts_at > now ? 'upcoming' : 'active');
export const subView = (s, now) => ({
  id: s.id, packageId: s.package_id, packageName: s.package_name, orderId: s.order_id || null, source: s.source, status: stateOf(s, now),
  startsAt: s.starts_at, expiresAt: s.expires_at, createdAt: s.created_at,
});

/* ---------- the list ---------- */
const STATES = ['active', 'ending', 'expired', 'revoked'];
function whereOf(b, q, now) {
  const where = [];
  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`u.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${b.p(like(term))} ESCAPE '\\'`];
    if (/^[\w-]{6,64}$/.test(term)) { const t = b.p(term); parts.push(`s.id = ${t}`, `s.user_id = ${t}`, `s.order_id = ${t}`); }
    where.push(`(${parts.join(' OR ')})`);
  }
  const at = () => b.once('now', now);   // bound only when a state uses it
  const state = oneOf(q.get('state'), STATES);
  if (state === 'active') where.push(`s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ${at()})`);
  if (state === 'ending') where.push(`s.status = 'active' AND s.expires_at > ${at()} AND s.expires_at <= ${b.p(new Date(Date.parse(now) + 7 * DAY_MS).toISOString())}`);
  if (state === 'expired') where.push(`(s.status = 'expired' OR (s.status = 'active' AND s.expires_at <= ${at()}))`);
  if (state === 'revoked') where.push(`s.status = 'revoked'`);
  const pkg = q.get('package') || '';
  if (/^[a-z][a-z0-9-]{0,30}$/.test(pkg)) where.push(`s.package_id = ${b.p(pkg)}`);
  const source = oneOf(q.get('source'), SOURCES);
  if (source) where.push(`s.source = ${b.p(source)}`);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}
const FROM = 'FROM user_subscriptions s JOIN users u ON u.id = s.user_id JOIN packages p ON p.id = s.package_id';

export async function getSubscriptions(request, env) {
  await requireAdmin(env, request, 'subscriptions.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), now = nowIso(), DB = env.DB;
  const list = new Binder(), count = new Binder();
  const listWhere = whereOf(list, q, now), countWhere = whereOf(count, q, now);
  // plans that end soon are listed soonest first; everything else newest first
  const order = q.get('state') === 'ending' ? 's.expires_at ASC' : 's.created_at DESC';
  const soon = new Date(Date.now() + 7 * DAY_MS).toISOString();
  const [rows, total, counts, packages] = await DB.batch([
    DB.prepare(`SELECT s.id, s.user_id, s.package_id, p.name AS package_name, s.order_id, s.status, s.source, s.starts_at, s.expires_at, s.created_at,
                       u.full_name, u.email
                  ${FROM} ${listWhere} ORDER BY ${order}, s.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n ${FROM} ${countWhere}`).bind(...count.args),
    DB.prepare(`SELECT COALESCE(SUM(status = 'active' AND (expires_at IS NULL OR expires_at > ?1)), 0) AS active,
                       COALESCE(SUM(status = 'active' AND expires_at > ?1 AND expires_at <= ?2), 0) AS ending,
                       COALESCE(SUM(status = 'expired' OR (status = 'active' AND expires_at <= ?1)), 0) AS expired,
                       COALESCE(SUM(status = 'revoked'), 0) AS revoked,
                       COALESCE(SUM(status = 'active' AND expires_at > ?1), 0) AS extendable
                  FROM user_subscriptions`).bind(now, soon),
    DB.prepare("SELECT id, name FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  const items = rows.results.map((s) => ({ ...subView(s, now), customer: { id: s.user_id, fullName: s.full_name, email: s.email } }));
  return json({ ...paged(items, page, total.results[0].n), counts: counts.results[0], packages: packages.results });
}

/* ---------- one plan ---------- */
async function subRow(env, id) {
  const s = await env.DB.prepare(
    `SELECT s.*, p.name AS package_name, u.full_name, u.email FROM user_subscriptions s JOIN packages p ON p.id = s.package_id JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1`).bind(idParam(id, 'Plan not found.')).first();
  if (!s) throw new HttpError(404, 'not_found', 'Plan not found.');
  return s;
}
const planNow = async (env, userId, now) => {
  const ent = await entitlementsFor(env, userId, now);
  return { id: ent.plan, name: ent.planName, expiresAt: ent.expiresAt };
};

/** Gives a customer a plan, starting now. To add days to a plan they already have, extend it. */
export async function postGrant(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'subscriptions.manage');
  const DB = env.DB;
  const u = await DB.prepare('SELECT id FROM users WHERE id = ?1').bind(idParam(params.id, 'Customer not found.')).first();
  if (!u) throw new HttpError(404, 'not_found', 'Customer not found.');
  const body = await readJson(request);
  const pkg = typeof body.packageId === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(body.packageId)
    ? await DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(body.packageId).first() : null;
  if (!pkg || pkg.id === 'free') throw fieldError({ packageId: 'Choose a paid plan.' });
  let days = pkg.validity_days;
  if (body.days != null) {
    if (!Number.isInteger(body.days) || body.days < 1 || body.days > 3650) throw fieldError({ days: 'Enter a whole number of days from 1 to 3,650, or leave it empty.' });
    days = body.days;
  }
  const reason = reasonOf(body);
  const now = nowIso(), id = uuid();
  const expires = days == null ? null : new Date(Date.parse(now) + days * DAY_MS).toISOString();
  await DB.prepare(`INSERT INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
                    VALUES (?1, ?2, ?3, NULL, 'active', 'admin', ?4, ?5, ?6, ?7, ?6, ?6)`).bind(id, u.id, pkg.id, pkg.features, pkg.limits, now, expires).run();
  await audit(env, { actorId: who.user.id, action: 'subscription.grant', target: `user:${u.id}`, detail: { subscriptionId: id, packageId: pkg.id, days, reason }, ip: clientIp(request) });
  const s = await subRow(env, id);
  return json({ subscription: subView(s, now), plan: await planNow(env, u.id, now) }, 201);
}

function daysOf(body, max) {
  if (!Number.isInteger(body.days) || body.days < 1 || body.days > max) throw fieldError({ days: `Enter a whole number of days from 1 to ${max}.` });
  return body.days;
}

/**
 * Adds days to a plan that is on. Plans queued after it (a renewal bought before it ended)
 * move by the same days, so the customer gains them in full.
 */
export async function postExtend(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'subscriptions.manage');
  const s = await subRow(env, params.id);
  const body = await readJson(request);
  const days = daysOf(body, 365);
  const reason = reasonOf(body);
  const now = nowIso();
  if (stateOf(s, now) === 'expired' || s.status !== 'active') throw new HttpError(400, 'not_active', 'This plan has ended. Give the customer a new plan instead.');
  if (!s.expires_at) throw new HttpError(400, 'no_end_date', 'This plan has no end date, so there is nothing to extend.');
  const DB = env.DB, mod = `+${days} days`;
  const [queued, own] = await DB.batch([
    DB.prepare(`UPDATE user_subscriptions SET starts_at = ${shift('starts_at', '?3')},
                       expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ${shift('expires_at', '?3')} END, reminded_at = NULL, updated_at = ?4
                 WHERE user_id = ?1 AND id <> ?2 AND status = 'active' AND starts_at >= ?5
                   AND EXISTS (SELECT 1 FROM user_subscriptions WHERE id = ?2 AND status = 'active' AND expires_at = ?5)`).bind(s.user_id, s.id, mod, now, s.expires_at),
    DB.prepare(`UPDATE user_subscriptions SET expires_at = ${shift('expires_at', '?2')}, reminded_at = NULL, updated_at = ?3
                 WHERE id = ?1 AND status = 'active' AND expires_at = ?4`).bind(s.id, mod, now, s.expires_at),
  ]);
  if (own.meta.changes !== 1) throw new HttpError(409, 'conflict', 'This plan changed a moment ago. Reload the page and try again.');
  const after = await subRow(env, s.id);
  const moved = queued.meta.changes || 0;
  await audit(env, { actorId: who.user.id, action: 'subscription.extend', target: `user:${s.user_id}`,
    detail: { subscriptionId: s.id, packageId: s.package_id, days, from: s.expires_at, to: after.expires_at, moved, reason }, ip: clientIp(request) });
  return json({ subscription: subView(after, now), moved, plan: await planNow(env, s.user_id, now) });
}

/** Ends a plan early. Nothing is refunded: a refund is sent from the payment's page. */
export async function postRevoke(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'subscriptions.manage');
  const s = await subRow(env, params.id);
  const body = await readJson(request);
  const reason = reasonOf(body);
  const now = nowIso();
  if (stateOf(s, now) === 'expired' || s.status !== 'active') throw new HttpError(400, 'not_active', 'This plan has already ended.');
  const r = await env.DB.prepare("UPDATE user_subscriptions SET status = 'revoked', updated_at = ?2 WHERE id = ?1 AND status = 'active'").bind(s.id, now).run();
  if (r.meta.changes !== 1) throw new HttpError(409, 'conflict', 'This plan changed a moment ago. Reload the page and try again.');
  await audit(env, { actorId: who.user.id, action: 'subscription.revoke', target: `user:${s.user_id}`,
    detail: { subscriptionId: s.id, packageId: s.package_id, bought: !!s.order_id, reason }, ip: clientIp(request) });
  const after = await subRow(env, s.id);
  return json({ subscription: subView(after, now), plan: await planNow(env, s.user_id, now) });
}

/** Adds days to every plan that is on and has an end date: after an outage, say. */
export async function postExtendAll(request, env) {
  const who = await requireAdmin(env, request, 'subscriptions.bulk');
  const body = await readJson(request);
  const days = daysOf(body, 30);
  const reason = reasonOf(body);
  if (!(await hitLimit(env, 'extend-all', 1, 60))) throw new HttpError(429, 'rate_limited', 'Every plan was extended a moment ago. Look at the list before doing it again.');
  const now = nowIso();
  // a plan queued after another starts later by the same days, so it still starts when the one before it ends
  const r = await env.DB.prepare(
    `UPDATE user_subscriptions SET starts_at = CASE WHEN starts_at > ?1 THEN ${shift('starts_at', '?2')} ELSE starts_at END,
            expires_at = ${shift('expires_at', '?2')}, reminded_at = NULL, updated_at = ?1
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at > ?1`).bind(now, `+${days} days`).run();
  const plans = (r.meta && r.meta.changes) || 0;
  await audit(env, { actorId: who.user.id, action: 'subscription.extend_all', target: 'subscriptions', detail: { days, plans, reason }, ip: clientIp(request) });
  return json({ plans, days });
}

export const ROUTES = {
  'GET /api/console/subscriptions': getSubscriptions,
  'POST /api/console/subscriptions/extend-all': postExtendAll,
};
export const PATTERNS = [
  ['POST', /^\/api\/console\/customers\/([\w-]{1,64})\/subscriptions$/, ['id'], postGrant],
  ['POST', /^\/api\/console\/subscriptions\/([\w-]{1,64})\/extend$/, ['id'], postExtend],
  ['POST', /^\/api\/console\/subscriptions\/([\w-]{1,64})\/revoke$/, ['id'], postRevoke],
];
