// Admin console, phase 2: the dashboard (docs/ADMIN-PHASE-2.md §11) and the search box (§12).
//   node --test tests/console-overview.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import { istDay, istDayStart } from '../src/console/lib.js';

const MIN = 60000, DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

let S, K, owner, admin, support;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8799) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.63.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
});
after(() => { S.srv.server.close(); });

const dash = async (c, range) => { const r = await c('GET', '/api/console/dashboard' + (range ? '?range=' + range : '')); assert.equal(r.status, 200, r.text); return r.body; };

/* ================= dashboard ================= */
test('dashboard: who may see it; money only with revenue.view; the period and the one before it', async () => {
  assert.equal((await K.client()('GET', '/api/console/dashboard')).status, 401);
  const d = await dash(support);
  assert.equal(d.range, '7d', 'last 7 days unless asked');
  assert.equal(d.money, null, 'Support has no revenue.view');
  assert.ok(d.chart.every((x) => x.netPaise === null));
  assert.equal(d.to, istDay()); assert.equal(d.from, istDay(Date.now() - 6 * DAY));
  assert.deepEqual(d.previous, { from: istDay(Date.now() - 13 * DAY), to: istDay(Date.now() - 7 * DAY) });
  assert.ok((await dash(admin)).money, 'Admin has revenue.view');
  assert.equal((await dash(admin, 'nonsense')).range, '7d');
  for (const [range, n] of [['today', 7], ['7d', 7], ['30d', 30]]) {
    const x = await dash(admin, range);
    assert.equal(x.chart.length, n, range);
    assert.equal(x.chart[n - 1].day, istDay(), 'the chart ends today');
    assert.equal(x.chart[0].day, istDay(Date.now() - (n - 1) * DAY));
  }
  await K.setPermission('support', 'dashboard.view', false);
  try { assert.equal((await support('GET', '/api/console/dashboard')).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'dashboard.view'"); }
});

test('dashboard: every figure comes from the tables, counted by India days', async () => {
  const before0 = await dash(owner, 'today');
  const start = Date.parse(istDayStart(istDay()));
  // a customer who joined one minute into today in India, and one a minute before it (yesterday)
  const a = await K.customer({ name: 'Today Customer', email: 'today@example.com', createdAt: iso(start + MIN) });
  const b = await K.customer({ name: 'Yesterday Customer', email: 'yesterday@example.com', createdAt: iso(start - MIN) });
  // practice today and yesterday
  await K.run("INSERT INTO daily_totals (user_id, day, seconds, runs, active) VALUES (?1, ?2, 300, 2, 1), (?3, ?4, 120, 1, 1)", a, istDay(), b, istDay(Date.now() - DAY));
  // payments: two paid today, one yesterday, one failed today, one not paid yet today
  await K.order(a, 'pro', { amountPaise: 19900, createdAt: iso(start + 2 * MIN) });
  const paidToo = await K.order(a, 'starter', { amountPaise: 9900, createdAt: iso(start + 3 * MIN) });
  await K.order(b, 'premium', { amountPaise: 39900, createdAt: iso(start - 5 * MIN) });
  await K.order(a, 'pro', { status: 'failed', createdAt: iso(start + 4 * MIN) });
  await K.order(a, 'pro', { status: 'created', createdAt: iso(Math.max(start + 5 * MIN, Date.now() - MIN)) });
  await K.refundRow(paidToo, { amountPaise: 5000, createdAt: iso(start + 6 * MIN) });
  // plans: one ends in 3 days
  await K.subscription(a, 'pro', { days: 3 });
  await K.subscription(b, 'lifetime', { days: null });

  const d = await dash(owner, 'today');
  const diff = (f) => f(d) - f(before0);
  assert.equal(diff((x) => x.customers.new.now), 1);
  assert.equal(diff((x) => x.customers.new.before), 1, 'a minute before midnight in India is yesterday');
  assert.equal(diff((x) => x.customers.total), 2);
  assert.equal(diff((x) => x.customers.learners.now), 1);
  assert.equal(diff((x) => x.customers.learners.before), 1);
  assert.equal(diff((x) => x.payments.paid.now), 2);
  assert.equal(diff((x) => x.payments.paid.before), 1);
  assert.equal(diff((x) => x.payments.failed.now), 1);
  assert.equal(diff((x) => x.payments.waiting), 1);
  assert.equal(diff((x) => x.money.gross.now), 29800);
  assert.equal(diff((x) => x.money.gross.before), 39900);
  assert.equal(diff((x) => x.money.refunds.now), 5000);
  assert.equal(diff((x) => x.money.net.now), 24800);
  assert.equal(diff((x) => x.plans.paying), 2);
  assert.equal(diff((x) => x.plans.endingIn7Days), 1);
  assert.equal(d.plans.byPackage.find((p) => p.id === 'lifetime').customers - before0.plans.byPackage.find((p) => p.id === 'lifetime').customers, 1);
  const todayBar = d.chart[d.chart.length - 1], was = before0.chart[before0.chart.length - 1];
  assert.deepEqual([todayBar.signups - was.signups, todayBar.paid - was.paid, todayBar.netPaise - was.netPaise], [1, 2, 24800]);
  const yesterdayBar = d.chart[d.chart.length - 2], wasY = before0.chart[before0.chart.length - 2];
  assert.deepEqual([yesterdayBar.signups - wasY.signups, yesterdayBar.netPaise - wasY.netPaise], [1, 39900]);
});

test('dashboard: what needs attention, only what the role may open, each with where to look', async () => {
  const cust = await K.customer({ name: 'Attention Customer', email: 'attention@example.com' });
  const stuck = await K.order(cust, 'pro', { status: 'pending', createdAt: iso(Date.now() - 40 * MIN) });
  await K.order(cust, 'pro', { status: 'pending', createdAt: iso(Date.now() - 5 * MIN) });          // too new to worry about
  const paid = await K.order(cust, 'premium', { amountPaise: 39900 });
  await K.refundRow(paid, { amountPaise: 1000, status: 'pending' });
  await K.refundRow(paid, { amountPaise: 2000, status: 'failed' });
  const now = new Date().toISOString();
  await K.run(`INSERT INTO email_logs (id, user_id, to_email, template, category, subject, status, last_error, created_at, updated_at)
               VALUES (?1, ?2, 'attention@example.com', 'welcome', 'transactional', 'Welcome', 'failed', 'provider said no', ?3, ?3),
                      (?4, ?2, 'attention@example.com', 'welcome', 'transactional', 'Welcome', 'failed', 'not_configured', ?3, ?3)`, randomUUID(), cust, now, randomUUID());
  await K.run(`INSERT INTO contact_messages (id, name, email, topic, message, status, created_at) VALUES (?1, 'Asha', 'asha@example.com', 'billing', 'Where is my invoice?', 'new', ?2)`, randomUUID(), now);

  const items = (await dash(admin)).attention;
  const find = (text) => items.find((a) => a.text.includes(text));
  assert.deepEqual(find('still not confirmed'), { count: 1, text: 'payment started over 15 minutes ago and still not confirmed', href: '/admin/payments?status=pending' });
  assert.equal(find('on its way').count, 1); assert.equal(find('on its way').href, '/admin/refunds?status=pending');
  assert.equal(find('refund that failed').count, 1);
  assert.equal(find('email that failed').count, 1, 'an email that failed only because sending is off is counted under services, not here');
  assert.deepEqual([find('new message').count, find('new message').href], [1, '/admin/support?status=new']);
  assert.equal(find('email that failed').href, '/admin/email-log?status=failed');
  const services = find('services not set up');
  assert.ok(services && /sending email/.test(services.text), 'Admin has settings.view');
  assert.ok(!(await dash(support)).attention.some((a) => a.text.includes('services')), 'Support does not');
  await K.setPermission('support', 'refunds.view', false);
  try { assert.ok(!(await dash(support)).attention.some((a) => a.href.includes('/refunds')), 'nothing the role may not open'); }
  finally { await K.run("DELETE FROM role_permissions WHERE permission = 'refunds.view'"); }
  assert.ok(stuck.id);
});

test('dashboard page: the frame by permission', async () => {
  const page = await support('GET', '/admin/dashboard');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.match(page.text, /<a class="nav-item is-current" href="\/admin\/dashboard" aria-current="page">/);
  assert.ok(page.text.includes('/site/console/charts.js?v=') && page.text.includes('/site/console/dashboard.js?v='));
  assert.ok(page.text.includes('Payments per day') && !page.text.includes('Money in per day'), 'no money headings without revenue.view');
  assert.ok((await admin('GET', '/admin/dashboard')).text.includes('Money in per day, after refunds'));
  for (const f of ['charts.js', 'dashboard.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), f);
  }
});

/* ================= the search box ================= */
const find = async (c, q) => { const r = await c('GET', '/api/console/search?q=' + encodeURIComponent(q)); assert.equal(r.status, 200, r.text); return r.body; };

test('search: customers by name, email, phone or ID; payments by the start of an ID or invoice number', async () => {
  assert.equal((await K.client()('GET', '/api/console/search?q=riya')).status, 401);
  const riya = await K.customer({ name: 'Riya Search', email: 'riya.search@example.com', phone: '+91 98111 77777', lastLoginAt: new Date().toISOString() });
  const other = await K.customer({ name: 'Another Riya', email: 'another@example.com' });
  await K.subscription(riya, 'pro', { days: 30 });
  const order = await K.order(riya, 'pro', { invoice: true });

  let d = await find(admin, 'riya');
  assert.deepEqual(d.customers.map((c) => c.id).sort(), [riya, other].sort());
  assert.deepEqual(d.customers.find((c) => c.id === riya), { id: riya, fullName: 'Riya Search', email: 'riya.search@example.com', plan: 'Pro', disabled: false });
  assert.deepEqual(d.payments, [], 'no order ID starts with riya');
  assert.deepEqual((await find(admin, 'riya.search@example.com')).customers.map((c) => c.id), [riya]);
  assert.deepEqual((await find(admin, '98111 77777')).customers.map((c) => c.id), [riya]);
  assert.deepEqual((await find(admin, riya)).customers.map((c) => c.id), [riya]);
  assert.deepEqual((await find(admin, '%')).customers, null, 'too short');
  assert.deepEqual((await find(admin, '%%')).customers, [], '% is an ordinary character');

  d = await find(admin, order.id.slice(0, 12));
  assert.deepEqual(d.payments.map((p) => p.id), [order.id]);
  assert.deepEqual(Object.keys(d.payments[0]).sort(), ['amountPaise', 'createdAt', 'currency', 'customer', 'id', 'invoiceNumber', 'packageName', 'status']);
  for (const q of [order.razorpayOrderId, order.razorpayPaymentId.slice(0, 10), order.invoiceNumber, order.invoiceNumber.toLowerCase()]) {
    assert.deepEqual((await find(admin, q)).payments.map((p) => p.id), [order.id], q);
  }
  assert.deepEqual((await find(admin, 'ord_zzzz')).payments, []);
  assert.equal((await find(admin, 'x'.repeat(81))).customers, null, 'more than 80 characters is not searched');
});

test('search: each part only with its permission; 60 a minute; the text is never logged', async () => {
  await K.setPermission('support', 'customers.view', false);
  await K.setPermission('support', 'payments.view', false);
  try {
    const d = await find(support, 'riya');
    assert.deepEqual([d.customers, d.payments], [null, null]);
  } finally { await K.run("DELETE FROM role_permissions WHERE permission IN ('customers.view', 'payments.view')"); }
  assert.ok((await find(support, 'riya')).customers.length >= 1);

  const before = (await K.one('SELECT COUNT(*) AS n FROM audit_logs')).n;
  await K.run('DELETE FROM rate_limits WHERE key = ?1', `search:${support.who.id}`);
  for (let i = 0; i < 60; i++) assert.equal((await support('GET', '/api/console/search?q=ri' + i)).status, 200, String(i));
  const r = await support('GET', '/api/console/search?q=riya');
  assert.equal(r.status, 429, 'the 61st in a minute');
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM audit_logs')).n, before, 'searches are not logged');
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM audit_logs WHERE detail LIKE '%riya%'")).n, 0);
  await K.run('DELETE FROM rate_limits WHERE key = ?1', `search:${support.who.id}`);
});

test('the search box is on every console page, above Home', async () => {
  for (const p of ['/admin', '/admin/customers', '/admin/dashboard']) {
    const page = await support('GET', p);
    assert.equal(page.status, 200);
    assertNoInlineCode(page.text);
    const box = page.text.indexOf('id="consoleSearch"'), home = page.text.indexOf('class="nav-list nav-top"');
    assert.ok(box > 0 && box < home, `${p}: above Home`);
    assert.ok(page.text.includes('role="combobox"') && page.text.includes('aria-controls="consoleSearchList"') && page.text.includes('role="listbox"'));
  }
});
