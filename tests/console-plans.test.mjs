// Admin console, phase 2: subscriptions (docs/ADMIN-PHASE-2.md §8), learning access (§9) and packages (§10).
//   node --test tests/console-plans.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, pw, assertNoInlineCode } from './console-kit.mjs';
import { entitlementsFor, lessonAllowed, gameAllowed } from '../src/entitlements.js';
import { D1Shim } from './d1-shim.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

let S, K, owner, admin, support, P = {}, U = {};
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8793) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.62.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));

  U.riya = await K.customer({ name: 'Riya Sharma', email: 'riya.sharma@example.com' });
  U.amit = await K.customer({ name: 'Amit Verma', email: 'amit@example.com' });
  U.neha = await K.customer({ name: 'Neha Gupta', email: 'neha@example.com' });
  U.zoya = await K.customer({ name: 'Zoya Khan', email: 'zoya@example.com' });
  P.riyaPro = await K.subscription(U.riya, 'pro', { days: 40, source: 'purchase' });
  P.amitSoon = await K.subscription(U.amit, 'starter', { days: 3 });                  // ends in 3 days, given by staff
  P.amitOld = await K.subscription(U.amit, 'premium', { days: -2 });                 // over, not yet marked by the nightly job
  P.nehaLife = await K.subscription(U.neha, 'lifetime', { days: null, source: 'purchase' });
  P.zoyaGone = await K.subscription(U.zoya, 'pro', { days: 30, status: 'revoked' });
  P.zoyaDone = await K.subscription(U.zoya, 'starter', { days: -40, status: 'expired', source: 'promo' });
  await K.run("UPDATE user_subscriptions SET order_id = NULL, created_at = ?2 WHERE id = ?1", P.zoyaDone, inDays(-70));
});
after(() => { S.srv.server.close(); });

const subs = async (c, query = '') => { const r = await c('GET', '/api/console/subscriptions' + (query ? '?' + query : '')); assert.equal(r.status, 200, r.text); return r.body; };
const ids = (d) => d.items.map((x) => x.id);
const sub = (id) => K.one('SELECT * FROM user_subscriptions WHERE id = ?1', id);
const reasons = { reason: 'Compensation for the outage on 12 Nov' };

/* ================= subscriptions ================= */
test('plans list: who may see it; states, counts and filters', async () => {
  assert.equal((await K.client()('GET', '/api/console/subscriptions')).status, 401);
  const d = await subs(support);
  assert.equal(d.total, 6);
  assert.deepEqual(d.counts, { active: 3, ending: 1, expired: 2, revoked: 1, extendable: 2 });
  assert.deepEqual(d.packages.map((p) => p.id), ['starter', 'pro', 'premium', 'lifetime']);
  const row = d.items.find((x) => x.id === P.riyaPro);
  assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'customer', 'expiresAt', 'id', 'orderId', 'packageId', 'packageName', 'source', 'startsAt', 'status']);
  assert.deepEqual([row.status, row.packageName, row.source, row.customer.email], ['active', 'Pro', 'purchase', 'riya.sharma@example.com']);
  assert.equal(d.items.find((x) => x.id === P.amitOld).status, 'expired', 'over by date counts as ended');

  assert.deepEqual(ids(await subs(admin, 'state=active')).sort(), [P.riyaPro, P.amitSoon, P.nehaLife].sort());
  assert.deepEqual(ids(await subs(admin, 'state=ending')), [P.amitSoon]);
  assert.deepEqual(ids(await subs(admin, 'state=expired')).sort(), [P.amitOld, P.zoyaDone].sort());
  assert.deepEqual(ids(await subs(admin, 'state=revoked')), [P.zoyaGone]);
  assert.deepEqual(ids(await subs(admin, 'package=lifetime')), [P.nehaLife]);
  assert.deepEqual(ids(await subs(admin, 'source=promo')), [P.zoyaDone]);
  assert.deepEqual(ids(await subs(admin, 'source=admin&state=active')), [P.amitSoon]);
  assert.deepEqual(ids(await subs(admin, 'q=zoya')).sort(), [P.zoyaGone, P.zoyaDone].sort());
  assert.deepEqual(ids(await subs(admin, 'q=' + U.neha)), [P.nehaLife]);
  assert.deepEqual(ids(await subs(admin, 'q=' + P.amitOld)), [P.amitOld]);
  assert.equal((await subs(admin, 'state=nope&source=__proto__')).total, 6, 'unknown values are no filter');

  await K.setPermission('support', 'subscriptions.view', false);
  try { assert.equal((await support('GET', '/api/console/subscriptions')).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'subscriptions.view'"); }
});

test('plans list: the plans ending soon come soonest first', async () => {
  const later = await K.subscription(U.riya, 'starter', { days: 6 });
  try {
    assert.deepEqual(ids(await subs(admin, 'state=ending')), [P.amitSoon, later]);
  } finally { await K.run('DELETE FROM user_subscriptions WHERE id = ?1', later); }
});

