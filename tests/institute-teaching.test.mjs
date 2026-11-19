// Targets, assignments, exam practice by batch, leaderboard: Release 2 (docs/INSTITUTES.md §12).
//   node --test tests/institute-teaching.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode } from '../src/institute-access.js';

let S, K, ins, A, B, boss, tina, asha, ravi, neha;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const istDay = (n = 0) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
let n = 0;
async function batch(name) {
  const id = newId('bat');
  await K.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', id, ins, name, newJoinCode(), iso(-30));
  return id;
}
async function seat(batchId, who) {
  await K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
    newId('mem'), ins, batchId, who.id, iso(-20));
}
async function staff(who, role, batchId) {
  const id = newId('stf');
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`, id, ins, who.id, who.email, role, iso(-30));
  if (batchId) await K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', batchId, id, iso(-30));
}
const runEv = (who, lessonId, wpm, accuracy, daysAgo = 0) => K.run(`INSERT INTO events (user_id, id, type, lesson_id, wpm, accuracy, errors, seconds, stars, crown, xp, day, device_at, server_at, source, data)
  VALUES (?1, ?2, 'run', ?3, ?4, ?5, 1, 60, 2, 0, 0, ?6, ?7, ?7, 'test', '{}')`, who.id, `ev-t-${++n}`, lessonId, wpm, accuracy, istDay(-daysAgo), iso(-daysAgo));
const done = (who, lessonId, at) => K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, best_wpm, best_accuracy, attempts, last_played, completed_at)
  VALUES (?1, ?2, 'completed', 2, 30, 95, 1, ?3, ?3)`, who.id, lessonId, at);
const exam = (who, mode, net, passed, at) => K.run(`INSERT INTO exam_results (id, user_id, mode, passage_id, seconds, strokes, correct_strokes, words, full_mistakes, half_mistakes, gross_wpm, net_wpm, kdph, mistakes_pct, passed, day, created_at)
  VALUES (?1, ?2, ?3, 's1', 600, 1800, 1750, 360, 2, 0, ?4, ?4, 10000, 1.5, ?5, ?6, ?7)`, `ex-t-${++n}`, who.id, mode, net, passed ? 1 : 0, istDay(0), at);
