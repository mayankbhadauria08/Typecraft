// Billing tests: checkout, signatures, fulfil-once, webhooks, refunds, stacking,
// entitlements and the plan gates, admin access, typing-test limits and the crons.
// Razorpay is a small fake behind globalThis.fetch: nothing here touches the network.
//   node --test tests/billing.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import * as billing from '../src/billing.js';
import { entitlementsFor, lessonAllowed, gameAllowed, has, FIRST5 } from '../src/entitlements.js';

const KEY_ID = 'rzp_test_abc123', KEY_SECRET = 'key-secret-xyz', WH_SECRET = 'webhook-secret-123';
const realFetch = globalThis.fetch;
let env, srv, base;

/* ---------------- a tiny fake Razorpay ---------------- */
const fake = { orders: new Map(), payments: new Map(), refunds: [], calls: [], n: 0, failNext: null };
const rid = (p) => `${p}_${(++fake.n).toString(36).padStart(8, '0')}FAKE`;
function rzpReply(status, data) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
async function fakeRazorpay(url, init = {}) {
  const u = new URL(url);
  const method = init.method || 'GET';
  const path = u.pathname.replace(/^\/v1/, '');
  const body = init.body ? JSON.parse(init.body) : null;
  fake.calls.push(`${method} ${path}`);
  const auth = new Headers(init.headers).get('Authorization');
  if (auth !== 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')) return rzpReply(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'auth' } });
  let m;
  if (method === 'POST' && path === '/orders') {
    const o = { id: rid('order'), entity: 'order', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: 'created' };
    fake.orders.set(o.id, o);
    return rzpReply(200, o);
  }
  if (method === 'GET' && (m = path.match(/^\/payments\/([\w]+)$/))) {
    const p = fake.payments.get(m[1]);
    return p ? rzpReply(200, p) : rzpReply(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'not found' } });
  }
  if (method === 'POST' && (m = path.match(/^\/payments\/([\w]+)\/capture$/))) {
    const p = fake.payments.get(m[1]);
    if (!p || p.status !== 'authorized' || body.amount !== p.amount) return rzpReply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'cannot capture' } });
    p.status = 'captured';
    return rzpReply(200, p);
  }
  if (method === 'GET' && (m = path.match(/^\/orders\/([\w]+)\/payments$/))) {
    const items = [...fake.payments.values()].filter((p) => p.order_id === m[1]);
    return rzpReply(200, { entity: 'collection', count: items.length, items });
  }
  if (method === 'POST' && (m = path.match(/^\/payments\/([\w]+)\/refund$/))) {
    const p = fake.payments.get(m[1]);
    if (!p || p.status !== 'captured') return rzpReply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'cannot refund' } });
    const r = { id: rid('rfnd'), entity: 'refund', amount: body.amount ?? p.amount, payment_id: p.id, notes: body.notes, status: 'processed' };
    fake.refunds.push(r);
    return rzpReply(200, r);
  }
  return rzpReply(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'no route' } });
}
/** A payment made in the fake checkout for one of our orders. */
function makePayment(rzpOrderId, { status = 'captured', amount, currency = 'INR', method = 'upi', error } = {}) {
  const o = fake.orders.get(rzpOrderId);
  const p = { id: rid('pay'), entity: 'payment', order_id: rzpOrderId, amount: amount ?? o.amount, currency, status, method,
    error_code: error ? 'BAD_REQUEST_ERROR' : null, error_description: error || null };
  fake.payments.set(p.id, p);
  return p;
}
const sign = (orderId, paymentId, secret = KEY_SECRET) => createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

before(async () => {
  env = makeEnv({ OWNER_EMAILS: 'boss@example.com', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET, SITE_URL: 'https://typecraft.test' });
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.razorpay.com/') ? fakeRazorpay(url, init) : realFetch(url, init));
  srv = await startServer(env, 8797);
  base = `http://localhost:${srv.port}`;
});
after(() => { srv.server.close(); globalThis.fetch = realFetch; });

