// Admin console, Phase 4c: coupons and promotions, and what customers pay with them (docs/ADMIN-PHASE-4.md §7).
// Razorpay is a small fake behind globalThis.fetch.
//   node --test tests/console-coupons.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode } from './console-kit.mjs';
import { discountPaise, bestPromotion, withSales } from '../src/pricing.js';
import { forgetAll } from '../src/memo.js';

const KEY_ID = 'rzp_test_abc123', KEY_SECRET = 'key-secret-xyz';
const realFetch = globalThis.fetch;
const DAY = 86400000;
let S, K, owner, admin, support;

const fake = { orders: new Map(), payments: new Map(), n: 0 };
const rid = (p) => `${p}_${(++fake.n).toString(36).padStart(8, '0')}FAKE`;
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeRazorpay(url, init = {}) {
  const path = new URL(url).pathname.replace(/^\/v1/, ''), method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  let m;
  if (method === 'POST' && path === '/orders') {
    const o = { id: rid('order'), entity: 'order', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: 'created' };
    fake.orders.set(o.id, o);
    return reply(200, o);
  }
  if (method === 'GET' && (m = path.match(/^\/payments\/(\w+)$/))) return fake.payments.has(m[1]) ? reply(200, fake.payments.get(m[1])) : reply(404, {});
  if (method === 'GET' && (m = path.match(/^\/orders\/(\w+)\/payments$/))) {
    const items = [...fake.payments.values()].filter((p) => p.order_id === m[1]);
    return reply(200, { entity: 'collection', count: items.length, items });
  }
  return reply(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'no route' } });
}
const sign = (o, p) => createHmac('sha256', KEY_SECRET).update(`${o}|${p}`).digest('hex');