test('giving a plan: who may, what is checked, and it starts now', async () => {
  const give = (c, id, body) => c('POST', `/api/console/customers/${id}/subscriptions`, body);
  assert.equal((await give(support, U.zoya, { packageId: 'pro', ...reasons })).status, 403);
  const field = async (body, name) => {
    const r = await give(admin, U.zoya, { ...reasons, ...body });
    assert.equal(r.status, 400, r.text); assert.ok(r.body.error.fields[name], `${name}: ${r.text}`);
  };
  for (const packageId of [undefined, 'free', 'nope', 'PRO', '../pro']) await field({ packageId }, 'packageId');
  for (const days of [0, -1, 4000, 1.5, '30']) await field({ packageId: 'pro', days }, 'days');
  await field({ packageId: 'pro', reason: '' }, 'reason');
  assert.equal((await give(admin, '00000000-0000-0000-0000-000000000000', { packageId: 'pro', ...reasons })).status, 404);

  const before = Date.now();
  let r = await give(admin, U.zoya, { packageId: 'pro', ...reasons });
  assert.equal(r.status, 201, r.text);
  const s = r.body.subscription;
  assert.deepEqual([s.packageId, s.source, s.status, s.orderId], ['pro', 'admin', 'active', null]);
  assert.match(s.expiresAt, ISO);
  const length = Date.parse(s.expiresAt) - Date.parse(s.startsAt);
  assert.equal(length, 90 * DAY, "the package's usual length");
  assert.ok(Date.parse(s.startsAt) >= before - 1000);
  assert.deepEqual(r.body.plan, { id: 'pro', name: 'Pro', expiresAt: s.expiresAt });
  const row = await sub(s.id);
  assert.equal(row.features, (await K.one("SELECT features FROM packages WHERE id = 'pro'")).features, 'what the plan gives is copied in');

  r = await give(owner, U.zoya, { packageId: 'starter', days: 10, ...reasons });
  assert.equal(Date.parse(r.body.subscription.expiresAt) - Date.parse(r.body.subscription.startsAt), 10 * DAY);
  assert.equal(r.body.plan.id, 'pro', 'the higher plan still shows');
  r = await give(owner, U.zoya, { packageId: 'lifetime', ...reasons });
  assert.equal(r.body.subscription.expiresAt, null);
  assert.deepEqual(r.body.plan, { id: 'lifetime', name: 'Lifetime', expiresAt: null });

  const log = (await K.audits('subscription.grant')).filter((a) => a.target === `user:${U.zoya}`);
  assert.equal(log.length, 3);
  assert.deepEqual(JSON.parse(log[0].detail), { subscriptionId: s.id, packageId: 'pro', days: 90, reason: reasons.reason });
  assert.equal(log[0].actor_id, admin.who.id);
  for (const a of log) await K.run('DELETE FROM user_subscriptions WHERE id = ?1', JSON.parse(a.detail).subscriptionId);
});

test('extending a plan: days are added exactly, a renewal queued after it moves too, and the reminder can go again', async () => {
  const cust = await K.customer({ name: 'Extend Customer', email: 'extend@example.com' });
  const end = inDays(20);
  const first = await K.subscription(cust, 'pro', { days: 20, source: 'purchase' });
  await K.run('UPDATE user_subscriptions SET expires_at = ?2, reminded_at = ?3 WHERE id = ?1', first, end, inDays(-1));
  // a renewal bought before the first ended starts when it ends; a plan given by staff overlaps it
  const queued = randomUUID(), overlap = await K.subscription(cust, 'starter', { days: 10 });
  await K.run(`INSERT INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
               SELECT ?1, ?2, 'pro', NULL, 'active', 'purchase', features, limits, ?3, ?4, ?5, ?5 FROM packages WHERE id = 'pro'`, queued, cust, end, inDays(110), inDays(0));
  const extend = (c, id, body) => c('POST', `/api/console/subscriptions/${id}/extend`, body);

  assert.equal((await extend(support, first, { days: 7, ...reasons })).status, 403);
  for (const days of [0, 366, 1.5, '7', null]) {
    const r = await extend(admin, first, { days, ...reasons });
    assert.equal(r.status, 400); assert.ok(r.body.error.fields.days, String(days));
  }
  assert.ok((await extend(admin, first, { days: 7 })).body.error.fields.reason);
  const queuedBefore = await sub(queued);

  const r = await extend(admin, first, { days: 7, ...reasons });
  assert.equal(r.status, 200, r.text);
  const after = await sub(first);
  assert.match(after.expires_at, ISO);
  assert.equal(Date.parse(after.expires_at) - Date.parse(end), 7 * DAY);
  assert.equal(after.reminded_at, null, 'the renewal reminder can be sent again');
  assert.equal(r.body.moved, 1);
  const q = await sub(queued);
  assert.equal(Date.parse(q.starts_at) - Date.parse(queuedBefore.starts_at), 7 * DAY);
  assert.equal(Date.parse(q.expires_at) - Date.parse(queuedBefore.expires_at), 7 * DAY);
  assert.equal(q.starts_at, after.expires_at, 'the renewal still starts when the first plan ends');
  const o = await sub(overlap);
  assert.ok(Date.parse(o.expires_at) < Date.parse(end), 'a plan that overlaps is not moved');
  assert.equal(r.body.plan.expiresAt, q.expires_at, 'the customer now has access 7 days longer');
  const log = (await K.audits('subscription.extend')).find((a) => JSON.parse(a.detail).subscriptionId === first);
  assert.deepEqual(JSON.parse(log.detail), { subscriptionId: first, packageId: 'pro', days: 7, from: end, to: after.expires_at, moved: 1, reason: reasons.reason });

  // what cannot be extended
  for (const [id, code] of [[P.nehaLife, 'no_end_date'], [P.amitOld, 'not_active'], [P.zoyaGone, 'not_active'], [P.zoyaDone, 'not_active']]) {
    const x = await extend(admin, id, { days: 7, ...reasons });
    assert.equal(x.status, 400, id); assert.equal(x.body.error.code, code);
  }
  assert.equal((await extend(admin, 'nope-not-a-plan', { days: 7, ...reasons })).status, 404);
});

