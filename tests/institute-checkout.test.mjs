// Buying seats online: Release 3 (docs/INSTITUTES.md §15). Razorpay is the fake in fake-razorpay.mjs
// behind globalThis.fetch: nothing here touches the network or real money.
//   node --test tests/institute-checkout.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { fakeRazorpay } from './fake-razorpay.mjs';
import { newId } from '../src/institute-access.js';
import { addMonths, reconcile, fulfil } from '../src/institute-checkout.js';
import { sendReminders } from '../src/institute-mail.js';

const KEY_ID = 'rzp_test_inst123', KEY_SECRET = 'inst-key-secret', WH_SECRET = 'inst-webhook-secret';
const DAY = 86400000, IST = 330 * 60000;
const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const istStart = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST).toISOString();
const lastDayOf = (endsAt) => istDay(Date.parse(endsAt) - 1);
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const sign = (o, p) => createHmac('sha256', KEY_SECRET).update(`${o}|${p}`).digest('hex');
const PRICES = { 6: 60000, 12: 99900 };

let S, K, fake, owner, admin, support;
before(async () => {
  fake = fakeRazorpay({ keyId: KEY_ID, keySecret: KEY_SECRET });
  fake.install();
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
  S = { env, srv: await startServer(env, 8803) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.86.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
});
after(() => { S.srv.server.close(); fake.restore(); });

const verified = async (email, name = 'Rakesh Sharma') => {
  const who = await K.account({ email, name });
  await K.run('UPDATE users SET email_verified = 1 WHERE id = ?1', who.id);
  return who;
};
const setPrices = (body = {}) => admin('PUT', '/api/console/institutes/pricing', { on: true, packageId: 'premium', minSeats: 10, prices: PRICES, ...body });
async function webhook(event, payment) {
  const raw = JSON.stringify({ entity: 'event', event, payload: { payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) });
  const res = await fetch(S.base + '/api/webhooks/razorpay', { method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', WH_SECRET).update(raw).digest('hex'), 'X-Razorpay-Event-Id': `evt_${Math.random().toString(36).slice(2)}` } });
  return { status: res.status, body: await res.json() };
}
const NEW = { kind: 'new', seats: 20, months: 12, name: 'Sharma Typing Centre', city: 'Gwalior', contactName: 'Rakesh Sharma', contactEmail: 'office@sharma.example.com',
  contactPhone: '+91 98260 11111', gstin: '', agree: true };
/** Pays an order in the fake checkout and confirms it the way the page does. → the verify answer */
async function payAndVerify(who, order, { status = 'captured' } = {}) {
  const p = fake.pay(order.razorpayOrderId, { status });
  const r = await who('POST', '/api/institutes/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(order.razorpayOrderId, p.id) });
  return { r, p };
}

test('online prices: set in the console by money roles; buying stays closed until they are on', async () => {
  const buyer = await verified('closed.buyer@example.com');
  let r = await buyer.learner('GET', '/api/institutes/buy');
  assert.equal(r.status, 200); assert.equal(r.body.open, false); assert.deepEqual(r.body.terms, []);
  r = await buyer.learner('POST', '/api/institutes/checkout', NEW);
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'buying_closed');

  assert.equal((await support('GET', '/api/console/institutes/pricing')).status, 200, 'support can see the prices');
  assert.equal((await support('PUT', '/api/console/institutes/pricing', { on: true })).status, 403);
  r = await admin('PUT', '/api/console/institutes/pricing', { on: true, packageId: 'free', minSeats: 0, prices: { 6: 50, 12: '' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.packageId && r.body.error.fields.minSeats && r.body.error.fields.price6);
  r = await admin('PUT', '/api/console/institutes/pricing', { on: true, packageId: 'premium', minSeats: 10, prices: {} });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.price12, 'on needs a price');
  r = await setPrices();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pricing.on, true); assert.deepEqual(r.body.pricing.terms, [{ months: 6, pricePerSeatPaise: 60000 }, { months: 12, pricePerSeatPaise: 99900 }]);
  const a = await K.one("SELECT detail FROM audit_logs WHERE action = 'institute.pricing' ORDER BY created_at DESC LIMIT 1");
  assert.equal(JSON.parse(a.detail).to.prices[12], 99900);
  r = await buyer.learner('GET', '/api/institutes/buy');
  assert.equal(r.body.open, true); assert.equal(r.body.packageName, 'Premium'); assert.equal(r.body.minSeats, 10);
  // payments switched off in Settings close it too
  await K.run("INSERT INTO platform_settings (key, value, updated_at) VALUES ('payments', '{\"enabled\":false}', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", iso(0));
  assert.equal((await buyer.learner('GET', '/api/institutes/buy')).body.open, false);
  await K.run("DELETE FROM platform_settings WHERE key = 'payments'");
});

test('a new institute: checked on the server, paid in Razorpay, switched on once with the payer as admin, invoice emailed', async () => {
  await setPrices();
  const unverified = await K.account({ email: 'unverified.buyer@example.com' });
  let r = await unverified.learner('POST', '/api/institutes/checkout', NEW);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'verify_email');
  const buyer = await verified('rakesh.buyer@example.com');
  r = await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, seats: 5, months: 3, agree: false, contactEmail: 'nope', gstin: 'bad' });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.body.error.fields).sort(), ['agree', 'contactEmail', 'gstin', 'months', 'seats']);
  assert.match(r.body.error.fields.seats, /at least 10/);
  r = await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, seats: 600 });
  assert.equal(r.status, 400); assert.match(r.body.error.fields.seats, /up to ₹5,00,000/, '600 × ₹999 is over the online limit');

  // the price is the server's: 20 seats × ₹999
  r = await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, amountPaise: 100, pricePerSeatPaise: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const order = r.body;
  assert.equal(order.amountPaise, 20 * 99900); assert.equal(order.keyId, KEY_ID); assert.match(order.orderId, /^iord_[0-9a-f]{20}$/);
  assert.equal(fake.orders.get(order.razorpayOrderId).amount, 20 * 99900);
  assert.equal(fake.orders.get(order.razorpayOrderId).notes.instituteOrderId, order.orderId);
  // a second click reuses the same order
  r = await buyer.learner('POST', '/api/institutes/checkout', NEW);
  assert.equal(r.body.orderId, order.orderId);
  // someone else can't confirm or read it
  const other = await verified('other.buyer@example.com');
  assert.equal((await other.learner('GET', `/api/institutes/checkout/orders/${order.orderId}`)).status, 404);

  // a forged signature changes nothing
  const p = fake.pay(order.razorpayOrderId);
  r = await buyer.learner('POST', '/api/institutes/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: 'f'.repeat(64) });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'bad_signature');
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Sharma Typing Centre'")).n, 0);

  r = await buyer.learner('POST', '/api/institutes/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(order.razorpayOrderId, p.id) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'paid'); assert.match(r.body.instituteId, /^ins_/); assert.match(r.body.invoiceNumber, /^TC-\d{4}-\d{6}$/);
  const id = r.body.instituteId;
  const ins = await K.one('SELECT * FROM institutes WHERE id = ?1', id);
  const today = istDay();
  assert.equal(ins.status, 'active'); assert.equal(ins.seats, 20); assert.equal(ins.package_id, 'premium'); assert.equal(ins.price_paise, 99900);
  assert.equal(ins.starts_at, istStart(today)); assert.equal(ins.ends_at, istStart(addMonths(today, 12)));
  assert.equal(ins.contact_email, 'office@sharma.example.com'); assert.equal(ins.created_by, buyer.id);
  const st = await K.many('SELECT * FROM institute_staff WHERE institute_id = ?1', id);
  assert.equal(st.length, 1); assert.equal(st[0].user_id, buyer.id); assert.equal(st[0].role, 'admin'); assert.equal(st[0].status, 'active');
  const pays = await K.many('SELECT * FROM institute_payments WHERE institute_id = ?1', id);
  assert.equal(pays.length, 1); assert.equal(pays[0].amount_paise, 20 * 99900); assert.equal(pays[0].method, 'other'); assert.equal(pays[0].reference, p.id);

  // the same payment again, by the browser and by two webhooks at once: still one institute, one payment
  const again = await Promise.all([
    buyer.learner('POST', '/api/institutes/checkout/verify', { orderId: order.orderId, razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(order.razorpayOrderId, p.id) }),
    webhook('payment.captured', fake.payments.get(p.id)), webhook('order.paid', fake.payments.get(p.id)),
  ]);
  assert.equal(again[0].body.instituteId, id); assert.equal(again[1].status, 200); assert.equal(again[2].status, 200);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Sharma Typing Centre'")).n, 1);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM institute_payments WHERE institute_id = ?1', id)).n, 1);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'institute.order_paid' AND target = ?1", `institute:${id}`)).n, 1);

  // the buyer runs it now: the institute page, the invoice, the email
  r = await buyer.learner('GET', `/api/institutes/${id}`);
  assert.equal(r.status, 200); assert.equal(r.body.role, 'admin');
  r = await buyer.learner('GET', `/api/institutes/${id}/invoices/${again[0].body.invoiceNumber}`);
  assert.equal(r.status, 200);
  assert.match(r.body.invoice.lines[0].description, new RegExp(`Premium plan for 20 students \\(seats\\), ${today} to ${lastDayOf(ins.ends_at)}`));
  assert.deepEqual(r.body.invoice.payment, { method: 'Online (Razorpay)', reference: p.id, paidOn: today });
  const mails = await K.many("SELECT to_email, subject FROM email_logs WHERE template = 'institute_payment'");
  assert.deepEqual(mails.map((m) => m.to_email).sort(), ['office@sharma.example.com', 'rakesh.buyer@example.com']);
  assert.match(mails[0].subject, /Sharma Typing Centre: payment received, invoice TC-/);
  r = await buyer.learner('GET', `/api/institutes/checkout/orders/${order.orderId}`);
  assert.equal(r.body.status, 'paid'); assert.equal(r.body.instituteId, id); assert.equal(r.body.invoiceNumber, again[0].body.invoiceNumber);
  // the console sees it in the institute's history
  const one = (await admin('GET', `/api/console/institutes/${id}`)).body;
  assert.ok(one.history.some((h) => h.action === 'institute.order_paid' && /20 seats for 12 months/.test(h.note || '')), JSON.stringify(one.history));
});

