// Reports and certificates for institutes, Release 1 part 4 (docs/INSTITUTES.md §9).
//   node --test tests/institute-reports.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode } from '../src/institute-access.js';
import '../shared/course-meta.js';
import '../js/rewards-ui.js';

const META = globalThis.TC_META;
let S, K, ins, other, batchA, batchB, boss, tina, otto, asha, ravi, neha;
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const istDay = (n = 0) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);

async function institute(name) {
  const id = newId('ins');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, ?2, 'premium', 20, 0, ?3, ?4, 'active', ?3, ?3)`, id, name, iso(-30), iso(90));
  return id;
}
async function batch(instituteId, name) {
  const id = newId('bat');
  await K.run('INSERT INTO batches (id, institute_id, name, join_code, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', id, instituteId, name, newJoinCode(), iso(-30));
  return id;
}
async function staff(instituteId, who, role, batchId = null) {
  const id = newId('stf');
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`,
    id, instituteId, who.id, who.email, role, iso(-30));
  if (batchId) await K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', batchId, id, iso(-30));
  return id;
}
async function seat(instituteId, batchId, who, joinedDaysAgo = 20) {
  const id = newId('mem');
  await K.run(`INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
    id, instituteId, batchId, who.id, iso(-joinedDaysAgo));
  who.seat = id;
}
async function lessons(userId, done, wpm, acc) {
  for (const [i, lid] of META.ORDER.slice(0, done).entries()) {
    await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, best_wpm, best_accuracy, attempts, last_played, completed_at)
                 VALUES (?1, ?2, 'completed', 2, ?3, ?4, 1, ?5, ?5)`, userId, lid, wpm + i, acc, iso(-2));
  }
}
const day = (userId, d, seconds) => K.run('INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, ?3, 2, 30, 190, 2)', userId, d, seconds);

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8794) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.78.0.' });
  ins = await institute('Sharma Typing Centre');
  other = await institute('Elsewhere Academy');
  batchA = await batch(ins, 'Morning'); batchB = await batch(ins, 'Evening');
  boss = await K.account({ email: 'boss.ir@example.com', name: 'Boss Admin' });
  tina = await K.account({ email: 'tina.ir@example.com', name: 'Tina Teacher' });
  otto = await K.account({ email: 'otto.ir@example.com', name: 'Otto Other' });
  await staff(ins, boss, 'admin');
  await staff(ins, tina, 'teacher', batchA);
  await staff(other, otto, 'admin');
  asha = await K.account({ email: 'asha.ir@example.com', name: 'Asha Verma' });
  ravi = await K.account({ email: 'ravi.ir@example.com', name: '=Ravi Kumar' });
  neha = await K.account({ email: 'neha.ir@example.com', name: 'Neha Joshi' });
  await seat(ins, batchA, asha); await seat(ins, batchA, ravi); await seat(ins, batchB, neha);
  // Asha: Level 1 done, practised this week and earlier, weak on ; and p
  await lessons(asha.id, 16, 20, 95);
  await day(asha.id, istDay(0), 600); await day(asha.id, istDay(-2), 300); await day(asha.id, istDay(-20), 900);
  await asha.learner('PUT', '/api/user/progress/state', { keyStats: { ';': { attempts: 100, errors: 25 }, p: { attempts: 200, errors: 20 }, a: { attempts: 500, errors: 5 },
    q: { attempts: 10, errors: 9 }, f: { attempts: 300, errors: 0 }, k: { attempts: 80, errors: 4 } } });
  // Ravi: three lessons, last practised two weeks ago
  await lessons(ravi.id, 3, 12, 90);
  await day(ravi.id, istDay(-14), 1200);
});
after(() => { S.srv.server.close(); });

