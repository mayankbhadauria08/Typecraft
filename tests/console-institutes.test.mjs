// Institutes in the console, Release 1 part 2 (docs/INSTITUTES.md §7).
//   node --test tests/console-institutes.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import { newId, newJoinCode } from '../src/institute-access.js';

const IST = 330 * 60000, DAY = 86400000;
const day = (n = 0) => new Date(Date.now() + IST + n * DAY).toISOString().slice(0, 10);
let S, K, owner, admin, support;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8792) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.76.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
});
after(() => { S.srv.server.close(); });

let n = 0;
const fields = (extra = {}) => ({
  name: `Sharma Typing Centre ${++n}`, city: 'Gwalior', contactName: 'Mr Sharma', contactEmail: `sharma${n}@example.com`, contactPhone: '+91 98765 43210',
  gstin: '', packageId: 'premium', seats: 10, pricePaise: 50000, startDate: day(-1), endDate: day(364), notes: 'Met at the fair', ...extra,
});
const create = async (c = admin, extra = {}) => {
  const r = await c('POST', '/api/console/institutes', fields(extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.institute.id;
};
const get = (id, c = admin) => c('GET', `/api/console/institutes/${id}`);
const pay = (id, extra = {}, c = admin) => c('POST', `/api/console/institutes/${id}/payments`, { amountPaise: 500000, method: 'bank_transfer', reference: 'UTR123456', paidOn: day(0), ...extra });
async function batch(instituteId, name) {
  const id = newId('bat'), code = newJoinCode();
  await K.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', id, instituteId, name, code, new Date().toISOString());
  return { id, code };
}

test('who may do what: support sees institutes without money; admin sets them up; money needs a fresh password', async () => {
  const id = await create();
  for (const c of [support]) {
    assert.equal((await c('POST', '/api/console/institutes', fields())).status, 403);
    assert.equal((await pay(id, {}, c)).status, 403);
    assert.equal((await c('POST', `/api/console/institutes/${id}/term`, { seats: 20, startDate: day(-1), endDate: day(364), reason: 'More' })).status, 403);
    const list = await c('GET', '/api/console/institutes');
    assert.equal(list.status, 200);
    assert.equal(list.body.money, false);
    assert.equal(list.body.items.find((x) => x.id === id).paidPaise, null);
    const one = await get(id, c);
    assert.equal(one.status, 200);
    assert.equal(one.body.money, null); assert.equal(one.body.payments, null); assert.equal(one.body.institute.pricePaise, null);
    assert.deepEqual(one.body.can, { manage: false, payments: false });
  }
  const anon = K.client();
  assert.equal((await anon('GET', '/api/console/institutes')).status, 401);
  // a learner account with no role gets nothing either
  const learner = await K.account({ email: 'nobody.ci@example.com' });
  assert.equal((await learner.learner('GET', '/api/console/institutes')).status, 401);
  // recording money is sensitive: an old console session must confirm the password
  await K.stale(admin);
  const r = await pay(id);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'reauth_required');
  const re = await admin('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' });
  assert.equal(re.status, 200);
  assert.equal((await pay(id)).status, 201);
});

test('creating checks every field; a new institute starts not paid, with its admin invited', async () => {
  let r = await admin('POST', '/api/console/institutes', { name: 'x', contactEmail: 'nope', packageId: 'free', seats: 0, pricePaise: -5, startDate: 'soon', endDate: day(0), gstin: 'ABC' });
  assert.equal(r.status, 400);
  for (const f of ['name', 'contactEmail', 'packageId', 'seats', 'pricePaise', 'startDate', 'gstin']) assert.ok(r.body.error.fields[f], f);
  r = await admin('POST', '/api/console/institutes', fields({ startDate: day(10), endDate: day(5) }));
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.endDate);
  r = await admin('POST', '/api/console/institutes', fields({ endDate: day(5 * 365) }));
  assert.equal(r.status, 400); assert.match(r.body.error.fields.endDate, /three years/);

  r = await admin('POST', '/api/console/institutes', fields({ name: 'Gupta Computer Classes', gstin: '23abcde1234f1z5', adminEmail: 'Owner.Gupta@Example.com' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.institute.id;
  assert.equal(r.body.invite.email, 'owner.gupta@example.com');
  assert.equal(r.body.invite.emailStatus, 'failed', 'no email service on the test server: the invitation is still saved');
  const one = (await get(id)).body;
  assert.equal(one.institute.status, 'pending');
  assert.equal(one.institute.gstin, '23ABCDE1234F1Z5');
  assert.equal(one.institute.lastDay, day(364));
  assert.equal(one.institute.startDate, day(-1));
  assert.deepEqual(one.money, { pricePaise: 50000, duePaise: 500000, paidPaise: 0 });
  assert.deepEqual(one.staff.map((s) => [s.email, s.role, s.status]), [['owner.gupta@example.com', 'admin', 'invited']]);
  const mail = await K.one("SELECT template, to_email FROM email_logs WHERE template = 'institute_invite' ORDER BY created_at DESC LIMIT 1");
  assert.equal(mail.to_email, 'owner.gupta@example.com');
  const acts = (await K.audits('institute.%')).filter((a) => a.target === `institute:${id}`).map((a) => a.action);
  assert.deepEqual(acts, ['institute.create', 'institute.staff_invite']);
  assert.deepEqual(one.history.map((h) => h.action), ['institute.staff_invite', 'institute.create']);

  // the list finds it by name, city or the admin's email; and by status
  let list = await admin('GET', '/api/console/institutes?q=gupta');
  assert.deepEqual(list.body.items.map((x) => x.name), ['Gupta Computer Classes']);
  list = await admin('GET', '/api/console/institutes?q=owner.gupta%40');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].admin, 'owner.gupta@example.com');
  assert.equal(list.body.items[0].duePaise, 500000);
  list = await admin('GET', '/api/console/institutes?status=pending&q=gupta');
  assert.equal(list.body.total, 1);
  list = await admin('GET', '/api/console/institutes?status=active&q=gupta');
  assert.equal(list.body.total, 0);
  assert.ok(list.body.packages.some((p) => p.id === 'premium') && !list.body.packages.some((p) => p.id === 'free'));
});

