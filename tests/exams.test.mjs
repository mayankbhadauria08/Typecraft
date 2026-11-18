// Exam practice and verifiable certificates (docs/EXAM-MODES.md).
//   node --test tests/exams.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import '../shared/exam-passages.js';
import '../shared/exam-rules.js';

const X = globalThis.TC_EXAMS;
let S, K, asha, ravi;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8785) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.72.0.' });
  asha = await K.account({ email: 'asha.exam@example.com', name: 'Asha Verma' });
  ravi = await K.account({ email: 'ravi.exam@example.com', name: 'Ravi Kumar' });
});
after(() => { S.srv.server.close(); });

const text = (mode, id) => X.passage(mode, id).text;
const W = (mode, id) => X.words(text(mode, id));
let n = 0;
const newId = () => `ex-test-${String(++n).padStart(6, '0')}`;
/** What the page sends: the typed text, its path from the browser's full alignment, the time. */
function attempt(mode, passageId, typed, seconds, extra = {}) {
  const r = X.score(mode, passageId, typed, seconds, { optimal: true });
  return { id: newId(), mode, passageId, typed, seconds, path: r.path, today: new Date().toISOString().slice(0, 10), ...extra };
}
const save = (c, body) => c('POST', '/api/exams/results', body);

/* ---------------- the shared rules ---------------- */
test('marking: full and half mistakes, lined up with the passage; the rest of the passage is free', () => {
  const w = W('ssc-typing', 's1');
  let r = X.score('ssc-typing', 's1', text('ssc-typing', 's1'), 540);
  assert.equal(r.full, 0); assert.equal(r.half, 0); assert.equal(r.strokes, text('ssc-typing', 's1').length); assert.equal(r.passed, true);
  assert.equal(r.correctStrokes, r.strokes, 'every key depression right (the last word has no space after it)');
  // 20 words, then: one left out, one with capitals, one misspelt, one extra, two run together, one punctuation
  const t = w.slice(0, 40);
  t.splice(3, 1);                       // left out: full
  t[6] = t[6].toUpperCase();            // capitals: half
  t[10] = t[10] + 'z';                  // misspelt: full
  t.splice(14, 0, 'and');               // extra: full
  t[20] = t[20] + t[21]; t.splice(21, 1); // run together: half
  t[25] = t[25] + ';';                  // punctuation: half
  r = X.score('ssc-typing', 's1', t.join(' '), 60);
  assert.equal(r.full, 3); assert.equal(r.half, 3); assert.equal(r.mistakes, 4.5);
  assert.equal(r.words, 40, 'lined up to the 40th passage word: nothing after it counts');
  assert.deepEqual(r.list.map((x) => x.kind), ['missing', 'case', 'wrong', 'extra', 'space', 'punct']);
  assert.equal(r.mistakesPct, 11.25);
  // a word typed with a space inside it
  const s = w.slice(0, 6); s[2] = 'li brary';
  r = X.score('ssc-typing', 's1', s.join(' '), 20);
  assert.equal(r.full, 0); assert.equal(r.half, 1); assert.equal(r.list[0].kind, 'space');
  // speeds: gross from every key depression, net minus mistakes a minute
  r = X.score('cpct', 'c1', w.slice(0, 100).join(' ') + ' wrong words here', 120);
  assert.equal(r.grossWpm, Math.round((r.strokes / 5 / 2) * 10) / 10);
  assert.equal(r.netWpm, Math.round((r.grossWpm - r.mistakes / 2) * 10) / 10);
});

test('marking: goals, verdicts and refused input', () => {
  const dest = text('ssc-dest', 'd2');
  let r = X.score('ssc-dest', 'd2', dest, 900);
  assert.equal(r.passed, true); assert.ok(r.correctStrokes >= 2000);
  r = X.score('ssc-dest', 'd2', X.words(dest).slice(0, 200).join(' '), 900);
  assert.equal(r.passed, false); assert.match(X.verdict(r).text, /correct key depressions of the 2,000 needed/);
  // SSC typing: enough typed but too many mistakes
  const many = X.words(text('ssc-typing', 's2')).map((x, i) => (i % 12 === 0 ? x + 'q' : x)).join(' ');
  r = X.score('ssc-typing', 's2', many, 590);
  assert.ok(r.strokes >= 1750); assert.equal(r.passed, false); assert.match(X.verdict(r).text, /Aim for 5% or less/);
  // CPCT: fast but stopped early does not pass
  r = X.score('cpct', 'c2', X.words(text('cpct', 'c2')).slice(0, 150).join(' '), 180);
  assert.ok(r.netWpm >= 30); assert.equal(r.passed, false); assert.match(X.verdict(r).text, /stopped early/);
  r = X.score('cpct', 'c2', X.words(text('cpct', 'c2')).slice(0, 600).join(' '), 900);
  assert.equal(r.passed, true);
  // refused
  assert.equal(X.score('nope', 's1', 'a', 10).field, 'mode');
  assert.equal(X.score('ssc-typing', 'd1', 'a', 10).field, 'passageId');
  assert.equal(X.score('ssc-typing', 's1', 'The ₹', 10).field, 'typed');
  assert.equal(X.score('ssc-typing', 's1', 'The', 700).field, 'seconds');
  assert.equal(X.score('ssc-typing', 's1', 'x'.repeat(30001), 60).field, 'typed');
});