/* ---------------- browser stand-ins ---------------- */
let ipN = 0;
function client() {
  const jar = new Map(); // every cookie by name (the console sets its own beside the site's)
  const ip = `10.7.0.${++ipN}`;
  const c = async (method, path, body) => {
    env.__ip = ip;
    const headers = { Origin: base };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await realFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(';')[0], i = pair.indexOf('=');
      if (/Max-Age=0/.test(sc) || !pair.slice(i + 1)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json };
  };
  return c;
}
const pw = 'correct horse 9';
let userN = 0;
async function signup(email = `learner${++userN}@example.com`) {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { fullName: 'Asha Learner', email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  c.user = r.body.user;
  return c;
}
/** A browser signed in to the admin console (POST /api/admin/auth/login; no emailed code without email set up). */
async function consoleSignIn(email) {
  const c = client();
  const r = await c('POST', '/api/admin/auth/login', { email, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.step, 'done');
  return c;
}
async function webhook(event, payload, { id = `evt_${++fake.n}`, secret = WH_SECRET, signature } = {}) {
  const raw = JSON.stringify({ entity: 'event', event, payload, created_at: Math.floor(Date.now() / 1000) });
  const sig = signature || createHmac('sha256', secret).update(raw).digest('hex');
  const res = await realFetch(base + '/api/webhooks/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': id }, body: raw });
  return { status: res.status, body: await res.json() };
}
const count = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()).n;
async function buy(c, packageId = 'pro', { verify = true, status = 'captured' } = {}) {
  const o = await c('POST', '/api/checkout/order', { packageId });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const p = makePayment(o.body.razorpayOrderId, { status });
  if (!verify) return { order: o.body, payment: p };
  const v = await c('POST', '/api/checkout/verify', { orderId: o.body.orderId, razorpay_order_id: o.body.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(o.body.razorpayOrderId, p.id) });
  return { order: o.body, payment: p, verify: v };
}

/* ---------------- packages and orders ---------------- */
test('GET /api/packages is public and reads prices from the packages table', async () => {
  const r = await client()('GET', '/api/packages');
  assert.equal(r.status, 200);
  const ids = r.body.packages.map((p) => p.id);
  assert.deepEqual(ids, ['free', 'starter', 'pro', 'premium', 'lifetime']);
  const pro = r.body.packages.find((p) => p.id === 'pro');
  assert.equal(pro.pricePaise, 19900); assert.equal(pro.validityDays, 90); assert.equal(pro.highlight, true);
  assert.ok(pro.features.some((f) => f.key === 'analytics.advanced' && f.label === 'Advanced analytics'));
  // the two lesson features are not in the catalogue: each package says its lessons in words instead
  assert.equal(r.body.features.length, 11);
  assert.ok(!r.body.features.some((f) => f.key.startsWith('lessons.')));
  assert.deepEqual(pro.lessons, { text: 'all 78 lessons', Text: 'All 78 lessons', short: 'All lessons', count: 78, all: true });
  assert.deepEqual(pro.features[0], { key: 'lessons', label: 'All 78 lessons' });
  const free = r.body.packages.find((p) => p.id === 'free');
  assert.equal(free.lessons.Text, 'The first 5 lessons'); assert.equal(free.limits.lessons, 'first5');
});

test('order creation: Razorpay order with our receipt and notes; reused for 30 minutes; free and unknown plans refused', async () => {
  const c = await signup();
  assert.equal((await client()('POST', '/api/checkout/order', { packageId: 'pro' })).status, 401);
  const r = await c('POST', '/api/checkout/order', { packageId: 'pro' });
  assert.equal(r.status, 200);
  assert.match(r.body.orderId, /^ord_[a-f0-9]{24}$/);
  assert.equal(r.body.amountPaise, 19900); assert.equal(r.body.currency, 'INR'); assert.equal(r.body.keyId, KEY_ID);
  assert.deepEqual(r.body.prefill, { name: 'Asha Learner', email: c.user.email, contact: '+91 98765 43210' });
  const ro = fake.orders.get(r.body.razorpayOrderId);
  assert.equal(ro.receipt, r.body.orderId); assert.equal(ro.amount, 19900);
  assert.deepEqual(ro.notes, { orderId: r.body.orderId, userId: c.user.id, packageId: 'pro' });
  const again = await c('POST', '/api/checkout/order', { packageId: 'pro' });
  assert.equal(again.body.orderId, r.body.orderId);
  assert.equal((await c('POST', '/api/checkout/order', { packageId: 'free' })).body.error.code, 'free_package');
  assert.equal((await c('POST', '/api/checkout/order', { packageId: 'gold' })).status, 400);
  const row = await env.DB.prepare('SELECT status, amount_paise FROM orders WHERE id = ?1').bind(r.body.orderId).first();
  assert.deepEqual({ ...row }, { status: 'created', amount_paise: 19900 });
});

test('payments unavailable: 503 when keys are missing or payments are switched off', async () => {
  const c = await signup();
  const secret = env.RAZORPAY_KEY_SECRET;
  delete env.RAZORPAY_KEY_SECRET;
  try { assert.equal((await c('POST', '/api/checkout/order', { packageId: 'starter' })).body.error.code, 'payments_unavailable'); }
  finally { env.RAZORPAY_KEY_SECRET = secret; }
  await env.DB.prepare("UPDATE platform_settings SET value = '{\"enabled\":false}' WHERE key = 'payments'").run();
  try {
    const r = await c('POST', '/api/checkout/order', { packageId: 'starter' });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'payments_unavailable');
  } finally { await env.DB.prepare("UPDATE platform_settings SET value = '{\"enabled\":true,\"testMode\":true}' WHERE key = 'payments'").run(); }
});