before(async () => {
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.razorpay.com/') ? fakeRazorpay(url, init) : realFetch(url, init));
  const env = makeEnv({ OWNER_EMAILS: 'boss@example.com', SITE_URL: 'https://typecraft.test', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET });
  S = { env, srv: await startServer(env, 8773) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.73.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
});
after(() => { S.srv.server.close(); globalThis.fetch = realFetch; });

let learnerN = 0;
const learner = async () => (await K.account({ email: `buyer${++learnerN}@example.com`, name: 'Asha Buyer' })).learner;
/** Checkout and pay through the fake Razorpay. → the order answer */
async function buy(c, packageId, code) {
  const o = await c('POST', '/api/checkout/order', { packageId, code });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(fake.orders.get(o.body.razorpayOrderId).amount, o.body.amountPaise, 'Razorpay is asked for the same amount');
  const p = { id: rid('pay'), entity: 'payment', order_id: o.body.razorpayOrderId, amount: o.body.amountPaise, currency: 'INR', status: 'captured', method: 'upi' };
  fake.payments.set(p.id, p);
  const v = await c('POST', '/api/checkout/verify', { orderId: o.body.orderId, razorpay_order_id: p.order_id, razorpay_payment_id: p.id, razorpay_signature: sign(p.order_id, p.id) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, 'paid');
  await K.settle();
  return { ...o.body, invoiceNumber: v.body.invoiceNumber };
}
const quote = (c, packageId, code) => c('POST', '/api/checkout/quote', { packageId, code });
const coupon = async (c, body) => {
  const r = await c('POST', '/api/console/coupons', { kind: 'percent', value: 10, plans: [], oncePerCustomer: true, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
};

/* ---------------- the arithmetic ---------------- */
test('discounts: a percentage is rounded to whole rupees, and a paid plan never costs less than ₹1', () => {
  assert.equal(discountPaise('percent', 30, 19900), 6000);  // ₹199 → ₹139
  assert.equal(discountPaise('percent', 15, 9900), 1500);   // ₹99 → ₹84 (14.85 rounds to 15)
  assert.equal(discountPaise('fixed', 5000, 19900), 5000);
  assert.equal(discountPaise('fixed', 50000, 9900), 9800);  // capped: ₹1 is left to pay
  assert.equal(discountPaise('percent', 90, 100), 0);
  const list = [
    { id: 'a', name: 'Small', kind: 'percent', value: 10, plans: [], startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() },
    { id: 'b', name: 'Big', kind: 'fixed', value: 5000, plans: ['pro'], startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() },
    { id: 'c', name: 'Later', kind: 'percent', value: 80, plans: [], startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString() },
  ];
  assert.equal(bestPromotion(list, 'pro', 19900).promotion.id, 'b');
  assert.equal(bestPromotion(list, 'starter', 9900).promotion.id, 'a');
  const [free, starter] = withSales([{ id: 'free', pricePaise: 0 }, { id: 'starter', pricePaise: 9900 }], list);
  assert.equal(free.sale, undefined);
  assert.deepEqual([starter.pricePaise, starter.listPricePaise, starter.sale.name, starter.sale.off], [8900, 9900, 'Small', '10% off']);
});

/* ---------------- coupons in the console ---------------- */
let DIWALI;
test('coupons: Super Admin makes them; Admin only once allowed; every field is checked', async () => {
  assert.equal((await admin('POST', '/api/console/coupons', { code: 'NOPE10', kind: 'percent', value: 10 })).status, 403, 'off for Admin by default');
  assert.equal((await support('GET', '/api/console/coupons')).status, 200, 'Support may look');
  const bad = await owner('POST', '/api/console/coupons', { code: 'x', kind: 'percent', value: 95, plans: ['gold'], startsAt: '2026-12-10T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', maxUses: 0 });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['code', 'endsAt', 'maxUses', 'plans', 'value']);
  assert.equal((await owner('POST', '/api/console/coupons', { code: 'FLAT', kind: 'fixed', value: 0 })).body.error.fields.value, 'Give an amount from ₹1 to ₹1,00,000.');

  DIWALI = await coupon(owner, { code: 'diwali30', note: 'Diwali emails', kind: 'percent', value: 30 });
  assert.equal((await owner('POST', '/api/console/coupons', { code: 'DIWALI30', kind: 'percent', value: 5 })).body.error.fields.code, 'Another coupon already has this code.');
  const list = await support('GET', '/api/console/coupons');
  assert.equal(list.body.items[0].code, 'DIWALI30', 'kept in capitals');
  assert.equal(list.body.items[0].state, 'live');
  assert.equal(list.body.items[0].plansLabel, 'Every paid plan');
  assert.deepEqual(list.body.items[0].examples.find((x) => x.id === 'pro'), { id: 'pro', name: 'Pro', listPaise: 19900, pricePaise: 13900 });
  assert.equal(list.body.can.manage, false);

  await K.setPermission('admin', 'coupons.manage', true);
  try {
    const ok = await admin('POST', '/api/console/coupons', { code: 'KAVITA5', kind: 'percent', value: 5 });
    assert.equal(ok.status, 201, 'allowed once switched on');
    assert.equal((await admin('DELETE', `/api/console/coupons/${ok.body.id}`, {})).status, 200, 'never used, so it can go');
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'coupons.manage'"); }
  // sensitive: a stale session is asked for the password again
  await K.stale(owner);
  assert.equal((await owner('POST', '/api/console/coupons', { code: 'LATER1', kind: 'percent', value: 5 })).body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' })).status, 200);
});

let buyerA, paidA;
test('checkout with a code: the price drops, Razorpay is asked for the lower amount, and the invoice shows the discount', async () => {
  buyerA = await learner();
  const bad = await quote(buyerA, 'pro', 'NOSUCHCODE');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.fields.code, "That code isn't valid. Check the spelling.");
  const q = await quote(buyerA, 'pro', ' diwali30 ');
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.deepEqual([q.body.listPaise, q.body.pricePaise], [19900, 13900]);
  assert.deepEqual(q.body.discount, { source: 'coupon', label: 'Coupon DIWALI30', name: '30% off', paise: 6000, code: 'DIWALI30' });
  const none = await quote(buyerA, 'pro', '');
  assert.deepEqual([none.body.pricePaise, none.body.discount], [19900, null]);

  paidA = await buy(buyerA, 'pro', 'DIWALI30');
  assert.equal(paidA.amountPaise, 13900);
  const inv = await buyerA('GET', `/api/me/invoices/${paidA.invoiceNumber}`);
  assert.equal(inv.status, 200);
  assert.deepEqual(inv.body.invoice.lines.map((l) => [l.description, l.amountPaise]), [['TypeCraft Pro plan (90 days)', 19900], ['Discount: Coupon DIWALI30', -6000]]);
  assert.equal(inv.body.invoice.totalPaise, 13900);
  // once per customer
  assert.equal((await quote(buyerA, 'starter', 'DIWALI30')).body.error.fields.code, "You've already used that code.");
  // the console: counted, and listed on its page and on the payment
  const c = await support('GET', `/api/console/coupons/${DIWALI}`);
  assert.equal(c.body.coupon.uses, 1);
  assert.deepEqual(c.body.totals, { orders: 1, salesPaise: 13900, discountPaise: 6000 });
  assert.equal(c.body.orders[0].id, paidA.orderId);
  const pay = await support('GET', `/api/console/payments/${paidA.orderId}`);
  assert.deepEqual(pay.body.discount, { source: 'coupon', label: 'Coupon DIWALI30', code: 'DIWALI30', listPaise: 19900, discountPaise: 6000, couponId: DIWALI });
  // a used code keeps its name, and stays as a record
  assert.match((await owner('PUT', `/api/console/coupons/${DIWALI}`, { code: 'DIWALI40', kind: 'percent', value: 30 })).body.error.fields.code, /can't be renamed/);
  assert.equal((await owner('DELETE', `/api/console/coupons/${DIWALI}`, {})).status, 409);
  const report = await owner('GET', '/api/console/reports?range=7d');
  assert.equal(report.body.totals.gross.now, 13900, 'reports count what was paid');
});

test('codes that do not apply: wrong plan, not started, expired, used up, turned off', async () => {
  const b = await learner();
  await coupon(owner, { code: 'STARTERONLY', plans: ['starter'] });
  assert.equal((await quote(b, 'pro', 'starteronly')).body.error.fields.code, "That code isn't for the Pro plan.");
  assert.equal((await quote(b, 'starter', 'starteronly')).body.pricePaise, 8900);
  await coupon(owner, { code: 'SOON', startsAt: new Date(Date.now() + DAY).toISOString() });
  assert.equal((await quote(b, 'pro', 'SOON')).body.error.fields.code, "That code can't be used yet.");
  const old = await coupon(owner, { code: 'OLDONE' });
  await K.run('UPDATE coupons SET ends_at = ?2 WHERE id = ?1', old, new Date(Date.now() - 60000).toISOString());
  assert.equal((await quote(b, 'pro', 'OLDONE')).body.error.fields.code, 'That code has expired.');
  const single = await coupon(owner, { code: 'ONLYONE', maxUses: 1 });
  await buy(await learner(), 'starter', 'ONLYONE');
  assert.equal((await quote(b, 'pro', 'ONLYONE')).body.error.fields.code, 'That code has been used up.');
  assert.equal((await owner('GET', '/api/console/coupons?status=used_up')).body.items.map((x) => x.id)[0], single);
  const off = await coupon(owner, { code: 'SWITCHED' });
  assert.equal((await owner('PUT', `/api/console/coupons/${off}`, { active: false })).status, 200);
  assert.equal((await quote(b, 'pro', 'SWITCHED')).body.error.fields.code, "That code isn't valid. Check the spelling.");
  // a big fixed amount still leaves ₹1 to pay
  await coupon(owner, { code: 'HUGE', kind: 'fixed', value: 5000 });
  assert.equal((await quote(b, 'starter', 'HUGE')).body.pricePaise, 100);
  // an order started with a code that stops working is refused, not charged at the wrong price
  await K.run("UPDATE coupons SET active = 0 WHERE code = 'HUGE'");
  const o = await b('POST', '/api/checkout/order', { packageId: 'starter', code: 'HUGE' });
  assert.equal(o.status, 400);
  assert.ok(o.body.error.fields.code);
});

/* ---------------- sales ---------------- */
let SALE;
test('a sale: lower prices everywhere, the better of sale and coupon applies, never both', async () => {
  assert.equal((await admin('POST', '/api/console/promotions', { name: 'Diwali sale', kind: 'percent', value: 30, endsAt: new Date(Date.now() + 2 * DAY).toISOString() })).status, 403);
  const bad = await owner('POST', '/api/console/promotions', { name: 'x', kind: 'percent', value: 30 });
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['endsAt', 'name']);
  const r = await owner('POST', '/api/console/promotions', { name: 'Diwali sale', kind: 'percent', value: 30, plans: [], endsAt: new Date(Date.now() + 2 * DAY).toISOString() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  SALE = r.body.id;

  const pk = await K.client()('GET', '/api/packages');
  const pro = pk.body.packages.find((p) => p.id === 'pro'), free = pk.body.packages.find((p) => p.id === 'free');
  assert.deepEqual([pro.pricePaise, pro.listPricePaise, pro.sale.name, pro.sale.off], [13900, 19900, 'Diwali sale', '30% off']);
  assert.equal(free.sale, undefined);
  const page = await K.client()('GET', '/pricing');
  assert.ok(page.text.includes('"listPricePaise":19900') && page.text.includes('id="saleNote"'), 'the pricing page draws the sale at once');
  assert.ok(page.text.includes('"price":"139.00"'), 'and its structured data gives the sale price');

  const b = await learner();
  // a smaller coupon: the sale price, and the code stays unused
  await coupon(owner, { code: 'TENOFF', kind: 'percent', value: 10 });
  const small = await quote(b, 'pro', 'TENOFF');
  assert.equal(small.body.pricePaise, 13900);
  assert.equal(small.body.discount.source, 'promotion');
  assert.match(small.body.note, /Diwali sale price/);
  // a bigger coupon wins instead of the sale
  await coupon(owner, { code: 'HALF', kind: 'percent', value: 50 });
  const big = await quote(b, 'pro', 'HALF');
  assert.deepEqual([big.body.pricePaise, big.body.discount.source], [9900, 'coupon']);
  // paying with no code: the sale price, recorded against the sale
  const paid = await buy(b, 'pro');
  assert.equal(paid.amountPaise, 13900);
  assert.equal(paid.discount.label, 'Diwali sale');
  const one = (await K.many('SELECT source, promotion_id, coupon_id FROM order_discounts WHERE order_id = ?1', paid.orderId))[0];
  assert.deepEqual(one, { source: 'promotion', promotion_id: SALE, coupon_id: null });
  const list = await support('GET', '/api/console/promotions');
  assert.equal(list.body.items[0].orders, 1);
  assert.equal(list.body.items[0].state, 'live');
  assert.equal((await owner('DELETE', `/api/console/promotions/${SALE}`, {})).status, 409, 'bought at this price: kept as a record');

  // turned off: prices are back at once
  assert.equal((await owner('PUT', `/api/console/promotions/${SALE}`, { active: false })).status, 200);
  assert.equal((await K.client()('GET', '/api/packages')).body.packages.find((p) => p.id === 'pro').pricePaise, 19900);
  // one that starts tomorrow changes nothing today
  const later = await owner('POST', '/api/console/promotions', { name: 'New year sale', kind: 'fixed', value: 50, startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 3 * DAY).toISOString() });
  assert.equal(later.status, 201);
  assert.equal((await K.client()('GET', '/api/packages')).body.packages.find((p) => p.id === 'pro').sale, undefined);
  assert.deepEqual((await support('GET', '/api/console/promotions?status=scheduled')).body.items.map((x) => x.name), ['New year sale']);
  assert.equal((await owner('DELETE', `/api/console/promotions/${later.body.id}`, {})).status, 200);
  assert.deepEqual((await K.audits('promotion.%')).map((a) => a.action), ['promotion.create', 'promotion.off', 'promotion.create', 'promotion.delete']);
});

/* ---------------- pages ---------------- */
test('pages: frames without inline code; Support sees coupons and sales but not the buttons to make them', async () => {
  for (const p of ['/admin/coupons', `/admin/coupons/${DIWALI}`, '/admin/promotions']) {
    const r = await owner('GET', p);
    assert.equal(r.status, 200, p);
    assertNoInlineCode(r.text);
  }
  assert.ok((await owner('GET', '/admin/coupons')).text.includes('id="newCoupon"'));
  assert.ok(!(await support('GET', '/admin/coupons')).text.includes('id="newCoupon"'));
  assert.ok((await owner('GET', '/admin/promotions')).text.includes('id="newPromotion"'));
  assert.ok(!(await support('GET', '/admin/promotions')).text.includes('id="newPromotion"'));
  assert.match((await owner('GET', '/admin/promotions')).text, /<a class="nav-item is-current" href="\/admin\/promotions" aria-current="page">/);
  const checkout = await buyerA('GET', '/checkout?plan=pro');
  assert.equal(checkout.status, 200);
});

/* ---------------- before the migration ---------------- */
test('before migration 0016: prices as they are, codes refused politely, checkout works, the console says so', async () => {
  for (const t of ['order_discounts', 'coupons', 'promotions']) await K.run(`DROP TABLE ${t}`);
  forgetAll(S.env);
  const b = await learner();
  assert.equal((await K.client()('GET', '/api/packages')).body.packages.find((p) => p.id === 'pro').pricePaise, 19900);
  assert.match((await quote(b, 'pro', 'DIWALI30')).body.error.fields.code, /can't be used right now/);
  const paid = await buy(b, 'pro');
  assert.equal(paid.amountPaise, 19900);
  const inv = await b('GET', `/api/me/invoices/${paid.invoiceNumber}`);
  assert.equal(inv.body.invoice.lines.length, 1);
  assert.equal((await support('GET', `/api/console/payments/${paid.orderId}`)).body.discount, null);
  const r = await owner('GET', '/api/console/coupons');
  assert.equal(r.status, 503);
  assert.match(r.body.error.message, /0016/);
});
