// Admin console, phase 2: payments and refunds (docs/ADMIN-PHASE-2.md §6 and §7).
// Razorpay is the fake in ./fake-razorpay.mjs: nothing here touches the network.
//   node --test tests/console-payments.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import { fakeRazorpay } from './fake-razorpay.mjs';

const KEY_ID = 'rzp_test_console', KEY_SECRET = 'console-key-secret', WH_SECRET = 'console-webhook-secret';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let S, K, fake, owner, admin, support, P = {}, O = {};
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
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
  assert.deepEqual(d.can, { recheck: false, recheckBlock: null, refund: true, refundBlock: null, recheckRefund: true }, 'a paid order has nothing to check, and can be refunded');
  assert.equal(d.emailsOn, false);

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
    assert.deepEqual(page.can, { recheck: false, recheckBlock: 'The Razorpay keys are not set, so this order cannot be checked.', refund: false, refundBlock: null, recheckRefund: false });
    const paidPage = (await owner('GET', `/api/console/payments/${O.paid.id}`)).body;
    assert.deepEqual([paidPage.can.refund, paidPage.can.refundBlock], [false, 'The Razorpay keys are not set, so refunds cannot be sent.']);
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
  const anon = await K.client()('GET', '/admin/payments?status=failed');
  assert.equal(anon.status, 302); assert.equal(anon.headers.get('location'), S.base + '/admin/login?next=%2Fadmin%2Fpayments%3Fstatus%3Dfailed');

  const page = await admin('GET', '/admin/payments');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.ok(page.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(page.text, /<a class="nav-item is-current" href="\/admin\/payments" aria-current="page">/);
  for (const name of ['q', 'status', 'package', 'from', 'to']) assert.ok(page.text.includes(`name="${name}"`), name);
  assert.ok(page.text.includes('id="exportBtn"') && page.text.includes('/site/console/payments.js?v='));
  assert.ok(!(await support('GET', '/admin/payments')).text.includes('id="exportBtn"'), 'no download button without the permission');
  assert.ok(!/Riya Sharma|riya\.sharma|ord_[a-f0-9]{24}/.test(page.text), 'the frame carries no payment data; the script asks for it');

  const one = await owner('GET', `/admin/payments/${O.paid.id}`);
  assert.equal(one.status, 200);
  assertNoInlineCode(one.text);
  assert.match(one.text, /<a class="nav-item is-current" href="\/admin\/payments" aria-current="page">/);
  assert.match(one.text, /<a class="crumb" href="\/admin\/payments">Payments<\/a>/);
  for (const id of ['recTitle', 'recActions', 'attemptsBody', 'refundsBody', 'activityBody', 'orderBody', 'customerBody', 'planBody']) assert.ok(one.text.includes(`id="${id}"`), id);
  const boot = JSON.parse(one.text.match(/<script type="application\/json" id="console-boot">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(boot.page, { key: 'payments', title: 'Payment', params: { id: O.paid.id } });
  assert.ok(!(await support('GET', `/admin/payments/${O.paid.id}`)).text.includes('id="activityBody"'));

  // Home: the menu has every module (the old admin is gone since Phase 6)
  const home = (await owner('GET', '/admin')).text;
  for (const p of ['customers', 'payments', 'campaigns', 'administrators']) assert.ok(home.includes(`href="/admin/${p}"`), p);
  assert.ok(!/still managed in the current admin/.test(home));
  await K.setPermission('support', 'payments.view', false);
  try {
    assert.equal((await support('GET', '/admin/payments')).status, 403);
    assert.equal((await support('GET', `/admin/payments/${O.paid.id}`)).status, 403);
    assert.ok(!(await support('GET', '/admin')).text.includes('href="/admin/payments"'), 'and no link in the sidebar or on Home');
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.view'"); }
  for (const f of ['payments.js', 'payment.js']) {
    const r = await K.client()('GET', `/site/console/${f}`);
    assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), `${f}: data is placed as text only`);
  }
});