/* ---------------- verify ---------------- */
test('verify: a bad signature is refused and activates nothing', async () => {
  const c = await signup();
  const { order, payment } = await buy(c, 'pro', { verify: false });
  const bad = await c('POST', '/api/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: payment.id, razorpay_signature: sign(order.razorpayOrderId, payment.id, 'wrong') });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'bad_signature');
  const swapped = await c('POST', '/api/checkout/verify', { orderId: order.orderId, razorpay_order_id: 'order_other', razorpay_payment_id: payment.id, razorpay_signature: sign('order_other', payment.id) });
  assert.equal(swapped.status, 400);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE user_id = ?1', c.user.id), 0);
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'free');
  // someone else's order is not found
  const other = await signup();
  assert.equal((await other('POST', '/api/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: payment.id, razorpay_signature: sign(order.razorpayOrderId, payment.id) })).status, 404);
});

test('verify: good signature + Razorpay confirms capture → paid, subscription, invoice; double verify and webhooks fulfil once', async () => {
  const c = await signup();
  const { order, payment, verify } = await buy(c, 'pro');
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  assert.equal(verify.body.status, 'paid');
  assert.match(verify.body.invoiceNumber, new RegExp(`^TC-${new Date().getUTCFullYear()}-\\d{6}$`));
  assert.ok(fake.calls.includes(`GET /payments/${payment.id}`), 'the payment was confirmed with Razorpay');
  const ent = (await c('GET', '/api/me/entitlements')).body;
  assert.equal(ent.plan, 'pro'); assert.equal(ent.planName, 'Pro');
  assert.ok(has(ent, 'analytics.advanced')); assert.equal(ent.limits.lessons, 'all'); assert.equal(ent.limits.dailyTests, null);
  const days = (Date.parse(ent.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 89.9 && days <= 90, String(days));

  // the browser sends verify again, Razorpay sends payment.captured and order.paid (twice)
  const v2 = await c('POST', '/api/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: payment.id, razorpay_signature: sign(order.razorpayOrderId, payment.id) });
  assert.equal(v2.body.status, 'paid'); assert.equal(v2.body.invoiceNumber, verify.body.invoiceNumber);
  const pay = { payment: { entity: fake.payments.get(payment.id) } };
  assert.equal((await webhook('payment.captured', pay)).status, 200);
  assert.equal((await webhook('order.paid', { ...pay, order: { entity: fake.orders.get(order.razorpayOrderId) } })).status, 200);
  assert.equal((await webhook('order.paid', { ...pay, order: { entity: fake.orders.get(order.razorpayOrderId) } })).status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE order_id = ?1', order.orderId), 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE user_id = ?1', c.user.id), 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?1', order.orderId), 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?1', order.orderId), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'order.paid' AND target = ?1", `order:${order.orderId}`), 1);

  // the learner's pages
  const st = (await c('GET', `/api/checkout/orders/${order.orderId}`)).body;
  assert.equal(st.status, 'paid'); assert.equal(st.packageName, 'Pro'); assert.equal(st.invoiceNumber, verify.body.invoiceNumber);
  assert.equal(st.packageId, 'pro', 'the failure page retries with packageId');
  const orders = (await c('GET', '/api/me/orders')).body.orders;
  assert.equal(orders[0].status, 'paid'); assert.equal(orders[0].method, 'upi');
  assert.equal(orders[0].razorpayPaymentId, payment.id, '/account/payments shows the Razorpay payment id');
  assert.equal(orders[0].orderId, order.orderId);
  const inv = (await c('GET', `/api/me/invoices/${verify.body.invoiceNumber}`)).body.invoice;
  assert.equal(inv.amountPaise, 19900); assert.equal(inv.billedTo.email, c.user.email);
  assert.equal(inv.seller.name, 'TypeCraft'); assert.equal(inv.tax.gstin, null);
  assert.match(inv.lines[0].description, /Pro plan \(90 days\)/);
  assert.equal((await c('GET', '/api/me/invoices')).body.invoices.length, 1);
  assert.equal((await (await signup())('GET', `/api/me/invoices/${verify.body.invoiceNumber}`)).status, 404);
});

test('verify: an authorized payment is captured by the server, then fulfilled', async () => {
  const c = await signup();
  const { payment, verify } = await buy(c, 'starter', { status: 'authorized' });
  assert.equal(verify.body.status, 'paid');
  assert.ok(fake.calls.includes(`POST /payments/${payment.id}/capture`));
  assert.equal(fake.payments.get(payment.id).status, 'captured');
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'starter');
});

test('verify: a payment whose amount does not match the order is refused', async () => {
  const c = await signup();
  const o = (await c('POST', '/api/checkout/order', { packageId: 'premium' })).body;
  const p = makePayment(o.razorpayOrderId, { amount: 100 });
  const r = await c('POST', '/api/checkout/verify', { orderId: o.orderId, razorpay_order_id: o.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(o.razorpayOrderId, p.id) });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'payment_mismatch');
  // nor by webhook
  assert.equal((await webhook('payment.captured', { payment: { entity: p } })).status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE user_id = ?1', c.user.id), 0);
  assert.notEqual((await env.DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(o.orderId).first()).status, 'paid');
});

/* ---------------- webhooks ---------------- */
test('webhook: bad signature 400; a verified webhook alone fulfils; a duplicate event id is ignored', async () => {
  const c = await signup();
  const { order, payment } = await buy(c, 'starter', { verify: false });
  const payload = { payment: { entity: fake.payments.get(payment.id) } };
  const bad = await webhook('payment.captured', payload, { signature: 'f'.repeat(64) });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'bad_signature');
  assert.equal((await webhook('payment.captured', payload, { secret: 'not-the-secret' })).status, 400);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE user_id = ?1', c.user.id), 0);

  const first = await webhook('payment.captured', payload, { id: 'evt_dup_000001' });
  assert.equal(first.status, 200); assert.equal(first.body.duplicate, undefined);
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'starter');
  const dup = await webhook('payment.captured', payload, { id: 'evt_dup_000001' });
  assert.equal(dup.status, 200); assert.equal(dup.body.duplicate, true);
  const ev = await env.DB.prepare('SELECT status, payload FROM webhook_events WHERE id = ?1').bind('evt_dup_000001').first();
  assert.equal(ev.status, 'processed');
  assert.ok(!ev.payload.includes('Asha'), 'no personal data kept');
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE order_id = ?1', order.orderId), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE order_id = ?1 AND verified_by = 'webhook'", order.orderId), 1);
  // unknown events are kept as ignored
  assert.equal((await webhook('invoice.paid', {})).status, 200);
});

test('webhook: payment.failed marks the order failed; the browser failure message only records text', async () => {
  const c = await signup();
  const { order, payment } = await buy(c, 'pro', { verify: false, status: 'failed' });
  fake.payments.get(payment.id).error_description = 'Payment was declined by the bank.';
  const r = await webhook('payment.failed', { payment: { entity: fake.payments.get(payment.id) } });
  assert.equal(r.status, 200);
  const st = (await c('GET', `/api/checkout/orders/${order.orderId}`)).body;
  assert.equal(st.status, 'failed'); assert.equal(st.failureReason, 'Payment was declined by the bank.');
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'free');

  const o2 = (await c('POST', '/api/checkout/order', { packageId: 'starter' })).body;
  const f = await c('POST', '/api/checkout/failed', { orderId: o2.orderId, code: 'BAD_REQUEST_ERROR', description: 'Card declined' });
  assert.equal(f.body.status, 'failed'); assert.equal(f.body.failureReason, 'BAD_REQUEST_ERROR: Card declined');
  // a late capture still activates (Razorpay is the source of truth, not the browser)
  const late = makePayment(o2.razorpayOrderId);
  await webhook('payment.captured', { payment: { entity: late } });
  assert.equal((await c('GET', `/api/checkout/orders/${o2.orderId}`)).body.status, 'paid');
});

