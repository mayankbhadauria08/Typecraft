// Admin console, phase 2: payments and refunds (docs/ADMIN-PHASE-2.md §6 and §7).
// Razorpay is the fake in ./fake-razorpay.mjs: nothing here touches the network.
//   node --test tests/console-payments.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import { fakeRazorpay } from './fake-razorpay.mjs';

const KEY_ID = 'rzp_test_console', KEY_SECRET = 'console-key-secret';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let S, K, fake, owner, admin, support, P = {}, O = {};
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET });
  fake = fakeRazorpay({ keyId: KEY_ID, keySecret: KEY_SECRET });
  fake.install();
  S = { env, srv: await startServer(env, 8795) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.61.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));

  P.riya = await K.customer({ name: 'Riya Sharma', email: 'riya.sharma@example.com' });
  P.amit = await K.customer({ name: 'Amit Verma', email: 'amit@example.com' });
  P.neha = await K.customer({ name: 'Neha Gupta', email: 'neha_g@example.com', status: 'disabled' });
  P.bulk = await K.customer({ name: '=SUM(A1:A9)', email: 'bulk@example.com' });

  O.paid = await K.order(P.riya, 'pro', { createdAt: iso(2 * DAY), invoice: true });
  O.failed = await K.order(P.riya, 'pro', { status: 'failed', createdAt: iso(2 * DAY + 5 * MIN), failureReason: 'Payment declined by the bank' });
  O.open = await K.order(P.amit, 'starter', { status: 'created', amountPaise: 9900, createdAt: iso(HOUR) });
  O.pending = await K.order(P.amit, 'starter', { status: 'pending', amountPaise: 9900, createdAt: iso(3 * HOUR) });
  O.gone = await K.order(P.neha, 'premium', { status: 'cancelled', amountPaise: 39900, createdAt: iso(20 * DAY) });
  O.back = await K.order(P.neha, 'premium', { status: 'refunded', amountPaise: 39900, createdAt: iso(10 * DAY), invoice: true });
  O.part = await K.order(P.riya, 'starter', { status: 'partially_refunded', amountPaise: 9900, createdAt: iso(30 * DAY) });
  O.night = await K.order(P.amit, 'starter', { amountPaise: 9900, createdAt: '2026-03-10T18:45:00.000Z' });   // 00:15 on 11 March in India
  O.backRefund = await K.refundRow(O.back, { createdAt: iso(9 * DAY) });
  O.partRefund = await K.refundRow(O.part, { amountPaise: 4000, requestedBy: admin.who.id, reason: 'Duplicate payment: charged twice', createdAt: iso(29 * DAY) });
  for (let i = 1; i <= 24; i++) await K.order(P.bulk, 'starter', { amountPaise: 9900, createdAt: iso(60 * DAY + i * MIN) });
  // the plan that O.paid started
  P.riyaPlan = await K.subscription(P.riya, 'pro', { days: 88, source: 'purchase' });
  await K.run('UPDATE user_subscriptions SET order_id = ?2 WHERE id = ?1', P.riyaPlan, O.paid.id);
});
after(() => { S.srv.server.close(); fake.restore(); });

const list = async (c, query = '') => { const r = await c('GET', '/api/console/payments' + (query ? '?' + query : '')); assert.equal(r.status, 200, r.text); return r.body; };
const ids = (data) => data.items.map((x) => x.id);
const unlimit = (orderId) => K.run('DELETE FROM rate_limits WHERE key = ?1', `recheck:${orderId}`);

