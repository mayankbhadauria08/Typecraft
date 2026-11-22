// Admin console, phase 2 (core operations): docs/ADMIN-PHASE-2.md.
// Step 1: customers (list, profile, disable/restore, sign out everywhere, notes, download).
//   node --test tests/console-core.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeEnv, startServer } from './server.mjs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { kit, OWNER, pw, assertNoInlineCode } from './console-kit.mjs';
import { istDay, like, Binder, csvResponse, istDayStart, istDayEnd, istStamp, reasonOf } from '../src/console/lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let S, K, owner, admin, support, P = {};
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8794) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S);
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));

  // five customers with a story each, then 25 more to fill a second page
  P.riya = await K.customer({ name: 'Riya Sharma', email: 'riya.sharma@example.com', phone: '+91 98111 22333', createdAt: iso(0), lastLoginAt: iso(10 * MIN) });
  P.amit = await K.customer({ name: 'Amit Verma', email: 'amit@example.com', phone: '+91 99222 33444', verified: 0, createdAt: iso(3 * DAY) });
  P.neha = await K.customer({ name: 'Neha Gupta', email: 'neha_g@example.com', phone: '98333-44555', status: 'disabled', createdAt: iso(10 * DAY) });
  P.zoya = await K.customer({ name: 'Zoya Khan', email: 'zoya@example.com', phone: '(022) 4000 1234', createdAt: iso(40 * DAY) });
  P.formula = await K.customer({ name: '=HYPERLINK("http://x.example","y")', email: 'formula@example.com', createdAt: iso(41 * DAY) });
  for (let i = 1; i <= 25; i++) await K.customer({ name: `Bulk User ${String(i).padStart(2, '0')}`, email: `bulk${i}@example.com`, createdAt: iso(50 * DAY + i * MIN) });
  await K.subscription(P.riya, 'pro', { days: 30, source: 'purchase' });
  await K.subscription(P.amit, 'starter', { days: 12 });
  await K.subscription(P.amit, 'premium', { days: -2 });            // over, though the nightly job has not marked it yet
  await K.subscription(P.neha, 'lifetime', { days: null });
  await K.subscription(P.zoya, 'pro', { days: 30, status: 'revoked' });
});
after(() => { S.srv.server.close(); });

const list = async (c, query = '') => { const r = await c('GET', '/api/console/customers' + (query ? '?' + query : '')); assert.equal(r.status, 200, r.text); return r.body; };
const ids = (data) => data.items.map((x) => x.id);

/* ---------------- helpers in src/console/lib.js ---------------- */
test('lib: search patterns, India days, reasons and spreadsheet cells', async () => {
  assert.equal(like('50%_off\\'), '%50\\%\\_off\\\\%');
  const b = new Binder();
  assert.equal(b.p('a'), '?1'); assert.equal(b.once('now', 'n'), '?2'); assert.equal(b.once('now', 'x'), '?2'); assert.equal(b.p('c'), '?3');
  assert.deepEqual(b.args, ['a', 'n', 'c']);
  // India is UTC+5:30: its day starts at 18:30 UTC of the day before
  assert.equal(istDayStart('2026-11-18'), '2026-11-17T18:30:00.000Z');
  assert.equal(istDayEnd('2026-11-18'), '2026-11-18T18:30:00.000Z');
  assert.equal(istDay(Date.parse('2026-11-17T18:29:59Z')), '2026-11-17');
  assert.equal(istDay(Date.parse('2026-11-17T18:30:00Z')), '2026-11-18');
  assert.equal(istStamp('2026-11-18T16:45:10.000Z'), '2026-11-18 22:15');
  assert.equal(reasonOf({ reason: '  charged   twice ' }), 'charged twice');
  assert.equal(reasonOf({}, { required: false }), null);
  for (const bad of [{}, { reason: 'ab' }, { reason: 'x'.repeat(301) }, { reason: 7 }]) assert.throws(() => reasonOf(bad), (e) => e.status === 400 && !!e.fields.reason);

  const res = csvResponse('typecraft-test 2026/11.csv', ['Name', 'Note'], [['Riya "R" Sharma', 'line\nbreak'], ['=SUM(A1)', '+91 98'], ['-1', '@x'], [null, 12]]);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="typecraft-test202611.csv"');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a byte-order mark so Excel reads the rupee sign and names correctly');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  assert.deepEqual(text.slice(1).split('\r\n'), ['"Name","Note"', '"Riya ""R"" Sharma","line\nbreak"', '"\'=SUM(A1)","\'+91 98"', '"\'-1","\'@x"', '"","12"', '']);
});

