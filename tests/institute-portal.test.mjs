// The institute's own pages, Release 1 part 3 (docs/INSTITUTES.md §8).
//   node --test tests/institute-portal.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, cleanJoinCode } from '../src/institute-access.js';

let S, K;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8793) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.77.0.' });
});
after(() => { S.srv.server.close(); });

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
let n = 0;
async function institute({ status = 'active', seats = 5 } = {}) {
  const id = newId('ins');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, ?2, 'premium', ?3, 0, ?4, ?5, ?6, ?4, ?4)`, id, `Centre ${++n}`, seats, iso(-1), iso(90), status);
  return id;
}
const invite = async (instituteId, email, role) => {
  const id = newId('stf');
  await K.run(`INSERT INTO institute_staff (id, institute_id, email, role, status, invited_at) VALUES (?1, ?2, ?3, ?4, 'invited', ?5)`, id, instituteId, email, role, iso(0));
  return id;
};
const verify = (who) => K.run('UPDATE users SET email_verified = 1 WHERE id = ?1', who.id);
/** An account that has accepted a place in the institute. */
async function member(instituteId, role, email) {
  const who = await K.account({ email, name: email.split('@')[0].replace('.', ' ') });
  const sid = await invite(instituteId, email, role);
  await verify(who);
  const r = await who.learner('POST', `/api/me/institute-invites/${sid}/accept`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  who.staffId = sid;
  return who;
}
const api = (who, method, path, body) => who.learner(method, `/api/institutes/${path}`, body);

test('an invitation is accepted by the account with that verified email, once', async () => {
  const ins = await institute();
  const sid = await invite(ins, 'boss.ip@example.com', 'admin');
  const boss = await K.account({ email: 'boss.ip@example.com', name: 'Boss Admin' });
  let mine = (await boss.learner('GET', '/api/me/institutes')).body;
  assert.equal(mine.invites.length, 1); assert.equal(mine.invites[0].role, 'admin'); assert.equal(mine.emailVerified, false);
  assert.equal((await api(boss, 'GET', ins)).status, 404, 'not before accepting');
  let r = await boss.learner('POST', `/api/me/institute-invites/${sid}/accept`, {});
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'verify_email');
  // someone else can't take it, verified or not
  const other = await K.account({ email: 'other.ip@example.com' });
  await verify(other);
  assert.equal((await other.learner('POST', `/api/me/institute-invites/${sid}/accept`, {})).status, 404);
  await verify(boss);
  r = await boss.learner('POST', `/api/me/institute-invites/${sid}/accept`, {});
  assert.equal(r.status, 200); assert.equal(r.body.institute.id, ins); assert.equal(r.body.role, 'admin');
  assert.equal((await boss.learner('POST', `/api/me/institute-invites/${sid}/accept`, {})).status, 404, 'only once');
  mine = (await boss.learner('GET', '/api/me/institutes')).body;
  assert.deepEqual(mine.invites, []); assert.equal(mine.staff[0].role, 'admin');
  assert.equal((await api(boss, 'GET', ins)).status, 200);
  // the account pages show "Institute" to staff and to invited people only
  assert.match((await boss.learner('GET', '/account/plans')).text, /href="\/institute"/);
  assert.ok(!/href="\/institute"/.test((await other.learner('GET', '/account/plans')).text));
  await invite(ins, 'other.ip@example.com', 'teacher');
  assert.match((await other.learner('GET', '/account/plans')).text, /href="\/institute"/);
  // declining
  const dsid = (await other.learner('GET', '/api/me/institutes')).body.invites[0].id;
  assert.equal((await other.learner('POST', `/api/me/institute-invites/${dsid}/decline`, {})).status, 200);
  assert.deepEqual((await other.learner('GET', '/api/me/institutes')).body.invites, []);
  assert.equal((await K.one('SELECT status FROM institute_staff WHERE id = ?1', dsid)).status, 'removed');
  const acts = (await K.audits('institute.staff_%')).map((a) => a.action);
  assert.ok(acts.includes('institute.staff_accept') && acts.includes('institute.staff_decline'));
  // the pages open
  for (const p of ['/institute', `/institute/${ins}`]) assert.equal((await boss.learner('GET', p)).status, 200, p);
});

test('batches: the admin makes them, each with a code; teachers see and run only theirs', async () => {
  const ins = await institute({ seats: 10 });
  const boss = await member(ins, 'admin', 'admin2.ip@example.com');
  const tina = await member(ins, 'teacher', 'tina.ip@example.com');
  let r = await api(boss, 'POST', `${ins}/batches`, { name: 'x' });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.name);
  r = await api(boss, 'POST', `${ins}/batches`, { name: 'Morning SSC batch' });
  assert.equal(r.status, 201);
  const a = r.body.batch;
  assert.ok(cleanJoinCode(a.joinCode));
  r = await api(boss, 'POST', `${ins}/batches`, { name: 'morning ssc batch' });
  assert.equal(r.status, 400, 'names are unique among open batches');
  const b = (await api(boss, 'POST', `${ins}/batches`, { name: 'Evening batch', teacherIds: [tina.staffId] })).body.batch;

  // a teacher: only Evening batch; no batch-making, no settings
  r = await api(tina, 'GET', ins);
  assert.deepEqual(r.body.batches.map((x) => x.name), ['Evening batch']);
  assert.equal(r.body.batches[0].teachers, 'tina ip');
  assert.equal((await api(tina, 'GET', `${ins}/batches/${a.id}`)).status, 404);
  assert.equal((await api(tina, 'GET', `${ins}/batches/${a.id}/students`)).status, 404);
  assert.equal((await api(tina, 'GET', `${ins}/batches/${b.id}/students`)).status, 200);
  assert.equal((await api(tina, 'POST', `${ins}/batches`, { name: 'Mine' })).status, 403);
  assert.equal((await api(tina, 'PUT', `${ins}/batches/${b.id}`, { name: 'Renamed' })).status, 403);
  assert.equal((await api(tina, 'POST', `${ins}/batches/${b.id}/code`, {})).status, 403);
  assert.equal((await api(tina, 'GET', `${ins}/staff`)).status, 403);
  // the admin gives Tina Morning batch too
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { teacherIds: [tina.staffId] });
  assert.deepEqual(r.body.changed, ['teachers']);
  assert.equal((await api(tina, 'GET', `${ins}/batches/${a.id}`)).status, 200);
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { teacherIds: ['stf_00000000000000000000'] });
  assert.equal(r.status, 400, 'only people of this institute');
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { name: 'Morning SSC (Nov)' });
  assert.deepEqual(r.body.changed, ['name']);

  // students join with the code; the list shows when they last practised
  const kid = await K.account({ email: 'kid1.ip@example.com', name: 'Kid One' });
  assert.equal((await kid.learner('POST', '/api/institutes/join', { code: a.joinCode, adult: true })).status, 201);
  r = await api(tina, 'GET', `${ins}/batches/${a.id}/students`);
  assert.equal(r.body.students.length, 1);
  assert.equal(r.body.students[0].lastDay, null); assert.equal(r.body.students[0].activeThisWeek, false);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, 600, 3, 30, 285, 3)', kid.id, today);
  r = await api(tina, 'GET', `${ins}/batches/${a.id}/students`);
  assert.equal(r.body.students[0].lastDay, today); assert.equal(r.body.students[0].activeThisWeek, true);
  assert.equal((await api(boss, 'GET', ins)).body.batches.find((x) => x.id === a.id).quietThisWeek, 0);

  // a new code: the old one stops working
  const old = a.joinCode;
  r = await api(boss, 'POST', `${ins}/batches/${a.id}/code`, {});
  assert.notEqual(r.body.joinCode, old);
  const kid2 = await K.account({ email: 'kid2.ip@example.com' });
  assert.equal((await kid2.learner('POST', '/api/institutes/join', { code: old, adult: true })).status, 400);
  // joining off, then on (a new code)
  await api(boss, 'PUT', `${ins}/batches/${a.id}`, { joining: 'off' });
  assert.equal((await api(boss, 'GET', `${ins}/batches/${a.id}`)).body.batch.joinCode, null);
  await api(boss, 'PUT', `${ins}/batches/${a.id}`, { joining: 'on' });
  const fresh = (await api(boss, 'GET', `${ins}/batches/${a.id}`)).body.batch.joinCode;
  assert.ok(fresh && fresh !== r.body.joinCode);
  assert.equal((await kid2.learner('POST', '/api/institutes/join', { code: fresh, adult: true })).status, 201);
});

test('students: the admin moves and removes them; archiving a finished batch frees its seats', async () => {
  const ins = await institute({ seats: 3 });
  const boss = await member(ins, 'admin', 'admin3.ip@example.com');
  const tina = await member(ins, 'teacher', 'tina3.ip@example.com');
  const a = (await api(boss, 'POST', `${ins}/batches`, { name: 'Batch A', teacherIds: [tina.staffId] })).body.batch;
  const b = (await api(boss, 'POST', `${ins}/batches`, { name: 'Batch B' })).body.batch;
  const kids = [];
  for (let i = 0; i < 3; i++) {
    const k = await K.account({ email: `s${i}.ip3@example.com` });
    assert.equal((await k.learner('POST', '/api/institutes/join', { code: a.joinCode, adult: true })).status, 201);
    kids.push(k);
  }
  let list = (await api(boss, 'GET', `${ins}/batches/${a.id}/students`)).body.students;
  assert.equal(list.length, 3);
  // a teacher can't move or remove
  assert.equal((await api(tina, 'POST', `${ins}/students/${list[0].id}/remove`, {})).status, 403);
  assert.equal((await api(tina, 'POST', `${ins}/students/${list[0].id}/move`, { batchId: b.id })).status, 403);
  // move: keeps the seat
  let r = await api(boss, 'POST', `${ins}/students/${list[0].id}/move`, { batchId: b.id });
  assert.equal(r.status, 200); assert.equal(r.body.batch.name, 'Batch B');
  assert.equal((await api(boss, 'POST', `${ins}/students/${list[0].id}/move`, { batchId: 'bat_00000000000000000000' })).status, 400);
  // remove: frees the seat; the student's plan ends
  r = await api(boss, 'POST', `${ins}/students/${list[1].id}/remove`, {});
  assert.equal(r.status, 200);
  const row = await K.one('SELECT status, ended_by FROM institute_students WHERE id = ?1', list[1].id);
  assert.equal(row.status, 'removed'); assert.equal(row.ended_by, boss.id);
  assert.equal((await api(boss, 'GET', ins)).body.institute.seatsUsed, 2);
  // a seat id of another institute is not found here
  const ins2 = await institute();
  const boss2 = await member(ins2, 'admin', 'admin4.ip@example.com');
  assert.equal((await api(boss2, 'POST', `${ins2}/students/${list[2].id}/remove`, {})).status, 404);
  assert.equal((await api(boss2, 'GET', `${ins}/batches/${a.id}/students`)).status, 404);

  // archive: refused while students are in it, unless their seats are freed
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { archived: true });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'has_students');
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { archived: true, removeStudents: true });
  assert.equal(r.status, 200); assert.equal(r.body.freed, 1);
  const arch = (await api(boss, 'GET', `${ins}/batches/${a.id}`)).body.batch;
  assert.equal(arch.archived, true); assert.equal(arch.joinCode, null); assert.equal(arch.students, 0);
  assert.equal((await api(boss, 'GET', ins)).body.institute.seatsUsed, 1);
  assert.equal((await api(boss, 'POST', `${ins}/batches/${a.id}/code`, {})).status, 409);
  r = await api(boss, 'PUT', `${ins}/batches/${a.id}`, { archived: false });
  assert.deepEqual(r.body.changed, ['archived']);
  const log = (await K.audits('institute.batch_update')).pop();
  assert.equal(JSON.parse(log.detail).by, 'institute');
});

test('admins and teachers: invite, send again, remove; the last admin stays', async () => {
  const ins = await institute();
  const boss = await member(ins, 'admin', 'admin5.ip@example.com');
  let r = await api(boss, 'POST', `${ins}/staff`, { email: 'New.Teacher@example.com' });
  assert.equal(r.status, 201); assert.equal(r.body.invite.role, 'teacher'); assert.equal(r.body.invite.email, 'new.teacher@example.com');
  const mail = await K.one("SELECT to_email FROM email_logs WHERE template = 'institute_invite' AND to_email = 'new.teacher@example.com'");
  assert.ok(mail);
  r = await api(boss, 'GET', `${ins}/staff`);
  const t = r.body.staff.find((s) => s.email === 'new.teacher@example.com');
  assert.equal(t.status, 'invited');
  assert.equal((await api(boss, 'POST', `${ins}/staff/${t.id}/resend`, {})).status, 200);
  // the only admin can't remove themselves
  r = await api(boss, 'POST', `${ins}/staff/${boss.staffId}/remove`, {});
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'last_admin');
  // with a second admin they can leave
  const co = await member(ins, 'admin', 'coadmin.ip@example.com');
  r = await api(boss, 'POST', `${ins}/staff/${boss.staffId}/remove`, {});
  assert.equal(r.status, 200); assert.equal(r.body.self, true);
  assert.equal((await api(boss, 'GET', ins)).status, 404, 'left: no access');
  r = await api(co, 'POST', `${ins}/staff/${t.id}/remove`, {});
  assert.equal(r.status, 200);
  assert.ok(!(await api(co, 'GET', `${ins}/staff`)).body.staff.some((s) => s.id === t.id));
});

test('a pending institute can be prepared; a closed one is out of reach', async () => {
  const ins = await institute({ status: 'pending' });
  const boss = await member(ins, 'admin', 'admin6.ip@example.com');
  const a = (await api(boss, 'POST', `${ins}/batches`, { name: 'Ready early' })).body.batch;
  assert.ok(a.joinCode);
  const kid = await K.account({ email: 'early.ip@example.com' });
  const j = await kid.learner('POST', '/api/institutes/join', { code: a.joinCode, adult: true });
  assert.equal(j.status, 409); assert.equal(j.body.error.code, 'not_open');
  await K.run("UPDATE institutes SET status = 'closed' WHERE id = ?1", ins);
  assert.equal((await api(boss, 'POST', `${ins}/batches`, { name: 'Too late' })).status, 404);
  assert.equal((await api(boss, 'GET', `${ins}/staff`)).status, 404);
  // an invitation to a closed institute can't be accepted
  const sid = await invite(ins, 'late.ip@example.com', 'teacher');
  const late = await K.account({ email: 'late.ip@example.com' });
  await verify(late);
  assert.equal((await late.learner('POST', `/api/me/institute-invites/${sid}/accept`, {})).status, 404);
  assert.deepEqual((await late.learner('GET', '/api/me/institutes')).body.invites, []);
});