/* ---------------- the list ---------------- */
test('payments list: a console session with payments.view is needed', async () => {
  assert.equal((await K.client()('GET', '/api/console/payments')).status, 401);
  const learner = (await K.account({ name: 'Only A Learner' })).learner;
  const r = await learner('GET', '/api/console/payments');
  assert.equal(r.status, 401); assert.equal(r.body.error.code, 'admin_sign_in');
  assert.equal((await support('GET', '/api/console/payments')).status, 200);
  await K.setPermission('support', 'payments.view', false);
  try {
    for (const p of ['/api/console/payments', `/api/console/payments/${O.paid.id}`, '/api/console/payments/export.csv']) {
      assert.equal((await support('GET', p)).status, 403, p);
    }
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.view'"); }
});

test('payments list: one row per order, 25 a page, newest first, and only what the page shows', async () => {
  const d = await list(admin);
  assert.equal(d.total, 32); assert.equal(d.pages, 2); assert.equal(d.items.length, 25);
  assert.deepEqual(ids(d).slice(0, 4), [O.open.id, O.pending.id, O.paid.id, O.failed.id]);
  const row = d.items.find((x) => x.id === O.paid.id);
  assert.deepEqual(Object.keys(row).sort(), ['amountPaise', 'createdAt', 'currency', 'customer', 'id', 'invoiceNumber', 'method', 'packageName', 'paidAt', 'refundedPaise', 'status']);
  assert.deepEqual(row.customer, { id: P.riya, fullName: 'Riya Sharma', email: 'riya.sharma@example.com' });
  assert.deepEqual([row.status, row.amountPaise, row.packageName, row.method, row.invoiceNumber, row.refundedPaise], ['paid', 19900, 'Pro', 'upi', O.paid.invoiceNumber, 0]);
  assert.deepEqual(d.packages.map((p) => p.id), ['starter', 'pro', 'premium', 'lifetime']);
  const two = await list(admin, 'page=2');
  assert.equal(two.items.length, 7);
  assert.equal((await list(admin, 'page=99')).page, 99, 'the page asked for is echoed; the browser steps back to the last one');
  const part = (await list(admin, 'status=refunded')).items.find((x) => x.id === O.part.id);
  assert.equal(part.refundedPaise, 4000);
});

test('payments list: search by email, name, or a whole order, payment, refund, invoice or customer ID', async () => {
  assert.deepEqual(ids(await list(admin, 'q=riya.sharma')).sort(), [O.paid.id, O.failed.id, O.part.id].sort());
  assert.deepEqual(ids(await list(admin, 'q=' + encodeURIComponent('neha gupta'))).sort(), [O.gone.id, O.back.id].sort());
  for (const [term, want] of [[O.paid.id, O.paid.id], [O.paid.razorpayOrderId, O.paid.id], [O.failed.razorpayPaymentId, O.failed.id],
    [O.paid.invoiceNumber.toLowerCase(), O.paid.id], [O.backRefund.razorpayRefundId, O.back.id]]) {
    assert.deepEqual(ids(await list(admin, 'q=' + encodeURIComponent(term))), [want], term);
  }
  assert.deepEqual(ids(await list(admin, 'q=' + P.neha)).sort(), [O.gone.id, O.back.id].sort());
  assert.equal((await list(admin, 'q=' + O.paid.id.slice(0, 12))).total, 0, 'half an ID finds nothing: IDs are matched whole');
  assert.equal((await list(admin, 'q=%25')).total, 0, '% is an ordinary character');
  assert.deepEqual(ids(await list(admin, 'q=neha_g')).sort(), [O.gone.id, O.back.id].sort());
  assert.equal((await list(admin, 'q=' + encodeURIComponent("'; DROP TABLE orders;--"))).total, 0);
  assert.equal((await list(admin)).total, 32, 'and the table is still there');
});

test('payments list: filters by status, plan and India days', async () => {
  const total = async (query) => (await list(admin, query)).total;
  assert.equal(await total('status=paid'), 26);
  assert.deepEqual(ids(await list(admin, 'status=pending')), [O.open.id, O.pending.id]);
  assert.deepEqual(ids(await list(admin, 'status=failed')), [O.failed.id]);
  assert.deepEqual(ids(await list(admin, 'status=refunded')), [O.back.id, O.part.id]);
  assert.deepEqual(ids(await list(admin, 'status=cancelled')), [O.gone.id]);
  for (const odd of ['nonsense', 'constructor', '__proto__', 'toString']) assert.equal(await total('status=' + odd), 32, `${odd}: an unknown value is no filter`);
  assert.deepEqual(ids(await list(admin, 'package=premium')), [O.back.id, O.gone.id]);
  assert.deepEqual(ids(await list(admin, 'status=refunded&package=starter')), [O.part.id]);
  // 18:45 UTC on 10 March is 00:15 on 11 March in India
  assert.deepEqual(ids(await list(admin, 'from=2026-03-11&to=2026-03-11')), [O.night.id]);
  assert.equal(await total('from=2026-03-10&to=2026-03-10'), 0);
  assert.equal(await total('to=2026-03-11'), 1);
  assert.equal(await total('from=2026-03-12'), 31);
  assert.equal(await total('from=11-03-2026'), 32, 'a date in another shape is ignored');
});

/* ---------------- one order ---------------- */
test('payment page: the order, its attempts, refunds, invoice and plan; history only with audit.view', async () => {
  const r = await owner('GET', `/api/console/payments/${O.paid.id}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body;
  assert.deepEqual([d.order.id, d.order.status, d.order.amountPaise, d.order.packageName, d.order.razorpayOrderId, d.order.refundedPaise, d.order.failureReason],
    [O.paid.id, 'paid', 19900, 'Pro', O.paid.razorpayOrderId, 0, null]);
  assert.deepEqual(d.customer, { id: P.riya, fullName: 'Riya Sharma', email: 'riya.sharma@example.com', status: 'active' });
  assert.equal(d.attempts.length, 1);
  assert.deepEqual([d.attempts[0].razorpayPaymentId, d.attempts[0].status, d.attempts[0].method, d.attempts[0].refundablePaise, d.attempts[0].error],
    [O.paid.razorpayPaymentId, 'captured', 'upi', 19900, null]);
  assert.equal(d.invoice.number, O.paid.invoiceNumber);
  assert.deepEqual([d.plan.id, d.plan.status, d.plan.source], [P.riyaPlan, 'active', 'purchase']);
  assert.deepEqual(d.refunds, []); assert.deepEqual(d.activity, []);
  assert.deepEqual(d.can, { recheck: false, recheckBlock: null }, 'a paid order has nothing to check');

  const failed = (await owner('GET', `/api/console/payments/${O.failed.id}`)).body;
  assert.equal(failed.order.failureReason, 'Payment declined by the bank');
  assert.equal(failed.attempts[0].error, 'Payment declined by the bank'); assert.equal(failed.attempts[0].refundablePaise, 0);
  assert.equal(failed.plan, null); assert.equal(failed.invoice, null);
  assert.equal(failed.can.recheck, true, 'a failed order can be checked again');

  const part = (await owner('GET', `/api/console/payments/${O.part.id}`)).body;
  assert.equal(part.order.refundedPaise, 4000); assert.equal(part.attempts[0].refundablePaise, 5900);
  assert.deepEqual([part.refunds[0].amountPaise, part.refunds[0].status, part.refunds[0].reason, part.refunds[0].requestedBy],
    [4000, 'processed', 'Duplicate payment: charged twice', 'Kavita Ops']);
  const back = (await owner('GET', `/api/console/payments/${O.back.id}`)).body;
  assert.equal(back.attempts[0].refundablePaise, 0); assert.equal(back.refunds[0].requestedBy, null);
  assert.equal(back.customer.status, 'disabled');

  const asSupport = (await support('GET', `/api/console/payments/${O.open.id}`)).body;
  assert.equal(asSupport.activity, null, 'Support has no audit.view');
  assert.equal(asSupport.can.recheck, true);
  assert.equal(JSON.stringify(asSupport).includes('password'), false);

  for (const bad of ['ord_000000000000000000000000', 'nope', 'x'.repeat(70)]) assert.equal((await owner('GET', `/api/console/payments/${bad}`)).status, 404, bad);
});

/* ---------------- check with Razorpay ---------------- */
test('check with Razorpay: an order becomes paid only when Razorpay reports a captured payment for it', async () => {
  const payer = await K.account({ name: 'Paying Customer', email: 'payer@example.com' });
  const start = await payer.learner('POST', '/api/checkout/order', { packageId: 'pro' });
  assert.equal(start.status, 200, start.text);
  const { orderId, razorpayOrderId } = start.body;
  const check = (c = admin, id = orderId) => c('POST', `/api/console/payments/${id}/recheck`, {});
  const orderNow = async (id = orderId) => (await K.one('SELECT status FROM orders WHERE id = ?1', id)).status;
  const plans = async () => (await K.one("SELECT COUNT(*) AS n FROM user_subscriptions WHERE user_id = ?1 AND status = 'active'", payer.id)).n;

  // who may ask
  assert.equal((await K.client()('POST', `/api/console/payments/${orderId}/recheck`, {})).status, 401);
  await K.setPermission('support', 'payments.recheck', false);
  try { assert.equal((await check(support)).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.recheck'"); }

  // 1. nothing at Razorpay: nothing changes, whoever asks
  let r = await check(support);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, before: 'created', status: 'created', changed: false, outcome: 'waiting', attempts: 0 });
  assert.equal(await orderNow(), 'created'); assert.equal(await plans(), 0);
  // 2. once per order per 30 seconds
  r = await check();
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'rate_limited');
  await unlimit(orderId);
  // 3. Razorpay cannot be reached: an error, and nothing changes
  fake.down = true;
  r = await check();
  fake.down = false;
  assert.equal(r.status, 502); assert.equal(r.body.error.code, 'payment_provider_error');
  assert.equal(await orderNow(), 'created');
  await unlimit(orderId);
  // 4. only a failed attempt at Razorpay: the order is marked failed
  fake.pay(razorpayOrderId, { status: 'failed', error: 'Declined by the bank' });
  r = await check();
  assert.deepEqual([r.status, r.body.outcome, r.body.status, r.body.changed, r.body.attempts], [200, 'failed', 'failed', true, 1]);
  assert.equal(await plans(), 0);
  await unlimit(orderId);
  // 5. a later attempt went through: the failed order becomes paid, with its plan and invoice
  const good = fake.pay(razorpayOrderId);
  r = await check();
  await K.settle();
  assert.deepEqual([r.status, r.body.before, r.body.outcome, r.body.status, r.body.changed, r.body.attempts], [200, 'failed', 'paid', 'paid', true, 2]);
  assert.equal(await plans(), 1);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?1', orderId)).n, 1);
  const row = await K.one('SELECT status, verified_by FROM payments WHERE razorpay_payment_id = ?1', good.id);
  assert.deepEqual([row.status, row.verified_by], ['captured', 'api']);
  // 6. a paid order has nothing to check
  await unlimit(orderId);
  r = await check();
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'not_needed');

  // what the log holds: who asked, and what changed
  const trail = (await K.audits('payment.recheck')).filter((a) => a.target === `order:${orderId}`);
  assert.deepEqual(trail.map((a) => [a.actor_id, JSON.parse(a.detail)]), [
    [support.who.id, { before: 'created', after: 'created', outcome: 'waiting', attempts: 0 }],
    [admin.who.id, { before: 'created', after: 'failed', outcome: 'failed', attempts: 1 }],
    [admin.who.id, { before: 'failed', after: 'paid', outcome: 'paid', attempts: 2 }],
  ]);
  const paidLog = (await K.audits('order.paid')).filter((a) => a.target === `order:${orderId}`);
  assert.equal(paidLog.length, 1); assert.equal(JSON.parse(paidLog[0].detail).via, 'api');
  const page = (await owner('GET', `/api/console/payments/${orderId}`)).body;
  assert.deepEqual(page.activity.map((a) => a.action).sort(), ['order.paid', 'payment.recheck', 'payment.recheck', 'payment.recheck']);
  assert.equal(page.activity.find((a) => a.action === 'order.paid').actor, 'System');

  // a payment of another amount never pays the order
  const other = (await payer.learner('POST', '/api/checkout/order', { packageId: 'starter' })).body;
  fake.pay(other.razorpayOrderId, { amount: 100 });
  r = await check(admin, other.orderId);
  assert.deepEqual([r.status, r.body.outcome, r.body.status, r.body.changed], [200, 'mismatch', 'created', false]);
  assert.equal(await orderNow(other.orderId), 'created'); assert.equal(await plans(), 1);
});

test('check with Razorpay: refused when the order never reached Razorpay or the keys are not set', async () => {
  const never = await K.order(P.amit, 'pro', { status: 'created', atRazorpay: false });
  let r = await admin('POST', `/api/console/payments/${never.id}/recheck`, {});
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'not_at_razorpay');
  assert.equal((await admin('GET', `/api/console/payments/${never.id}`)).body.can.recheckBlock, 'This order never reached Razorpay, so there is nothing to check.');

  const secret = S.env.RAZORPAY_KEY_SECRET;
  S.env.RAZORPAY_KEY_SECRET = '';
  try {
    r = await admin('POST', `/api/console/payments/${O.open.id}/recheck`, {});
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'payments_unavailable');
    const page = (await admin('GET', `/api/console/payments/${O.open.id}`)).body;
    assert.deepEqual(page.can, { recheck: false, recheckBlock: 'The Razorpay keys are not set, so this order cannot be checked.' });
  } finally { S.env.RAZORPAY_KEY_SECRET = secret; }
  assert.equal((await admin('POST', '/api/console/payments/ord_000000000000000000000000/recheck', {})).status, 404);
  await K.run('DELETE FROM orders WHERE id = ?1', never.id);
});

/* ---------------- download ---------------- */
test('payments download: only with the permission and a fresh password check; cells are made safe; it is recorded', async () => {
  assert.equal((await support('GET', '/api/console/payments/export.csv')).status, 403);
  await K.stale(admin);
  const old = await admin('GET', '/api/console/payments/export.csv');
  assert.equal(old.status, 403); assert.equal(old.body.error.code, 'reauth_required');
  assert.equal((await admin('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' })).status, 200);

  const res = await fetch(S.base + '/api/console/payments/export.csv?status=refunded&q=neha', { headers: { Cookie: [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="typecraft-payments-\d{4}-\d{2}-\d{2}\.csv"$/);
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
  const rows = text.trimEnd().split('\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], '﻿"Date (India time)","Customer","Email","Plan","Amount","Currency","Status","Paid with","Refunded","Paid at (India time)","Invoice","Order ID","Razorpay order ID","Razorpay payment ID","Why it failed"');
  assert.ok(rows[1].includes(`"Neha Gupta","neha_g@example.com","Premium","399.00","INR","Refunded","upi","399.00"`), rows[1]);
  assert.ok(rows[1].includes(`"${O.back.invoiceNumber}","${O.back.id}","${O.back.razorpayOrderId}","${O.back.razorpayPaymentId}",""`), rows[1]);

  const all = await admin('GET', '/api/console/payments/export.csv?package=starter');
  assert.ok(all.text.includes(`"'=SUM(A1:A9)"`), 'a name that looks like a formula cannot run as one');
  assert.ok(!all.text.includes('"=SUM'));
  const trail = await K.audits('payments.export');
  assert.deepEqual(trail.map((a) => [a.actor_id, a.target]), [[admin.who.id, 'payments'], [admin.who.id, 'payments']]);
  assert.deepEqual(JSON.parse(trail[0].detail), { rows: 1, cutOff: false, filters: { q: '(search text)', status: 'refunded' } });
});

/* ---------------- pages ---------------- */
test('payment pages: frames by permission, the sidebar shows where you are, strict headers', async () => {
  const anon = await K.client()('GET', '/console/payments?status=failed');
  assert.equal(anon.status, 302); assert.equal(anon.headers.get('location'), S.base + '/console/login?next=%2Fconsole%2Fpayments%3Fstatus%3Dfailed');

  const page = await admin('GET', '/console/payments');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.ok(page.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(page.text, /<a class="nav-item is-current" href="\/console\/payments" aria-current="page">/);
  for (const name of ['q', 'status', 'package', 'from', 'to']) assert.ok(page.text.includes(`name="${name}"`), name);
  assert.ok(page.text.includes('id="exportBtn"') && page.text.includes('/site/console/payments.js?v='));
  assert.ok(!(await support('GET', '/console/payments')).text.includes('id="exportBtn"'), 'no download button without the permission');
  assert.ok(!/Riya Sharma|riya\.sharma|ord_[a-f0-9]{24}/.test(page.text), 'the frame carries no payment data; the script asks for it');

  const one = await owner('GET', `/console/payments/${O.paid.id}`);
  assert.equal(one.status, 200);
  assertNoInlineCode(one.text);
  assert.match(one.text, /<a class="nav-item is-current" href="\/console\/payments" aria-current="page">/);
  assert.match(one.text, /<a class="crumb" href="\/console\/payments">Payments<\/a>/);
  for (const id of ['recTitle', 'recActions', 'attemptsBody', 'refundsBody', 'activityBody', 'orderBody', 'customerBody', 'planBody']) assert.ok(one.text.includes(`id="${id}"`), id);
  const boot = JSON.parse(one.text.match(/<script type="application\/json" id="console-boot">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(boot.page, { key: 'payments', title: 'Payment', params: { id: O.paid.id } });
  assert.ok(!(await support('GET', `/console/payments/${O.paid.id}`)).text.includes('id="activityBody"'));

  // Home lists it as ready, and the old "Phase 2" tag is gone from its row
  const home = (await owner('GET', '/console')).text;
  assert.match(home, /Ready here: <a href="\/console\/customers">Customers<\/a>, <a href="\/console\/payments">Payments<\/a>/);
  await K.setPermission('support', 'payments.view', false);
  try {
    assert.equal((await support('GET', '/console/payments')).status, 403);
    assert.equal((await support('GET', `/console/payments/${O.paid.id}`)).status, 403);
    assert.ok(!(await support('GET', '/console')).text.includes('href="/console/payments"'), 'and no link in the sidebar or on Home');
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.view'"); }
  for (const f of ['payments.js', 'payment.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), `${f}: data is placed as text only`);
  }
});
