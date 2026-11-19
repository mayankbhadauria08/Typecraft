// The Monday email to an institute's teachers and admins (docs/INSTITUTES.md §17).
//   node --test tests/institute-weekly.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode } from '../src/institute-access.js';
import { sendWeekly, duration } from '../src/institute-weekly.js';

const DAY = 86400000, IST = 330 * 60000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
// the next Monday in India, 02:47 (when the nightly job runs)
let monday = new Date(Date.now() + IST).toISOString().slice(0, 10);
while (new Date(monday + 'T12:00:00Z').getUTCDay() !== 1) monday = addDays(monday, 1);
const MONDAY = Date.parse(`${monday}T02:47:00+05:30`);
const ctx = { waitUntil() {} };

let S, K;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8806) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.89.0.' });
});
after(() => { S.srv.server.close(); });

const mails = async (template = 'institute_weekly') => (await K.many('SELECT to_email, subject, payload FROM email_logs WHERE template = ?1 ORDER BY created_at', template))
  .map((m) => ({ to: m.to_email, subject: m.subject, data: JSON.parse(m.payload).data }));
async function institute(name, { status = 'active', ends = 200 } = {}) {
  const id = newId('ins');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, ?2, 'premium', 50, 0, ?3, ?4, ?5, ?3, ?3)`, id, name, iso(-30), iso(ends), status);
  return id;
}
async function batch(ins, name, { archived = false } = {}) {
  const id = newId('bat');
  await K.run('INSERT INTO batches (id, institute_id, name, join_code, archived_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)', id, ins, name, newJoinCode(), archived ? iso(-1) : null, iso(-20));
  return id;
}
async function staff(ins, who, role, batches = [], status = 'active') {
  const sid = newId('stf');
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`, sid, ins, who.id, who.email, role, status, iso(-20));
  for (const b of batches) await K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', b, sid, iso(-20));
}
async function student(ins, b, name, practice = []) {
  const uid = await K.customer({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${Math.random().toString(36).slice(2, 6)}@example.com` });
  await K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`, newId('mem'), ins, b, uid, iso(-15));
  for (const [daysBefore, seconds] of practice) {
    await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs) VALUES (?1, ?2, ?3, 2)', uid, addDays(monday, -daysBefore), seconds);
  }
  return uid;
}

test('the setting: on unless switched off, for the signed-in person only', async () => {
  const p = await K.account({ email: 'setting.teacher@example.com' });
  assert.equal((await p.learner('GET', '/api/me/institute-email')).body.weekly, true);
  assert.equal((await p.learner('PUT', '/api/me/institute-email', { weekly: 'no' })).status, 400);
  let r = await p.learner('PUT', '/api/me/institute-email', { weekly: false });
  assert.equal(r.status, 200); assert.equal(r.body.weekly, false);
  assert.equal((await p.learner('GET', '/api/me/institute-email')).body.weekly, false);
  r = await p.learner('PUT', '/api/me/institute-email', { weekly: true });
  assert.equal((await p.learner('GET', '/api/me/institute-email')).body.weekly, true);
});