/* ================= refunds (§7) ================= */
let buyerN = 0;
/** A plan bought through the real checkout, paid at the fake Razorpay. → { buyer, orderId, paymentId (our row), rzpPaymentId, amount } */
async function bought(packageId = 'pro') {
  const buyer = await K.account({ name: 'Refund Customer', email: `buyer${++buyerN}@example.com` });
  const o = (await buyer.learner('POST', '/api/checkout/order', { packageId })).body;
  const p = fake.pay(o.razorpayOrderId);
  const sig = createHmac('sha256', KEY_SECRET).update(`${o.razorpayOrderId}|${p.id}`).digest('hex');
  const v = await buyer.learner('POST', '/api/checkout/verify', { orderId: o.orderId, razorpay_order_id: o.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sig });
  assert.equal(v.body.status, 'paid', v.text);
  await K.settle();
  const row = await K.one('SELECT id FROM payments WHERE razorpay_payment_id = ?1', p.id);
  return { buyer, orderId: o.orderId, paymentId: row.id, rzpPaymentId: p.id, amount: o.amountPaise };
}
const send = (c, body) => c('POST', '/api/console/refunds', { reasonCode: 'request', ...body });
const refundCalls = () => fake.calls.filter((x) => /^POST \/payments\/\w+\/refund$/.test(x)).length;
const planOf = async (orderId) => (await K.one('SELECT status FROM user_subscriptions WHERE order_id = ?1', orderId)).status;
const orderOf = async (orderId) => (await K.one('SELECT status FROM orders WHERE id = ?1', orderId)).status;
const unblock = (key) => K.run('DELETE FROM rate_limits WHERE key = ?1', key);

test('refunds list: who may see it, search and filters', async () => {
  assert.equal((await K.client()('GET', '/api/console/refunds')).status, 401);
  const d = (await support('GET', '/api/console/refunds')).body;
  assert.equal(d.total, 2);
  assert.deepEqual(d.items.map((r) => r.id), [O.backRefund.id, O.partRefund.id], 'newest first');
  const part = d.items[1];
  assert.deepEqual(Object.keys(part).sort(), ['amountPaise', 'createdAt', 'currency', 'customer', 'id', 'orderId', 'packageName', 'processedAt', 'razorpayRefundId', 'reason', 'requestedBy', 'status']);
  assert.deepEqual([part.amountPaise, part.status, part.reason, part.requestedBy, part.orderId, part.packageName], [4000, 'processed', 'Duplicate payment: charged twice', 'Kavita Ops', O.part.id, 'Starter']);
  assert.equal(d.items[0].requestedBy, null);
  const ids = async (query) => (await admin('GET', '/api/console/refunds?' + query)).body.items.map((r) => r.id);
  assert.deepEqual(await ids('q=neha'), [O.backRefund.id]);
  for (const term of [O.partRefund.razorpayRefundId, O.part.id, O.part.razorpayPaymentId, O.part.razorpayOrderId, P.riya]) assert.deepEqual(await ids('q=' + term), [O.partRefund.id], term);
  assert.deepEqual(await ids('status=pending'), []);
  assert.deepEqual(await ids('status=processed'), [O.backRefund.id, O.partRefund.id]);
  assert.deepEqual(await ids('from=' + new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10)), [O.backRefund.id]);
  await K.setPermission('support', 'refunds.view', false);
  try { assert.equal((await support('GET', '/api/console/refunds')).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'refunds.view'"); }
});

test('sending a refund: who may, and everything checked before any money moves', async () => {
  const b = await bought('pro');
  const calls = refundCalls();
  // Admin and Support cannot by default; a Super Admin must have confirmed the password in the last 10 minutes
  for (const c of [admin, support]) assert.equal((await send(c, { paymentId: b.paymentId })).status, 403);
  await K.stale(owner);
  let r = await send(owner, { paymentId: b.paymentId });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' })).status, 200);

  const field = async (body, name) => {
    const x = await send(owner, { paymentId: b.paymentId, ...body });
    assert.equal(x.status, 400, JSON.stringify(body)); assert.ok(x.body.error.fields && x.body.error.fields[name], `${name}: ${x.text}`);
    return x.body.error.fields[name];
  };
  assert.equal((await owner('POST', '/api/console/refunds', { reasonCode: 'request' })).body.error.fields.paymentId, 'Choose the payment to refund.');
  assert.equal((await send(owner, { paymentId: 'pay_row_nothing_like_this' })).status, 404);
  r = await send(owner, { paymentId: O.failed.paymentRowId });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'not_refundable');
  for (const bad of [0, -5, 1.5, '100']) await field({ amountPaise: bad }, 'amountPaise');
  assert.equal(await field({ amountPaise: 19901 }, 'amountPaise'), 'At most ₹199 can still be refunded for this payment.');
  await field({ reasonCode: undefined }, 'reasonCode');
  await field({ reasonCode: 'because' }, 'reasonCode');
  await field({ reasonCode: 'other' }, 'reasonText');
  await field({ reasonCode: 'other', reasonText: '  ok ' }, 'reasonText');
  await field({ reasonText: 'x'.repeat(251) }, 'reasonText');
  await field({ planAction: 'later' }, 'planAction');
  const secret = S.env.RAZORPAY_KEY_SECRET;
  S.env.RAZORPAY_KEY_SECRET = '';
  try {
    r = await send(owner, { paymentId: b.paymentId });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'payments_unavailable');
  } finally { S.env.RAZORPAY_KEY_SECRET = secret; }
  assert.equal(refundCalls(), calls, 'no refund reached Razorpay');
  assert.equal(await planOf(b.orderId), 'active');
});