/* ---------------- refunds ---------------- */
test('refunds: a partial refund keeps the plan; the full refund revokes it', async () => {
  await signup('boss@example.com');
  const owner = await consoleSignIn('boss@example.com');
  const c = await signup();
  const { order, verify } = await buy(c, 'pro');
  assert.equal(verify.body.status, 'paid');
  const payRow = await env.DB.prepare('SELECT id FROM payments WHERE order_id = ?1').bind(order.orderId).first();
  const refund = (who, body) => who('POST', '/api/console/refunds', { paymentId: payRow.id, reasonCode: 'request', ...body });
  assert.equal((await refund(c, {})).status, 401, 'a learner session is not an admin session');
  assert.equal((await refund(owner, { amountPaise: 99999 })).status, 400);
  const part = await refund(owner, { amountPaise: 5000, reasonCode: 'other', reasonText: 'Goodwill after an outage' });
  assert.equal(part.status, 201, JSON.stringify(part.body));
  assert.equal(part.body.orderStatus, 'partially_refunded');
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'pro');
  // the refund.processed webhook for the same refund changes nothing more
  await webhook('refund.processed', { refund: { entity: { ...fake.refunds[fake.refunds.length - 1] } } });
  assert.equal(await count("SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?1 AND status = 'processed'", order.orderId), 1);

  await env.DB.prepare('DELETE FROM rate_limits').run(); // one refund per payment a minute (a double click guard)
  const rest = await refund(owner, {});
  assert.equal(rest.status, 201, JSON.stringify(rest.body));
  assert.equal(rest.body.amountPaise, 14900);
  assert.equal(rest.body.orderStatus, 'refunded');
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'free');
  assert.equal((await env.DB.prepare('SELECT status FROM user_subscriptions WHERE order_id = ?1').bind(order.orderId).first()).status, 'revoked');
  assert.equal((await env.DB.prepare('SELECT status FROM payments WHERE id = ?1').bind(payRow.id).first()).status, 'refunded');
  assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'payment.refund' AND target = ?1", `payment:${payRow.id}`), 2);
  // nothing left to refund, and a replayed capture webhook does not bring the plan back
  await env.DB.prepare('DELETE FROM rate_limits').run();
  assert.equal((await refund(owner, {})).status, 400);
  const p = await env.DB.prepare('SELECT razorpay_payment_id FROM payments WHERE id = ?1').bind(payRow.id).first();
  await webhook('payment.captured', { payment: { entity: { ...fake.payments.get(p.razorpay_payment_id), status: 'captured' } } });
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'free');
});