test('the batch report: lessons, level, speed, accuracy, practice this week, weak keys', async () => {
  const r = await boss.learner('GET', `/api/institutes/${ins}/batches/${batchA}/report`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.totalLessons, META.ORDER.length);
  const a = r.body.students.find((s) => s.email === 'asha.ir@example.com');
  assert.equal(a.lessonsDone, 16); assert.equal(a.level, 2); assert.match(a.levelName, /\w/);
  assert.equal(a.bestWpm, 35); assert.equal(a.accuracy, 95);
  assert.equal(a.minutesThisWeek, 15, 'today and two days ago, not twenty days ago');
  assert.equal(a.lastDay, istDay(0));
  assert.deepEqual(a.weakKeys, [{ key: ';', rate: 25 }, { key: 'p', rate: 10 }, { key: 'k', rate: 5 }], 'worst three; q typed too little; f has no mistakes');
  const v = r.body.students.find((s) => s.email === 'ravi.ir@example.com');
  assert.equal(v.minutesThisWeek, 0); assert.equal(v.lastDay, istDay(-14)); assert.deepEqual(v.weakKeys, []);
  assert.equal(r.body.students.length, 2, 'only this batch');
  // the batch's teacher sees it; the other batch's report is not hers; strangers get nothing
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/batches/${batchA}/report`)).status, 200);
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/batches/${batchB}/report`)).status, 404);
  assert.equal((await otto.learner('GET', `/api/institutes/${ins}/batches/${batchA}/report`)).status, 404);
  assert.equal((await asha.learner('GET', `/api/institutes/${ins}/batches/${batchA}/report`)).status, 404, 'a student is not staff');
  assert.equal((await K.client()('GET', `/api/institutes/${ins}/batches/${batchA}/report`)).status, 401);
});

test('the CSV: a spreadsheet of the same rows, safe to open', async () => {
  const r = await tina.learner('GET', `/api/institutes/${ins}/batches/${batchA}/report.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="typecraft-sharma-typing-centre-morning-\d{4}-\d{2}-\d{2}\.csv"/);
  // (the byte-order mark that makes Excel read names right is dropped by fetch's text(): see console tests)
  const lines = r.text.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^"Name","Email","Joined","Lessons done"/);
  assert.ok(lines.some((l) => l.startsWith('"Asha Verma","asha.ir@example.com"') && l.includes('"; 25%, p 10%, k 5%"')), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith(`"'=Ravi Kumar"`)), 'a name starting with = is not run as a formula');
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/batches/${batchB}/report.csv`)).status, 404);
});

test("one student's page: for the admin and the student's teachers only", async () => {
  await K.run(`INSERT INTO exam_results (id, user_id, mode, passage_id, seconds, strokes, correct_strokes, words, full_mistakes, half_mistakes, gross_wpm, net_wpm, kdph, mistakes_pct, passed, day, created_at)
               VALUES ('ex-ir-000001', ?1, 'ssc-typing', 's1', 600, 1900, 1850, 380, 2, 1, 38, 36.6, 11100, 0.9, 1, ?2, ?3)`, asha.id, istDay(0), iso(0));
  let r = await tina.learner('GET', `/api/institutes/${ins}/students/${asha.seat}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.student.name, 'Asha Verma'); assert.equal(r.body.student.batch.name, 'Morning');
  assert.equal(r.body.lessons.length, META.ORDER.length);
  assert.equal(r.body.summary.lessonsDone, 16);
  assert.equal(r.body.weakKeys[0].key, ';');
  assert.equal(r.body.exams.length, 1); assert.equal(r.body.exams[0].passed, true); assert.match(r.body.exams[0].modeName, /SSC/);
  assert.ok(r.body.days.some((d) => d.day === istDay(0)));
  assert.equal(r.body.user, undefined, 'no raw account row');
  assert.equal((await boss.learner('GET', `/api/institutes/${ins}/students/${neha.seat}`)).status, 200);
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/students/${neha.seat}`)).status, 404, 'not her batch');
  assert.equal((await otto.learner('GET', `/api/institutes/${other}/students/${asha.seat}`)).status, 404, 'a seat of another institute');
  assert.equal((await boss.learner('GET', `/api/institutes/${ins}/students/mem_00000000000000000000`)).status, 404);
  // the page opens
  assert.equal((await boss.learner('GET', `/institute/${ins}/students/${asha.seat}`)).status, 200);
});