test('the first payment switches the institute on; students can join only then', async () => {
  const id = await create();
  const b = await batch(id, 'Morning batch');
  const kid = await K.account({ email: 'kid.ci@example.com' });
  let j = await kid.learner('POST', '/api/institutes/join', { code: b.code, adult: true });
  assert.equal(j.status, 409); assert.equal(j.body.error.code, 'not_open');

  let r = await pay(id, { amountPaise: 0, method: 'upi', reference: '', paidOn: day(2) });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.amountPaise); assert.ok(r.body.error.fields.reference); assert.ok(r.body.error.fields.paidOn);
  r = await pay(id, { amountPaise: 250000, method: 'cash', reference: '' });
  assert.equal(r.status, 201); assert.equal(r.body.switchedOn, true);
  r = await pay(id, { amountPaise: 250000 });
  assert.equal(r.body.switchedOn, false, 'already on');
  const one = (await get(id)).body;
  assert.equal(one.institute.status, 'active');
  assert.equal(one.money.paidPaise, 500000);
  assert.equal(one.payments.length, 2);
  assert.deepEqual(one.history.slice(0, 3).map((h) => h.action), ['institute.payment', 'institute.status', 'institute.payment']);

  j = await kid.learner('POST', '/api/institutes/join', { code: b.code, adult: true });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  assert.equal((await one.batches.length), 1);
  assert.equal((await get(id)).body.batches[0].students, 1);

  // a payment recorded by mistake can be removed; the log keeps what it said; the institute stays on
  const p = one.payments.find((x) => x.method === 'cash');
  r = await admin('POST', `/api/console/institutes/${id}/payments/${p.id}/remove`, {});
  assert.equal(r.status, 400, 'needs a reason');
  r = await admin('POST', `/api/console/institutes/${id}/payments/${p.id}/remove`, { reason: 'Entered twice' });
  assert.equal(r.status, 200);
  const after2 = (await get(id)).body;
  assert.equal(after2.payments.length, 1); assert.equal(after2.institute.status, 'active');
  const log = (await K.audits('institute.payment_remove')).pop();
  assert.equal(JSON.parse(log.detail).amountPaise, 250000);
  assert.equal((await admin('POST', `/api/console/institutes/${id}/payments/${p.id}/remove`, { reason: 'again' })).status, 404);
});

test('seats and term: renew, add seats, never fewer than in use; every change is logged', async () => {
  const id = await create(admin, { seats: 2 });
  await pay(id);
  const b = await batch(id, 'B');
  for (const e of ['s1.ci@example.com', 's2.ci@example.com']) {
    const u = await K.account({ email: e });
    assert.equal((await u.learner('POST', '/api/institutes/join', { code: b.code, adult: true })).status, 201);
  }
  const term = (body) => admin('POST', `/api/console/institutes/${id}/term`, { seats: 2, startDate: day(-1), endDate: day(364), pricePaise: 50000, reason: 'Renewal', ...body });
  let r = await term({ seats: 1 });
  assert.equal(r.status, 400); assert.match(r.body.error.fields.seats, /2 students/);
  r = await term({ reason: '' });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.reason);
  r = await term({});
  assert.deepEqual(r.body.changed, [], 'nothing changed');
  r = await term({ seats: 5, endDate: day(729), pricePaise: 45000 });
  assert.equal(r.status, 200); assert.deepEqual(r.body.changed.sort(), ['endsAt', 'pricePaise', 'seats']);
  const one = (await get(id)).body;
  assert.equal(one.institute.seats, 5); assert.equal(one.institute.lastDay, day(729));
  assert.equal(one.history[0].action, 'institute.term');
  assert.match(one.history[0].note, /seats 2 → 5/); assert.match(one.history[0].note, /price ₹500 → ₹450/);
  assert.equal(one.history[0].reason, 'Renewal');
  const log = JSON.parse((await K.audits('institute.term')).pop().detail);
  assert.deepEqual(log.seats, { from: 2, to: 5 });
});