test('a full refund with the usual rule: the money moves once, the plan ends, and it is all recorded', async () => {
  const b = await bought('pro');
  const calls = refundCalls();
  const r = await send(owner, { paymentId: b.paymentId, amountPaise: null, reasonText: '  bought the   wrong plan ' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.status, r.body.amountPaise, r.body.planEnded, r.body.orderStatus, r.body.emailsOn], ['processed', 19900, true, 'refunded', false]);
  assert.equal(refundCalls(), calls + 1);
  const row = await K.one('SELECT * FROM refunds WHERE razorpay_refund_id = ?1', r.body.refundId);
  assert.deepEqual([row.amount_paise, row.status, row.reason, row.requested_by], [19900, 'processed', 'Customer request: bought the wrong plan', owner.who.id]);
  assert.equal(await planOf(b.orderId), 'revoked');
  assert.equal((await b.buyer.learner('GET', '/api/me/entitlements')).body.plan, 'free');
  assert.equal(await K.one('SELECT COUNT(*) AS n FROM refund_choices').then((x) => x.n), 0, 'the usual rule needs no stored choice');
  const logged = await K.many(`SELECT action, actor_id, detail FROM audit_logs WHERE target IN (?1, ?2) ORDER BY created_at, rowid`, `payment:${b.paymentId}`, `order:${b.orderId}`);
  assert.deepEqual(logged.map((a) => a.action).filter((a) => a !== 'order.paid'), ['payment.refund', 'subscription.revoke', 'refund.processed']);
  assert.deepEqual(JSON.parse(logged.find((a) => a.action === 'payment.refund').detail), { amountPaise: 19900, reason: 'Customer request: bought the wrong plan', refundId: r.body.refundId, status: 'processed' });
  // nothing is left to refund
  const again = await send(owner, { paymentId: b.paymentId });
  assert.equal(again.status, 400); assert.equal(again.body.error.code, 'not_refundable');
  const page = (await owner('GET', `/api/console/payments/${b.orderId}`)).body;
  assert.equal(page.can.refund, false); assert.equal(page.order.refundedPaise, 19900);
  assert.deepEqual([page.refunds[0].requestedBy, page.refunds[0].reason, page.plan.status], ['Mayank Owner', 'Customer request: bought the wrong plan', 'revoked']);
  assert.deepEqual(page.activity.map((a) => a.action).sort(), ['order.paid', 'payment.refund', 'refund.processed', 'subscription.revoke']);
});

