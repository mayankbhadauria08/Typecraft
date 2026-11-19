// Invoices for institute payments: Release 2 (docs/INSTITUTES.md §14).
//   node --test tests/institute-invoices.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId } from '../src/institute-access.js';
import { ensureInvoice } from '../src/invoices.js';

let S, K, owner, admin, support;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const day = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8801) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.85.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  await K.run(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('seller', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    JSON.stringify({ name: 'TypeCraft', legalName: 'Mayank (sole proprietor)', address: 'Gwalior, MP', email: 'hello@typecraft.test', phone: '', gstin: null }), iso(0));
});
after(() => { S.srv.server.close(); });

async function institute() {
  const r = await admin('POST', '/api/console/institutes', { name: 'Invoice Academy', city: 'Indore', contactName: 'Mr Rao', contactEmail: 'accounts@invoice.example.com',
    contactPhone: '+91 98260 00000', gstin: '23ABCDE1234F1Z5', packageId: 'premium', seats: 20, pricePaise: 50000, startDate: day(), endDate: '2027-11-18', notes: '' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.institute.id;
  await admin('POST', `/api/console/institutes/${id}/payments`, { amountPaise: 1000000, method: 'bank_transfer', reference: 'UTR998877', paidOn: day() });
  const pay = (await admin('GET', `/api/console/institutes/${id}`)).body.payments[0];
  return { id, pay };
}

test('an invoice for a recorded payment: numbered in the one series, the details copied, made once', async () => {
  const { id, pay } = await institute();
  // a customer's invoice first, so the series is shared
  const cust = await K.account({ email: 'cust.inv@example.com' });
  const o = await K.order(cust.id, 'pro', { status: 'paid' });
  const custInv = await ensureInvoice(S.env, o.id);
  let r = await support('POST', `/api/console/institutes/${id}/payments/${pay.id}/invoice`, {});
  assert.equal(r.status, 403);
  r = await admin('POST', `/api/console/institutes/${id}/payments/${pay.id}/invoice`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const inv = r.body.invoice;
  assert.equal(inv.number, `TC-${new Date().getUTCFullYear()}-${String(custInv.seq + 1).padStart(6, '0')}`, 'the next number after the customer invoice');
  assert.equal(inv.billedTo.name, 'Invoice Academy'); assert.equal(inv.billedTo.gstin, '23ABCDE1234F1Z5'); assert.equal(inv.billedTo.city, 'Indore');
  assert.equal(inv.totalPaise, 1000000); assert.equal(inv.tax.amountPaise, 0); assert.equal(inv.tax.note, 'GST not applicable.');
  assert.match(inv.lines[0].description, /Premium plan for 20 students \(seats\), \d{4}-\d{2}-\d{2} to 2027-11-18/);
  assert.deepEqual(inv.payment, { method: 'Bank transfer', reference: 'UTR998877', paidOn: day() });
  r = await admin('POST', `/api/console/institutes/${id}/payments/${pay.id}/invoice`, {});
  assert.equal(r.status, 200); assert.equal(r.body.made, false); assert.equal(r.body.invoice.number, inv.number);
  // the console shows it with the payment; the payment can no longer be removed
  const one = (await admin('GET', `/api/console/institutes/${id}`)).body;
  assert.equal(one.payments[0].invoice, inv.number);
  assert.ok(one.history.some((h) => h.action === 'institute.invoice'));
  r = await admin('POST', `/api/console/institutes/${id}/payments/${pay.id}/remove`, { reason: 'mistake' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'invoiced');
  // later changes to the seller or the institute don't change it
  await K.run(`UPDATE platform_settings SET value = json_set(value, '$.address', 'Somewhere else') WHERE key = 'seller'`);
  await admin('PUT', `/api/console/institutes/${id}`, { name: 'Renamed Academy' });
  r = await admin('GET', `/api/console/institutes/${id}/invoices/${inv.number}`);
  assert.equal(r.body.invoice.seller.address, 'Gwalior, MP'); assert.equal(r.body.invoice.billedTo.name, 'Invoice Academy');
  assert.equal((await support('GET', `/api/console/institutes/${id}/invoices/${inv.number}`)).status, 403, 'no money permissions');
});

test("the institute's admin sees its invoices; teachers and others don't", async () => {
  const { id, pay } = await institute();
  const number = (await owner('POST', `/api/console/institutes/${id}/payments/${pay.id}/invoice`, {})).body.invoice.number;
  const boss = await K.account({ email: 'boss.inv@example.com' });
  const tina = await K.account({ email: 'tina.inv@example.com' });
  for (const [who, role] of [[boss, 'admin'], [tina, 'teacher']]) {
    await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`, newId('stf'), id, who.id, who.email, role, iso(0));
  }
  let r = await boss.learner('GET', `/api/institutes/${id}/invoices`);
  assert.deepEqual(r.body.invoices.map((v) => [v.number, v.amountPaise]), [[number, 1000000]]);
  r = await boss.learner('GET', `/api/institutes/${id}/invoices/${number}`);
  assert.equal(r.status, 200); assert.equal(r.body.invoice.number, number);
  assert.equal((await tina.learner('GET', `/api/institutes/${id}/invoices`)).status, 403);
  assert.equal((await tina.learner('GET', `/api/institutes/${id}/invoices/${number}`)).status, 403);
  const other = await K.account({ email: 'other.inv@example.com' });
  assert.equal((await other.learner('GET', `/api/institutes/${id}/invoices/${number}`)).status, 404);
  assert.equal((await boss.learner('GET', `/api/institutes/${id}/invoices/TC-2026-123456`)).status, 404);
  // the printable page: open to load, its data only through the two APIs
  const page = await K.client()('GET', `/institute/${id}/invoices/${number}`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('Invoice Academy'), 'no data in the page itself');
});

test('before migration 0010: making an invoice says it is not switched on; the console page still works', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  env.DB.db.exec('DROP TABLE institute_invoices;');
  const Q = { env, srv: await startServer(env, 8802) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const Kq = kit(Q, { ipPrefix: '10.86.0.' });
  try {
    const own = await Kq.consoleLogin(await Kq.owner());
    const r = await own('POST', '/api/console/institutes', { name: 'Old Academy', city: '', contactName: '', contactEmail: 'a@old.example.com', contactPhone: '', gstin: '',
      packageId: 'premium', seats: 5, pricePaise: 0, startDate: day(), endDate: '2027-01-01', notes: '' });
    const id = r.body.institute.id;
    await own('POST', `/api/console/institutes/${id}/payments`, { amountPaise: 10000, method: 'cash', reference: '', paidOn: day() });
    const one = (await own('GET', `/api/console/institutes/${id}`)).body;
    assert.equal(one.payments[0].invoice, null);
    const made = await own('POST', `/api/console/institutes/${id}/payments/${one.payments[0].id}/invoice`, {});
    assert.equal(made.status, 503); assert.equal(made.body.error.code, 'invoices_not_ready');
    assert.equal((await own('POST', `/api/console/institutes/${id}/payments/${one.payments[0].id}/remove`, { reason: 'test' })).status, 200);
  } finally { Q.srv.server.close(); }
});
