// Institutes from start to finish, through the same requests the pages make (docs/INSTITUTES.md §10):
// TypeCraft sets an institute up, records its payment; its admin accepts, makes a batch, invites a teacher;
// a student joins and practises; the teacher sees the report and prints certificates; the batch ends.
//   node --test tests/institute-e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';

let S, K;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8795) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.79.0.' });
});
after(() => { S.srv.server.close(); });

const IST = 330 * 60000;
const day = (n = 0) => new Date(Date.now() + IST + n * 86400000).toISOString().slice(0, 10);
const verify = (who) => K.run('UPDATE users SET email_verified = 1 WHERE id = ?1', who.id);
let e = 0;
const run = (lessonId) => ({ id: `ev-e2e-${++e}`, type: 'run', lessonId, wpm: 31, accuracy: 96, errors: 3, seconds: 180, at: new Date().toISOString(), tz: 330 }); // India: minutes ahead of UTC, as the app sends it

test('an institute, from setting up to the end of a batch', async () => {
  const owner = await K.consoleLogin(await K.owner());

  // 1. TypeCraft sets it up and invites the admin; nobody can join yet
  let r = await owner('POST', '/api/console/institutes', { name: 'Verma Steno Academy', city: 'Bhopal', contactName: 'R Verma', contactEmail: 'office@verma.example.com',
    contactPhone: '', gstin: '', packageId: 'premium', seats: 3, pricePaise: 50000, startDate: day(0), endDate: day(180), notes: '', adminEmail: 'admin@verma.example.com' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ins = r.body.institute.id;

  // 2. the admin signs up with the invited email, confirms it, accepts
  const admin = await K.account({ email: 'admin@verma.example.com', name: 'Rekha Verma' });
  let mine = (await admin.learner('GET', '/api/me/institutes')).body;
  assert.equal(mine.invites.length, 1);
  assert.equal((await admin.learner('POST', `/api/me/institute-invites/${mine.invites[0].id}/accept`, {})).status, 403, 'email not confirmed yet');
  await verify(admin);
  assert.equal((await admin.learner('POST', `/api/me/institute-invites/${mine.invites[0].id}/accept`, {})).status, 200);

  // 3. before payment: a batch can be prepared, but nobody can join
  r = await admin.learner('POST', `/api/institutes/${ins}/batches`, { name: 'Stenography A' });
  assert.equal(r.status, 201);
  const batch = r.body.batch;
  const student = await K.account({ email: 'student@verma.example.com', name: 'Sunil Rao' });
  r = await student.learner('POST', '/api/institutes/join', { code: batch.joinCode, adult: true });
  assert.equal(r.body.error.code, 'not_open');

  // 4. TypeCraft records the payment: the institute is on
  r = await owner('POST', `/api/console/institutes/${ins}/payments`, { amountPaise: 150000, method: 'upi', reference: 'UPI-778899', paidOn: day(0) });
  assert.equal(r.body.switchedOn, true);

  // 5. the admin invites a teacher, who accepts and is given the batch
  r = await admin.learner('POST', `/api/institutes/${ins}/staff`, { email: 'teacher@verma.example.com' });
  assert.equal(r.status, 201);
  const teacher = await K.account({ email: 'teacher@verma.example.com', name: 'Tarun Teacher' });
  await verify(teacher);
  const tInvite = (await teacher.learner('GET', '/api/me/institutes')).body.invites[0];
  assert.equal((await teacher.learner('POST', `/api/me/institute-invites/${tInvite.id}/accept`, {})).status, 200);
  const staffList = (await admin.learner('GET', `/api/institutes/${ins}/staff`)).body.staff;
  const tStaff = staffList.find((s) => s.email === 'teacher@verma.example.com');
  assert.deepEqual((await admin.learner('PUT', `/api/institutes/${ins}/batches/${batch.id}`, { teacherIds: [tStaff.id] })).body.changed, ['teachers']);

  // 6. the student joins with the link's code and gets the plan; practises two lessons
  r = await student.learner('POST', '/api/institutes/join', { code: batch.joinCode.toLowerCase(), adult: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await student.learner('GET', '/api/me/subscriptions')).body.entitlements.plan, 'premium');
  r = await student.learner('POST', '/api/user/events', { events: [run('l1'), run('l2')], today: day(0) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await student.learner('PUT', '/api/user/progress/state', { keyStats: { j: { attempts: 120, errors: 18 }, f: { attempts: 150, errors: 3 } } });

  // 7. the teacher follows the batch: report, CSV, the student's page
  r = await teacher.learner('GET', `/api/institutes/${ins}/batches/${batch.id}/report`);
  assert.equal(r.status, 200);
  const row = r.body.students[0];
  assert.equal(row.name, 'Sunil Rao'); assert.ok(row.lessonsDone >= 1, JSON.stringify(row)); assert.equal(row.lastDay, day(0));
  assert.equal(row.weakKeys[0].key, 'j');
  r = await teacher.learner('GET', `/api/institutes/${ins}/batches/${batch.id}/report.csv`);
  assert.equal(r.status, 200); assert.match(r.text, /Sunil Rao/);
  r = await teacher.learner('GET', `/api/institutes/${ins}/students/${row.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.student.batch.name, 'Stenography A');

  // 8. a certificate: printed with the institute's name and a code the verify page accepts
  await K.run('INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 20, 26, 97, 60, ?2)', student.id, new Date().toISOString());
  r = await teacher.learner('GET', `/api/institutes/${ins}/batches/${batch.id}/certificates`);
  const cert = r.body.students[0].certificate;
  assert.ok(cert && cert.code);
  r = await K.client()('GET', `/api/certificates/${cert.code}`);
  assert.equal(r.body.certificate.institute, 'Verma Steno Academy'); assert.equal(r.body.certificate.holder, 'Sunil Rao');

  // 9. the console sees it all: seats, payment, and the institute's own changes in its history
  r = await owner('GET', `/api/console/institutes/${ins}`);
  assert.equal(r.body.institute.seatsUsed, 1); assert.equal(r.body.money.paidPaise, 150000);
  const actions = r.body.history.map((h) => h.action);
  for (const a of ['institute.create', 'institute.staff_invite', 'institute.staff_accept', 'institute.batch_create', 'institute.payment', 'institute.batch_update']) {
    assert.ok(actions.includes(a), `${a} in ${actions.join(', ')}`);
  }
  r = await owner('GET', '/api/console/institutes/capacity');
  assert.equal(r.status, 200);
  assert.ok(r.body.lessonsToday >= 1); assert.equal(r.body.seatsInUse, 1); assert.equal(r.body.freeLessonsADay, 2083);

  // 10. the batch ends: archived, the seat is free, the student is back on Free with their progress
  r = await admin.learner('PUT', `/api/institutes/${ins}/batches/${batch.id}`, { archived: true, removeStudents: true });
  assert.equal(r.body.freed, 1);
  assert.equal((await student.learner('GET', '/api/me/subscriptions')).body.entitlements.plan, 'free');
  const kept = await K.one("SELECT COUNT(*) AS n FROM lesson_scores WHERE user_id = ?1 AND status = 'completed'", student.id);
  assert.ok(kept.n >= 1, 'progress stays');

  // the pages involved all open
  for (const [who, p] of [[admin, '/institute'], [admin, `/institute/${ins}`], [teacher, `/institute/${ins}/batches/${batch.id}`], [teacher, `/institute/${ins}/students/${row.id}`],
    [student, '/join'], [student, '/account/plans']]) {
    assert.equal((await who.learner('GET', p)).status, 200, p);
  }
  for (const p of ['/institute-terms', '/institute-guide', '/privacy']) {
    const page = await K.client()('GET', p);
    assert.equal(page.status, 200, p);
  }
  assert.match((await K.client()('GET', '/privacy')).text, /terms for institutes/);
  assert.match((await owner('GET', '/admin/institutes')).text, /id="capBody"/);
});