/* ---------------- the list ---------------- */
test('customers list: a console session with customers.view is needed', async () => {
  const anon = await K.client()('GET', '/api/console/customers');
  assert.equal(anon.status, 401); assert.equal(anon.body.error.code, 'admin_sign_in');
  // signed in to the site, even as the owner, is not signed in to the console
  assert.equal((await (await K.owner()).learner('GET', '/api/console/customers')).status, 401);
  for (const c of [owner, admin, support]) assert.equal((await c('GET', '/api/console/customers')).status, 200);
  await K.setPermission('support', 'customers.view', false);
  try {
    const r = await support('GET', '/api/console/customers');
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'forbidden');
    assert.equal((await support('GET', `/api/console/customers/${P.riya}`)).status, 403);
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'customers.view'"); }
});

test('customers list: 25 a page, newest first, and only what the page shows', async () => {
  const total = (await K.one('SELECT COUNT(*) AS n FROM users')).n;
  assert.equal(total, 33);
  const p1 = await list(support);
  assert.deepEqual({ page: p1.page, pageSize: p1.pageSize, pages: p1.pages, total: p1.total }, { page: 1, pageSize: 25, pages: 2, total: 33 });
  assert.equal(p1.items.length, 25);
  const p2 = await list(support, 'page=2');
  assert.equal(p2.items.length, 8);
  assert.equal(new Set([...ids(p1), ...ids(p2)]).size, 33, 'no customer is on both pages or on neither');
  assert.equal((await list(support, 'page=99')).items.length, 0);
  assert.deepEqual(p1.packages.map((p) => p.id), ['starter', 'pro', 'premium', 'lifetime'], 'the paid plans, for the Plan filter');

  const riya = p1.items.find((x) => x.id === P.riya);
  assert.deepEqual(Object.keys(riya).sort(), ['createdAt', 'email', 'emailVerified', 'fullName', 'id', 'lastLoginAt', 'phone', 'plan', 'role', 'status']);
  assert.deepEqual({ fullName: riya.fullName, email: riya.email, phone: riya.phone, emailVerified: riya.emailVerified, status: riya.status, role: riya.role },
    { fullName: 'Riya Sharma', email: 'riya.sharma@example.com', phone: '+91 98111 22333', emailVerified: true, status: 'active', role: null });
  assert.equal(riya.plan.id, 'pro'); assert.equal(riya.plan.name, 'Pro'); assert.ok(Date.parse(riya.plan.expiresAt) > Date.now());
  // staff are accounts too, and are marked
  const all = [...p1.items, ...p2.items];
  assert.deepEqual(all.filter((x) => x.role).map((x) => x.role).sort(), ['admin', 'owner', 'support']);
  const raw = JSON.stringify([p1, p2]);
  assert.ok(!/not-a-real-hash|password|pbkdf2/i.test(raw), 'no password data');
});

test('customers list: search by name, email, phone or ID; % and _ are ordinary characters', async () => {
  const find = async (q) => ids(await list(support, 'q=' + encodeURIComponent(q)));
  assert.deepEqual(await find('riya'), [P.riya]);
  assert.deepEqual(await find('  RIYA shar '), [P.riya]);
  assert.deepEqual(await find('amit@exam'), [P.amit]);
  assert.deepEqual(await find('98111 22333'), [P.riya]);
  assert.deepEqual(await find('+91 98111'), [P.riya]);
  assert.deepEqual(await find('9833344555'), [P.neha], 'stored with a dash, found by digits');
  assert.deepEqual(await find('022 4000'), [P.zoya]);
  assert.deepEqual(await find(P.zoya), [P.zoya]);
  assert.deepEqual(await find('%'), []);
  assert.deepEqual(await find('_'), [P.neha], 'only the email that really has an underscore');
  assert.deepEqual(await find("x' OR '1'='1"), []);
  assert.equal((await list(support, 'q=bulk')).total, 25);
  assert.equal((await list(support, 'q=' + 'a'.repeat(500))).total, 0, 'a very long search is cut, not an error');
});