test('ending a plan: a reason is required, nothing is refunded, and the customer falls back at once', async () => {
  const cust = await K.customer({ name: 'End Customer', email: 'end@example.com' });
  const pro = await K.subscription(cust, 'pro', { days: 30, source: 'purchase' });
  const order = await K.order(cust, 'pro');
  await K.run('UPDATE user_subscriptions SET order_id = ?2 WHERE id = ?1', pro, order.id);
  const starter = await K.subscription(cust, 'starter', { days: 5 });
  const end = (c, id, body) => c('POST', `/api/console/subscriptions/${id}/revoke`, body);
  assert.equal((await end(support, pro, reasons)).status, 403);
  assert.ok((await end(admin, pro, {})).body.error.fields.reason);

  let r = await end(admin, pro, reasons);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.subscription.status, 'revoked');
  assert.deepEqual([r.body.plan.id, r.body.plan.name], ['starter', 'Starter'], 'the other plan stays');
  assert.equal((await K.one('SELECT status FROM orders WHERE id = ?1', order.id)).status, 'paid', 'nothing is refunded');
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?1', order.id)).n, 0);
  r = await end(admin, pro, reasons);
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'not_active');
  r = await end(owner, starter, reasons);
  assert.equal(r.body.plan.id, 'free');
  assert.equal((await end(admin, P.amitOld, reasons)).body.error.code, 'not_active', 'a plan over by date has already ended');
  const log = (await K.audits('subscription.revoke')).filter((a) => a.target === `user:${cust}`).map((a) => JSON.parse(a.detail));
  assert.deepEqual(log, [{ subscriptionId: pro, packageId: 'pro', bought: true, reason: reasons.reason }, { subscriptionId: starter, packageId: 'starter', bought: false, reason: reasons.reason }]);
});

test('extending every plan: only with its own permission and the password; plans without an end date, and plans that ended, stay', async () => {
  const all = (c, body) => c('POST', '/api/console/subscriptions/extend-all', body);
  assert.equal((await all(admin, { days: 3, ...reasons })).status, 403, 'off for Admin by default');
  await K.stale(owner);
  let r = await all(owner, { days: 3, ...reasons });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);
  for (const days of [0, 31, '3']) assert.ok((await all(owner, { days, ...reasons })).body.error.fields.days);

  const snapshot = async () => new Map((await K.many('SELECT id, status, starts_at, expires_at FROM user_subscriptions')).map((s) => [s.id, s]));
  const was = await snapshot();
  const now = new Date().toISOString();
  const expect = [...was.values()].filter((s) => s.status === 'active' && s.expires_at && s.expires_at > now).map((s) => s.id);
  r = await all(owner, { days: 3, ...reasons });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, plans: expect.length, days: 3 });
  const is = await snapshot();
  for (const [id, s] of was) {
    const n = is.get(id);
    if (expect.includes(id)) {
      assert.equal(Date.parse(n.expires_at) - Date.parse(s.expires_at), 3 * DAY, id);
      if (s.starts_at > now) assert.equal(Date.parse(n.starts_at) - Date.parse(s.starts_at), 3 * DAY, 'a plan that has not started yet starts later too');
      else assert.equal(n.starts_at, s.starts_at);
    } else assert.deepEqual(n, s, `${id} is not changed`);
  }
  assert.equal(is.get(P.nehaLife).expires_at, null);
  r = await all(owner, { days: 3, ...reasons });
  assert.equal(r.status, 429, 'not twice in a minute');
  const log = await K.audits('subscription.extend_all');
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0].detail), { days: 3, plans: expect.length, reason: reasons.reason });
  await K.setPermission('admin', 'subscriptions.bulk', true);
  try {
    await K.run("DELETE FROM rate_limits WHERE key = 'extend-all'");
    assert.equal((await all(admin, { days: 1, ...reasons })).status, 200, 'a Super Admin can give Admin this permission');
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'subscriptions.bulk'"); }
});

