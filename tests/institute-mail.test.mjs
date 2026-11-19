// Students invited by email, and reminders to institutes: Release 2 (docs/INSTITUTES.md §13).
//   node --test tests/institute-mail.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode, showJoinCode } from '../src/institute-access.js';
import { sendReminders } from '../src/institute-mail.js';

let S, K;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
async function setup({ seats = 10, ends = 90, contact = 'office@centre.example.com' } = {}) {
  const ins = newId('ins'), b = newId('bat'), code = newJoinCode();
  await K.run(`INSERT INTO institutes (id, name, contact_email, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, 'Mail Centre', ?2, 'premium', ?3, 0, ?4, ?5, 'active', ?4, ?4)`, ins, contact, seats, iso(-10), iso(ends));
  await K.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', b, ins, 'Morning', code, iso(-10));
  return { ins, b, code };
}
async function staff(ins, who, role) {
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`,
    newId('stf'), ins, who.id, who.email, role, iso(-10));
}
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8799) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.83.0.' });
});
after(() => { S.srv.server.close(); });

test('invite students from a list: each gets the code and link; duplicates, members and bad addresses are skipped', async () => {
  const { ins, b, code } = await setup();
  const boss = await K.account({ email: 'boss.im@example.com' });
  const tina = await K.account({ email: 'tina.im@example.com' });
  await staff(ins, boss, 'admin'); await staff(ins, tina, 'teacher');
  const member = await K.account({ email: 'member.im@example.com' });
  await K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`, newId('mem'), ins, b, member.id, iso(-1));
  const url = `/api/institutes/${ins}/batches/${b}/invites`;
  assert.equal((await tina.learner('POST', url, { students: [{ email: 'x@example.com' }] })).status, 403, 'admins only');
  assert.equal((await boss.learner('POST', url, { students: Array.from({ length: 26 }, (_, i) => ({ email: `s${i}@example.com` })) })).status, 400);
  let r = await boss.learner('POST', url, { students: [
    { name: 'Asha Verma', email: 'Asha@Example.com' }, { name: 'Asha again', email: 'asha@example.com' }, { name: 'Bad', email: 'not-an-email' },
    { name: 'Member', email: 'member.im@example.com' }, { name: 'Ravi', email: 'ravi.im@example.com' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.sent.map((x) => x.email), ['asha@example.com', 'ravi.im@example.com']);
  assert.deepEqual(r.body.skipped.map((x) => x.why), ['twice in the list', 'not an email address', 'already in your institute']);
  const mail = await K.one("SELECT payload, subject FROM email_logs WHERE template = 'student_invite' AND to_email = 'asha@example.com'");
  assert.match(mail.subject, /Join Morning at Mail Centre/);
  assert.match(mail.payload, new RegExp(showJoinCode(code)));
  r = await boss.learner('POST', url, { students: [{ email: 'asha@example.com' }] });
  assert.deepEqual(r.body.skipped, [{ email: 'asha@example.com', why: 'already invited to this batch' }]);
  // Asha joins: the list says so
  const asha = await K.account({ email: 'asha@example.com', name: 'Asha Verma' });
  assert.equal((await asha.learner('POST', '/api/institutes/join', { code, adult: true })).status, 201);
  const list = (await boss.learner('GET', url)).body.invites;
  assert.deepEqual(list.map((x) => [x.email, x.joined]).sort(), [['asha@example.com', true], ['ravi.im@example.com', false]]);
  // joining switched off: no invitations (the email carries the code)
  await K.run('UPDATE batches SET join_code = NULL WHERE id = ?1', b);
  r = await boss.learner('POST', url, { students: [{ email: 'late@example.com' }] });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'joining_off');
  assert.ok((await K.audits('institute.students_invite')).length >= 1);
});

test('reminders: seats nearly full, and the term ending in 30 and 7 days, each once a term, to admins and the contact', async () => {
  const full = await setup({ seats: 10, ends: 90, contact: 'full@centre.example.com' });
  const admin = await K.account({ email: 'admin.rem@example.com', name: 'Rem Admin' });
  await staff(full.ins, admin, 'admin');
  for (let i = 0; i < 9; i++) {
    const u = await K.account({ email: `seat${i}.rem@example.com` });
    await K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`, newId('mem'), full.ins, full.b, u.id, iso(-1));
  }
  const ending = await setup({ seats: 50, ends: 20, contact: 'ending@centre.example.com' });
  const last = await setup({ seats: 50, ends: 5, contact: 'last@centre.example.com' });
  let r = await sendReminders(S.env, { waitUntil() {} });
  assert.ok(r.seats >= 1 && r.ends30 >= 1 && r.ends7 >= 1, JSON.stringify(r));
  const to = async (email, template = 'institute_reminder') => (await K.many('SELECT subject FROM email_logs WHERE template = ?1 AND to_email = ?2', template, email)).map((m) => m.subject);
  assert.match((await to('admin.rem@example.com'))[0], /9 of 10 TypeCraft seats are in use/);
  assert.equal((await to('full@centre.example.com')).length, 1, 'the contact email too');
  assert.match((await to('ending@centre.example.com'))[0], /seats end on/);
  assert.equal((await to('last@centre.example.com')).length, 1);
  // again: nothing new
  r = await sendReminders(S.env, { waitUntil() {} });
  assert.deepEqual(r, { seats: 0, ends30: 0, ends7: 0 });
  // 13 days later the 20-day institute is inside 7 days: one more
  r = await sendReminders(S.env, { waitUntil() {} }, Date.now() + 14 * 86400000);
  assert.ok(r.ends7 >= 1);
  assert.equal((await to('ending@centre.example.com')).length, 2);
  // renewed (a new last day): the reminders can come again for the new term
  await K.run('UPDATE institutes SET ends_at = ?2 WHERE id = ?1', ending.ins, iso(25));
  r = await sendReminders(S.env, { waitUntil() {} });
  assert.ok(r.ends30 >= 1);
  assert.ok(last.ins);
});

test('before migration 0010: inviting by email says it is not switched on; the nightly job skips quietly', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  env.DB.db.exec('DROP TABLE student_invites; DROP TABLE institute_reminders;');
  const Q = { env, srv: await startServer(env, 8800) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const Kq = kit(Q, { ipPrefix: '10.84.0.' });
  try {
    const ins = newId('ins'), b = newId('bat');
    await Kq.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at) VALUES (?1, 'Old', 'premium', 5, 0, ?2, ?3, 'active', ?2, ?2)`, ins, iso(-1), iso(3));
    await Kq.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', b, ins, 'Only', newJoinCode(), iso(-1));
    const adm = await Kq.account({ email: 'adm.mold@example.com' });
    await Kq.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'admin', 'active', ?5, ?5)`, newId('stf'), ins, adm.id, adm.email, iso(-1));
    const r = await adm.learner('POST', `/api/institutes/${ins}/batches/${b}/invites`, { students: [{ email: 'a@example.com' }] });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'invites_not_ready');
    const { cron } = await import('../src/institute-mail.js');
    await cron(env, { waitUntil() {} }, '17 21 * * *');
  } finally { Q.srv.server.close(); }
});