test('customers list: filters by plan, account, email and joining date; order', async () => {
  const total = (await K.one('SELECT COUNT(*) AS n FROM users')).n;
  assert.deepEqual(ids(await list(support, 'plan=paid&sort=name')), [P.amit, P.neha, P.riya]);
  assert.deepEqual(ids(await list(support, 'plan=starter')), [P.amit]);
  assert.deepEqual(ids(await list(support, 'plan=pro')), [P.riya], 'a plan ended by staff does not count');
  assert.deepEqual(ids(await list(support, 'plan=premium')), [], 'a plan past its end date does not count');
  assert.deepEqual(ids(await list(support, 'plan=lifetime')), [P.neha]);
  const free = await list(support, 'plan=free');
  assert.equal(free.total, total - 3);
  assert.equal((await list(support, 'plan=free&q=zoya')).items[0].plan, null);
  // Amit has two plan rows; the list shows the one that is running
  const amit = (await list(support, 'q=amit')).items[0];
  assert.equal(amit.plan.id, 'starter');
  assert.equal((await list(support, 'q=neha')).items[0].plan.expiresAt, null, 'lifetime has no end date');

  assert.deepEqual(ids(await list(support, 'status=disabled')), [P.neha]);
  assert.equal((await list(support, 'status=active')).total, total - 1);
  const unverified = await list(support, 'verified=0');
  assert.ok(ids(unverified).includes(P.amit) && !ids(unverified).includes(P.riya));
  assert.ok(unverified.items.every((x) => x.emailVerified === false));
  assert.equal(unverified.total + (await list(support, 'verified=1')).total, total);

  const today = ids(await list(support, 'joined=today'));
  assert.ok(today.includes(P.riya) && !today.includes(P.amit));
  const week = ids(await list(support, 'joined=7d'));
  assert.ok(week.includes(P.amit) && !week.includes(P.neha));
  const month = ids(await list(support, 'joined=30d'));
  assert.ok(month.includes(P.neha) && !month.includes(P.zoya));
  assert.deepEqual(ids(await list(support, 'joined=30d&status=disabled&plan=lifetime&verified=1&q=gupta')), [P.neha], 'filters combine');

  // anything that is not a known value is ignored, never passed on
  for (const junk of ['status=zzz', 'verified=maybe', 'joined=1999', 'sort=password_hash', "plan=x'); DROP TABLE users;--", 'page=-5', 'page=abc']) {
    assert.equal((await list(support, junk)).total, total, junk);
  }
  const names = (await list(support, 'sort=name')).items.map((x) => x.fullName.toLowerCase());
  assert.deepEqual(names, [...names].sort());
  assert.equal((await list(support, 'sort=oldest')).items[0].fullName, 'Bulk User 25');
  const byLogin = (await list(support, 'sort=login')).items.map((x) => x.lastLoginAt);
  assert.ok(byLogin.indexOf(null) === -1 || byLogin.slice(byLogin.indexOf(null)).every((x) => x === null), 'people who never signed in come last');
});