test('the customer page carries what the plan dialogs need, only for who may use them', async () => {
  const asAdmin = (await admin('GET', `/api/console/customers/${U.riya}`)).body;
  assert.equal(asAdmin.can.plans, true);
  assert.deepEqual(asAdmin.packages.map((p) => [p.id, p.validityDays, p.onSale]), [['starter', 30, true], ['pro', 90, true], ['premium', 180, true], ['lifetime', null, true]]);
  const asSupport = (await support('GET', `/api/console/customers/${U.riya}`)).body;
  assert.equal(asSupport.can.plans, false); assert.equal(asSupport.packages, null);
  // a renewal queued after the current plan shows as starting later
  const queued = randomUUID();
  await K.run(`INSERT INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
               SELECT ?1, ?2, 'pro', NULL, 'active', 'purchase', features, limits, ?3, ?4, ?5, ?5 FROM packages WHERE id = 'pro'`, queued, U.riya, inDays(40), inDays(130), inDays(0));
  const d = (await admin('GET', `/api/console/customers/${U.riya}`)).body;
  assert.equal(d.subscriptions.find((s) => s.id === queued).status, 'upcoming');
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', queued);
});

test('subscriptions page: the frame by permission', async () => {
  const page = await admin('GET', '/console/subscriptions');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.match(page.text, /<a class="nav-item is-current" href="\/console\/subscriptions" aria-current="page">/);
  for (const name of ['q', 'state', 'package', 'source']) assert.ok(page.text.includes(`name="${name}"`), name);
  assert.ok(page.text.includes('/site/console/plan-actions.js?v=') && page.text.includes('/site/console/subscriptions.js?v='));
  assert.ok(!page.text.includes('id="extendAllBtn"'), 'only with subscriptions.bulk');
  assert.ok((await owner('GET', '/console/subscriptions')).text.includes('id="extendAllBtn"'));
  assert.ok((await admin('GET', `/console/customers/${U.riya}`)).text.includes('/site/console/plan-actions.js?v='));
  for (const f of ['plan-actions.js', 'subscriptions.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), f);
  }
});

/* ================= learning access (§9) ================= */

const addAccess = (c, id, body) => c('POST', `/api/console/customers/${id}/access`, body);
const why = { reason: 'Asked for the numbers lessons for a job test' };
const ent = (id) => entitlementsFor(S.env, id);

test('learning access: who may add one, and what is checked', async () => {
  const cust = await K.customer({ name: 'Access Customer', email: 'access@example.com' });
  assert.equal((await addAccess(support, cust, { kind: 'lesson', target: 'l12', effect: 'allow', ...why })).status, 403, 'Support may look, not change');
  const field = async (body, name) => {
    const r = await addAccess(admin, cust, { kind: 'lesson', target: 'l12', effect: 'allow', ...why, ...body });
    assert.equal(r.status, 400, r.text); assert.ok(r.body.error.fields[name], `${name}: ${r.text}`);
  };
  for (const kind of [undefined, 'pack', 'LESSON']) await field({ kind }, 'kind');
  for (const target of ['placement', 'review', 'custom', 'l999', 'storm', '', undefined]) await field({ target }, 'target');
  for (const target of ['daily', 'pacman', 'l12']) await field({ kind: 'game', target }, 'target');
  for (const effect of [undefined, 'open', 'ALLOW']) await field({ effect }, 'effect');
  for (const days of [0, 366, 1.5, '7']) await field({ days }, 'days');
  await field({ reason: 'x' }, 'reason');
  assert.equal((await addAccess(admin, '00000000-0000-0000-0000-000000000000', { kind: 'lesson', target: 'l12', effect: 'allow', ...why })).status, 404);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM access_overrides WHERE user_id = ?1', cust)).n, 0);
});

test('learning access: opening and closing change what the customer may use at once; a new one replaces the old', async () => {
  const cust = await K.customer({ name: 'Open Customer', email: 'open@example.com' });
  assert.equal(lessonAllowed(await ent(cust), 'l12'), false, 'Free: not lesson 12');
  let r = await addAccess(admin, cust, { kind: 'lesson', target: 'l12', effect: 'allow', ...why });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.access.targetName, r.body.access.effect, r.body.access.state, r.body.access.expiresAt, r.body.access.createdBy, r.body.replaced],
    ['Lesson 29: Number Row: 1–5', 'allow', 'active', null, 'Kavita Ops', 0]);
  let e = await ent(cust);
  assert.deepEqual(e.overrides.lessons, { allow: ['l12'], deny: [] });
  assert.equal(lessonAllowed(e, 'l12'), true); assert.equal(lessonAllowed(e, 'l13'), false, 'only that one lesson');

  // closing it replaces the opening
  r = await addAccess(admin, cust, { kind: 'lesson', target: 'l12', effect: 'deny', days: 10, reason: 'Opened by mistake' });
  assert.equal(r.status, 201); assert.equal(r.body.replaced, 1);
  assert.equal(Date.parse(r.body.access.expiresAt) - Date.parse(r.body.access.createdAt), 10 * DAY);
  e = await ent(cust);
  assert.deepEqual(e.overrides.lessons, { allow: [], deny: ['l12'] });
  const old = await K.one("SELECT ended_at, ended_by FROM access_overrides WHERE user_id = ?1 AND effect = 'allow'", cust);
  assert.ok(old.ended_at); assert.equal(old.ended_by, admin.who.id);

  // closing a game the plan includes
  await K.subscription(cust, 'starter', { days: 30 });
  assert.equal(gameAllowed(await ent(cust), 'storm'), true);
  r = await addAccess(owner, cust, { kind: 'game', target: 'storm', effect: 'deny', reason: 'Asked to hide the games for a child' });
  assert.equal(r.body.access.targetName, 'Word Storm');
  e = await ent(cust);
  assert.equal(gameAllowed(e, 'storm'), false); assert.equal(gameAllowed(e, 'beat'), true); assert.equal(gameAllowed(e, 'daily'), true);
  assert.equal(lessonAllowed(e, 'l12'), false, 'closed wins over a plan that includes it');
  assert.equal(lessonAllowed(e, 'placement'), true);

  // when its days run out, the plan decides again
  await K.run("UPDATE access_overrides SET expires_at = ?2 WHERE user_id = ?1 AND target = 'l12' AND ended_at IS NULL", cust, inDays(-1));
  assert.equal(lessonAllowed(await ent(cust), 'l12'), true, 'Starter includes every lesson again');

  const log = (await K.audits('access.add')).filter((a) => a.target === `user:${cust}`).map((a) => JSON.parse(a.detail));
  assert.equal(log.length, 3);
  assert.deepEqual(Object.keys(log[1]).sort(), ['accessId', 'days', 'effect', 'item', 'kind', 'reason', 'replaced']);
  assert.deepEqual([log[1].item, log[1].effect, log[1].days, log[1].replaced.length], ['l12', 'deny', 10, 1]);
});