test('part refunds and the choice for the plan: keep, end, and a double click sends one', async () => {
  const b = await bought('pro');
  const calls = refundCalls();
  let r = await send(owner, { paymentId: b.paymentId, amountPaise: 5000, reasonCode: 'technical', planAction: 'auto' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.planEnded, r.body.orderStatus], [false, 'partially_refunded']);
  assert.equal(await planOf(b.orderId), 'active', 'a part refund keeps the plan under the usual rule');
  // a second click within 10 seconds is refused, and Razorpay sees one refund
  r = await send(owner, { paymentId: b.paymentId, amountPaise: 5000 });
  assert.equal(r.status, 429); assert.equal(refundCalls(), calls + 1);
  await unblock(`refund:${b.paymentId}`);
  // a part refund that ends the plan
  r = await send(owner, { paymentId: b.paymentId, amountPaise: 5000, reasonCode: 'duplicate', planAction: 'end' });
  assert.deepEqual([r.status, r.body.planEnded, r.body.orderStatus], [201, true, 'partially_refunded']);
  assert.equal(await planOf(b.orderId), 'revoked');
  assert.deepEqual(await K.one('SELECT plan_action, created_by FROM refund_choices WHERE razorpay_refund_id = ?1', r.body.refundId), { plan_action: 'end', created_by: owner.who.id });
  let page = (await owner('GET', `/api/console/payments/${b.orderId}`)).body;
  assert.equal(page.attempts[0].refundablePaise, 9900);
  // keeping the plan afterwards does not switch an ended plan back on
  await unblock(`refund:${b.paymentId}`);
  r = await send(owner, { paymentId: b.paymentId, amountPaise: 9900, planAction: 'keep' });
  assert.deepEqual([r.status, r.body.orderStatus], [201, 'refunded']);
  assert.equal(await planOf(b.orderId), 'revoked');

  // a full refund that keeps the plan
  const k = await bought('starter');
  r = await send(owner, { paymentId: k.paymentId, reasonCode: 'other', reasonText: 'Goodwill: the course was down for a week', planAction: 'keep' });
  assert.deepEqual([r.status, r.body.amountPaise, r.body.planEnded, r.body.orderStatus], [201, 9900, false, 'refunded']);
  assert.equal(await planOf(k.orderId), 'active');
  assert.equal((await k.buyer.learner('GET', '/api/me/entitlements')).body.plan, 'starter');
  const log = (await K.audits('payment.refund')).find((a) => JSON.parse(a.detail).refundId === r.body.refundId);
  assert.deepEqual(JSON.parse(log.detail), { amountPaise: 9900, reason: 'Goodwill: the course was down for a week', refundId: r.body.refundId, status: 'processed', planAction: 'keep' });
  page = (await owner('GET', `/api/console/payments/${k.orderId}`)).body;
  assert.equal(page.plan.status, 'active'); assert.equal(page.can.refund, false);
});