test('a path from the browser is checked step by step and cannot hide a mistake', () => {
  const w = W('ssc-dest', 'd1');
  const t = w.slice(0, 120); t[5] = 'wrong'; t.splice(30, 2); t.splice(60, 0, 'extra', 'words');
  const best = X.mark(w, t, { optimal: true });
  assert.deepEqual([best.full, best.half], [5, 0]);
  // the Worker, given the browser's path, agrees
  const server = X.mark(w, t, { path: best.path });
  assert.deepEqual([server.full, server.half, server.correctStrokes], [best.full, best.half, best.correctStrokes]);
  // a path that skips the mistakes does not fit what was typed: refused, the Worker marks it itself
  assert.equal(X.replay(w, t, 'M'.repeat(t.length + 5)), null);
  assert.equal(X.replay(w, t, 'J' + best.path.slice(2)), null, 'two words "typed as one" that were not');
  const shifted = X.replay(w, t, best.path.replace('O', ''));   // fits, but lines the words up badly
  assert.ok(shifted.full > best.full, 'a worse path only costs more');
  const fallback = X.mark(w, t, { path: 'garbage' });
  assert.ok(fallback.full * 2 + fallback.half >= best.full * 2 + best.half);
  // any path that does fit costs at least the fewest mistakes
  const pairwise = X.replay(w, t, 'M'.repeat(t.length));
  assert.ok(pairwise.full * 2 + pairwise.half >= best.full * 2 + best.half);
});

/* ---------------- saving ---------------- */
test('saving results: signed in, marked by the Worker, once per id, a daily limit', async () => {
  assert.equal((await save(K.client(), attempt('ssc-typing', 's1', 'The town', 10))).status, 401);
  const body = attempt('ssc-typing', 's1', text('ssc-typing', 's1'), 560);
  let r = await save(asha.learner, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.result.passed, true); assert.equal(r.body.result.full, 0); assert.equal(r.body.verdict.passed, true);
  const row = await K.one('SELECT * FROM exam_results WHERE id = ?1', body.id);
  assert.equal(row.user_id, asha.id); assert.equal(row.strokes, text('ssc-typing', 's1').length);
  assert.ok(!Object.keys(row).some((k) => /typed|text/.test(k)), 'the typed text is never stored');
  // the same id again: kept once
  r = await save(asha.learner, body);
  assert.equal(r.status, 200); assert.equal(r.body.duplicate, true);
  // the same id from someone else
  assert.equal((await save(ravi.learner, body)).status, 409);
  // a wrong path: the Worker marks it itself, and the mistakes still count
  const w = W('ssc-typing', 's3'); const t = w.slice(0, 80); t[10] = 'zzz'; t.splice(40, 1);
  r = await save(asha.learner, { ...attempt('ssc-typing', 's3', t.join(' '), 150), path: 'M'.repeat(80) });
  assert.equal(r.status, 201); assert.equal(r.body.result.full, 2);
  // impossible speeds
  r = await save(asha.learner, attempt('ssc-typing', 's2', text('ssc-typing', 's2'), 30));
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'implausible');
  r = await save(asha.learner, attempt('ssc-typing', 's2', 'The', 900));
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.seconds);
  r = await save(asha.learner, { ...attempt('ssc-typing', 's2', 'The', 10), id: 'bad id' });
  assert.equal(r.status, 400);
  // the daily limit
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 20; i++) {
    await K.run(`INSERT INTO exam_results (id, user_id, mode, passage_id, seconds, strokes, correct_strokes, words, full_mistakes, half_mistakes, gross_wpm, net_wpm, kdph, mistakes_pct, passed, day, created_at)
                 VALUES (?1, ?2, 'cpct', 'c1', 900, 100, 100, 20, 0, 0, 10, 10, 400, 0, 0, ?3, ?4)`, `ex-fill-${String(i).padStart(4, '0')}`, ravi.id, today, new Date().toISOString());
  }
  r = await save(ravi.learner, attempt('cpct', 'c1', 'The town library', 20));
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'daily_limit');
  await K.run('DELETE FROM exam_results WHERE user_id = ?1', ravi.id);
});