test('learning access: ending one, the list, and at most 50 in force', async () => {
  const cust = await K.customer({ name: 'Many Exceptions', email: 'many@example.com' });
  const made = (await addAccess(admin, cust, { kind: 'game', target: 'tug', effect: 'allow', ...why })).body.access;
  const end = (c, id, body = {}) => c('POST', `/api/console/access/${id}/end`, body);
  assert.equal((await end(support, made.id)).status, 403);
  let r = await end(admin, made.id, { reason: 'Customer bought Starter' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.access.state, r.body.access.endedBy], ['ended', 'Kavita Ops']);
  assert.equal(gameAllowed(await ent(cust), 'tug'), false);
  assert.equal((await end(admin, made.id)).body.error.code, 'not_active');
  assert.equal((await end(admin, 'nope-nope')).status, 404);
  assert.deepEqual(JSON.parse((await K.audits('access.end')).find((a) => a.target === `user:${cust}`).detail),
    { accessId: made.id, kind: 'game', item: 'tug', effect: 'allow', reason: 'Customer bought Starter' });

  // the list
  const list = async (query) => (await support('GET', '/api/console/access?' + query)).body;
  let d = await list('q=many@example.com');
  assert.deepEqual(d.items.map((a) => [a.target, a.state]), [['tug', 'ended']]);
  assert.deepEqual(d.items[0].customer, { id: cust, fullName: 'Many Exceptions', email: 'many@example.com' });
  assert.equal((await list('q=many@example.com&state=active')).total, 0);
  assert.equal((await list('q=many@example.com&state=ended')).total, 1);
  assert.equal((await list('kind=game&effect=deny')).items.every((a) => a.kind === 'game' && a.effect === 'deny'), true);
  await K.setPermission('support', 'access.view', false);
  try { assert.equal((await support('GET', '/api/console/access')).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'access.view'"); }

  // 50 in force at most; replacing one of them is still fine
  const lessons = globalThis.TC_META.ORDER.slice(0, 50);
  for (const id of lessons) {
    await K.run(`INSERT INTO access_overrides (id, user_id, kind, target, effect, reason, created_by, created_at) VALUES (?1, ?2, 'lesson', ?3, 'allow', 'bulk', ?4, ?5)`,
      randomUUID(), cust, id, admin.who.id, inDays(0));
  }
  r = await addAccess(admin, cust, { kind: 'lesson', target: 'l78', effect: 'allow', ...why });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'too_many');
  r = await addAccess(admin, cust, { kind: 'lesson', target: lessons[0], effect: 'deny', ...why });
  assert.equal(r.status, 201); assert.equal(r.body.replaced, 1);
});

test('learning access on the customer page; the list page frame', async () => {
  const cust = await K.customer({ name: 'Page Customer', email: 'page-access@example.com' });
  await addAccess(admin, cust, { kind: 'lesson', target: 'l70', effect: 'allow', ...why });
  const d = (await admin('GET', `/api/console/customers/${cust}`)).body;
  assert.equal(d.can.access, true);
  assert.deepEqual(d.access.map((a) => [a.target, a.state]), [['l70', 'active']]);
  assert.equal(d.accessTargets.lesson.length, 78); assert.equal(d.accessTargets.game.length, 8);
  assert.deepEqual(d.accessTargets.game.map((g) => g.id), ['storm', 'beat', 'tug', 'ghost', 'pop', 'tower', 'safe', 'boss']);
  assert.equal(d.accessTargets.lesson[0].name, 'Lesson 1: Meet the keyboard');
  const s = (await support('GET', `/api/console/customers/${cust}`)).body;
  assert.equal(s.can.access, false); assert.equal(s.accessTargets, null); assert.equal(s.access.length, 1);
  const frame = await admin('GET', `/console/customers/${cust}`);
  assert.ok(frame.text.includes('id="accessBody"') && frame.text.includes('/site/console/access-actions.js?v='));

  const page = await support('GET', '/console/access');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.match(page.text, /<a class="nav-item is-current" href="\/console\/access" aria-current="page">/);
  for (const name of ['q', 'state', 'kind', 'effect']) assert.ok(page.text.includes(`name="${name}"`), name);
  for (const f of ['access-actions.js', 'access.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), f);
  }
});

test('before migration 0006: what a customer may use is worked out as before', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const DB = new D1Shim();
  for (const f of ['0001_accounts.sql', '0002_next.sql', '0003_saas.sql', '0004_billing_archive.sql', '0005_admin_console.sql']) DB.db.exec(readFileSync(path.join(root, 'migrations', f), 'utf8'));
  const e = await entitlementsFor({ DB }, 'someone');
  assert.equal(e.plan, 'free');
  assert.deepEqual(e.overrides, { lessons: { allow: [], deny: [] }, games: { allow: [], deny: [] } });
  assert.equal(lessonAllowed(e, 'l25'), true); assert.equal(lessonAllowed(e, 'l12'), false);
});

/* ================= packages (§10) ================= */
const pkgBody = (over = {}) => ({ id: 'pro-yearly', name: 'Pro yearly', description: 'A year of Pro.', pricePaise: 149900, validityDays: 365,
  features: ['lessons.all', 'arcade.all', 'tests.basic'], limits: { lessons: 'all', dailyTests: null, historyDays: null }, displayOrder: 6, ...over });

test('packages: the list with customers and 30-day sales; money only with revenue.view', async () => {
  assert.equal((await K.client()('GET', '/api/console/packages')).status, 401);
  const buyer = await K.customer({ name: 'Package Buyer', email: 'pkg-buyer@example.com' });
  await K.order(buyer, 'premium', { amountPaise: 39900 });
  await K.order(buyer, 'premium', { amountPaise: 39900, createdAt: inDays(-40) });            // older than 30 days
  const asAdmin = (await admin('GET', '/api/console/packages')).body;
  assert.deepEqual(asAdmin.items.map((p) => p.id), ['free', 'starter', 'pro', 'premium', 'lifetime']);
  assert.equal(asAdmin.features.length, 13);
  const premium = asAdmin.items.find((p) => p.id === 'premium');
  assert.deepEqual(premium.sales30, { orders: 1, grossPaise: 39900 });
  assert.equal(premium.featureLabels.length, premium.features.length);
  const free = asAdmin.items.find((p) => p.id === 'free');
  assert.equal(free.sales30, null);
  const users = (await K.one('SELECT COUNT(*) AS n FROM users')).n;
  const paying = (await K.one("SELECT COUNT(DISTINCT user_id) AS n FROM user_subscriptions WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?1)", new Date().toISOString())).n;
  assert.equal(free.customers, users - paying, 'everyone without a paid plan is on Free');
  const asSupport = (await support('GET', '/api/console/packages')).body;
  assert.deepEqual(asSupport.items.find((p) => p.id === 'premium').sales30, { orders: 1, grossPaise: null }, 'Support sees counts, not money');
  const one = await support('GET', '/api/console/packages/premium');
  assert.equal(one.status, 200); assert.equal(one.body.history, null, 'no audit.view');
  assert.equal((await admin('GET', '/api/console/packages/premium')).body.history.length, 0);
  assert.equal((await admin('GET', '/api/console/packages/nope')).status, 404);
});

test('packages: creating one; everything is checked, and it starts off sale', async () => {
  const create = (c, over) => c('POST', '/api/console/packages', pkgBody(over));
  assert.equal((await create(support)).status, 403);
  const field = async (over, name) => { const r = await create(admin, over); assert.equal(r.status, 400, r.text); assert.ok(r.body.error.fields[name], `${name}: ${r.text}`); };
  for (const id of ['Pro', '1pro', 'new', 'free', 'p', 'pro', 'a'.repeat(32), 'pro yearly']) await field({ id }, 'id');
  await field({ name: ' ' }, 'name');
  await field({ pricePaise: 50 }, 'pricePaise');
  await field({ pricePaise: 199.5 }, 'pricePaise');
  await field({ validityDays: 0 }, 'validityDays');
  await field({ features: ['lessons.all', 'flying'] }, 'features');
  await field({ features: ['lessons.all', 'lessons.all'] }, 'features');
  await field({ limits: { lessons: 'some' } }, 'limits');
  await field({ displayOrder: -1 }, 'displayOrder');

  const r = await create(admin);
  assert.equal(r.status, 201, r.text);
  const p = r.body.package;
  assert.deepEqual([p.id, p.name, p.pricePaise, p.validityDays, p.active, p.highlight, p.customers], ['pro-yearly', 'Pro yearly', 149900, 365, false, false, 0]);
  assert.ok(!(await K.client()('GET', '/api/packages')).body.packages.some((x) => x.id === 'pro-yearly'), 'off sale: not on the plans page');
  const log = (await K.audits('package.create')).find((a) => a.target === 'package:pro-yearly');
  assert.equal(log.actor_id, admin.who.id); assert.equal(JSON.parse(log.detail).to.pricePaise, 149900);
  assert.equal((await create(admin)).body.error.fields.id, 'A package with this ID already exists.');
});

test('packages: changing one; a big price change needs confirming; one recommended; Free keeps its rules', async () => {
  const put = (c, id, body) => c('PUT', `/api/console/packages/${id}`, body);
  assert.equal((await put(support, 'pro-yearly', { name: 'X' })).status, 403);
  let r = await put(admin, 'pro-yearly', { name: 'Pro yearly' });
  assert.deepEqual([r.status, r.body.changed], [200, []], 'nothing changed');

  // more than half: confirm first
  r = await put(admin, 'pro-yearly', { pricePaise: 49900 });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'confirm_price');
  assert.equal((await K.one("SELECT price_paise FROM packages WHERE id = 'pro-yearly'")).price_paise, 149900, 'nothing saved yet');
  r = await put(admin, 'pro-yearly', { pricePaise: 49900, confirmPriceChange: true });
  assert.deepEqual([r.status, r.body.changed, r.body.package.pricePaise], [200, ['pricePaise'], 49900]);
  r = await put(admin, 'pro-yearly', { pricePaise: 59900 });
  assert.equal(r.status, 200, 'a smaller change needs no confirming');

  // putting it on sale as the recommended plan takes the highlight off Pro
  assert.equal((await K.one("SELECT highlight FROM packages WHERE id = 'pro'")).highlight, 1);
  r = await put(owner, 'pro-yearly', { active: true, highlight: true });
  assert.deepEqual(r.body.changed.sort(), ['active', 'highlight']);
  assert.deepEqual((await K.many('SELECT id FROM packages WHERE highlight = 1')).map((x) => x.id), ['pro-yearly']);
  const onSale = (await K.client()('GET', '/api/packages')).body.packages;
  assert.ok(onSale.find((x) => x.id === 'pro-yearly').highlight);
  const log = (await K.audits('package.update')).filter((a) => a.target === 'package:pro-yearly').map((a) => JSON.parse(a.detail));
  assert.deepEqual(log[0], { changed: ['pricePaise'], pricePaise: { from: 149900, to: 49900 } });

  // Free: always ₹0, no end date, on
  for (const [body, name] of [[{ pricePaise: 100 }, 'pricePaise'], [{ validityDays: 30 }, 'validityDays'], [{ active: false }, 'active']]) {
    r = await put(admin, 'free', body);
    assert.equal(r.status, 400); assert.ok(r.body.error.fields[name], name);
  }
  // what Free includes applies to every free customer at once; a bought plan keeps what it was sold with
  const freeCust = await K.customer({ name: 'Free Customer', email: 'free-cust@example.com' });
  const proCust = await K.customer({ name: 'Pro Customer', email: 'pro-cust@example.com' });
  await K.subscription(proCust, 'pro', { days: 30, source: 'purchase' });
  assert.ok(!(await ent(freeCust)).features.includes('history.full'));
  const freeNow = (await admin('GET', '/api/console/packages/free')).body.package;
  r = await put(admin, 'free', { features: [...freeNow.features, 'history.full'] });
  assert.equal(r.status, 200);
  assert.ok((await ent(freeCust)).features.includes('history.full'), 'Free changed for free customers at once');
  const proNow = (await admin('GET', '/api/console/packages/pro')).body.package;
  r = await put(admin, 'pro', { features: proNow.features.filter((f) => f !== 'practice.custom') });
  assert.equal(r.status, 200);
  assert.ok((await ent(proCust)).features.includes('practice.custom'), 'a customer who bought Pro keeps what it gave them');
  await put(admin, 'free', { features: freeNow.features });
  await put(admin, 'pro', { features: proNow.features, highlight: true });
  assert.deepEqual((await K.many('SELECT id FROM packages WHERE highlight = 1')).map((x) => x.id), ['pro']);
  assert.equal((await admin('GET', '/api/console/packages/pro-yearly')).body.history.length, 4, 'created and changed three times');
  const last = (await K.audits('package.update')).filter((a) => a.target === 'package:pro').pop();
  assert.deepEqual(JSON.parse(last.detail).highlightTakenFrom, ['pro-yearly'], 'taking the highlight off another package is recorded');
});