test('a refund on its way: nothing changes until Razorpay sends it; checking applies the choice made', async () => {
  fake.refundAs = 'pending';
  try {
    const b = await bought('pro');
    let r = await send(owner, { paymentId: b.paymentId, amountPaise: 3000, planAction: 'end' });
    assert.deepEqual([r.status, r.body.status, r.body.planEnded, r.body.orderStatus], [201, 'pending', false, 'paid']);
    assert.equal(await planOf(b.orderId), 'active', 'nothing changes while the money is on its way');
    let page = (await owner('GET', `/api/console/payments/${b.orderId}`)).body;
    assert.deepEqual([page.refunds[0].status, page.attempts[0].refundablePaise, page.can.recheckRefund], ['pending', 16900, true]);
    const row = await K.one('SELECT id FROM refunds WHERE razorpay_refund_id = ?1', r.body.refundId);
    const check = (c = support) => c('POST', `/api/console/refunds/${row.id}/recheck`, {});

    // Razorpay still has it on its way
    r = await check();
    assert.deepEqual([r.status, r.body.status, r.body.changed], [200, 'pending', false]);
    r = await check();
    assert.equal(r.status, 429, 'once per refund per 30 seconds');
    await unblock(`recheck:${row.id}`);
    // Razorpay has sent it: the choice made with the refund applies, though only part was refunded
    fake.refunds.get((await K.one('SELECT razorpay_refund_id AS x FROM refunds WHERE id = ?1', row.id)).x).status = 'processed';
    r = await check();
    assert.deepEqual([r.status, r.body.status, r.body.changed], [200, 'processed', true]);
    assert.equal(await planOf(b.orderId), 'revoked');
    assert.equal(await orderOf(b.orderId), 'partially_refunded');
    await unblock(`recheck:${row.id}`);
    r = await check();
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'not_needed');
    const trail = (await K.audits('refund.recheck')).filter((a) => a.target === `payment:${b.paymentId}`).map((a) => [a.actor_id, JSON.parse(a.detail).before, JSON.parse(a.detail).after]);
    assert.deepEqual(trail, [[support.who.id, 'pending', 'pending'], [support.who.id, 'pending', 'processed']]);

    // a refund Razorpay could not send: the amount can be refunded again, and the plan stays
    const f = await bought('starter');
    r = await send(owner, { paymentId: f.paymentId, planAction: 'end' });
    assert.equal(r.body.status, 'pending');
    fake.refunds.get(r.body.refundId).status = 'failed';
    const failed = await K.one('SELECT id FROM refunds WHERE razorpay_refund_id = ?1', r.body.refundId);
    r = await admin('POST', `/api/console/refunds/${failed.id}/recheck`, {});
    assert.deepEqual([r.status, r.body.status], [200, 'failed']);
    page = (await owner('GET', `/api/console/payments/${f.orderId}`)).body;
    assert.deepEqual([page.refunds[0].status, page.attempts[0].refundablePaise, page.order.status, page.plan.status, page.can.refund], ['failed', 9900, 'paid', 'active', true]);
    assert.equal((await K.audits('refund.failed')).filter((a) => a.target === `payment:${f.paymentId}`).length, 1);

    // who may check, and when there is nothing to check
    await K.setPermission('support', 'payments.recheck', false);
    try { assert.equal((await support('POST', `/api/console/refunds/${row.id}/recheck`, {})).status, 403); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.recheck'"); }
    assert.equal((await admin('POST', `/api/console/refunds/${O.partRefund.id}/recheck`, {})).body.error.code, 'not_needed');
    assert.equal((await admin('POST', '/api/console/refunds/00000000-0000-0000-0000-000000000000/recheck', {})).status, 404);
  } finally { fake.refundAs = 'processed'; }
});

test('before migration 0006: a refund under the usual rule works; a choice for the plan is refused before any money moves', async () => {
  const b = await bought('pro');
  await K.run('ALTER TABLE refund_choices RENAME TO refund_choices_away');
  try {
    const calls = refundCalls();
    let r = await send(owner, { paymentId: b.paymentId, amountPaise: 1000, planAction: 'keep' });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'console_not_ready');
    assert.equal(refundCalls(), calls, 'no money moved');
    r = await send(owner, { paymentId: b.paymentId, amountPaise: 1000 });
    assert.deepEqual([r.status, r.body.status, r.body.planEnded], [201, 'processed', false]);
    assert.equal(await planOf(b.orderId), 'active');
  } finally { await K.run('ALTER TABLE refund_choices_away RENAME TO refund_choices'); }
});