/* ---------------- one customer ---------------- */
test('customer profile: plan, payments, progress, devices; each section only with its permission', async () => {
  const now = new Date().toISOString();
  await K.run(`INSERT INTO orders (id, user_id, package_id, amount_paise, currency, status, razorpay_order_id, paid_at, created_at, updated_at)
               VALUES ('ord_test_1', ?1, 'pro', 19900, 'INR', 'paid', 'order_RZP1', ?2, ?2, ?2)`, P.riya, now);
  await K.run(`INSERT INTO invoices (id, number, seq, order_id, user_id, amount_paise, currency, billed_name, billed_email, seller, lines, issued_at)
               VALUES ('inv1', 'TC-2026-0001', 1, 'ord_test_1', ?1, 19900, 'INR', 'Riya Sharma', 'riya.sharma@example.com', '{}', '[]', ?2)`, P.riya, now);
  await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, crown, best_wpm, best_accuracy, attempts, last_played) VALUES
               (?1, 'l25', 'completed', 3, 1, 22.4, 99, 2, ?2), (?1, 'l1', 'completed', 2, 0, 31.4, 94, 5, ?3), (?1, 'l2', 'in_progress', 0, 0, 12, 70, 1, ?2)`, P.riya, iso(2 * DAY), iso(HOUR));
  await K.run("INSERT INTO user_totals (user_id, rev, xp, streak_count, streak_best) VALUES (?1, 'r1', 950, 4, 9)", P.riya);
  await K.run(`INSERT INTO typing_tests (id, user_id, duration, wpm, accuracy, day, created_at) VALUES ('t1', ?1, 60, 38.2, 96, ?2, ?3), ('t2', ?1, 60, 44.4, 97, ?2, ?3)`, P.riya, istDay(), now);
  await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, active) VALUES (?1, ?2, 600, 4, 1), (?1, ?3, 95, 1, 1)', P.riya, istDay(), istDay(Date.now() - 3 * DAY));
  await K.run("INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 1, 14.6, 97, 120, ?2)", P.riya, now);
  await K.run("INSERT INTO placement (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 2, 19.5, 93.4, 120, ?2)", P.riya, now);
  await K.run(`INSERT INTO email_logs (id, user_id, to_email, template, category, subject, payload, status, created_at, updated_at)
               VALUES ('em1', ?1, 'riya.sharma@example.com', 'payment_receipt', 'billing', 'Your TypeCraft receipt', '{"secret":"do-not-show"}', 'sent', ?2, ?2)`, P.riya, now);
  await K.run("INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES ('au1', ?1, 'subscription.grant', ?2, ?3, '10.0.0.1', ?4)",
    owner.who.id, `user:${P.riya}`, JSON.stringify({ packageId: 'pro', reason: 'Goodwill after an outage' }), now);

  const r = await owner('GET', `/api/console/customers/${P.riya}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body;
  assert.deepEqual({ id: d.customer.id, fullName: d.customer.fullName, email: d.customer.email, phone: d.customer.phone, status: d.customer.status, role: d.customer.role, roleLabel: d.customer.roleLabel },
    { id: P.riya, fullName: 'Riya Sharma', email: 'riya.sharma@example.com', phone: '+91 98111 22333', status: 'active', role: null, roleLabel: null });
  assert.equal(d.plan.id, 'pro'); assert.equal(d.plan.name, 'Pro');
  assert.deepEqual(d.subscriptions.map((s) => [s.packageId, s.packageName, s.status, s.source]), [['pro', 'Pro', 'active', 'purchase']]);
  assert.deepEqual(d.orders, [{ id: 'ord_test_1', packageName: 'Pro', amountPaise: 19900, currency: 'INR', status: 'paid', createdAt: now, paidAt: now, invoiceNumber: 'TC-2026-0001' }]);
  const p = d.progress;
  assert.deepEqual({ lessonsDone: p.lessonsDone, lessonsTotal: p.lessonsTotal, stars: p.stars, crowns: p.crowns, bestLessonWpm: p.bestLessonWpm, xp: p.xp, rank: p.rank, streak: p.streak, bestStreak: p.bestStreak, tests: p.tests, bestTestWpm: p.bestTestWpm },
    { lessonsDone: 2, lessonsTotal: 78, stars: 5, crowns: 1, bestLessonWpm: 31, xp: 950, rank: 'Clerk', streak: 4, bestStreak: 9, tests: 2, bestTestWpm: 44 });
  assert.equal(p.days.length, 14);
  assert.deepEqual(p.days[13], { day: istDay(), minutes: 10 });
  assert.equal(p.days[10].minutes, 2); assert.equal(p.days[12].minutes, 0, 'days without practice are there, as zero');
  assert.deepEqual(p.placement.level, 2); assert.deepEqual(p.certificates.map((c) => [c.level, c.wpm]), [[1, 15]]);
  assert.deepEqual(d.emails, [{ template: 'payment_receipt', subject: 'Your TypeCraft receipt', status: 'sent', createdAt: now }]);
  assert.deepEqual(d.activity, [{ action: 'subscription.grant', reason: 'Goodwill after an outage', actor: 'Mayank Owner', createdAt: now }]);
  assert.deepEqual(d.sessions, { active: 0, lastSeenAt: null });
  assert.deepEqual(d.can, { manage: true, manageBlock: null, notes: true, plans: true, access: true });
  assert.ok(!/do-not-show|not-a-real-hash|10\.0\.0\.1/.test(r.text), 'no email contents, password data or staff addresses');

  // Amit: the plan past its end date is shown as ended
  const a = (await owner('GET', `/api/console/customers/${P.amit}`)).body;
  assert.deepEqual(a.subscriptions.map((s) => [s.packageId, s.status]).sort(), [['premium', 'expired'], ['starter', 'active']]);
  assert.equal(a.plan.id, 'starter');
  assert.deepEqual(a.orders, []); assert.equal(a.progress.lessonsDone, 0); assert.equal(a.progress.rank, 'Apprentice');

  // Support sees payments and emails, not the staff activity; and nothing of payments once that is switched off
  const s = (await support('GET', `/api/console/customers/${P.riya}`)).body;
  assert.equal(s.orders.length, 1); assert.equal(s.emails.length, 1); assert.equal(s.activity, null);
  assert.deepEqual(s.can, { manage: false, manageBlock: null, notes: true, plans: false, access: false });
  await K.setPermission('support', 'payments.view', false);
  try { assert.equal((await support('GET', `/api/console/customers/${P.riya}`)).body.orders, null); }
  finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.view'"); }

  // a real account that has signed in: an open session is counted, its id is not sent
  const real = await K.account({ name: 'Signed In' });
  const sid = (await K.one('SELECT id FROM sessions WHERE user_id = ?1', real.id)).id;
  const live = await owner('GET', `/api/console/customers/${real.id}`);
  assert.equal(live.body.sessions.active, 1); assert.ok(Date.parse(live.body.sessions.lastSeenAt) > Date.now() - MIN);
  assert.ok(!live.text.includes(sid));

  for (const bad of ['nope', '0000', 'a'.repeat(65), '../users']) assert.equal((await owner('GET', '/api/console/customers/' + encodeURIComponent(bad))).status, 404, bad);
});

