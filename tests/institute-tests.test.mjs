// A scheduled mock test for a batch (docs/INSTITUTES.md §16).
//   node --test tests/institute-tests.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode } from '../src/institute-access.js';
import '../shared/exam-passages.js';
import '../shared/exam-rules.js';

const X = globalThis.TC_EXAMS;
const IST = 330 * 60000, MIN = 60000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const istParts = (ms) => { const s = new Date(Date.now() + ms + IST).toISOString(); return { day: s.slice(0, 10), time: s.slice(11, 16) }; };
let S, K, n = 0;
const attempt = (mode, passageId, typed, seconds, extra = {}) => {
  const r = X.score(mode, passageId, typed, seconds, { optimal: true });
  return { id: `ex-bt-${String(++n).padStart(6, '0')}`, mode, passageId, typed, seconds, path: r.path, today: new Date().toISOString().slice(0, 10), ...extra };
};
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8804) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.87.0.' });
});
after(() => { S.srv.server.close(); });

async function setup(tag) {
  const ins = newId('ins'), b = newId('bat'), other = newId('bat');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, 'Test Centre', 'premium', 20, 0, ?2, ?3, 'active', ?2, ?2)`, ins, iso(-10 * 86400000), iso(300 * 86400000));
  for (const [id, name] of [[b, 'Morning'], [other, 'Evening']]) {
    await K.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', id, ins, name, newJoinCode(), iso(0));
  }
  const staff = async (who, role, batch) => {
    const sid = newId('stf');
    await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`, sid, ins, who.id, who.email, role, iso(0));
    if (batch) await K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', batch, sid, iso(0));
  };
  const seat = (who, batch) => K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
    newId('mem'), ins, batch, who.id, iso(0));
  const teacher = await K.account({ email: `teacher.${tag}@example.com`, name: 'Pooja Verma' });
  const outsider = await K.account({ email: `other.teacher.${tag}@example.com`, name: 'Other Teacher' });
  await staff(teacher, 'teacher', b); await staff(outsider, 'teacher', other);
  const asha = await K.account({ email: `asha.${tag}@example.com`, name: 'Asha Singh' });
  const ravi = await K.account({ email: `ravi.${tag}@example.com`, name: 'Ravi Kumar' });
  const tina = await K.account({ email: `tina.${tag}@example.com`, name: 'Tina Das' });
  const eve = await K.account({ email: `eve.${tag}@example.com`, name: 'Eve Evening' });
  await seat(asha, b); await seat(ravi, b); await seat(tina, b); await seat(eve, other);
  return { ins, b, other, teacher, outsider, asha, ravi, tina, eve, url: `/api/institutes/${ins}/batches/${b}/tests` };
}