test('certificates to print: the best course certificate, or a passed exam with a certificate; codes not shared are left off', async () => {
  // Asha: two course certificates; the higher one is printed, and gets a code
  await K.run('INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 20, 24, 96, 60, ?2)', asha.id, iso(-10));
  await K.run('INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 30, 33.4, 97.2, 120, ?2)', asha.id, iso(-3));
  // Ravi: no course certificate, a passed exam with a certificate code he stopped sharing
  await K.run(`INSERT INTO exam_results (id, user_id, mode, passage_id, seconds, strokes, correct_strokes, words, full_mistakes, half_mistakes, gross_wpm, net_wpm, kdph, mistakes_pct, passed, day, created_at)
               VALUES ('ex-ir-000002', ?1, 'cpct', 'c1', 900, 2500, 2400, 500, 3, 0, 33, 31.7, 9600, 0.6, 1, ?2, ?3)`, ravi.id, istDay(-1), iso(-1));
  await K.run(`INSERT INTO certificate_codes (code, user_id, kind, ref, shared, created_at, updated_at) VALUES ('RAVIRAVIRAV2', ?1, 'exam', 'ex-ir-000002', 0, ?2, ?2)`, ravi.id, iso(-1));
  const r = await tina.learner('GET', `/api/institutes/${ins}/batches/${batchA}/certificates`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.institute.name, 'Sharma Typing Centre');
  const a = r.body.students.find((s) => s.name === 'Asha Verma').certificate;
  assert.equal(a.kind, 'level'); assert.equal(a.wpm, 33); assert.match(a.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(await K.one("SELECT 1 AS x FROM certificate_codes WHERE user_id = ?1 AND kind = 'level' AND ref = '30'", asha.id));
  const v = r.body.students.find((s) => s.name === '=Ravi Kumar').certificate;
  assert.equal(v.kind, 'exam'); assert.equal(v.wpm, 31); assert.equal(v.code, null, 'not shared: printed without its code');
  // Neha is in the other batch; Tina can't print hers
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/batches/${batchB}/certificates`)).status, 404);
  const n = (await boss.learner('GET', `/api/institutes/${ins}/batches/${batchB}/certificates`)).body.students[0];
  assert.equal(n.certificate, null);
});

test('the verify page names the institute when the certificate was earned there', async () => {
  const code = (await K.one("SELECT code FROM certificate_codes WHERE user_id = ?1 AND kind = 'level' AND ref = '30'", asha.id)).code;
  const shown = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  let r = await K.client()('GET', `/api/certificates/${shown}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.certificate.institute, 'Sharma Typing Centre');
  // earned before joining: no institute
  const later = await K.account({ email: 'late.ir@example.com', name: 'Late Joiner' });
  await K.run('INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 20, 25, 97, 60, ?2)', later.id, iso(-60));
  await seat(ins, batchA, later, 5);
  const c = (await later.learner('GET', '/api/me/certificates')).body.certificates[0].code;
  r = await K.client()('GET', `/api/certificates/${c}`);
  assert.equal(r.body.certificate.institute, null);
});

test('the certificate picture says where it was earned, escaped', () => {
  const UI = globalThis.TC_REWARDS_UI;
  const svg = UI.certificate({ name: 'Asha', wpm: 33, accuracy: 97, seconds: 120, date: '2026-11-19', code: 'ABCD-EFGH-JKLM', institute: 'Sharma <Typing> & Co' });
  assert.match(svg, /Trained at Sharma &lt;Typing&gt; &amp; Co/);
  assert.ok(!/Trained at/.test(UI.certificate({ name: 'Asha', wpm: 33, accuracy: 97, seconds: 120 })));
});