test('refund made in the Razorpay dashboard arrives by webhook and revokes on a full refund', async () => {
  const c = await signup();
  const { payment } = await buy(c, 'starter');
  await webhook('refund.processed', { refund: { entity: { id: 'rfnd_dashboard01', entity: 'refund', amount: 9900, payment_id: payment.id, status: 'processed' } } });
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'free');
});

/* ---------------- stacking and entitlements ---------------- */
test('buying again while a plan is active stacks: the new period starts when the current one ends', async () => {
  const c = await signup();
  const a = await buy(c, 'starter');
  const b = await buy(c, 'starter');
  assert.equal(b.verify.body.status, 'paid');
  const subs = (await env.DB.prepare('SELECT starts_at, expires_at, order_id FROM user_subscriptions WHERE user_id = ?1 ORDER BY starts_at').bind(c.user.id).all()).results;
  assert.equal(subs.length, 2);
  assert.equal(subs[0].order_id, a.order.orderId);
  assert.equal(subs[1].starts_at, subs[0].expires_at);
  assert.equal(Date.parse(subs[1].expires_at) - Date.parse(subs[1].starts_at), 30 * 86400000);
  const ent = (await c('GET', '/api/me/entitlements')).body;
  assert.equal(ent.expiresAt, subs[1].expires_at);
  assert.equal(ent.subscriptions.length, 2);
  const mine = (await c('GET', '/api/me/subscriptions')).body.subscriptions;
  assert.equal(mine.filter((s) => s.upcoming).length, 1);
  // lifetime never stacks and never expires
  await buy(c, 'lifetime');
  const ent2 = (await c('GET', '/api/me/entitlements')).body;
  assert.equal(ent2.plan, 'lifetime'); assert.equal(ent2.expiresAt, null);
});

test('entitlements: union of active plans, most generous limits, expiry back to Free', async () => {
  const c = await signup();
  const uid = c.user.id;
  const t = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const add = (id, pkg, starts, expires, status = 'active') => env.DB.prepare(
    `INSERT INTO user_subscriptions (id, user_id, package_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
     SELECT ?1, ?2, id, ?5, 'admin', features, limits, ?3, ?4, ?3, ?3 FROM packages WHERE id = ?6`).bind(id, uid, starts, expires, status, pkg).run();
  let ent = await entitlementsFor(env, uid);
  assert.equal(ent.plan, 'free'); assert.deepEqual(ent.limits, { lessons: 'first5', dailyTests: 3, historyDays: 7 });
  await add(`s1-${uid}`, 'starter', t(-10), t(20));
  await add(`s2-${uid}`, 'pro', t(-1), t(2));
  await add(`s3-${uid}`, 'premium', t(-100), t(-1)); // ended, not yet marked expired by the nightly job
  await add(`s4-${uid}`, 'lifetime', t(-5), null, 'revoked');
  ent = await entitlementsFor(env, uid);
  assert.equal(ent.plan, 'pro');
  assert.equal(ent.expiresAt, t(20).slice(0, 10) + ent.expiresAt.slice(10)); // the latest expiry (starter)
  assert.deepEqual(ent.limits, { lessons: 'all', dailyTests: null, historyDays: null });
  assert.ok(has(ent, 'practice.custom') && has(ent, 'arcade.all') && has(ent, 'lessons.first5'));
  assert.ok(!has(ent, 'insights'));
  assert.equal(ent.subscriptions.length, 2);
  // three days later the Pro period is over: Starter alone
  const later = await entitlementsFor(env, uid, t(3));
  assert.equal(later.plan, 'starter'); assert.equal(later.limits.dailyTests, 20); assert.ok(!has(later, 'practice.custom'));
  assert.equal((await entitlementsFor(env, uid, t(21))).plan, 'free');
});