test('scheduling: staff of the batch only, checked on the server; students see it on their dashboard', async () => {
  const s = await setup('sched');
  const now = istParts(0), later = istParts(2 * 3600000);
  assert.equal((await s.outsider.learner('GET', s.url)).status, 404, "another batch's teacher can't see it");
  assert.equal((await s.asha.learner('POST', s.url, { mode: 'ssc-typing', day: now.day, time: now.time, windowMinutes: 60 })).status, 404, 'students cannot schedule');
  let r = await s.teacher.learner('POST', s.url, { mode: 'nope', passageId: 'zz', day: 'soon', time: '25:00', windowMinutes: 7, note: 'x'.repeat(201) });
  assert.equal(r.status, 400); assert.deepEqual(Object.keys(r.body.error.fields).sort(), ['day', 'mode', 'note', 'time', 'windowMinutes']);
  r = await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', day: istParts(-86400000).day, time: now.time, windowMinutes: 60 });
  assert.equal(r.status, 400); assert.match(r.body.error.fields.time, /passed/);
  r = await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', passageId: 'd1', day: later.day, time: later.time, windowMinutes: 60 });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.passageId, "a data entry passage isn't an SSC typing passage");
  r = await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', passageId: '', day: later.day, time: later.time, windowMinutes: 60, note: 'Like the real CHSL skill test' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.test.state, 'upcoming'); assert.ok(X.passage('ssc-typing', r.body.test.passageId), 'a passage is picked');
  assert.equal(Date.parse(r.body.test.closesAt) - Date.parse(r.body.test.opensAt), 60 * MIN);
  const list = (await s.teacher.learner('GET', s.url)).body;
  assert.equal(list.tests.length, 1); assert.equal(list.students, 3); assert.equal(list.tests[0].submitted, 0);
  assert.deepEqual(list.modes.map((m) => m.id), X.ORDER); assert.deepEqual(list.windows, [30, 60, 120, 180, 360, 720, 1440]);
  // the students of the batch see it, others don't
  const mine = (await s.asha.learner('GET', '/api/me/batches')).body.batches[0].tests;
  assert.equal(mine.length, 1); assert.equal(mine[0].state, 'upcoming'); assert.equal(mine[0].mine, 'not_started');
  assert.equal(mine[0].link, `/exam-practice?batchTest=${r.body.test.id}`);
  assert.equal((await s.eve.learner('GET', '/api/me/batches')).body.batches[0].tests.length, 0);
  assert.equal((await s.eve.learner('GET', `/api/me/batch-tests/${r.body.test.id}`)).status, 404);
  // not open yet
  r = await s.asha.learner('POST', `/api/me/batch-tests/${r.body.test.id}/start`, {});
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'test_upcoming');
  const a = await K.one("SELECT detail FROM audit_logs WHERE action = 'institute.test_add' AND target = ?1", `institute:${s.ins}`);
  assert.equal(JSON.parse(a.detail).mode, 'ssc-typing');
});