test("the browser's word is never enough: failed, wrong amount and only-authorized payments", async () => {
  await setPrices();
  const buyer = await verified('careful.buyer@example.com');
  const make = async (name) => (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name, seats: 10 })).body;
  // a valid signature, but Razorpay says the payment failed
  let o = await make('Failed Academy');
  let { r } = await payAndVerify(buyer.learner, o, { status: 'failed' });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'failed');
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Failed Academy'")).n, 0);
  // the page reports a failure: shown back, nothing switched on
  r = await buyer.learner('POST', '/api/institutes/checkout/failed', { orderId: o.orderId, code: 'BAD_REQUEST_ERROR', description: 'Card declined' });
  assert.equal(r.body.status, 'failed'); assert.match(r.body.failureReason, /Card declined/);

  // a payment for a smaller amount, signed for this order
  o = await make('Cheap Academy');
  const small = fake.pay(o.razorpayOrderId, { amount: 100 });
  r = await buyer.learner('POST', '/api/institutes/checkout/verify', { orderId: o.orderId, razorpay_order_id: o.razorpayOrderId, razorpay_payment_id: small.id, razorpay_signature: sign(o.razorpayOrderId, small.id) });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'payment_mismatch');
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Cheap Academy'")).n, 0);

  // only authorized: the server captures it, then switches the seats on
  o = await make('Authorized Academy');
  ({ r } = await payAndVerify(buyer.learner, o, { status: 'authorized' }));
  assert.equal(r.body.status, 'paid');
  assert.ok(fake.calls.some((c) => /\/capture$/.test(c)));
  assert.equal((await K.one("SELECT seats FROM institutes WHERE name = 'Authorized Academy'")).seats, 10);
});