test('lessonAllowed / gameAllowed: Free = first five lessons in course order, placement, review and the Daily Challenge', async () => {
  const free = await entitlementsFor(env, 'nobody');
  assert.deepEqual(FIRST5, globalThis.TC_META.ORDER.slice(0, 5));
  assert.deepEqual(FIRST5, ['l25', 'l1', 'l2', 'l26', 'l3']);
  for (const id of FIRST5) assert.equal(lessonAllowed(free, id), true, id);
  for (const id of ['l4', 'l27', 'l78', 'l24']) assert.equal(lessonAllowed(free, id), false, id);
  assert.equal(lessonAllowed(free, 'placement'), true); assert.equal(lessonAllowed(free, 'review'), true);
  assert.equal(lessonAllowed(free, 'custom'), false);
  assert.equal(gameAllowed(free, 'daily'), true); assert.equal(gameAllowed(free, 'storm'), false);
  const starter = { features: ['lessons.all', 'arcade.all'], limits: { lessons: 'all' } };
  assert.equal(lessonAllowed(starter, 'l78'), true); assert.equal(lessonAllowed(starter, 'custom'), false); assert.equal(gameAllowed(starter, 'storm'), true);
  assert.equal(lessonAllowed({ features: ['practice.custom'], limits: { lessons: 'all' } }, 'custom'), true);
});