test('refunds page: the frame by permission; the payment page offers a refund only to who may send one', async () => {
  const page = await support('GET', '/admin/refunds');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.match(page.text, /<a class="nav-item is-current" href="\/admin\/refunds" aria-current="page">/);
  for (const name of ['q', 'status', 'from', 'to']) assert.ok(page.text.includes(`name="${name}"`), name);
  assert.ok(!page.text.includes('id="exportBtn"') && page.text.includes('/site/console/refunds.js?v='));
  assert.equal((await K.client()('GET', '/admin/refunds')).status, 302);
  // the button is drawn by the page's script from can.refund
  assert.equal((await admin('GET', `/api/console/payments/${O.paid.id}`)).body.can.refund, false, 'Admin has no payments.refund by default');
  await K.setPermission('admin', 'payments.refund', true);
  try { assert.equal((await admin('GET', `/api/console/payments/${O.paid.id}`)).body.can.refund, true); } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.refund'"); }
  const r = await K.client()('GET', '/site/console/refunds.js');
  assert.equal(r.status, 200); assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text));
});

test("Razorpay's notice of a refund handled before the console saved its choice: the choice still applies, and who sent it is kept", async () => {
  const b = await bought('pro');
  let eventN = 0;
  fake.onRefund = async (refund) => {
    fake.onRefund = null;
    const raw = JSON.stringify({ entity: 'event', event: 'refund.processed', payload: { refund: { entity: { ...refund, status: 'processed' } } } });
    const res = await fetch(S.base + '/api/webhooks/razorpay', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json',
      'X-Razorpay-Signature': createHmac('sha256', WH_SECRET).update(raw).digest('hex'), 'X-Razorpay-Event-Id': `evt_console_${++eventN}` } });
    assert.equal(res.status, 200, await res.text());
  };
  try {
    const r = await send(owner, { paymentId: b.paymentId, amountPaise: 2000, reasonCode: 'duplicate', planAction: 'end' });
    assert.deepEqual([r.status, r.body.status, r.body.planEnded], [201, 'processed', true]);
    assert.equal(await planOf(b.orderId), 'revoked');
    const row = await K.one('SELECT requested_by, reason, status FROM refunds WHERE razorpay_refund_id = ?1', r.body.refundId);
    assert.deepEqual(row, { requested_by: owner.who.id, reason: 'Duplicate payment', status: 'processed' });
    // the notice did come first: it recorded the refund (no one signed in sent it), and the console then ended the plan
    const trail = await K.many("SELECT action, actor_id FROM audit_logs WHERE target IN (?1, ?2) AND action IN ('refund.processed', 'subscription.revoke') ORDER BY created_at, rowid",
      `payment:${b.paymentId}`, `order:${b.orderId}`);
    assert.deepEqual(trail.map((a) => [a.action, a.actor_id]), [['refund.processed', null], ['subscription.revoke', owner.who.id]]);
  } finally { fake.onRefund = null; }
});

test('no one refunds a payment of their own account except a Super Admin', async () => {
  const b = await bought('pro');
  // an Admin with the refund permission, refunding a payment of their own account
  await K.setPermission('admin', 'payments.refund', true);
  try {
    const me = await K.account({ role: 'admin', name: 'Self Refund', email: 'self-refund@example.com' });
    const o = (await me.learner('POST', '/api/checkout/order', { packageId: 'starter' })).body;
    const p = fake.pay(o.razorpayOrderId);
    const sig = createHmac('sha256', KEY_SECRET).update(`${o.razorpayOrderId}|${p.id}`).digest('hex');
    assert.equal((await me.learner('POST', '/api/checkout/verify', { orderId: o.orderId, razorpay_order_id: o.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sig })).body.status, 'paid');
    const row = await K.one('SELECT id FROM payments WHERE razorpay_payment_id = ?1', p.id);
    const c = await K.consoleLogin(me);
    const r = await send(c, { paymentId: row.id });
    assert.equal(r.status, 403); assert.match(r.body.error.message, /your own account/);
    const page = (await c('GET', `/api/console/payments/${o.orderId}`)).body;
    assert.deepEqual([page.can.refund, page.can.refundBlock], [false, 'This is your own payment. Ask a Super Admin to refund it.']);
    assert.equal((await send(c, { paymentId: b.paymentId, amountPaise: 100 })).status, 201, "someone else's payment is fine");
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'payments.refund'"); }
});