test('taking it: the same passage for all, the first result in time counts, results in one table and a spreadsheet', async () => {
  const s = await setup('take');
  const now = istParts(0);
  let r = await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', passageId: 's2', day: now.day, time: now.time, windowMinutes: 30 });
  assert.equal(r.status, 201); assert.equal(r.body.test.state, 'open');
  const tid = r.body.test.id, me = `/api/me/batch-tests/${tid}`;
  const text = X.passage('ssc-typing', 's2').text;
  // Asha opens it twice, then submits the whole passage: it counts, and passes
  r = await s.asha.learner('GET', me);
  assert.equal(r.status, 200); assert.equal(r.body.test.passageId, 's2'); assert.equal(r.body.batch.name, 'Morning'); assert.equal(r.body.mine.starts, 0);
  await s.asha.learner('POST', `${me}/start`, {});
  r = await s.asha.learner('POST', `${me}/start`, {});
  assert.equal(r.status, 200); assert.equal(r.body.mine.starts, 2);
  r = await s.asha.learner('POST', '/api/exams/results', attempt('ssc-typing', 's2', text, 560, { batchTestId: tid }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.batchTest, { batch: { name: 'Morning' }, counted: true });
  assert.equal(r.body.result.passed, true);
  // a second result doesn't replace the first; starting again is refused
  r = await s.asha.learner('POST', '/api/exams/results', attempt('ssc-typing', 's2', text.slice(0, 400), 100, { batchTestId: tid }));
  assert.equal(r.status, 201); assert.equal(r.body.batchTest.counted, false); assert.equal(r.body.batchTest.why, 'already');
  assert.equal((await s.asha.learner('POST', `${me}/start`, {})).body.error.code, 'already');
  // Ravi types another passage: saved as practice, not counted
  await s.ravi.learner('POST', `${me}/start`, {});
  r = await s.ravi.learner('POST', '/api/exams/results', attempt('ssc-typing', 's1', X.passage('ssc-typing', 's1').text.slice(0, 600), 200, { batchTestId: tid }));
  assert.equal(r.body.batchTest.counted, false); assert.equal(r.body.batchTest.why, 'other_test');
  // then the right one, part of it: counts, doesn't pass
  r = await s.ravi.learner('POST', '/api/exams/results', attempt('ssc-typing', 's2', text.slice(0, 700), 300, { batchTestId: tid }));
  assert.equal(r.body.batchTest.counted, true); assert.equal(r.body.result.passed, false);
  // Tina submits without opening it in the window: not counted; Eve isn't in the batch
  r = await s.tina.learner('POST', '/api/exams/results', attempt('ssc-typing', 's2', text.slice(0, 300), 120, { batchTestId: tid }));
  assert.equal(r.body.batchTest.why, 'not_started');
  r = await s.eve.learner('POST', '/api/exams/results', attempt('ssc-typing', 's2', text.slice(0, 300), 120, { batchTestId: tid }));
  assert.equal(r.status, 201, 'still saved as her own practice'); assert.deepEqual(r.body.batchTest, { counted: false, why: 'not_yours' });
  // the same result sent again is still the counted one
  const again = attempt('ssc-typing', 's2', text.slice(0, 700), 300, { batchTestId: tid });

  // the teacher's table: passed first, then by key depressions
  r = await s.teacher.learner('GET', `${s.url}/${tid}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x) => [x.name, x.state, x.starts]), [['Asha Singh', 'submitted', 2], ['Ravi Kumar', 'submitted', 1], ['Tina Das', 'not_started', 0]]);
  assert.equal(r.body.rows[0].result.strokes, text.length); assert.equal(r.body.rows[0].result.passed, true);
  const list = (await s.teacher.learner('GET', s.url)).body.tests[0];
  assert.equal(list.started, 2); assert.equal(list.submitted, 2); assert.equal(list.passed, 1);
  const csv = await s.teacher.learner('GET', `${s.url}/${tid}/results.csv`);
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /filename="typecraft-test-centre-morning-ssc-typing-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^"Asha Singh","asha\.take@example\.com","Yes","Submitted","2",/);
  assert.match(lines[3], /"Tina Das".*"Not taken"/);
  assert.equal((await s.outsider.learner('GET', `${s.url}/${tid}/results.csv`)).status, 404);
  // the dashboard says how it went
  const d = (await s.asha.learner('GET', '/api/me/batches')).body.batches[0].tests[0];
  assert.equal(d.mine, 'passed'); assert.equal(d.state, 'open');
  // Ravi resends the same result id: still counted, nothing doubles
  r = await s.ravi.learner('POST', '/api/exams/results', { ...again, id: (await K.one('SELECT result_id FROM batch_test_attempts WHERE test_id = ?1 AND user_id = ?2', tid, s.ravi.id)).result_id });
  assert.equal(r.status, 200); assert.equal(r.body.duplicate, true); assert.equal(r.body.batchTest.counted, true);
});

test('closing: late results and cancelled tests do not count; a student who left keeps their row', async () => {
  const s = await setup('close');
  const now = istParts(0);
  const tid = (await s.teacher.learner('POST', s.url, { mode: 'cpct', passageId: 'c1', day: now.day, time: now.time, windowMinutes: 30 })).body.test.id;
  const me = `/api/me/batch-tests/${tid}`;
  const text = X.passage('cpct', 'c1').text.slice(0, 900);
  await s.asha.learner('POST', `${me}/start`, {});
  await s.ravi.learner('POST', `${me}/start`, {});
  // Ravi took far too long: the window closed long before he submitted
  await K.run('UPDATE batch_tests SET opens_at = ?2, closes_at = ?3 WHERE id = ?1', tid, iso(-120 * MIN), iso(-60 * MIN));
  await K.run('UPDATE batch_test_attempts SET first_started_at = ?3, last_started_at = ?3 WHERE test_id = ?1 AND user_id = ?2', tid, s.ravi.id, iso(-61 * MIN));
  let r = await s.ravi.learner('POST', '/api/exams/results', attempt('cpct', 'c1', text, 400, { batchTestId: tid }));
  assert.equal(r.body.batchTest.counted, false); assert.equal(r.body.batchTest.why, 'late');
  // started a minute before it closed, submitted within the test's 15 minutes: counts
  await K.run('UPDATE batch_test_attempts SET last_started_at = ?3 WHERE test_id = ?1 AND user_id = ?2', tid, s.asha.id, iso(-61 * MIN));
  await K.run('UPDATE batch_tests SET closes_at = ?2 WHERE id = ?1', tid, iso(-10 * MIN));
  r = await s.asha.learner('POST', '/api/exams/results', attempt('cpct', 'c1', text, 400, { batchTestId: tid }));
  assert.equal(r.body.batchTest.counted, false, 'she opened it an hour ago: far longer than the 15-minute test');
  await K.run('UPDATE batch_test_attempts SET last_started_at = ?3 WHERE test_id = ?1 AND user_id = ?2', tid, s.asha.id, iso(-11 * MIN));
  r = await s.asha.learner('POST', '/api/exams/results', attempt('cpct', 'c1', text, 400, { batchTestId: tid }));
  assert.equal(r.body.batchTest.counted, true);
  assert.equal((await s.tina.learner('POST', `${me}/start`, {})).body.error.code, 'test_closed');
  // Asha leaves the batch: the teacher still sees her result
  await K.run("UPDATE institute_students SET status = 'left' WHERE user_id = ?1", s.asha.id);
  const rows = (await s.teacher.learner('GET', `${s.url}/${tid}`)).body.rows;
  assert.deepEqual(rows.map((x) => [x.name, x.inBatch, x.state]), [['Asha Singh', false, 'submitted'], ['Ravi Kumar', true, 'started'], ['Tina Das', true, 'not_started']]);

  // a cancelled test: nobody can start it, and it leaves the students' dashboard
  const t2 = (await s.teacher.learner('POST', s.url, { mode: 'ssc-dest', day: now.day, time: now.time, windowMinutes: 60 })).body.test.id;
  assert.equal((await s.outsider.learner('POST', `${s.url}/${t2}/cancel`, {})).status, 404);
  r = await s.teacher.learner('POST', `${s.url}/${t2}/cancel`, {});
  assert.equal(r.body.cancelled, true);
  assert.equal((await s.ravi.learner('POST', `/api/me/batch-tests/${t2}/start`, {})).body.error.code, 'test_cancelled');
  const dash = (await s.ravi.learner('GET', '/api/me/batches')).body.batches[0].tests;
  assert.ok(!dash.some((t) => t.id === t2));
  assert.equal((await s.teacher.learner('GET', s.url)).body.tests.find((t) => t.id === t2).state, 'cancelled');
});

test('a batch can have 20 tests waiting or open', async () => {
  const s = await setup('many');
  const later = istParts(86400000);
  for (let i = 0; i < 20; i++) assert.equal((await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', day: later.day, time: later.time, windowMinutes: 30 })).status, 201);
  const r = await s.teacher.learner('POST', s.url, { mode: 'ssc-typing', day: later.day, time: later.time, windowMinutes: 30 });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'too_many');
});

test('before migration 0012: the batch page hides scheduled tests, dashboards and exam practice work as before', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  env.DB.db.exec('DROP TABLE batch_test_attempts; DROP TABLE batch_tests;');
  const Q = { env, srv: await startServer(env, 8805) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const saved = K;
  K = kit(Q, { ipPrefix: '10.88.0.' });
  try {
    const s = await setup('old');
    let r = await s.teacher.learner('GET', s.url);
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'tests_not_ready');
    r = await s.asha.learner('GET', '/api/me/batches');
    assert.equal(r.status, 200); assert.deepEqual(r.body.batches[0].tests, []);
    r = await s.asha.learner('POST', '/api/exams/results', attempt('ssc-typing', 's1', X.passage('ssc-typing', 's1').text.slice(0, 300), 120, { batchTestId: 'btst_00000000000000000000' }));
    assert.equal(r.status, 201); assert.deepEqual(r.body.batchTest, { counted: false, why: 'not_ready' });
  } finally { K = saved; Q.srv.server.close(); }
});