test('events gate: locked lessons and games are rejected per event with plan_required; the rest still count', async () => {
  const c = await signup();
  const at = new Date().toISOString();
  const ev = (extra) => ({ id: `gate-${Math.random().toString(36).slice(2, 12)}`, at, tz: 0, ...extra });
  const runL1 = ev({ type: 'run', lessonId: 'l1', wpm: 20, accuracy: 95, seconds: 60 });
  const runL4 = ev({ type: 'run', lessonId: 'l4', wpm: 20, accuracy: 95, seconds: 60 });
  const stepL9 = ev({ type: 'step', lessonId: 'l9', step: 1, kind: 'character', wpm: 20, accuracy: 95, seconds: 30 });
  const storm = ev({ type: 'game', gameId: 'storm', score: 100, xp: 5, seconds: 60 });
  const daily = ev({ type: 'game', gameId: 'daily', score: 100, xp: 5, seconds: 60 });
  const custom = ev({ type: 'run', lessonId: 'custom', wpm: 20, accuracy: 95, seconds: 60 });
  const placement = ev({ type: 'placement', wpm: 25, accuracy: 94, seconds: 120 });
  const r = await c('POST', '/api/user/events', { events: [runL1, runL4, stepL9, storm, daily, custom, placement] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sync.accepted.sort(), [runL1.id, daily.id, placement.id].sort());
  const planRejected = r.body.sync.rejected.filter((x) => x.code === 'plan_required').map((x) => x.id).sort();
  assert.deepEqual(planRejected, [runL4.id, stepL9.id, storm.id, custom.id].sort());
  assert.equal(await count("SELECT n FROM event_rejects WHERE user_id = ?1 AND reason = 'plan_required'", c.user.id), 4);
  // after buying, the same lesson is accepted
  await buy(c, 'starter');
  const r2 = await c('POST', '/api/user/events', { events: [runL4] });
  assert.deepEqual(r2.body.sync.accepted, [runL4.id]);
});

/* ---------------- typing tests and analytics ---------------- */
test('typing tests: Free saves 3 a day, then 402 plan_limit; ids are idempotent; Pro has no limit', async () => {
  const c = await signup();
  const t = (n) => ({ id: `test-${c.user.id.slice(0, 8)}-${n}`, duration: 60, wpm: 40 + n, rawWpm: 44, accuracy: 96, errors: 3, chars: 230, textKind: 'words' });
  for (let i = 1; i <= 3; i++) assert.equal((await c('POST', '/api/me/tests', t(i))).status, 201);
  const dup = await c('POST', '/api/me/tests', t(2));
  assert.equal(dup.status, 200); assert.equal(dup.body.duplicate, true);
  const over = await c('POST', '/api/me/tests', t(4));
  assert.equal(over.status, 402);
  assert.deepEqual(Object.keys(over.body.error).sort(), ['code', 'feature', 'message', 'upgradeUrl']);
  assert.equal(over.body.error.code, 'plan_limit'); assert.equal(over.body.error.upgradeUrl, '/pricing');
  assert.equal((await c('POST', '/api/me/tests', { ...t(5), wpm: 999 })).status, 400);
  const list = (await c('GET', '/api/me/tests')).body;
  assert.equal(list.tests.length, 3); assert.equal(list.today.used, 3); assert.equal(list.today.limit, 3); assert.equal(list.historyDays, 7);
  assert.equal(list.summary.bestWpm, 43);
  await buy(c, 'pro');
  assert.equal((await c('POST', '/api/me/tests', t(4))).status, 201);
  assert.equal((await c('GET', '/api/me/tests')).body.today.limit, null);
});

test('analytics: basic for everyone, advanced and insights only with their features (402 when asked for)', async () => {
  const c = await signup();
  const free = await c('GET', '/api/me/analytics');
  assert.equal(free.status, 200);
  assert.equal(free.body.advanced, null); assert.equal(free.body.insights, null);
  assert.deepEqual(free.body.locked, ['analytics.basic', 'analytics.advanced', 'insights']);
  assert.equal(free.body.basic.days, 7);
  const adv = await c('GET', '/api/me/analytics?section=advanced');
  assert.equal(adv.status, 402); assert.equal(adv.body.error.code, 'plan_required'); assert.equal(adv.body.error.feature, 'analytics.advanced');
  await c('POST', '/api/user/stats', { id: 'stats-an-000001', keyStats: { a: { attempts: 40, errors: 8 } }, bigramLatency: { 't>h': { count: 5, totalMs: 1500 } }, errorClasses: { adjacent: 3 } });
  await buy(c, 'pro');
  const pro = (await c('GET', '/api/me/analytics')).body;
  assert.equal(pro.advanced.keyHeatmap[0].key, 'a'); assert.equal(pro.advanced.keyHeatmap[0].accuracy, 80);
  assert.equal(pro.advanced.slowPairs[0].avgMs, 300); assert.equal(pro.advanced.errorClasses.adjacent, 3);
  assert.equal(pro.insights, null); assert.deepEqual(pro.locked, ['insights']);
  assert.equal((await c('GET', '/api/me/analytics?section=insights')).status, 402);
  await buy(c, 'premium');
  const prem = (await c('GET', '/api/me/analytics?section=insights')).body;
  assert.equal(prem.insights.weakKeys[0].key, 'a'); assert.ok(prem.insights.plan.length >= 2);
});

/* ---------------- admin ---------------- */
test('the admin is the console: the old /api/admin pages API is gone, and a site sign-in never opens an admin endpoint', async () => {
  const learner = await signup();
  const anon = client();
  const owner = client();
  assert.equal((await owner('POST', '/api/auth/login', { email: 'boss@example.com', password: pw })).status, 200);
  // the endpoints of the old /admin pages (Phase 6 removed them): not found for everyone, the owner included
  const gone = ['/api/admin/me', '/api/admin/overview', '/api/admin/users', '/api/admin/packages', '/api/admin/payments', '/api/admin/revenue',
    '/api/admin/settings', '/api/admin/audit', '/api/admin/emails', '/api/admin/contact', '/api/admin/health', `/api/admin/users/${learner.user.id}`];
  for (const p of gone) for (const who of [owner, learner, anon]) assert.equal((await who('GET', p)).status, 404, p);
  assert.equal((await owner('PUT', '/api/admin/packages/pro', { pricePaise: 1 })).status, 404);
  assert.equal((await owner('POST', `/api/admin/users/${learner.user.id}`, { role: 'owner' })).status, 404);
  assert.equal((await owner('POST', '/api/admin/announcements', { subject: 'x', body: 'y' })).status, 404);
  // the console's own endpoints answer only to a console session: the owner's site sign-in is not one
  for (const p of ['/api/console/customers', '/api/console/payments', '/api/console/settings', '/api/admin/permissions', '/api/admin/staff']) {
    for (const who of [owner, learner, anon]) assert.equal((await who('GET', p)).status, 401, p);
  }
  // signed in to the console, the same owner gets in
  const consoleOwner = await consoleSignIn('boss@example.com');
  assert.equal((await consoleOwner('GET', '/api/console/customers')).status, 200);
  assert.equal((await consoleOwner('GET', '/api/admin/overview')).status, 404, 'still gone');
});

/* ---------------- invoices and crons ---------------- */
test('invoice numbers are sequential and never repeat', async () => {
  const rows = (await env.DB.prepare('SELECT number, seq FROM invoices ORDER BY seq').all()).results;
  assert.ok(rows.length >= 8);
  rows.forEach((r, i) => { assert.equal(r.seq, i + 1); assert.equal(r.number, `TC-${r.number.slice(3, 7)}-${String(i + 1).padStart(6, '0')}`); });
  const next = JSON.parse((await env.DB.prepare("SELECT value FROM platform_settings WHERE key = 'invoice_seq'").first()).value).next;
  assert.equal(next, rows.length + 1);
});

test('cron every 10 minutes: an order paid without a browser verify is reconciled with Razorpay', async () => {
  const c = await signup();
  const { order } = await buy(c, 'starter', { verify: false, status: 'authorized' });
  const old = await signup();
  const stale = (await old('POST', '/api/checkout/order', { packageId: 'starter' })).body;
  const back = (min) => new Date(Date.now() - min * 60000).toISOString();
  await env.DB.prepare('UPDATE orders SET created_at = ?2 WHERE id = ?1').bind(order.orderId, back(20)).run();
  await env.DB.prepare('UPDATE orders SET created_at = ?2 WHERE id = ?1').bind(stale.orderId, back(25 * 60)).run();
  const ctx = { waitUntil() {} };
  await billing.cron(env, ctx, '*/10 * * * *');
  assert.equal((await c('GET', `/api/checkout/orders/${order.orderId}`)).body.status, 'paid');
  assert.equal((await c('GET', '/api/me/entitlements')).body.plan, 'starter');
  assert.equal((await old('GET', `/api/checkout/orders/${stale.orderId}`)).body.status, 'cancelled');
  const again = await billing.reconcile(env, ctx);
  assert.equal(again.paid, 0);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_subscriptions WHERE order_id = ?1', order.orderId), 1);
});

test('nightly cron: ended subscriptions expire; renewal reminders go once, 3 days ahead, unless already renewed', async () => {
  const a = await signup(), b = await signup(), d = await signup();
  const t = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const add = (id, uid, starts, expires) => env.DB.prepare(
    `INSERT INTO user_subscriptions (id, user_id, package_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
     SELECT ?1, ?2, id, 'active', 'admin', features, limits, ?3, ?4, ?3, ?3 FROM packages WHERE id = 'starter'`).bind(id, uid, starts, expires).run();
  await add('n-exp', a.user.id, t(-31), t(-1));
  await add('n-soon', b.user.id, t(-28), t(2));
  await add('n-soon2', d.user.id, t(-28), t(2));
  await add('n-renewed', d.user.id, t(2), t(32));
  const ctx = { waitUntil() {} };
  const r = await billing.nightly(env, ctx);
  assert.ok(r.expired >= 1);
  const st = async (id) => (await env.DB.prepare('SELECT status, reminded_at FROM user_subscriptions WHERE id = ?1').bind(id).first());
  assert.equal((await st('n-exp')).status, 'expired');
  assert.ok((await st('n-soon')).reminded_at);
  assert.equal((await st('n-soon2')).reminded_at, null);
  const r2 = await billing.nightly(env, ctx);
  assert.equal(r2.reminded, 0);
  assert.equal((await a('GET', '/api/me/entitlements')).body.plan, 'free');
});

test('deleting an account that has paid orders removes every row of it', async () => {
  const c = await signup();
  await buy(c, 'starter');
  await c('POST', '/api/me/tests', { id: 'test-delete-0001', duration: 30, wpm: 30, accuracy: 90 });
  assert.equal((await c('POST', '/api/user/delete', { password: pw })).status, 200);
  for (const t of ['orders', 'payments', 'invoices', 'user_subscriptions', 'typing_tests']) {
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?1`, c.user.id), 0, t);
  }
});

test('deleting an account keeps its invoices and payments in billing_archive (tax records)', async () => {
  const c = await signup('archive@example.com');
  const r = await buy(c, 'starter');
  assert.equal(r.verify.status, 200, JSON.stringify(r.verify.body));
  const inv = await env.DB.prepare('SELECT number FROM invoices WHERE user_id = ?1').bind(c.user.id).first();
  assert.ok(inv && inv.number);
  const del = await c('POST', '/api/user/delete', { password: pw });
  assert.equal(del.status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM invoices WHERE user_id = ?1', c.user.id), 0);
  const kept = await env.DB.prepare('SELECT * FROM billing_archive WHERE invoice_number = ?1').bind(inv.number).first();
  assert.ok(kept, 'invoice archived');
  assert.equal(kept.billed_email, 'archive@example.com');
  assert.equal(JSON.parse(kept.payments_json)[0].status, 'captured');
});