test('who may change which account: not yourself, never a Super Admin, staff only by a Super Admin', async () => {
  // only the account rules here; plans and learning access have their own tests
  const can = async (c, id) => { const x = (await c('GET', `/api/console/customers/${id}`)).body.can; delete x.plans; delete x.access; return x; };
  assert.deepEqual(await can(admin, P.riya), { manage: true, manageBlock: null, notes: true });
  assert.deepEqual(await can(admin, support.who.id), { manage: false, manageBlock: 'Only a Super Admin can change another staff account.', notes: true });
  assert.deepEqual(await can(owner, support.who.id), { manage: true, manageBlock: null, notes: true });
  assert.deepEqual(await can(admin, owner.who.id), { manage: false, manageBlock: 'A Super Admin account cannot be changed here.', notes: true });
  assert.deepEqual(await can(owner, owner.who.id), { manage: false, manageBlock: "You can't disable your own account or sign it out everywhere here.", notes: true });
  assert.equal((await owner('GET', `/api/console/customers/${admin.who.id}`)).body.customer.roleLabel, 'Admin');

  const off = (c, id) => c('POST', `/api/console/customers/${id}/status`, { status: 'disabled', reason: 'testing the rules' });
  for (const [c, id] of [[admin, support.who.id], [admin, owner.who.id], [owner, owner.who.id], [admin, admin.who.id]]) {
    const r = await off(c, id);
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'forbidden');
    assert.equal((await c('POST', `/api/console/customers/${id}/sign-out`, {})).status, 403);
  }
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM users WHERE account_status = 'disabled' AND id IN (?1, ?2, ?3)", support.who.id, owner.who.id, admin.who.id)).n, 0);
});