test('your attempts: newest first, best per test, certificate codes', async () => {
  const r = await asha.learner('GET', '/api/exams/results');
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 2);
  assert.equal(r.body.results[0].mode, 'ssc-typing'); assert.equal(r.body.best['ssc-typing'].attempts, 2); assert.equal(r.body.best['ssc-typing'].passed, 1);
  assert.equal((await ravi.learner('GET', '/api/exams/results')).body.results.length, 0, 'only your own');
});

/* ---------------- certificates ---------------- */
test('certificates: a code for a passed test, codes for course certificates, sharing, checking', async () => {
  const mine = (await asha.learner('GET', '/api/exams/results')).body.results;
  const passed = mine.find((x) => x.passed), failed = mine.find((x) => !x.passed);
  assert.equal((await asha.learner('POST', `/api/exams/results/${failed.id}/certificate`, {})).status, 409);
  assert.equal((await ravi.learner('POST', `/api/exams/results/${passed.id}/certificate`, {})).status, 404, "not someone else's");
  let r = await asha.learner('POST', `/api/exams/results/${passed.id}/certificate`, {});
  assert.equal(r.status, 200); assert.match(r.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const examCode = r.body.code;
  assert.equal((await asha.learner('POST', `/api/exams/results/${passed.id}/certificate`, {})).body.code, examCode, 'the same code every time');
  // a speed certificate from the course gets its code when the list is opened
  await K.run(`INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 30, 33.4, 97.2, 120, ?2)`, asha.id, new Date().toISOString());
  r = await asha.learner('GET', '/api/me/certificates');
  assert.equal(r.status, 200); assert.equal(r.body.ready, true);
  const level = r.body.certificates.find((c) => c.kind === 'level'), exam = r.body.certificates.find((c) => c.kind === 'exam');
  assert.equal(level.wpm, 33); assert.equal(level.test, 'a 2-minute timed test in the TypeCraft course (the 30 wpm certificate)'); assert.ok(level.code);
  assert.equal(exam.code, examCode); assert.equal(exam.test, '10-minute typing test with a set passage'); assert.ok(!/SSC|CPCT/.test(JSON.stringify(exam)), 'no exam body named');
  assert.equal((await asha.learner('GET', '/api/me/certificates')).body.certificates.find((c) => c.kind === 'level').code, level.code, 'made once');
  // anyone can check a code, typed any way
  const anyone = K.client();
  r = await anyone('GET', `/api/certificates/${examCode.toLowerCase().replace(/-/g, '')}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.certificate.holder, 'Asha Verma'); assert.equal(r.body.certificate.kind, 'exam'); assert.equal(r.body.certificate.code, examCode);
  assert.ok(!/asha\.exam@|user_id|userId/.test(r.text), 'no email or account id');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  r = await anyone('GET', `/api/certificates/${level.code}`);
  assert.equal(r.body.certificate.title, '33 words a minute');
  assert.equal((await anyone('GET', '/api/certificates/AAAA-BBBB-CCCC')).status, 404);
  assert.equal((await anyone('GET', '/api/certificates/not-a-code-at')).status, 404);
  // the holder stops sharing it, then shares it again
  assert.equal((await ravi.learner('PUT', `/api/me/certificates/${examCode}`, { shared: false })).status, 404, "not someone else's");
  r = await asha.learner('PUT', `/api/me/certificates/${examCode}`, { shared: false });
  assert.equal(r.status, 200); assert.equal(r.body.shared, false);
  r = await anyone('GET', `/api/certificates/${examCode}`);
  assert.equal(r.status, 404); assert.match(r.body.error.message, /stopped sharing/);
  await asha.learner('PUT', `/api/me/certificates/${examCode}`, { shared: true });
  assert.equal((await anyone('GET', `/api/certificates/${examCode}`)).status, 200);
  // a disabled account's certificates can't be checked
  await K.run("UPDATE users SET account_status = 'disabled' WHERE id = ?1", asha.id);
  assert.equal((await anyone('GET', `/api/certificates/${examCode}`)).status, 404);
  await K.run("UPDATE users SET account_status = 'active' WHERE id = ?1", asha.id);
});

test('checking is rate limited per address', async () => {
  const c = K.client();
  let last = null;
  for (let i = 0; i < 61; i++) last = await c('GET', '/api/certificates/AAAA-BBBB-CCCC');
  assert.equal(last.status, 429);
});

test('resetting progress removes course certificate codes; exam results and their codes stay', async () => {
  const before = await K.many('SELECT kind FROM certificate_codes WHERE user_id = ?1 ORDER BY kind', asha.id);
  assert.deepEqual(before.map((r) => r.kind), ['exam', 'level']);
  const r = await asha.learner('POST', '/api/user/reset', { confirm: 'RESET' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const left = await K.many('SELECT kind FROM certificate_codes WHERE user_id = ?1', asha.id);
  assert.deepEqual(left.map((x) => x.kind), ['exam']);
  assert.ok((await K.one('SELECT COUNT(*) AS n FROM exam_results WHERE user_id = ?1', asha.id)).n >= 2);
  const exp = await asha.learner('GET', '/api/user/export');
  assert.ok(Array.isArray(exp.body.exam_results) && exp.body.exam_results.length >= 2, 'in the data export');
  assert.ok(exp.body.certificate_codes.length === 1);
});

test('before migration 0008: tests still mark in the browser, saving and checking say they are not switched on', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  const S2 = { env, srv: await startServer(env, 8786) }; S2.base = `http://localhost:${S2.srv.port}`;
  await env.DB.prepare('DROP TABLE certificate_codes').run(); await env.DB.prepare('DROP TABLE exam_results').run();
  const K2 = kit(S2, { ipPrefix: '10.72.1.' });
  const who = await K2.account({ email: 'old.db@example.com', name: 'Old Database' });
  await K2.run(`INSERT INTO certificates (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 20, 24, 96, 60, ?2)`, who.id, new Date().toISOString());
  let r = await who.learner('POST', '/api/exams/results', attempt('ssc-typing', 's1', 'The town library', 20));
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'exams_not_ready');
  r = await who.learner('GET', '/api/me/certificates');
  assert.equal(r.status, 200); assert.equal(r.body.ready, false); assert.equal(r.body.certificates[0].code, null);
  r = await K2.client()('GET', '/api/certificates/AAAA-BBBB-CCCC');
  assert.equal(r.status, 503);
  assert.equal((await who.learner('POST', '/api/user/reset', { confirm: 'RESET' })).status, 200, 'reset still works');
  assert.equal((await who.learner('GET', '/api/user/export')).status, 200, 'export still works');
  S2.srv.server.close();
});

/* ---------------- pages ---------------- */
test('pages: exam practice, verify (not indexed), your certificates', async () => {
  const anyone = K.client();
  let r = await anyone('GET', '/exam-practice');
  assert.equal(r.status, 200);
  for (const m of X.ORDER) assert.ok(r.text.includes(`data-start="${m}"`), m);
  for (const s of ['/shared/exam-passages.js', '/shared/exam-rules.js', '/site/js/exam-practice.js', '/js/rewards-ui.js']) assert.ok(r.text.includes(`src="${s}`), s);
  assert.match(r.text, /not the exams' own software/);
  r = await anyone('GET', '/verify');
  assert.equal(r.status, 200); assert.match(r.text, /<meta name="robots" content="noindex/);
  r = await anyone('GET', '/verify/ABCD-EFGH-JKLM');
  assert.equal(r.status, 200); assert.match(r.text, /noindex/); assert.ok(r.text.includes('id="verifyForm"'));
  const map = await anyone('GET', '/sitemap.xml');
  assert.match(map.text, /\/exam-practice</); assert.ok(!/\/verify/.test(map.text));
  r = await anyone('GET', '/account/certificates');
  assert.equal(r.status, 302);
  r = await asha.learner('GET', '/account/certificates');
  assert.equal(r.status, 200); assert.ok(r.text.includes('id="cert-list"'));
  assert.ok(r.text.includes('href="/account/certificates"'), 'in the account menu');
  assert.ok((await anyone('GET', '/')).text.includes('href="/exam-practice"'), 'in the site menu');
});