test('Monday: each teacher hears about their own batches, admins about all; once a week; switched off means none', async () => {
  const ins = await institute('Sharma Typing Centre');
  const morning = await batch(ins, 'Morning SSC batch'), evening = await batch(ins, 'Evening CPCT batch');
  await batch(ins, 'Empty batch'); const old = await batch(ins, 'Old batch', { archived: true });
  await student(ins, morning, 'Asha Singh', [[1, 1800], [3, 1500]]);   // 55 min
  await student(ins, morning, 'Ravi Kumar', [[2, 600]]);              // 10 min
  await student(ins, morning, 'Tina Das', [[9, 3000]]);               // before last week: didn't practise
  await student(ins, morning, 'Farah Khan');
  await student(ins, evening, 'Gaurav Mehta', [[7, 2400]]);           // last Monday: counts
  await student(ins, old, 'Old Student', [[1, 900]]);
  const rakesh = await K.account({ email: 'rakesh.weekly@example.com', name: 'Rakesh Sharma' });
  const pooja = await K.account({ email: 'pooja.weekly@example.com', name: 'Pooja Verma' });
  const amit = await K.account({ email: 'amit.weekly@example.com', name: 'Amit Off' });
  const gone = await K.account({ email: 'gone.weekly@example.com', name: 'Gone Teacher' });
  const idle = await K.account({ email: 'idle.weekly@example.com', name: 'No Batches' });
  await staff(ins, rakesh, 'admin'); await staff(ins, pooja, 'teacher', [morning]); await staff(ins, amit, 'teacher', [evening]);
  await staff(ins, gone, 'teacher', [morning], 'removed'); await staff(ins, idle, 'teacher', []);
  await amit.learner('PUT', '/api/me/institute-email', { weekly: false });

  // not on a Monday: nothing
  let r = await sendWeekly(S.env, ctx, MONDAY + DAY);
  assert.equal(r.sent, 0);
  r = await sendWeekly(S.env, ctx, MONDAY);
  assert.equal(r.week, monday); assert.equal(r.sent, 2); assert.equal(r.skipped, 1, 'Amit switched it off');
  const all = await mails();
  assert.deepEqual(all.map((m) => m.to).sort(), ['pooja.weekly@example.com', 'rakesh.weekly@example.com']);
  const p = all.find((m) => m.to === 'pooja.weekly@example.com');
  assert.match(p.subject, /^Sharma Typing Centre: your batches from \d+ \w+ to \d+ \w+$/);
  assert.equal(p.data.institutes.length, 1);
  assert.deepEqual(p.data.institutes[0].batches.map((b) => b.name), ['Morning SSC batch'], 'only the batch she teaches');
  const m = p.data.institutes[0].batches[0];
  assert.equal(m.students, 4); assert.equal(m.practised, 2); assert.equal(m.time, '1 h 5 min');
  assert.deepEqual(m.top, ['Asha Singh (55 min)', 'Ravi Kumar (10 min)']);
  assert.deepEqual(m.quiet, ['Farah Khan', 'Tina Das']);
  assert.match(m.link, new RegExp(`/institute/${ins}/batches/${morning}$`));
  const a = all.find((x) => x.to === 'rakesh.weekly@example.com').data.institutes[0].batches;
  assert.deepEqual(a.map((b) => b.name), ['Evening CPCT batch', 'Morning SSC batch'], 'admins: every batch with students, not archived or empty ones');
  assert.equal(a[0].practised, 1); assert.deepEqual(a[0].top, ['Gaurav Mehta (40 min)']);
  // the nightly job runs again: nobody gets a second one
  r = await sendWeekly(S.env, ctx, MONDAY + 3600000);
  assert.equal(r.sent, 0);
  assert.equal((await mails()).length, 2);
});

test('one email for someone in two institutes; paused or ended institutes are left out', async () => {
  const a = await institute('Alpha Academy'), b = await institute('Beta Classes');
  const paused = await institute('Paused Centre', { status: 'suspended' }), ended = await institute('Ended Centre', { ends: -3 });
  const ba = await batch(a, 'A1'), bb = await batch(b, 'B1'), bp = await batch(paused, 'P1'), be = await batch(ended, 'E1');
  for (const [ins, bat] of [[a, ba], [b, bb], [paused, bp], [ended, be]]) await student(ins, bat, 'Some Student', [[2, 300]]);
  const both = await K.account({ email: 'two.places@example.com', name: 'Neha Two' });
  await staff(a, both, 'teacher', [ba]); await staff(b, both, 'admin'); await staff(paused, both, 'admin'); await staff(ended, both, 'admin');
  await sendWeekly(S.env, ctx, MONDAY + 7 * DAY, { force: false });
  const mine = (await mails()).filter((m) => m.to === 'two.places@example.com');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].data.institutes.map((i) => i.name), ['Alpha Academy', 'Beta Classes']);
  assert.match(mine[0].subject, /^your batches from/);
});

test('duration words', () => {
  assert.equal(duration(0), '0 min'); assert.equal(duration(600), '10 min'); assert.equal(duration(3600), '1 h'); assert.equal(duration(3900), '1 h 5 min');
});

test('before migration 0013: the setting says so, and Monday sends nothing', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  env.DB.db.exec('DROP TABLE institute_weekly_emails; DROP TABLE institute_email_settings;');
  const Q = { env, srv: await startServer(env, 8807) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const Kq = kit(Q, { ipPrefix: '10.90.0.' });
  try {
    const u = await Kq.account({ email: 'old.weekly@example.com' });
    const r = await u.learner('GET', '/api/me/institute-email');
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'weekly_not_ready');
    assert.deepEqual(await sendWeekly(env, ctx, MONDAY), { week: monday, sent: 0, skipped: 0 });
  } finally { Q.srv.server.close(); }
});