test('disable and restore: a reason is required, the customer is signed out at once, and it is recorded', async () => {
  const victim = await K.account({ name: 'Vikram Rao' });
  const url = `/api/console/customers/${victim.id}/status`;
  const signedIn = async (c) => !!(await c('GET', '/api/auth/me')).body.user;
  assert.equal(await signedIn(victim.learner), true);

  const refused = await support('POST', url, { status: 'disabled', reason: 'spam account' });
  assert.equal(refused.status, 403); assert.equal(refused.body.error.code, 'forbidden');
  for (const [body, field] of [[{ status: 'disabled' }, 'reason'], [{ status: 'disabled', reason: 'no' }, 'reason'], [{ status: 'gone', reason: 'a good reason' }, 'status'], [{ reason: 'a good reason' }, 'status']]) {
    const r = await admin('POST', url, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(r.body.error.fields[field]);
  }
  assert.equal(await signedIn(victim.learner), true, 'nothing happened yet');

  const done = await admin('POST', url, { status: 'disabled', reason: '  Chargeback   fraud, order ord_9 ' });
  assert.equal(done.status, 200); assert.deepEqual({ status: done.body.status, changed: done.body.changed }, { status: 'disabled', changed: true });
  assert.equal(await signedIn(victim.learner), false, 'signed out everywhere');
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1', victim.id)).n, 0);
  assert.equal((await victim.learner('POST', '/api/auth/login', { email: victim.email, password: pw })).status >= 400, true, 'and cannot sign back in');
  assert.equal((await owner('GET', `/api/console/customers/${victim.id}`)).body.customer.status, 'disabled');

  const again = await admin('POST', url, { status: 'disabled', reason: 'second click' });
  assert.equal(again.body.changed, false);
  const back = await admin('POST', url, { status: 'active', reason: 'Customer proved the payment was theirs' });
  assert.equal(back.body.changed, true);
  assert.equal((await victim.learner('POST', '/api/auth/login', { email: victim.email, password: pw })).status, 200);

  const trail = (await K.many("SELECT action, actor_id, detail, ip FROM audit_logs WHERE target = ?1 AND action IN ('user.disable', 'user.enable') ORDER BY created_at, rowid", `user:${victim.id}`));
  assert.deepEqual(trail.map((a) => [a.action, a.actor_id, JSON.parse(a.detail).reason]), [
    ['user.disable', admin.who.id, 'Chargeback fraud, order ord_9'], ['user.enable', admin.who.id, 'Customer proved the payment was theirs'],
  ], 'one entry per real change, with who and why');
  assert.equal(trail[0].ip, admin.ip);
  const shown = (await owner('GET', `/api/console/customers/${victim.id}`)).body.activity;
  assert.deepEqual(shown.map((a) => [a.action, a.actor]).sort(), [['user.disable', 'Kavita Ops'], ['user.enable', 'Kavita Ops']]);

  // disabling a staff member (Super Admin only) also ends their console session
  const helper = await K.consoleLogin(await K.account({ role: 'support', name: 'Temp Helper' }));
  assert.equal((await helper('GET', '/api/console/customers')).status, 200);
  assert.equal((await owner('POST', `/api/console/customers/${helper.who.id}/status`, { status: 'disabled', reason: 'left the team' })).status, 200);
  assert.equal((await helper('GET', '/api/console/customers')).status, 401);
  assert.equal((await K.one('SELECT ended_reason FROM admin_sessions WHERE user_id = ?1', helper.who.id)).ended_reason, 'account_disabled');
});

test('sign out everywhere: ends every site session of the customer, leaves the password alone', async () => {
  const who = await K.account({ name: 'Two Devices' });
  const second = K.client();
  assert.equal((await second('POST', '/api/auth/login', { email: who.email, password: pw })).status, 200);
  assert.equal((await support('POST', `/api/console/customers/${who.id}/sign-out`, {})).status, 403);
  const r = await admin('POST', `/api/console/customers/${who.id}/sign-out`, {});
  assert.equal(r.status, 200); assert.equal(r.body.ended, 2);
  assert.equal((await who.learner('GET', '/api/auth/me')).body.user, null);
  assert.equal((await second('GET', '/api/auth/me')).body.user, null);
  assert.equal((await admin('POST', `/api/console/customers/${who.id}/sign-out`, {})).body.ended, 0);
  assert.equal((await second('POST', '/api/auth/login', { email: who.email, password: pw })).status, 200, 'the same password still works');
  const trail = await K.many("SELECT detail FROM audit_logs WHERE action = 'user.sign_out' AND target = ?1 ORDER BY created_at, rowid", `user:${who.id}`);
  assert.deepEqual(trail.map((a) => JSON.parse(a.detail)), [{ sessions: 2 }, { sessions: 0 }]);
  assert.equal((await admin('POST', '/api/console/customers/nobody/sign-out', {})).status, 404);
});

test('notes: staff write them, only the author or a Super Admin deletes them, the log never holds the text', async () => {
  const url = `/api/console/customers/${P.zoya}/notes`;
  for (const body of [{}, { body: '   ' }, { body: 42 }, { body: 'x'.repeat(2001) }]) {
    const r = await support('POST', url, body);
    assert.equal(r.status, 400); assert.ok(r.body.error.fields.body);
  }
  const first = await support('POST', url, { body: '  Asked for a GST invoice.\r\nSent it by email. <b>not html</b>  ' });
  assert.equal(first.status, 201);
  assert.deepEqual(first.body.notes.map((n) => [n.body, n.author, n.canDelete]), [['Asked for a GST invoice.\nSent it by email. <b>not html</b>', 'Rahul Help', true]]);
  await new Promise((r) => setTimeout(r, 5));
  const second = await admin('POST', url, { body: 'x'.repeat(2000) });
  assert.equal(second.status, 201);
  assert.deepEqual(second.body.notes.map((n) => [n.author, n.canDelete]), [['Kavita Ops', true], ['Rahul Help', false]], 'newest first; you can delete only your own');
  const [adminNote, supportNote] = second.body.notes;

  const seen = (await owner('GET', `/api/console/customers/${P.zoya}`)).body.notes;
  assert.deepEqual(seen.map((n) => n.canDelete), [true, true], 'a Super Admin can delete any note');
  assert.equal((await support('DELETE', `/api/console/notes/${adminNote.id}`, {})).status, 403);
  assert.equal((await K.client()('DELETE', `/api/console/notes/${adminNote.id}`, {})).status, 401);
  const gone = await support('DELETE', `/api/console/notes/${supportNote.id}`, {});
  assert.equal(gone.status, 200); assert.deepEqual(gone.body.notes.map((n) => n.id), [adminNote.id]);
  assert.equal((await support('DELETE', `/api/console/notes/${supportNote.id}`, {})).status, 404);
  assert.equal((await owner('DELETE', `/api/console/notes/${adminNote.id}`, {})).status, 200);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM customer_notes WHERE user_id = ?1', P.zoya)).n, 0);

  const trail = await K.many("SELECT action, actor_id, detail FROM audit_logs WHERE target = ?1 AND action LIKE 'user.note%' ORDER BY created_at, rowid", `user:${P.zoya}`);
  assert.deepEqual(trail.map((a) => [a.action, a.actor_id]), [['user.note_add', support.who.id], ['user.note_add', admin.who.id], ['user.note_delete', support.who.id], ['user.note_delete', owner.who.id]]);
  assert.ok(!JSON.stringify(trail).includes('GST'), 'the note itself is not copied into the log');

  // without the permission; and the limit per customer
  await K.setPermission('support', 'customers.notes', false);
  try {
    assert.equal((await support('POST', url, { body: 'hello' })).status, 403);
    assert.equal((await support('GET', `/api/console/customers/${P.zoya}`)).body.can.notes, false);
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'customers.notes'"); }
  for (let i = 0; i < 200; i++) await K.run("INSERT INTO customer_notes (id, user_id, body, created_by, created_at) VALUES (?1, ?2, 'filler', NULL, ?3)", `fill-${i}`, P.formula, iso(i * 1000));
  const full = await admin('POST', `/api/console/customers/${P.formula}/notes`, { body: 'one too many' });
  assert.equal(full.status, 400); assert.equal(full.body.error.code, 'too_many_notes');
  const orphan = (await owner('GET', `/api/console/customers/${P.formula}`)).body.notes[0];
  assert.equal(orphan.author, 'Deleted account'); assert.equal(orphan.canDelete, true);
  await K.run('DELETE FROM customer_notes WHERE user_id = ?1', P.formula);
});

test('download: only with the permission and a fresh password check; cells are made safe; it is recorded', async () => {
  assert.equal((await support('GET', '/api/console/customers/export.csv')).status, 403);
  await K.stale(admin);
  const stale = await admin('GET', '/api/console/customers/export.csv');
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await admin('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);

  const all = await admin('GET', '/api/console/customers/export.csv?sort=oldest&page=3');
  assert.equal(all.status, 200);
  assert.equal(all.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(all.headers.get('content-disposition'), /^attachment; filename="typecraft-customers-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(all.headers.get('cache-control'), 'no-store');
  const rows = all.text.replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(rows[0], '"Name","Email","Phone","Email verified","Account","Plan","Plan ends (India time)","Joined (India time)","Last sign-in (India time)"');
  assert.equal(rows.length - 1, (await K.one('SELECT COUNT(*) AS n FROM users')).n, 'every customer, whatever the page');
  assert.ok(rows[1].startsWith('"Bulk User 25"'), 'in the order asked for');
  const line = (email) => rows.find((r) => r.includes(`"${email}"`));
  assert.match(line('riya.sharma@example.com'), /^"Riya Sharma","riya\.sharma@example\.com","'\+91 98111 22333","Yes","Active","Pro","\d{4}-\d{2}-\d{2} \d{2}:\d{2}","\d{4}-\d{2}-\d{2} \d{2}:\d{2}","\d{4}-\d{2}-\d{2} \d{2}:\d{2}"$/);
  assert.match(line('neha_g@example.com'), /^"Neha Gupta","neha_g@example\.com","98333-44555","Yes","Disabled","Lifetime","","/);
  assert.ok(line('formula@example.com').startsWith('"\'=HYPERLINK(""http://x.example"",""y"")",'), 'a name that looks like a formula is defused');
  assert.ok(!/not-a-real-hash/.test(all.text));

  const some = await admin('GET', '/api/console/customers/export.csv?plan=paid&q=sharma');
  assert.equal(some.text.replace(/^﻿/, '').trimEnd().split('\r\n').length - 1, 1, 'the same filters as the list');

  const trail = await K.audits('customers.export');
  assert.deepEqual(trail.map((a) => [a.actor_id, a.target]), [[admin.who.id, 'customers'], [admin.who.id, 'customers']]);
  assert.deepEqual(JSON.parse(trail[1].detail), { rows: 1, cutOff: false, filters: { q: '(search text)', plan: 'paid' } }, 'what was searched for is not copied into the log');
});

/* ---------------- pages ---------------- */
test('customer pages: frames by permission, the sidebar shows where you are, strict headers', async () => {
  const anon = await K.client()('GET', '/admin/customers?plan=paid');
  assert.equal(anon.status, 302); assert.equal(anon.headers.get('location'), S.base + '/admin/login?next=%2Fadmin%2Fcustomers%3Fplan%3Dpaid');

  const page = await admin('GET', '/admin/customers');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.ok(page.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(page.text, /<a class="nav-item is-current" href="\/admin\/customers" aria-current="page">/);
  for (const name of ['q', 'plan', 'status', 'verified', 'joined', 'sort']) assert.ok(page.text.includes(`name="${name}"`), name);
  assert.ok(page.text.includes('id="exportBtn"') && page.text.includes('/site/console/customers.js?v='));
  assert.ok(!(await support('GET', '/admin/customers')).text.includes('id="exportBtn"'), 'no download button without the permission');
  assert.ok(!/Riya Sharma|riya\.sharma/.test(page.text), 'the frame carries no customer data; the script asks for it');

  const profile = await owner('GET', `/admin/customers/${P.riya}`);
  assert.equal(profile.status, 200);
  assertNoInlineCode(profile.text);
  assert.match(profile.text, /<a class="nav-item is-current" href="\/admin\/customers" aria-current="page">/);
  assert.match(profile.text, /<a class="crumb" href="\/admin\/customers">Customers<\/a>/);
  for (const id of ['planBody', 'ordersBody', 'progressBody', 'noteForm', 'notesBody', 'emailsBody', 'activityBody', 'accountBody', 'devicesBody']) assert.ok(profile.text.includes(`id="${id}"`), id);
  const boot = JSON.parse(profile.text.match(/<script type="application\/json" id="console-boot">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(boot.page, { key: 'customers', title: 'Customer', params: { id: P.riya } });
  const asSupport = (await support('GET', `/admin/customers/${P.riya}`)).text;
  assert.ok(asSupport.includes('id="ordersBody"') && asSupport.includes('id="noteForm"') && !asSupport.includes('id="activityBody"'));

  // Home: since the cutover (Phase 6) no "being built" notice; the menu offers only what the role may open
  const home = (await owner('GET', '/admin')).text;
  assert.ok(!/being built in phases|current admin/.test(home));
  assert.ok(home.includes('href="/admin/customers"') && home.includes('href="/admin/roles"'));
  const supportHome = (await support('GET', '/admin')).text;
  assert.ok(supportHome.includes('href="/admin/customers"'));
  assert.ok(!supportHome.includes('href="/admin/roles"'), 'Support may not open Roles, so it is not offered');

  assert.equal((await owner('GET', '/admin/customers/a/b')).status, 404);
  assert.equal((await owner('GET', '/admin/customers/' + 'x'.repeat(70))).status, 404);
  assert.equal((await owner('GET', `/admin/customers/${P.riya}/`)).headers.get('location'), `${S.base}/admin/customers/${P.riya}`);
  await K.setPermission('support', 'customers.view', false);
  try {
    assert.equal((await support('GET', '/admin/customers')).status, 403);
    assert.equal((await support('GET', `/admin/customers/${P.riya}`)).status, 403);
    assert.ok(!(await support('GET', '/admin')).text.includes('href="/admin/customers"'), 'and no link in the sidebar');
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'customers.view'"); }
  for (const f of ['customers.js', 'customer.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), `${f}: data is placed as text only`);
  }
});

/* ---------------- database ---------------- */
test('before migration 0006: the list works, the parts that need new tables say they are not switched on', async () => {
  const DB = new D1Shim();
  for (const f of ['0001_accounts.sql', '0002_next.sql', '0003_saas.sql', '0004_billing_archive.sql', '0005_admin_console.sql']) DB.db.exec(readFileSync(path.join(root, 'migrations', f), 'utf8'));
  const env = { ...makeEnv({ OWNER_EMAILS: OWNER }), DB };
  let cookies = '';
  const call = async (method, p, body) => {
    const headers = { Origin: 'http://localhost:8795', 'CF-Connecting-IP': '10.61.0.1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies) headers.Cookie = cookies;
    const res = await worker.fetch(new Request('http://localhost:8795' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='));
    if (set.length) cookies = [...new Set([...cookies.split('; ').filter(Boolean), ...set])].join('; ');
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, body: json };
  };
  const me = await call('POST', '/api/auth/signup', { fullName: 'Mayank Owner', email: OWNER, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(me.status, 201);
  assert.equal((await call('POST', '/api/admin/auth/login', { email: OWNER, password: pw })).status, 200);
  assert.equal((await call('GET', '/api/console/customers')).body.total, 1);
  assert.equal((await call('GET', '/admin/customers')).status, 200);
  for (const [method, p, body] of [['GET', `/api/console/customers/${me.body.user.id}`], ['POST', `/api/console/customers/${me.body.user.id}/notes`, { body: 'hello' }], ['DELETE', '/api/console/notes/abc', {}]]) {
    const r = await call(method, p, body);
    assert.equal(r.status, 503, `${method} ${p}`); assert.equal(r.body.error.code, 'console_not_ready');
    assert.ok(r.body.error.message.includes('database update 0006'));
  }
  // the site itself does not notice
  assert.equal((await call('GET', '/api/auth/me')).status, 200);
  assert.equal((await call('GET', '/')).status, 200);
});

test('migration 0006 only adds: every statement is CREATE … IF NOT EXISTS, and a second run keeps every row', async () => {
  const file = readFileSync(path.join(root, 'migrations', '0006_admin_core.sql'), 'utf8');
  const statements = file.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
  assert.ok(statements.length >= 8);
  for (const st of statements) assert.match(st, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  const before = await K.one('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM audit_logs) AS audits, (SELECT COUNT(*) FROM user_subscriptions) AS subs');
  await K.run("INSERT INTO customer_notes (id, user_id, body, created_by, created_at) VALUES ('keep-me', ?1, 'kept', NULL, '2026-01-01T00:00:00.000Z')", P.amit);
  S.env.DB.db.exec(file);
  assert.deepEqual(await K.one('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM audit_logs) AS audits, (SELECT COUNT(*) FROM user_subscriptions) AS subs'), before);
  assert.equal((await K.one("SELECT body FROM customer_notes WHERE id = 'keep-me'")).body, 'kept');
  // a customer's notes go with the account
  await K.run('DELETE FROM users WHERE id = ?1', P.amit);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM customer_notes WHERE id = 'keep-me'")).n, 0);
});