test('packages: the current admin uses the same rules', async () => {
  const learner = await K.account({ role: 'admin', name: 'Old Admin', email: 'old-admin@example.com' });
  // the current admin works with the normal sign-in (the learner session of an Admin)
  let r = await learner.learner('PUT', '/api/admin/packages/free', { pricePaise: 100 });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.pricePaise);
  r = await learner.learner('PUT', '/api/admin/packages/starter', { highlight: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual((await K.many('SELECT id FROM packages WHERE highlight = 1')).map((x) => x.id), ['starter'], 'one recommended there too');
  await learner.learner('PUT', '/api/admin/packages/pro', { highlight: true });
});

test('packages pages: frames by permission; Support may look, not change', async () => {
  const list = await support('GET', '/console/packages');
  assert.equal(list.status, 200);
  assertNoInlineCode(list.text);
  assert.match(list.text, /<a class="nav-item is-current" href="\/console\/packages" aria-current="page">/);
  assert.ok(!list.text.includes('href="/console/packages/new"'), 'no New package for Support');
  assert.ok((await admin('GET', '/console/packages')).text.includes('href="/console/packages/new"'));
  assert.equal((await support('GET', '/console/packages/new')).status, 403);
  const fresh = await admin('GET', '/console/packages/new');
  assert.equal(fresh.status, 200); assertNoInlineCode(fresh.text);
  assert.ok(fresh.text.includes('id="f-id"') && fresh.text.includes('Create package'));
  const boot = JSON.parse(fresh.text.match(/<script type="application\/json" id="console-boot">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(boot.page.params, {}, '/packages/new is the new-package page, not a package called new');
  const one = await support('GET', '/console/packages/pro');
  assert.equal(one.status, 200);
  assert.ok(one.text.includes('data-readonly') && !one.text.includes('id="pkgSave"') && !one.text.includes('id="f-id"'));
  assert.ok((await admin('GET', '/console/packages/pro')).text.includes('id="pkgSave"'));
  for (const f of ['packages.js', 'package.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), f);
  }
});

test('Admin and Support do not change their own plans or access; a Super Admin may, to try things out', async () => {
  const self = admin.who.id;
  let r = await admin('POST', `/api/console/customers/${self}/subscriptions`, { packageId: 'premium', ...reasons });
  assert.equal(r.status, 403); assert.match(r.body.error.message, /your own account/);
  r = await admin('POST', `/api/console/customers/${self}/access`, { kind: 'game', target: 'storm', effect: 'allow', ...why });
  assert.equal(r.status, 403);
  // a plan someone else gave this admin cannot be extended or ended by the admin either
  const given = (await owner('POST', `/api/console/customers/${self}/subscriptions`, { packageId: 'starter', ...reasons })).body.subscription;
  assert.equal((await admin('POST', `/api/console/subscriptions/${given.id}/extend`, { days: 30, ...reasons })).status, 403);
  assert.equal((await admin('POST', `/api/console/subscriptions/${given.id}/revoke`, reasons)).status, 403);
  const page = (await admin('GET', `/api/console/customers/${self}`)).body;
  assert.deepEqual([page.can.plans, page.can.access], [false, false], 'and the buttons are not offered');
  assert.match(page.can.manageBlock, /only a Super Admin can change it, its plan or its access/, 'and the page says why');
  // Support (no customers.manage) who was allowed to change plans is told too
  await K.setPermission('support', 'subscriptions.manage', true);
  assert.match((await support('GET', `/api/console/customers/${support.who.id}`)).body.can.manageBlock, /your own account/);
  r = await support('POST', `/api/console/customers/${support.who.id}/subscriptions`, { packageId: 'premium', ...reasons });
  assert.equal(r.status, 403); assert.match(r.body.error.message, /your own account/);
  await K.setPermission('support', 'subscriptions.manage', false);
  assert.equal((await support('GET', `/api/console/customers/${support.who.id}`)).body.can.manageBlock, null);
  // the owner may, on their own account
  r = await owner('POST', `/api/console/customers/${owner.who.id}/subscriptions`, { packageId: 'starter', days: 1, reason: 'Trying the paid plan' });
  assert.equal(r.status, 201);
  assert.equal((await owner('POST', `/api/console/subscriptions/${given.id}/revoke`, reasons)).status, 200);
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', r.body.subscription.id);
});