test('status: pause and switch on again; close for good', async () => {
  const id = await create();
  const st = (to, reason = 'Asked by the owner') => admin('POST', `/api/console/institutes/${id}/status`, { status: to, reason });
  assert.equal((await st('suspended')).status, 409, 'a new institute is not paused: it is switched on or closed');
  assert.equal((await st('active', '')).status, 400, 'needs a reason');
  assert.equal((await st('active', 'Free pilot for a month')).body.status, 'active');
  assert.equal((await st('suspended')).body.status, 'suspended');
  assert.equal((await st('active')).body.status, 'active');
  assert.equal((await st('closed')).body.status, 'closed');
  let r = await st('active');
  assert.equal(r.status, 409); assert.match(r.body.error.message, /stays closed/);
  r = await pay(id);
  assert.equal(r.status, 409);
  assert.equal((await admin('POST', `/api/console/institutes/${id}/term`, { seats: 3, startDate: day(0), endDate: day(10), reason: 'x y z' })).status, 409);
  assert.equal((await admin('POST', `/api/console/institutes/${id}/status`, { status: 'pending', reason: 'abc' })).status, 400);
});

test('staff: invite, a second invitation for the same email is refused, send again, remove (their batches go back to the admins)', async () => {
  const id = await create();
  let r = await admin('POST', `/api/console/institutes/${id}/staff`, { email: 'Teacher.One@example.com', role: 'teacher' });
  assert.equal(r.status, 201);
  r = await admin('POST', `/api/console/institutes/${id}/staff`, { email: 'teacher.one@example.com', role: 'admin' });
  assert.equal(r.status, 409); assert.ok(r.body.error.fields.email);
  r = await admin('POST', `/api/console/institutes/${id}/staff`, { email: 'not an email', role: 'admin' });
  assert.equal(r.status, 400);
  r = await admin('POST', `/api/console/institutes/${id}/staff`, { email: 'x@example.com', role: 'owner' });
  assert.equal(r.status, 400);
  const s = (await get(id)).body.staff[0];
  assert.equal(s.status, 'invited');
  r = await admin('POST', `/api/console/institutes/${id}/staff/${s.id}/resend`, {});
  assert.equal(r.status, 200);
  const b = await batch(id, 'Taught');
  await K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', b.id, s.id, new Date().toISOString());
  r = await admin('POST', `/api/console/institutes/${id}/staff/${s.id}/remove`, { reason: 'Left the institute' });
  assert.equal(r.status, 200);
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM batch_teachers WHERE staff_id = ?1', s.id)).n, 0);
  assert.equal((await admin('POST', `/api/console/institutes/${id}/staff/${s.id}/remove`, { reason: 'again' })).status, 409);
  assert.equal((await admin('POST', `/api/console/institutes/${id}/staff/${s.id}/resend`, {})).status, 409);
  // removed: the same email can be invited again
  assert.equal((await admin('POST', `/api/console/institutes/${id}/staff`, { email: 'teacher.one@example.com', role: 'teacher' })).status, 201);
  const one = (await get(id)).body;
  assert.deepEqual(one.staff.map((x) => x.status), ['invited', 'removed']);
});

test('details: edit what changed; unknown and malformed ids are 404', async () => {
  const id = await create();
  let r = await admin('PUT', `/api/console/institutes/${id}`, { city: 'Indore', gstin: 'BAD' });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.gstin);
  r = await admin('PUT', `/api/console/institutes/${id}`, { city: 'Indore', notes: 'Pays on the 5th' });
  assert.deepEqual(r.body.changed, ['city', 'notes']);
  r = await admin('PUT', `/api/console/institutes/${id}`, { city: 'Indore' });
  assert.deepEqual(r.body.changed, []);
  assert.equal((await get(id)).body.institute.city, 'Indore');
  assert.equal((await get('ins_00000000000000000000')).status, 404);
  assert.equal((await admin('GET', '/api/console/institutes/ins_nothex')).status, 404);
  assert.equal((await admin('GET', '/api/console/institutes/bat_00000000000000000000')).status, 404);
});

test('pages: the list and an institute open with no inline code; support has no "New institute" button', async () => {
  const id = await create();
  let r = await admin('GET', '/admin/institutes');
  assert.equal(r.status, 200);
  assertNoInlineCode(r.text);
  assert.match(r.text, /id="newInstituteBtn"/);
  assert.match(r.text, /institute-actions\.js/);
  r = await support('GET', '/admin/institutes');
  assert.equal(r.status, 200);
  assert.ok(!/id="newInstituteBtn"/.test(r.text));
  r = await admin('GET', `/admin/institutes/${id}`);
  assert.equal(r.status, 200); assertNoInlineCode(r.text);
  assert.match(r.text, /id="paymentsBody"/);
  r = await support('GET', `/admin/institutes/${id}`);
  assert.ok(!/id="paymentsBody"/.test(r.text), 'no payments section without money permissions');
  r = await owner('GET', '/admin');
  assert.match(r.text, /\/admin\/institutes/, 'in the sidebar');
});