const api = (who, method, path, body) => who.learner(method, `/api/institutes/${ins}/batches/${path}`, body);

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8797) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.81.0.' });
  ins = newId('ins');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, 'Teach Centre', 'premium', 20, 0, ?2, ?3, 'active', ?2, ?2)`, ins, iso(-30), iso(60));
  A = await batch('Morning'); B = await batch('Evening');
  boss = await K.account({ email: 'boss.it@example.com', name: 'Boss' });
  tina = await K.account({ email: 'tina.it@example.com', name: 'Tina' });
  await staff(boss, 'admin'); await staff(tina, 'teacher', A);
  asha = await K.account({ email: 'asha.it@example.com', name: 'Asha Verma' });
  ravi = await K.account({ email: 'ravi.it@example.com', name: 'Ravi Kumar' });
  neha = await K.account({ email: 'neha.it@example.com', name: 'Neha Joshi' });
  await seat(A, asha); await seat(A, ravi); await seat(B, neha);
});
after(() => { S.srv.server.close(); });

test('a target: who reached it, at the accuracy asked; the student sees it', async () => {
  let r = await api(tina, 'PUT', `${A}/target`, { wpm: 200, accuracy: 30, dueDay: istDay(-1) });
  assert.equal(r.status, 400);
  for (const f of ['wpm', 'accuracy', 'dueDay']) assert.ok(r.body.error.fields[f], f);
  r = await api(tina, 'PUT', `${A}/target`, { wpm: 35, accuracy: 95, dueDay: istDay(10), note: 'SSC CHSL: 35 wpm' });
  assert.equal(r.status, 200);
  await runEv(asha, 'l5', 40, 96);          // fast and accurate: reached
  await runEv(ravi, 'l5', 45, 90);          // fast but not accurate enough: doesn't count
  await runEv(ravi, 'l6', 30, 97);
  await K.run(`INSERT INTO typing_tests (id, user_id, duration, wpm, accuracy, day, created_at) VALUES ('tt-1', ?1, 60, 33, 98, ?2, ?3)`, ravi.id, istDay(0), iso(0));
  r = await api(tina, 'GET', `${A}/teaching`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.target, { wpm: 35, accuracy: 95, dueDay: istDay(10), note: 'SSC CHSL: 35 wpm', setAt: r.body.target.setAt });
  const by = Object.fromEntries(r.body.targetStudents.map((x) => [x.name, x]));
  assert.deepEqual([by['Asha Verma'].best, by['Asha Verma'].met], [40, true]);
  assert.deepEqual([by['Ravi Kumar'].best, by['Ravi Kumar'].met], [33, false], 'the typing test at 98% is his best that counts');
  const mine = (await ravi.learner('GET', '/api/me/batches')).body.batches[0];
  assert.equal(mine.batch.name, 'Morning');
  assert.deepEqual([mine.target.wpm, mine.target.myBest, mine.target.met], [35, 33, false]);
  // other batch's teacher? Tina doesn't teach Evening
  assert.equal((await api(tina, 'PUT', `${B}/target`, { wpm: 30, accuracy: 90 })).status, 404);
  assert.equal((await api(asha, 'GET', `${A}/teaching`)).status, 404, 'students are not staff');
  r = await api(boss, 'PUT', `${B}/target`, { clear: true });
  assert.equal(r.body.target, null);
});

test('assignments: done, done late, not done, to do; removing one', async () => {
  let r = await api(tina, 'POST', `${A}/assignments`, { kind: 'lesson', ref: 'l99', dueDay: istDay(3) });
  assert.equal(r.status, 400);
  r = await api(tina, 'POST', `${A}/assignments`, { kind: 'exam', ref: 'ssc-typing', dueDay: istDay(-1) });
  assert.equal(r.status, 400, 'a due day in the past');
  const lesson = (await api(tina, 'POST', `${A}/assignments`, { kind: 'lesson', ref: 'l8', dueDay: istDay(5), note: 'Number row' })).body.assignment.id;
  const ex = (await api(tina, 'POST', `${A}/assignments`, { kind: 'exam', ref: 'ssc-typing', dueDay: istDay(0) })).body.assignment.id;
  await done(asha, 'l8', iso(0));
  await exam(asha, 'ssc-typing', 36.4, true, iso(0));
  await exam(ravi, 'ssc-typing', 22, false, iso(-5)); // before the assignment was given: doesn't count
  r = await api(tina, 'GET', `${A}/teaching`);
  const L = r.body.assignments.find((a) => a.id === lesson), E = r.body.assignments.find((a) => a.id === ex);
  assert.match(L.title, /^Lesson \d+: /); assert.equal(L.note, 'Number row');
  assert.deepEqual([L.done, L.todo], [1, 1]);
  assert.deepEqual([E.done, E.todo], [1, 1]);
  assert.equal(E.students.find((x) => x.name === 'Ravi Kumar').state, 'todo');
  // the day passes: not done becomes overdue
  await K.run('UPDATE assignments SET due_day = ?2 WHERE id = ?1', ex, istDay(-2));
  r = await api(tina, 'GET', `${A}/teaching`);
  const E2 = r.body.assignments.find((a) => a.id === ex);
  assert.equal(E2.students.find((x) => x.name === 'Ravi Kumar').state, 'overdue');
  assert.equal(E2.students.find((x) => x.name === 'Asha Verma').state, 'late', 'done after its (moved) day');
  // exam practice by student
  const ex1 = r.body.exams.find((x) => x.name === 'Asha Verma').modes['ssc-typing'];
  assert.deepEqual([ex1.best, ex1.passed, ex1.tries], [36, true, 1]);
  // the student's own view: links to do it
  const mine = (await ravi.learner('GET', '/api/me/batches')).body.batches[0];
  const ml = mine.assignments.find((a) => a.id === lesson);
  assert.equal(ml.state, 'todo'); assert.equal(ml.link, '/app');
  assert.equal(mine.assignments.find((a) => a.id === ex).link, '/exam-practice?test=ssc-typing');
  // remove
  assert.equal((await api(tina, 'POST', `${A}/assignments/${lesson}/remove`, {})).status, 200);
  assert.equal((await api(tina, 'POST', `${A}/assignments/${lesson}/remove`, {})).status, 404);
  assert.equal((await api(boss, 'POST', `${B}/assignments/${ex}/remove`, {})).status, 404, 'an assignment of another batch');
  assert.ok(!(await api(tina, 'GET', `${A}/teaching`)).body.assignments.some((a) => a.id === lesson));
});

test('the leaderboard: off until switched on; first names and this week only', async () => {
  await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, 300, 2, 41.6, 190, 2)', asha.id, istDay(0));
  await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, 300, 2, 33, 190, 2)', ravi.id, istDay(-2));
  await K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, 300, 2, 60, 190, 2)', ravi.id, istDay(-20));
  let mine = (await asha.learner('GET', '/api/me/batches')).body.batches[0];
  assert.equal(mine.leaderboard, null, 'off by default');
  let r = await api(tina, 'GET', `${A}/teaching`);
  assert.equal(r.body.leaderboard.on, false);
  assert.deepEqual(r.body.leaderboard.rows, [{ name: 'Asha', wpm: 42 }, { name: 'Ravi', wpm: 33 }], 'the teacher sees it while off; older days left out');
  assert.equal((await api(tina, 'PUT', `${A}/leaderboard`, { on: 'yes' })).status, 400);
  assert.equal((await api(tina, 'PUT', `${A}/leaderboard`, { on: true })).status, 200);
  mine = (await ravi.learner('GET', '/api/me/batches')).body.batches[0];
  assert.deepEqual(mine.leaderboard, [{ name: 'Asha', wpm: 42 }, { name: 'Ravi', wpm: 33 }]);
  const other = (await neha.learner('GET', '/api/me/batches')).body.batches[0];
  assert.equal(other.leaderboard, null, 'another batch');
  const acts = (await K.audits('institute.%')).map((a) => a.action);
  for (const a of ['institute.target_set', 'institute.assignment_add', 'institute.assignment_remove', 'institute.leaderboard']) assert.ok(acts.includes(a), a);
  // the dashboard carries the card
  assert.match((await asha.learner('GET', '/dashboard')).text, /id="dash-batch"/);
});

test('before migration 0010: teaching says so; students still see their batch', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  env.DB.db.exec('DROP TABLE batch_targets; DROP TABLE assignments; DROP TABLE batch_leaderboards;');
  const Q = { env, srv: await startServer(env, 8798) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const Kq = kit(Q, { ipPrefix: '10.82.0.' });
  try {
    const i = newId('ins'), b = newId('bat');
    await Kq.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at) VALUES (?1, 'Old', 'premium', 5, 0, ?2, ?3, 'active', ?2, ?2)`, i, iso(-1), iso(30));
    await Kq.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', b, i, 'Only', newJoinCode(), iso(-1));
    const adm = await Kq.account({ email: 'adm.old@example.com' });
    await Kq.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'admin', 'active', ?5, ?5)`, newId('stf'), i, adm.id, adm.email, iso(-1));
    const st = await Kq.account({ email: 'st.old@example.com' });
    await Kq.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`, newId('mem'), i, b, st.id, iso(-1));
    const r = await adm.learner('GET', `/api/institutes/${i}/batches/${b}/teaching`);
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'teaching_not_ready');
    const mine = await st.learner('GET', '/api/me/batches');
    assert.equal(mine.status, 200);
    assert.deepEqual([mine.body.batches[0].batch.name, mine.body.batches[0].target, mine.body.batches[0].assignments, mine.body.batches[0].leaderboard], ['Only', null, [], null]);
    // the rest of the institute still works
    assert.equal((await adm.learner('GET', `/api/institutes/${i}/batches/${b}/report`)).status, 200);
  } finally { Q.srv.server.close(); }
});