test('the window closed before the page could confirm: the webhook or the 10-minute check switches the seats on', async () => {
  await setPrices();
  const buyer = await verified('closed.window@example.com');
  // by webhook
  let o = (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Webhook Academy', seats: 12, months: 6 })).body;
  assert.equal(o.amountPaise, 12 * 60000);
  let p = fake.pay(o.razorpayOrderId);
  let w = await webhook('payment.captured', p);
  assert.equal(w.status, 200);
  const ins = await K.one("SELECT * FROM institutes WHERE name = 'Webhook Academy'");
  assert.equal(ins.seats, 12); assert.equal(ins.ends_at, istStart(addMonths(istDay(), 6)));
  assert.equal((await K.one("SELECT status FROM webhook_events WHERE event = 'payment.captured' ORDER BY received_at DESC LIMIT 1")).status, 'processed');
  // a failed attempt by webhook marks the order failed
  o = (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Declined Academy', seats: 10 })).body;
  p = fake.pay(o.razorpayOrderId, { status: 'failed', error: 'Bank declined' });
  await webhook('payment.failed', p);
  assert.equal((await K.one('SELECT status FROM institute_orders WHERE id = ?1', o.orderId)).status, 'failed');
  // an event for an order nobody knows is ignored
  w = await webhook('payment.captured', { id: 'pay_unknownFAKE', order_id: 'order_unknownFAKE', amount: 100, currency: 'INR', status: 'captured' });
  assert.equal(w.status, 200);

  // by the scheduled check
  o = (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Cron Academy', seats: 10 })).body;
  fake.pay(o.razorpayOrderId);
  await K.run('UPDATE institute_orders SET created_at = ?2 WHERE id = ?1', o.orderId, iso(-20 / 1440));
  // an order nobody paid for in a day is cancelled
  const stale = (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Never Paid Academy', seats: 10 })).body;
  await K.run('UPDATE institute_orders SET created_at = ?2 WHERE id = ?1', stale.orderId, iso(-2));
  const out = await reconcile(S.env, { waitUntil() {} });
  assert.ok(out.paid >= 1 && out.cancelled >= 1, JSON.stringify(out));
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Cron Academy'")).n, 1);
  assert.equal((await K.one('SELECT status FROM institute_orders WHERE id = ?1', stale.orderId)).status, 'cancelled');
  // calling fulfil again for a paid order changes nothing
  const paid = await K.one("SELECT * FROM institute_orders WHERE details LIKE '%Cron Academy%'");
  await fulfil(S.env, { waitUntil() {} }, paid.id, paid.razorpay_payment_id);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Cron Academy'")).n, 1);
});

test('the page, the webhook and the scheduled check all at once: one institute, one payment, one invoice', async () => {
  await setPrices();
  const buyer = await verified('race.buyer@example.com');
  const o = (await buyer.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Race Academy', seats: 10 })).body;
  const p = fake.pay(o.razorpayOrderId);
  await K.run('UPDATE institute_orders SET created_at = ?2 WHERE id = ?1', o.orderId, iso(-20 / 1440));
  const body = { orderId: o.orderId, razorpay_order_id: o.razorpayOrderId, razorpay_payment_id: p.id, razorpay_signature: sign(o.razorpayOrderId, p.id) };
  const all = await Promise.all([buyer.learner('POST', '/api/institutes/checkout/verify', body), webhook('payment.captured', p), webhook('order.paid', p),
    reconcile(S.env, { waitUntil() {} }), buyer.learner('POST', '/api/institutes/checkout/verify', body)]);
  assert.equal(all[0].body.status, 'paid'); assert.equal(all[4].body.instituteId, all[0].body.instituteId);
  const id = all[0].body.instituteId;
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institutes WHERE name = 'Race Academy'")).n, 1);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM institute_staff WHERE institute_id = ?1', id)).n, 1);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM institute_payments WHERE institute_id = ?1', id)).n, 1);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM institute_invoices WHERE institute_id = ?1', id)).n, 1);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM email_logs WHERE template = 'institute_payment' AND to_email = 'race.buyer@example.com'")).n, 1);
});

test('more seats mid-term and a renewal: for the admin only, priced on the server, added once', async () => {
  await setPrices();
  const boss = await verified('topup.boss@example.com');
  const o = (await boss.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Topup Academy', seats: 10 })).body;
  const id = (await payAndVerify(boss.learner, o)).r.body.instituteId;
  const teacher = await verified('topup.teacher@example.com');
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'teacher', 'active', ?5, ?5)`,
    newId('stf'), id, teacher.id, teacher.email, iso(0));
  const stranger = await verified('topup.stranger@example.com');
  assert.equal((await teacher.learner('GET', `/api/institutes/${id}/buy`)).status, 403);
  assert.equal((await stranger.learner('GET', `/api/institutes/${id}/buy`)).status, 404);
  assert.equal((await stranger.learner('POST', '/api/institutes/checkout', { kind: 'seats', instituteId: id, seats: 5 })).status, 404);

  let q = (await boss.learner('GET', `/api/institutes/${id}/buy`)).body;
  assert.equal(q.open, true); assert.equal(q.seats, 10);
  const ins = await K.one('SELECT * FROM institutes WHERE id = ?1', id);
  const days = Math.ceil((Date.parse(ins.ends_at) - Date.parse(istStart(istDay()))) / DAY);
  const per = Math.ceil(Math.ceil(99900 * days * 12 / (12 * 365)) / 100) * 100;
  assert.equal(q.addSeats.days, days); assert.equal(q.addSeats.pricePerSeatPaise, per);
  assert.equal(q.renew.available, false, 'renewing opens 60 days before the last day');

  // five more seats
  let r = await boss.learner('POST', '/api/institutes/checkout', { kind: 'seats', instituteId: id, seats: 5, amountPaise: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.amountPaise, 5 * per);
  r = (await payAndVerify(boss.learner, r.body)).r;
  assert.equal(r.body.status, 'paid'); assert.equal(r.body.instituteId, id);
  assert.equal((await K.one('SELECT seats FROM institutes WHERE id = ?1', id)).seats, 15);
  const inv = (await boss.learner('GET', `/api/institutes/${id}/invoices/${r.body.invoiceNumber}`)).body.invoice;
  assert.match(inv.lines[0].description, new RegExp(`^5 more seats on the TypeCraft Premium plan, ${istDay()} to ${lastDayOf(ins.ends_at)}$`));
  assert.equal(inv.totalPaise, 5 * per);

  // a renewal is too early now
  r = await boss.learner('POST', '/api/institutes/checkout', { kind: 'renew', instituteId: id, seats: 15, months: 12 });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'too_early');
  // 20 days left: the next term starts the day after the last day
  const ends = istStart(istDay(Date.now() + 21 * DAY));
  await K.run('UPDATE institutes SET ends_at = ?2 WHERE id = ?1', id, ends);
  q = (await boss.learner('GET', `/api/institutes/${id}/buy`)).body;
  const from = istDay(Date.parse(ends));
  assert.equal(q.renew.available, true); assert.equal(q.renew.from, from); assert.equal(q.renew.minSeats, 10);
  assert.deepEqual(q.renew.terms.map((t) => t.to), [lastDayOf(istStart(addMonths(from, 6))), lastDayOf(istStart(addMonths(from, 12)))]);
  r = await boss.learner('POST', '/api/institutes/checkout', { kind: 'renew', instituteId: id, seats: 8, months: 6 });
  assert.equal(r.status, 400); assert.match(r.body.error.fields.seats, /at least 10/);
  r = await boss.learner('POST', '/api/institutes/checkout', { kind: 'renew', instituteId: id, seats: 12, months: 6 });
  assert.equal(r.body.amountPaise, 12 * 60000);
  r = (await payAndVerify(boss.learner, r.body)).r;
  assert.equal(r.body.status, 'paid');
  const after = await K.one('SELECT * FROM institutes WHERE id = ?1', id);
  assert.equal(after.seats, 12); assert.equal(after.ends_at, istStart(addMonths(from, 6))); assert.equal(after.price_paise, 60000);
  const rinv = (await boss.learner('GET', `/api/institutes/${id}/invoices/${r.body.invoiceNumber}`)).body.invoice;
  assert.match(rinv.lines[0].description, new RegExp(`for 12 students \\(seats\\), ${from} to ${lastDayOf(after.ends_at)} \\(renewal\\)$`));

  // an institute on a plan that isn't sold online, or paused: not for sale here
  await K.run("UPDATE institutes SET package_id = 'pro' WHERE id = ?1", id);
  q = (await boss.learner('GET', `/api/institutes/${id}/buy`)).body;
  assert.equal(q.open, false); assert.equal(q.why, 'plan');
  r = await boss.learner('POST', '/api/institutes/checkout', { kind: 'seats', instituteId: id, seats: 1 });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'not_for_sale');
  await K.run("UPDATE institutes SET package_id = 'premium', status = 'suspended' WHERE id = ?1", id);
  assert.equal((await boss.learner('GET', `/api/institutes/${id}/buy`)).body.why, 'status');
});

test('paid for an institute that was closed meanwhile: recorded for a refund, nothing switched on', async () => {
  await setPrices();
  const boss = await verified('closed.boss@example.com');
  const o = (await boss.learner('POST', '/api/institutes/checkout', { ...NEW, name: 'Closing Academy', seats: 10 })).body;
  const id = (await payAndVerify(boss.learner, o)).r.body.instituteId;
  const add = (await boss.learner('POST', '/api/institutes/checkout', { kind: 'seats', instituteId: id, seats: 3 })).body;
  await K.run("UPDATE institutes SET status = 'closed' WHERE id = ?1", id);
  const p = fake.pay(add.razorpayOrderId);
  await webhook('payment.captured', p);
  assert.equal((await K.one('SELECT seats FROM institutes WHERE id = ?1', id)).seats, 10);
  const row = await K.one('SELECT status, failure_reason FROM institute_orders WHERE id = ?1', add.orderId);
  assert.equal(row.status, 'paid'); assert.match(row.failure_reason, /refund it from the Razorpay dashboard/);
  const a = await K.one("SELECT detail FROM audit_logs WHERE action = 'institute.order_paid' AND detail LIKE ?1", `%${add.orderId}%`);
  assert.equal(JSON.parse(a.detail).applied, false);
});

test("reminders say the seats can be bought online, only for an institute on the plan sold online", async () => {
  await setPrices();
  const mk = async (name, pkg) => {
    const id = newId('ins');
    await K.run(`INSERT INTO institutes (id, name, contact_email, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 10, 0, ?5, ?6, 'active', ?5, ?5)`, id, name, `${pkg}.office@example.com`, pkg, iso(-300), iso(6));
    return id;
  };
  await mk('Online Plan Centre', 'premium'); await mk('Other Plan Centre', 'pro');
  await sendReminders(S.env, { waitUntil() {} });
  const data = async (email) => JSON.parse((await K.one("SELECT payload FROM email_logs WHERE template = 'institute_reminder' AND to_email = ?1", email)).payload).data;
  assert.equal((await data('premium.office@example.com')).online, true);
  assert.equal((await data('pro.office@example.com')).online, false);
});

test('addMonths keeps the date, or the last day of a shorter month', () => {
  assert.equal(addMonths('2026-11-19', 12), '2027-11-19');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2027-08-31', 6), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});
